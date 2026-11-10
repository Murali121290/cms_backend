"""Phase B tests for the Abbreviations module.

Runs the workbook's own 84 Test_Cases through the Phase-B engine. Cases
whose area is 'Context choice' (requires Phase C disambiguation) OR whose
notes explicitly reference AB03 (deferred to Phase C) are marked xfail
with a reason so they don't block the suite.

Also exercises Phase-B regex rules (AB09, AB10, AB13) and the engine +
router entry points to confirm overrides, audience, and min_uses all
propagate end-to-end without silent text mutation.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import engine


_CASES = json.loads(
    Path(__file__).parent.joinpath("data", "abbreviations_tests.json").read_text()
)["test_cases"]


@pytest.fixture(autouse=True)
def _cold_cache():
    ab.clear_cache()
    yield
    ab.clear_cache()


def _parse_settings(raw: str | None) -> dict:
    out = {"audience": "general", "min_uses": 2}
    if not raw:
        return out
    for kv in raw.split(";"):
        kv = kv.strip()
        if "=" in kv:
            k, v = (p.strip() for p in kv.split("=", 1))
            if k == "audience":
                out["audience"] = v
            elif k.lower() in ("minuses", "min_uses"):
                try:
                    out["min_uses"] = int(v)
                except ValueError:
                    pass
    return out


def _apply_findings_rtl(text: str, findings) -> str:
    """Simulate the DOCX export loop: apply right-to-left so earlier
    offsets stay valid."""
    out = text
    for f in sorted(findings, key=lambda x: -x.start):
        if f.suggestion != f.original:
            out = out[:f.start] + f.suggestion + out[f.end:]
    return out


def _filter_by_area(findings, area: str) -> list:
    """Narrow a finding list to the rules the workbook test was scoped to.

    Matches the workbook harness convention used for ``test_hyphen_dash_cases.py``:
    a per-rule "Must not change" test is designed to prove ONE rule doesn't
    false-fire — findings from OTHER rules shouldn't fail the test.

      * ``Do not use DNxx``  → keep only findings with rule_id == 'DNxx'
      * ``First-use rule``   → keep AB01-AB05 and AB10 (first-use family)
      * ``Plural apostrophe``→ keep AB09
      * ``Context choice``   → Phase C territory (xfail elsewhere)
      * anything else        → return as-is
    """
    if area.startswith("Do not use "):
        rid = area.replace("Do not use ", "").strip()
        return [f for f in findings if f.rule_id == rid]
    if area == "First-use rule":
        return [f for f in findings if f.rule_id.startswith("AB")]
    if area == "Plural apostrophe":
        return [f for f in findings if f.rule_id == "AB09"]
    return list(findings)


def _run_case(case: dict) -> tuple[str, list, list]:
    settings = _parse_settings(case.get("settings"))
    state = ab.build_document_state(
        [(0, case["input"])],
        audience=settings["audience"],
        min_uses=settings["min_uses"],
    )
    findings = ab.analyze_abbreviations(
        case["input"],
        para_idx=0,
        audience=settings["audience"],
        min_uses=settings["min_uses"],
        document_state=state,
    )
    # Scope to the area under test — a per-rule "Must not change" test
    # that's narrowly scoped to DN02 shouldn't fail because AB05 fired
    # elsewhere in the fragment.
    scoped = _filter_by_area(findings, case.get("area", ""))
    got = _apply_findings_rtl(case["input"], scoped)
    return got, findings, scoped


# ─── Workbook harness ─────────────────────────────────────────────────

# Context-choice cases are evaluated by test_abbreviations_phase_c.py
# (expected value is a meaning string, not a text rewrite). Skip them
# here to avoid duplicating the harness.
_PHASE_C_AREAS = {"Context choice"}
_PHASE_C_IDS: set[str] = set()  # T-005 moved to pass after Phase C AB03 ships
_PHASE_D_IDS: set[str] = set()  # heading/scope cases, if any surface in Phase D


@pytest.mark.parametrize("case", _CASES, ids=lambda c: c["id"])
def test_workbook_harness(case):
    if case["area"] in _PHASE_C_AREAS or case["id"] in _PHASE_C_IDS:
        pytest.xfail(f"deferred: {case['area']} / {case.get('notes','')}")
    if case["id"] in _PHASE_D_IDS:
        pytest.xfail("deferred to Phase D")
    got, all_findings, scoped = _run_case(case)
    if case["test_type"] in ("Should change", "Should choose"):
        assert got == case["expected"], (
            f"{case['id']}: want {case['expected']!r} got {got!r} "
            f"scoped={[(f.rule_id, f.original, f.suggestion) for f in scoped]} "
            f"all={[(f.rule_id, f.original, f.suggestion) for f in all_findings]}"
        )
    else:  # 'Must not change'
        assert got == case["expected"], (
            f"{case['id']}: expected no change, got {got!r} "
            f"scoped={[(f.rule_id, f.original, f.suggestion) for f in scoped]}"
        )


# ─── Targeted rule tests ─────────────────────────────────────────────

def test_ab01_fires_on_first_abbr_occurrence():
    text = "ICU staff reported that the ICU opened more beds."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    ab01 = [f for f in findings if f.rule_id == "AB01"]
    assert ab01, findings
    assert ab01[0].start == 0
    # Suggestion is sentence-initial-capitalised ("Intensive care unit (ICU)")
    # because position 0 is a sentence start.
    assert "intensive care unit (icu)" in ab01[0].suggestion.lower()


def test_ab13_strips_periods_but_skips_latin():
    text = "The M.R.I. scan confirmed it (e.g. the lesion was benign)."
    findings = ab.analyze_abbreviations(text, document_state=None)
    ab13 = [f for f in findings if f.rule_id == "AB13"]
    assert any(f.original == "M.R.I." and f.suggestion == "MRI" for f in ab13)
    # e.g. must NOT be flagged.
    assert not any("e.g" in f.original.lower() for f in ab13)


def test_ab09_plural_apostrophe_fires_only_before_plural_verb():
    cases = [
        ("The ICU's were closed overnight.", True),   # verb follows → fire
        ("The ICU's staff were tired.",       False),  # noun follows → possessive, no fire
    ]
    for text, should_fire in cases:
        findings = ab.analyze_abbreviations(text, document_state=None)
        got = any(f.rule_id == "AB09" for f in findings)
        assert got == should_fire, (text, findings)


def test_ab10_article_disagreement_on_standalone_abbreviation():
    text = "She had a MRI yesterday and an MRI last week."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    ab10 = [f for f in findings if f.rule_id == "AB10"]
    assert any(f.original == "a" and f.suggestion == "an" for f in ab10), ab10


# ─── Override + settings propagation ─────────────────────────────────

def test_rule_override_disables_abbreviation_entry():
    """Disabling the ICU entry via override drops it from document_state."""
    text = "ICU staff were busy. The ICU opened more beds."
    overrides = {}
    state_before = ab.build_document_state([(0, text)], rule_overrides=overrides)
    assert "ICU" in state_before
    # Find the first ICU entry's id and disable it.
    icu_id = state_before["ICU"].chosen_entry.id
    overrides = {icu_id: {"enabled": False}}
    state_after = ab.build_document_state([(0, text)], rule_overrides=overrides)
    # ICU may still appear if an ALTERNATE meaning exists; if there's only
    # one meaning (unique), the key disappears entirely.
    if "ICU" in state_after:
        # Must not have the previously-chosen entry present.
        assert all(e.id != icu_id for e in state_after["ICU"].entries)


def test_audience_professional_skips_general_only_entries():
    """BP (blood pressure) is marked expand_for_general_only. Under
    audience=professional it must not trigger first-use rewriting.

    The text mixes the expansion and the abbreviation so AB01 has a
    legitimate subject in general mode — the AB01 guard requires the
    abbreviation form to appear in the document, and this test covers
    the audience branch rather than the empty-abbreviation branch.
    """
    text = "Blood pressure was measured twice. BP was normal."
    state_general = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    state_prof = ab.build_document_state([(0, text)], audience="professional", min_uses=2)
    general_findings = ab.analyze_abbreviations(
        text, para_idx=0, audience="general", min_uses=2, document_state=state_general,
    )
    prof_findings = ab.analyze_abbreviations(
        text, para_idx=0, audience="professional", min_uses=2, document_state=state_prof,
    )
    assert any(f.rule_id == "AB01" and "(BP)" in f.suggestion for f in general_findings)
    assert not any(f.rule_id == "AB01" and "(BP)" in f.suggestion for f in prof_findings)


def test_min_uses_threshold_blocks_ab01():
    text = "The ICU was busy."  # one usage
    # min_uses=2 → AB01 should not fire; AB05 may fire (lone-abbr spell-out)
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state, min_uses=2)
    assert not any(f.rule_id == "AB01" for f in findings)


# ─── AB02 guard (mirrors AB01 fix) ────────────────────────────────────

def test_ab02_silent_when_only_expansion_present_treatment():
    """``treatment`` × N with no ``Tx`` anywhere → AB02 must not fire.
    Prose that happens to use a common English word which the workbook
    lists as an expansion of an informal shorthand (treatment→Tx) is
    not an opportunity to abbreviate — there is nothing to compress to
    because the author never introduced ``Tx``."""
    # Multiple expansion occurrences, no abbreviation in sight.
    paragraphs = [
        (0, "The patient received treatment during the admission."),
        (1, "A second round of treatment was later administered."),
        (2, "Routine treatment continued after discharge."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    for pi, text in paragraphs:
        findings = ab.analyze_abbreviations(
            text, para_idx=pi, audience="general", min_uses=2, document_state=state,
        )
        assert not any(f.rule_id == "AB02" for f in findings), (
            f"AB02 wrongly fired on para {pi} with expansion-only state"
        )


def test_ab02_silent_when_only_expansion_present_symptoms():
    """``symptoms`` × N with no ``Sx`` anywhere → AB02 silent."""
    paragraphs = [
        (0, "Reported symptoms included fever and headache."),
        (1, "Later symptoms worsened overnight."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    for pi, text in paragraphs:
        findings = ab.analyze_abbreviations(
            text, para_idx=pi, audience="general", min_uses=2, document_state=state,
        )
        assert not any(f.rule_id == "AB02" for f in findings)


def test_ab02_silent_when_only_expansion_present_history():
    """``history`` × N with no ``Hx`` anywhere → AB02 silent."""
    paragraphs = [
        (0, "A relevant history of the condition was recorded."),
        (1, "The history also noted earlier interventions."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    for pi, text in paragraphs:
        findings = ab.analyze_abbreviations(
            text, para_idx=pi, audience="general", min_uses=2, document_state=state,
        )
        assert not any(f.rule_id == "AB02" for f in findings)


def test_ab02_fires_when_expansion_and_abbreviation_coexist():
    """Legitimate AB02: the document mixes expansion and abbreviation.
    The guard preserves AB02 for every case where the author actually
    introduced the abbreviation at least once — later expansion
    mentions still compress toward it."""
    text = (
        "The intensive care unit was busy. "
        "The ICU staff worked overnight. "
        "The intensive care unit reopened the next morning."
    )
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(
        text, para_idx=0, audience="general", min_uses=2, document_state=state,
    )
    ab02 = [f for f in findings if f.rule_id == "AB02"]
    assert ab02, "AB02 should fire on the later 'intensive care unit' expansion"
    assert ab02[0].original.lower() == "intensive care unit"
    assert ab02[0].suggestion == "ICU"


def test_ab02_fires_on_rule_g_entry_when_abbreviation_present():
    """Consistency with the AB01 behaviour (test_audience_professional_
    skips_general_only_entries): when the Rule-G entry's abbreviation
    appears in the document, AB02 compresses the later expansion to
    BP, the same way AB01 introduces it."""
    text = "Blood pressure was measured twice. BP was normal. Blood pressure stayed stable."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(
        text, para_idx=0, audience="general", min_uses=2, document_state=state,
    )
    # AB02 should compress the final 'Blood pressure' toward BP.
    assert any(
        f.rule_id == "AB02" and f.original.lower() == "blood pressure" and f.suggestion == "BP"
        for f in findings
    )


def test_ab02_silent_when_abbreviation_matches_expansion_prose_only():
    """Document-scope regression: multiple paragraphs with only the
    expansion should not trigger AB02 anywhere, even though
    ``total_uses >= min_uses`` across paragraphs. Mirrors the live
    reproduction from the user's document (Para 21/25/31)."""
    # Three paragraphs, each contributing another occurrence of
    # 'treatment' with no 'Tx' anywhere.
    paragraphs = [
        (0, "The patient was admitted for routine treatment."),
        (1, "The following week treatment continued without incident."),
        (2, "A final course of treatment was administered before discharge."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    for pi, text in paragraphs:
        findings = ab.analyze_abbreviations(
            text, para_idx=pi, audience="general", min_uses=2, document_state=state,
        )
        bogus = [f for f in findings if f.rule_id == "AB02" and f.original.lower() == "treatment"]
        assert not bogus, f"AB02 fired on para {pi}: {bogus}"


# ─── Engine integration ──────────────────────────────────────────────

def test_engine_analyze_threads_abbr_state_from_router():
    """engine.analyze accepts the Phase-B kwargs and delegates to
    abbreviations correctly."""
    text = "ICU staff were on call. The ICU opened more beds."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    out = engine.analyze(
        text, rules=[], dictionary={}, sents=[(0, len(text), text)],
        para_idx=0, abbr_state=state, audience="general", min_uses=2,
    )
    assert any(f.rule_id == "AB01" for f in out)


# ─── Scope-C invariant ────────────────────────────────────────────────

def test_phase_b_never_mutates_input_text():
    """All Phase-B rules emit Findings; the input string is unchanged."""
    text = "ICU staff were on call. The ICU opened more beds."
    before = text
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    _ = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert text == before
