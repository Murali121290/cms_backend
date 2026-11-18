"""Regression tests for the Basic Grammar workbook surface (used by
the Rules Picker page).

Verifies the wire shape, per-rule runtime classification, override
merging, counts by sheet, and the reuse / ship-disabled / manual-review
taxonomy that the frontend relies on.
"""
from __future__ import annotations

from collections import Counter

import pytest

from app.processing.language_editing import workbook_rules_surface as ws


@pytest.fixture(autouse=True)
def _cold_cache():
    ws.clear_cache()
    yield
    ws.clear_cache()


# ─── Surface shape ────────────────────────────────────────────────

def test_surface_returns_all_420_workbook_rules():
    rules = ws.list_basic_grammar_rules()
    assert len(rules) == 420


def test_every_rule_carries_required_wire_fields():
    rules = ws.list_basic_grammar_rules()
    required = {
        "id", "category", "subcategory", "type", "enabled", "tool_behaviour",
        "severity", "message", "rule_name", "rule_description",
        "worksheet", "source_of", "source_badge",
        "runtime_status", "runtime_status_reason",
        "detection_method", "detection_pattern",
        "trigger_condition", "exception_conditions",
        "suggested_correction", "replacement",
        "confidence_level", "style_dependency", "validation_status",
        "recommended_action", "false_positive_risks",
        "implementation_status",
    }
    for r in rules[:30]:
        missing = required - set(r.keys())
        assert not missing, f"rule {r['id']} missing {missing}"
    # source_of + source_badge are constant for workbook rules.
    assert all(r["source_of"] == "workbook" for r in rules)
    assert all(r["source_badge"] == "Basic Grammar" for r in rules)


# ─── Per-sheet counts ─────────────────────────────────────────────

def test_rule_counts_per_sheet_match_the_workbook():
    """The spec requires 96 / 21 / 28 / 42 / 102 / 115 / 16 rules.
    Any drift means the import script was re-run against a modified
    workbook."""
    counts = Counter(r["worksheet"] for r in ws.list_basic_grammar_rules())
    assert counts == {
        "Grammar_Rules": 96,
        "Article_Usage": 21,
        "Subject_Verb_Agreement": 28,
        "Punctuation_Capitalization": 42,
        "Common_Misuse": 102,
        "Word_Phrase_Choice": 115,
        "Sentence_Structure": 16,
    }


def test_subcategory_labels_per_sheet():
    """Each sheet maps to its documented sub-section label; the Rules
    Picker uses this label for the group header."""
    rules = ws.list_basic_grammar_rules()
    expected = {
        "Grammar_Rules": "Basic Grammar",
        "Article_Usage": "Article Usage",
        "Subject_Verb_Agreement": "Subject-Verb Agreement",
        "Punctuation_Capitalization": "Punctuation and Capitalization",
        "Common_Misuse": "Common Misuse",
        "Word_Phrase_Choice": "Word/Phrase Choice",
        "Sentence_Structure": "Sentence Structure",
    }
    for r in rules:
        assert r["subcategory"] == expected[r["worksheet"]]


def test_grammar_sheets_route_to_grammar_category():
    """Six of the seven sheets live under the Grammar sidebar chip;
    Punctuation_Capitalization lives under the Sentence (Punctuation
    and Capitalization) chip. Sidebar grouping unchanged."""
    rules = ws.list_basic_grammar_rules()
    for r in rules:
        if r["worksheet"] == "Punctuation_Capitalization":
            assert r["category"] == "sentence"
        else:
            assert r["category"] == "grammar"


# ─── Runtime status taxonomy ─────────────────────────────────────

def test_reused_rules_marked_reused_and_point_to_engine_rule():
    rules = {r["id"]: r for r in ws.list_basic_grammar_rules()}
    REUSE_MAP = {
        "GK-004": "SL001",
        "AR-001": "GP006",
        "PU-007": "GP005",
        "CA-001": "SL003",
    }
    for rid, engine_rid in REUSE_MAP.items():
        r = rules[rid]
        assert r["runtime_status"] == "reused", f"{rid} not marked reused"
        assert r["reused_by"] == engine_rid
        assert r["enabled"] is False, (
            f"{rid} must be shown as disabled on the Rules Picker "
            "(reused rules do not execute through the workbook)"
        )


def test_ship_disabled_rules_carry_a_reason():
    rules = {r["id"]: r for r in ws.list_basic_grammar_rules()}
    for rid in ("PU-011", "CA-011", "GK-001"):
        r = rules[rid]
        assert r["runtime_status"] == "disabled"
        assert r["runtime_status_reason"], f"{rid} missing disabled reason"
        assert r["enabled"] is False


def test_manual_review_rules_marked_manual_review():
    rules = [r for r in ws.list_basic_grammar_rules() if r["runtime_status"] == "manual_review"]
    assert len(rules) == 12, f"Expected 12 manual-review rules, got {len(rules)}"
    for r in rules:
        assert r["enabled"] is False
        assert "Manual" in r["runtime_status_reason"]


