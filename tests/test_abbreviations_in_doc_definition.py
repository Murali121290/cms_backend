"""Regression test: when the author writes an explicit ``<expansion>
(<abbr>)`` definition for an ambiguous abbreviation, the engine must
NOT flag later standalone uses of that abbreviation as AB07
"ambiguous".

Context
-------
``_detect_definitions`` only sees the ``chosen_entry.expansion`` the
upstream ``_pick_entry`` selected. For an ambiguous abbreviation with
multiple workbook meanings (e.g. ``ACS`` → "acute coronary syndrome" |
"American Cancer Society"), the previous Phase-C disambiguation path
ran cue-word scoring at the first standalone occurrence; when both
candidates tied at zero the engine marked ``context_resolved=False``
and AB07 fired, even though the author had written the definition
inline. That produced spurious "ambiguous abbreviation — ask the
author" findings on paragraphs that were already correctly defined.

Fix behaviour
-------------
* If ``s.definitions`` is non-empty, the author has explicitly
  disambiguated — trust it, mark ``context_resolved=True``, and let
  Phase-B rules proceed on the chosen meaning.
* If the detector missed the definition because ``_pick_entry`` chose
  the wrong candidate, re-scan every entry's expansion across all
  paragraphs; when exactly one candidate matches, switch
  ``chosen_entry`` to it and attach its definitions.
* Text is never mutated — these helpers are read-only.
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
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    return [
        (f.rule_id, f.original, f.suggestion)
        for f in findings if f.rule_id.startswith("AB")
    ]


# ─── The user's regression paragraph ────────────────────────────────

SPEC_PARAGRAPH = (
    "The patient was admitted with acute coronary syndrome (ACS) and "
    "transferred to the intensive care unit (ICU). Initial laboratory "
    "tests included C-reactive protein (CRP) and B-type natriuretic "
    "peptide [BNP] measurements. ACS symptoms resolved after treatment, "
    "and ICU monitoring was discontinued after 48 hours. CRP levels "
    "decreased significantly, whereas BNP remained mildly elevated."
)


def test_correctly_defined_ambiguous_abbreviation_is_not_flagged():
    """The user's spec paragraph: four abbreviations are introduced with
    canonical ``<expansion> (abbr)`` / ``<expansion> [abbr]`` definitions
    and then reused in short form later. ACS is the ambiguous one in
    the workbook (acute coronary syndrome vs American Cancer Society);
    the explicit "acute coronary syndrome (ACS)" definition must resolve
    the ambiguity and suppress AB07.
    """
    findings = _run(SPEC_PARAGRAPH)
    ab07_hits = [f for f in findings if f[0] == "AB07"]
    assert ab07_hits == [], (
        f"AB07 fired on a correctly-defined ambiguous abbreviation: {ab07_hits}"
    )
    # ACS was defined; "ACS symptoms" is a standalone subsequent use.
    # Neither should be flagged.
    acs_hits = [
        f for f in findings
        if " ACS" in f[1] or f[1].strip() == "ACS" or "acute coronary syndrome" in f[1].lower()
    ]
    assert acs_hits == [], f"ACS first-definition or subsequent use was flagged: {acs_hits}"


def test_unique_abbreviations_in_spec_paragraph_are_not_flagged():
    """ICU / CRP / BNP are unique in the workbook. They are introduced
    with canonical definitions and reused later; the engine must emit
    no AB findings on any of them."""
    findings = _run(SPEC_PARAGRAPH)
    for abbr, expansion in [
        ("ICU", "intensive care unit"),
        ("CRP", "C-reactive protein"),
        ("BNP", "B-type natriuretic peptide"),
    ]:
        offenders = [
            f for f in findings
            if abbr in f[1] or expansion.lower() in (f[1] or "").lower()
        ]
        assert offenders == [], (
            f"{abbr} / {expansion} — correctly defined but flagged: {offenders}"
        )


def test_in_document_definition_overrides_default_pick_entry_choice():
    """When ``_pick_entry`` would normally default to the "wrong" candidate
    (workbook row order), an explicit in-document definition using a
    different candidate's expansion must make the engine switch to that
    candidate and NOT fire AB07."""
    # Pick the ambiguous meaning that is NOT ``_pick_entry``'s default.
    entries = ab._abbr_entries_by_abbr()["ACS"]
    default = ab._pick_entry(entries)
    other = next(e for e in entries if e.id != default.id)
    text = f"The {other.expansion} ({ 'ACS' }) issued new guidelines last year. ACS reports are published annually."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    s = state["ACS"]
    assert s.chosen_entry is not None
    assert s.chosen_entry.expansion.lower() == other.expansion.lower(), (
        f"engine must switch to the author's chosen meaning "
        f"(got {s.chosen_entry.expansion!r}, expected {other.expansion!r})"
    )
    assert s.context_resolved is True
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert not any(f.rule_id == "AB07" for f in findings), (
        f"AB07 must not fire — the author defined the term inline: "
        f"{[(f.rule_id, f.original) for f in findings]}"
    )


def test_still_fires_ab07_when_no_definition_disambiguates():
    """Guardrail: the fix must not over-suppress AB07. An ambiguous
    abbreviation used *without* an in-document definition — and whose
    cue words don't score a single winner — must still surface AB07 so
    the reviewer can disambiguate."""
    text = "The ACS session concluded with a policy vote."
    findings = _run(text)
    assert any(f[0] == "AB07" for f in findings), (
        f"AB07 must still fire when the author hasn't defined the "
        f"ambiguous abbreviation inline: {findings}"
    )


def test_bracketed_definition_also_resolves_ambiguity():
    """Square-bracket style ``<expansion> [abbr]`` (common in some
    medical journals) is a valid first-use definition and must also
    resolve ambiguity.
    """
    entries = ab._abbr_entries_by_abbr()["ACS"]
    exp = entries[0].expansion
    text = f"Initial screening confirmed {exp} [ACS]. Follow-up ACS workup followed."
    state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
    assert state["ACS"].context_resolved is True
    findings = ab.analyze_abbreviations(text, para_idx=0, document_state=state)
    assert not any(f.rule_id == "AB07" for f in findings), (
        f"square-bracket definition must resolve ambiguity: {findings}"
    )


def test_fix_does_not_mutate_input_paragraph_text():
    """The in-document-definition resolver is read-only. The paragraphs
    list passed in must come out byte-for-byte identical."""
    paragraphs = [(0, SPEC_PARAGRAPH)]
    before = list(paragraphs)
    ab.build_document_state(paragraphs, audience="general", min_uses=2)
    assert paragraphs == before, "paragraphs input must not be mutated"
