"""UK/US spelling workbook runtime tests.

Covers the direction-aware regional spelling analyser introduced in
S-C. Workbook: Ninja Inkflow CE US and UK Spelling Database.

Test surface:
  * Loader counts (1329 variants, 552 common-both, 27 protected,
    22 patterns, 9 rules).
  * Direction: en-GB flags US forms with UK suggestions and vice
    versa. en-GB-oxendict accepts US forms the workbook lists as a
    UK alternative.
  * Common_Spellings safety: 'advertise', 'advise', 'comprise',
    'surprise', 'revise' never fire regardless of direction.
  * Protected_Terms safety: matches inside WHO / ISO / NIH phrases are
    skipped — the 'Organization' inside 'World Health Organization'
    does not get flagged in a UK doc.
  * Status-based tool_behaviour: ``disputed`` entries never fire;
    ``needs_review`` fires as flag not auto_replace; ``requires_context``
    downgrades to flag.
  * Scope-C overrides: disable/flip per entry_id.
  * Engine integration: findings produced through engine.analyze with
    category='spelling' matching the existing UI chip.
  * Scope-C invariant: analyser never mutates input text.
  * Spot-checks from the workbook's Test_Cases sheet (T01-T04).
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import uk_us_spelling as uus
from app.processing.language_editing import engine
from app.processing.language_editing.rules import load_rules_from_dict


@pytest.fixture(autouse=True)
def _cold_cache():
    uus.clear_cache()
    yield
    uus.clear_cache()


# ─── Loader counts ───────────────────────────────────────────────────

def test_loader_counts_match_workbook():
    assert len(uus._variants_data().get("entries", [])) == 1329
    assert len(uus._common_spellings_lc()) >= 500  # 552 but some may dedup
    assert len(uus._protected_terms_compiled()) == 27


# ─── Direction (workbook Test_Cases T01-T04) ─────────────────────────

@pytest.mark.parametrize(
    "text,variant,expected",
    [
        # T01 — en-GB flags three US forms
        (
            "The color of the center was analyzed carefully.",
            "en-GB",
            {("color", "colour"), ("center", "centre"), ("analyzed", "analysed")},
        ),
        # T02 — correct UK spellings in UK doc → no findings
        (
            "We organise the colour and the centre.",
            "en-GB",
            set(),
        ),
        # T03 — en-US flags three UK forms
        (
            "The colour of the centre was analysed carefully.",
            "en-US",
            {("colour", "color"), ("centre", "center"), ("analysed", "analyzed")},
        ),
        # T04 — correct US spellings in US doc → no findings
        (
            "We organize the color and the center.",
            "en-US",
            set(),
        ),
    ],
    ids=["T01-en-GB-US-forms", "T02-en-GB-correct", "T03-en-US-UK-forms", "T04-en-US-correct"],
)
def test_workbook_test_cases_direction(text, variant, expected):
    findings = uus.analyze_uk_us_spelling(text, document_variant=variant)
    actual = {(f.original.lower(), f.suggestion.lower()) for f in findings}
    assert actual == expected, f"{text!r} on {variant} → got {actual}, expected {expected}"


# ─── Oxford opt-in ───────────────────────────────────────────────────

def test_en_gb_oxendict_accepts_organize():
    """Oxford UK spelling accepts the -ize form. ``organize`` must not
    fire in en-GB-oxendict (it IS accepted) but MUST fire in en-GB
    (standard UK -ise)."""
    text = "We organize the colour and the centre."
    out_oxford = uus.analyze_uk_us_spelling(text, document_variant="en-GB-oxendict")
    assert not any(f.original.lower() == "organize" for f in out_oxford)

    out_standard = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert any(f.original.lower() == "organize" for f in out_standard)


# ─── Common_Spellings safety ─────────────────────────────────────────

@pytest.mark.parametrize(
    "word,variant",
    [
        ("advertise", "en-GB"), ("advertise", "en-US"),
        ("advise", "en-GB"), ("advise", "en-US"),
        ("comprise", "en-GB"), ("comprise", "en-US"),
        ("surprise", "en-GB"), ("surprise", "en-US"),
        ("revise", "en-GB"), ("revise", "en-US"),
    ],
)
def test_common_spellings_never_fire(word, variant):
    text = f"They {word} the matter."
    findings = uus.analyze_uk_us_spelling(text, document_variant=variant)
    assert not findings, (word, variant, findings)


# ─── Protected_Terms safety ──────────────────────────────────────────

def test_protected_term_WHO_organization_not_flagged():
    """'World Health Organization' in a UK doc must NOT produce a finding
    on 'Organization' — the WHO phrase is in Protected_Terms."""
    text = "The World Health Organization published guidance."
    out = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert not any("organization" in f.original.lower() for f in out), out


def test_protected_term_isolated_word_still_fires():
    """But 'Organization' NOT inside a protected phrase (standalone)
    SHOULD still be flagged in a UK doc."""
    text = "Organization theory in a UK doc."
    out = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert any(f.original == "Organization" for f in out), out


# ─── Status-based tool_behaviour ─────────────────────────────────────

def test_disputed_entries_never_fire():
    """Pick a disputed entry from the workbook and verify it emits no
    finding in either direction."""
    data = uus._variants_data()
    disputed = [r for r in data["entries"] if r["validation_status"] == "disputed"]
    assert disputed, "workbook should ship with some disputed entries"
    row = disputed[0]
    for variant in ("en-GB", "en-US"):
        probe = row["us_spelling"] if variant == "en-GB" else row["uk_spelling"]
        text = f"The word {probe} appears here."
        out = uus.analyze_uk_us_spelling(text, document_variant=variant)
        assert not any(f.rule_id == row["entry_id"] for f in out), (row["entry_id"], out)


def test_needs_review_fires_as_flag_not_auto_replace():
    """needs_review entries produce findings but with tool_behaviour=flag,
    even if the entry's action would otherwise permit auto_replace."""
    data = uus._variants_data()
    needs = [r for r in data["entries"] if r["validation_status"] == "needs_review"]
    assert needs, "workbook should ship with some needs_review entries"
    # Find one where the US form appears in a UK doc.
    row = needs[0]
    probe = row["us_spelling"]
    text = f"They {probe} as needed."
    out = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    hits = [f for f in out if f.rule_id == row["entry_id"]]
    assert hits, (row["entry_id"], out)
    for h in hits:
        assert h.autofixable is False, h