def test_house_style_rules_gated_off_by_default():
    """19 rules have ``style_dependency='House style'`` in the workbook.
    The classifier gates House-style rules off UNLESS a stronger block
    applies first (MANUAL_REVIEW, REQUIRES_*, ship_disabled, reused).
    For a House-style row that IS a READY_* implementation (no other
    blocker), the runtime_status reason must mention House-style. For
    rows that happen to also be REQUIRES_CONTEXT or similar, the
    stronger block wins — the rule still ends up disabled, just for a
    different reason."""
    rules = ws.list_basic_grammar_rules()
    house = [r for r in rules
             if "house style" in (r.get("style_dependency") or "").lower()]
    assert len(house) >= 10, "Expected at least 10 House-style rules"
    # Every House-style rule must be disabled.
    for r in house:
        assert r["runtime_status"] != "enabled", (
            f"{r['id']} House-style wrongly enabled by default"
        )
    # At least one House-style rule has no stronger blocker → should
    # carry the House-style reason text.
    REUSED = {"GK-004", "AR-001", "PU-007", "CA-001"}
    SHIP_DISABLED = {"GK-001", "PU-011", "CA-011"}
    house_only = [
        r for r in house
        if r["id"] not in SHIP_DISABLED and r["id"] not in REUSED
        and r.get("implementation_status") in ("READY_REGEX", "READY_RULE_BASED")
    ]
    assert house_only, "Expected a House-style rule with no stronger blocker"
    for r in house_only:
        assert "House-style" in r["runtime_status_reason"], (
            f"{r['id']} should carry the House-style reason, got {r['runtime_status_reason']!r}"
        )


def test_us_only_rules_marked_enabled_unless_also_blocked():
    """``style_dependency='US only'`` by itself should NOT disable a
    rule on the Rules Picker — the engine's style gate applies at
    analyze time based on document_variant. But a US-only rule that is
    ALSO MANUAL_REVIEW / REQUIRES_* retains the stronger block (the
    engine still can't run it even on a US document)."""
    rules = [r for r in ws.list_basic_grammar_rules()
             if (r.get("style_dependency") or "").lower().startswith("us only")]
    assert rules, "Expected at least one US-only rule"
    # Rules that are US-only AND READY_* should be enabled.
    us_ready = [r for r in rules
                if r.get("implementation_status") in ("READY_REGEX", "READY_RULE_BASED")]
    assert us_ready, "Expected at least one US-only READY_* rule"
    for r in us_ready:
        assert r["runtime_status"] == "enabled", (
            f"{r['id']} US-only READY_* rule wrongly classified as {r['runtime_status']}"
        )


# ─── Overrides merge ──────────────────────────────────────────────

def test_project_override_toggles_rule_enabled_state():
    """Scope-C overrides apply on top of the surface and update the
    ``enabled`` flag + ``is_overridden`` badge."""
    overrides = {"GV-001": {"enabled": False}}
    rules = {r["id"]: r for r in ws.list_basic_grammar_rules(overrides)}
    assert rules["GV-001"]["enabled"] is False
    assert rules["GV-001"]["is_overridden"] is True
    # Other rules untouched.
    assert rules["GV-002"].get("is_overridden") is not True


def test_override_can_force_enable_a_normally_disabled_rule():
    """A project opting into a House-style rule flips the enabled
    flag — the Rules Picker's enable toggle must work on these rules
    even though they default off."""
    # GK-003 serial-comma consistency: style_dependency="House style".
    overrides = {"GK-003": {"enabled": True}}
    rules = {r["id"]: r for r in ws.list_basic_grammar_rules(overrides)}
    assert rules["GK-003"]["enabled"] is True
    assert rules["GK-003"]["is_overridden"] is True


# ─── Summary counts ───────────────────────────────────────────────

def test_summary_counts_add_up_to_420():
    s = ws.basic_grammar_rule_summary()
    assert s["total"] == 420
    # enabled + reused + disabled + manual_review == total
    assert (
        s["enabled"] + s["reused"] + s["disabled"] + s["manual_review"]
    ) == s["total"]


def test_summary_enabled_count_matches_runtime_truth():
    """The ``enabled`` summary number must equal the count of rules
    whose runtime_status is 'enabled' AND whose per-project override
    (if any) didn't disable them. With no overrides, this is 324."""
    s = ws.basic_grammar_rule_summary()
    rules = ws.list_basic_grammar_rules()
    direct = sum(1 for r in rules if r["runtime_status"] == "enabled" and r["enabled"])
    assert s["enabled"] == direct


def test_summary_no_auto_replace_rules_by_default():
    """Spec: no workbook rule ships as AUTO_FIX at runtime. Even the
    7 ``autocorrect_safe=Y`` rules stay as flag (validation_status is
    needs_review on every row)."""
    s = ws.basic_grammar_rule_summary()
    assert s["auto_replace"] == 0
    assert s["flag"] == s["enabled"]


# ─── No executable-duplicate with reused rules ───────────────────

def test_reused_rules_do_not_leak_into_executable_set():
    """basic_grammar._compiled_rules (the actual runtime set) must
    never contain a rule_id that the surface marks as reused. A leak
    would produce duplicate findings on the same span."""
    from app.processing.language_editing import basic_grammar as bg
    executable_ids = {r["rule_id"] for r in bg._compiled_rules()}
    surface = {r["id"]: r for r in ws.list_basic_grammar_rules()}
    for rid in ("GK-004", "AR-001", "PU-007", "CA-001"):
        assert rid in surface, f"reused rule {rid} missing from surface"
        assert surface[rid]["runtime_status"] == "reused"
        assert rid not in executable_ids, (
            f"reused rule {rid} wrongly present in executor — would double-fire"
        )


def test_ship_disabled_rules_do_not_leak_into_executable_set():
    from app.processing.language_editing import basic_grammar as bg
    executable_ids = {r["rule_id"] for r in bg._compiled_rules()}
    for rid in ("PU-011", "CA-011", "GK-001"):
        assert rid not in executable_ids
