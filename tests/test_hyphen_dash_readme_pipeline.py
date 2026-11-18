"""Regression tests for the Hyphenation / En Dash pipeline against the
workbook README (Hyphen_and_EnDash_Rules_for_CE_Tool.xlsx, sheet
``README_Developer``). The README is the authoritative spec; each test
anchors on a numbered spec item.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import hyphen_dash


@pytest.fixture(autouse=True)
def _reset_caches():
    hyphen_dash.clear_cache()
    yield
    hyphen_dash.clear_cache()


# ─── README §5 Step 2: hyphen variants collapse for matching ────────

def test_detect_list_matches_author_typed_u2010_hyphen():
    """HY-0391 ``after-care`` is a Detect_List row whose source carries
    a literal hyphen. An author who typed the Unicode hyphen U+2010
    (``after‐care``) must still trigger the row — README §5 Step 2
    requires U+2010 / U+2011 to be treated as the keyboard hyphen when
    matching, without mutating the surface text."""
    text = "Routine after‐care instructions were given."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    matched = [f for f in findings if f.rule_id.startswith("HY-")
               and "after" in f.original.lower()
               and "care" in f.original.lower()]
    assert matched, (
        f"Detect_List row for 'after-care' failed to match the U+2010 "
        f"variant. Findings: {[(f.rule_id, f.original) for f in findings]}"
    )
    # Surface preserved verbatim — the finding quotes the author's
    # original Unicode-hyphen text.
    assert "‐" in matched[0].original


def test_detect_list_matches_author_typed_u2011_non_breaking_hyphen():
    """Same contract for U+2011 (non-breaking hyphen) which ebook
    pipelines sometimes substitute silently."""
    text = "The after‑care notes were filed."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    matched = [f for f in findings if f.rule_id.startswith("HY-")
               and "after" in f.original.lower()
               and "care" in f.original.lower()]
    assert matched, (
        f"Detect_List failed on U+2011: {[(f.rule_id, f.original) for f in findings]}"
    )


def test_detect_list_does_not_collapse_en_dash_to_hyphen_for_matching():
    """``U+2013`` is NOT a hyphen variant per the README (§5 Step 2 / §3
    Character_Map). A term whose source is ``after-care`` must NOT
    match the en-dash spelling ``after–care``."""
    text = "The term after–care appeared once."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    hy_hits = [
        f for f in findings
        if f.rule_id.startswith("HY-")
        and "after" in f.original.lower()
        and "care" in f.original.lower()
        and "–" in f.original
    ]
    assert hy_hits == [], (
        f"en dash must not fold into hyphen for Detect_List matching, "
        f"got: {[(f.rule_id, f.original) for f in hy_hits]}"
    )


# ─── README §5 Step 7: overlap resolution ──────────────────────────

def test_en_dash_terms_win_over_dash_rules_on_same_span():
    """A Joint-eponym En_Dash_Terms row (step 4) must suppress any
    Dash_Rules match (step 6) on the identical span — README §5 Step 7:
    "earlier step wins"."""
    text = "The study applied the Kaplan-Meier estimator."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    eponym = [f for f in findings if f.original == "Kaplan-Meier"]
    assert eponym, "En_Dash_Terms row for Kaplan-Meier failed to emit"
    # Any Dash_Rule finding (e.g. D09) that overlaps must have been
    # dropped by the overlap resolver.
    for f in findings:
        if f.rule_id.startswith("D") and not f.rule_id.startswith("D-"):
            # Only flag a conflict when the span actually overlaps.
            es, ee = eponym[0].start, eponym[0].end
            assert not (f.start < ee and es < f.end), (
                f"overlap resolver failed — {f.rule_id} fires on the same "
                f"span as the En_Dash_Terms Kaplan-Meier finding"
            )


def test_overlap_resolver_keeps_longer_span_within_same_step():
    """When two Detect_List phrases both cover ``Wolff-Parkinson-White``
    (hypothetical rows for the pair and the triple) the longer match
    wins — README §5 Step 7: "If they are from the same step, keep the
    longer span."""
    # Smoke-test the resolver directly — we control the input so we
    # don't depend on workbook row inventory.
    from app.processing.language_editing.rules import Finding

    short = Finding(
        rule_id="HY-SHORT", category="hyphenation",
        start=0, end=14,  # "Wolff-Parkinson" (14 chars)
        original="Wolff-Parkinson", suggestion="",
        message="", severity="suggestion", autofixable=False,
    )
    long = Finding(
        rule_id="HY-LONG", category="hyphenation",
        start=0, end=21,  # "Wolff-Parkinson-White" (21 chars)
        original="Wolff-Parkinson-White", suggestion="",
        message="", severity="suggestion", autofixable=False,
    )
    kept = hyphen_dash._resolve_overlaps([(1, [short, long])])
    assert [f.rule_id for f in kept] == ["HY-LONG"]


def test_overlap_resolver_keeps_non_overlapping_findings():
    """The resolver must never drop a non-overlapping finding — only
    conflicts collapse."""
    from app.processing.language_editing.rules import Finding

    a = Finding(rule_id="A", category="hyphenation", start=0, end=5,
                original="abcde", suggestion="", message="",
                severity="suggestion", autofixable=False)
    b = Finding(rule_id="B", category="hyphenation", start=10, end=15,
                original="fghij", suggestion="", message="",
                severity="suggestion", autofixable=False)
    kept = hyphen_dash._resolve_overlaps([(0, [a]), (1, [b])])
    assert {f.rule_id for f in kept} == {"A", "B"}


def test_overlap_resolver_preserves_document_order():
    """Output is sorted by document position so downstream rendering
    stays deterministic."""
    from app.processing.language_editing.rules import Finding

    later = Finding(rule_id="LATER", category="hyphenation", start=20, end=25,
                    original="x" * 5, suggestion="", message="",
                    severity="suggestion", autofixable=False)
    earlier = Finding(rule_id="EARLY", category="hyphenation", start=0, end=5,
                      original="y" * 5, suggestion="", message="",
                      severity="suggestion", autofixable=False)
    kept = hyphen_dash._resolve_overlaps([(0, [later, earlier])])
    assert [f.rule_id for f in kept] == ["EARLY", "LATER"]


# ─── README §5 pipeline order ──────────────────────────────────────

def test_en_dash_terms_are_evaluated_before_dash_rules():
    """Spec: Step 4 (En_Dash_Terms) runs before Step 6 (Dash_Rules) so
    an approved en-dash term is not later flagged by rule D09.

    This is verified indirectly: if the order were reversed and the
    overlap resolver worked ``later step wins``, the Dash_Rules finding
    on ``Mann–Whitney`` would survive. With the correct order plus the
    resolver, the En_Dash_Terms finding wins and no D09-style finding
    overlaps it."""
    text = "The Mann–Whitney U test compared the two groups."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    en_hits = [f for f in findings if f.original == "Mann–Whitney"]
    assert en_hits
    es, ee = en_hits[0].start, en_hits[0].end
    for f in findings:
        if f.rule_id == en_hits[0].rule_id:
            continue
        overlaps = f.start < ee and es < f.end
        assert not overlaps, (
            f"pipeline order wrong — {f.rule_id} on {f.original!r} "
            f"overlaps the En_Dash_Terms finding and should have been "
            f"suppressed by Step 7"
        )


def test_surface_text_is_never_mutated_by_the_analyzer():
    """README §5 Step 1: "Work on a copy … keep a map … so edits land
    in the right place." The analyzer returns findings with verbatim
    surfaces; the input paragraph string must come out identical."""
    text = (
        "The well‐being study used Kaplan-Meier survival analysis "
        "and reported Guillain–Barré syndrome cases."
    )
    before = text
    hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    assert text == before
    # Each finding's ``original`` must equal the exact substring from
    # the input — no normalisation leaks into the Finding payload.
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile="all")
    for f in findings:
        assert f.original == text[f.start:f.end]
