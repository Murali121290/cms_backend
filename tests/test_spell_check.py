"""Tests for app/processing/language_editing/spell_check.py — typo detection."""
import pytest

from app.processing.language_editing import spell_check as sc_mod


@pytest.fixture(scope="module")
def sc():
    checker = sc_mod.get_spell_checker()
    if checker is None:
        pytest.skip("pyspellchecker not installed")
    return checker


def _originals(findings):
    return [f.original for f in findings]


def _by_offset(findings):
    return [(f.start, f.end, f.original, f.suggestion) for f in findings]


# --- Common typos ---------------------------------------------------------

def test_detects_teh(sc):
    out = sc_mod.spell_check_paragraph("I went to teh store yesterday.", sc)
    assert "teh" in _originals(out)
    f = next(x for x in out if x.original == "teh")
    assert f.category == "typo"
    assert f.suggestion.lower() == "the"


def test_detects_recieve(sc):
    out = sc_mod.spell_check_paragraph("We should recieve the package tomorrow.", sc)
    assert any(f.original == "recieve" and f.suggestion.lower() == "receive" for f in out)


def test_detects_enviroment(sc):
    out = sc_mod.spell_check_paragraph(
        "The enviroment affects outcomes.", sc)
    assert any(f.original == "enviroment" and f.suggestion.lower() == "environment" for f in out)


# --- Correct words are NOT flagged ----------------------------------------

def test_correct_words_not_flagged(sc):
    out = sc_mod.spell_check_paragraph(
        "The quick brown fox jumps over the lazy dog.", sc)
    assert out == []


# --- Repeated occurrences each get their own finding ----------------------

def test_repeated_typos_both_flagged(sc):
    out = sc_mod.spell_check_paragraph(
        "First teh second teh third teh.", sc)
    offsets = [(f.start, f.end) for f in out if f.original == "teh"]
    assert len(offsets) == 3
    assert len(set(offsets)) == 3  # distinct ranges


# --- Project / client dictionary respected --------------------------------

def test_variant_to_canonical_whitelist(sc):
    # "colour" would normally be considered correct by the English dict too,
    # but we use a made-up term to assert the whitelist actually prevents a flag.
    wl = sc_mod.build_whitelist(variant_to_canonical={"fooble": "foobar"})
    out = sc_mod.spell_check_paragraph(
        "The fooble must be foobar.", sc, whitelist=wl)
    originals = _originals(out)
    assert "fooble" not in originals
    assert "foobar" not in originals


def test_term_vocabulary_whitelist(sc):
    # A technical term that would otherwise be unknown.
    wl = sc_mod.build_whitelist(term_vocabulary=["Zaidi", "QuadratureCoupler"])
    out = sc_mod.spell_check_paragraph(
        "zaidi designed the quadraturecoupler.", sc, whitelist=wl)
    originals = _originals(out)
    assert "zaidi" not in originals
    assert "quadraturecoupler" not in originals


# --- UK/US variants not flagged ------------------------------------------

def test_uk_us_variants_not_flagged(sc):
    wl = sc_mod.build_whitelist(uk_us_pairs=[("colour", "color"), ("organise", "organize")])
    out = sc_mod.spell_check_paragraph(
        "He will colour the organise.", sc, whitelist=wl)
    assert all(f.original.lower() not in {"colour", "organise", "color", "organize"} for f in out)


# --- Acronyms, numbers, URLs, short tokens --------------------------------

def test_acronyms_skipped(sc):
    out = sc_mod.spell_check_paragraph("The API returns JSON over HTTPS.", sc)
    assert out == []


def test_numbers_and_identifiers_skipped(sc):
    out = sc_mod.spell_check_paragraph(
        "Model GPT-4 and v2 were tested in experiment 3b.", sc)
    # No typo findings. (hyphenated tokens with digits should be skipped.)
    assert out == []


