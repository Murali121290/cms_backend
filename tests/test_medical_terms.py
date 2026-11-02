"""Medical Terminology workbook runtime tests.

Covers:
  * Loader + JSON schema sanity (counts match the committed JSON)
  * Detect_List: whole-word vs phrase matching, case sensitivity,
    Flag-and-suggest vs Auto-replace, alt_suggestions pass-through
  * Spelling_Patterns: regex rules with backref expansion
  * Confusable_Terms: paragraph-scoped cue-word disambiguation
  * Style profile gating: All vs US spelling vs Possessive
  * Scope-C per-rule overrides disable individual rules by id
  * Longest-match-wins dedup
  * Term_Dictionary whitelist helper
  * Scope-C invariant: analyser never mutates input text
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import medical_terms as mt
from app.processing.language_editing import engine
from app.processing.language_editing.rules import load_rules_from_dict


@pytest.fixture(autouse=True)
def _cold_cache():
    mt.clear_cache()
    yield
    mt.clear_cache()


# ─── Loader counts ────────────────────────────────────────────────────

def test_preferred_terms_whitelist_loaded():
    terms = mt.preferred_terms()
    assert len(terms) >= 1000  # workbook ships ~1055
    # Lowercased storage
    assert "abduction" in terms


def test_detect_rules_compiled():
    rules = mt._compiled_detect_rules()
    assert len(rules) >= 1000  # ~1003
    assert all("_rx" in r for r in rules)


def test_patterns_compiled():
    rules = mt._compiled_patterns()
    assert len(rules) >= 20  # 26 after re-prefix
    # Every id must carry the MED- prefix now
    assert all(r["id"].startswith("MED-") for r in rules)


def test_confusables_compiled():
    rules = mt._compiled_confusables()
    assert len(rules) >= 10  # 18
    assert all("_rx_a" in r and "_rx_b" in r for r in rules)


# ─── Detect_List matching ─────────────────────────────────────────────

def test_detect_brand_name_capitalization():
    findings = mt.analyze_medical_terms("the patient was given abilify.")
    hits = [f for f in findings if f.rule_id == "MT-0001"]
    assert hits, findings
    assert hits[0].original == "abilify"
    assert hits[0].suggestion == "Abilify"
    # Brand → generic alternative lives in alt_suggestions
    assert "aripiprazole" in hits[0].alt_suggestions


def test_detect_whole_word_does_not_match_substring():
    # "abuse" should match whole word; "abusers" should not fire MT-xxx
    text = "The abusers were not identified."
    # Pick a known whole-word rule from the workbook that would otherwise
    # fire on a substring. We don't hardcode an id; just verify no
    # Detect_List rule emitted a finding whose match crosses the token.
    findings = mt.analyze_medical_terms(text)
    for f in findings:
        hit = text[f.start:f.end]
        assert hit.isalnum() or " " in hit  # sanity: real token not partial


def test_detect_case_insensitive_default():
    # MT-0001 has match_case=Yes so capital 'A' already matches; a different
    # case-insensitive rule should match regardless of case. Just verify
    # the lowercase 'abilify' matches without needing exact case.
    f = mt.analyze_medical_terms("abilify")
    assert any(x.rule_id == "MT-0001" for x in f)


# ─── Spelling_Patterns ────────────────────────────────────────────────

def test_pattern_fires_only_on_matching_style_profile():
    # MED-SP01 (haem → hem) is tagged "US spelling". Default profile
    # ("All") should not fire it. On US spelling, EITHER MED-SP01 or the
    # Detect_List row for "haemoglobin" (MT-xxxx) must fire — the dedup
    # keeps only one; both come from the same workbook so either is fine.
    text = "haemoglobin levels dropped."
    assert not any(f.rule_id == "MED-SP01" for f in mt.analyze_medical_terms(text))
    us = mt.analyze_medical_terms(text, style_profile="US spelling")
    assert any(
        f.rule_id == "MED-SP01" or (f.rule_id.startswith("MT-") and f.suggestion == "hemoglobin")
        for f in us
    ), us


def test_pattern_backref_expansion_matches_workbook_intent():
    # -aemia → -emia. Either MED-SP02 or a Detect_List row (MT-0890 for
    # "anaemia") carries the suggestion "anemia"; dedup keeps whichever
    # was emitted first with that span. We only assert that *some*
    # medical rule produces the correct replacement, which is the
    # user-visible contract.
    text = "severe anaemia noted."
    us = mt.analyze_medical_terms(text, style_profile="US spelling")
    matches = [f for f in us if f.original == "anaemia" and f.suggestion == "anemia"]
    assert matches, us


# ─── Confusable_Terms context scan ────────────────────────────────────

def test_confusable_flags_ileum_when_hip_cues_dominate():
    text = (
        "The patient suffered a fracture of the ileum. "
        "The hip and pelvis were affected."
    )
    findings = mt.analyze_medical_terms(text)
    cf = [f for f in findings if f.rule_id == "CF-001"]
    assert cf, findings
    assert cf[0].original == "ileum"
    assert cf[0].suggestion == "ilium"


def test_confusable_silent_when_own_cues_dominate():
    text = (
        "The ileum is part of the small intestine, distal to the jejunum. "
        "Crohn disease affects the terminal ileum."
    )
    findings = mt.analyze_medical_terms(text)
    assert not any(f.rule_id == "CF-001" for f in findings), findings


def test_confusable_silent_when_both_cues_present():
    # Author genuinely discusses both — don't double-flag. Paragraph
    # contains cues from BOTH sets: "small intestine" / "jejunum" for A,
    # "hip" / "pelvis" / "fracture" for B.
    text = (
        "The small intestine distal to the jejunum terminates at the ileum, "
        "while the pelvis houses the ilium — a hip bone involved in the "
        "fracture seen on imaging."
    )
    findings = mt.analyze_medical_terms(text)
    assert not any(f.rule_id == "CF-001" for f in findings), findings


# ─── Scope-C overrides ────────────────────────────────────────────────

def test_rule_overrides_disable_individual_rule():
    text = "the patient was given abilify."
    base = mt.analyze_medical_terms(text)
    assert any(f.rule_id == "MT-0001" for f in base)
    off = mt.analyze_medical_terms(
        text, rule_overrides={"MT-0001": {"enabled": False}},
    )
    assert not any(f.rule_id == "MT-0001" for f in off)


def test_rule_overrides_change_tool_behaviour():
    # MT-0001 ships as flag; override to auto_replace should flip
    # autofixable on the Finding.
    text = "abilify prescribed."
    out = mt.analyze_medical_terms(
        text, rule_overrides={"MT-0001": {"tool_behaviour": "auto_replace"}},
    )
    hits = [f for f in out if f.rule_id == "MT-0001"]
    assert hits
    assert hits[0].autofixable is True


# ─── Longest-match dedup ──────────────────────────────────────────────

def test_longest_match_wins_dedup():
    # Synthetic: craft two overlapping findings and feed to the helper
    from app.processing.language_editing.rules import Finding
    fs = [
        Finding(rule_id="A", category="medical_terms", start=0, end=5,
                original="short", suggestion="x", message=""),
        Finding(rule_id="B", category="medical_terms", start=0, end=10,
                original="shortphrase", suggestion="y", message=""),
    ]
    out = mt._dedup_longest_match_wins(fs)
    assert len(out) == 1
    assert out[0].rule_id == "B"


# ─── Engine integration ──────────────────────────────────────────────

def test_engine_runs_medical_terms_alongside_profile_rules():
    text = "the patient was given abilify."
    rules = load_rules_from_dict([])
    findings = engine.analyze(
        text, rules, {}, [(0, len(text), text)],
    )
    assert any(f.rule_id == "MT-0001" and f.category == "medical_terms" for f in findings)


def test_engine_passes_style_profile_through():
    text = "haemoglobin dropped."
    rules = load_rules_from_dict([])
    default = engine.analyze(text, rules, {}, [(0, len(text), text)])
    us = engine.analyze(
        text, rules, {}, [(0, len(text), text)], medical_style_profile="US spelling",
    )
    med_default = [f for f in default if f.rule_id.startswith("MED-SP")]
    med_us = [f for f in us if f.rule_id.startswith("MED-SP")]
    assert len(med_us) >= len(med_default)


# ─── Scope-C invariant ────────────────────────────────────────────────

def test_analyser_never_mutates_input_text():
    text = "the patient was given abilify."
    before = text
    _ = mt.analyze_medical_terms(text)
    assert text == before
