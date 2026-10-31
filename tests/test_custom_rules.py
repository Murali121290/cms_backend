"""Scope D tests — user-authored regex rules (``custom_rules``).

Covers the validator, the end-to-end sidecar round-trip through the
service, and the integration-time contract: a saved custom rule fires
through ``engine.analyze`` alongside profile rules and respects the
project's ``rule_overrides`` map by id.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import engine
from app.processing.language_editing.rules import load_rules_from_dict
from app.services.language_rule_service import (
    _validate_custom_rule,
    _validate_custom_rules,
)


# ─── Validator unit tests ─────────────────────────────────────────────

def test_validator_accepts_minimal_rule():
    r = _validate_custom_rule({"pattern": r"\bfoo\b", "message": "flag foo"})
    assert r["type"] == "regex"
    assert r["id"].startswith("CUST-")
    assert r["enabled"] is True
    assert r["tool_behaviour"] == "flag"
    assert r["flags"] == []


def test_validator_accepts_replacement_and_flags():
    r = _validate_custom_rule({
        "pattern": r"(colour)",
        "replacement": "color",
        "flags": ["IGNORECASE"],
        "category": "spelling",
        "severity": "suggestion",
    })
    assert r["replacement"] == "color"
    assert "IGNORECASE" in r["flags"]
    assert r["category"] == "spelling"


def test_validator_rejects_invalid_regex():
    with pytest.raises(ValueError, match="Invalid regex"):
        _validate_custom_rule({"pattern": "(unclosed"})


def test_validator_rejects_unknown_category():
    with pytest.raises(ValueError, match="Unknown category"):
        _validate_custom_rule({"pattern": "x", "category": "nope"})


def test_validator_rejects_unknown_flag():
    with pytest.raises(ValueError, match="Unsupported flag"):
        _validate_custom_rule({"pattern": "x", "flags": ["WHATEVER"]})


def test_validator_rejects_bad_backreference():
    # \99 references a group that doesn't exist; re.sub blows up at
    # analyze time, so we catch it at save time.
    with pytest.raises(ValueError, match="Invalid replacement"):
        _validate_custom_rule({"pattern": r"x", "replacement": r"\99"})


def test_validator_rejects_pattern_over_limit():
    with pytest.raises(ValueError, match="Pattern too long"):
        _validate_custom_rule({"pattern": "a" * 600})


def test_validator_prefixes_custom_ids():
    # User-supplied raw id gets prefixed so it can't collide with
    # profile / workbook rule ids.
    r = _validate_custom_rule({"pattern": "x", "id": "my-rule"})
    assert r["id"] == "CUST-my-rule"


def test_validator_resolves_duplicate_ids():
    out = _validate_custom_rules([
        {"pattern": "a", "id": "dup", "message": "A"},
        {"pattern": "b", "id": "dup", "message": "B"},
    ])
    assert out[0]["id"] != out[1]["id"]


def test_validator_none_and_empty():
    assert _validate_custom_rules(None) == []
    assert _validate_custom_rules([]) == []


def test_validator_rejects_non_list():
    with pytest.raises(ValueError, match="must be a list"):
        _validate_custom_rules({"not": "a list"})


# ─── Engine integration tests ─────────────────────────────────────────

def _run(text: str, custom_rules: list[dict], **kwargs) -> list:
    rules = load_rules_from_dict(custom_rules)
    sents = [(0, len(text), text)]
    return engine.analyze(text, rules, {}, sents, **kwargs)


def test_custom_rule_fires_through_engine():
    findings = _run("I like color and/or coffee.", [
        {"id": "CUST-and-or", "category": "custom", "type": "regex",
         "pattern": r"\band/or\b", "replacement": "and or",
         "message": "avoid and/or", "enabled": True, "flags": [],
         "tool_behaviour": "flag"},
    ])
    hits = [f for f in findings if f.rule_id == "CUST-and-or"]
    assert hits, findings
    assert hits[0].original == "and/or"
    assert hits[0].suggestion == "and or"


def test_custom_rule_respects_rule_overrides():
    custom = [{
        "id": "CUST-off", "category": "custom", "type": "regex",
        "pattern": r"\bfoo\b", "replacement": "bar",
        "message": "x", "enabled": True, "flags": [],
    }]
    on = _run("foo", custom)
    off = _run("foo", custom, rule_overrides={"CUST-off": {"enabled": False}})
    assert any(f.rule_id == "CUST-off" for f in on)
    assert not any(f.rule_id == "CUST-off" for f in off)


def test_custom_rule_profile_and_custom_coexist():
    """A profile rule and a custom rule in the same analyze pass each fire
    independently — a known-regression guard against accidental deduping
    of the two sources."""
    rules = load_rules_from_dict([
        {"id": "PR01", "category": "spelling", "type": "regex",
         "pattern": r"\bcolor\b", "replacement": "colour",
         "message": "UK: colour", "enabled": True},
        {"id": "CUST-and-or", "category": "custom", "type": "regex",
         "pattern": r"\band/or\b", "replacement": "and or",
         "message": "avoid and/or", "enabled": True, "flags": [],
         "tool_behaviour": "flag"},
    ])
    text = "I like color and/or coffee."
    findings = engine.analyze(text, rules, {}, [(0, len(text), text)])
    ids = {f.rule_id for f in findings}
    assert "PR01" in ids
    assert "CUST-and-or" in ids
