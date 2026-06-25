"""Two-pass box-tag prefixing for "BX<number>-<value>",
"BX<number>_<value>", and "NBX<number>-<value>" markers: every real tag
strictly between a matched open/close pair (exact base-id + suffix match)
gets a "BX<number>-"/"NBX<number>-" prefix; an unclosed opener is downgraded
to PMI with its contents left unprefixed; unmatched closers are ignored."""

from docx import Document

from app.utils.utils.structuring_lib.annotator import annotate_document
from app.utils.utils.structuring_lib.box_prefixer import apply_box_tag_prefixes


def _tags_for(paragraph_texts):
    doc = Document()
    for text in paragraph_texts:
        doc.add_paragraph(text)
    annotations = annotate_document(doc)
    annotations = apply_box_tag_prefixes(annotations)
    return [a["tag"] for a in annotations]


def test_spec_example_1_simple_box():
    # "Paragraph" follows the H1 heading, so the pre-existing TXT ->
    # TXT-FLUSH heuristic fires before box-prefixing runs; box_prefixer
    # prefixes whatever tag it's handed.
    tags = _tags_for(["<BX1-AA>", "<H1> Heading", "<TXT> Paragraph", "</BX1-AA>"])
    assert tags == ["BX1-AA", "BX1-H1", "BX1-TXT-FLUSH", "BX1-AA"]


def test_spec_example_2_different_number_and_suffix():
    tags = _tags_for(["<BX2-KQ>", "<H2> Heading", "<TXT> Paragraph", "</BX2-KQ>"])
    assert tags == ["BX2-KQ", "BX2-H2", "BX2-TXT-FLUSH", "BX2-KQ"]


def test_spec_example_3_nested_boxes_compound_outermost_first():
    tags = _tags_for(
        ["<BX1-AA>", "<BX2-BB>", "<TXT> Inner", "</BX2-BB>", "</BX1-AA>"]
    )
    assert tags == ["BX1-AA", "BX2-BB", "BX1-BX2-TXT", "BX2-BB", "BX1-AA"]


def test_spec_example_4_unclosed_box_becomes_pmi_and_contents_unprefixed():
    tags = _tags_for(["<BX5-ZZ>", "<TXT> Paragraph"])
    assert tags == ["PMI", "TXT"]


def test_closing_suffix_must_match_exactly():
    # "</BX1-AB>" must not close "<BX1-AA>" - different suffix.
    tags = _tags_for(["<BX1-AA>", "<TXT> Body", "</BX1-AB>"])
    assert tags == ["PMI", "TXT", "BX1-AB"]


def test_closing_number_must_match_exactly():
    # "</BX2-AA>" must not close "<BX1-AA>" - different number.
    tags = _tags_for(["<BX1-AA>", "<TXT> Body", "</BX2-AA>"])
    assert tags == ["PMI", "TXT", "BX2-AA"]


def test_stray_close_with_no_matching_open_is_ignored():
    tags = _tags_for(["<TXT> Before", "</BX3-AA>", "<TXT> After"])
    assert tags == ["TXT", "BX3-AA", "TXT"]


def test_already_prefixed_structural_tags_are_never_box_markers():
    # "H1"/"H2"/"TXT" are recognized base structural tags, so "BX1-H1",
    # "BX1-H2", "BX1-TXT", "NBX2-H1", "NBX2-TXT" are already-resolved
    # content tags, not fresh box markers, even though their suffix is now
    # unconstrained ("any value"). All five are preserved verbatim (none
    # ever became a bx_open/bx_close marker, confirmed separately: no
    # "Unclosed box" warning is logged for any of them, unlike a genuine
    # fresh marker such as "BX3-Header" would produce).
    tags = _tags_for(
        ["<BX1-H1> Heading", "<BX1-H2> Subheading", "<BX1-TXT> Body", "<NBX2-H1> Heading", "<NBX2-TXT> Body"]
    )
    assert tags == ["BX1-H1", "BX1-H2", "BX1-TXT", "NBX2-H1", "NBX2-TXT"]


def test_box_title_suffix_is_reserved_and_not_a_fresh_marker():
    # "TTL" is the box title-style suffix (see rules.yaml boxes.title_style/
    # subtype_styles), not in the bare structural_tags exact list - must
    # still be excluded via the box-config-derived suffix check, or a
    # standalone "<BX1-TTL>" would be wrongly treated as an unclosed marker
    # and downgraded to PMI (see test_explicit_tag_precedence.py's
    # test_explicit_list_and_box_tags_are_preserved_verbatim).
    tags = _tags_for(["<BX1-TTL> Clinical Pearl"])
    assert tags == ["BX1-TTL"]

    tags = _tags_for(["<NBX1-TTL> Title"])
    assert tags == ["NBX1-TTL"]


