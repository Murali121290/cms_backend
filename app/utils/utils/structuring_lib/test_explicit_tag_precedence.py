"""Author-provided leading <TAG> markers are authoritative: they must be
preserved exactly and must never be reclassified by heuristic/rule-based
logic or by the heading-hierarchy auto-fix pass."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document
from app.utils.utils.structuring_lib.hierarchy_manager import enforce_hierarchy


def _annotations_for(paragraph_texts, full_pipeline=False):
    doc = Document()
    for text in paragraph_texts:
        doc.add_paragraph(text)
    annotations = annotate_document(doc)
    if full_pipeline:
        annotations = enforce_hierarchy(annotations)
    return annotations


def _tags_for(paragraph_texts, full_pipeline=False):
    return [a["tag"] for a in _annotations_for(paragraph_texts, full_pipeline)]


def test_explicit_heading_tag_is_preserved_verbatim():
    tags = _tags_for(["<H1> Introduction"])
    assert tags == ["H1"]


def test_explicit_txt_tag_is_not_reclassified():
    # Previously TXT/TXT-FLUSH were deliberately left open to further regex
    # refinement; the author's explicit <TXT> must now win outright too.
    tags = _tags_for(["<TXT> This is a paragraph."])
    assert tags == ["TXT"]


def test_explicit_list_and_box_tags_are_preserved_verbatim():
    # BL-FIRST/BX1-TTL aren't in the small curated alias maps, but they are
    # in the centralized structural_tags registry, so they must be kept
    # exactly as written rather than coerced to PMI or something else.
    tags = _tags_for(["<BL-FIRST> Apples"])
    assert tags == ["BL-FIRST"]

    tags = _tags_for(["<BX1-TTL> Clinical Pearl"])
    assert tags == ["BX1-TTL"]


def test_untagged_text_still_goes_through_normal_classification():
    assert _tags_for(["Introduction"]) == ["H1"]
    assert _tags_for(["This is a body paragraph."]) == ["TXT"]


def test_explicit_tag_is_marked_locked():
    annotations = _annotations_for(["<H1> Introduction", "Untagged body text."])
    assert annotations[0]["locked"] is True
    assert annotations[1]["locked"] is False


def test_explicit_tag_survives_title_case_and_all_caps_rules():
    # Text shapes that would normally trigger different rules must not
    # override the author's explicit declaration.
    tags = _tags_for(["<TXT> BACKGROUND INFORMATION"])
    assert tags == ["TXT"]

    tags = _tags_for(["<H3> Client Expectations of a Personal Trainer"])
    assert tags == ["H3"]


def test_explicit_tag_survives_hierarchy_auto_fix_require_h1_first():
    # Without an explicit tag, hierarchy_manager would promote this to H1
    # for lacking a prior H1. An author-declared H2 must stay H2.
    tags = _tags_for(["<H2> Jumps straight in"], full_pipeline=True)
    assert tags == ["H2"]


def test_explicit_tag_survives_hierarchy_auto_fix_no_skipping_levels():
    # Without an explicit tag, hierarchy_manager would clamp H1 -> H3 down
    # to H2. An author-declared H3 right after H1 must stay H3.
    tags = _tags_for(["<H1> Chapter", "<H3> Deep subsection"], full_pipeline=True)
    assert tags == ["H1", "H3"]


def test_unlocked_headings_are_still_auto_fixed_by_hierarchy_manager():
    # Regular (non-explicit) classification must still go through the
    # existing hierarchy auto-fix unchanged.
    tags = _tags_for(["BACKGROUND INFORMATION"], full_pipeline=True)
    assert tags == ["H1"]
