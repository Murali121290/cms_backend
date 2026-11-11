"""Phase E regression tests for the Abbreviations module.

Five correctness fixes ratified in the audit corrections:

* DN rules enforce their ``Applies in`` context (medication orders /
  doses / notes / MAR / otic / ophthalmic) and skip when a forbidden
  context (statistical / scientific) is present.
* DN rules honour the per-row ``Must NOT be flagged`` allowlist.
* Expansion matcher treats hyphen and space interchangeably
  (``long-term care`` ≡ ``long term care``).
* AB05 single-use threshold uses the abbreviation-only occurrence
  count instead of the combined expansion+abbreviation count.
* AB01 suppresses its first-use emission when the first-use position
  is already inside a ``(...)`` parenthetical — prevents
  ``(expansion (ABBR))`` nesting.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations as ab


@pytest.fixture(autouse=True)
def _cold_cache():
    ab.clear_cache()
    yield
    ab.clear_cache()


# ─── DN applies_in context gating ─────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    # (1) DN01 ``U`` — fires in dose context, silent otherwise.
    ("Give 10 U of insulin.", {"DN01"}),
    ("The 10 U.S. states agreed.", set()),
    ("The U-shaped curve was striking.", set()),
    # (2) DN02 ``IU`` — regex boundary already prevents IUD/IUGR; the
    # context gate adds a second layer.
    ("Give 5000 IU daily.", {"DN02"}),
    ("IUD placement was successful.", set()),
    ("The patient has IUGR.", set()),
    # (3) DN06 leading-zero — must NOT fire on statistical ``p < .05``.
    ("Give .5 mg daily.", {"DN06"}),                      # dose context
    ("Statistical analysis shows p < .05 was significant.", set()),
    # (4) DN07 MS — fires in order context, silent as multiple sclerosis.
    ("Give MS 4 mg IV.", {"DN07"}),
    ("MS is a chronic disease that affects nerves.", set()),
    ("She has MS and fatigue.", set()),
    # (5) DN10 μg — fires in orders, silent in scientific prose.
    ("Give 50 μg daily.", {"DN10"}),
    ("The HPLC assay measured serum concentration at 2.5 μg/mL.", set()),
    # (6) DN12 @ — orders + notes context. The workbook Test_Case
    # T-039 treats a bare ``BP @ 0800 was 120/80.`` line as implicit
    # note context (clinical charting format), so DN12 fires without
    # an explicit heading. The regex boundaries exclude emails.
    ("BP @ 0800 was 120/80.", {"DN12"}),
    ("Note: BP @ 0800 was 120/80.", {"DN12"}),
    ("Progress note: assessed @ bedside.", {"DN12"}),
    ("write to nurse@hospital.org", set()),
    # (7) DN15 SQ — order context required.
    ("Give heparin SQ.", {"DN15"}),
    ("The square was filled.", set()),
    # (8) DN11 cc — order context required; "CC: chest pain" is a chief-
    # complaint note, not a prescription for cc.
    ("Give 5 cc daily.", {"DN11"}),
    ("CC: chest pain and dyspnea.", set()),
])
def test_dn_context_gating(text, expected):
    actual = {f.rule_id for f in ab.analyze_do_not_use(text)}
    assert actual == expected, (
        f"{text!r}: expected {expected}, got {actual}"
    )


# ─── Must-not-be-flagged counter-examples ─────────────────────────

@pytest.mark.parametrize("dn_id,fixture", [
    # Every workbook counter-example for the 29 Flag-and-suggest DN rows.
    # If any of these fires its paired DN rule, the engine regressed.
    ("DN01", "Give 10 mg daily."),
    ("DN01", "The 10 U.S. states agreed."),
    ("DN02", "IUD placement"),
    ("DN02", "IUGR was noted."),
    ("DN03", "Take 1 tablet QID daily."),
    ("DN03", "Take 1 tablet QOD."),
    ("DN04", "Take 1 tablet QD."),
    ("DN05", "Give 5.5 mg daily."),
    ("DN06", "Give 0.5 mg daily."),
    ("DN06", "Statistical result: p < .05 significant."),
    ("DN07", "MS is a chronic disease."),
    ("DN07", "She has MS and fatigue."),
    ("DN08", "Note: MgSO4 infusion started."),
    ("DN09", "MSO4 is morphine sulfate."),  # order context required for DN09
    ("DN10", "Give 50 mcg daily."),
    ("DN11", "Give 5 mL daily."),
    ("DN11", "CC: chest pain and dyspnea."),
    ("DN12", "write to nurse@hospital.org"),
    ("DN13", "D&C was performed."),
    ("DN14", "HS graduate started employment."),
    ("DN15", "The square was large."),
    ("DN16", "Give drug TIDW."),
    ("DN17", "Give drug BID daily."),
    ("DN18", "The person reported no issues."),
    ("DN19", "Give 5 mg qh."),
    ("DN20", "Report arrived via qnet."),
    ("DN21", "Give 2 mg IM."),
    ("DN22", "Note: HCT level was normal."),
    ("DN23", "Review MTX2 outcomes."),
    ("DN24", "Review NTGX study."),
    ("DN25", "AZTEC antigens were observed."),
    ("DN26", "Review APAPX protocol."),
    ("DN27", "Mom called the clinic."),
    ("DN28", "Give 5 g daily."),
    ("DN29", "x-ray showed no fracture."),
])
def test_must_not_be_flagged_counter_examples(dn_id, fixture):
    """Every workbook counter-example must stay unflagged by its
    paired DN rule. This is the workbook's own regression test
    translated into the Python test suite — any failure is a direct
    violation of README §8."""
    findings = ab.analyze_do_not_use(fixture)
    offenders = [f for f in findings if f.rule_id == dn_id]
    assert not offenders, (
        f"{dn_id} wrongly flagged {fixture!r}: {[(f.original, f.suggestion) for f in offenders]}"
    )


# ─── Hyphen ↔ space interchangeability ────────────────────────────

def test_expansion_matches_hyphenated_form():
    """``long term care`` in a workbook entry must also match the
    document's ``long-term care`` and vice versa (README §10)."""
    text_hyphen = "The long-term care facility uses LTC protocols for staff."
    text_space = "The long term care facility uses LTC protocols for staff."
    for text in (text_hyphen, text_space):
        state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
        s = state.get("LTC")
        assert s is not None, f"LTC not in state for {text!r}"
        # 1 expansion + 1 abbreviation on this paragraph.
        assert len(s.exp_occurrences) >= 1, (
            f"{text!r}: expected at least one expansion hit, got {s.exp_occurrences}"
        )


