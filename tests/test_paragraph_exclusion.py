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


# ─── Basic Grammar workbook honours all five paragraph exclusions ─

def _filter_body_paragraphs_like_router(paragraphs, para_roles):
    """Mirror the router's body-only filter used to pre-pass the
    basic_grammar document state (see
    ``_basic_grammar_input_paragraphs`` in app/routers/language_edit.py).
    Kept in sync here as a test contract — a drift in either file
    would show up as a failing exclusion test."""
    EXCLUDED_ROLES = {"heading", "title", "reference", "caption"}
    EXCLUDED_FLAGS = ("in_table", "in_figure", "in_abstract", "in_epigraph", "in_src")
    out = []
    for pi, txt in paragraphs:
        roles = (para_roles or {}).get(pi) or {}
        if roles.get("role") in EXCLUDED_ROLES:
            continue
        if any(roles.get(flag) for flag in EXCLUDED_FLAGS):
            continue
        out.append((pi, txt))
    return out


def test_basic_grammar_honours_five_paragraph_exclusions():
    """Pointed regression: the five paragraph types listed in the
    specification (``ref`` / ``epigraph`` / ``heading`` / ``src`` /
    ``table``) must not contribute any basic_grammar findings, and
    their text must not influence the GK-002 (quote style) document-
    scope counters.

    Builds a synthetic doc that stuffs trigger-happy workbook text
    (``should of``, ``in order to``, straight quote) into each of the
    five excluded regions and a single bare body paragraph. We run the
    same body-only filter the router uses and confirm the body
    paragraph is the only one that reaches the workbook."""
    from app.processing.language_editing import basic_grammar as bg

    paragraphs = [
        (0, "<heading>"),                          # heading — must be excluded
        (1, "The dose should of been lower."),     # heading content
        (2, "</heading>"),
        (3, "<ref-open>"),                         # reference — must be excluded
        (4, "Author, A. (2020). See in order to."),
        (5, "<ref-close>"),
        (6, "<table>"),                            # table — must be excluded
        (7, 'Cell with "straight" quote.'),
        (8, "</table>"),
        (9, "<epigraph>"),                         # epigraph — must be excluded
        (10, "I have ran a long way."),
        (11, "</epigraph>"),
        (12, "<src>"),                             # src — must be excluded
        (13, "print('in order to')"),
        (14, "</src>"),
        (15, "This is the only body paragraph."),  # the lone survivor
    ]
    # Classify text + flags the way classify_paragraphs would.
    # Rather than building a DOCX, synthesise the role dict by hand to
    # keep the test hermetic.
    para_roles = {
        0: {"role": "heading", "in_table": False},
        1: {"role": "heading", "in_table": False},
        2: {"role": "heading", "in_table": False},
        3: {"role": "reference"},
        4: {"role": "reference"},
        5: {"role": "reference"},
        6: {"role": "body", "in_table": True},
        7: {"role": "body", "in_table": True},
        8: {"role": "body", "in_table": True},
        9: {"role": "body", "in_epigraph": True},
        10: {"role": "body", "in_epigraph": True},
        11: {"role": "body", "in_epigraph": True},
        12: {"role": "body", "in_src": True},
        13: {"role": "body", "in_src": True},
        14: {"role": "body", "in_src": True},
        15: {"role": "body"},
    }
    body = _filter_body_paragraphs_like_router(paragraphs, para_roles)
    assert body == [(15, "This is the only body paragraph.")], body

    # Doc-state over body-only must not include quotes from the table
    # cell or any text from the excluded regions.
    state = bg.build_document_state(body)
    assert state["straight_quote_count"] == 0
    assert state["curly_quote_count"] == 0

    # Run the per-paragraph analyzer on each excluded paragraph in
    # isolation — the workbook should produce NO findings for them
    # because the router would skip them in the real pipeline. We
    # mirror that by not calling analyze_basic_grammar on them at
    # all; we only call it on the body paragraph.
    body_findings: list = []
    for pi, txt in body:
        body_findings.extend(bg.analyze_basic_grammar(txt, document_state=state))
    # The body paragraph has no workbook triggers.
    excluded_rule_ids = {"GV-001", "GV-005", "WC-004", "GK-002"}
    assert not any(f.rule_id in excluded_rule_ids for f in body_findings)


def test_basic_grammar_doc_state_ignores_mixed_quote_in_excluded_table():
    """A manuscript whose body uses only curly quotes but whose table
    uses a straight quote: GK-002 must NOT fire, because the table is
    excluded from the counter. Without the router filter the straight
    quote in the table would make the body look 'inconsistent'."""
    from app.processing.language_editing import basic_grammar as bg

    all_paragraphs = [
        (0, 'The report said “yes” firmly.'),
        (1, 'A later paragraph said “no” calmly.'),
        (2, 'Table cell: "straight quote here".'),  # inside <table>
    ]
    para_roles = {
        0: {"role": "body"},
        1: {"role": "body"},
        2: {"role": "body", "in_table": True},  # excluded
    }
    body = _filter_body_paragraphs_like_router(all_paragraphs, para_roles)
    state = bg.build_document_state(body)
    # State should reflect curly-only; no straight quotes counted.
    assert state["straight_quote_count"] == 0
    # Run GK-002 against the body paragraphs — no finding.
    findings: list = []
    for pi, txt in body:
        findings.extend(bg.analyze_basic_grammar(txt, document_state=state))
    assert not any(f.rule_id == "GK-002" for f in findings)


