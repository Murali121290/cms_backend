"""Phase 2 smoke tests for the hyphen & en-dash workbook runtime.

These are a targeted subset — the full 154-row regression harness lives
in Phase 4. Each test asserts one specific semantic the workbook promises:

  * phrase lookup fires on `Missing hyphen` rows
  * context filter (`require_following_word`) suppresses predicative uses
  * protected literals (COVID-19) short-circuit before a finding exists
  * protected regex patterns (DOI) protect inner tokens
  * MC_COMPOUNDS subtraction: workbook-covered bases don't double-fire
  * dash profile selection routes to profile-specific rules
  * offsets stay in the original paragraph (no in-place normalisation)
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import hyphen_dash as hd
from app.processing.language_editing import engine
from app.processing.language_editing.rules import load_rules_from_dict


@pytest.fixture(autouse=True)
def _cold_cache():
    """Each test starts from a clean compile cache so test ordering doesn't
    leak compiled state from one to the next (workbook JSON doesn't change
    between tests but the cache behaviour is worth exercising)."""
    hd.clear_cache()
    yield
    hd.clear_cache()


# ---- phrase lookup ------------------------------------------------------

def test_phrase_lookup_fires_on_missing_hyphen():
    """`acid base balance` is HY-0001 Missing hyphen (auto_replace, All profile)."""
    out = hd.analyze_hyphen_dash(
        "The acid base balance was off.", dash_profile="all",
    )
    hits = [(f.rule_id, f.original, f.suggestion) for f in out]
    assert any(rid == "HY-0001"
               and orig.lower() == "acid base balance"
               and sug == "acid-base balance"
               for rid, orig, sug in hits), hits


def test_phrase_lookup_preserves_case():
    """Workbook sources are lowercase; the finder must preserve the source
    paragraph's capitalisation on the replacement."""
    out = hd.analyze_hyphen_dash(
        "Acid base balance is a key measurement.", dash_profile="all",
    )
    f = next(x for x in out if x.rule_id == "HY-0001")
    assert f.suggestion[:1].isupper(), f.suggestion
    assert f.suggestion.lower() == "acid-base balance"


# ---- context filters ---------------------------------------------------

def test_require_following_word_suppresses_predicative_use():
    """`age related` with `require_following_word=True`: `is age related` (no
    following noun) must NOT fire; `age related complication` must fire."""
    out_pred = hd.analyze_hyphen_dash(
        "The complication is age related.", dash_profile="all",
    )
    assert not [f for f in out_pred if f.rule_id == "HY-0007"], out_pred

    out_prenom = hd.analyze_hyphen_dash(
        "The age related complication was observed.", dash_profile="all",
    )
    assert any(f.rule_id == "HY-0007" for f in out_prenom), out_prenom


def test_skip_prev_regex_suppresses_after_copula():
    """`skip_prev_regex` on HY-0007 lists `is|are|was|were|be|been|being…`;
    when the phrase follows one of those linking verbs it should NOT flag."""
    out = hd.analyze_hyphen_dash(
        "Her symptoms were age related in nature.", dash_profile="all",
    )
    assert not [f for f in out if f.rule_id == "HY-0007"], out


# ---- protected literals + regex ---------------------------------------

def test_protected_literal_short_circuits_phrase_lookup():
    """COVID-19 is PR-001 (literal). A paragraph mentioning it alongside
    an otherwise-flaggable term must still fire the term — but the COVID-19
    span itself must never be touched."""
    out = hd.analyze_hyphen_dash(
        "The age related effects of COVID-19 are documented.",
        dash_profile="all",
    )
    rule_ids = [f.rule_id for f in out]
    # age related → HY-0007 still fires (require_following_word 'effects')
    assert "HY-0007" in rule_ids
    # No finding touches the COVID-19 span
    for f in out:
        assert "COVID-19".lower() not in f.original.lower(), f


