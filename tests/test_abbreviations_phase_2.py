"""Phase 2 regression tests for the Abbreviations metadata serializer.

Phase 2 of the audit is strictly serializer-side: the engine's
finding output is unchanged, but the GET /findings response now
exposes the workbook metadata that previously only lived inside the
loaded JSON profiles.

These tests exercise ``abbreviations_metadata.enrich_finding`` and
its building blocks:

* ``problem_label_for`` — README §9 label mapping.
* ``dn_metadata_for``   — Do_Not_Use row lookup.
* ``extract_abbreviation`` / ``abbreviation_metadata_for`` —
  Abbreviation_List row lookup by token.
* AB07 meanings — ordered meanings list derived from the already
  score-sorted ``alt_suggestions``.

The tests use the real workbook JSON — we don't want to drift from
production data — but each test only asserts on fields the workbook
guarantees for the exercised rule / abbreviation.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations_metadata as meta
from app.processing.language_editing import abbreviations as ab


@pytest.fixture(autouse=True)
def _reset_caches():
    """Drop LRU caches before each test so one test's monkey-patched
    JSON (if any future test does that) does not leak forward."""
    meta.clear_cache()
    ab.clear_cache()
    yield
    meta.clear_cache()
    ab.clear_cache()


# ─── problem_label_for ────────────────────────────────────────────

def test_problem_label_ab01_is_first_use():
    assert meta.problem_label_for("AB01") == "First use"


def test_problem_label_ab05_is_single_use():
    assert meta.problem_label_for("AB05") == "Single use"


def test_problem_label_ab07_is_ambiguous():
    assert meta.problem_label_for("AB07") == "Ambiguous"


def test_problem_label_all_ab_rules_mapped():
    """Every AB01-AB17 the engine can emit must have a human label."""
    for n in range(1, 18):
        rid = f"AB{n:02d}"
        assert meta.problem_label_for(rid), f"missing label for {rid}"


def test_problem_label_dn_rules_all_do_not_use():
    for n in range(1, 33):
        rid = f"DN{n:02d}"
        assert meta.problem_label_for(rid) == "Do not use"


def test_problem_label_non_abbreviation_rule_returns_none():
    assert meta.problem_label_for("SL001") is None
    assert meta.problem_label_for("LWW-NE-123") is None
    assert meta.problem_label_for(None) is None


# ─── dn_metadata_for ──────────────────────────────────────────────

def test_dn_metadata_has_applies_in_and_note():
    """DN01 (U → units) sits in Medication orders per the workbook."""
    row = meta.dn_metadata_for("DN01")
    assert row.get("applies_in")  # workbook guarantees it exists
    assert row.get("notation")    # the "U" notation


def test_dn_metadata_unknown_rule_returns_empty():
    assert meta.dn_metadata_for("DN99") == {}
    assert meta.dn_metadata_for("") == {}


# ─── extract_abbreviation ─────────────────────────────────────────

def test_extract_abbreviation_from_original_token():
    """When ``original`` is the bare abbreviation itself."""
    assert meta.extract_abbreviation("AB07", "AI", "") == "AI"


def test_extract_abbreviation_from_suggestion_parens():
    """AB01 first-use suggestion shape: ``expansion (ABBR)``."""
    abbr = meta.extract_abbreviation(
        "AB01", "AI", "artificial intelligence (AI)"
    )
    assert abbr == "AI"


def test_extract_abbreviation_unknown_token_returns_none():
    assert meta.extract_abbreviation("AB01", "Qzzzzz", "") is None


# ─── abbreviation_metadata_for ────────────────────────────────────

def test_abbreviation_metadata_returns_subject_area():
    """Known abbreviations carry a subject_area tag."""
    row = meta.abbreviation_metadata_for("AI")
    assert row.get("abbreviation") == "AI"
    assert "subject_area" in row  # value may be None but key must exist


def test_abbreviation_metadata_ambiguous_entries_expose_meanings_metadata():
    """Ambiguous abbreviation (multiple workbook rows) exposes a
    per-meaning metadata list so the reviewer can see which subject
    area each candidate meaning belongs to."""
    # Pick an abbreviation known to have multiple entries. Walk the
    # index to find one deterministically.
    multi = [
        tok for tok, rows in meta._abbr_index_by_token().items()
        if len(rows) > 1
    ]
    assert multi, "workbook has no ambiguous abbreviations — data drift?"
    sample = multi[0]
    row = meta.abbreviation_metadata_for(sample)
    assert isinstance(row.get("meanings_metadata"), list)
    assert len(row["meanings_metadata"]) >= 2


def test_abbreviation_metadata_unknown_returns_empty():
    assert meta.abbreviation_metadata_for("Qzzzzz") == {}
    assert meta.abbreviation_metadata_for(None) == {}


# ─── enrich_finding composite ─────────────────────────────────────

def test_enrich_finding_ab01_has_problem_label_and_abbr_metadata():
    out = meta.enrich_finding(
        "AB01", "AI", "artificial intelligence (AI)", []
    )
    assert out["problem_label"] == "First use"
    # subject_area key always present even when workbook row's value is None
    assert "subject_area" in out
    # DN-only fields stay None on AB findings
    assert out["applies_in"] is None
    assert out["tool_behaviour"] is None
    assert out["meanings"] is None


def test_enrich_finding_dn01_has_applies_in():
    out = meta.enrich_finding("DN01", "U", "units", [])
    assert out["problem_label"] == "Do not use"
    assert out["applies_in"]  # workbook guarantees Medication orders
    # Abbreviation-list-only fields stay None on DN findings
    assert out["subject_area"] is None
    assert out["mw_lookup"] is None


def test_enrich_finding_ab07_exposes_meanings_sorted():
    """AB07 engine emission populates alt_suggestions in descending
    cue-score order; the serializer surfaces this as the meanings
    list with is_best_match=True on the first entry."""
    out = meta.enrich_finding(
        "AB07", "RA", "RA",
        alt_suggestions=["rheumatoid arthritis", "right atrium"],
    )
    assert out["meanings"] == [
        {"meaning": "rheumatoid arthritis", "is_best_match": True},
        {"meaning": "right atrium", "is_best_match": False},
    ]


def test_enrich_finding_ab07_without_alt_suggestions_has_null_meanings():
    out = meta.enrich_finding("AB07", "RA", "RA", [])
    assert out["meanings"] is None


def test_enrich_finding_shape_is_stable_regardless_of_rule():
    """The serializer response shape must not change with rule_id —
    frontend reads keys unconditionally."""
    expected_keys = {
        "problem_label", "note", "mw_lookup", "confidence",
        "tool_behaviour", "applies_in", "notation", "source",
        "subject_area", "first_use_rule", "ambiguity", "meanings",
    }
    for rid in ("AB01", "AB07", "DN01", "SL001", None):
        out = meta.enrich_finding(rid or "", "x", "x", [])
        assert set(out.keys()) == expected_keys, f"shape drift on {rid}"


def test_enrich_finding_unknown_rule_still_has_full_shape():
    """A findings row from a rule that isn't in the Abbreviations
    module (e.g., grammar workbook) gets a stable null-filled shape."""
    out = meta.enrich_finding("SL001", "some long sentence", "", [])
    assert out["problem_label"] is None
    assert all(
        out[k] is None for k in (
            "note", "mw_lookup", "confidence", "tool_behaviour",
            "applies_in", "notation", "source", "subject_area",
            "first_use_rule", "ambiguity", "meanings",
        )
    )
