"""Tests for Phase 4 (signature ranking/classification) of the
formatting-based heading classifier."""

from app.utils.utils.structuring_lib.heading_classifier.classifier import (
    baseline_signature,
    classify_by_signature,
    rank_signatures,
)
from app.utils.utils.structuring_lib.heading_classifier.signature import (
    DocumentSignatureBaseline,
    build_signature,
)


def _baseline(max_font_size_rank=3, font_family="Calibri", alignment="LEFT"):
    return DocumentSignatureBaseline(
        baseline_font_family=font_family,
        baseline_alignment=alignment,
        max_font_size_rank=max_font_size_rank,
    )


def _features(**overrides):
    base = {
        "is_empty": False,
        "font_size_rank": 3,
        "bold": False,
        "is_all_uppercase": False,
        "is_title_case": False,
        "font_family": "Calibri",
        "underline": False,
        "italic": False,
        "alignment": "LEFT",
        "starts_with_numbering": False,
        "numbering_format": None,
    }
    base.update(overrides)
    return base


def test_font_size_rank_dominates_bold():
    baseline = _baseline()
    higher_rank_not_bold = build_signature(_features(font_size_rank=0, bold=False), baseline)
    lower_rank_bold = build_signature(_features(font_size_rank=1, bold=True), baseline)
    assert higher_rank_not_bold < lower_rank_bold


def test_all_caps_outranks_title_case():
    baseline = _baseline()
    caps_only = build_signature(_features(font_size_rank=0, bold=True, is_all_uppercase=True), baseline)
    title_only = build_signature(_features(font_size_rank=0, bold=True, is_title_case=True), baseline)
    assert caps_only < title_only


def test_font_family_senior_only_when_differs_from_baseline():
    baseline = _baseline(font_family="Calibri")
    matches = build_signature(_features(font_family="Calibri"), baseline)
    differs = build_signature(_features(font_family="Georgia"), baseline)
    assert differs < matches


def test_alignment_center_is_always_senior_regardless_of_baseline():
    # Baseline alignment is RIGHT (not the conventional LEFT default) -
    # CENTER must still outrank a paragraph that exactly matches whatever
    # the document's baseline alignment happens to be.
    baseline = _baseline(alignment="RIGHT")
    centered = build_signature(_features(alignment="CENTER"), baseline)
    matches_baseline = build_signature(_features(alignment="RIGHT"), baseline)
    assert centered < matches_baseline


def test_numbering_present_is_senior_to_absent():
    baseline = _baseline()
    numbered = build_signature(_features(starts_with_numbering=True), baseline)
    plain = build_signature(_features(starts_with_numbering=False), baseline)
    assert numbered < plain


def test_paragraph_matching_baseline_exactly_is_body():
    baseline = _baseline(max_font_size_rank=3)
    sig = build_signature(_features(font_size_rank=3), baseline)
    ranking = rank_signatures([sig], baseline)
    assert classify_by_signature(_features(font_size_rank=3), sig, ranking) == "Body"


def test_identical_non_adjacent_signatures_get_same_level():
    baseline = _baseline()
    f1 = _features(font_size_rank=1, bold=True)
    f2 = _features(font_size_rank=0, bold=True)  # a different, more senior signature in between
    f3 = _features(font_size_rank=1, bold=True)  # same as f1

    sig1, sig2, sig3 = build_signature(f1, baseline), build_signature(f2, baseline), build_signature(f3, baseline)
    ranking = rank_signatures([sig1, sig2, sig3], baseline)

    level1 = classify_by_signature(f1, sig1, ranking)
    level3 = classify_by_signature(f3, sig3, ranking)
    assert level1 == level3
    assert level1 != classify_by_signature(f2, sig2, ranking)


def test_distinct_signatures_capped_at_h6():
    baseline = _baseline(max_font_size_rank=10)
    # 8 distinct senior font-size ranks -> 8 distinct signatures
    features_list = [_features(font_size_rank=rank) for rank in range(8)]
    signatures = [build_signature(f, baseline) for f in features_list]
    ranking = rank_signatures(signatures, baseline)

    levels = [classify_by_signature(f, sig, ranking) for f, sig in zip(features_list, signatures)]
    assert levels == ["H1", "H2", "H3", "H4", "H5", "H6", "H6", "H6"]


def test_empty_paragraph_is_always_body():
    baseline = _baseline()
    sig = build_signature(_features(font_size_rank=0, bold=True), baseline)
    ranking = rank_signatures([sig], baseline)
    assert classify_by_signature(_features(is_empty=True), sig, ranking) == "Body"


def test_baseline_signature_ties_with_max_font_size_rank():
    assert baseline_signature(3) == (3, 1, 1, 1, 1, 1, 1, 1)
