"""Convert the Abbreviations & First-Use Rules workbook into committed JSON.

Mirrors ``scripts/import_hyphen_dash_workbook.py``: the Excel is the editorial
source of truth; runtime reads the emitted JSON. Keep output deterministic so
PR diffs are the review surface for editorial changes.

Inputs
------
Default: ~/Downloads/Abbreviations_First_Use_Rules_for_CE_Tool.xlsx
Override with --workbook / -w.

Outputs (relative to repo root)
-------------------------------
app/processing/language_editing/config/profiles/abbreviations_list.json
app/processing/language_editing/config/profiles/abbreviations_do_not_use.json
app/processing/language_editing/config/profiles/abbreviations_context_rules.json
app/processing/language_editing/config/profiles/abbreviations_expansion_rules.json
tests/data/abbreviations_tests.json

Each JSON carries a ``_meta`` header with the source workbook sha256 for a CI
drift check.

Validation
----------
Per the implementation requirements this script:
  * Enforces uniqueness of row IDs within each sheet (``ID`` / ``Rule ID`` /
    ``Test ID``). Duplicates fail the build loudly.
  * Rejects rows missing required fields (ID + the one or two columns that
    the runtime depends on — abbreviation / expansion / detect regex / etc.).
  * Compiles every regex pattern (Do_Not_Use.``Detect regex`` and
    Context_Rules.``Cue regex``) so a bad pattern aborts the import rather
    than crashing the engine at analyze time.
  * Prints per-sheet row counts so the operator can confirm against the
    workbook's Summary sheet.
"""
from __future__ import annotations

import argparse
import hashlib
import json
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
DEFAULT_WORKBOOK = Path.home() / "Downloads" / "Abbreviations_First_Use_Rules_for_CE_Tool.xlsx"

OUT_LIST = REPO_ROOT / "app/processing/language_editing/config/profiles/abbreviations_list.json"
OUT_DO_NOT_USE = REPO_ROOT / "app/processing/language_editing/config/profiles/abbreviations_do_not_use.json"
OUT_CONTEXT = REPO_ROOT / "app/processing/language_editing/config/profiles/abbreviations_context_rules.json"
OUT_EXPANSION = REPO_ROOT / "app/processing/language_editing/config/profiles/abbreviations_expansion_rules.json"
OUT_TESTS = REPO_ROOT / "tests/data/abbreviations_tests.json"


# Workbook enum → engine-facing slug maps. Keeping them explicit means a
# stray spelling in the Excel fails loudly here rather than silently going
# through to the runtime.

ABBR_TYPE_SLUGS = {
    "Initialism (said as letters)": "initialism",
    "Acronym (said as a word)":     "acronym",
    "Latin abbreviation":           "latin",
    "Credential or degree":         "credential",
    "Unit symbol":                  "unit_symbol",
    "Shorthand (informal)":         "shorthand",
    "Chemical formula":             "chemical_formula",
}

FIRST_USE_SLUGS = {
    "Expand at first use":              "expand_at_first_use",
    "Expand for general audience only": "expand_for_general_only",
    "No expansion needed":              "no_expansion_needed",
    "Do not abbreviate":                "do_not_abbreviate",
}

AMBIGUITY_SLUGS = {
    "Unique":                                                 "unique",
    "Ambiguous: choose by context (see Context_Rules)":        "ambiguous",
    "Unique here. Another meaning is on Do_Not_Use":           "unique_dnu_sibling",
}

# Do_Not_Use "Tool behaviour" values. Scope-C has only two canonical values
# in the engine (``flag`` | ``auto_replace``). Workbook's ``Flag and suggest``
# and ``Flag only`` both map to ``flag``; ``Auto-fix`` → ``auto_replace``.
DNU_TOOL_BEHAVIOUR_MAP = {
    "Flag and suggest": "flag",
    "Flag only":        "flag",
    "Auto-fix":         "auto_replace",
}

# Expansion_Rules behaviour values are richer; we store the raw string for
# UI display, plus a canonical two-value tool_behaviour for the engine.
EXPANSION_BEHAVIOUR_TOOL = {
    "Flag and suggest":                                "flag",
    "Flag and suggest. Never auto-fix a dose":         "flag",
    "Auto-fix":                                        "auto_replace",
    "Auto-fix when the definition is in the same scope": "auto_replace",
    "Auto-fix when the abbreviation or expansion is changed": "auto_replace",
    "Setting":                                         "flag",
    "No action":                                       "flag",
}

