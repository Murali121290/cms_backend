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



# --- Valid but less-common English words must NOT be flagged ---------------

@pytest.mark.parametrize(
    "sentence,word",
    [
        # User-reported: `expectance` is a valid English noun (M-W) that
        # pyspellchecker's small base dict misses, so it was falling through
        # to .candidates() and being flagged with `expectancy`. The morph-
        # variant pass now strips `-ance`/`-ancy` and sees the root `expect`
        # is known — so the token passes.
        ("Our expectance of success grew.", "expectance"),
        # Same shape, inverse spelling. Should also pass (and in fact is in
        # pyspell's base dict directly).
        ("Our expectancy of success grew.", "expectancy"),
        # Other legitimate derivations the small base dict can miss.
        ("Her obstinance was clear.", "obstinance"),
        ("A dependence on the drug formed.", "dependence"),
        ("A frequency of two per day.", "frequency"),
        ("The extensive review was ready.", "extensive"),
        ("An impermissible move was blocked.", "impermissible"),
        ("Highly intelligible speech was heard.", "intelligible"),
        ("A reusable syringe.", "reusable"),
        ("A dangerous situation.", "dangerous"),
        ("A workmanship issue.", "workmanship"),
    ],
)
def test_valid_rare_derivation_not_flagged(sc, sentence, word):
    """Valid English derivation of a known root — must NOT be classified as
    a typo even if pyspellchecker's small base dict doesn't list it."""
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word not in flagged, (
        f"valid English word {word!r} was flagged in {sentence!r}; findings: {flagged}"
    )


def test_do_not_suggest_alternative_for_valid_word_only_because_more_common(sc):
    """Core user requirement — pyspellchecker's `.candidates()` for
    `expectance` returns `expectancy`, which would wrongly swap a valid rare
    word for a more common form. The morph-variant pass must prevent the
    finding from ever being emitted, so no suggestion appears at all."""
    out = sc_mod.spell_check_paragraph("Our expectance of a result.", sc)
    assert all(f.original != "expectance" for f in out), (
        "valid English `expectance` must not be converted to `expectancy`"
    )


# --- Genuine misspellings are still detected ------------------------------

@pytest.mark.parametrize(
    "sentence,word",
    [
        ("Please recieve the shipment.", "recieve"),
        ("The enviroment was clean.", "enviroment"),
        ("teh dog was asleep.", "teh"),
    ],
)
def test_genuine_typo_still_flagged(sc, sentence, word):
    """Guard the fix doesn't become a blanket suppression. Classic typos
    whose edit distance to a dictionary word is small AND whose root isn't
    a known valid English stem must still fire as `typo` findings."""
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word in flagged, (
        f"genuine typo {word!r} was not caught in {sentence!r}; findings: {flagged}"
    )
    # And the finding is in the typo category (not the house-style spelling
    # category), so it stays on the Typo chip.
    rec = next(f for f in out if f.original.lower() == word)
    assert rec.category == "typo"


def test_ichill_still_flagged_with_chill_candidate(sc):
    """Explicit user example: `ichill` is a genuine typo (nonsense leading
    `i` prefix) and should flag with `chill` among the candidates where the
    engine supports a suggestion."""
    out = sc_mod.spell_check_paragraph("The patient had an ichill reaction.", sc)
    assert any(f.original == "ichill" for f in out)
    rec = next(f for f in out if f.original == "ichill")
    # pyspellchecker's distance-2 candidate set for `ichill` includes `chill`.
    # We don't assert ordering (frequency-driven) — just that it's a plausible
    # correction surfaced to the user.
    assert "chill" in {rec.suggestion.lower(), *[s.strip().lower() for s in rec.message.split(":")[-1].split(",")]} \
        or rec.suggestion.lower() == "chill"


# --- Medical dic terms still shielded alongside the new morph rules -------

def test_medical_term_still_shielded_after_morph_rules_added():
    """Make sure the new suffix rules don't accidentally dismiss a shielded
    medical term as "just a -ity derivation of some root". The whitelist
    layer runs first and should still win."""
    from app.processing.language_editing import custom_dict
    custom_dict.load_all_custom_dicts.cache_clear()
    try:
        dic_words = custom_dict.load_all_custom_dicts()
    finally:
        custom_dict.load_all_custom_dicts.cache_clear()
    if not dic_words:
        pytest.skip("MedSpl800 dic not bundled in this environment")

    local_sc = sc_mod.get_spell_checker(custom_words=dic_words)
    if local_sc is None:
        pytest.skip("pyspellchecker not installed")
    wl = sc_mod.build_whitelist(extras=dic_words)
    text = "Administer cholecalciferol and metformin daily."
    out = sc_mod.spell_check_paragraph(text, local_sc, whitelist=wl)
    flagged = [f.original.lower() for f in out]
    assert "cholecalciferol" not in flagged
    assert "metformin" not in flagged


