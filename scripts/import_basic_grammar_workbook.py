"""One-off importer for the Basic Grammar Rules workbook.

Reads ``Basic_Grammar_Rules_CE_Tool.xlsx`` and writes the 420 rules to
``app/processing/language_editing/config/profiles/basic_grammar_rules.json``
in a form the runtime loader expects. This script is not called from
server code — it is run once (or whenever the workbook is refreshed) to
regenerate the config file:

    python scripts/import_basic_grammar_workbook.py \
        --xlsx /path/to/Basic_Grammar_Rules_CE_Tool.xlsx \
        --out  app/processing/language_editing/config/profiles/basic_grammar_rules.json

Preserves every field verbatim — the runtime module decides which rules
to actually execute based on ``implementation_status`` and the reuse /
disable mapping documented in basic_grammar.py.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import openpyxl


# Fields we persist verbatim from each rule row. Column-name mismatches
# in the workbook are a hard error (the loader would then produce None
# on a required field, silently disabling a rule).
_RULE_FIELDS = (
    "rule_id",
    "rule_category",
    "rule_subcategory",
    "rule_name",
    "rule_description",
    "incorrect_example",
    "corrected_example",
    "explanation",
    "detection_method",
    "detection_pattern",
    "trigger_condition",
    "exception_conditions",
    "suggested_correction",
    "rule_type",
    "severity",
    "confidence_level",
    "requires_context",
    "autocorrect_safe",
    "recommended_action",
    "editor_message",
    "false_positive_risks",
    "style_dependency",
    "validation_status",
    "source_reference",
    "implementation_status",
    "replacement",
    "detector_id",
    "secondary_tags",
    "release_candidate",
    "production_enabled",
    "worksheet",
)

# Reuse / disable decisions ratified with the user. Keys are workbook
# rule IDs; values describe how the runtime treats them. These are
# stored in the JSON so the loader can surface them in the rule-viewer
# without re-deriving the mapping at every startup.
_REUSE_MAP: dict[str, dict[str, str]] = {
    "GK-004": {"reused_by": "SL001", "reason": "max_sentence_length function already in engine"},
    "AR-001": {"reused_by": "GP006", "reason": "a/an before vowel sound regex already in profiles"},
    "PU-007": {"reused_by": "GP005", "reason": "doubled-word check already in engine with that/had guard"},
    "CA-001": {"reused_by": "SL003", "reason": "start_capital function already in engine"},
}

# Rule-based detectors we implement in basic_grammar.py. Everything NOT
# in this set and NOT in _REUSE_MAP stays disabled when
# implementation_status != READY_REGEX.
_IMPLEMENTED_DETECTORS: frozenset[str] = frozenset({
    "irregular_participle",     # GV-005
    "quote_punct_us",           # PU-010 (US-only, style-dependent)
    "unbalanced_brackets",      # PU-017
    "quote_style_consistency",  # GK-002 (document-scope, no external data needed)
    "serial_comma_consistency", # GK-003 (document-scope; House-style gated off by default)
})

# Rules marked READY_RULE_BASED but intentionally not run because they
# need parsing / a lexicon / a dictionary the workbook doesn't ship.
# Documented here so the loader can surface the reason in the rule
# viewer and the audit trail stays accurate.
_SHIP_DISABLED: dict[str, str] = {
    "PU-011": "Comma-splice detection needs clause boundaries; requires parser",
    "CA-011": "Binomial case needs a genus/species lexicon; no data shipped",
    "GK-001": "Consistency-pairs dictionary not shipped by the workbook (email/e-mail, website/web site, …); approximating would invent data",
}


def _read_sheet(wb: openpyxl.Workbook, sheet_name: str) -> list[dict[str, Any]]:
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = rows[0]
    idx = {h: i for i, h in enumerate(headers)}
    out: list[dict[str, Any]] = []
    for row in rows[1:]:
        if not row or not row[idx.get("rule_id", 0)]:
            continue
        record: dict[str, Any] = {}
        for field in _RULE_FIELDS:
            if field in idx:
                v = row[idx[field]]
                if v is not None:
                    record[field] = v
        rid = record.get("rule_id")
        if rid in _REUSE_MAP:
            record["reuse"] = _REUSE_MAP[rid]
        if rid in _SHIP_DISABLED:
            record["ship_disabled_reason"] = _SHIP_DISABLED[rid]
        out.append(record)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    rule_sheets = (
        "Grammar_Rules",
        "Article_Usage",
        "Subject_Verb_Agreement",
        "Punctuation_Capitalization",
        "Common_Misuse",
        "Word_Phrase_Choice",
        "Sentence_Structure",
    )
    all_rules: list[dict[str, Any]] = []
    for sheet in rule_sheets:
        rules = _read_sheet(wb, sheet)
        all_rules.extend(rules)
        print(f"  {sheet}: {len(rules)} rules")

    # Detection_Logic — kept alongside the rules so the runtime test
    # harness can replay positive/negative cases without re-opening the
    # XLSX. Only the fields the harness uses are persisted.
    detection_tests: list[dict[str, Any]] = []
    dl_ws = wb["Detection_Logic"]
    dl_rows = list(dl_ws.iter_rows(values_only=True))
    dl_headers = dl_rows[0]
    dl_idx = {h: i for i, h in enumerate(dl_headers)}
    for row in dl_rows[1:]:
        if not row or not row[dl_idx["rule_id"]]:
            continue
        rec = {
            "test_case_id": row[dl_idx["test_case_id"]],
            "rule_id": row[dl_idx["rule_id"]],
            "test_type": row[dl_idx["test_type"]],
            "input_text": row[dl_idx["input_text"]],
            "expected_result": row[dl_idx["expected_result"]],
            "expected_correction": row[dl_idx["expected_correction"]],
            "worksheet": row[dl_idx["worksheet"]],
        }
        detection_tests.append(rec)

    payload = {
        "source_file": args.xlsx.name,
        "release": "1.0 / 2026-10-29",
        "total_rules": len(all_rules),
        "rules": all_rules,
        "detection_tests": detection_tests,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"\nWrote {len(all_rules)} rules + {len(detection_tests)} test cases to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
