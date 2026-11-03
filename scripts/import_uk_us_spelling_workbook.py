"""Convert the Ninja Inkflow CE US and UK spelling database workbook
into committed JSON.

Mirrors the other workbook importers (hyphen_dash, abbreviations,
medical_terms): the Excel is the editorial source of truth; runtime reads
the emitted JSON. Output is deterministic so PR diffs are the review
surface for editorial changes.

Inputs
------
Default: ~/Downloads/Ninja_Inkflow_CE_US_UK_Spelling_Database.xlsx
Override with --workbook / -w.

Outputs (relative to repo root)
-------------------------------
app/processing/language_editing/config/profiles/uk_us_spelling_variants.json
app/processing/language_editing/config/profiles/uk_us_spelling_common.json
app/processing/language_editing/config/profiles/uk_us_spelling_patterns.json
app/processing/language_editing/config/profiles/uk_us_spelling_protected.json
app/processing/language_editing/config/profiles/uk_us_spelling_rules.json
app/processing/language_editing/config/workbooks/Ninja_Inkflow_CE_US_UK_Spelling_Database.xlsx

Each JSON carries a ``_meta`` header with the source workbook sha256 for
a CI drift check and a human-readable origin label.

Validation
----------
Each row's enum values are checked against the allowed-value sets below.
A stray spelling in the Excel fails loudly here rather than silently
going through to the runtime.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Any

try:
    import openpyxl
except ImportError:
    sys.stderr.write(
        "openpyxl is required. Activate the project venv first "
        "(source .venv/bin/activate).\n"
    )
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WORKBOOK = Path.home() / "Downloads" / "Ninja_Inkflow_CE_US_UK_Spelling_Database.xlsx"

PROFILES_DIR = REPO_ROOT / "app/processing/language_editing/config/profiles"
WORKBOOKS_DIR = REPO_ROOT / "app/processing/language_editing/config/workbooks"

OUT_VARIANTS = PROFILES_DIR / "uk_us_spelling_variants.json"
OUT_COMMON = PROFILES_DIR / "uk_us_spelling_common.json"
OUT_PATTERNS = PROFILES_DIR / "uk_us_spelling_patterns.json"
OUT_PROTECTED = PROFILES_DIR / "uk_us_spelling_protected.json"
OUT_RULES = PROFILES_DIR / "uk_us_spelling_rules.json"


# Workbook enum → engine-facing slug maps. An unexpected value fails loudly.

VARIANT_TYPE_VALID = {
    "regional_spelling", "inflectional", "derivative", "accepted_alternative",
}
VALIDATION_STATUS_VALID = {
    "dictionary_checked", "needs_review", "disputed", "verified",
}
PREFERENCE_VALID = {"preferred", "context_dependent", "accepted"}
FORMALITY_VALID = {"neutral", "formal", "informal", "technical"}

# Entry_Rules action values map to engine's tool_behaviour axis.
#   flag_autocorrect   → auto_replace (still Scope-C-reviewable)
#   flag_suggest       → flag (reviewer picks)
#   flag_with_context  → flag (context_note surfaced)
ACTION_MAP = {
    "flag_autocorrect": "auto_replace",
    "flag_suggest": "flag",
    "flag_with_context": "flag",
    "report_only": "flag",
    "ignore": "ignore",
}
SEVERITY_VALID = {"error", "warning", "info", "suggestion", "none", "info or warning"}
REPLACEMENT_STRATEGY_VALID = {
    "whole_word_preserve_case", "suggest_only", "context_layer",
}
YES_NO_MAP = {"Y": True, "N": False, "y": True, "n": False, "Yes": True, "No": False}

# Common_Spellings validity values.
COMMON_VALIDITY_VALID = {"valid", "nonstandard", "regional_only"}

# Protected_Terms match_type values.
PROTECTED_MATCH_TYPE_VALID = {"exact_phrase", "word", "regex"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _row_iter(ws, header_row: int = 1):
    """Yield (row_number, dict-keyed-by-header), skipping fully-empty rows."""
    row_stream = ws.iter_rows(values_only=True)
    headers: list[Any] = []
    for idx, values in enumerate(row_stream, start=1):
        if idx < header_row:
            continue
        if idx == header_row:
            headers = list(values)
            continue
        if all(v is None or v == "" for v in values):
            continue
        yield idx, dict(zip(headers, values))


def _strip(cell: Any) -> str | None:
    if cell is None:
        return None
    s = str(cell).strip()
    return s if s else None


def _require(value: Any, *, origin: str) -> str:
    s = _strip(value)
    if not s:
        raise ValueError(f"{origin}: required field is empty")
    return s


def _enum(value: Any, allowed: set[str], *, origin: str, default: str | None = None) -> str | None:
    s = _strip(value)
    if s is None:
        return default
    if s not in allowed:
        raise ValueError(f"{origin}: unknown value {s!r}; allowed {sorted(allowed)}")
    return s


def _bool(value: Any, *, origin: str, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    s = str(value).strip()
    if s not in YES_NO_MAP:
        raise ValueError(f"{origin}: expected Y/N; got {s!r}")
    return YES_NO_MAP[s]


def _lockfile_present(workbook: Path) -> bool:
    return (workbook.parent / f"~${workbook.name}").exists()


def _split_alternatives(cell: Any) -> list[str]:
    """``us_alternatives`` / ``uk_alternatives`` are a free-text column.
    Split on comma / semicolon / slash and trim; empty → []. Preserves
    the editor's spelling verbatim (no case change).
    """
    s = _strip(cell)
    if not s:
        return []
    parts: list[str] = []
    for raw in s.replace(";", ",").replace("/", ",").split(","):
        t = raw.strip()
        if t:
            parts.append(t)
    return parts


# ---------------------------------------------------------------------------
# Converters
# ---------------------------------------------------------------------------

def convert_variants(ws, entry_rules_by_id: dict[str, dict]) -> list[dict]:
    """US_UK_Spelling_Variants → list of dicts, one per variant pair.

    Entry_Rules metadata is folded in so the runtime has everything about
    a single variant in one dict (no cross-join at analyze time).
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _require(row.get("entry_id"), origin=f"US_UK_Spelling_Variants row {r} entry_id")
        if rid in seen_ids:
            raise ValueError(f"US_UK_Spelling_Variants row {r}: duplicate entry_id {rid!r}")
        seen_ids.add(rid)

        us = _require(row.get("us_spelling"), origin=f"US_UK_Spelling_Variants row {r} ({rid}) us_spelling")
        uk = _require(row.get("uk_spelling"), origin=f"US_UK_Spelling_Variants row {r} ({rid}) uk_spelling")
        if us.lower() == uk.lower():
            # If spellings match (case-insensitive) there's nothing to flag.
            # Skip rather than fail so a workbook editor can safely leave such rows.
            continue

        rule = entry_rules_by_id.get(rid) or {}

        out.append({
            "entry_id": rid,
            "us_spelling": us,
            "uk_spelling": uk,
            "us_alternatives": _split_alternatives(row.get("us_alternatives")),
            "uk_alternatives": _split_alternatives(row.get("uk_alternatives")),
            "base_word": _strip(row.get("base_word")),
            "part_of_speech": _strip(row.get("part_of_speech")),
            "word_family": _strip(row.get("word_family")),
            "spelling_pattern": _strip(row.get("spelling_pattern")),
            "variant_type": _enum(
                row.get("variant_type"), VARIANT_TYPE_VALID,
                origin=f"US_UK_Spelling_Variants row {r} ({rid}) variant_type",
                default="regional_spelling",
            ),
            "us_preference": _enum(
                row.get("us_preference"), PREFERENCE_VALID,
                origin=f"US_UK_Spelling_Variants row {r} ({rid}) us_preference",
                default="preferred",
            ),
            "uk_preference": _enum(
                row.get("uk_preference"), PREFERENCE_VALID,
                origin=f"US_UK_Spelling_Variants row {r} ({rid}) uk_preference",
                default="preferred",
            ),
            "semantic_equivalence": _strip(row.get("semantic_equivalence")),
            "usage_context": _strip(row.get("usage_context")),
            "regional_scope": _strip(row.get("regional_scope")),
            "formality_level": _enum(
                row.get("formality_level"), FORMALITY_VALID,
                origin=f"US_UK_Spelling_Variants row {r} ({rid}) formality_level",
                default="neutral",
            ),
            "style_guide_notes": _strip(row.get("style_guide_notes")),
            "exceptions_notes": _strip(row.get("exceptions_notes")),
            "validation_status": _enum(
                row.get("validation_status"), VALIDATION_STATUS_VALID,
                origin=f"US_UK_Spelling_Variants row {r} ({rid}) validation_status",
                default="needs_review",
            ),
            "source_dictionary": _strip(row.get("source_dictionary")),
            "source_reference": _strip(row.get("source_reference")),
            "record_version": _strip(row.get("record_version")),
            "review_notes": _strip(row.get("review_notes")),
            # Folded-in Entry_Rules columns:
            "uk_doc_rule_id": rule.get("uk_doc_rule_id"),
            "uk_doc_action": rule.get("uk_doc_action"),
            "uk_doc_severity": rule.get("uk_doc_severity"),
            "uk_doc_autocorrect_safe": rule.get("uk_doc_autocorrect_safe"),
            "us_doc_rule_id": rule.get("us_doc_rule_id"),
            "us_doc_action": rule.get("us_doc_action"),
            "us_doc_severity": rule.get("us_doc_severity"),
            "us_doc_autocorrect_safe": rule.get("us_doc_autocorrect_safe"),
            "requires_context": rule.get("requires_context", False),
            "replacement_strategy": rule.get("replacement_strategy"),
            "us_form_in_en_gb_dictionary": rule.get("us_form_in_en_gb_dictionary"),
            "uk_form_in_en_us_dictionary": rule.get("uk_form_in_en_us_dictionary"),
        })
    return out