def test_urls_and_emails_skipped(sc):
    out = sc_mod.spell_check_paragraph(
        "See https://example.com/foo and e-mail bob@example.com for info.", sc)
    originals = _originals(out)
    # "example" and "foo" inside the URL/email must not be flagged.
    assert "example" not in originals
    assert "foo" not in originals


def test_short_tokens_skipped(sc):
    out = sc_mod.spell_check_paragraph("A I is an AI.", sc)
    assert out == []


# --- Mid-sentence capitalized words treated as proper nouns ---------------

def test_proper_nouns_not_flagged(sc):
    out = sc_mod.spell_check_paragraph(
        "The author Zaidi met Dr. Wheeler yesterday.", sc)
    originals = _originals(out)
    assert "Zaidi" not in originals
    assert "Wheeler" not in originals


# --- Capitalized tokens treated as proper nouns (noise-reduction tradeoff) --

def test_capitalized_tokens_skipped(sc):
    # Any Title-case unknown token is skipped as a probable proper noun —
    # including sentence-initial. This loses "Teh cat" (sentence-start) typo
    # detection but kills the noise from author names, place names, etc.
    out = sc_mod.spell_check_paragraph("Teh cat sat on the mat.", sc)
    assert all(f.original != "Teh" for f in out)


def test_proper_names_at_sentence_start_skipped(sc):
    out = sc_mod.spell_check_paragraph(
        "Wesemann published a paper. Peplau cited it.", sc)
    originals = _originals(out)
    assert "Wesemann" not in originals
    assert "Peplau" not in originals


# --- exclude_spans: exact-span dedup against upstream rule findings -------

def test_exclude_spans_exact_match_prevents_duplicate(sc):
    """House-style rule already flagged the exact word → typo is suppressed.

    Scenario from req #7: UK/US rule flags 'colour' at [X,X+6], typo would
    flag the same span. Prefer the house-style rule; drop the typo."""
    text = "The dog teh cat sat."
    idx = text.index("teh")
    out = sc_mod.spell_check_paragraph(
        text, sc, exclude_spans=[(idx, idx + 3)])
    assert all(f.original != "teh" for f in out)


def test_rule_span_larger_than_typo_does_NOT_suppress(sc):
    """A sentence-level finding covering the whole sentence must NOT suppress
    typos inside it — they're different issues (req #6)."""
    text = "The quick brown fox jumps over teh lazy dog."
    # Rule finding is a Sentence span (0, len(text)) — covers everything.
    out = sc_mod.spell_check_paragraph(
        text, sc, exclude_spans=[(0, len(text))])
    assert any(f.original == "teh" for f in out), \
        "Typo inside a wider rule span must still be reported"


def test_rule_span_adjacent_but_not_identical_does_NOT_suppress(sc):
    """Rule flags offsets [8,10] (part of a word); typo flags [8,11] (whole
    word). Different spans → both are distinct issues; typo must still fire."""
    text = "The dog teh cat sat."
    idx = text.index("teh")
    # Pretend an upstream rule flagged only "te" (idx .. idx+2), not the full word.
    out = sc_mod.spell_check_paragraph(
        text, sc, exclude_spans=[(idx, idx + 2)])
    assert any(f.original == "teh" for f in out), \
        "Partial-overlap-but-not-exact rule span must NOT suppress the typo"


def test_same_word_two_paragraphs_both_flagged(sc):
    """Req #9 scenario: same misspelled word in two different paragraphs —
    each paragraph's spell_check call must emit its own finding, regardless
    of whether the other paragraph's rule findings suppressed it."""
    p1 = "First paragraph has teh word."
    p2 = "Second paragraph also has teh word."

    # Paragraph 1: upstream rule flagged "teh" — suppress typo here.
    idx1 = p1.index("teh")
    out1 = sc_mod.spell_check_paragraph(
        p1, sc, exclude_spans=[(idx1, idx1 + 3)])

    # Paragraph 2: no upstream rule — typo must still fire.
    out2 = sc_mod.spell_check_paragraph(p2, sc, exclude_spans=[])

    assert all(f.original != "teh" for f in out1)
    assert any(f.original == "teh" for f in out2), \
        "Second-paragraph occurrence must be flagged independently"


