"""Gap #3: box body/title text must take its style from the box's keyword
subtype (NOTE/CLINICAL PEARL/RED FLAG/CASE STUDY/...) instead of always
falling back to the generic NBX-TXT/NBX1-TTL pair."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document


def _annotate(paragraph_texts):
    doc = Document()
    for text in paragraph_texts:
        doc.add_paragraph(text)
    return annotate_document(doc)


def test_clinical_pearl_resolves_to_bx1_subtype():
    annotations = _annotate(
        [
            "<CLINICAL PEARL>",
            "Box 1. Always check the airway first",
            "Keep the patient calm and reassess every five minutes.",
            "</CLINICAL PEARL>",
        ]
    )
    tags = [a["tag"] for a in annotations]
    assert tags[0] == "PMI"          # open marker, marker-only line
    assert tags[1] == "BX1-TTL"      # title (matches "^Box\\s+\\d+")
    assert tags[2] == "BX1-TXT"      # body
    assert tags[3] == "PMI"          # close marker


def test_red_flag_resolves_to_bx2_subtype():
    annotations = _annotate(
        [
            "<RED FLAG>",
            "Watch closely for signs of rapid deterioration.",
            "</RED FLAG>",
        ]
    )
    tags = [a["tag"] for a in annotations]
    assert tags[0] == "PMI"
    assert tags[1] == "BX2-TXT"
    assert tags[2] == "PMI"


def test_plain_note_keeps_generic_default_subtype_regression():
    annotations = _annotate(
        [
            "<NOTE>",
            "Remember to wash your hands before the procedure.",
            "</NOTE>",
        ]
    )
    tags = [a["tag"] for a in annotations]
    assert tags[0] == "PMI"
    assert tags[1] == "NBX-TXT"  # unchanged default, NOTE maps to generic NBX
    assert tags[2] == "PMI"


def test_bare_numbered_box_tag_resolves_to_its_own_subtype():
    # A bare numbered LWW box token ("<BX1>") isn't a boxes.type_keywords
    # word alias (those are things like "NOTE"/"CASE STUDY") - it must
    # resolve to its own matching subtype directly instead of silently
    # losing its number and falling back to the generic NBX default.
    annotations = _annotate(
        [
            "<BX2>",
            "Box 7.3 Warning Title",
            "Body content in the box.",
            "</BX2>",
            "Text after the box.",
        ]
    )
    tags = [a["tag"] for a in annotations]
    assert tags[0] == "PMI"
    assert tags[1] == "BX2-TTL"
    assert tags[2] == "BX2-TXT"
    assert tags[3] == "PMI"
    # The box context must actually close - content after "</BX2>" must
    # not keep inheriting box styling.
    assert tags[4] == "TXT"