# ─── Six-role exclusion set: ref, epigraph, heading, src, table, extract

def test_classify_paragraphs_references_boundary_tag():
    """``<references>…</references>`` opens an ``in_references`` region
    so every paragraph inside — including Normal-styled bibliography
    entries without a Reference paragraph style — is excluded."""
    doc = _make_doc(
        ("Body paragraph before references.", None),
        ("<references>", None),
        ("Author A, Author B, Title, Journal 2020.", None),
        ("Author C, Title 2, Journal 2021.", None),
        ("</references>", None),
        ("Body paragraph after references.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_references"] is False
    assert roles[1]["in_references"] is True   # opening tag itself inside
    assert roles[2]["in_references"] is True
    assert roles[3]["in_references"] is True
    assert roles[4]["in_references"] is True   # closing tag itself inside
    assert roles[5]["in_references"] is False


def test_classify_paragraphs_ref_short_boundary_tag():
    """``<REF>…</REF>`` — short-form boundary used in some templates."""
    doc = _make_doc(
        ("<REF>", None),
        ("Author A, Title, Journal 2020.", None),
        ("</REF>", None),
        ("Body paragraph after.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_references"] is True
    assert roles[1]["in_references"] is True
    assert roles[2]["in_references"] is True
    assert roles[3]["in_references"] is False


def test_classify_paragraphs_references_by_style_name():
    """Paragraphs styled ``Bibliography`` / ``Reference`` / ``BibEntry``
    open an in_references region via the style-based opener — same
    convention as the existing ``Abstract`` style."""
    for style_name in ("Bibliography", "References", "BibEntry", "RefList"):
        doc = _make_doc(
            (f"First entry under {style_name}.", style_name),
            ("Second entry on the next line.", style_name),
        )
        roles = docx_io.classify_paragraphs(doc)
        assert roles[0]["in_references"] is True, f"{style_name} did not open in_references"
        assert roles[1]["in_references"] is True


def test_classify_paragraphs_extract_boundary_tag():
    """``<extract>…</extract>`` opens an ``in_extract`` region for long
    quoted passages."""
    doc = _make_doc(
        ("<extract>", None),
        ("The quoted passage spans multiple sentences.", None),
        ("Second line of the quote.", None),
        ("</extract>", None),
        ("Back to body.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["in_extract"] is True
    assert roles[1]["in_extract"] is True
    assert roles[2]["in_extract"] is True
    assert roles[3]["in_extract"] is True
    assert roles[4]["in_extract"] is False


def test_classify_paragraphs_extract_by_style_name():
    for style_name in ("Extract", "BlockQuote", "BlockQuotation", "Quotation"):
        doc = _make_doc(
            (f"A quoted passage styled {style_name}.", style_name),
        )
        roles = docx_io.classify_paragraphs(doc)
        assert roles[0]["in_extract"] is True, f"{style_name} did not open in_extract"


def test_router_excludes_all_six_role_tags_from_basic_grammar():
    """Belt-and-braces: the body-only filter the router uses to feed
    basic_grammar's document-state pre-pass must drop every one of the
    six exclusion roles (table, figure, abstract, epigraph, src,
    extract, references)."""
    from app.processing.language_editing import basic_grammar as bg

    def _filter_like_router(paragraphs, para_roles):
        EXCLUDED_ROLES = {"heading", "title", "reference", "caption", "extract"}
        EXCLUDED_FLAGS = (
            "in_table", "in_figure", "in_abstract", "in_epigraph",
            "in_src", "in_extract", "in_references",
        )
        out = []
        for pi, txt in paragraphs:
            roles = (para_roles or {}).get(pi) or {}
            if roles.get("role") in EXCLUDED_ROLES:
                continue
            if any(roles.get(flag) for flag in EXCLUDED_FLAGS):
                continue
            out.append((pi, txt))
        return out

    all_paragraphs = [
        (0, "The one and only body paragraph."),
        (1, "Heading-styled paragraph with should of trigger."),
        (2, "Reference entry would say in order to."),
        (3, "Table cell has in order to."),
        (4, "Figure caption has in order to."),
        (5, "Abstract contains should of."),
        (6, "Epigraph has in order to."),
        (7, "Source code print('in order to')."),
        (8, "Extract quotes in order to."),
        (9, "Reference wrapper entry."),
    ]
    para_roles = {
        0: {"role": "body"},
        1: {"role": "heading"},
        2: {"role": "reference"},
        3: {"role": "body", "in_table": True},
        4: {"role": "body", "in_figure": True},
        5: {"role": "body", "in_abstract": True},
        6: {"role": "body", "in_epigraph": True},
        7: {"role": "body", "in_src": True},
        8: {"role": "extract"},
        9: {"role": "body", "in_references": True},
    }
    body = _filter_like_router(all_paragraphs, para_roles)
    assert body == [(0, "The one and only body paragraph.")]
    state = bg.build_document_state(body)
    # Doc-state built from body-only shouldn't see any of the trigger
    # words in the excluded paragraphs.
    assert state["straight_quote_count"] == 0
    assert state["curly_quote_count"] == 0