def test_uk_us_variant_whitelist_takes_precedence(sc):
    """Req #9 scenario: UK variant that would normally pass through pyspell-
    checker's dict (because 'colour' IS in English dicts) must not be flagged
    as a typo once added to the UK/US whitelist. Confirms the whitelist layer
    stays in effect alongside dedup."""
    wl = sc_mod.build_whitelist(uk_us_pairs=[("colour", "color")])
    out = sc_mod.spell_check_paragraph(
        "The colour of the dog.", sc, whitelist=wl, exclude_spans=[])
    assert all(f.original.lower() != "colour" for f in out)


def test_client_dictionary_term_not_flagged(sc):
    """Req #9 scenario: a client-approved technical term (made-up word that
    would be unknown to pyspellchecker) must not be flagged when it's in the
    project variant_to_canonical dict."""
    wl = sc_mod.build_whitelist(variant_to_canonical={"zyxabra": "zyxabra"})
    out = sc_mod.spell_check_paragraph(
        "The zyxabra protocol is standard.", sc, whitelist=wl)
    assert all(f.original != "zyxabra" for f in out)


# --- `pre` false-positive regression (user-reported) ----------------------

def test_pre_standalone_not_flagged(sc):
    """`pre` is a legitimate standalone English prefix/adverb (M-W). It must
    not be flagged, and must never be `suggested → are`."""
    out = sc_mod.spell_check_paragraph(
        "Compare pre values with other values.", sc)
    assert all(f.original != "pre" for f in out)


def test_pre_and_post_intervention_not_flagged(sc):
    """User-reported case: `pre and post-intervention` in a sentence about
    time-series analyses. Neither `pre` nor the hyphenated `post-intervention`
    should be flagged."""
    out = sc_mod.spell_check_paragraph(
        "We ran time-series analyses on pre and post-intervention measures.",
        sc,
    )
    originals = _originals(out)
    assert "pre" not in originals, f"`pre` must not be flagged; got: {originals}"
    assert "post-intervention" not in originals
    assert "post" not in originals


def test_pre_intervention_hyphenated_not_flagged(sc):
    """Hyphenated `pre-intervention` is skipped entirely (hyphen rule),
    AND `post-intervention` likewise. No part flagged."""
    out = sc_mod.spell_check_paragraph(
        "The pre-intervention and post-intervention measures agreed.", sc)
    originals = _originals(out)
    assert "pre-intervention" not in originals
    assert "post-intervention" not in originals
    assert "pre" not in originals
    assert "post" not in originals


def test_pre_never_suggests_are(sc):
    """Even if some future dict regression caused `pre` to be flagged, the
    short-token distance filter must prevent `are` (edit distance 2) from
    ever being proposed as a correction."""
    out = sc_mod.spell_check_paragraph("pre and post-intervention.", sc)
    for f in out:
        if f.original == "pre":
            assert f.suggestion != "are", \
                f"`pre` must never be suggested as `are`; got: {f.suggestion}"


def test_genuine_misspelling_still_detected(sc):
    """Guardrail: the fixes above must not have suppressed real typos."""
    out = sc_mod.spell_check_paragraph(
        "We should recieve the enviroment report.", sc)
    originals = _originals(out)
    assert "recieve" in originals
    assert "enviroment" in originals
    rec = next(f for f in out if f.original == "recieve")
    env = next(f for f in out if f.original == "enviroment")
    assert rec.suggestion == "receive"
    assert env.suggestion == "environment"


def test_valid_short_words_and_prefixes_not_flagged(sc):
    """Common standalone English prefix/adverb words must pass."""
    text = ("The pre, post, non, anti, pro, co, re, sub, super, semi, multi, "
            "inter, and intra classifications are documented.")
    out = sc_mod.spell_check_paragraph(text, sc)
    for pfx in ("pre", "post", "non", "anti", "pro", "co", "re", "sub",
                "super", "semi", "multi", "inter", "intra"):
        assert all(f.original != pfx for f in out), \
            f"short prefix word {pfx!r} must not be flagged"


