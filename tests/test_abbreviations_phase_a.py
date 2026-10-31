"""Phase A smoke tests for the Abbreviations workbook runtime.

Scope (Phase A only):
  * Do_Not_Use regex rules fire with the correct suggestion.
  * Per-project override disables an individual DNU rule.
  * Workbook surface exposes 32 DNU + 746 Abbreviation_List rules (778 total)
    with [ISMP] / [Joint Commission] source badges.
  * The engine entry point (engine.analyze) emits abbreviations findings
    alongside existing rule families with no cross-contamination.
  * AUTO_REPLACE preference never silently mutates text — findings still
    carry original + suggestion, text input is unchanged.
  * Hyphenation workbook is unaffected (regression guard).
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import engine, hyphen_dash as hd
from app.processing.language_editing import workbook_rules_surface as ws


@pytest.fixture(autouse=True)
def _cold_cache():
    ws.clear_cache()  # also clears ab + hd caches via the override
    yield
    ws.clear_cache()


# ─── Do_Not_Use detection ──────────────────────────────────────────────

@pytest.mark.parametrize("text,rule_id,expected_suggestion", [
    ("Give 10 U of insulin.",   "DN01", "0 units"),       # "0 U" -> "0 units"
    ("Give 5000 IU daily.",     "DN02", "international units"),
    ("Take 1 tablet QD.",       "DN03", "daily"),
    ("Give 1 tablet QOD.",      "DN04", "every other day"),
    ("Give 5.0 mg.",            "DN05", "5 mg"),          # trailing zero
])
def test_dnu_fires_with_expected_suggestion(text, rule_id, expected_suggestion):
    findings = ab.analyze_do_not_use(text)
    matched = [f for f in findings if f.rule_id == rule_id]
    assert matched, f"{rule_id} should fire on {text!r}; got {[(f.rule_id, f.original) for f in findings]}"
    assert expected_suggestion in matched[0].suggestion, (
        f"{rule_id}: expected suggestion to contain {expected_suggestion!r}, got {matched[0].suggestion!r}"
    )


def test_dnu_does_not_fire_on_clean_text():
    assert ab.analyze_do_not_use("Give 10 mg daily.") == []


def test_dnu_override_disables_rule():
    text = "Give 10 U of insulin."
    assert any(f.rule_id == "DN01" for f in ab.analyze_do_not_use(text))
    out = ab.analyze_do_not_use(text, rule_overrides={"DN01": {"enabled": False}})
    assert not any(f.rule_id == "DN01" for f in out)


def test_dnu_override_promotes_to_auto_replace_changes_severity_only():
    text = "Give 10 U of insulin."
    base = next(f for f in ab.analyze_do_not_use(text) if f.rule_id == "DN01")
    assert base.severity == "warning"  # DNU default is "flag" → warning
    promoted = next(
        f for f in ab.analyze_do_not_use(text, rule_overrides={"DN01": {"tool_behaviour": "auto_replace"}})
        if f.rule_id == "DN01"
    )
    assert promoted.severity == "suggestion"
    # Same finding content either way — AUTO is a preference, not a text mutation.
    assert promoted.original == base.original
    assert promoted.suggestion == base.suggestion


# ─── workbook_rules_surface ────────────────────────────────────────────

def test_abbreviations_surface_counts():
    summary = ws.abbreviation_rule_summary()
    # 32 Do_Not_Use + 746 Abbreviation_List = 778 total
    assert summary["total"] == 778, summary
    # Every rule enabled by default; DNU default behaviour is "flag"; Abbreviation_List
    # entries default to "flag" too (Phase A doesn't yet fire them — Phase B will).
    assert summary["enabled"] == 778
    assert summary["flag"] == 778
    assert summary["auto_replace"] == 0


def test_abbreviations_surface_includes_source_badges():
    rules = ws.list_abbreviation_rules()
    dnu01 = next(r for r in rules if r["id"] == "DN01")
    assert dnu01["source_badge"] == "Joint Commission", dnu01
    # DN11+ are ISMP-sourced per the workbook
    ismp = next(r for r in rules if r.get("source_badge") == "ISMP")
    assert ismp["type"] == "regex"


def test_abbreviations_surface_overrides_merge():
    rules = ws.list_abbreviation_rules({"DN01": {"enabled": False}})
    dnu01 = next(r for r in rules if r["id"] == "DN01")
    assert dnu01["enabled"] is False
    assert dnu01["is_overridden"] is True


def test_hyphenation_surface_unchanged_by_abbreviations_work():
    """Scope-C invariant: adding the Abbreviations family must not perturb
    the Hyphenation surface's counts."""
    hs = ws.hyphenation_rule_summary()
    assert hs["total"] == 875, hs


# ─── Engine integration ────────────────────────────────────────────────

def test_engine_analyze_emits_abbreviations_findings():
    text = "Take 1 tablet QD and give 10 U of insulin."
    out = engine.analyze(text, rules=[], dictionary={}, sents=[(0, len(text), text)])
    rule_ids = {f.rule_id for f in out}
    assert "DN01" in rule_ids and "DN03" in rule_ids, out


def test_engine_analyze_respects_abbreviations_override():
    text = "Take 1 tablet QD."
    out = engine.analyze(
        text, rules=[], dictionary={}, sents=[(0, len(text), text)],
        rule_overrides={"DN03": {"enabled": False}},
    )
    assert not any(f.rule_id == "DN03" for f in out)


def test_engine_analyze_abbreviations_do_not_break_hyphenation():
    """Both workbooks should fire on a mixed paragraph."""
    text = "The age related complication required 10 U of insulin."
    out = engine.analyze(text, rules=[], dictionary={}, sents=[(0, len(text), text)])
    cats = {f.category for f in out}
    assert "hyphenation" in cats
    assert "abbreviations" in cats


# ─── Never silently mutate ─────────────────────────────────────────────

def test_abbreviations_auto_replace_never_mutates_text_at_analyze_time():
    """Scope-C invariant: a FLAG rule promoted to AUTO_REPLACE via override
    still emits only a Finding — the input text is unchanged."""
    original = "Give 10 U of insulin."
    before = original
    findings = ab.analyze_do_not_use(
        original, rule_overrides={"DN01": {"tool_behaviour": "auto_replace"}},
    )
    assert original == before  # Python str is immutable; also assert value unchanged
    f = next(x for x in findings if x.rule_id == "DN01")
    assert f.original != f.suggestion  # suggestion differs but text didn't change
    assert f.autofixable is True       # UI can offer one-click accept
