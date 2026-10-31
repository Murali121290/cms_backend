"""Phase 4 integration tests — end-to-end interactions the smoke tests
and single-sheet 154-case harness don't exercise together.

Covered interactions:
  * spell_check + hyphen_dash + MC_COMPOUNDS co-existing on one paragraph
    with no duplicate findings on the same span
  * alternate suggestion selection: a Dash_Rules row with Suggestion 2
    is persisted through the Finding dataclass
  * protected literal (COVID-19) does not surface as a typo even when
    the surface would otherwise trip pyspellchecker
  * disabled overbroad protected patterns don't suppress real findings
    (regression guard against future un-disabling without a workbook fix)
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import hyphen_dash as hd
from app.processing.language_editing import engine, spell_check
from app.processing.language_editing.rules import load_rules_from_dict


@pytest.fixture(autouse=True)
def _cold_cache():
    hd.clear_cache()
    yield
    hd.clear_cache()


# ─── spell + hyphen + MC_COMPOUNDS: no duplicates ─────────────────────────

def test_three_detectors_coexist_without_duplicate_spans():
    """One paragraph exercises:
      * spell_check (`enviroment` typo)
      * hyphen_dash phrase lookup (`age related` → `age-related`)
      * MC_COMPOUNDS (unaffected, no hyphenated form here)

    Every finding must live on a UNIQUE (start, end) span after engine
    overlap resolution — no two detectors should both own the same slice."""
    text = (
        "The age related complication was noted in the enviroment report."
    )

    sc = spell_check.get_spell_checker()
    sent_tuples = [(0, len(text), text)]
    engine_rules = []  # no user rules; relying on manuscript_core + hyphen_dash + spell_check path
    found = engine.analyze(text, engine_rules, dictionary={}, sents=sent_tuples)
    # Spell check runs separately in the real router but we can prove the
    # exclude_spans contract here by passing engine findings' spans.
    rule_spans = [(f.start, f.end) for f in found
                  if f.category in {"spelling", "grammar", "compounds", "bias", "hyphenation"}]
    typos = spell_check.spell_check_paragraph(
        text, sc, exclude_spans=rule_spans,
    )

    all_findings = found + typos
    spans = [(f.start, f.end) for f in all_findings]
    assert len(spans) == len(set(spans)), (
        f"duplicate spans across detectors: {spans}"
    )

    rule_ids = {f.rule_id for f in all_findings}
    # Must have fired: HY-0007 (age related), typo:enviroment.
    assert any(rid.startswith("HY-") for rid in rule_ids), rule_ids
    assert any("enviroment" in rid for rid in rule_ids), rule_ids


# ─── alt_suggestions survive through the Finding dataclass ───────────────

def test_alt_suggestion_populated_on_dash_rule_with_suggestion_2():
    """Dash_Rules D10 ships Suggestion 2 = ' – ' (spaced en dash) alongside
    the primary em-dash replacement. The emitted Finding must carry the
    alternate so the API serialiser and the UI dropdown can read it."""
    text = "The result - however small - mattered."
    findings = hd.analyze_hyphen_dash(text, dash_profile="all")
    d10 = [f for f in findings if f.rule_id == "D10"]
    assert d10, "D10 should fire on spaced-hyphen between words"
    f = d10[0]
    assert f.suggestion == "—", f.suggestion
    assert f.alt_suggestions, "D10 ships Suggestion 2 (spaced en dash)"
    assert any(" – " == a for a in f.alt_suggestions), f.alt_suggestions


# ─── protected literal + spell_check overlap ─────────────────────────────

def test_protected_literal_suppresses_spell_check_typo():
    """COVID-19 is a protected literal. Even in isolation (no hyphen
    rule firing), the spell checker must not propose a replacement for
    the token because the protected spans join the overlap-skip list."""
    sc = spell_check.get_spell_checker()
    text = "The post COVID-19 recovery was documented."
    protected_spans = hd.build_protected_spans(text, dash_profile="all")
    typos = spell_check.spell_check_paragraph(
        text, sc, protected_spans=protected_spans,
    )
    for t in typos:
        assert "covid" not in t.original.lower(), t


# ─── MC_COMPOUNDS subtraction ────────────────────────────────────────────

def test_mc_compounds_still_fires_on_uncovered_bases():
    """`end-point` is in COMPOUND_BASES but NOT in the hyphen/dash
    workbook. It must still produce a `compound_end_point` finding after
    the subtraction, so the engine doesn't accidentally over-prune."""
    text = "The end-point was reached."
    out = engine.run_manuscript_core_rules(text)
    assert any(f.rule_id == "compound_end_point" for f in out), out


def test_mc_compounds_finding_now_emits_category_hyphenation():
    """Option B merge: MC_COMPOUNDS findings land under the unified
    `hyphenation` category so Compounds and Hyphenation share a single
    sidebar tab. ``rule_id`` prefix (``compound_``) still identifies the
    LWW source for the UI's Workbook/LWW-list badge."""
    text = "The end-point was reached."
    out = engine.run_manuscript_core_rules(text)
    mc = next(f for f in out if f.rule_id == "compound_end_point")
    assert mc.category == "hyphenation", (
        f"expected unified category 'hyphenation'; got {mc.category!r}"
    )


def test_mc_compounds_skips_health_care_now_in_workbook():
    """Regression for the Phase 2 subtraction: workbook-covered bases
    must not double-fire through MC_COMPOUNDS."""
    text = "The health-care system was audited."
    out = engine.run_manuscript_core_rules(text)
    assert not any(f.rule_id == "compound_health_care" for f in out), out


# ─── disabled-protected regressions ──────────────────────────────────────

def test_disabled_protected_patterns_do_not_block_dash_rules():
    """Guard: should any of the 4 overbroad protected IDs be re-enabled
    before a workbook fix lands, this test fails immediately — forcing
    the maintainer to confirm the tighter patterns pass D01/D08/D10/D14
    on the shapes that currently break."""
    cases = [
        ("See pages 10-20 for details.", "D01"),       # was blocked by PR-020
        ("From 10-20 patients to 100-128 pages.", "D04a"),  # PR-023 phone
        ("A well -known result.", "D14"),              # PR-024 CLI
        ("A 5-year old child was enrolled.", "H03b"),  # PR-027 chemical
    ]
    for text, expected_rule in cases:
        findings = hd.analyze_hyphen_dash(text, dash_profile="all")
        rule_ids = {f.rule_id for f in findings}
        assert expected_rule in rule_ids, (
            f"{expected_rule} must fire on {text!r}; got {rule_ids}"
        )
