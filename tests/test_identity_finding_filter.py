"""Regression tests for the engine-level no-op suggestion filter.

The language-editing pipeline can emit findings whose ``suggestion`` is
identical to ``original`` (workbook rows with source == replacement,
regex patterns that match without substituting, article-agreement rules
that fire on already-correct articles, …). These produce no reviewable
action and clutter the Language Editor.

``engine._drop_identity_findings`` (applied after overlap resolution
and markup filtering) suppresses them. Advisory rules
(``max_sentence_length`` / ``passive_voice``) emit identity findings on
purpose as highlights and MUST survive the filter — those findings
carry ``advisory=True``.

The comparison is ``original.strip() == suggestion.strip()``:
  * case-only diffs (``icu`` → ``ICU``) are preserved — real correction
  * whitespace-only diffs are dropped — no meaningful change
  * internal whitespace diffs ARE kept (strip only touches edges).
"""
from __future__ import annotations

from app.processing.language_editing import engine
from app.processing.language_editing.rules import Finding


def _f(rule_id: str, original: str, suggestion: str, *, advisory: bool = False) -> Finding:
    return Finding(
        rule_id=rule_id,
        category="spelling",
        start=0,
        end=len(original),
        original=original,
        suggestion=suggestion,
        message="",
        severity="warning",
        advisory=advisory,
    )


# ─── Core helper semantics ────────────────────────────────────────────

def test_is_identity_suggestion_exact_match():
    assert engine.is_identity_suggestion("color", "color") is True


def test_is_identity_suggestion_whitespace_trim():
    """Bare leading / trailing whitespace delta is a no-op."""
    assert engine.is_identity_suggestion(" color ", "color") is True
    assert engine.is_identity_suggestion("color", "color ") is True
    assert engine.is_identity_suggestion("\tword\n", "word") is True


def test_is_identity_suggestion_preserves_case_only():
    """Decision 6: case-only differences are legitimate corrections."""
    assert engine.is_identity_suggestion("icu", "ICU") is False
    assert engine.is_identity_suggestion("Covid", "COVID") is False
    assert engine.is_identity_suggestion("mrna", "mRNA") is False


def test_is_identity_suggestion_preserves_internal_whitespace():
    """strip() only touches the edges — an internal whitespace change
    is a real edit (e.g. collapsing a double space)."""
    assert engine.is_identity_suggestion("a  b", "a b") is False
    assert engine.is_identity_suggestion("foo\tbar", "foo bar") is False


# ─── _drop_identity_findings behaviour ────────────────────────────────

def test_drop_identity_findings_removes_exact_identity():
    kept = engine._drop_identity_findings([_f("X1", "treatment", "treatment")])
    assert kept == []


def test_drop_identity_findings_removes_whitespace_identity():
    kept = engine._drop_identity_findings([_f("X1", " symptoms ", "symptoms")])
    assert kept == []


def test_drop_identity_findings_keeps_case_only_diffs():
    """Case-only differences survive (decision 6)."""
    f = _f("X1", "covid", "COVID")
    kept = engine._drop_identity_findings([f])
    assert kept == [f]


def test_drop_identity_findings_keeps_real_replacement():
    f = _f("X1", "colour", "color")
    kept = engine._drop_identity_findings([f])
    assert kept == [f]


# ─── Advisory CATEGORY (term-matcher) preserves identity findings ────

def test_drop_identity_findings_keeps_term_category():
    """Term-matcher output has suggestion == matched_text by design.
    Category 'term' is in ADVISORY_CATEGORIES so identity findings in
    that category are preserved and surface to the reviewer as
    advisory highlights."""
    f = _f("term:5:42", "neoplasm", "neoplasm")
    f.category = "term"
    kept = engine._drop_identity_findings([f])
    assert kept == [f]


def test_is_advisory_finding_unified_helper():
    """Both rule-level and category-level advisories resolve through
    the same helper used by the engine filter and the GET serializer."""
    assert engine.is_advisory_finding("passive_voice", "sentence") is True
    assert engine.is_advisory_finding("max_sentence_length", "sentence") is True
    assert engine.is_advisory_finding("term:1:42", "term") is True
    assert engine.is_advisory_finding("GP005", "grammar") is False
    assert engine.is_advisory_finding("SV-00042", "spelling") is False


# ─── 1. max_sentence_length — advisory, must survive ────────────────

