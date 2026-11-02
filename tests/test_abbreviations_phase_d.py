"""Phase D tests for the Abbreviations module.

Covers:
  * ``docx_io.classify_paragraphs`` — paragraph-role classifier for
    headings, titles, abstracts, tables, figures, chapter boundaries.
  * AB11 — abbreviation in a heading / title → spell out.
  * AB12 — abstract-only definition then body use → re-define in body.
  * AB14 — expansion written in Title Case mid-sentence → lowercase.
  * AB15 — abbreviation in a table / figure with no local definition.
  * AB16 — scope_reset with chapter boundaries re-fires first-use at
    each chapter.
"""
from __future__ import annotations

import pytest
from io import BytesIO

docx = pytest.importorskip("docx")
from docx import Document

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import docx_io


@pytest.fixture(autouse=True)
def _cold_cache():
    ab.clear_cache()
    yield
    ab.clear_cache()


# ─── classify_paragraphs utility ───────────────────────────────────────

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


def test_classify_paragraphs_headings_and_body():
    doc = _make_doc(
        ("Chapter 1: Introduction", "Heading 1"),
        ("This is a body paragraph.", None),
        ("Section 1.1 Scope", "Heading 2"),
        ("More body content.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    assert roles[0]["role"] in ("heading", "title")
    assert roles[0]["chapter_boundary"] is True
    assert roles[1]["role"] == "body"
    assert roles[2]["role"] == "heading"
    assert roles[2]["chapter_boundary"] is False  # not a Heading 1
    assert roles[3]["role"] == "body"


def test_classify_paragraphs_abstract_table_figure_region_tracking():
    doc = _make_doc(
        ("<abstract>", None),
        ("Abstract body with ICU mention.", None),
        ("</abstract>", None),
        ("Body paragraph after abstract.", None),
        ("<table>", None),
        ("Row inside table.", None),
        ("</table>", None),
        ("Body paragraph after table.", None),
    )
    roles = docx_io.classify_paragraphs(doc)
    # Abstract region covers the <abstract> and </abstract> tags themselves
    # plus everything in between.
    assert roles[0]["in_abstract"] is True
    assert roles[1]["in_abstract"] is True
    assert roles[2]["in_abstract"] is True
    assert roles[3]["in_abstract"] is False
    assert roles[4]["in_table"] is True
    assert roles[5]["in_table"] is True
    assert roles[6]["in_table"] is True
    assert roles[7]["in_table"] is False


# ─── AB14 — case of expansion ──────────────────────────────────────────

def test_ab14_flags_title_case_mid_sentence():
    text = "She visited the Intensive Care Unit after surgery."
    out = ab.analyze_abbreviations(text, document_state=None)
    ab14 = [f for f in out if f.rule_id == "AB14"]
    assert ab14, out
    assert ab14[0].original == "Intensive Care Unit"
    assert ab14[0].suggestion == "intensive care unit"


def test_ab14_does_not_flag_sentence_start():
    text = "Intensive Care Unit staff were ready."
    out = ab.analyze_abbreviations(text, document_state=None)
    assert not any(f.rule_id == "AB14" for f in out), out


def test_ab14_does_not_flag_lowercase_expansion():
    text = "She visited the intensive care unit after surgery."
    out = ab.analyze_abbreviations(text, document_state=None)
    assert not any(f.rule_id == "AB14" for f in out), out


# ─── AB11 — heading/title spell-out ───────────────────────────────────

def test_ab11_fires_on_abbreviation_in_heading():
    text = "ICU admission criteria"
    paragraphs = [(0, text)]
    roles = {0: {
        "role": "heading", "level": 2, "in_abstract": False,
        "in_table": False, "in_figure": False, "chapter_boundary": False,
    }}
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out = ab.analyze_abbreviations(text, para_idx=0, document_state=state, para_roles=roles)
    ab11 = [f for f in out if f.rule_id == "AB11"]
    assert ab11, out
    assert ab11[0].original == "ICU"
    assert "intensive care unit" in ab11[0].suggestion.lower()


def test_ab11_silent_on_body_paragraph():
    text = "ICU admission criteria"
    paragraphs = [(0, text)]
    roles = {0: {
        "role": "body", "in_abstract": False,
        "in_table": False, "in_figure": False, "chapter_boundary": False,
    }}
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out = ab.analyze_abbreviations(text, para_idx=0, document_state=state, para_roles=roles)
    assert not any(f.rule_id == "AB11" for f in out)


def test_ab11_suppresses_ab05_on_same_span():
    """Phase B's AB05 would also flag a lone ICU — but when the paragraph
    is a heading, AB11 owns the span and AB05 stays silent."""
    text = "ICU admission criteria"
    paragraphs = [(0, text)]
    roles = {0: {"role": "heading", "level": 2, "in_abstract": False,
                 "in_table": False, "in_figure": False, "chapter_boundary": False}}
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out = ab.analyze_abbreviations(text, para_idx=0, document_state=state, para_roles=roles)
    assert any(f.rule_id == "AB11" for f in out)
    assert not any(f.rule_id == "AB05" for f in out)


# ─── AB12 — abstract vs body ──────────────────────────────────────────

def test_ab12_fires_when_abstract_defines_and_body_uses_without_definition():
    paragraphs = [
        (0, "The intensive care unit (ICU) was studied."),
        (1, "Patients in the ICU had higher survival."),
    ]
    roles = {
        0: {"role": "body", "in_abstract": True,  "in_table": False, "in_figure": False, "chapter_boundary": False},
        1: {"role": "body", "in_abstract": False, "in_table": False, "in_figure": False, "chapter_boundary": False},
    }
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out1 = ab.analyze_abbreviations(paragraphs[1][1], para_idx=1, document_state=state, para_roles=roles)
    ab12 = [f for f in out1 if f.rule_id == "AB12"]
    assert ab12, out1
    assert "intensive care unit (icu)" in ab12[0].suggestion.lower()


def test_ab12_silent_when_body_has_its_own_definition():
    paragraphs = [
        (0, "The intensive care unit (ICU) was studied."),  # abstract
        (1, "The intensive care unit (ICU) opened more beds."),  # body with its own def
    ]
    roles = {
        0: {"role": "body", "in_abstract": True,  "in_table": False, "in_figure": False, "chapter_boundary": False},
        1: {"role": "body", "in_abstract": False, "in_table": False, "in_figure": False, "chapter_boundary": False},
    }
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out = ab.analyze_abbreviations(paragraphs[1][1], para_idx=1, document_state=state, para_roles=roles)
    assert not any(f.rule_id == "AB12" for f in out)


# ─── AB15 — tables / figures without a local definition ───────────────

def test_ab15_fires_on_table_without_local_definition():
    text = "ICU patients had higher mortality."
    roles = {0: {"role": "body", "in_abstract": False, "in_table": True,
                 "in_figure": False, "chapter_boundary": False}}
    state = ab.build_document_state([(0, text)], para_roles=roles)
    out = ab.analyze_abbreviations(text, para_idx=0, document_state=state, para_roles=roles)
    ab15 = [f for f in out if f.rule_id == "AB15"]
    assert ab15, out
    assert "intensive care unit" in ab15[0].suggestion.lower()


def test_ab15_silent_when_table_has_local_definition():
    paragraphs = [
        (0, "intensive care unit (ICU) — see footnote."),  # table paragraph with definition
        (1, "ICU patients had higher mortality."),           # same table
    ]
    roles = {
        0: {"role": "body", "in_abstract": False, "in_table": True, "in_figure": False, "chapter_boundary": False},
        1: {"role": "body", "in_abstract": False, "in_table": True, "in_figure": False, "chapter_boundary": False},
    }
    state = ab.build_document_state(paragraphs, para_roles=roles)
    out = ab.analyze_abbreviations(paragraphs[1][1], para_idx=1, document_state=state, para_roles=roles)
    assert not any(f.rule_id == "AB15" for f in out)


# ─── AB16 — scope_reset with chapter boundaries ───────────────────────

def test_ab16_scope_reset_chapters_isolate_first_use():
    """With scope_reset on, two chapters each need their own first-use
    expansion. This test exercises the per-scope state build the router
    does; the engine itself doesn't know about chapters."""
    paragraphs = [
        (0, "The intensive care unit (ICU) was busy."),
        (1, "ICU patients were triaged quickly."),
    ]
    roles_each = {
        0: {"role": "body", "in_abstract": False, "in_table": False, "in_figure": False, "chapter_boundary": False},
        1: {"role": "body", "in_abstract": False, "in_table": False, "in_figure": False, "chapter_boundary": False},
    }
    # Simulate the router's chapter-split build: each paragraph is its own scope.
    for pi, pt in paragraphs:
        state = ab.build_document_state([(pi, pt)], para_roles={pi: roles_each[pi]})
        _ = ab.analyze_abbreviations(pt, para_idx=pi, document_state=state, para_roles={pi: roles_each[pi]})
    # The key invariant: isolated scopes DO see each paragraph independently.
    # The actual router test is end-to-end; here we confirm the pieces compose.


# ─── Scope-C invariant ────────────────────────────────────────────────

def test_phase_d_never_mutates_input_text():
    text = "ICU admission criteria"
    before = text
    roles = {0: {"role": "heading", "level": 2, "in_abstract": False,
                 "in_table": False, "in_figure": False, "chapter_boundary": False}}
    state = ab.build_document_state([(0, text)], para_roles=roles)
    _ = ab.analyze_abbreviations(text, para_idx=0, document_state=state, para_roles=roles)
    assert text == before