def test_protected_regex_doi_not_touched():
    """DOI pattern PR-019 covers 10.NNN/… — the hyphens inside a DOI must
    never be re-cast as dashes by any rule."""
    out = hd.analyze_hyphen_dash(
        "Reference 10.1234/abc-def is the source.", dash_profile="all",
    )
    for f in out:
        assert "10.1234" not in f.original, f


def test_build_protected_spans_merges_overlaps():
    """Two patterns matching the same text region should return a merged span."""
    spans = hd.build_protected_spans(
        "Contact a@b.co or see 10.1234/x — email too", dash_profile="all",
    )
    # spans are sorted and non-overlapping after merge
    for i in range(1, len(spans)):
        assert spans[i - 1][1] <= spans[i][0], spans


# ---- en-dash profile routing ------------------------------------------

def test_en_dash_profile_routes_correctly():
    """`doctor-patient` is an EN-dash under Chicago-AMA-APA but not under
    the ``all`` profile (where MW is the fallback and accepts the hyphen).

    Under ``all``: no en-dash finding fires on the hyphen form.
    Under ``chicago_ama_apa``: an en-dash finding fires suggesting the dash."""
    text = "The doctor-patient relationship is key."

    out_all = hd.analyze_hyphen_dash(text, dash_profile="all")
    assert not any(f.rule_id.startswith("EN-") for f in out_all), out_all

    out_chi = hd.analyze_hyphen_dash(text, dash_profile="chicago_ama_apa")
    assert any(f.rule_id.startswith("EN-") for f in out_chi), out_chi


# ---- MC_COMPOUNDS subtraction -----------------------------------------

def test_mc_compounds_skips_workbook_covered_bases():
    """`health-care → health care` was previously emitted by MC_COMPOUNDS.
    After subtraction, the workbook covers that pair; MC_COMPOUNDS must
    skip it. A base NOT in the workbook (e.g. `end-point`) still fires."""
    text = "The health-care system treats the end-point."
    out = engine.run_manuscript_core_rules(text)
    # health_care subtracted
    assert not any(f.rule_id == "compound_health_care" for f in out), out
    # end point stays (unique to MC_COMPOUNDS)
    assert any(f.rule_id == "compound_end_point" for f in out), out


# ---- offsets preserved ------------------------------------------------

def test_offsets_index_original_paragraph():
    """No in-place normalisation: finding.start/end must slice the original
    text to the matched surface, byte-for-byte."""
    text = "Phase 1 acid base balance was abnormal."
    out = hd.analyze_hyphen_dash(text, dash_profile="all")
    f = next(x for x in out if x.rule_id == "HY-0001")
    assert text[f.start:f.end] == f.original
    assert f.original == "acid base balance"


def test_hyphen_class_recognises_variant_chars():
    """Dash rules use explicit char classes for U+2010/U+2011. A soft
    hyphen (U+00AD) inside text is rule C01 and should be stripped."""
    # U+00AD soft hyphen embedded between letters
    text = "Hello­world, I am here."
    out = hd.analyze_hyphen_dash(text, dash_profile="all")
    assert any(f.rule_id == "C01" for f in out), out


# ---- engine integration ----------------------------------------------

def test_engine_analyze_filters_protected_before_overlap_resolution():
    """A hypothetical typo finding on a protected shape must be dropped
    by the engine, not surfaced to the user."""
    rules = []  # no user rules — hyphen_dash runs anyway
    text = "The post-COVID-19 recovery."
    out = engine.analyze(
        text, rules, dictionary={}, sents=[(0, len(text), text)],
        dash_profile="all",
    )
    for f in out:
        assert "COVID-19" not in f.original, f


def test_engine_runs_hyphen_dash_by_default():
    """analyze() has backward-compatible defaults; even without passing
    dash_profile it should still exercise the workbook via the ``all`` default."""
    rules = []
    text = "The acid base balance was fine."
    out = engine.analyze(text, rules, dictionary={}, sents=[(0, len(text), text)])
    assert any(f.rule_id == "HY-0001" for f in out), out
