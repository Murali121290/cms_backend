"""Regression tests: the abbreviation engine must not flag a workbook
expansion phrase as a standalone occurrence when it is embedded
inside a larger proper-name parenthetical definition.

Bug class
=========
Triggering text: ``National Organization of Nurse Practitioner
Faculties (NONPF)`` — the engine would find ``Nurse Practitioner``
inside the organization name and emit AB02 ("Repeated expansion")
or AB14 ("Title Case") suggesting ``NP`` / ``nurse practitioner``.

The fix is syntactic, not workbook-driven: ``(ACRONYM)`` preceded
by two or more capitalized words (with English function-word
connectors allowed between caps) marks a generic proper-name
parenthetical span. Expansion / AB14 hits inside that span are
excluded from state. NONPF, AMA, WHO, NCBR, IEEE, NATO — all
protected without being named in code.

Preserve-cases also tested
==========================
* Legitimate ``Nurse Practitioner (NP)`` first-use definition
  still registers via the existing workbook-bound detector.
* ``The nurse practitioner reviewed …`` in plain prose still
  reaches the state scanner.
* The same embedded phrase used standalone elsewhere in the
  document still participates in AB01 / AB02 / AB05.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import abbreviations_metadata as meta


@pytest.fixture(autouse=True)
def _reset_caches():
    meta.clear_cache()
    ab.clear_cache()
    yield
    meta.clear_cache()
    ab.clear_cache()


def _run(text: str) -> list:
    """Run a single-paragraph analysis and return every AB rule
    finding as (rule_id, original, suggestion) tuples."""
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    return [
        (f.rule_id, f.original, f.suggestion)
        for f in findings if f.rule_id.startswith("AB")
    ]


def _run_multi(paragraphs: list[tuple[int, str]]) -> dict[int, list]:
    """Run multi-paragraph analysis and return AB findings keyed by
    paragraph index."""
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    out: dict[int, list] = {}
    for pi, text in paragraphs:
        findings = ab.analyze_abbreviations(text, para_idx=pi, document_state=state)
        out[pi] = [
            (f.rule_id, f.original, f.suggestion)
            for f in findings if f.rule_id.startswith("AB")
        ]
    return out


# ─── Bug reproduction: NONPF-class false positives ─────────────────

def test_nonpf_embedded_nurse_practitioner_is_not_flagged():
    """The reported bug: ``Nurse Practitioner`` inside the organization
    name must NOT yield a ``nurse practitioner → NP`` or title-case
    finding. NONPF is not in the Abbreviation_List workbook, so the
    protection cannot come from the workbook-bound detector — it must
    be the generic proper-name parenthetical rule."""
    text = "The National Organization of Nurse Practitioner Faculties (NONPF) issues policy briefs."
    findings = _run(text)
    # Nothing on ``Nurse Practitioner`` — neither AB02 (repeated
    # expansion) nor AB14 (Title Case recapitalisation).
    offenders = [f for f in findings if "nurse practitioner" in f[1].lower()]
    assert offenders == [], f"expected no findings on 'Nurse Practitioner' inside NONPF, got: {offenders}"


def test_longer_org_name_with_embedded_workbook_phrase():
    """Generic coverage: an invented org name ``Society for Vascular
    Nurse Practitioner Education (SVNPE)`` must also be protected —
    the detector must not rely on knowing SVNPE or NONPF by name."""
    text = "The Society for Vascular Nurse Practitioner Education (SVNPE) met today."
    findings = _run(text)
    assert not any("nurse practitioner" in f[1].lower() for f in findings), findings


def test_who_organization_does_not_flag_embedded_phrases():
    """World Health Organization (WHO): no false-positive on any
    embedded substring (``Health Organization``, ``World Health``).
    WHO is in the workbook and gets its own definition span; the
    embedded-phrase protection should land either way."""
    text = "The World Health Organization (WHO) issued guidance."
    findings = _run(text)
    assert not any(f[0] in ("AB02", "AB14") and f[2] not in ("", None) for f in findings), findings


def test_ama_organization_does_not_flag_embedded_phrases():
    """American Medical Association (AMA): embedded ``Medical
    Association`` must not fire. AB07 (ambiguous meaning) is
    allowed — it's a separate rule class, orthogonal to this fix."""
    text = "The American Medical Association (AMA) released guidelines."
    findings = _run(text)
    # Ignore AB07 (ambiguity rule — fires because AMA has multiple
    # meanings in the workbook).
    non_ab07 = [f for f in findings if f[0] != "AB07"]
    assert non_ab07 == [], f"expected no non-AB07 findings, got: {non_ab07}"


# ─── Preserve-cases: valid workflow must still work ────────────────

def test_legit_first_use_nurse_practitioner_np_still_registers_definition():
    """``Nurse Practitioner (NP)`` on its own is a canonical first-use
    definition. The author gets no finding for this — the first-use
    rule treats the parenthetical as the definition. Our new
    proper-name detector must not DOUBLE-emit anything here; it's
    purely a parallel exclusion."""
    text = "The patient was seen. Nurse Practitioner (NP) credentials matter."
    findings = _run(text)
    # No AB02 / AB14 on the inline definition.
    assert not any(f[0] in ("AB02", "AB14") for f in findings), findings


def test_plain_prose_single_mention_is_unchanged():
    """``The nurse practitioner reviewed the patient.`` in isolation
    produces no AB finding (single use, no abbr form present).
    The generic detector must not synthesise any finding here either —
    there's no parenthetical."""
    text = "The nurse practitioner reviewed the patient."
    findings = _run(text)
    assert findings == [], findings


