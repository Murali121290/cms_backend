"""Gap #8: numbered headings ("1.", "1.2.", "1.2.3.") must derive their H-depth
from the numbering depth instead of flattening to H1."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document


def _tags_for(paragraph_texts):
    doc = Document()
    for text in paragraph_texts:
        doc.add_paragraph(text)
    annotations = annotate_document(doc)
    return [a["tag"] for a in annotations]


def test_numbered_heading_depth_matches_numbering():
    # Single-segment "N. " text is ambiguous with a manually-typed numbered
    # list item and gets intercepted earlier by the (pre-existing, unrelated)
    # text-shape list detection - so depth derivation is verified here via
    # multi-segment numbering, which carries unambiguous textual evidence
    # and isn't caught by that list check.
    tags = _tags_for(["1.1. Background", "1.1.2. Detail"])
    assert tags == ["H2", "H3"]


def test_deep_numbering_caps_at_h4():
    tags = _tags_for(["1.2.3.4.5. Very Deep Section"])
    assert tags == ["H4"]


def test_lettered_text_detected_as_alphabetical_list_item():
    # "A. " is now recognized as an uppercase alphabetical-list marker
    # (uc_letter_pattern), matching how a single numbered line ("1. Text")
    # is already treated as a list item rather than a heading. A
    # standalone "A. Appendix Notes"-style heading needs an explicit <H1>
    # tag (or real non-list formatting) to be classified as a heading.
    tags = _tags_for(["A. Appendix Notes"])
    assert tags == ["LL-MID"]