TEST_TYPES = {"Should change", "Must not change", "Should choose"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BACKREF_RE = re.compile(r"\$(\d)")


def _translate_backrefs(repl: str | None) -> str | None:
    if repl is None:
        return None
    return _BACKREF_RE.sub(r"\\\1", repl)


def _slug(table: dict[str, str], value: Any, *, allow_blank: bool = False,
          origin: str = "") -> str | None:
    if value is None or value == "":
        if allow_blank:
            return None
        raise ValueError(f"Empty cell where a value was required ({origin})")
    key = str(value).strip()
    if key not in table:
        raise ValueError(
            f"Unrecognised enum value {key!r} at {origin}; expected one of {list(table)}"
        )
    return table[key]


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


def _validate_regex(pattern: str, *, origin: str) -> None:
    try:
        re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"Invalid regex in {origin}: {exc} — pattern={pattern!r}")


def _lockfile_present(workbook: Path) -> bool:
    return (workbook.parent / f"~${workbook.name}").exists()


def _normalise_bool_yes_no(cell: Any, *, origin: str) -> bool:
    if cell is None or cell == "":
        return False
    s = str(cell).strip().lower()
    if s in ("yes", "true"):
        return True
    if s in ("no", "false", "-"):
        return False
    raise ValueError(f"Expected Yes/No at {origin}; got {cell!r}")


# ---------------------------------------------------------------------------
# Converters
# ---------------------------------------------------------------------------

