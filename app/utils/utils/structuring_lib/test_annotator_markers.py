"""Gap #1: unrecognized <TOKEN>-only paragraphs must resolve to PMI, not a
bogus Word style auto-created from the raw token text."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document


def _tags_for(paragraph_texts):
    doc = Document()
    for text in paragraph_texts:
        doc.add_paragraph(text)
    annotations = annotate_document(doc)
    return [a["tag"] for a in annotations]


def test_unrecognized_marker_only_paragraph_resolves_to_pmi():
    tags = _tags_for(["<WIDGET>", "<H1>"])
    assert tags[0] == "PMI"
    assert tags[1] == "H1"


def test_recognized_box_keyword_markers_resolve_to_pmi():
    # These are recognized box-open keywords (gap #3), which also use the
    # neutral open_style (PMI) for the marker-only line itself.
    tags = _tags_for(["<NOTE>", "<CASE STUDY>"])
    assert tags[0] == "PMI"
    assert tags[1] == "PMI"


def test_self_mapped_explicit_tags_are_not_treated_as_unresolved():
    # H1/H2/H3/H4/KT map to themselves in explicit_tag_map - they must NOT
    # be coerced to PMI just because normalize_style_token(token) == token.
    tags = _tags_for(["<H1>", "<H2>", "<H3>", "<H4>", "<KT>"])
    assert tags == ["H1", "H2", "H3", "H4", "KT"]


def test_explicit_heading_level_is_not_downgraded_by_paragraph_regex_rules():
    # An explicit <H1> on text that also happens to match the generic
    # Title-Case "subsection heading" regex (-> H2) must keep the author's
    # declared level, not get silently re-matched and downgraded.
    tags = _tags_for(["<H1>Client Expectations of a Personal Trainer"])
    assert tags == ["H1"]