def test_regression_1_max_sentence_length_advisory_preserved():
    """A ``max_sentence_length`` finding has original == suggestion by
    design (it highlights a long sentence, doesn't rewrite it). The
    filter must preserve findings flagged ``advisory=True``."""
    f = _f("max_sentence_length", "A" * 40, "A" * 40, advisory=True)
    kept = engine._drop_identity_findings([f])
    assert kept == [f], "advisory max_sentence_length finding was stripped"


# ─── 2. passive_voice — advisory, must survive ──────────────────────

def test_regression_2_passive_voice_advisory_preserved():
    """``passive_voice`` is the second advisory rule; same contract."""
    f = _f("passive_voice", "was taken", "was taken", advisory=True)
    kept = engine._drop_identity_findings([f])
    assert kept == [f]


# ─── 3. hyphen_dash Detect_List row with source == suggestion ───────

def test_regression_3_hyphen_dash_identity_dropped():
    """A pathological Detect_List row where surface and suggestion are
    equal must not surface to the reviewer. Test uses the helper
    directly with a synthetic finding tagged as hyphenation so we don't
    depend on the workbook shipping a bad row."""
    f = _f("HY-9999", "sub-cutaneous", "sub-cutaneous")
    f.category = "hyphenation"
    kept = engine._drop_identity_findings([f])
    assert kept == []


# ─── 4. medical_terms Detect_List row with source == suggestion ─────

def test_regression_4_medical_terms_identity_dropped():
    f = _f("MT-9999", "myocardial infarction", "myocardial infarction")
    f.category = "medical_terms"
    kept = engine._drop_identity_findings([f])
    assert kept == []


# ─── 5. lww_ne row with replacement == source_term ──────────────────

def test_regression_5_lww_ne_identity_dropped():
    f = _f("LWW-NE-ambiguous", "patient", "patient")
    f.category = "bias"
    kept = engine._drop_identity_findings([f])
    assert kept == []


# ─── 6. abbreviations AB10 on already-correct article ───────────────

def test_regression_6_ab10_correct_article_dropped():
    """AB10 article-agreement regex can match an article that's already
    correct. The identity filter catches that case."""
    f = _f("AB10", "an MRI", "an MRI")
    f.category = "abbreviations"
    kept = engine._drop_identity_findings([f])
    assert kept == []


# ─── 7. uk_us_spelling with variant resolving to same spelling ──────

def test_regression_7_uk_us_identity_dropped():
    f = _f("SV-00042", "data", "data")
    f.category = "spelling"
    kept = engine._drop_identity_findings([f])
    assert kept == []


# ─── 8. Engine integration: no identity row leaves analyze() ────────

def test_regression_8_engine_analyze_emits_no_identity():
    """End-to-end: engine.analyze() on plain text runs every analyzer
    (rules, sentence_checks, workbook modules). No finding returned has
    an identity suggestion unless it's advisory."""
    from app.processing.language_editing.rules import load_rules_from_dict

    rules = load_rules_from_dict([{
        "id": "TESTID",
        "category": "spelling",
        "type": "regex",
        "pattern": r"\bfoo\b",
        "replacement": "foo",  # intentional identity — engine filter catches it
        "message": "no-op for test",
        "severity": "suggestion",
    }])
    text = "The foo jumped."
    sents = [(0, len(text), text)]
    out = engine.analyze(text, rules=rules, dictionary={}, sents=sents)
    identity = [f for f in out if not f.advisory and f.original.strip() == f.suggestion.strip()]
    assert identity == [], f"engine returned identity findings: {identity}"


# ─── 9. Advisory flag survives engine.analyze() round-trip ──────────

def test_regression_9_advisory_findings_survive_engine_pipeline():
    """Max-sentence-length advisory finding must reach the caller even
    though its original == suggestion. Covers the end-to-end contract
    for the frontend's Sentence chip."""
    from app.processing.language_editing.rules import load_rules_from_dict

    rules = load_rules_from_dict([{
        "id": "max_sentence_length",
        "category": "sentence",
        "type": "function",
        "function": "max_sentence_length",
        "params": {"limit": 5},
        "message": "long",
        "severity": "suggestion",
    }])
    long_sent = "one two three four five six seven eight nine ten"
    sents = [(0, len(long_sent), long_sent)]
    out = engine.analyze(long_sent, rules=rules, dictionary={}, sents=sents)
    adv = [f for f in out if f.rule_id == "max_sentence_length"]
    assert adv, "advisory max_sentence_length finding was stripped"
    assert adv[0].advisory is True
    assert adv[0].original == adv[0].suggestion
