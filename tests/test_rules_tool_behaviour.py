"""Scope C: tool_behaviour + per-project rule_overrides tests.

Invariants under test:
  * ``Rule.tool_behaviour`` round-trips through ``to_dict`` / loader.
  * The ``load_rules_from_dict`` loader never silently accepts a bad value
    for ``tool_behaviour`` — garbage is coerced to ``None`` (= default FLAG).
  * The engine respects per-project overrides for both profile rules
    (``enabled`` toggled off → rule skipped) and workbook rules.
  * ``auto_replace`` NEVER mutates the paragraph text at analyze time — it
    only affects the Finding's ``severity`` (visual badge). Replacement
    still requires explicit user acceptance in the Review Page.
  * Backward compatibility: a profile rule with no ``tool_behaviour`` field
    behaves exactly as before Scope C.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import engine, hyphen_dash as hd
from app.processing.language_editing.rules import (
    Rule,
    load_rules_from_dict,
    TOOL_BEHAVIOUR_FLAG,
    TOOL_BEHAVIOUR_AUTO_REPLACE,
)


@pytest.fixture(autouse=True)
def _cold_cache():
    hd.clear_cache()
    yield
    hd.clear_cache()


# ─── Rule dataclass round-trip ─────────────────────────────────────────

def test_rule_roundtrip_preserves_tool_behaviour():
    """A rule with tool_behaviour set must survive to_dict → loader → to_dict."""
    r = Rule(id="X01", category="grammar", type="regex", pattern=" {2,}",
             replacement=" ", tool_behaviour="auto_replace")
    out = r.to_dict()
    assert out["tool_behaviour"] == "auto_replace"
    rebuilt = load_rules_from_dict([out])[0]
    assert rebuilt.tool_behaviour == "auto_replace"


def test_rule_default_tool_behaviour_resolves_to_flag():
    """Missing tool_behaviour → None → effective 'flag' per Scope-C default."""
    r = Rule(id="X02", category="grammar", type="regex")
    assert r.tool_behaviour is None
    assert r.effective_tool_behaviour() == TOOL_BEHAVIOUR_FLAG


def test_loader_rejects_garbage_tool_behaviour():
    """Unknown values must coerce to None so a typo in the JSON doesn't
    silently become AUTO_REPLACE."""
    r = load_rules_from_dict([{
        "id": "X03", "category": "grammar", "type": "regex",
        "tool_behaviour": "please_do_it",
    }])[0]
    assert r.tool_behaviour is None
    assert r.effective_tool_behaviour() == TOOL_BEHAVIOUR_FLAG


# ─── Overrides applied to workbook rules ──────────────────────────────

def test_override_disables_workbook_phrase_rule():
    """A workbook phrase-lookup rule with override enabled=False must NOT
    fire at analyze time, even though the text would otherwise match."""
    text = "The acid base balance was off."
    # No override — rule fires.
    without = hd.analyze_hyphen_dash(text, dash_profile="all")
    assert any(f.rule_id == "HY-0001" for f in without)
    # With override disabling it — no finding.
    with_override = hd.analyze_hyphen_dash(
        text, dash_profile="all",
        rule_overrides={"HY-0001": {"enabled": False}},
    )
    assert not any(f.rule_id == "HY-0001" for f in with_override)


def test_override_changes_workbook_rule_behaviour_to_flag():
    """Setting a workbook rule from AUTO_REPLACE → FLAG via override must
    change the emitted finding's severity (warning) but still produce the
    same number of findings."""
    text = "The acid base balance was off."
    default = hd.analyze_hyphen_dash(text, dash_profile="all")
    f_default = next(f for f in default if f.rule_id == "HY-0001")
    assert f_default.severity == "suggestion"  # workbook default auto_replace → suggestion

    overridden = hd.analyze_hyphen_dash(
        text, dash_profile="all",
        rule_overrides={"HY-0001": {"tool_behaviour": "flag"}},
    )
    f_override = next(f for f in overridden if f.rule_id == "HY-0001")
    assert f_override.severity == "warning"  # flag → warning


def test_override_promotes_flag_rule_to_auto_replace():
    """The reverse direction: a FLAG workbook rule promoted to
    AUTO_REPLACE still produces a reviewable finding (severity becomes
    'suggestion')."""
    # D13 ships with auto_replace, so pick an actual flag rule from the
    # workbook. HY-0003 (active assistive) is flag_and_suggest in the raw
    # workbook, which the engine normalises to 'flag'.
    text = "An active assistive device was prescribed."
    out_default = hd.analyze_hyphen_dash(text, dash_profile="all")
    f = next(x for x in out_default if x.rule_id == "HY-0003")
    assert f.severity == "warning"  # flag → warning

    out_promoted = hd.analyze_hyphen_dash(
        text, dash_profile="all",
        rule_overrides={"HY-0003": {"tool_behaviour": "auto_replace"}},
    )
    f2 = next(x for x in out_promoted if x.rule_id == "HY-0003")
    assert f2.severity == "suggestion"


# ─── Overrides on profile rules via engine.analyze ────────────────────

def test_engine_override_disables_profile_rule():
    """A profile rule with override enabled=False is skipped by the engine
    even if the Rule object says enabled=True."""
    text = "This  has  double  spaces."
    rules = load_rules_from_dict([{
        "id": "GP001", "category": "grammar", "type": "regex",
        "pattern": " {2,}", "replacement": " ", "enabled": True,
    }])
    sents = [(0, len(text), text)]
    without = engine.analyze(text, rules, dictionary={}, sents=sents)
    assert any(f.rule_id == "GP001" for f in without)
    with_override = engine.analyze(
        text, rules, dictionary={}, sents=sents,
        rule_overrides={"GP001": {"enabled": False}},
    )
    assert not any(f.rule_id == "GP001" for f in with_override)


# ─── Hard invariant: no silent text mutation ──────────────────────────

def test_auto_replace_never_mutates_text_at_analyze_time():
    """Scope-C invariant: AUTO_REPLACE is a UI preference, NOT permission
    to mutate text at analyze time. The engine must still only emit a
    Finding — the input paragraph string is returned unchanged by the
    hyphen_dash runtime, and the only concrete replacement happens later
    when the user accepts in the Review Page.

    This test checks the invariant structurally: analyze_hyphen_dash takes
    a str and returns a list[Finding] (no second value, no side effect on
    the input string). We prove this by:
      1. passing a text that would be auto-replaced,
      2. confirming the input str identity / value didn't change,
      3. confirming the Finding contains the suggestion but ``original``
         still equals the surface the text actually carries."""
    original = "The acid base balance was off."
    before_id = id(original)
    before_value = original

    findings = hd.analyze_hyphen_dash(original, dash_profile="all")

    # Input string is unchanged (Python strs are immutable, but we also
    # check that no caller swap happened).
    assert id(original) == before_id
    assert original == before_value

    # Finding is emitted with the suggestion — but the text itself is NOT
    # modified; replacement awaits the Review Page's accept action.
    f = next(x for x in findings if x.rule_id == "HY-0001")
    assert f.original == "acid base balance"
    assert f.suggestion == "acid-base balance"
    # autofixable=True means the UI shows an Accept button; it does NOT
    # mean the engine applied the change.
    assert f.autofixable is True


def test_both_flag_and_auto_replace_produce_reviewable_findings():
    """Scope-C invariant: regardless of tool_behaviour, the same input
    must produce the same NUMBER of findings. Only severity differs."""
    text = "The acid base balance was off."
    out_default = hd.analyze_hyphen_dash(text, dash_profile="all")
    out_flagged = hd.analyze_hyphen_dash(
        text, dash_profile="all",
        rule_overrides={"HY-0001": {"tool_behaviour": "flag"}},
    )
    assert len([f for f in out_default if f.rule_id == "HY-0001"]) == 1
    assert len([f for f in out_flagged if f.rule_id == "HY-0001"]) == 1


# ─── workbook_rules_surface: normalisation + override merge ────────────

def test_workbook_surface_summary_tracks_overrides():
    from app.processing.language_editing import workbook_rules_surface as ws
    ws.clear_cache()
    base = ws.hyphenation_rule_summary()
    assert base["total"] == 875
    assert base["enabled"] == 875

    # Disable 5 rules via override and promote 3 to flag.
    overrides = {
        f"HY-{i:04d}": {"enabled": False} for i in range(1, 6)
    }
    for i in range(10, 13):
        overrides[f"HY-{i:04d}"] = {"tool_behaviour": "flag"}
    s = ws.hyphenation_rule_summary(overrides)
    assert s["total"] == 875
    assert s["enabled"] == 870  # 5 disabled
    # The flag/auto_replace split must sum to enabled.
    assert s["flag"] + s["auto_replace"] == s["enabled"]