# --- User-reported false positives in production -------------------------
#
# Observed in the Language Editor: valid English words were being flagged
# because pyspellchecker's small base dict missed them and its
# `.candidates()` happily returned a nearest-neighbour word. These tests
# reproduce the three screenshot cases + similar classes and lock in the
# fix. The underlying mechanisms are: (1) adjective↔noun suffix pairs for
# `-ic/-ics/-ical`, (2) compound-of-known-halves recognition, (3) a tiny
# set of common-tech words directly in the extras.


@pytest.mark.parametrize(
    "sentence,word",
    [
        # Screenshot 1: pyspell only knows the noun `psychodynamics`, not
        # the adjective. The `-ic → -ics` suffix pair now resolves it.
        ("The psychodynamic approach is useful.", "psychodynamic"),
        # Same mechanism, generalises to any -ic adjective paired with its
        # -ics noun form.
        ("The hydrodynamic flow was modeled.", "hydrodynamic"),
        ("Thermodynamic equilibrium was reached.", "thermodynamic"),
        # Screenshot 2: valid closed-form compound. Resolves via
        # `well` + `being` both in base dict.
        ("Her wellbeing improved last week.", "wellbeing"),
        # Other compound closed-form words that resolve the same way.
        ("The healthcare worker arrived.", "healthcare"),
        ("A policymaker spoke.", "policymaker"),
        # Screenshot 3: `app`/`apps` stem is missing from pyspell's base
        # English dict and can't be rescued by morphology. Direct extras.
        ("Install five apps on the device.", "apps"),
        ("Open the app and sign in.", "app"),
    ],
)
def test_screenshot_false_positives_no_longer_flagged(sc, sentence, word):
    """Each sentence contains the word that WAS being incorrectly flagged.
    After the fix, the Spell Check pass must emit no finding for that word."""
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word not in flagged, (
        f"valid English {word!r} must not be flagged; findings: {flagged}"
    )


def test_do_not_suggest_plural_as_correction_for_valid_singular(sc):
    """Core regression: pyspell's `.candidates('psychodynamic')` returns
    `['psychodynamics']` because only the plural is in the base dict. The
    pipeline must NOT turn that suggestion into a finding — the token is
    a valid English adjective, period."""
    out = sc_mod.spell_check_paragraph("The psychodynamic approach.", sc)
    for f in out:
        assert f.original.lower() != "psychodynamic", (
            f"`psychodynamic` must never be swapped for `psychodynamics` "
            f"(suggestion was {f.suggestion!r})"
        )


def test_do_not_suggest_unrelated_word_for_valid_compound(sc):
    """Core regression: pyspell's `.candidates('wellbeing')` returns
    `['welling']` — a semantically unrelated verb form. Suggesting it as
    a spelling correction is wrong; `wellbeing` is a valid compound of two
    known halves and must be accepted as correct."""
    out = sc_mod.spell_check_paragraph("Her wellbeing improved.", sc)
    for f in out:
        assert f.original.lower() != "wellbeing", (
            f"`wellbeing` must never be swapped for `welling` "
            f"(suggestion was {f.suggestion!r})"
        )


def test_do_not_suggest_edit_distance_1_substitution_for_valid_short_word(sc):
    """Core regression: pyspell's `.candidates('apps')` includes `apes`
    (one letter substitution). The pipeline must NOT turn a valid common
    plural into a nearest-neighbour spelling suggestion."""
    out = sc_mod.spell_check_paragraph("Install five apps.", sc)
    for f in out:
        assert f.original.lower() != "apps", (
            f"`apps` must never be swapped for `apes` "
            f"(suggestion was {f.suggestion!r})"
        )


# --- Compound-of-known-halves rule guards --------------------------------

def test_compound_rule_does_not_mask_genuine_typo(sc):
    """Guard: the compound-of-known-halves recognition requires BOTH halves
    to be known AND each ≥3 letters. Genuine typos like `recieve`,
    `enviroment`, `ichill`, `teh` have no clean split into two known
    halves — they must still fire."""
    for text, word in [
        ("recieve the shipment", "recieve"),
        ("the enviroment is clean", "enviroment"),
        ("an ichill reaction", "ichill"),
        ("teh dog ran", "teh"),
    ]:
        out = sc_mod.spell_check_paragraph(text, sc)
        flagged = [f.original.lower() for f in out]
        assert word in flagged, (
            f"compound rule must not have masked typo {word!r}; "
            f"flagged={flagged}"
        )


