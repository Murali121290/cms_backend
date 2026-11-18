"""Unit tests for the AB07 ambiguous-abbreviation manuscript scan.

Covers the seven scenarios the Language Editing spec prescribes for the
Ambiguous-Abbreviation workflow:

1. One abbreviation with multiple possible expansions.
2. User selects one expansion — only matching occurrences are returned.
3. First valid definition is correctly identified.
4. Subsequent occurrences are shown with paragraph locations.
5. Other candidate expansions are not included (and in particular, other-
   expansion *definitions* are surfaced as ``inconsistent_definition``).
6. The chosen expansion lives on the finding row via ``edited_text`` and
   therefore persists across refresh (covered implicitly by the fact that
   the scanner is a pure function of the stored meaning + document text;
   every call with the same inputs yields the same output).
7. No automatic document text changes occur — the scanner is read-only
   and quotes each occurrence's substring verbatim.

Tests target the scanner module directly; the router hook is a thin
glue that iterates AB07 findings and calls this function, so unit tests
on the scanner cover the semantic contract.
"""
from __future__ import annotations

from app.processing.language_editing.ambiguous_scan import (
    scan_for_chosen_expansion,
)


def _paragraphs_fixture() -> list[tuple[int, str]]:
    """Clinical-style paragraphs mentioning the abbreviation ``PT`` with
    multiple plausible meanings. Para 0 defines Prothrombin Time (PT);
    Paras 1 and 2 use "PT" standalone; Para 3 uses the expanded phrase;
    Para 4 contains a competing definition "Physical Therapy (PT)"
    (same abbreviation, different expansion). Para 5 is a reference-style
    line the caller marks excluded."""
    return [
        (0, "The lab report confirmed a prolonged Prothrombin Time (PT) of 14 seconds."),
        (1, "Follow-up PT values stabilised within five days."),
        (2, "A repeated PT draw was ordered after the heparin wash-out."),
        (3, "Prothrombin Time measurements were consistent across both labs."),
        (4, "Physical Therapy (PT) rehabilitation began on day six."),
        (5, "References: Smith 2019 noted PT variability in anticoagulated patients."),
    ]


def test_single_expansion_returns_matching_occurrences():
    """Scenario 1-2: one ambiguous abbreviation with multiple candidate
    expansions; reviewer picks one; the scan returns every occurrence of
    that expansion and its abbreviation."""
    hits = scan_for_chosen_expansion(
        _paragraphs_fixture(),
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy", "Patient"],
    )
    kinds = [h["kind"] for h in hits]
    # At least one of every expected class surfaces.
    assert "first_definition" in kinds
    assert "expansion" in kinds
    assert "abbreviation" in kinds


def test_first_definition_identified_before_repeated():
    """Scenario 3: the earliest matching ``<expansion> (<abbr>)`` pattern
    is flagged ``first_definition`` with ``rule_id='AB01'``; later
    matches of the same pair become ``repeated_definition``."""
    paragraphs = _paragraphs_fixture() + [
        (6, "The hospital later re-confirmed the Prothrombin Time (PT) baseline for all patients."),
    ]
    hits = scan_for_chosen_expansion(
        paragraphs,
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy"],
    )
    defs = [h for h in hits if h["kind"] in ("first_definition", "repeated_definition")]
    assert len(defs) >= 2
    first = next(h for h in defs if h["kind"] == "first_definition")
    repeat = next(h for h in defs if h["kind"] == "repeated_definition")
    assert first["para_index"] == 0
    assert first["rule_id"] == "AB01"
    assert repeat["para_index"] == 6
    assert repeat["rule_id"] == "AB04"


def test_subsequent_occurrences_carry_paragraph_locations():
    """Scenario 4: every related occurrence beyond the first definition
    reports its (para_index, start_offset, end_offset, text)."""
    hits = scan_for_chosen_expansion(
        _paragraphs_fixture(),
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy"],
    )
    for h in hits:
        assert "para_index" in h and isinstance(h["para_index"], int)
        assert "start_offset" in h and "end_offset" in h
        assert h["end_offset"] > h["start_offset"]
        assert isinstance(h["text"], str) and h["text"]
    # Para 1's standalone "PT" surfaces explicitly.
    standalone = [h for h in hits if h["kind"] == "abbreviation" and h["para_index"] == 1]
    assert len(standalone) >= 1


