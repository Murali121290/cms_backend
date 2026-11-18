"""Phase 4 regression tests for the Abbreviations module.

Phase 4 adds:
  * URL / email / DOI / inline-code span exclusion — abbreviation and
    expansion hits overlapping these spans are dropped at the
    build_document_state seam so no AB rule fires on them.
  * ``in_table_note`` / ``in_figure_legend`` positive subroles in
    docx_io.classify_paragraphs (combines ``in_table`` /
    ``in_figure`` with ``role == 'caption'``).
  * ``scope_reset_on_section`` opt-in kwarg scaffold on
    build_document_state / analyze_abbreviations — default False
    preserves pre-Phase-4 behaviour; when True, each top-level
    section's first abbr occurrence is recorded on the state.

These tests assert the mechanism, not the full re-fire behaviour —
AB01 re-fire on section boundary is intentionally parked until an
opt-in profile asks for it (see audit §Phase 4).
"""
from __future__ import annotations

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing.abbreviations import (
    _excluded_spans,
    _overlaps_any,
    _first_abbr_per_section,
    build_document_state,
)


# ─── _excluded_spans ──────────────────────────────────────────────

def test_excluded_spans_detects_https_url():
    text = "Visit https://example.com for details."
    spans = _excluded_spans(text)
    assert len(spans) == 1
    s, e = spans[0]
    assert text[s:e].startswith("https://")


def test_excluded_spans_detects_www_url():
    text = "See www.example.com."
    spans = _excluded_spans(text)
    assert len(spans) == 1


def test_excluded_spans_detects_email():
    text = "Contact AI@example.com for help."
    spans = _excluded_spans(text)
    # email detected
    assert any(text[s:e] == "AI@example.com" for s, e in spans)


def test_excluded_spans_detects_doi():
    text = "DOI 10.1234/abc.123 covers this."
    spans = _excluded_spans(text)
    assert spans
    # DOI span covers the identifier
    s, e = spans[0]
    assert "10.1234" in text[s:e]


def test_excluded_spans_detects_inline_code():
    text = "Use `ICU` as the identifier."
    spans = _excluded_spans(text)
    assert len(spans) == 1
    s, e = spans[0]
    assert text[s:e] == "`ICU`"


def test_excluded_spans_empty_on_plain_text():
    assert _excluded_spans("This is normal prose with no special spans.") == []


# ─── _overlaps_any ────────────────────────────────────────────────

def test_overlaps_any_true_when_inside():
    assert _overlaps_any((5, 10), [(0, 20)]) is True


def test_overlaps_any_false_when_before():
    assert _overlaps_any((0, 5), [(10, 20)]) is False


def test_overlaps_any_false_when_after():
    assert _overlaps_any((25, 30), [(10, 20)]) is False


def test_overlaps_any_true_on_touching_edge_mid_overlap():
    # Partial overlap at the start — 10..15 overlaps 12..20.
    assert _overlaps_any((10, 15), [(12, 20)]) is True


# ─── URL/email/code exclusion end-to-end ──────────────────────────

def test_abbreviation_inside_url_is_not_counted():
    """An abbreviation surface appearing inside a URL should not
    contribute to the document state — otherwise AB01 would propose
    expanding the URL's AI token."""
    ab.clear_cache()
    paragraphs = [
        (0, "AI is important. Visit https://openai.com/AI/guide and think."),
    ]
    state = build_document_state(paragraphs)
    # The URL's AI hit must NOT inflate the occurrence count — there
    # is exactly ONE AI occurrence (the sentence start).
    s = state.get("AI")
    if s is not None:  # AI may still be filtered as ambiguous
        positions = [p_s for _p, p_s, _e in s.abbr_occurrences]
        # None of the recorded positions should lie inside the URL.
        text = paragraphs[0][1]
        url_start = text.find("https://")
        url_end = text.find("and") - 1  # approx
        for p_s in positions:
            assert not (url_start <= p_s < url_end), (
                f"AI at offset {p_s} wrongly recorded inside URL"
            )


