"""Tests for signature.py: document-baseline computation and per-paragraph
signature-tuple construction. Pure dict-in/tuple-out - no Document needed."""

from app.utils.utils.structuring_lib.heading_classifier.signature import (
    build_signature,
    compute_signature_baseline,
    explain_signature,
)


def _features(**overrides):
    base = {
        "is_empty": False,
        "font_size_rank": 1,
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


def test_baseline_font_family_is_mode():
    features = [
        _features(font_family="Calibri"),
        _features(font_family="Calibri"),
        _features(font_family="Georgia"),
    ]
    baseline = compute_signature_baseline(features)
    assert baseline.baseline_font_family == "Calibri"


def test_baseline_alignment_is_mode():
    features = [
        _features(alignment="LEFT"),
        _features(alignment="LEFT"),
        _features(alignment="CENTER"),
    ]
    baseline = compute_signature_baseline(features)
    assert baseline.baseline_alignment == "LEFT"


def test_baseline_tie_broken_by_first_encountered():
    features = [_features(font_family="Georgia"), _features(font_family="Calibri")]
    baseline = compute_signature_baseline(features)
    assert baseline.baseline_font_family == "Georgia"


def test_baseline_max_font_size_rank_is_largest_rank_seen():
    features = [_features(font_size_rank=0), _features(font_size_rank=3), _features(font_size_rank=1)]
    baseline = compute_signature_baseline(features)
    assert baseline.max_font_size_rank == 3


def test_baseline_ignores_empty_paragraphs():
    features = [_features(font_family="Calibri"), _features(font_family="Georgia", is_empty=True)]
    baseline = compute_signature_baseline(features)
    assert baseline.baseline_font_family == "Calibri"


def test_build_signature_none_font_size_sorts_below_max_rank():
    baseline = compute_signature_baseline([_features(font_size_rank=2)])
    sig_known = build_signature(_features(font_size_rank=2), baseline)
    sig_unknown = build_signature(_features(font_size_rank=None), baseline)
    assert sig_known < sig_unknown


def test_build_signature_orientation_smaller_tuple_is_more_senior():
    baseline = compute_signature_baseline([_features()])
    senior = build_signature(_features(font_size_rank=0, bold=True), baseline)
    junior = build_signature(_features(font_size_rank=5, bold=False), baseline)
    assert senior < junior


def test_explain_signature_lists_active_signals_in_priority_order():
    baseline = compute_signature_baseline([_features(font_family="Calibri", alignment="LEFT")])
    reasons = explain_signature(
        _features(font_size_rank=0, bold=True, is_all_uppercase=True, alignment="CENTER"),
        baseline,
    )
    assert reasons == ["Font size rank 0 (most senior)", "Bold", "ALL CAPS", "Centered"]