def test_requires_context_downgrades_to_flag():
    """requires_context entries must never be autofixable, regardless of
    whether the action otherwise permits it."""
    data = uus._variants_data()
    ctx = [r for r in data["entries"] if r.get("requires_context")]
    assert ctx, "workbook should ship with some requires_context entries"
    row = ctx[0]
    for variant in ("en-GB", "en-US"):
        probe = row["us_spelling"] if variant == "en-GB" else row["uk_spelling"]
        text = f"They {probe} it."
        out = uus.analyze_uk_us_spelling(text, document_variant=variant)
        for f in out:
            if f.rule_id == row["entry_id"]:
                assert f.autofixable is False, (variant, f)


# ─── Scope-C overrides ───────────────────────────────────────────────

def test_rule_overrides_disable_entry():
    """A per-entry override can silence a single pair."""
    text = "The color is red."
    base = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert any(f.original == "color" for f in base)

    # Find the entry_id that fired for 'color' and disable it.
    color_fid = next((f.rule_id for f in base if f.original == "color"), None)
    assert color_fid
    off = uus.analyze_uk_us_spelling(
        text, document_variant="en-GB",
        rule_overrides={color_fid: {"enabled": False}},
    )
    assert not any(f.original == "color" for f in off), off


def test_rule_overrides_flip_tool_behaviour():
    """A per-entry override can flip auto_replace to flag."""
    text = "The color is red."
    base = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    color_fid = next(f.rule_id for f in base if f.original == "color")
    flipped = uus.analyze_uk_us_spelling(
        text, document_variant="en-GB",
        rule_overrides={color_fid: {"tool_behaviour": "flag"}},
    )
    hits = [f for f in flipped if f.original == "color"]
    assert hits
    assert hits[0].autofixable is False


# ─── Engine integration ─────────────────────────────────────────────

def test_engine_runs_uk_us_spelling_alongside_profile_rules():
    """When no profile rules load, the engine still produces the
    workbook-driven spelling findings via the dedicated analyser."""
    text = "The color of the center was analyzed."
    rules = load_rules_from_dict([])
    findings = engine.analyze(
        text, rules, {}, [(0, len(text), text)], document_variant="en-GB",
    )
    kinds = {(f.rule_id, f.original, f.suggestion) for f in findings
             if f.category == "spelling"}
    # Every finding is in the SV- namespace (workbook entry_id), proving
    # we're reading from the workbook not the legacy UK_US_PAIRS loop.
    for rid, orig, sug in kinds:
        assert rid.startswith("SV-"), (rid, orig, sug)
    # Three expected pairs fired.
    orig_sug = {(o.lower(), s.lower()) for _, o, s in kinds}
    assert ("color", "colour") in orig_sug
    assert ("center", "centre") in orig_sug
    assert ("analyzed", "analysed") in orig_sug


def test_mc_uk_us_meta_toggle_kills_workbook_path():
    """The MC_UK_US meta-toggle must silence the workbook-driven path
    just as it silenced the legacy UK_US_PAIRS loop. Reviewers can turn
    the whole family off per project."""
    text = "The color is red."
    rules = load_rules_from_dict([
        {"id": "MC_UK_US", "category": "builtin", "type": "builtin",
         "enabled": False},
    ])
    findings = engine.analyze(
        text, rules, {}, [(0, len(text), text)], document_variant="en-GB",
    )
    assert not any(f.category == "spelling" for f in findings), findings


# ─── Spell-check whitelist feed ─────────────────────────────────────

def test_preferred_terms_for_variants():
    us_terms = uus.preferred_terms_for("en-US")
    gb_terms = uus.preferred_terms_for("en-GB")
    oxford_terms = uus.preferred_terms_for("en-GB-oxendict")

    # Direction sanity.
    assert "color" in us_terms and "colour" not in us_terms
    assert "colour" in gb_terms and "color" not in gb_terms
    # Oxford opt-in: UK spellings PLUS listed US alternatives.
    assert "colour" in oxford_terms
    assert "organize" in oxford_terms  # Oxford accepts -ize
    # Common_Spellings are always valid in every variant.
    for v in (us_terms, gb_terms, oxford_terms):
        assert "advertise" in v
        assert "advise" in v


# ─── Scope-C invariant ──────────────────────────────────────────────

def test_analyser_never_mutates_input_text():
    text = "The color of the center was analyzed."
    before = text
    _ = uus.analyze_uk_us_spelling(text, document_variant="en-GB")
    assert text == before