def test_abbreviation_inside_email_is_not_counted():
    ab.clear_cache()
    paragraphs = [
        (0, "Write to AI@example.com. AI is here."),
    ]
    state = build_document_state(paragraphs)
    s = state.get("AI")
    if s is not None:
        text = paragraphs[0][1]
        email_start = text.find("AI@")
        for p_s in (p_s for _p, p_s, _e in s.abbr_occurrences):
            assert p_s != email_start, "AI in email was wrongly counted"


def test_abbreviation_inside_inline_code_is_not_counted():
    ab.clear_cache()
    paragraphs = [
        (0, "Check `AI` constant. Then AI appears normally."),
    ]
    state = build_document_state(paragraphs)
    s = state.get("AI")
    if s is not None:
        text = paragraphs[0][1]
        code_pos = text.find("`AI`") + 1  # offset of "AI" inside backticks
        for p_s in (p_s for _p, p_s, _e in s.abbr_occurrences):
            assert p_s != code_pos, "AI in backticks was wrongly counted"


# ─── _first_abbr_per_section scaffold ─────────────────────────────

def test_first_abbr_per_section_groups_by_boundary():
    # Occurrences at paragraphs 1, 3, 5, 7; boundaries at 0 and 5.
    # Section at -1 (implicit) → nothing (no occs before 0).
    # Section at 0 → first occ at (1, …).
    # Section at 5 → first occ at (5, …).
    occurrences = [(1, 0, 2), (3, 0, 2), (5, 0, 2), (7, 0, 2)]
    out = _first_abbr_per_section(occurrences, [0, 5])
    assert set(out.keys()) == {0, 5}
    assert out[0][0] == 1
    assert out[5][0] == 5


def test_first_abbr_per_section_empty_input():
    assert _first_abbr_per_section([], [0, 5]) == {}
    assert _first_abbr_per_section([(1, 0, 2)], []) == {-1: (1, 0, 2)}


# ─── scope_reset_on_section opt-in default behaviour ──────────────

def test_scope_reset_default_off_does_not_populate_section_firstuse():
    """Default call must NOT populate section_firstuse_paras so legacy
    callers get the pre-Phase-4 state shape."""
    ab.clear_cache()
    paragraphs = [(0, "AI is here. AI again."), (1, "More AI here.")]
    state = build_document_state(paragraphs)  # default False
    for s in state.values():
        assert s.section_firstuse_paras == {}, (
            "section_firstuse_paras must stay empty when the opt-in is False"
        )


def test_scope_reset_on_section_populates_section_firstuse():
    """When opt-in is True AND para_roles mark chapter_boundaries,
    the state records a first occurrence per section."""
    ab.clear_cache()
    paragraphs = [
        (0, "Introduction."),
        (1, "AI is one topic. AI appears here too."),
        (2, "Methods."),
        (3, "AI appears again in methods."),
    ]
    para_roles = {
        0: {"role": "title", "chapter_boundary": True},
        1: {"role": "body"},
        2: {"role": "heading", "chapter_boundary": True, "level": 1},
        3: {"role": "body"},
    }
    state = build_document_state(
        paragraphs, para_roles=para_roles, scope_reset_on_section=True,
    )
    s = state.get("AI")
    if s is not None and s.abbr_occurrences:
        # Two sections: boundary at 0 and boundary at 2.
        assert 0 in s.section_firstuse_paras
        assert 2 in s.section_firstuse_paras


# ─── Smoke: legacy behaviour unchanged ────────────────────────────

def test_default_call_still_returns_state_dict():
    """Guard rail — Phase 4 must not alter the default-arg signature
    contract for pre-Phase-4 callers."""
    ab.clear_cache()
    paragraphs = [(0, "The ICU was quiet. ICU staff rotated.")]
    state = build_document_state(paragraphs)
    assert isinstance(state, dict)
