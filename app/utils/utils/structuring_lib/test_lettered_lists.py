"""P8 (optional enhancement): mnemonic/lettered lists - a single capital
letter followed by a tab/space run (e.g. "A   Apple is for resilience")
should be detected as a list item and tagged UL-MID, not generic body text."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document, detect_list_kind


def test_detect_list_kind_recognizes_mnemonic_lettered_pattern():
    assert detect_list_kind("A   Apple is for resilience") == "lettered"


def test_lettered_list_items_tagged_ul_mid():
    doc = Document()
    doc.add_paragraph("A   Apple is for resilience")
    doc.add_paragraph("B   Bravery under pressure")
    annotations = annotate_document(doc)
    tags = [a["tag"] for a in annotations]
    assert tags == ["UL-MID", "UL-MID"]


def test_ordinary_sentence_is_not_treated_as_lettered_list():
    assert detect_list_kind("A patient presented with fever.") is None