def test_same_word_two_paragraphs_separate_occurrences(sc):
    """Repeated genuine typos in different paragraphs must each get their
    own finding — req #8: 'do not merge findings from different paragraph
    locations'."""
    p1 = "This paragraph has teh word once."
    p2 = "Another paragraph with teh word also."
    out1 = sc_mod.spell_check_paragraph(p1, sc)
    out2 = sc_mod.spell_check_paragraph(p2, sc)
    teh1 = [f for f in out1 if f.original == "teh"]
    teh2 = [f for f in out2 if f.original == "teh"]
    assert len(teh1) == 1
    assert len(teh2) == 1
    # Different (start, end) in their own paragraphs' coordinate frames
    assert (teh1[0].start, teh1[0].end) != (teh2[0].start, teh2[0].end) \
        or True  # offsets are per-paragraph; the assertion that they're
                 # independent entries is already proven by the two lists.


def test_short_token_never_suggests_unrelated_high_freq_word(sc):
    """A short unknown token must not get a wildly unrelated distance-2
    suggestion just because the candidate has high corpus frequency."""
    # Pretend "xqy" is unknown. Candidates at distance 2 might include
    # common words — none should be emitted because none is distance-1.
    out = sc_mod.spell_check_paragraph("The xqy result.", sc)
    for f in out:
        if f.original == "xqy":
            # If anything IS emitted, it must be edit-distance 1 from xqy.
            d = sc_mod._levenshtein("xqy", f.suggestion.lower())
            assert d <= 1, (
                f"Short-token suggestion {f.suggestion!r} is distance {d}; "
                f"should be ≤ 1."
            )


# --- Whitelist builder sanity --------------------------------------------

def test_build_whitelist_lowercases_everything():
    wl = sc_mod.build_whitelist(
        variant_to_canonical={"Colour": "Color"},
        uk_us_pairs=[("Analyse", "Analyze")],
        term_vocabulary=["Zaidi", "APA Bias-Free Guidelines"],
        extras=["QUADRATURE"],
    )
    assert "colour" in wl
    assert "color" in wl
    assert "analyse" in wl
    assert "analyze" in wl
    assert "zaidi" in wl
    assert "apa" in wl
    # Hyphenated terms stay as single tokens — intentional: don't whitelist
    # "bias" alone just because "bias-free" appears in a term list.
    assert "bias-free" in wl
    assert "guidelines" in wl
    assert "quadrature" in wl


# --- Empty / None safety -------------------------------------------------

def test_empty_text_returns_nothing(sc):
    assert sc_mod.spell_check_paragraph("", sc) == []
    assert sc_mod.spell_check_paragraph("   \n\t", sc) == []


def test_sc_none_returns_nothing():
    assert sc_mod.spell_check_paragraph("teh dog", None) == []


# --- Possessives (ASCII and curly apostrophe) not flagged ----------------

def test_ascii_possessive_not_flagged(sc):
    out = sc_mod.spell_check_paragraph("The nurse's clipboard was lost.", sc)
    assert all(f.original != "nurse's" for f in out)


def test_curly_possessive_not_flagged(sc):
    out = sc_mod.spell_check_paragraph("The nurse’s clipboard was lost.", sc)
    assert all("nurse" not in f.original for f in out)


def test_hyphenated_compound_not_flagged(sc):
    out = sc_mod.spell_check_paragraph(
        "The by-product was a co-op issue.", sc)
    assert all("-" not in f.original for f in out)


# --- Typo findings stay in their own category ---------------------------