def load_entry_rules(ws) -> dict[str, dict]:
    """Entry_Rules → dict keyed by entry_id. One row per variant."""
    out: dict[str, dict] = {}
    for r, row in _row_iter(ws):
        rid = _require(row.get("entry_id"), origin=f"Entry_Rules row {r} entry_id")
        if rid in out:
            raise ValueError(f"Entry_Rules row {r}: duplicate entry_id {rid!r}")
        out[rid] = {
            "uk_doc_rule_id": _strip(row.get("uk_doc_rule_id")),
            "uk_doc_action": _strip(row.get("uk_doc_action")),
            "uk_doc_severity": _strip(row.get("uk_doc_severity")),
            "uk_doc_autocorrect_safe": _bool(
                row.get("uk_doc_autocorrect_safe"),
                origin=f"Entry_Rules row {r} ({rid}) uk_doc_autocorrect_safe",
            ),
            "us_doc_rule_id": _strip(row.get("us_doc_rule_id")),
            "us_doc_action": _strip(row.get("us_doc_action")),
            "us_doc_severity": _strip(row.get("us_doc_severity")),
            "us_doc_autocorrect_safe": _bool(
                row.get("us_doc_autocorrect_safe"),
                origin=f"Entry_Rules row {r} ({rid}) us_doc_autocorrect_safe",
            ),
            "requires_context": _bool(
                row.get("requires_context"),
                origin=f"Entry_Rules row {r} ({rid}) requires_context",
            ),
            "replacement_strategy": _enum(
                row.get("replacement_strategy"), REPLACEMENT_STRATEGY_VALID,
                origin=f"Entry_Rules row {r} ({rid}) replacement_strategy",
                default="whole_word_preserve_case",
            ),
            "us_form_in_en_gb_dictionary": _bool(
                row.get("us_form_in_en_gb_dictionary"),
                origin=f"Entry_Rules row {r} ({rid}) us_form_in_en_gb_dictionary",
            ),
            "uk_form_in_en_us_dictionary": _bool(
                row.get("uk_form_in_en_us_dictionary"),
                origin=f"Entry_Rules row {r} ({rid}) uk_form_in_en_us_dictionary",
            ),
        }
    return out


