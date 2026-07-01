"""Tests for Phase 5 (hierarchy building) of the formatting-based heading
classifier."""

from app.utils.utils.structuring_lib.heading_classifier.hierarchy import build_hierarchy
from app.utils.utils.structuring_lib.heading_classifier.models import Paragraph


def _para(index, classification, text=None):
    return Paragraph(id=index, index=index, text=text or f"p{index}", classification=classification)


def test_stack_builds_nested_tree():
    paragraphs = [
        _para(0, "H1"),
        _para(1, "H2"),
        _para(2, "H3"),
        _para(3, "H2"),
        _para(4, "H1"),
    ]
    roots = build_hierarchy(paragraphs)

    assert len(roots) == 2
    assert roots[0].level == 1
    assert len(roots[0].children) == 2
    assert roots[0].children[0].level == 2
    assert len(roots[0].children[0].children) == 1
    assert roots[0].children[0].children[0].level == 3
    assert roots[0].children[1].level == 2
    assert roots[1].level == 1


def test_document_starting_at_h3_has_no_synthesized_ancestors():
    paragraphs = [_para(0, "H3"), _para(1, "H3")]
    roots = build_hierarchy(paragraphs)
    assert len(roots) == 2
    assert all(node.level == 3 for node in roots)


def test_body_paragraphs_attach_to_nearest_open_heading():
    paragraphs = [
        _para(0, "H1"),
        _para(1, "Body", text="body under h1"),
        _para(2, "H2"),
        _para(3, "Body", text="body under h2"),
    ]
    roots = build_hierarchy(paragraphs)

    assert len(roots[0].body) == 1
    assert roots[0].body[0].text == "body under h1"
    assert len(roots[0].children[0].body) == 1
    assert roots[0].children[0].body[0].text == "body under h2"


def test_body_before_any_heading_is_dropped_from_tree_not_from_flat_list():
    paragraphs = [
        _para(0, "Body", text="preamble"),
        _para(1, "H1"),
    ]
    roots = build_hierarchy(paragraphs)

    assert len(roots) == 1
    assert roots[0].body == []
    # The flat list (owned by the caller, not by build_hierarchy) still has it.
    assert paragraphs[0].text == "preamble"