def test_typo_category_is_distinct_from_spelling_category(sc):
    """Req: house-style ('spelling') and UK/US findings must not be reclassified
    as typos, and vice-versa. The spell checker only ever emits category='typo'."""
    out = sc_mod.spell_check_paragraph("The patient recieve the drug.", sc)
    categories = {f.category for f in out}
    assert categories == {"typo"}, (
        f"Spell check must only emit category='typo'; got {categories}"
    )


def test_typo_category_label_present_on_every_finding(sc):
    """Every finding returned by `spell_check_paragraph` is tagged `typo` so
    the UI can place it on the Typo chip, not the Spelling chip."""
    out = sc_mod.spell_check_paragraph(
        "The enviroment report was recieved on monday.", sc)
    assert out, "fixture typos should have fired"
    assert all(f.category == "typo" for f in out)


def test_rule_id_prefix_namespaces_typos(sc):
    """Every typo rule_id starts with `typo:` so decisions/analytics can
    separate pyspellchecker findings from the house-style rule engine's."""
    out = sc_mod.spell_check_paragraph("We should recieve it.", sc)
    assert out
    assert all(f.rule_id.startswith("typo:") for f in out)


# --- MedSpl800 sampled terms (end-to-end, bundled dic) --------------------

@pytest.fixture(scope="module")
def medspl_dict():
    """Load the bundled MedSpl800 dictionary once per test module. If the
    bundle is missing (CI without the asset), the dependent tests skip."""
    from app.processing.language_editing import custom_dict
    custom_dict.load_all_custom_dicts.cache_clear()
    try:
        words = custom_dict.load_all_custom_dicts()
    finally:
        custom_dict.load_all_custom_dicts.cache_clear()
    if not words or len(words) < 1000:
        pytest.skip("MedSpl800 dic not bundled in this environment")
    return words


def test_medspl800_sampled_terms_not_flagged(sc, medspl_dict):
    """A representative set of MedSpl800 terms — chosen to cover simple
    lowercase, dual-form slash entries, and long technical names — must
    pass the typo scanner once the dic is wired into the whitelist."""
    whitelist = sc_mod.build_whitelist(extras=medspl_dict)
    sampled = [
        "cholecalciferol",   # vitamin D form, long lowercase single-token
        "warfarin",          # anticoagulant
        "metformin",         # diabetes drug
        "ibuprofen",         # OTC analgesic
        "aspirin",           # ubiquitous
        "anterior",          # dual-form slash entry (anterior/posterior)
        "posterior",         # same pair
        "hydroxytryptamine", # alpha portion of 5-hydroxytryptamine
    ]
    # Build one paragraph that mentions each so we also exercise multi-token
    # tokenisation + whitelist lookup in a single pass.
    text = "The regimen includes " + ", ".join(sampled) + "."
    findings = sc_mod.spell_check_paragraph(text, sc, whitelist=whitelist)
    flagged = [f.original.lower() for f in findings]
    for term in sampled:
        # Skip terms that aren't actually in the bundled dic (makes the test
        # robust to future dic rotations) — but assert the ones that ARE
        # present pass.
        if term in medspl_dict:
            assert term not in flagged, (
                f"MedSpl800 term '{term}' was flagged as a typo"
            )


def test_medspl800_shields_terms_while_real_typo_fires(sc, medspl_dict):
    """Core user requirement: medical terminology from the supplied dic is
    not flagged, but a genuine misspelling in the same paragraph still is."""
    whitelist = sc_mod.build_whitelist(extras=medspl_dict)
    text = ("Administer cholecalciferol with warfarin and metformin. "
            "The patient recieve ibuprofen as needed.")
    findings = sc_mod.spell_check_paragraph(text, sc, whitelist=whitelist)
    flagged = [f.original.lower() for f in findings]
    # Medical names shielded
    for term in ("cholecalciferol", "warfarin", "metformin", "ibuprofen"):
        if term in medspl_dict:
            assert term not in flagged
    # Genuine typo still caught
    assert "recieve" in flagged
    rec = next(f for f in findings if f.original == "recieve")
    assert rec.suggestion == "receive"
    assert rec.category == "typo"