def test_sibling_boxes_do_not_cross_contaminate():
    tags = _tags_for(
        ["<BX1-AA>", "<TXT> A", "</BX1-AA>", "<TXT> Between", "<BX3-ZZ>", "<TXT> B", "</BX3-ZZ>"]
    )
    assert tags == ["BX1-AA", "BX1-TXT", "BX1-AA", "TXT", "BX3-ZZ", "BX3-TXT", "BX3-ZZ"]


def test_same_number_different_suffix_boxes_are_independent():
    # "BX1-AA" and "BX1-BB" share a number but are distinct markers - one
    # closing early must not affect the other still-open one.
    tags = _tags_for(
        ["<BX1-AA>", "<TXT> A", "</BX1-AA>", "<BX1-BB>", "<TXT> B", "</BX1-BB>"]
    )
    assert tags == ["BX1-AA", "BX1-TXT", "BX1-AA", "BX1-BB", "BX1-TXT", "BX1-BB"]


def test_underscore_separator_marker():
    tags = _tags_for(["<BX4_Section>", "<TXT> Body", "</BX4_Section>"])
    assert tags == ["BX4_Section", "BX4-TXT", "BX4_Section"]


def test_nbx_prefix_family_marker():
    tags = _tags_for(["<NBX2-Important>", "<TXT> Body", "</NBX2-Important>"])
    assert tags == ["NBX2-Important", "NBX2-TXT", "NBX2-Important"]


def test_arbitrary_multi_char_mixed_case_suffixes():
    tags = _tags_for(
        ["<BX1-Header>", "<TXT> A", "</BX1-Header>", "<BX2-Example01>", "<TXT> B", "</BX2-Example01>"]
    )
    assert tags == ["BX1-Header", "BX1-TXT", "BX1-Header", "BX2-Example01", "BX2-TXT", "BX2-Example01"]


def test_close_must_match_suffix_case_exactly():
    # "</BX3-header>" (lowercase) must not close "<BX3-Header>".
    tags = _tags_for(["<BX3-Header>", "<TXT> Body", "</BX3-header>"])
    assert tags == ["PMI", "TXT", "BX3-header"]


def test_close_must_match_separator_exactly():
    # An underscore-separated open must not close on a hyphen-separated close.
    tags = _tags_for(["<BX4_Section>", "<TXT> Body", "</BX4-Section>"])
    assert tags == ["PMI", "TXT", "BX4-Section"]


def test_nested_mixed_marker_formats_compound_outermost_first():
    tags = _tags_for(
        ["<BX1-AA>", "<NBX2-Important>", "<TXT> Inner", "</NBX2-Important>", "</BX1-AA>"]
    )
    assert tags == ["BX1-AA", "NBX2-Important", "BX1-NBX2-TXT", "NBX2-Important", "BX1-AA"]


def test_trailing_close_marker_basic():
    # The closing marker trails real content on the same line/paragraph
    # rather than occupying its own line.
    tags = _tags_for(["<NBX3-Example>", "Some text.</NBX3-Example>"])
    assert tags == ["NBX3-Example", "NBX3-TXT"]


def test_trailing_close_marker_spec_example_with_heading():
    # "Paragraph follows a heading" still triggers the pre-existing
    # TXT -> TXT-FLUSH heuristic, exactly as it would if the close marker
    # were on its own separate line - box_prefixer still prefixes whatever
    # tag the content resolved to.
    tags = _tags_for(["<BX1-Header>", "<H1>", "This is inside the box.</BX1-Header>"])
    assert tags == ["BX1-Header", "BX1-H1", "BX1-TXT-FLUSH"]


def test_trailing_close_marker_only_line_falls_back_to_leading_path():
    # A line that is *entirely* the closing marker (nothing precedes it)
    # must keep going through the existing leading-marker handling, not the
    # new trailing path - same observable result either way, but confirms
    # the "real content must remain after stripping" guard.
    tags = _tags_for(["<BX2-Foo>", "</BX2-Foo>"])
    assert tags == ["BX2-Foo", "BX2-Foo"]


def test_trailing_close_marker_still_requires_exact_match():
    # A trailing close with a mismatched suffix must not pop the open box -
    # same exact-match rule as a closing marker on its own line.
    tags = _tags_for(["<BX1-AA>", "Some text.</BX1-AB>"])
    assert tags == ["PMI", "TXT"]


def test_trailing_close_marker_ignores_reserved_suffix():
    # A trailing "</BX1-TXT>" is an already-resolved structural tag, not a
    # fresh closing marker - the box stays unclosed.
    tags = _tags_for(["<BX1-AA>", "Some text.</BX1-TXT>"])
    assert tags == ["PMI", "TXT"]