def test_multi_paragraph_hyphen_space_match():
    """Mixed spellings across paragraphs all feed the same document
    state."""
    paragraphs = [
        (0, "The long-term care facility uses LTC protocols."),
        (1, "Our long term care unit is new."),
        (2, "LTC staffing is adequate."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    s = state["LTC"]
    assert len(s.abbr_occurrences) == 2
    assert len(s.exp_occurrences) == 2
    surfaces = {surface for _, _, _, surface, _ in s.exp_occurrences}
    assert "long-term care" in surfaces
    assert "long term care" in surfaces


# ─── AB05 threshold uses abbr-only count ──────────────────────────

def test_ab05_fires_on_single_abbreviation_use():
    """Canonical AB05 case: one `ICU` in a short text, no expansion,
    below the default minUses=2 → spell-out suggestion."""
    text = "The ICU was busy."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state, min_uses=2)
    ab05 = [f for f in findings if f.rule_id == "AB05"]
    assert ab05, "AB05 should fire on a single-abbreviation paragraph"
    assert ab05[0].original == "ICU"


def test_ab05_silent_on_expansion_only_prose():
    """Two ``intensive care unit`` occurrences, zero ``ICU``: AB05
    must stay silent — the abbreviation count is 0, nothing to
    spell-out-or-not. Before this fix the combined count (2) would
    have made ``abbr_count < min_uses`` pass the threshold while the
    abbr list was empty — safe today, but reaffirm."""
    text = (
        "The intensive care unit admitted two patients. "
        "Later the intensive care unit opened more beds."
    )
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state, min_uses=2)
    assert not any(f.rule_id == "AB05" for f in findings)