def convert_abbreviation_list(ws) -> list[dict]:
    """Abbreviation_List → list of dicts. 746 expected rows."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = row.get("ID")
        if not rid:
            raise ValueError(f"Abbreviation_List row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Abbreviation_List row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        abbr = row.get("Abbreviation")
        expansion = row.get("Expansion (preferred)")
        if not abbr or not expansion:
            raise ValueError(
                f"Abbreviation_List row {r} ({rid}): abbreviation + expansion required"
            )

        plural_raw = row.get("Plural of abbreviation")
        plural = None if plural_raw in (None, "", "-") else str(plural_raw).strip()

        article = row.get("Article before the abbreviation")
        if article not in ("a", "an", None, ""):
            raise ValueError(
                f"Abbreviation_List row {r} ({rid}): Article must be 'a' or 'an'; got {article!r}"
            )

        out.append({
            "id": rid,
            "abbreviation": str(abbr).strip(),
            "expansion": str(expansion).strip(),
            "plural_abbreviation": plural,
            "subject_area": (row.get("Subject area") or "").strip(),
            "type": _slug(ABBR_TYPE_SLUGS, row.get("Type"),
                          origin=f"Abbreviation_List row {r} id={rid} Type"),
            "article": article,
            "first_use_rule": _slug(FIRST_USE_SLUGS, row.get("First-use rule"),
                                    origin=f"Abbreviation_List row {r} id={rid} First-use rule"),
            "ambiguity": _slug(AMBIGUITY_SLUGS, row.get("Ambiguity") or "Unique",
                               origin=f"Abbreviation_List row {r} id={rid} Ambiguity"),
            "first_use_form": (row.get("First-use form (formula)") or "").strip() or None,
            "later_use_form": (row.get("Later-use form (formula)") or "").strip() or None,
            "do_not_abbreviate": _normalise_bool_yes_no(
                row.get("Do not abbreviate"),
                origin=f"Abbreviation_List row {r} id={rid} Do not abbreviate",
            ),
            "note": (row.get("Note") or "").strip() or None,
            "confidence": (row.get("Confidence") or "").strip() or None,
            "plural_expansion_override": (
                None if (row.get("Plural expansion override") in (None, "", "None"))
                else str(row.get("Plural expansion override")).strip()
            ),
        })
    return out


def convert_do_not_use(ws) -> list[dict]:
    """Do_Not_Use → regex rules. 32 expected rows."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = row.get("ID")
        if not rid:
            raise ValueError(f"Do_Not_Use row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Do_Not_Use row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        tool_behaviour_raw = row.get("Tool behaviour")
        tool_behaviour = DNU_TOOL_BEHAVIOUR_MAP.get(tool_behaviour_raw)
        if tool_behaviour is None:
            raise ValueError(
                f"Do_Not_Use row {r} ({rid}): unknown Tool behaviour {tool_behaviour_raw!r}; "
                f"expected one of {list(DNU_TOOL_BEHAVIOUR_MAP)}"
            )

        pattern = row.get("Detect regex")
        # Workbook convention: a few ``Flag only`` rows (DN30-DN32 at time of
        # writing) deliberately ship WITHOUT a detect regex — the editorial
        # team wants them visible in the Rules Picker as reference / policy
        # content, but there's no automated detection the workbook authors
        # trusted enough to encode. Allow pattern=None for those rows; the
        # runtime skips them for text matching but the UI still lists them.
        if not pattern:
            if tool_behaviour_raw != "Flag only":
                raise ValueError(
                    f"Do_Not_Use row {r} ({rid}): Detect regex is required for "
                    f"Tool behaviour {tool_behaviour_raw!r}; only 'Flag only' rows "
                    f"may omit the regex"
                )
            pattern = None
        else:
            _validate_regex(pattern, origin=f"Do_Not_Use row {r} id={rid}")

        suggestion_1 = row.get("Write instead (Suggestion 1)")
        suggestion_2 = row.get("Suggestion 2")
        alt_suggestions: list[str] = []
        for s in (suggestion_2,):
            if s and str(s).strip() and str(s).strip().lower() != "none":
                alt_suggestions.append(str(s).strip())

        out.append({
            "id": rid,
            "notation": (row.get("Notation") or "").strip(),
            "intended_meaning": (row.get("Intended meaning") or "").strip(),
            "common_mistake": (row.get("Common mistake") or "").strip(),
            "pattern": pattern,
            "replacement": _translate_backrefs(row.get("Replacement")),
            "suggestion_1": (suggestion_1 or "").strip() or None,
            "alt_suggestions": alt_suggestions,
            "source": (row.get("Source") or "").strip(),
            "applies_in": (row.get("Applies in") or "").strip(),
            "tool_behaviour": tool_behaviour,
            "example_wrong": (row.get("Example wrong") or "").strip(),
            "example_right": (row.get("Example right") or "").strip(),
            "must_not_be_flagged": (row.get("Must NOT be flagged") or "").strip(),
            "confidence": (row.get("Confidence") or "").strip() or None,
            "note": (row.get("Note") or "").strip() or None,
        })
    return out


def convert_context_rules(ws) -> list[dict]:
    """Context_Rules → disambiguation rules. 178 expected rows."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = row.get("ID")
        if not rid:
            raise ValueError(f"Context_Rules row {r}: missing ID")
        if rid in seen_ids:
            raise ValueError(f"Context_Rules row {r}: duplicate ID {rid!r}")
        seen_ids.add(rid)

        abbr = row.get("Abbreviation")
        meaning = row.get("Meaning")
        cue_regex = row.get("Cue regex (built from the cue words)")
        if not abbr or not meaning or not cue_regex:
            raise ValueError(
                f"Context_Rules row {r} ({rid}): abbreviation + meaning + cue regex required"
            )
        _validate_regex(cue_regex, origin=f"Context_Rules row {r} id={rid}")

        cue_words_raw = row.get("Cue words (word stems, case-insensitive)") or ""
        cue_words = [w.strip() for w in str(cue_words_raw).split(",") if w.strip()]

        out.append({
            "id": rid,
            "abbreviation": str(abbr).strip(),
            "meaning": str(meaning).strip(),
            "subject_area": (row.get("Subject area") or "").strip(),
            "cue_words": cue_words,
            "cue_regex": cue_regex,
            "rule_when_no_cue": (row.get("Rule when no cue is found") or "").strip(),
            "note": (row.get("Note") or "").strip() or None,
        })
    return out


def convert_expansion_rules(ws) -> list[dict]:
    """Expansion_Rules → orchestration rule dicts. 17 expected rows."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        rid = row.get("Rule ID")
        if not rid:
            raise ValueError(f"Expansion_Rules row {r}: missing Rule ID")
        if rid in seen_ids:
            raise ValueError(f"Expansion_Rules row {r}: duplicate Rule ID {rid!r}")
        seen_ids.add(rid)

        behaviour_raw = (row.get("Behaviour") or "").strip()
        tool_behaviour = EXPANSION_BEHAVIOUR_TOOL.get(behaviour_raw, "flag")

        out.append({
            "id": rid,
            "name": (row.get("Name") or "").strip(),
            "trigger": (row.get("Trigger") or "").strip(),
            "action": (row.get("What the tool does") or "").strip(),
            "behaviour_raw": behaviour_raw,
            "tool_behaviour": tool_behaviour,
            "run_in_reference_code": (row.get("Run in the reference code") or "").strip(),
            "example_before": (row.get("Example before") or "").strip(),
            "example_after": (row.get("Example after (from the reference code where run)") or "").strip(),
            "exceptions": (row.get("Exceptions") or "").strip() or None,
        })
    return out


def convert_test_cases(ws) -> list[dict]:
    """Test_Cases → 84 case harness input."""
    out: list[dict] = []
    seen_ids: set[str] = set()
    for r, row in _row_iter(ws):
        tid = row.get("Test ID")
        if not tid:
            raise ValueError(f"Test_Cases row {r}: missing Test ID")
        if tid in seen_ids:
            raise ValueError(f"Test_Cases row {r}: duplicate Test ID {tid!r}")
        seen_ids.add(tid)

        ttype = row.get("Type")
        if ttype not in TEST_TYPES:
            raise ValueError(
                f"Test_Cases row {r} ({tid}): unknown Type {ttype!r}; expected one of {TEST_TYPES}"
            )
        out.append({
            "id": tid,
            "area": (row.get("Area") or "").strip(),
            "test_type": ttype,
            "input": row.get("Input") or "",
            "expected": row.get("Expected output") or "",
            "settings": (row.get("Settings") or "").strip() or None,
            "notes": (row.get("Notes") or "").strip() or None,
        })
    return out


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def _dump(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

EXPECTED_COUNTS = {
    "abbreviation_list": 746,
    "do_not_use":        32,
    "context_rules":     178,
    "expansion_rules":   17,
    "test_cases":        84,
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "-w", "--workbook",
        type=Path, default=DEFAULT_WORKBOOK,
        help=f"Path to the xlsx (default: {DEFAULT_WORKBOOK})",
    )
    ap.add_argument(
        "--check-only", action="store_true",
        help="Validate the workbook; do not write any JSON.",
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
        "Abbreviation_List", "Context_Rules", "Do_Not_Use",
        "Expansion_Rules", "Test_Cases",
    }
    missing = expected_sheets - set(wb.sheetnames)
    if missing:
        sys.stderr.write(f"workbook is missing sheets: {sorted(missing)}\n")
        return 2

    abbr_list = convert_abbreviation_list(wb["Abbreviation_List"])
    do_not_use = convert_do_not_use(wb["Do_Not_Use"])
    context_rules = convert_context_rules(wb["Context_Rules"])
    expansion_rules = convert_expansion_rules(wb["Expansion_Rules"])
    tests = convert_test_cases(wb["Test_Cases"])

    # Validate against expected counts — the Summary sheet claims these;
    # a mismatch means the workbook changed shape and the import logic
    # may need to be revisited.
    actuals = {
        "abbreviation_list": len(abbr_list),
        "do_not_use":        len(do_not_use),
        "context_rules":     len(context_rules),
        "expansion_rules":   len(expansion_rules),
        "test_cases":        len(tests),
    }
    print()
    print(f"  Abbreviation_List: {actuals['abbreviation_list']} (expected {EXPECTED_COUNTS['abbreviation_list']})")
    print(f"  Do_Not_Use:        {actuals['do_not_use']} (expected {EXPECTED_COUNTS['do_not_use']})")
    print(f"  Context_Rules:     {actuals['context_rules']} (expected {EXPECTED_COUNTS['context_rules']})")
    print(f"  Expansion_Rules:   {actuals['expansion_rules']} (expected {EXPECTED_COUNTS['expansion_rules']})")
    print(f"  Test_Cases:        {actuals['test_cases']} (expected {EXPECTED_COUNTS['test_cases']})")
    for k, expected in EXPECTED_COUNTS.items():
        if actuals[k] != expected:
            print(f"\n  WARNING: {k} row count drift — got {actuals[k]}, expected {expected}. "
                  "Workbook may have been edited; verify before shipping.")

    if args.check_only:
        print("\n--check-only: no files written")
        return 0

    meta = {
        "source_file": wb_path.name,
        "source_sha256": sha,
        "generated_by": "scripts/import_abbreviations_workbook.py",
    }

    _dump({"_meta": meta, "abbreviations": abbr_list}, OUT_LIST)
    _dump({"_meta": meta, "rules": do_not_use}, OUT_DO_NOT_USE)
    _dump({"_meta": meta, "context_rules": context_rules}, OUT_CONTEXT)
    _dump({"_meta": meta, "expansion_rules": expansion_rules}, OUT_EXPANSION)
    _dump({"_meta": meta, "test_cases": tests}, OUT_TESTS)

    print()
    print("wrote:")
    for p in (OUT_LIST, OUT_DO_NOT_USE, OUT_CONTEXT, OUT_EXPANSION, OUT_TESTS):
        print(f"  {p.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