def test_trailing_close_marker_with_nested_box():
    tags = _tags_for(
        ["<BX1-AA>", "<NBX2-Important>", "Inner text.</NBX2-Important>", "</BX1-AA>"]
    )
    assert tags == ["BX1-AA", "NBX2-Important", "BX1-NBX2-TXT", "BX1-AA"]


def test_trailing_close_marker_after_multiple_content_paragraphs():
    tags = _tags_for(["<BX1-AA>", "<TXT> First", "Second and close.</BX1-AA>"])
    assert tags == ["BX1-AA", "BX1-TXT", "BX1-TXT"]


def test_explicit_tag_already_carrying_this_boxs_own_prefix_is_not_doubled():
    # An author-written "<BX3-TTL>"/"<BX3-TXT>" tag *inside* its own
    # "<BX3-TIP>" box already has the right prefix - box_prefixer must not
    # double it up into "BX3-BX3-TTL"/"BX3-BX3-TXT".
    tags = _tags_for(
        ["<BX3-TIP>", "<BX3-TTL> Tip", "<BX3-TXT> Body", "</BX3-TIP>"]
    )
    assert tags == ["BX3-TIP", "BX3-TTL", "BX3-TXT", "BX3-TIP"]


def test_explicit_tag_with_underscore_own_prefix_is_not_doubled():
    tags = _tags_for(["<BX5_Section>", "<BX5_TTL> Title", "</BX5_Section>"])
    assert tags == ["BX5_Section", "BX5_TTL", "BX5_Section"]


def test_different_box_prefix_still_compounds_inside():
    # An explicit tag carrying a *different* box's prefix (e.g. "BX2-TTL"
    # nested inside an outer "BX3" box) is not the same box, so it still
    # gets the outer prefix added on top.
    tags = _tags_for(["<BX3-TIP>", "<BX2-TTL> Inner Title", "</BX3-TIP>"])
    assert tags == ["BX3-TIP", "BX3-BX2-TTL", "BX3-TIP"]


def test_unprefixed_tags_in_same_box_still_get_prefixed_normally():
    # Confirms the no-double-prefix guard doesn't suppress ordinary
    # prefixing for tags that don't already carry this box's prefix.
    # ("Body" follows the H1 heading, so the pre-existing TXT -> TXT-FLUSH
    # heuristic fires before box-prefixing runs, same as in other tests.)
    tags = _tags_for(["<BX3-TIP>", "<H1> Heading", "<TXT> Body", "</BX3-TIP>"])
    assert tags == ["BX3-TIP", "BX3-H1", "BX3-TXT-FLUSH", "BX3-TIP"]


def test_cout_fixed_keyword_marker_basic():
    # "<COUT>"/"</COUT>" is a fixed-keyword marker - no number, no suffix -
    # the bare token itself is both the marker and the generated prefix.
    tags = _tags_for(["<COUT>", "<H1> Heading", "<TXT> Body", "</COUT>"])
    assert tags == ["COUT", "COUT-H1", "COUT-TXT-FLUSH", "COUT"]


def test_cout_unclosed_becomes_pmi():
    tags = _tags_for(["<COUT>", "<TXT> Body"])
    assert tags == ["PMI", "TXT"]


def test_cout_stray_close_is_ignored():
    tags = _tags_for(["<TXT> Before", "</COUT>", "<TXT> After"])
    assert tags == ["TXT", "COUT", "TXT"]


def test_cout_close_is_case_sensitive():
    tags = _tags_for(["<COUT>", "<TXT> Body", "</cout>"])
    assert tags == ["PMI", "TXT", "PMI"]


def test_cout_trailing_close_at_end_of_block():
    tags = _tags_for(["<COUT>", "Some text.</COUT>"])
    assert tags == ["COUT", "COUT-TXT"]


def test_cout_does_not_double_prefix_its_own_explicit_tag():
    tags = _tags_for(["<COUT>", "<COUT-TTL> Title", "</COUT>"])
    assert tags == ["COUT", "COUT-TTL", "COUT"]


def test_cout_nests_with_numbered_boxes_either_way():
    tags = _tags_for(["<COUT>", "<BX1-AA>", "<TXT> Inner", "</BX1-AA>", "</COUT>"])
    assert tags == ["COUT", "BX1-AA", "COUT-BX1-TXT", "BX1-AA", "COUT"]

    tags = _tags_for(["<BX1-AA>", "<COUT>", "<TXT> Inner", "</COUT>", "</BX1-AA>"])
    assert tags == ["BX1-AA", "COUT", "BX1-COUT-TXT", "COUT", "BX1-AA"]
