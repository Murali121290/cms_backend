"""Regression tests for paragraph-level exclusion of five document regions.

Requirement: ``ref``, ``epigraph``, ``heading``, ``src``, ``table`` must
be invisible to every Language Editing rule (grammar, spelling,
sentence, abbreviations, hyphenation, medical_terms, lww_ne, workbook
rules, custom rules, spell_check, term_matcher). The exclusion is
applied once at the router's analyze loop (see
``app/routers/language_edit.py`` — ``_is_excluded_paragraph``) using
role / region flags produced by ``docx_io.classify_paragraphs``.

These tests cover the classifier side (the policy applied in the
router is a single ``continue`` statement that is covered by the
engine-integration suite elsewhere).
"""
from __future__ import annotations

from docx import Document

from app.processing.language_editing import docx_io


def _make_doc(*blocks):
    """Build an in-memory doc. Each block is (text, style_name_or_None)."""
    doc = Document()
    for text, style in blocks:
        p = doc.add_paragraph()
        p.add_run(text)
        if style:
            try:
                p.style = doc.styles[style]
            except KeyError:
                from docx.enum.style import WD_STYLE_TYPE
                doc.styles.add_style(style, WD_STYLE_TYPE.PARAGRAPH)
                p.style = doc.styles[style]
    return doc


# ─── Boundary-tag region tracking ───────────────────────────────────

