"""Regression test for joint-eponym detection in the Hyphenation module.

Prior behaviour
---------------
The En_Dash_Terms workbook ships 11 "Joint eponym" rows (Kaplan–Meier,
Mann–Whitney, Hardy–Weinberg, Epstein–Barr, Guillain–Barré,
Wolff–Parkinson–White, Stevens–Johnson, Cheyne–Stokes, …) whose two
style axes disagree: Chicago/AMA/APA prefer the en dash while the
Merriam-Webster headword uses the hyphen. Under the default ``all``
profile ``_active_en_dash_expectation`` returned ``"both"`` and the
emission loop skipped the row entirely, so these compounds never
reached the Hyphenation findings panel — reviewers had no visibility
on whether the author had used them consistently.

Fixed behaviour
---------------
When the expectation is ``"both"`` and both surface forms are defined,
``_en_dash_findings`` now surfaces every in-text occurrence of either
form as an informational finding:

  * ``category='hyphenation'`` — shows in the Hyphenation panel.
  * ``autofixable=False`` — the fix is the reviewer's judgement.
  * ``alt_suggestions`` carries the other style form so the reviewer
    can swap it in with one click.
  * Text is quoted verbatim in ``original`` — no mutation.

The style-neutral verdict in ``message`` makes the purpose explicit:
"both forms accepted — review for consistency".
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import hyphen_dash


@pytest.fixture(autouse=True)
def _reset_caches():
    hyphen_dash.clear_cache()
    yield
    hyphen_dash.clear_cache()


SPEC_PARAGRAPH = (
    "The manuscript discussed Kaplan-Meier survival estimates and "
    "compared them using the Mann–Whitney test. Additional analyses "
    "included the Hardy–Weinberg equilibrium assessment and a review "
    "of Epstein–Barr virus prevalence. Several patients were evaluated "
    "for Guillain–Barré syndrome, and one case involved "
    "Wolff–Parkinson–White syndrome."
)


def _run(text: str, profile: str = "all") -> list[tuple[str, str, list, bool]]:
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile=profile)
    return [
        (f.rule_id, f.original, list(f.alt_suggestions or []), f.autofixable)
        for f in findings
    ]


def test_every_joint_eponym_in_spec_paragraph_is_detected():
    """All six compounds — including the hyphen-written Kaplan-Meier and
    the triple-barrel Wolff–Parkinson–White — surface in the
    Hyphenation panel with the alternative form populated."""
    hits = _run(SPEC_PARAGRAPH)
    originals = [h[1] for h in hits]
    assert "Kaplan-Meier" in originals
    assert "Mann–Whitney" in originals
    assert "Hardy–Weinberg" in originals
    assert "Epstein–Barr" in originals
    assert "Guillain–Barré" in originals
    assert "Wolff–Parkinson–White" in originals


def test_joint_eponym_findings_are_advisory_not_autofix():
    """Joint eponyms must stay ``autofixable=False`` — Accept All should
    never silently flip every eponym to one style. The reviewer picks
    per document."""
    hits = _run(SPEC_PARAGRAPH)
    for rule_id, original, _alt, autofix in hits:
        if rule_id.startswith("EN-"):
            assert autofix is False, (
                f"joint-eponym finding {rule_id} on {original!r} must be "
                f"advisory (autofixable=False)"
            )


def test_hyphen_written_eponym_surfaces_en_dash_alternative():
    """``Kaplan-Meier`` (hyphen) must suggest ``Kaplan–Meier`` (en dash)
    — the Chicago/AMA/APA-preferred form — in ``alt_suggestions``."""
    hits = _run(SPEC_PARAGRAPH)
    for rule_id, original, alt, _autofix in hits:
        if original == "Kaplan-Meier":
            assert alt == ["Kaplan–Meier"], f"unexpected alt: {alt}"
            return
    pytest.fail("Kaplan-Meier was not detected")


def test_en_dash_written_eponym_surfaces_hyphen_alternative():
    """``Mann–Whitney`` (en dash) must surface the MW-style hyphen form
    as the alternative so a document following MW headwords can swap
    in one click."""
    hits = _run(SPEC_PARAGRAPH)
    for rule_id, original, alt, _autofix in hits:
        if original == "Mann–Whitney":
            assert alt == ["Mann-Whitney"]
            return
    pytest.fail("Mann–Whitney was not detected")


def test_triple_barrel_eponym_matched_atomically():
    """``Wolff–Parkinson–White`` surfaces as ONE finding covering the
    whole triple-barrel compound — not three overlapping Stevens-style
    pair matches."""
    hits = [h for h in _run(SPEC_PARAGRAPH) if "Wolff" in h[1]]
    assert len(hits) == 1
    assert hits[0][1] == "Wolff–Parkinson–White"
    assert hits[0][2] == ["Wolff-Parkinson-White"]


def test_findings_quote_original_text_verbatim():
    """The text in ``original`` must be the exact substring of the
    paragraph — case, punctuation, accents preserved. The engine never
    mutates the author's text."""
    findings = hyphen_dash.analyze_hyphen_dash(SPEC_PARAGRAPH, dash_profile="all")
    for f in findings:
        if f.rule_id.startswith("EN-"):
            assert f.original == SPEC_PARAGRAPH[f.start:f.end]


def test_profile_chicago_still_emits_autofixable_findings_for_joint_eponyms():
    """Under the Chicago/AMA/APA-explicit profile, joint eponyms resolve
    to an unambiguous expectation (en dash). The engine continues to
    emit autofixable findings for the hyphen form under that profile —
    this fix must not break the explicit-profile path."""
    text_hyphen_only = "The Kaplan-Meier curve was plotted."
    hits = _run(text_hyphen_only, profile="chicago_ama_apa")
    assert any(h[0].startswith("EN-") and h[3] is True for h in hits), (
        f"expected an autofixable EN finding under chicago_ama_apa: {hits}"
    )


def test_category_tagged_hyphenation_so_the_panel_groups_them():
    """The finding ``category`` must remain ``hyphenation`` so the
    frontend's Hyphenated Words tab groups these compounds alongside
    the rest of the dash-workbook findings."""
    findings = hyphen_dash.analyze_hyphen_dash(SPEC_PARAGRAPH, dash_profile="all")
    eponym_findings = [f for f in findings if f.rule_id.startswith("EN-")]
    assert eponym_findings, "no EN-* findings emitted for the spec paragraph"
    for f in eponym_findings:
        assert f.category == "hyphenation"


def test_input_text_is_not_mutated():
    """The analyzer is read-only. The paragraph string must come out
    byte-for-byte identical."""
    before = SPEC_PARAGRAPH
    hyphen_dash.analyze_hyphen_dash(SPEC_PARAGRAPH, dash_profile="all")
    assert SPEC_PARAGRAPH == before