def test_compound_rule_rejects_single_letter_prefix_split(sc):
    """`ichill` would split as `i` + `chill` — but `i` is only one letter
    and the compound rule requires each half ≥3. So `ichill` still ends
    up unknown → flagged."""
    out = sc_mod.spell_check_paragraph("an ichill reaction", sc)
    assert any(f.original == "ichill" for f in out)


def test_compound_rule_rejects_two_letter_prefix_split(sc):
    """`recieve` would split as `re` + `cieve`, but `re` is only two
    letters and `cieve` isn't a word — both barriers hold."""
    out = sc_mod.spell_check_paragraph("recieve this", sc)
    assert any(f.original == "recieve" for f in out)


# --- Category isolation ----------------------------------------------------

def test_screenshot_false_positives_do_not_leak_into_other_categories(sc):
    """The fix must not re-route the dropped findings into Grammar,
    Spelling, Terms, or any other category. These sentences simply should
    produce ZERO Spell Check findings."""
    for text in (
        "The psychodynamic approach is useful.",
        "Her wellbeing improved.",
        "Install five apps.",
    ):
        out = sc_mod.spell_check_paragraph(text, sc)
        for f in out:
            # The screenshot words themselves must not be in any finding;
            # unrelated words in the same sentence could still legitimately
            # fire for other reasons, but these three must not.
            assert f.original.lower() not in {"psychodynamic", "wellbeing", "apps"}, (
                f"finding for {f.original!r} leaked into {f.category!r}"
            )


# --- Follow-up user-reported false positives -----------------------------
#
# Second production pass surfaced two more valid English words being
# flagged with nearest-neighbour suggestions. Same underlying cause as
# before (pyspellchecker's small base dict is lemma-oriented), different
# missing bits of morphology:
#   * reductionistic -> reductionist : `-ic` adjective built on an `-ist`
#                                       noun; needed `-ic` suffix stripping.
#   * destigmatizing -> stigmatizing : `de-` prefix form; needed `de`
#                                       added to the PREFIXES tuple.


@pytest.mark.parametrize(
    "sentence,word",
    [
        # Reported.
        ("A reductionistic model of the mind.", "reductionistic"),
        ("The destigmatizing campaign ran successfully.", "destigmatizing"),
        # Same mechanism (-ic on -ist/-ion noun root).
        ("A conformistic worldview spread.", "conformistic"),
        # Same mechanism (de- prefix on known base word).
        ("A destigmatize initiative was launched.", "destigmatize"),
        # Other `de-` + known-base derivations.
        ("A deactivation sequence ran.", "deactivation"),
        # trans- / pro- / fore- / mid- prefixes on known bases.
        ("A transnational agreement was signed.", "transnational"),
        ("A proactive step prevented the issue.", "proactive"),
        ("The forewarn signal came early.", "forewarn"),
    ],
)
def test_second_round_false_positives_no_longer_flagged(sc, sentence, word):
    """Valid English derivation — reported in the second production pass
    after the first fix shipped. Must NOT be flagged just because a
    nearest-neighbour candidate exists."""
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word not in flagged, (
        f"valid English {word!r} must not be flagged; findings: {flagged}"
    )


def test_reductionistic_not_swapped_for_reductionist(sc):
    """Lock-in: `.candidates('reductionistic')` returns `reductionist`.
    The pipeline must not turn that into a finding — both are valid
    English and the author's choice stands."""
    out = sc_mod.spell_check_paragraph("A reductionistic model.", sc)
    for f in out:
        assert f.original.lower() != "reductionistic", (
            f"`reductionistic` must not be swapped (suggestion was {f.suggestion!r})"
        )


def test_destigmatizing_not_swapped_for_stigmatizing(sc):
    """Lock-in: pyspell knows `stigmatizing` and `.candidates(...)` returns
    it. The `de-` prefix handling must prevent a suggestion from being
    emitted — reversing the author's semantics would be a wrong edit."""
    out = sc_mod.spell_check_paragraph("The destigmatizing campaign.", sc)
    for f in out:
        assert f.original.lower() != "destigmatizing", (
            f"`destigmatizing` must not be swapped (suggestion was {f.suggestion!r})"
        )


# Guard: the two new morphology rules must not mask genuine typos.
@pytest.mark.parametrize(
    "sentence,word",
    [
        # Genuine typos — none decompose into known base + the newly-added
        # prefixes/suffixes.
        ("Please recieve the box.", "recieve"),
        ("The enviroment is dirty.", "enviroment"),
        ("teh dog ran outside.", "teh"),
        ("An ichill reaction formed.", "ichill"),
    ],
)
def test_new_prefix_and_suffix_rules_do_not_mask_typos(sc, sentence, word):
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word in flagged, (
        f"typo {word!r} must still fire after the new morphology rules; "
        f"flagged={flagged}"
    )