def test_classify_paragraphs_epigraph_boundary_tag():
    """``<epigraph>…</epigraph>`` sets in_epigraph on every paragraph
    inside the region (including the tag paragraphs themselves) and
    clears once </epigraph> passes."""
    doc = _make_doc(
        ("<epigraph>", None),
        ("The quote body goes here.", None),
        ("Second line of the quote.", None),
        ("</epigraph>", None),
        ("Normal body text after.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_epigraph"] is True
    assert roles[1]["in_epigraph"] is True
    assert roles[2]["in_epigraph"] is True
    assert roles[3]["in_epigraph"] is True   # closing tag still counts as inside
    assert roles[4]["in_epigraph"] is False  # region closed


def test_classify_paragraphs_src_boundary_tag():
    """``<src>…</src>`` behaves the same as other region tags."""
    doc = _make_doc(
        ("<src>", None),
        ("print('hello world')", None),
        ("return 0", None),
        ("</src>", None),
        ("Discussion of the code.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_src"] is True
    assert roles[1]["in_src"] is True
    assert roles[2]["in_src"] is True
    assert roles[3]["in_src"] is True
    assert roles[4]["in_src"] is False


# ─── Style-based detection ──────────────────────────────────────────

def test_classify_paragraphs_epigraph_style_name():
    """A paragraph styled ``Epigraph`` (literal Word style) opens the
    region. Mirrors the existing Abstract style behaviour: style-based
    opening stays active until an explicit ``</epigraph>`` tag closes
    it — this is intentional so a multi-paragraph epigraph with only a
    style and no boundary tags still gets fully excluded."""
    doc = _make_doc(
        ("A quote at chapter opening.", "Epigraph"),
        ("Second line of the same epigraph.", "Epigraph"),
        ("</epigraph>", None),
        ("Normal body paragraph.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_epigraph"] is True
    assert roles[1]["in_epigraph"] is True
    assert roles[2]["in_epigraph"] is True   # closing tag still counts as inside
    assert roles[3]["in_epigraph"] is False  # region explicitly closed


def test_classify_paragraphs_source_code_styles():
    """Common code / source style names open an in_src region."""
    for style_name in ("Code", "Source", "SourceCode", "CodeBlock"):
        doc = _make_doc(
            (f"x = 1  # styled as {style_name}", style_name),
            ("Normal text.", None),
        )
        roles = docx_io.classify_paragraphs(doc)
        assert roles[0]["in_src"] is True, f"style {style_name!r} did not open in_src"
        # Style-based opening does NOT auto-close — the next paragraph
        # stays flagged until an explicit </src> tag is seen. This is
        # intentional, mirroring how the Abstract / Table / Figure
        # style-opening behaves in the existing classifier.
        assert roles[1]["in_src"] is True


# ─── Nesting / co-occurrence ────────────────────────────────────────

def test_classify_paragraphs_epigraph_nested_inside_other_regions():
    """Nested regions compose: a heading inside a table should carry
    both role='heading' AND in_table=True. Mirroring that, an epigraph
    style inside a table carries in_epigraph AND in_table."""
    doc = _make_doc(
        ("<table>", None),
        ("Cell with quote:", None),
        ("Nested epigraph line.", "Epigraph"),
        ("</table>", None),
        ("Back to body.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[2]["in_table"] is True
    assert roles[2]["in_epigraph"] is True


def test_classify_paragraphs_src_and_table_can_coexist():
    """src block inside a table — both flags set together."""
    doc = _make_doc(
        ("<table>", None),
        ("<src>", None),
        ("code_line", None),
        ("</src>", None),
        ("</table>", None),
        ("Body.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[2]["in_table"] is True
    assert roles[2]["in_src"] is True
    assert roles[5]["in_table"] is False
    assert roles[5]["in_src"] is False


# ─── Pre-existing region flags still work (no regression) ───────────

def test_classify_paragraphs_existing_abstract_table_figure_unchanged():
    """The new flags must not break the existing in_abstract / in_table /
    in_figure detection — a sanity check against regressions."""
    doc = _make_doc(
        ("<abstract>", None),
        ("Abstract body.", None),
        ("</abstract>", None),
        ("<table>", None),
        ("Cell.", None),
        ("</table>", None),
        ("<figure>", None),
        ("Caption.", None),
        ("</figure>", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[1]["in_abstract"] is True
    assert roles[4]["in_table"] is True
    assert roles[7]["in_figure"] is True
    # New flags default to False where the region isn't open.
    for idx in range(9):
        assert roles[idx]["in_epigraph"] is False, f"para {idx} wrongly in_epigraph"
        assert roles[idx]["in_src"] is False, f"para {idx} wrongly in_src"


# ─── Keys always present on every paragraph dict ────────────────────

def test_classify_paragraphs_new_keys_always_present():
    """Every paragraph dict must carry in_epigraph and in_src keys —
    the router's exclusion check uses ``roles.get(flag)`` which tolerates
    missing keys, but keeping the shape consistent avoids surprise when
    other callers iterate the role dict."""
    doc = _make_doc(
        ("Plain body paragraph.", None),
        ("Another body paragraph.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    for idx, meta in roles.items():
        assert "in_epigraph" in meta, f"para {idx} missing in_epigraph key"
        assert "in_src" in meta, f"para {idx} missing in_src key"
        assert meta["in_epigraph"] is False
        assert meta["in_src"] is False


# ─── Informal title detection (100%-bold + no terminal punctuation) ─

def _make_bold_doc(*blocks):
    """Build an in-memory doc where each block controls per-run bolding.

    Each block is a tuple ``(runs, style_name_or_None)`` where ``runs``
    is a list of ``(text, is_bold)`` pairs. Lets us assemble a paragraph
    with mixed-bold runs that mirror real DOCX structure — authors bold
    key terms via separate runs, so a body paragraph has
    ``[("The ", False), ("acid-base", True), (" balance", False), …]``.
    """
    doc = Document()
    for runs, style in blocks:
        p = doc.add_paragraph()
        for text, is_bold in runs:
            r = p.add_run(text)
            if is_bold:
                r.bold = True
        if style:
            try:
                p.style = doc.styles[style]
            except KeyError:
                from docx.enum.style import WD_STYLE_TYPE
                doc.styles.add_style(style, WD_STYLE_TYPE.PARAGRAPH)
                p.style = doc.styles[style]
    return doc


def test_informal_title_fully_bold_no_terminal_punctuation_classified_as_heading():
    """The screenshot case: ``THE STUDY`` (all-caps, 100% bold, no
    terminal) in a ``Normal``-styled paragraph. Must be classified as
    heading so the router gate excludes it from every rule."""
    doc = _make_bold_doc(
        ([("THE STUDY", True)], None),
        ([("Impact of evidence-based community care on long-term recovery and quality of life", True)], None),
        ([("The study examined the relationship between the two conditions.", False)], None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] == "heading", roles[0]
    assert roles[1]["role"] == "heading", roles[1]
    assert roles[2]["role"] == "body", roles[2]


def test_informal_title_mixed_bold_body_stays_body():
    """A body paragraph with bold emphasis on key terms (mixed
    boldness) must NOT be mis-classified as a heading — this is the
    most common false-positive risk for the heuristic."""
    doc = _make_bold_doc(
        (
            [
                ("The study examined the relationship between ", False),
                ("acid-base balance", True),
                (", ", False),
                ("quality of life", True),
                (", and long-term recovery.", False),
            ],
            None,
        ),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] == "body"


def test_informal_title_fully_bold_with_terminal_punctuation_stays_body():
    """Even if the whole paragraph is bold, a terminator at the end
    means it's a bolded sentence, not a title. Role stays ``body`` and
    normal rules fire."""
    doc = _make_bold_doc(
        ([("This entire sentence is bolded for emphasis.", True)], None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] == "body"


def test_informal_title_no_bolding_at_all_stays_body():
    """Short Normal paragraphs without bolding and without a terminator
    (e.g. a one-word form response) stay as body. Bold is the primary
    signal — all-caps / short alone isn't enough."""
    doc = _make_bold_doc(
        ([("STOP", False)], None),
        ([("Yes", False)], None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] == "body"
    assert roles[1]["role"] == "body"


def test_informal_title_style_based_heading_still_wins():
    """A properly-styled ``Heading 1`` paragraph continues to classify
    as heading; the informal-title heuristic sits below the style
    check in the elif chain so it never overrides."""
    doc = _make_bold_doc(
        ([("Chapter 1: Introduction", False)], "Heading 1"),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] in ("heading", "title")


def test_informal_title_empty_paragraph_stays_body():
    """An empty / whitespace-only paragraph must not accidentally hit
    the informal-title path (``_is_informal_title`` returns False for
    empty text so the role stays at its default ``body``)."""
    doc = _make_bold_doc(
        ([("   ", False)], None),
        ([("", False)], None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] == "body"
    assert roles[1]["role"] == "body"


def test_informal_title_sample_docx_screenshot_regression():
    """Snapshot against the live DOCX from the user's screenshot.
    Para 1 ``THE STUDY`` and Para 2 ``Impact of evidence-based …``
    must both be classified as heading so the terminal_punctuation
    rule can never fire on them. Skips cleanly if the fixture file
    isn't present in the dev checkout."""
    import os
    from docx import Document
    sample = (
        '/Users/kavuthamapriya/cms_backend/runtime/data/uploads/'
        'Artech House/PRJ-3/01/Manuscript/Sample text_for testing_1.docx'
    )
    if not os.path.exists(sample):
        import pytest
        pytest.skip("sample DOCX not present in this checkout")
    d = Document(sample)
    roles = docx_io.classify_paragraphs(d)
    assert roles[0]["role"] == "heading", (
        f"Para 1 'THE STUDY' misclassified: {roles[0]}"
    )
    assert roles[1]["role"] == "heading", (
        f"Para 2 'Impact of evidence-based ...' misclassified: {roles[1]}"
    )
    assert roles[2]["role"] == "body", roles[2]  # real body prose

