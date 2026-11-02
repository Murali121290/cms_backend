"""Convert the Hyphen & En-Dash workbook into committed JSON config files.

The Excel workbook is the editorial source of truth. The runtime loads the
emitted JSON files; the engine never opens xlsx on the hot path. Keep the
output deterministic — downstream diffs on PRs are the review surface for
rule changes.

Inputs
------
Default: ~/Downloads/Hyphen_and_EnDash_Rules_for_CE_Tool.xlsx
Override with --workbook / -w.

Outputs (relative to repo root)
-------------------------------
app/processing/language_editing/config/profiles/hyphen_dash_rules.json
app/processing/language_editing/config/profiles/hyphen_dash_terms.json
app/processing/language_editing/config/profiles/hyphen_dash_protected.json
tests/data/hyphen_dash_tests.json

Each JSON carries a `_meta` header with the source workbook sha256 so a CI
check can fail when the committed JSON drifts from the on-disk workbook.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
DEFAULT_WORKBOOK = Path.home() / "Downloads" / "Hyphen_and_EnDash_Rules_for_CE_Tool.xlsx"

OUT_RULES = REPO_ROOT / "app/processing/language_editing/config/profiles/hyphen_dash_rules.json"
OUT_TERMS = REPO_ROOT / "app/processing/language_editing/config/profiles/hyphen_dash_terms.json"
OUT_PROTECTED = REPO_ROOT / "app/processing/language_editing/config/profiles/hyphen_dash_protected.json"
OUT_TESTS = REPO_ROOT / "tests/data/hyphen_dash_tests.json"


# Workbook enums → engine-facing lowercased slugs. Keeping the mapping in one
# place prevents a stray spelling in the Excel from silently falling through
# to the engine (we raise on unknowns instead).
PROFILE_SLUGS = {
    "All": "all",
    "MW dictionary": "mw_dictionary",
    "Chicago-AMA-APA": "chicago_ama_apa",
    "Both": "both",
    # Test_Cases uses a few extra tags; keep them as-is for the harness.
    "US (MW and Chicago)": "us_mw_and_chicago",
    "Optional: typographic minus": "optional_typographic_minus",
}

TOOL_BEHAVIOUR_SLUGS = {
    "Auto-replace": "auto_replace",
    "Flag and suggest": "flag_and_suggest",
    "Flag only (review)": "flag_only",
}

MATCH_TYPE_SLUGS = {
    "Whole word": "whole_word",
    "Phrase": "phrase",
}


# Pre-translation: Dash_Rules ships $1/$2 backrefs (JS/PCRE); Python re.expand
# needs \1/\2. Preserve `$$` literal dollar if ever present.
_BACKREF_RE = re.compile(r"\$(\d)")


def _translate_backrefs(repl: str | None) -> str | None:
    if repl is None:
        return None
    # Escape existing backslashes first so we don't double-escape literal \1
    # (none in the current workbook, but defensive).
    return _BACKREF_RE.sub(r"\\\1", repl)


def _parse_flags(cell: Any) -> list[str]:
    """Workbook Flags column: 'i' | 'im' | None. Expand into the names
    `rules.load_rules_from_dict` already recognises (`IGNORECASE`, `MULTILINE`,
    `DOTALL`, `VERBOSE`)."""
    if not cell:
        return []
    s = str(cell).strip().lower()
    out: list[str] = []
    for ch in s:
        if ch == "i":
            out.append("IGNORECASE")
        elif ch == "m":
            out.append("MULTILINE")
        elif ch == "s":
            out.append("DOTALL")
        elif ch == "x":
            out.append("VERBOSE")
        else:
            raise ValueError(f"Unknown regex flag character: {ch!r} in {cell!r}")
    return out


def _slug(table: dict[str, str], value: Any, *, allow_blank: bool = False) -> str | None:
    if value is None or value == "":
        if allow_blank:
            return None
        raise ValueError("Empty cell where a value was required")
    key = str(value).strip()
    if key not in table:
        raise ValueError(f"Unrecognised enum value: {key!r} (expected one of {list(table)})")
    return table[key]


def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _row_iter(ws, header_row: int = 1):
    """Yield (row_number, dict-keyed-by-header), skipping fully-empty rows.

    Uses `iter_rows(values_only=True)` which streams the sheet XML once —
    `ws.cell(r, c)` on a read-only sheet re-parses from scratch per call,
    making an 840-row sheet take minutes instead of seconds.
    """
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


def _validate_regex(pattern: str, *, origin: str) -> None:
    """Compile each regex at import time so a bad row fails the build loudly
    instead of crashing the engine at analyze time. Catastrophic-backtracking
    detection is out of scope — the input is editorial, not adversarial."""
    try:
        re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"Invalid regex in {origin}: {exc} — pattern={pattern!r}")


def _lockfile_present(workbook: Path) -> bool:
    """Excel writes `~$<name>` while a file is open. Importing from a half-
    written xlsx would corrupt the JSON silently."""
    return (workbook.parent / f"~${workbook.name}").exists()


# ---------------------------------------------------------------------------
# Sheet converters
# ---------------------------------------------------------------------------

def convert_dash_rules(ws) -> list[dict]:
    """Dash_Rules sheet → list of regex-rule dicts compatible with
    `rules.load_rules_from_dict`, plus workbook-specific metadata preserved
    for the Phase 2 engine (priority, tool behaviour, style profile,
    alt suggestion)."""
    out = []
    for r, row in _row_iter(ws):
        rid = row["Rule ID"]
        if not rid:
            continue
        pattern = row["Find (regex)"]
        if not pattern:
            raise ValueError(f"Dash_Rules row {r}: missing Find (regex)")
        _validate_regex(pattern, origin=f"Dash_Rules row {r} id={rid}")

        suggestion_1 = _translate_backrefs(row["Suggestion 1 (replacement)"])
        suggestion_2 = _translate_backrefs(row["Suggestion 2"])
        alt_suggestions = [s for s in (suggestion_2,) if s]

        priority_raw = row["Priority"]
        try:
            priority = int(priority_raw) if priority_raw is not None else 100
        except (TypeError, ValueError):
            raise ValueError(f"Dash_Rules row {r}: non-integer Priority {priority_raw!r}")

        action = row["Action"]
        # Dash_Rules "Action" is the same decision axis as Detect_List's
        # "Tool behaviour" but uses a slightly different vocabulary. Map
        # explicitly so an unknown value fails the import loudly instead
        # of silently defaulting.
        action_map = {
            "Auto-fix":         ("auto_replace",     "suggestion", True),
            "Flag and suggest": ("flag_and_suggest", "warning",    True),
            "Flag only":        ("flag_only",        "warning",    False),
        }
        if action in action_map:
            tool_behaviour, severity, autofixable = action_map[action]
        elif action is None or action == "":
            tool_behaviour, severity, autofixable = "flag_and_suggest", "warning", True
        else:
            raise ValueError(f"Dash_Rules row {r}: unknown Action {action!r}")

        out.append({
            "id": rid,
            "category": "hyphenation",
            "type": "regex",
            "pattern": pattern,
            "replacement": suggestion_1,
            "alt_suggestions": alt_suggestions,
            "flags": _parse_flags(row["Flags"]),
            "priority": priority,
            "tool_behaviour": tool_behaviour,
            "severity": severity,
            "autofixable": autofixable,
            "message": f"{row['Group']}: {row['Name']}" if row.get("Name") else row["Problem"] or "",
            "problem": row["Problem"] or "",
            "group": row["Group"] or "",
            "style_profile": _slug(PROFILE_SLUGS, row["Style profile"] or "All"),
            "example_wrong": row["Example wrong"] or "",
            "example_right": row["Example right"] or "",
            "must_not_be_flagged": row["Must NOT be flagged"] or "",
            "confidence": row["Confidence"] or "",
            "notes": row["Notes and exceptions"] or "",
            "enabled": True,
        })
    return out


def convert_detect_list(ws) -> list[dict]:
    """Detect_List sheet → phrase-lookup entries."""
    out = []
    for r, row in _row_iter(ws):
        rid = row["ID"]
        src = row["Source term (detect)"]
        if not rid or not src:
            continue
        suggestions = []
        for key in ("Suggestion 1", "Suggestion 2", "Suggestion 3"):
            v = row.get(key)
            if v is not None and v != "":
                suggestions.append(str(v))
        if not suggestions:
            # A row with no suggestion is a flag-only entry — honour it, but
            # keep the slot so Phase 2 can emit a review-only finding.
            pass

        skip_prev = row["Skip when the previous word matches (regex)"]
        if skip_prev:
            _validate_regex(str(skip_prev), origin=f"Detect_List row {r} id={rid}")

        require_follow_raw = row["Require a following word"]
        if require_follow_raw in (None, "", "No"):
            require_following_word = False
        elif str(require_follow_raw).strip().lower() == "yes":
            require_following_word = True
        else:
            raise ValueError(
                f"Detect_List row {r}: unexpected 'Require a following word' value {require_follow_raw!r}"
            )

        match_case_raw = row["Match case"]
        if match_case_raw in (None, "", "No"):
            match_case = False
        elif str(match_case_raw).strip().lower() == "yes":
            match_case = True
        else:
            raise ValueError(
                f"Detect_List row {r}: unexpected 'Match case' value {match_case_raw!r}"
            )

        out.append({
            "id": rid,
            "source": str(src),
            "suggestions": suggestions,
            "problem_type": row["Problem type"] or "",
            "tool_behaviour": _slug(TOOL_BEHAVIOUR_SLUGS, row["Tool behaviour"]),
            "match_type": _slug(MATCH_TYPE_SLUGS, row["Match type"]),
            "match_case": match_case,
            "style_profile": _slug(PROFILE_SLUGS, row["Style profile"]),
            "context_note": row["Context note"] or "",
            "skip_prev_regex": str(skip_prev) if skip_prev else None,
            "require_following_word": require_following_word,
            "confidence": row["Confidence"] or "",
            "origin": row["Origin"] or "",
        })
    return out


def convert_en_dash_terms(ws) -> list[dict]:
    """En_Dash_Terms sheet → phrase-lookup entries, profile-tagged.

    Each row carries BOTH the en-dash and hyphen surface forms plus the
    correct form under each style profile; the detection layer decides at
    runtime which surface to flag given the project's active profile.
    """
    out = []
    for r, row in _row_iter(ws):
        en_form = row["Form with en dash"]
        hy_form = row["Form with hyphen"]
        if not en_form and not hy_form:
            continue
        out.append({
            "category": row["Category"] or "",
            "form_en_dash": str(en_form) if en_form else None,
            "form_hyphen": str(hy_form) if hy_form else None,
            "correct_mw_dictionary": row["Correct under the MW dictionary profile"] or "",
            "correct_chicago_ama_apa": row["Correct under the Chicago-AMA-APA profile"] or "",
            "confidence": row["Confidence"] or "",
            "note": row["Note"] or "",
            # 'All' | 'Both' | 'Chicago-AMA-APA'
            "detect_list_profile": _slug(PROFILE_SLUGS, row["Detect_List profile"] or "All"),
        })
    return out


def convert_hyphen_compounds(ws) -> list[dict]:
    """Hyphen_Compounds sheet → reference list of correct hyphenated forms.

    Not a detection input on its own — carried in the terms JSON so the
    engine (and the MC_COMPOUNDS subtraction) can tell which forms are
    workbook-covered."""
    out = []
    for r, row in _row_iter(ws):
        correct = row["Correct form"]
        if not correct:
            continue
        out.append({
            "correct_form": str(correct),
            "usage_type": row["Usage type"] or "",
            "where": row["Where the hyphen applies"] or "",
            "basis": row["Basis"] or "",
            "confidence": row["Confidence"] or "",
            "mw_lookup": row["MW lookup"] or "",
            "origin": row["Origin"] or "",
        })
    return out


def convert_protected_terms(ws) -> dict[str, list[dict]]:
    """Protected_Terms sheet → split by Kind (literal vs regex).

    Literals go into the engine's whitelist. Patterns compile to a span mask
    (same shape as `filter_markup_tag_findings`). Each regex is pre-compiled
    here to fail loudly on syntax errors.
    """
    literals: list[dict] = []
    patterns: list[dict] = []
    for r, row in _row_iter(ws):
        rid = row["ID"]
        kind = row["Kind"]
        term = row["Term or pattern"]
        if not rid or not kind or term is None or term == "":
            continue
        base = {
            "id": rid,
            "term_or_pattern": str(term),
            "type": row["Type"] or "",
            "style_profile": _slug(PROFILE_SLUGS, row["Style profile"] or "All"),
            "note": row["Note"] or "",
            "origin": row["Origin"] or "",
        }
        if kind == "Term":
            literals.append(base)
        elif kind == "Pattern (regex)":
            _validate_regex(str(term), origin=f"Protected_Terms row {r} id={rid}")
            patterns.append(base)
        else:
            raise ValueError(f"Protected_Terms row {r}: unknown Kind {kind!r}")
    return {"literals": literals, "patterns": patterns}


def convert_test_cases(ws) -> list[dict]:
    """Test_Cases sheet → regression harness input."""
    out = []
    for r, row in _row_iter(ws):
        tid = row["Test ID"]
        if not tid:
            continue
        test_type = row["Test type"]
        if test_type not in ("Should change", "Must not flag", "Integrated paragraph"):
            raise ValueError(f"Test_Cases row {r}: unknown Test type {test_type!r}")
        out.append({
            "id": tid,
            "source": row["Source (rule or list)"] or "",
            "test_type": test_type,
            "input": row["Input text"] or "",
            "expected": row["Expected output"] or "",
            "style_profile": _slug(PROFILE_SLUGS, row["Style profile"] or "All"),
            "notes": row["Notes"] or "",
        })
    return out


def convert_character_map(ws) -> list[dict]:
    """Character_Map sheet → character-handling guidance (reference only)."""
    out = []
    for r, row in _row_iter(ws):
        ch = row["Character"]
        if ch is None:
            continue
        out.append({
            "character": ch,
            "name": row["Name"] or "",
            "code_point": row["Code point"] or "",
            "use": row["Use"] or "",
            "rule_for_tool": row["Rule for the tool"] or "",
            "regex_class": row["Regex class"] or "",
        })
    return out


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def _dump(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii=False keeps the en-dash and em-dash readable in diffs;
    # sort_keys=True gives a stable byte-level output across runs.
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "-w", "--workbook",
        type=Path, default=DEFAULT_WORKBOOK,
        help=f"Path to the xlsx (default: {DEFAULT_WORKBOOK})",
    )
    ap.add_argument(
        "--check-only", action="store_true",
        help="Load + validate the workbook; do not write any JSON.",
    )
    args = ap.parse_args()

    wb_path: Path = args.workbook.expanduser()
    if not wb_path.is_file():
        sys.stderr.write(f"workbook not found: {wb_path}\n")
        return 2
    if _lockfile_present(wb_path):
        sys.stderr.write(
            f"Excel lockfile present (~${wb_path.name}). Close the workbook before importing.\n"
        )
        return 2

    sha = _sha256_of_file(wb_path)
    print(f"workbook: {wb_path}")
    print(f"sha256:   {sha}")

    wb = openpyxl.load_workbook(wb_path, read_only=True, data_only=True)
    expected_sheets = {
        "Detect_List", "Hyphen_Compounds", "En_Dash_Terms", "Dash_Rules",
        "Protected_Terms", "Test_Cases", "Character_Map",
    }
    missing = expected_sheets - set(wb.sheetnames)
    if missing:
        sys.stderr.write(f"workbook is missing sheets: {sorted(missing)}\n")
        return 2

    dash_rules = convert_dash_rules(wb["Dash_Rules"])
    character_map = convert_character_map(wb["Character_Map"])
    detect_list = convert_detect_list(wb["Detect_List"])
    en_dash_terms = convert_en_dash_terms(wb["En_Dash_Terms"])
    hyphen_compounds = convert_hyphen_compounds(wb["Hyphen_Compounds"])
    protected = convert_protected_terms(wb["Protected_Terms"])
    tests = convert_test_cases(wb["Test_Cases"])

    print()
    print(f"  Dash_Rules:       {len(dash_rules)} rules")
    print(f"  Detect_List:      {len(detect_list)} phrases")
    print(f"  En_Dash_Terms:    {len(en_dash_terms)} entries")
    print(f"  Hyphen_Compounds: {len(hyphen_compounds)} forms")
    print(f"  Protected (lit):  {len(protected['literals'])}")
    print(f"  Protected (regex):{len(protected['patterns'])}")
    print(f"  Test_Cases:       {len(tests)}")
    print(f"  Character_Map:    {len(character_map)}")

    if args.check_only:
        print("\n--check-only: no files written")
        return 0

    meta = {
        "source_file": wb_path.name,
        "source_sha256": sha,
        "generated_by": "scripts/import_hyphen_dash_workbook.py",
    }

    _dump({
        "_meta": meta,
        "rules": dash_rules,
        "character_map": character_map,
    }, OUT_RULES)

    _dump({
        "_meta": meta,
        "detect_list": detect_list,
        "en_dash_terms": en_dash_terms,
        "hyphen_compounds": hyphen_compounds,
    }, OUT_TERMS)

    _dump({
        "_meta": meta,
        "literals": protected["literals"],
        "patterns": protected["patterns"],
    }, OUT_PROTECTED)

    _dump({
        "_meta": meta,
        "test_cases": tests,
    }, OUT_TESTS)

    print()
    print("wrote:")
    for p in (OUT_RULES, OUT_TERMS, OUT_PROTECTED, OUT_TESTS):
        print(f"  {p.relative_to(REPO_ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
