"""Convert the Medical Terminology List workbook into committed JSON.

Mirrors ``scripts/import_hyphen_dash_workbook.py`` and
``scripts/import_abbreviations_workbook.py``: the Excel is the editorial
source of truth; runtime reads the emitted JSON. Keep output deterministic
so PR diffs are the review surface for editorial changes.

Inputs
------
Default: ~/Downloads/Medical_Terminology_List_for_CE_Tool.xlsx
Override with --workbook / -w.

Outputs (relative to repo root)
-------------------------------
app/processing/language_editing/config/profiles/medical_terms_dictionary.json
app/processing/language_editing/config/profiles/medical_terms_detect.json
app/processing/language_editing/config/profiles/medical_terms_patterns.json
app/processing/language_editing/config/profiles/medical_terms_eponyms.json
app/processing/language_editing/config/profiles/medical_terms_confusables.json
app/processing/language_editing/config/workbooks/Medical_Terminology_List_for_CE_Tool.xlsx

Each JSON carries a ``_meta`` header with the source workbook sha256 for a CI
drift check and a human-readable origin label.

Validation
----------
Per the implementation requirements this script:
  * Enforces uniqueness of row IDs within each sheet (``ID`` / ``Rule ID``).
    Duplicates fail the build loudly.
  * Rejects rows missing required fields.
  * Compiles every Spelling_Patterns regex pattern so a bad pattern aborts
    the import rather than crashing the engine at analyze time.
  * Re-prefixes Spelling_Patterns ids as ``MED-SP01`` ... to avoid collision
    with any existing ``SP*`` rules.
  * Prints per-sheet row counts so the operator can confirm against the
    workbook's Summary sheet (1055 / 1003 / 27 / 69 / 18).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
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
DEFAULT_WORKBOOK = Path.home() / "Downloads" / "Medical_Terminology_List_for_CE_Tool.xlsx"

PROFILES_DIR = REPO_ROOT / "app/processing/language_editing/config/profiles"
WORKBOOKS_DIR = REPO_ROOT / "app/processing/language_editing/config/workbooks"

OUT_DICTIONARY = PROFILES_DIR / "medical_terms_dictionary.json"
OUT_DETECT = PROFILES_DIR / "medical_terms_detect.json"
OUT_PATTERNS = PROFILES_DIR / "medical_terms_patterns.json"
OUT_EPONYMS = PROFILES_DIR / "medical_terms_eponyms.json"
OUT_CONFUSABLES = PROFILES_DIR / "medical_terms_confusables.json"


# Workbook enum → engine-facing slug maps. An unexpected value fails loudly
# here rather than silently falling through to runtime.

TOOL_BEHAVIOUR_MAP = {
    "Flag and suggest": "flag",
    "Flag only":        "flag",
    "Auto-replace":     "auto_replace",
    "Auto-fix":         "auto_replace",
}

MATCH_TYPE_SLUGS = {
    "Whole word": "whole_word",
    "Phrase":     "phrase",
}

MATCH_CASE_MAP = {
    "Yes": True,
    "No":  False,
}

# Style profile is a free-text axis for which project-level setting enables
# the rule. ``All`` always fires; the others require the project's
# medical_style_profile setting to match.
STYLE_PROFILE_VALID = {
    "All", "US spelling", "UK spelling", "Possessive", "Nonpossessive",
}

CONFIDENCE_VALID = {"High", "Medium - verify", "Low"}


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


def _lockfile_present(workbook: Path) -> bool:
    return (workbook.parent / f"~${workbook.name}").exists()


# ---------------------------------------------------------------------------
# Converters
# ---------------------------------------------------------------------------

def convert_term_dictionary(ws) -> list[dict]:
    """Term_Dictionary → list of dicts. ~1055 expected rows.

    Feeds the medical spell-check whitelist. We preserve every column so
    future UI can display Type / Subject area / Capitalization / Basis /
    Confidence without a re-import.
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _strip(row.get("ID"))
        if not rid:
            raise ValueError(f"Term_Dictionary row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Term_Dictionary row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        term = _strip(row.get("Term (preferred spelling)"))
        if not term:
            raise ValueError(f"Term_Dictionary row {r} ({rid}): missing preferred term")

        out.append({
            "id": rid,
            "term": term,
            "subject_area": _strip(row.get("Subject area")),
            "type": _strip(row.get("Type")),
            "plural_or_other_form": _strip(row.get("Plural or other form")),
            "capitalization_and_format": _strip(row.get("Capitalization and format")),
            "uk_spelling": _strip(row.get("UK spelling")),
            "basis": _strip(row.get("Basis")),
            "confidence": _strip(row.get("Confidence")),
            "mw_medical_lookup": _strip(row.get("MW Medical lookup")),
            "stedmans_check": _strip(row.get("Stedman's check")),
            "stedmans_form": _strip(row.get("Stedman's form (fill in)")),
            "origin": _strip(row.get("Origin")),
        })
    return out


def convert_detect_list(ws) -> list[dict]:
    """Detect_List → list of dicts. ~1003 expected rows.

    Primary finding source. Every column is preserved. ``match_type``,
    ``match_case``, ``tool_behaviour``, and ``style_profile`` get
    engine-facing slugs so the runtime doesn't need to know workbook spelling.
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _strip(row.get("ID"))
        if not rid:
            raise ValueError(f"Detect_List row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Detect_List row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        source = _strip(row.get("Source term (detect)"))
        if not source:
            raise ValueError(f"Detect_List row {r} ({rid}): missing source term")

        tool_raw = _strip(row.get("Tool behaviour")) or "Flag and suggest"
        if tool_raw not in TOOL_BEHAVIOUR_MAP:
            raise ValueError(
                f"Detect_List row {r} ({rid}): unknown Tool behaviour {tool_raw!r}; "
                f"expected one of {sorted(TOOL_BEHAVIOUR_MAP)}"
            )
        tool_slug = TOOL_BEHAVIOUR_MAP[tool_raw]

        match_type_raw = _strip(row.get("Match type")) or "Whole word"
        if match_type_raw not in MATCH_TYPE_SLUGS:
            raise ValueError(
                f"Detect_List row {r} ({rid}): unknown Match type {match_type_raw!r}; "
                f"expected one of {sorted(MATCH_TYPE_SLUGS)}"
            )
        match_type = MATCH_TYPE_SLUGS[match_type_raw]

        match_case_raw = _strip(row.get("Match case")) or "No"
        if match_case_raw not in MATCH_CASE_MAP:
            raise ValueError(
                f"Detect_List row {r} ({rid}): unknown Match case {match_case_raw!r}; "
                f"expected Yes/No"
            )
        match_case = MATCH_CASE_MAP[match_case_raw]

        style_profile = _strip(row.get("Style profile")) or "All"
        if style_profile not in STYLE_PROFILE_VALID:
            raise ValueError(
                f"Detect_List row {r} ({rid}): unknown Style profile {style_profile!r}; "
                f"expected one of {sorted(STYLE_PROFILE_VALID)}"
            )

        confidence = _strip(row.get("Confidence")) or "High"
        if confidence not in CONFIDENCE_VALID:
            # Don't fail — editorial may add new confidence levels. Just log.
            print(f"  Detect_List row {r} ({rid}): unknown Confidence {confidence!r} — kept as-is", file=sys.stderr)

        suggestions = [
            s for s in (
                _strip(row.get("Suggestion 1")),
                _strip(row.get("Suggestion 2")),
                _strip(row.get("Suggestion 3")),
            ) if s
        ]
        if tool_slug == "flag" and tool_raw == "Flag and suggest" and not suggestions:
            raise ValueError(
                f"Detect_List row {r} ({rid}): Flag and suggest requires at least one suggestion"
            )

        out.append({
            "id": rid,
            "source_term": source,
            "suggestions": suggestions,
            "problem_type": _strip(row.get("Problem type")),
            "tool_behaviour": tool_slug,
            "tool_behaviour_raw": tool_raw,  # keep original for UI display
            "match_type": match_type,
            "match_type_raw": match_type_raw,
            "match_case": match_case,
            "style_profile": style_profile,
            "context_note": _strip(row.get("Context note")),
            "basis": _strip(row.get("Basis")),
            "confidence": confidence,
            "mw_medical_lookup": _strip(row.get("MW Medical lookup")),
            "origin": _strip(row.get("Origin")),
        })
    return out


def convert_spelling_patterns(ws) -> list[dict]:
    """Spelling_Patterns → list of dicts. ~27 expected rows.

    Rule IDs are re-prefixed from ``SP01`` → ``MED-SP01`` to prevent
    collision with any existing SP-prefixed rules in other workbooks.
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        raw_rid = _strip(row.get("Rule ID"))
        if not raw_rid:
            raise ValueError(f"Spelling_Patterns row {r}: missing Rule ID")
        rid = f"MED-{raw_rid}" if not raw_rid.startswith("MED-") else raw_rid
        if rid in seen_ids:
            raise ValueError(f"Spelling_Patterns row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        pattern = _strip(row.get("Find (regex)"))
        if not pattern:
            raise ValueError(f"Spelling_Patterns row {r} ({rid}): missing Find (regex)")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(f"Spelling_Patterns row {r} ({rid}): invalid regex: {exc}")

        action = _strip(row.get("Action")) or "Flag and suggest"
        tool_slug = TOOL_BEHAVIOUR_MAP.get(action)
        if tool_slug is None:
            raise ValueError(
                f"Spelling_Patterns row {r} ({rid}): unknown Action {action!r}"
            )

        style_profile = _strip(row.get("Style profile")) or "All"
        if style_profile not in STYLE_PROFILE_VALID:
            raise ValueError(
                f"Spelling_Patterns row {r} ({rid}): unknown Style profile {style_profile!r}"
            )

        # Workbook stores flags as a string like "i" or "ms"; translate to the
        # Python re flag names the engine's existing loader understands.
        flags_raw = _strip(row.get("Flags")) or ""
        flag_names: list[str] = []
        for ch in flags_raw.lower():
            if ch == "i":
                flag_names.append("IGNORECASE")
            elif ch == "m":
                flag_names.append("MULTILINE")
            elif ch == "s":
                flag_names.append("DOTALL")
            elif ch == "x":
                flag_names.append("VERBOSE")

        # Workbook uses $1 / $2 for backreferences; Python re.sub needs \1 / \2.
        replacement = _strip(row.get("Replacement"))
        if replacement is not None:
            replacement = re.sub(r"\$(\d)", r"\\\1", replacement)

        out.append({
            "id": rid,
            "name": _strip(row.get("Name")),
            "pattern": pattern,
            "replacement": replacement,
            "flags": flag_names,
            "tool_behaviour": tool_slug,
            "action_raw": action,
            "style_profile": style_profile,
            "example_wrong": _strip(row.get("Example wrong")),
            "example_right": _strip(row.get("Example right")),
            "must_not_change": _strip(row.get("Must NOT change")),
            "note": _strip(row.get("Note")),
        })
    return out


def convert_eponym_policy(ws) -> list[dict]:
    """Eponym_Policy → list of dicts. ~69 expected rows.

    Informational — the actual rules fire from Detect_List. We import so a
    Rules Picker tab can show the policy reference.
    """
    out: list[dict] = []
    for r, row in _row_iter(ws):
        poss = _strip(row.get("Possessive form"))
        nonposs = _strip(row.get("Nonpossessive form"))
        if not poss and not nonposs:
            continue
        out.append({
            "possessive_form": poss,
            "nonpossessive_form": nonposs,
            "mw_lists_possessive": _strip(row.get("MW lists the possessive")),
            "default_profile": _strip(row.get("Default profile")),
            "note": _strip(row.get("Note")),
        })
    return out


def convert_confusable_terms(ws) -> list[dict]:
    """Confusable_Terms → list of dicts. ~18 expected rows.

    Each row defines a pair (A, B) with cue-word stems that disambiguate
    which word the author meant. Runtime scans the paragraph: if "A" appears
    but B's cue stems dominate, flag A as probably-should-be-B (and vice
    versa).
    """
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = _strip(row.get("ID"))
        if not rid:
            raise ValueError(f"Confusable_Terms row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Confusable_Terms row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        word_a = _strip(row.get("Word A"))
        word_b = _strip(row.get("Word B"))
        if not word_a or not word_b:
            raise ValueError(f"Confusable_Terms row {r} ({rid}): both words required")

        def _cues(raw: str | None) -> list[str]:
            if not raw:
                return []
            return [p.strip() for p in raw.split(",") if p.strip()]

        tool_raw = _strip(row.get("Tool behaviour")) or "Flag and suggest"
        tool_slug = TOOL_BEHAVIOUR_MAP.get(tool_raw, "flag")

        out.append({
            "id": rid,
            "word_a": word_a,
            "word_b": word_b,
            "cues_a": _cues(row.get("Cue words for A (stems)")),
            "cues_b": _cues(row.get("Cue words for B (stems)")),
            "note": _strip(row.get("Note")),
            "tool_behaviour": tool_slug,
            "tool_behaviour_raw": tool_raw,
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
            f"Excel appears to be open ({workbook.parent}/~${workbook.name}).\n"
            f"Close it and re-run.\n"
        )
        return 1

    print(f"Loading {workbook} ...")
    wb = openpyxl.load_workbook(workbook, data_only=True, read_only=True)
    expected = {
        "Term_Dictionary", "Detect_List", "Spelling_Patterns",
        "Eponym_Policy", "Confusable_Terms",
    }
    missing = expected - set(wb.sheetnames)
    if missing:
        sys.stderr.write(f"Workbook is missing sheets: {sorted(missing)}\n")
        return 1

    sha = _sha256_of_file(workbook)
    meta = {
        "source_workbook": workbook.name,
        "source_sha256": sha,
        "origin": "Medical Terminology List for CE Tool",
    }

    print("Converting Term_Dictionary ...")
    dictionary = convert_term_dictionary(wb["Term_Dictionary"])
    print(f"  {len(dictionary)} rows")

    print("Converting Detect_List ...")
    detect = convert_detect_list(wb["Detect_List"])
    print(f"  {len(detect)} rows")

    print("Converting Spelling_Patterns ...")
    patterns = convert_spelling_patterns(wb["Spelling_Patterns"])
    print(f"  {len(patterns)} rows (ids re-prefixed MED-SP*)")

    print("Converting Eponym_Policy ...")
    eponyms = convert_eponym_policy(wb["Eponym_Policy"])
    print(f"  {len(eponyms)} rows")

    print("Converting Confusable_Terms ...")
    confusables = convert_confusable_terms(wb["Confusable_Terms"])
    print(f"  {len(confusables)} rows")

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    WORKBOOKS_DIR.mkdir(parents=True, exist_ok=True)

    def _write(path: Path, payload) -> None:
        wrapped = {"_meta": meta, "entries": payload}
        path.write_text(
            json.dumps(wrapped, ensure_ascii=False, indent=2, sort_keys=False),
            encoding="utf-8",
        )
        print(f"  wrote {path.relative_to(REPO_ROOT)}")

    _write(OUT_DICTIONARY, dictionary)
    _write(OUT_DETECT, detect)
    _write(OUT_PATTERNS, patterns)
    _write(OUT_EPONYMS, eponyms)
    _write(OUT_CONFUSABLES, confusables)

    # Keep a copy of the workbook alongside the generated JSON so future
    # editors can trace an entry back to its row without a separate file.
    dest = WORKBOOKS_DIR / workbook.name
    shutil.copy2(workbook, dest)
    print(f"  copied workbook → {dest.relative_to(REPO_ROOT)}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
