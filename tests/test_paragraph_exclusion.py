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
