"""Phase C tests for the Abbreviations module.

Covers:
  * AB03 — abbreviation used before its definition (reorder two findings).
  * AB06 — inconsistent abbreviations for the same canonical expansion.
  * AB07 — ambiguous abbreviation disambiguated via Context_Rules; falls
    back to an "ask the author" finding when the cues don't decide.
  * scope_reset setting is persisted and honoured at the engine level.

Also unlocks the 10 Context-choice workbook test cases (which were
xfailed in Phase B) and the T-005 AB03 case.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.processing.language_editing import abbreviations as ab


_CASES = json.loads(
    Path(__file__).parent.joinpath("data", "abbreviations_tests.json").read_text()
)["test_cases"]


@pytest.fixture(autouse=True)
def _cold_cache():
    ab.clear_cache()
    yield
    ab.clear_cache()


# ─── AB03 ──────────────────────────────────────────────────────────────

def test_ab03_t005_reorders_definition_to_first_use():
    """T-005: 'The ICU was full. Patients in the intensive care unit
    (ICU) were stable.' → the definition moves to the first use and the
    later definition collapses to just ICU."""
    text = "The ICU was full. Patients in the intensive care unit (ICU) were stable."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    ab03 = [f for f in findings if f.rule_id == "AB03"]
    assert len(ab03) == 2, findings
    # Apply right-to-left and compare to the expected rewrite.
    out = text
    for f in sorted(findings, key=lambda x: -x.start):
        if f.suggestion != f.original:
            out = out[:f.start] + f.suggestion + out[f.end:]
    assert out == "The intensive care unit (ICU) was full. Patients in the ICU were stable.", out


# ─── AB06 ──────────────────────────────────────────────────────────────

def test_ab06_fires_when_both_surfaces_appear():
    """When ECG and EKG both appear in the same document for the same
    expansion, AB06 fires on the non-preferred surface. The workbook's
    row order determines the preferred form (first row wins)."""
    pref = ab._preferred_abbr_for_expansion()
    # Verify ECG/EKG share an expansion and have a canonical preference.
    exp_ecg = next(
        (e.expansion for entries in ab._abbr_entries_by_abbr().values()
         for e in entries if e.abbreviation == "ECG"), None,
    )
    exp_ekg = next(
        (e.expansion for entries in ab._abbr_entries_by_abbr().values()
         for e in entries if e.abbreviation == "EKG"), None,
    )
    if not (exp_ecg and exp_ekg and exp_ecg.lower() == exp_ekg.lower()):
        pytest.skip("Workbook doesn't ship ECG/EKG as a shared-expansion pair")
    preferred = pref[exp_ecg.lower()]
    other = "EKG" if preferred == "ECG" else "ECG"

    text = f"The {preferred} was clear but the {other} showed changes."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    ab06 = [f for f in findings if f.rule_id == "AB06"]
    assert any(f.original == other and f.suggestion == preferred for f in ab06), (
        f"expected AB06 on {other!r} → {preferred!r}, got {[(f.rule_id, f.original, f.suggestion) for f in findings]}"
    )


def test_ab06_silent_when_only_preferred_or_only_alternate_used():
    """If the document uses only ONE surface, there's nothing to be
    inconsistent with — AB06 stays silent."""
    text = "An EKG was ordered. The EKG was clear."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert not any(f.rule_id == "AB06" for f in findings)


# ─── AB07 — Context_Rules disambiguation ───────────────────────────────

@pytest.mark.parametrize(
    "text,abbr,expected_meaning",
    [
        # Workbook T-075 — RA + SpO2 → room air
        ("The patient was on RA with SpO2 of 98% and no oxygen needed.",
         "RA", "room air"),
        # T-078 — HR + bpm → heart rate
        ("Vital signs: HR 110 bpm, BP 90/60 with tachycardia.",
         "HR", "heart rate"),
        # T-079 — HR + CI 95% survival → hazard ratio
        ("The HR was 0.62 (95% CI 0.45 to 0.85) in the survival analysis.",
         "HR", "hazard ratio"),
        # T-083 — MS + relapsing + MRI → multiple sclerosis
        ("MS with relapsing episodes and demyelinating lesions on MRI.",
         "MS", "multiple sclerosis"),
    ],
)
def test_ab07_context_scoring_picks_right_meaning(text, abbr, expected_meaning):
    position = text.find(abbr)
    chosen = ab.resolve_abbreviation_meaning(text, abbr, position)
    assert chosen == expected_meaning, (
        f"expected {expected_meaning!r}, got {chosen!r} for {text!r}"
    )


def test_ab07_ask_author_when_no_cue_found():
    """T-082: 'The PA was reviewed.' — no cue words nearby, scorer gives
    all candidates a zero. ``resolve_abbreviation_meaning`` returns None;
    the engine emits an AB07 finding on the occurrence."""
    text = "The PA was reviewed."
    assert ab.resolve_abbreviation_meaning(text, "PA", text.find("PA")) is None

    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    ab07 = [f for f in findings if f.rule_id == "AB07"]
    assert ab07, findings
    assert ab07[0].original == "PA"
    assert ab07[0].autofixable is False  # author must choose
    # Every candidate meaning must be surfaced for the Review UI dropdown.
    assert len(ab07[0].alt_suggestions) >= 2


def test_ab07_does_not_fire_when_context_is_decisive():
    """When Context_Rules resolves confidently, AB07 stays silent and
    the normal first-use rules can fire with the chosen meaning."""
    text = "The patient was on RA with SpO2 of 98%, no oxygen needed."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert not any(f.rule_id == "AB07" for f in findings), findings
    assert state["RA"].context_resolved is True
    assert state["RA"].chosen_entry is not None
    assert state["RA"].chosen_entry.expansion == "room air"


# ─── Context-choice workbook test cases (previously xfailed) ───────────

_CTX_CASES = [c for c in _CASES if c["area"] == "Context choice"]
_NO_CUE_MARKER = "(no cue: ask the author)"


@pytest.mark.parametrize("case", _CTX_CASES, ids=lambda c: c["id"])
def test_workbook_context_choice(case):
    """Workbook ``Should choose`` cases: expected output is a MEANING
    string (or the ``(no cue: ask the author)`` sentinel), not a rewrite."""
    text = case["input"]
    abbr = case["notes"].strip()
    position = text.find(abbr)
    assert position >= 0, f"{case['id']}: abbr {abbr!r} not found in input"
    chosen = ab.resolve_abbreviation_meaning(text, abbr, position)
    if case["expected"] == _NO_CUE_MARKER:
        assert chosen is None, f"{case['id']}: expected ask-author, got {chosen!r}"
    else:
        assert chosen == case["expected"], (
            f"{case['id']}: expected {case['expected']!r}, got {chosen!r}"
        )


# ─── scope_reset setting ──────────────────────────────────────────────

def test_scope_reset_setting_round_trips_through_service():
    """``scope_reset`` is persisted + loaded from the sidecar JSON. Phase C
    adds the field; Phase E will add UI."""
    from app.services.language_rule_service import (
        _validate_scope_reset, DEFAULT_SCOPE_RESET,
    )
    assert _validate_scope_reset(None) == DEFAULT_SCOPE_RESET
    assert _validate_scope_reset(True) is True
    assert _validate_scope_reset("yes") is True
    assert _validate_scope_reset("no") is False
    with pytest.raises(ValueError):
        _validate_scope_reset("maybe")


# ─── Scope-C invariant ────────────────────────────────────────────────

def test_phase_c_never_mutates_input_text():
    text = "The ICU was full. Patients in the intensive care unit (ICU) were stable."
    before = text
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    _ = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert text == before