def test_standalone_expansion_outside_org_still_detected_by_state_build():
    """Verify the fix is TARGETED: the embedded occurrence inside
    the NONPF phrase is suppressed, but a standalone occurrence in a
    later paragraph still reaches the document state scanner and
    (depending on subsequent use of the abbreviation form) can
    legitimately drive AB01/AB02/AB05."""
    paragraphs = [
        (0, "The National Organization of Nurse Practitioner Faculties (NONPF) is influential."),
        (1, "Elsewhere, the nurse practitioner reviewed the patient."),
    ]
    findings = _run_multi(paragraphs)
    # No false-positive in para 0 (suppressed by the proper-name span).
    assert not any("nurse practitioner" in f[1].lower() for f in findings[0]), findings[0]
    # Para 1 has a standalone "nurse practitioner" — it's in state and
    # eligible for AB rules. (With no abbr "NP" anywhere in the doc
    # and only one expansion mention, no AB rule necessarily fires;
    # the invariant we care about is simply that para 1's exp hit was
    # NOT also suppressed by mistake. We verify by confirming the
    # state scan reaches that occurrence.)
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    np_state = state.get("NP")
    assert np_state is not None, "NP must be an eligible workbook entry"
    exp_paras = {occ[0] for occ in np_state.exp_occurrences}
    assert 1 in exp_paras, "standalone 'nurse practitioner' at para 1 must survive"
    assert 0 not in exp_paras, "the embedded hit at para 0 must be excluded"


def test_subsequent_legitimate_abbreviation_usage_still_fires():
    """After a legit first-use definition, a bare abbreviation in a
    later paragraph must still be analysed normally. The fix does
    not change rule execution — it only excludes false-positive
    exp hits inside proper-name parentheticals."""
    paragraphs = [
        (0, "A nurse practitioner reviewed the patient."),  # pre-definition expansion
        (1, "Nurse Practitioner (NP) credentials matter."),  # definition
        (2, "Later, the nurse practitioner did rounds."),    # post-definition expansion → AB02 candidate
    ]
    findings = _run_multi(paragraphs)
    # Para 1's "Nurse Practitioner" inside the definition is NOT an AB02.
    assert not any(f[0] == "AB02" and f[1] == "Nurse Practitioner" for f in findings[1]), findings[1]
    # The definition is registered (state has a definition for NP).
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    assert state["NP"].defined_anywhere, "NP must be registered as defined"


# ─── Guard-rail: do not over-suppress ──────────────────────────────

def test_lowercase_parenthetical_does_not_create_suppression_span():
    """``(see Figure 1)`` and similar lowercase parentheticals must
    not create a proper-name span. Without this, every parenthetical
    aside would blind the engine to surrounding text."""
    from app.processing.language_editing.abbreviations import (
        _find_proper_name_parenthetical_spans,
    )
    assert _find_proper_name_parenthetical_spans("Some text (see Figure 1) here.") == []
    assert _find_proper_name_parenthetical_spans("The patient (age 42) arrived.") == []
    assert _find_proper_name_parenthetical_spans("A result (p < 0.05) was found.") == []


def test_single_capitalized_word_before_acronym_does_not_trigger():
    """``Nurse (NP)`` — one capital word is not enough to constitute
    a proper name. Only 2+ capitals form a protection span. Without
    this guard-rail, every mid-sentence capital followed by a
    parenthetical acronym would wrongly protect its surroundings."""
    from app.processing.language_editing.abbreviations import (
        _find_proper_name_parenthetical_spans,
    )
    # One capital word: no span.
    assert _find_proper_name_parenthetical_spans("Nurse (NP) reviewed.") == []
    # Two capital words: span created.
    spans = _find_proper_name_parenthetical_spans("Family Nurse (FN) reviewed.")
    assert len(spans) == 1
    # Three capital words with a connector: span created.
    spans = _find_proper_name_parenthetical_spans("National Center for Biotech (NCB) opened.")
    assert len(spans) == 1


def test_sentence_boundary_blocks_the_leftward_walk():
    """A proper-name walk must not reach back across a sentence
    boundary. Previous sentence capitals belong to their own
    context and must not fuse with a new sentence's parenthetical."""
    from app.processing.language_editing.abbreviations import (
        _find_proper_name_parenthetical_spans,
    )
    # Previous sentence ended with "Research." — the walk must stop
    # there, so only "Nurse" remains before "(NP)" and that's one
    # capital word, below the 2-cap threshold → no span.
    text = "We completed the Research. Nurse (NP) reviewed."
    assert _find_proper_name_parenthetical_spans(text) == []


def test_acronym_shape_requirement():
    """The parenthetical must LOOK like an acronym (2-10 uppercase
    letters/digits, optional interior hyphen). Lowercase or mixed-
    case parentheticals do not create spans."""
    from app.processing.language_editing.abbreviations import (
        _find_proper_name_parenthetical_spans,
    )
    # Mixed case → no span.
    assert _find_proper_name_parenthetical_spans("The Foo Bar (Baz) ran.") == []
    # Single uppercase letter → below minimum length (regex requires 2+).
    assert _find_proper_name_parenthetical_spans("The Foo Bar (X) ran.") == []
    # Interior hyphen OK (COVID-19, G-8).
    spans = _find_proper_name_parenthetical_spans("The Coronavirus Disease Outbreak (COVID-19) started.")
    assert len(spans) == 1
