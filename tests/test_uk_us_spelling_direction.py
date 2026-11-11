"""Regression tests for direction-aware UK/US spelling findings and the
``document_variant`` reconciliation that keeps the spelling engine
pointed at whichever Styles choice is currently active.

The engine itself (`uk_us_spelling.analyze_uk_us_spelling`) is already
direction-aware — these tests pin that behaviour down with the user's
exact examples so a future regression cannot flip the direction. The
reconciliation tests cover the plumbing from ``profile_keys`` into the
``document_variant`` that the engine receives at analyze time.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import uk_us_spelling as uk_us
from app.services.language_rule_service import (
    _default_document_variant_for,
    _reconcile_document_variant,
)


# ─── 1. Engine direction, US document ──────────────────────────────

@pytest.mark.parametrize("word", ["color", "center", "organize", "analyze"])
def test_us_doc_accepts_us_spelling(word):
    """US-selected project must not flag the US form."""
    text = f"The {word} is fine."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-US")
    assert findings == [], f"{word!r} wrongly flagged in en-US"


@pytest.mark.parametrize("word,expected_us", [
    ("colour", "color"),
    ("centre", "center"),
    ("organise", "organize"),
    ("analyse", "analyse"),  # analyse is UK; US suggests analyze
])
def test_us_doc_flags_uk_spelling_and_suggests_us(word, expected_us):
    text = f"The {word} is fine."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-US")
    assert findings, f"{word!r} should have been flagged in en-US"
    # analyse → analyze; first finding carries the US spelling suggestion.
    assert findings[0].suggestion.lower() == expected_us.replace("analyse", "analyze").lower()


# ─── 2. Engine direction, UK document ──────────────────────────────

@pytest.mark.parametrize("word", ["colour", "centre", "organise", "analyse"])
def test_uk_doc_accepts_uk_spelling(word):
    """UK-selected project must not flag the UK form."""
    text = f"The {word} is fine."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert findings == [], f"{word!r} wrongly flagged in en-GB"


@pytest.mark.parametrize("word,expected_uk", [
    ("color", "colour"),
    ("center", "centre"),
    ("organize", "organise"),
    ("analyze", "analyse"),
])
def test_uk_doc_flags_us_spelling_and_suggests_uk(word, expected_uk):
    text = f"The {word} is fine."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert findings, f"{word!r} should have been flagged in en-GB"
    assert findings[0].suggestion.lower() == expected_uk.lower()


# ─── 3. Shared spellings never flagged in either variant ───────────

@pytest.mark.parametrize("word", ["science", "article", "about", "research", "patient"])
def test_shared_spelling_no_finding_in_either_variant(word):
    text = f"The {word} is important."
    for variant in ("en-US", "en-GB", "en-GB-oxendict"):
        findings = uk_us.analyze_uk_us_spelling(text, document_variant=variant)
        assert findings == [], f"{word!r} wrongly flagged in {variant}"


# ─── 4. Multiple occurrences all flagged ───────────────────────────

def test_multiple_wrong_direction_all_flagged():
    """Each occurrence of the wrong-variant word surfaces as its own
    finding — we don't dedupe across the paragraph."""
    text = "The color at the center of the page highlights the color scheme."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    color_findings = [f for f in findings if f.original.lower() == "color"]
    center_findings = [f for f in findings if f.original.lower() == "center"]
    assert len(color_findings) == 2, f"expected two 'color' findings, got {color_findings}"
    assert len(center_findings) == 1


# ─── 5. Mixed document — only wrong direction flagged ──────────────

def test_mixed_document_only_wrong_direction_flagged():
    """A paragraph mixing US and UK spellings in a UK project surfaces
    findings for the US forms only; the UK forms stay clean."""
    text = "The colour is bright but the color is dim. Centre vs center."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    surfaces = sorted(f.original for f in findings)
    assert "color" in surfaces
    assert "center" in surfaces
    assert "colour" not in surfaces, "UK form wrongly flagged in UK project"
    assert "centre" not in surfaces


# ─── 6. Case preservation on suggestions ───────────────────────────

def test_case_preserved_on_suggestion():
    """The suggestion mirrors the capitalisation shape of the original
    so a sentence-initial word stays capitalised in the replacement."""
    text = "Color is important. CENTER the layout."
    findings = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    by_original = {f.original: f.suggestion for f in findings}
    assert by_original.get("Color") == "Colour"
    assert by_original.get("CENTER") == "CENTRE"


