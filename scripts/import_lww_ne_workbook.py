"""Convert the LWW-NE language-tool input workbook into committed JSON.

Mirrors the other workbook importers (hyphen_dash, abbreviations,
medical_terms, uk_us_spelling): the Excel is the editorial source of
truth; runtime reads the emitted JSON. Output is deterministic so PR
diffs are the review surface for editorial changes.

Inputs
------
Default: ~/Downloads/LWW_NE_language_tool_input_MW_suggestions_v1.xlsx
Override with --workbook / -w.

Outputs (relative to repo root)
-------------------------------
app/processing/language_editing/config/profiles/lww_ne_terms.json
app/processing/language_editing/config/workbooks/LWW_NE_language_tool_input_MW_suggestions_v1.xlsx

The JSON carries a ``_meta`` header with the source workbook sha256 for
a CI drift check and a human-readable origin label.

Row classification rules (ratified in the Phase-1 plan)
-------------------------------------------------------
Each Tool_Input row maps to exactly ONE of:

  * SKIPPED (not written to active JSON, listed in import log only)
      - All six Rule Run columns empty  → ``skipped_rows``

  * QUARANTINED (written to JSON, inactive at runtime)
      - Action AND Tool behaviour both NULL → status ``quarantined``

  * ANNOTATION-UNCLARIFIED (written, inactive at runtime)
      - Any Rule Run value has a parenthetical annotation like
        ``APA (ignore the hyphen option)`` → status
        ``annotation_unclarified``

  * EDITOR-HINT (written, NOT scanned against manuscript text)
      - Match type == ``Partial word`` → runtime_mode ``editor_hint``
        (surfaces in Rules Picker only; the Phase-2 runtime won't
        walk the paragraph text looking for it)

  * OK (written, eligible for runtime once Phase 2 ships)
      - Everything else → status ``ok``, runtime_mode ``scan``

Generic Rule Run short-circuit
------------------------------
Any OK row whose Rule Runs include ``Generic`` gets ``is_generic=True``;
the Phase-2 runtime will fire it in EVERY project regardless of
profile. Non-Generic rows require profile match (semantics confirmed in
Q1 before Phase 2 can start).

Confidence handling
-------------------
Missing Confidence is written as ``"Unknown"``. Runtime will refuse to
map ``Unknown`` to auto_replace regardless of other flags.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone
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
DEFAULT_WORKBOOK = Path.home() / "Downloads" / "LWW_NE_language_tool_input_MW_suggestions_v1.xlsx"

PROFILES_DIR = REPO_ROOT / "app/processing/language_editing/config/profiles"
WORKBOOKS_DIR = REPO_ROOT / "app/processing/language_editing/config/workbooks"

OUT_TERMS = PROFILES_DIR / "lww_ne_terms.json"


# Workbook enum value sets. An unexpected value fails loudly.
ACTION_VALID = {"Replace", "Retain", "Review", "Format"}
TOOL_BEHAVIOUR_VALID = {
    "Auto-replace",
    "Flag and suggest",
    "Flag and suggest (formatting)",
    "Flag only (review)",
    "No action (protected form)",
}
MATCH_TYPE_VALID = {"Whole word", "Phrase", "Partial word", "Exact text"}
MATCH_CASE_VALID = {"Yes", "No"}
CONFIDENCE_VALID = {"Verified online", "High", "Medium - verify", "Low - verify"}

# Rule Run base values we recognise — the parenthetical annotation is
# kept as separate metadata, not merged into this set.
RULE_RUN_BASE_VALID = {"APA", "AMA", "NE", "Generic", "Eponym"}

# Any Rule Run cell containing a parenthetical suffix is recognised but
# flagged as ``annotation_unclarified`` so Phase-2 runtime skips it.
_RULE_RUN_RE = re.compile(r"^\s*(\w+)\s*(?:\((.+?)\))?\s*$")


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
    """Yield (row_number, dict-keyed-by-header).

    Fully-blank data rows are NOT silently skipped — the importer loop
    detects them explicitly so they can be logged in ``skipped_rows``
    with reason ``fully_blank_row`` instead of disappearing from the
    audit trail.
    """
    row_stream = ws.iter_rows(values_only=True)
    headers: list[Any] = []
    for idx, values in enumerate(row_stream, start=1):
        if idx < header_row:
            continue
        if idx == header_row:
            headers = list(values)
            continue
        yield idx, dict(zip(headers, values))


def _strip(cell: Any) -> str | None:
    if cell is None:
        return None
    s = str(cell).strip()
    return s if s else None


def _lockfile_present(workbook: Path) -> bool:
    return (workbook.parent / f"~${workbook.name}").exists()


def _parse_rule_runs(row: dict, row_num: int) -> tuple[list[dict], bool, list[str]]:
    """Extract the six Rule Run columns into a structured list.

    Returns ``(rule_runs, has_annotation, unknown_bases)``:
      * ``rule_runs`` — list of ``{"rule_run": str, "annotation": str|None}``
      * ``has_annotation`` — True if any cell carried a parenthetical
        suffix like ``APA (ignore the hyphen option)``
      * ``unknown_bases`` — Rule Run base strings not in RULE_RUN_BASE_VALID
        (reported separately so the editorial team can add them to the
        allowlist or the workbook)
    """
    out: list[dict] = []
    has_annotation = False
    unknown: list[str] = []
    for i in range(1, 7):
        raw = _strip(row.get(f"Rule Run{i}"))
        if not raw:
            continue
        m = _RULE_RUN_RE.match(raw)
        if not m:
            unknown.append(raw)
            continue
        base, annotation = m.group(1), m.group(2)
        if base not in RULE_RUN_BASE_VALID:
            unknown.append(raw)
            continue
        if annotation:
            has_annotation = True
        out.append({"rule_run": base, "annotation": annotation})
    return out, has_annotation, unknown


# ---------------------------------------------------------------------------
# Converter
# ---------------------------------------------------------------------------

def convert_tool_input(ws) -> dict:
    """Walk Tool_Input and sort rows into active / quarantined / editor-hint /
    annotation-unclarified / skipped buckets per the Phase-1 decisions.

    Returns a dict ready to serialise as the JSON output file.
    """
    entries: list[dict] = []
    skipped_rows: list[dict] = []
    quarantined_source_terms: list[str] = []
    annotation_unclarified_source_terms: list[str] = []
    editor_hint_source_terms: list[str] = []
    confidence_unknown_source_terms: list[str] = []
    unknown_action_values: list[dict] = []
    unknown_tool_behaviour_values: list[dict] = []
    unknown_match_type_values: list[dict] = []
    unknown_confidence_values: list[dict] = []
    unknown_rule_run_bases: list[dict] = []

    seen_source_terms: dict[str, list[int]] = {}

    for row_num, row in _row_iter(ws):
        # Fully-blank row: every cell is None / empty-string. Log with a
        # distinct reason so the editorial team can see them in the audit
        # trail even though they carry no data for us to classify.
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in row.values()):
            skipped_rows.append({
                "row_num": row_num,
                "source_term": None,
                "reason": "fully_blank_row",
            })
            continue

        src = _strip(row.get("Source term"))
        if not src:
            # Partially-populated row with blank Source term — nothing
            # to match against, but other cells carry data worth flagging
            # for the editorial team to reconcile.
            skipped_rows.append({
                "row_num": row_num,
                "source_term": None,
                "reason": "empty_source_term",
            })
            continue

        rule_runs, has_annotation, unknown_bases = _parse_rule_runs(row, row_num)

        # SKIP: no Rule Runs assigned.
        if not rule_runs:
            skipped_rows.append({
                "row_num": row_num,
                "source_term": src,
                "reason": "no_rule_runs",
            })
            continue

        if unknown_bases:
            unknown_rule_run_bases.append({
                "row_num": row_num,
                "source_term": src,
                "values": unknown_bases,
            })

        action = _strip(row.get("Action"))
        tool_behaviour = _strip(row.get("Tool behaviour"))
        match_type = _strip(row.get("Match type"))
        match_case = _strip(row.get("Match case"))
        category = _strip(row.get("Category"))
        confidence = _strip(row.get("Confidence"))
        mw_lookup = _strip(row.get("MW lookup"))
        mw_note = _strip(row.get("Merriam-Webster basis / note"))
        source_rows = _strip(row.get("Source row(s)"))
        original_text = _strip(row.get("Original text (if cleaned)"))

        # Track enum-value anomalies (don't abort; let the team see them).
        if action is not None and action not in ACTION_VALID:
            unknown_action_values.append({"row_num": row_num, "source_term": src, "value": action})
        if tool_behaviour is not None and tool_behaviour not in TOOL_BEHAVIOUR_VALID:
            unknown_tool_behaviour_values.append({"row_num": row_num, "source_term": src, "value": tool_behaviour})
        if match_type is not None and match_type not in MATCH_TYPE_VALID:
            unknown_match_type_values.append({"row_num": row_num, "source_term": src, "value": match_type})
        if confidence is not None and confidence not in CONFIDENCE_VALID:
            unknown_confidence_values.append({"row_num": row_num, "source_term": src, "value": confidence})

        # Confidence default — Decision 3.
        if confidence is None:
            confidence = "Unknown"
            confidence_unknown_source_terms.append(src)

        # Suggestions — only non-empty values written.
        suggestions = [
            s for s in (
                _strip(row.get("Suggestion 1")),
                _strip(row.get("Suggestion 2")),
                _strip(row.get("Suggestion 3")),
            ) if s
        ]

        # Status derivation.
        validation_status = "ok"
        if action is None and tool_behaviour is None:
            validation_status = "quarantined"
            quarantined_source_terms.append(src)
        elif has_annotation:
            validation_status = "annotation_unclarified"
            annotation_unclarified_source_terms.append(src)

        # Runtime mode — Decision 5.
        runtime_mode = "editor_hint" if match_type == "Partial word" else "scan"
        if runtime_mode == "editor_hint":
            editor_hint_source_terms.append(src)

        # Generic short-circuit — Decision 8.
        is_generic = any(r["rule_run"] == "Generic" for r in rule_runs)

        # Match case → boolean (None treated as False / case-insensitive,
        # which is the sheet's majority convention).
        match_case_bool = (match_case == "Yes")

        entry = {
            "source_term": src,
            "suggestions": suggestions,
            "action": action,
            "tool_behaviour": tool_behaviour,
            "match_type": match_type,
            "match_case": match_case_bool,
            "category": category,
            "confidence": confidence,
            "mw_lookup": mw_lookup,
            "mw_note": mw_note,
            "source_rows": source_rows,
            "original_text": original_text,
            "rule_runs": rule_runs,
            "is_generic": is_generic,
            "validation_status": validation_status,
            "runtime_mode": runtime_mode,
            "_row_num": row_num,
        }
        entries.append(entry)

        seen_source_terms.setdefault(src.lower(), []).append(row_num)

    # Duplicates — same source_term in multiple rows. The editorial
    # team may want to reconcile; we report but don't filter.
    duplicates = {
        src: rows for src, rows in seen_source_terms.items() if len(rows) > 1
    }

    return {
        "entries": entries,
        "skipped_rows": skipped_rows,
        "duplicates": duplicates,
        "quarantined_source_terms": quarantined_source_terms,
        "annotation_unclarified_source_terms": annotation_unclarified_source_terms,
        "editor_hint_source_terms": editor_hint_source_terms,
        "confidence_unknown_source_terms": confidence_unknown_source_terms,
        "anomalies": {
            "unknown_action_values": unknown_action_values,
            "unknown_tool_behaviour_values": unknown_tool_behaviour_values,
            "unknown_match_type_values": unknown_match_type_values,
            "unknown_confidence_values": unknown_confidence_values,
            "unknown_rule_run_bases": unknown_rule_run_bases,
        },
    }


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
    if "Tool_Input" not in wb.sheetnames:
        sys.stderr.write(f"Workbook is missing sheet: Tool_Input\n")
        return 1

    sha = _sha256_of_file(workbook)
    meta = {
        "source_workbook": workbook.name,
        "source_sha256": sha,
        "origin": "LWW-NE language-tool input (Merriam-Webster suggestions)",
        "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "phase": "Phase 1 — import + validation only. Runtime (Phase 2+) "
                 "pending editorial clarifications Q1-Q7.",
    }

    print("Converting Tool_Input ...")
    result = convert_tool_input(wb["Tool_Input"])

    # Buckets for the human-readable summary.
    entries = result["entries"]
    skipped = result["skipped_rows"]
    quarantined = [e for e in entries if e["validation_status"] == "quarantined"]
    annotation_unclarified = [e for e in entries if e["validation_status"] == "annotation_unclarified"]
    editor_hint = [e for e in entries if e["runtime_mode"] == "editor_hint"]
    ok_entries = [
        e for e in entries
        if e["validation_status"] == "ok" and e["runtime_mode"] == "scan"
    ]
    generic_entries = [e for e in ok_entries if e["is_generic"]]
    by_category = {}
    for e in ok_entries:
        c = e.get("category") or "(no category)"
        by_category[c] = by_category.get(c, 0) + 1

    print()
    print("═" * 60)
    print(f"  Total Tool_Input rows read      : {len(entries) + len(skipped):4}")
    print(f"  Skipped (no Rule Runs / blank) : {len(skipped):4}")
    print(f"  Written to JSON                : {len(entries):4}")
    print(f"    ├─ Quarantined (NULL A+T)   : {len(quarantined):4}")
    print(f"    ├─ Annotation unclarified   : {len(annotation_unclarified):4}")
    print(f"    ├─ Editor-hint (Partial)    : {len(editor_hint):4}")
    print(f"    └─ OK + scan (active)       : {len(ok_entries):4}")
    print(f"       ├─ Generic (always fire) : {len(generic_entries):4}")
    print(f"       └─ Confidence Unknown    : {sum(1 for e in ok_entries if e['confidence'] == 'Unknown'):4}")
    print(f"  Duplicate source terms         : {len(result['duplicates']):4}")
    print(f"  Anomalies:")
    for k, v in result["anomalies"].items():
        print(f"    - {k:38}: {len(v)}")
    print("═" * 60)

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    WORKBOOKS_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "_meta": meta,
        "summary": {
            "total_rows_in_workbook": len(entries) + len(skipped),
            "written_to_json": len(entries),
            "active_scan_rows": len(ok_entries),
            "generic_scan_rows": len(generic_entries),
            "quarantined": len(quarantined),
            "annotation_unclarified": len(annotation_unclarified),
            "editor_hint": len(editor_hint),
            "skipped_rows": len(skipped),
            "confidence_unknown": sum(1 for e in ok_entries if e["confidence"] == "Unknown"),
            "duplicate_source_terms": len(result["duplicates"]),
            "by_category_active": by_category,
        },
        "skipped_rows": skipped,
        "duplicates": result["duplicates"],
        "anomalies": result["anomalies"],
        "quarantined_source_terms": result["quarantined_source_terms"],
        "annotation_unclarified_source_terms": result["annotation_unclarified_source_terms"],
        "editor_hint_source_terms": result["editor_hint_source_terms"],
        "confidence_unknown_source_terms": result["confidence_unknown_source_terms"],
        "entries": entries,
    }

    OUT_TERMS.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False),
        encoding="utf-8",
    )
    print(f"  wrote {OUT_TERMS.relative_to(REPO_ROOT)}")

    dest = WORKBOOKS_DIR / workbook.name
    shutil.copy2(workbook, dest)
    print(f"  copied workbook → {dest.relative_to(REPO_ROOT)}")

    print()
    print("Phase 1 complete. Runtime integration (Phase 2) is BLOCKED on")
    print("editorial clarifications Q1-Q7 per the revised plan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