def test_abbr_usage_count_property_counts_only_abbreviations():
    """Pure property-level test so a future refactor can't silently
    change the count."""
    text = "The intensive care unit ran drills. The ICU team was ready."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    s = state["ICU"]
    assert s.abbr_usage_count == 1  # one ICU
    assert s.usage_count == 2       # one expansion + one abbr


# ─── Nested-paren suppression on AB01 ─────────────────────────────

def test_ab01_suppressed_when_first_use_inside_parens():
    """Expansion already inside ``(...)`` → AB01 must not fire
    (would produce ``(expansion (ABBR))`` nesting per README §10)."""
    text = (
        "The patient (intensive care unit setting) was admitted. "
        "ICU staff reviewed the chart."
    )
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state, min_uses=2)
    assert not any(f.rule_id == "AB01" for f in findings)


def test_ab01_still_fires_on_normal_first_use():
    """Belt-and-braces: nested-paren suppression must not break the
    ordinary AB01 path."""
    text = "The intensive care unit was busy. The ICU staff worked overnight."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state, min_uses=2)
    assert any(f.rule_id == "AB01" for f in findings)


def test_position_inside_parens_helper():
    text = "Hello (world) and (another (nested) group) end."
    # positions inside the outer `(world)`
    assert ab._position_inside_parens(text, text.index("world")) is True
    # position outside any parens
    assert ab._position_inside_parens(text, text.index("Hello")) is False
    # position inside the nested group — still inside (depth=2)
    assert ab._position_inside_parens(text, text.index("nested")) is True
    # position at `end.` — outside all groups
    assert ab._position_inside_parens(text, text.index("end")) is False


# ─── Medication-context classifier ────────────────────────────────

def test_medication_contexts_dose_only():
    assert ab._medication_contexts("Give 10 mg daily.") == frozenset({"dose", "order"})


def test_medication_contexts_heading_only():
    assert "order" in ab._medication_contexts("Rx: start new meds today")


def test_medication_contexts_note_heading():
    assert "note" in ab._medication_contexts("Note: patient tolerated the procedure well")


def test_medication_contexts_statistical_blocks():
    tags = ab._medication_contexts("Analysis yielded p < .05 and 95% CI 0.4 to 0.8.")
    assert "statistical" in tags


def test_medication_contexts_scientific_blocks():
    tags = ab._medication_contexts("The HPLC assay measured concentration at 2.5 mmol/L.")
    assert "scientific" in tags


def test_medication_contexts_otic():
    assert "otic" in ab._medication_contexts("Instill 2 ear drops twice daily.")


def test_medication_contexts_ophthalmic():
    assert "ophthalmic" in ab._medication_contexts("Apply 1 eye drop each morning.")


def test_medication_contexts_empty_text():
    assert ab._medication_contexts("") == frozenset()


# ─── _parse_applies_in — every workbook value handled ─────────────

@pytest.mark.parametrize("applies_in,expected_required,expected_forbidden", [
    ("Medication orders", {"order"}, set()),
    ("Medication orders and doses", {"order", "dose"}, set()),
    ("Orders and notes", {"order", "note"}, set()),
    ("Medication orders and the MAR. Scientific text may keep μg",
     {"order", "mar"}, {"scientific"}),
    ("Medication orders. MS as multiple sclerosis outside orders is allowed",
     {"order"}, set()),
    ("Medication orders and notes. Not statistical text such as p < .05",
     {"order", "note"}, {"statistical"}),
    ("Ear drops and orders", {"otic", "order"}, set()),
    ("Eye drops and orders", {"ophthalmic", "order"}, set()),
    # Fallback for unknown value.
    ("Somewhere unexpected", {"order"}, set()),
    ("", {"order"}, set()),
])
def test_parse_applies_in_all_workbook_values(applies_in, expected_required, expected_forbidden):
    required, forbidden = ab._parse_applies_in(applies_in)
    assert set(required) == expected_required
    assert set(forbidden) == expected_forbidden