def convert_common(ws) -> list[dict]:
    """Common_Spellings → list of dicts. 552 both-valid words."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _require(row.get("entry_id"), origin=f"Common_Spellings row {r} entry_id")
        if rid in seen_ids:
            raise ValueError(f"Common_Spellings row {r}: duplicate entry_id {rid!r}")
        seen_ids.add(rid)
        spelling = _require(row.get("spelling"), origin=f"Common_Spellings row {r} ({rid}) spelling")
        out.append({
            "entry_id": rid,
            "spelling": spelling,
            "part_of_speech": _strip(row.get("part_of_speech")),
            "word_family": _strip(row.get("word_family")),
            "usage_domain": _strip(row.get("usage_domain")),
            "us_validity": _enum(
                row.get("us_validity"), COMMON_VALIDITY_VALID,
                origin=f"Common_Spellings row {r} ({rid}) us_validity",
                default="valid",
            ),
            "uk_validity": _enum(
                row.get("uk_validity"), COMMON_VALIDITY_VALID,
                origin=f"Common_Spellings row {r} ({rid}) uk_validity",
                default="valid",
            ),
            "semantic_scope": _strip(row.get("semantic_scope")),
            "context_notes": _strip(row.get("context_notes")),
            "homograph_flag": _strip(row.get("homograph_flag")),
            "regional_usage_notes": _strip(row.get("regional_usage_notes")),
            "validation_status": _enum(
                row.get("validation_status"), VALIDATION_STATUS_VALID,
                origin=f"Common_Spellings row {r} ({rid}) validation_status",
                default="needs_review",
            ),
            "source_dictionary": _strip(row.get("source_dictionary")),
        })
    return out


def convert_variant_notes(ws) -> list[dict]:
    """Variant_Notes → list of dicts. ~23 pattern definitions (IZE_ISE, etc.)."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        pid = _require(row.get("pattern_id"), origin=f"Variant_Notes row {r} pattern_id")
        if pid in seen_ids:
            raise ValueError(f"Variant_Notes row {r}: duplicate pattern_id {pid!r}")
        seen_ids.add(pid)
        out.append({
            "pattern_id": pid,
            "pattern_code": _strip(row.get("pattern_code")),
            "pattern_name": _strip(row.get("pattern_name")),
            "pattern_description": _strip(row.get("pattern_description")),
            "us_rule": _strip(row.get("us_rule")),
            "uk_rule": _strip(row.get("uk_rule")),
            "examples": _strip(row.get("examples")),
            "exceptions": _strip(row.get("exceptions")),
            "known_ambiguities": _strip(row.get("known_ambiguities")),
            "recommended_validation_behavior": _strip(row.get("recommended_validation_behavior")),
            "source_reference": _strip(row.get("source_reference")),
            "validation_status": _strip(row.get("validation_status")),
        })
    return out