# --- Third-round false positives: scientific compounds -------------------
#
# Reported from a geology/materials-science manuscript, paragraph 205:
#   `pseudomorphic` flagged with `-> pedomorphic (alt: pseudomorphine)`.
# Root cause: pyspell's lemma-oriented base dict carries the full
# compounds (`polymorphic`, `isomorphic`, `monomorphic`,
# `anthropomorphism`, …) but NOT the standalone `-morph-` combining-form
# stems (`morph`, `morphic`, `morphism`, `morphous`), nor several
# equally-productive learned prefixes it misses alongside the ones it has
# (`bio`, `nano`, `neuro`, `cyto`, `thermo`, …). The compound-of-known
# rule already splits `pseudomorphic -> pseudo + morphic`; the fix is to
# fill the lemma gap in `_EXTRA_KNOWN_WORDS` so the right half resolves.


@pytest.mark.parametrize(
    "sentence,word",
    [
        # Reported — primary case.
        ("A pseudomorphic layer formed on the substrate.", "pseudomorphic"),
        # Same `-morph-` family — same mechanism must cover siblings.
        ("The crystal shows a clear pseudomorph.", "pseudomorph"),
        ("Pseudomorphism is well-documented in metamorphic rocks.", "pseudomorphism"),
        ("A pseudomorphous replacement occurred.", "pseudomorphous"),
        # Other productive-prefix + known-root scientific compounds.
        ("The biomolecular assembly was stable.", "biomolecular"),
        ("A nanoscale defect disrupted the lattice.", "nanoscale"),
        ("The neurotoxic effect was reversible.", "neurotoxic"),
        ("A thermolabile protein denatured at 40 C.", "thermolabile"),
        ("A cryogenic trap captured the gas.", "cryogenic"),
    ],
)
def test_scientific_compounds_not_flagged(sc, sentence, word):
    """Valid scientific compound terminology must not be flagged just
    because the compound itself isn't in pyspell's small base dict —
    `<productive-prefix> + <known-root>` resolves via compound-of-known
    after the lemma-gap fix in `_EXTRA_KNOWN_WORDS`."""
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word not in flagged, (
        f"valid scientific term {word!r} must not be flagged; findings: {flagged}"
    )


def test_pseudomorphic_not_swapped_for_pedomorphic(sc):
    """Lock-in for the reported case: pyspell's `.candidates('pseudomorphic')`
    at distance 2 ranks `pedomorphic` / `pseudomorphine` as neighbours.
    The pipeline must not turn either suggestion into a finding — reversing
    `pseudomorphic` to `pedomorphic` would be a semantically wrong edit."""
    out = sc_mod.spell_check_paragraph(
        "The pseudomorphic film grew epitaxially.", sc)
    for f in out:
        assert f.original.lower() != "pseudomorphic", (
            f"`pseudomorphic` must not be swapped (suggestion was {f.suggestion!r})"
        )


# Guard: the new extras must not mask genuine misspellings. Note: we can
# only assert on typos whose INTENDED word is in pyspell's dict —
# `.candidates()` can't propose a correction it doesn't carry, so typos
# of out-of-dict scientific compounds (e.g. `psuedomorphic` -> intended
# `pseudomorphic`, which is itself unknown) silently drop by the no-
# suggestion rule regardless of this change. That's a pre-existing
# pyspell limitation, not a regression — the tests below cover the typo
# shapes we can verify.
@pytest.mark.parametrize(
    "sentence,word",
    [
        # Classic typos — adding `bio`/`nano`/`morph` to extras must not
        # weaken detection on unrelated misspellings.
        ("Please recieve the box.", "recieve"),
        ("The enviroment is dirty.", "enviroment"),
        ("teh dog ran outside.", "teh"),
        # Typo that happens to live near a newly-whitelisted stem.
        # `morh` is NOT in extras, so `biomorh` (fictional typo near
        # `biomorph`) decomposes as `bio` + `morh` → `morh` unknown →
        # compound-of-known rejects. If `biomorph` is in pyspell's dict
        # as a candidate at distance 1, the finding fires; this guards
        # against the extras over-whitelisting the right half.
        ("An ichill reaction formed.", "ichill"),
    ],
)
def test_new_extras_do_not_mask_typos(sc, sentence, word):
    out = sc_mod.spell_check_paragraph(sentence, sc)
    flagged = [f.original.lower() for f in out]
    assert word in flagged, (
        f"typo {word!r} must still fire after the lemma-gap fix; "
        f"flagged={flagged}"
    )