# ─── 7. Oxford variant preserves US alternatives on UK projects ────

def test_oxford_accepts_us_alternatives():
    """``en-GB-oxendict`` accepts the Oxford -ize set (e.g. organize)
    without flagging it, but still flags words that are always-UK
    (e.g. analyse → analyze still a swap)."""
    for word in ("organize", "organise"):
        findings = uk_us.analyze_uk_us_spelling(
            f"We will {word} the event.", document_variant="en-GB-oxendict",
        )
        assert findings == [], f"{word!r} wrongly flagged in en-GB-oxendict"
    # analyze is NOT in the Oxford alt set — still flagged.
    findings = uk_us.analyze_uk_us_spelling(
        "We analyze the data.", document_variant="en-GB-oxendict",
    )
    assert any(f.original == "analyze" for f in findings)


# ─── 8. Rule override disables a specific entry ────────────────────

def test_rule_override_suppresses_specific_entry():
    """A per-entry Scope-C override ({SV-00699: {enabled: false}})
    disables the color/colour finding even in a wrong-direction doc."""
    text = "The color is bright."
    # First confirm it fires without override.
    before = uk_us.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert any(f.rule_id == "SV-00699" for f in before)
    # Then suppress just that entry.
    after = uk_us.analyze_uk_us_spelling(
        text, document_variant="en-GB",
        rule_overrides={"SV-00699": {"enabled": False}},
    )
    assert not any(f.rule_id == "SV-00699" for f in after)


# ─── 9. Protected terms never flagged ──────────────────────────────

def test_protected_term_not_flagged():
    """Protected phrases (WHO, ISO, NIH …) must survive the spelling
    check in both directions."""
    text = "The WHO published a report."
    for variant in ("en-US", "en-GB"):
        findings = uk_us.analyze_uk_us_spelling(text, document_variant=variant)
        for f in findings:
            assert "WHO" not in f.original, f"WHO wrongly flagged in {variant}"


# ─── 10. _default_document_variant_for mapping ─────────────────────

@pytest.mark.parametrize("profile_keys,expected", [
    (["us"], "en-US"),
    (["ama"], "en-US"),
    (["apa"], "en-US"),
    (["chicago"], "en-US"),
    (["uk"], "en-GB"),
    (["canadian"], "en-GB"),
    (None, "en-GB"),
    ([], "en-GB"),
])
def test_default_variant_for_profile_keys(profile_keys, expected):
    assert _default_document_variant_for(profile_keys) == expected


# ─── 11. _reconcile_document_variant — drift is corrected ──────────

def test_reconcile_discards_stale_us_on_uk_project():
    """A UK project with a stale 'en-US' stored value gets corrected
    to 'en-GB' on the next save/read — prevents the drift bug."""
    assert _reconcile_document_variant("en-US", ["uk"]) == "en-GB"


def test_reconcile_discards_stale_uk_on_us_project():
    assert _reconcile_document_variant("en-GB", ["us"]) == "en-US"
    assert _reconcile_document_variant("en-GB", ["apa"]) == "en-US"


def test_reconcile_none_falls_back_to_derived():
    assert _reconcile_document_variant(None, ["us"]) == "en-US"
    assert _reconcile_document_variant(None, ["uk"]) == "en-GB"


# ─── 12. _reconcile_document_variant — Oxford opt-in survives ──────

def test_reconcile_oxford_preserved_on_uk_project():
    """en-GB-oxendict IS honoured when the primary style is UK-adjacent
    — it's the one setting that profile_keys[0] alone cannot express."""
    assert _reconcile_document_variant("en-GB-oxendict", ["uk"]) == "en-GB-oxendict"
    assert _reconcile_document_variant("en-GB-oxendict", ["canadian"]) == "en-GB-oxendict"


def test_reconcile_oxford_dropped_on_us_project():
    """en-GB-oxendict on a US-adjacent project makes no sense and is
    reconciled to en-US so the spelling engine doesn't accept US forms
    the user didn't actually request."""
    assert _reconcile_document_variant("en-GB-oxendict", ["us"]) == "en-US"
    assert _reconcile_document_variant("en-GB-oxendict", ["apa"]) == "en-US"


def test_reconcile_invalid_value_falls_back():
    """An unknown value degrades gracefully to the derived variant
    rather than raising — defends the client against bad payloads."""
    assert _reconcile_document_variant("en-ZZ", ["us"]) == "en-US"
    assert _reconcile_document_variant("not-a-variant", ["uk"]) == "en-GB"
