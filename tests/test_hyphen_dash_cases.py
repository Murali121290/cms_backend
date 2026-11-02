"""154-case regression harness for the hyphen/en-dash workbook.

The workbook test rows come in three shapes:

  * ``Should change``  — the input text, when run through the engine
    with the row's ``Source`` rule active, must transform into
    ``Expected output`` after applying the primary suggestion.
  * ``Must not flag``  — the row's ``Source`` rule must NOT emit any
    actionable finding on the input (findings from OTHER rules are
    irrelevant: the workbook author scoped each per-rule case to its
    own rule).
  * ``Integrated paragraph`` — ``Source`` is ``All regex rules``; the
    full engine must produce the exact expected transformation when
    every primary suggestion is applied.

The harness runs the hyphen_dash analyser once per case, then filters
findings to those belonging to the Source cohort before grading. This
mirrors the workbook author's unit-test intent and avoids false
failures from legitimate cross-rule overlaps (D08 firing on a case
labelled "D01 must not flag", etc.).
"""
from __future__ import annotations

import json
from pathlib import Path
import pytest

from app.processing.language_editing import hyphen_dash as hd


_CASES_FILE = Path(__file__).parent / "data" / "hyphen_dash_tests.json"


def _load_cases() -> list[dict]:
    with _CASES_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)["test_cases"]


_PROFILE_ALIAS = {
    "all": "all",
    "mw_dictionary": "mw_dictionary",
    "chicago_ama_apa": "chicago_ama_apa",
    # Workbook convention: `us_mw_and_chicago` applies in every default
    # profile. Pass through as `all` so the alias resolves to the common-
    # case dash_profile the service layer uses.
    "us_mw_and_chicago": "all",
    "both": "all",
    # Opt-in — only active when the dash_profile explicitly asks for it.
    "optional_typographic_minus": "optional_typographic_minus",
}


def _rule_matches_source(rule_id: str, source: str) -> bool:
    """True if ``rule_id`` belongs to the test's declared Source cohort.

    The workbook's Source column uses both exact rule IDs (``D01``) and
    free-text variants that reference a sheet (``Detect_List``,
    ``Detect_List (position rule)``). Match prefixes rather than literal
    strings so test authors have some phrasing freedom.
    """
    if not source:
        return True
    s = source.strip()
    if s in ("All regex rules", "All rules", "All"):
        return True
    if s.startswith("Detect_List") or s.startswith("Hyphen_Compounds"):
        return rule_id.startswith("HY-")
    if s.startswith("Protected"):
        return rule_id.startswith("PR-")
    if s.startswith("En_Dash_Terms"):
        return rule_id.startswith("EN-")
    # Otherwise Source is a specific regex-rule ID (D01, D04a, H03b, O01, …).
    return rule_id == s


def _apply_primary(text: str, findings) -> str:
    """Replay accepted primary suggestions right-to-left (export order)."""
    out = text
    for f in sorted(findings, key=lambda f: -f.start):
        # Empty-string suggestion is a legitimate delete (soft-hyphen rule
        # C01). Guard only against the no-op case.
        if f.suggestion != f.original:
            out = out[:f.start] + f.suggestion + out[f.end:]
    return out


_CASES = _load_cases()


@pytest.fixture(autouse=True)
def _cold_cache():
    hd.clear_cache()
    yield
    hd.clear_cache()


# ──────────────────────────────────────────────────────────────────────
# Should-change (61 cases)
# ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case", [c for c in _CASES if c["test_type"] == "Should change"],
                         ids=lambda c: c["id"])
def test_should_change(case):
    profile = _PROFILE_ALIAS.get(case["style_profile"], "all")
    findings = hd.analyze_hyphen_dash(case["input"], dash_profile=profile)
    # Grade on the Source cohort only. Other rules' findings are allowed
    # to exist; they just don't participate in this case's expected output.
    cohort = [f for f in findings if _rule_matches_source(f.rule_id, case["source"])]
    got = _apply_primary(case["input"], cohort)
    assert got == case["expected"], (
        f"id={case['id']} src={case['source']} profile={profile}\n"
        f"  in:   {case['input']!r}\n"
        f"  want: {case['expected']!r}\n"
        f"  got:  {got!r}\n"
        f"  findings in cohort: {[(f.rule_id, f.original, f.suggestion) for f in cohort]}"
    )


# ──────────────────────────────────────────────────────────────────────
# Must-not-flag (89 cases)
# ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case", [c for c in _CASES if c["test_type"] == "Must not flag"],
                         ids=lambda c: c["id"])
def test_must_not_flag(case):
    profile = _PROFILE_ALIAS.get(case["style_profile"], "all")
    findings = hd.analyze_hyphen_dash(case["input"], dash_profile=profile)
    cohort = [f for f in findings
              if _rule_matches_source(f.rule_id, case["source"])
              and f.suggestion != f.original]
    assert not cohort, (
        f"id={case['id']} src={case['source']} must not flag but did:\n"
        f"  in: {case['input']!r}\n"
        f"  cohort findings: {[(f.rule_id, f.original, f.suggestion) for f in cohort]}"
    )


# ──────────────────────────────────────────────────────────────────────
# Integrated paragraph (4 cases)
# ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case", [c for c in _CASES if c["test_type"] == "Integrated paragraph"],
                         ids=lambda c: c["id"])
def test_integrated_paragraph(case):
    profile = _PROFILE_ALIAS.get(case["style_profile"], "all")
    findings = hd.analyze_hyphen_dash(case["input"], dash_profile=profile)
    got = _apply_primary(case["input"], findings)
    assert got == case["expected"], (
        f"id={case['id']} profile={profile}\n"
        f"  in:   {case['input']!r}\n"
        f"  want: {case['expected']!r}\n"
        f"  got:  {got!r}\n"
        f"  findings: {[(f.rule_id, f.original, f.suggestion) for f in findings]}"
    )
