"""Gap #2: list items never get FIRST/LAST - every run of same-family list
tags should be rewritten to FIRST -> MID* -> LAST."""

from app.utils.utils.structuring_lib.list_normalizer import normalize_list_positions


def _ann(tag):
    return {"tag": tag, "style": tag}


def _tags(annotations):
    return [a["tag"] for a in annotations]


def test_single_item_run_becomes_first():
    annotations = [_ann("BL-MID")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["BL-FIRST"]


def test_two_item_run_becomes_first_last():
    annotations = [_ann("BL-MID"), _ann("BL-MID")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["BL-FIRST", "BL-LAST"]


def test_three_plus_item_run_becomes_first_mid_last():
    annotations = [_ann("NL-MID") for _ in range(4)]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["NL-FIRST", "NL-MID", "NL-MID", "NL-LAST"]


def test_run_broken_by_heading_starts_new_run():
    annotations = [_ann("BL-MID"), _ann("BL-MID"), _ann("H2"), _ann("BL-MID")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["BL-FIRST", "BL-LAST", "H2", "BL-FIRST"]


def test_run_bridged_by_empty_paragraph_stays_one_run():
    annotations = [_ann("BL-MID"), _ann("EMPTY"), _ann("BL-MID"), _ann("BL-MID")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["BL-FIRST", "EMPTY", "BL-MID", "BL-LAST"]


def test_reference_family_gets_position_suffixes():
    annotations = [_ann("REF-N"), _ann("REF-N"), _ann("REF-N")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["REF-N-FIRST", "REF-N-MID", "REF-N-LAST"]


def test_different_families_do_not_merge():
    annotations = [_ann("BL-MID"), _ann("NL-MID")]
    result = normalize_list_positions(annotations)
    assert _tags(result) == ["BL-FIRST", "NL-FIRST"]