def test_other_expansion_definitions_are_flagged_as_inconsistent_not_dropped():
    """Scenario 5: definitions that use a *different* candidate meaning
    for the same abbreviation show up as ``inconsistent_definition`` so
    the reviewer can see the conflict. Plain standalone matches of the
    other expansion phrase are NOT surfaced — they belong to a
    different meaning."""
    hits = scan_for_chosen_expansion(
        _paragraphs_fixture(),
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy", "Patient"],
    )
    inconsistent = [h for h in hits if h["kind"] == "inconsistent_definition"]
    assert any(
        h["para_index"] == 4 and h["conflicting_expansion"] == "Physical Therapy"
        for h in inconsistent
    )
    # No "Physical Therapy" standalone phrase surfaces because it isn't
    # the reviewer's chosen meaning — the ``expansion`` kind is reserved
    # for the chosen phrase only.
    phrase_hits = [h for h in hits if h["kind"] == "expansion"]
    assert all("Prothrombin Time" in h["text"] for h in phrase_hits)


def test_overlapping_abbreviation_inside_definition_not_double_counted():
    """Scenario 5 (dedup): the "PT" inside a "Prothrombin Time (PT)"
    definition is part of the enclosing definition classification and
    must NOT also surface as a separate ``abbreviation`` occurrence."""
    hits = scan_for_chosen_expansion(
        _paragraphs_fixture(),
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy"],
    )
    para0_hits = [h for h in hits if h["para_index"] == 0]
    # Only the first_definition should cover para 0 — the embedded PT is
    # already inside its span.
    assert len(para0_hits) == 1
    assert para0_hits[0]["kind"] == "first_definition"


def test_empty_result_when_nothing_else_occurs():
    """Scenario 9: a chosen expansion that appears nowhere else in the
    manuscript (and whose abbreviation also appears nowhere else) yields
    an empty list — no false findings."""
    paragraphs = [
        (0, "The policy document references Patient Transport (PT) once."),
        (1, "Unrelated prose about scheduling and logistics."),
    ]
    hits = scan_for_chosen_expansion(
        paragraphs,
        abbreviation="PT",
        chosen_expansion="Patient Transport",
        other_expansions=["Prothrombin Time", "Physical Therapy"],
    )
    # The only occurrence is the definition itself in para 0; no later
    # abbreviation or expansion occurs.
    assert len(hits) == 1
    assert hits[0]["kind"] == "first_definition"
    assert hits[0]["para_index"] == 0


def test_text_slices_quote_the_original_substring_verbatim():
    """Scenario 7: the scan never mutates text. Every occurrence's
    ``text`` field must equal the exact substring of the paragraph
    spanning ``[start_offset, end_offset)``."""
    paragraphs = _paragraphs_fixture()
    hits = scan_for_chosen_expansion(
        paragraphs,
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy"],
    )
    para_text = {pi: text for pi, text in paragraphs}
    for h in hits:
        assert h["text"] == para_text[h["para_index"]][h["start_offset"]: h["end_offset"]]


def test_skip_para_predicate_excludes_matching_paragraphs():
    """Reference / heading / abstract exclusions are expressed by the
    caller's ``skip_para`` predicate. The router wires in the same
    exclusion set the AB engine uses, so references never surface."""
    paragraphs = _paragraphs_fixture()
    hits = scan_for_chosen_expansion(
        paragraphs,
        abbreviation="PT",
        chosen_expansion="Prothrombin Time",
        other_expansions=["Physical Therapy"],
        skip_para=lambda pi: pi == 5,  # the references paragraph
    )
    assert all(h["para_index"] != 5 for h in hits)


def test_generic_scanner_handles_arbitrary_abbreviation_without_hardcoding():
    """The scanner is not specific to any abbreviation. A different
    workbook entry — e.g. ``AMA`` with meanings "American Medical
    Association" vs "Against Medical Advice" — yields correctly
    classified occurrences from exactly the same code path."""
    paragraphs = [
        (0, "The American Medical Association (AMA) publishes the Manual of Style."),
        (1, "He left Against Medical Advice (AMA) despite the warning."),
        (2, "AMA guidelines continue to shape editorial decisions."),
    ]
    hits = scan_for_chosen_expansion(
        paragraphs,
        abbreviation="AMA",
        chosen_expansion="American Medical Association",
        other_expansions=["Against Medical Advice"],
    )
    kinds_by_para = {h["para_index"]: h["kind"] for h in hits}
    assert kinds_by_para.get(0) == "first_definition"
    assert kinds_by_para.get(1) == "inconsistent_definition"
    assert kinds_by_para.get(2) == "abbreviation"