def convert_protected(ws) -> list[dict]:
    """Protected_Terms → list of dicts. ~28 phrases that must not be flagged.

    Preserves ``match_type`` (exact_phrase) and ``case_sensitive`` (Y/N)
    verbatim so the runtime can honour them without re-deriving.
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        tid = _require(row.get("term_id"), origin=f"Protected_Terms row {r} term_id")
        if tid in seen_ids:
            raise ValueError(f"Protected_Terms row {r}: duplicate term_id {tid!r}")
        seen_ids.add(tid)
        term = _require(row.get("term"), origin=f"Protected_Terms row {r} ({tid}) term")
        out.append({
            "term_id": tid,
            "term": term,
            "match_type": _enum(
                row.get("match_type"), PROTECTED_MATCH_TYPE_VALID,
                origin=f"Protected_Terms row {r} ({tid}) match_type",
                default="exact_phrase",
            ),
            "case_sensitive": _bool(
                row.get("case_sensitive"),
                origin=f"Protected_Terms row {r} ({tid}) case_sensitive",
                default=True,
            ),
            "spelling_involved": _strip(row.get("spelling_involved")),
            "reason": _strip(row.get("reason")),
            "validation_status": _enum(
                row.get("validation_status"), VALIDATION_STATUS_VALID,
                origin=f"Protected_Terms row {r} ({tid}) validation_status",
                default="needs_review",
            ),
        })
    return out


def convert_rule_table(ws) -> list[dict]:
    """Rule_Table → list of dicts. ~10 rule definitions."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _require(row.get("rule_id"), origin=f"Rule_Table row {r} rule_id")
        if rid in seen_ids:
            raise ValueError(f"Rule_Table row {r}: duplicate rule_id {rid!r}")
        seen_ids.add(rid)
        out.append({
            "rule_id": rid,
            "rule_name": _strip(row.get("rule_name")),
            "applies_when": _strip(row.get("applies_when")),
            "severity": _strip(row.get("severity")),
            "action": _strip(row.get("action")),
            "autocorrect_safe": _strip(row.get("autocorrect_safe")),
            "requires_context": _strip(row.get("requires_context")),
            "replacement_strategy": _strip(row.get("replacement_strategy")),
            "config_dependency": _strip(row.get("config_dependency")),
            "message_template": _strip(row.get("message_template")),
            "notes": _strip(row.get("notes")),
        })
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-w", "--workbook", type=Path, default=DEFAULT_WORKBOOK,
                        help=f"Path to the xlsx (default: {DEFAULT_WORKBOOK})")
    args = parser.parse_args()

    workbook: Path = args.workbook
    if not workbook.exists():
        sys.stderr.write(f"Workbook not found: {workbook}\n")
        return 1
    if _lockfile_present(workbook):
        sys.stderr.write(
            f"Excel appears to be open ({workbook.parent}/~${workbook.name}). "
            "Close it and re-run.\n"
        )
        return 1

    print(f"Loading {workbook} ...")
    wb = openpyxl.load_workbook(workbook, data_only=True, read_only=True)
    expected = {
        "US_UK_Spelling_Variants", "Common_Spellings", "Variant_Notes",
        "Entry_Rules", "Protected_Terms", "Rule_Table",
    }
    missing = expected - set(wb.sheetnames)
    if missing:
        sys.stderr.write(f"Workbook is missing sheets: {sorted(missing)}\n")
        return 1

    sha = _sha256_of_file(workbook)
    meta = {
        "source_workbook": workbook.name,
        "source_sha256": sha,
        "origin": "Ninja Inkflow CE US and UK Spelling Database",
    }

    print("Loading Entry_Rules ...")
    entry_rules = load_entry_rules(wb["Entry_Rules"])
    print(f"  {len(entry_rules)} rows")

    print("Converting US_UK_Spelling_Variants (with Entry_Rules fold) ...")
    variants = convert_variants(wb["US_UK_Spelling_Variants"], entry_rules)
    print(f"  {len(variants)} rows")

    print("Converting Common_Spellings ...")
    common = convert_common(wb["Common_Spellings"])
    print(f"  {len(common)} rows")

    print("Converting Variant_Notes ...")
    patterns = convert_variant_notes(wb["Variant_Notes"])
    print(f"  {len(patterns)} rows")

    print("Converting Protected_Terms ...")
    protected = convert_protected(wb["Protected_Terms"])
    print(f"  {len(protected)} rows")

    print("Converting Rule_Table ...")
    rules = convert_rule_table(wb["Rule_Table"])
    print(f"  {len(rules)} rows")

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    WORKBOOKS_DIR.mkdir(parents=True, exist_ok=True)

    def _write(path: Path, payload) -> None:
        wrapped = {"_meta": meta, "entries": payload}
        path.write_text(
            json.dumps(wrapped, ensure_ascii=False, indent=2, sort_keys=False),
            encoding="utf-8",
        )
        print(f"  wrote {path.relative_to(REPO_ROOT)}")

    _write(OUT_VARIANTS, variants)
    _write(OUT_COMMON, common)
    _write(OUT_PATTERNS, patterns)
    _write(OUT_PROTECTED, protected)
    _write(OUT_RULES, rules)

    dest = WORKBOOKS_DIR / workbook.name
    shutil.copy2(workbook, dest)
    print(f"  copied workbook → {dest.relative_to(REPO_ROOT)}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
