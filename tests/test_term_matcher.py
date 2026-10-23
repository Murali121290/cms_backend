"""Term matching for the Language Editor — focused on hyphenated-compound
expansion so an assigned term like `self` highlights the entire
`self-awareness` compound, not just the leading component.
"""
import pytest

from app.processing.language_editing.term_matcher import (
    compile_term_list,
    find_term_matches,
    _expand_to_hyphenated_compound,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _single_list(*terms: str, list_id: int = 1, list_name: str = "Core"):
    """Compile one list containing the given terms (each gets a synthetic id)."""
    pairs = [(1000 + i, t) for i, t in enumerate(terms)]
    return compile_term_list(list_id, list_name, pairs)


def _spans(matches):
    return [(m["start"], m["end"], m["matched_text"]) for m in matches]


# ─── Low-level expansion helper ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "text,start,end,expected",
    [
        # Standalone self stays untouched.
        ("self and others", 0, 4, (0, 4)),
        # Leading component expands right.
        ("self-awareness", 0, 4, (0, 14)),
        # Trailing component expands left.
        ("self-awareness", 5, 14, (0, 14)),
        # Middle component expands both ways.
        ("pre-self-check", 4, 8, (0, 14)),
        # Three-part compound.
        ("self-respect-again", 0, 4, (0, 18)),
        # Hyphen but not followed by letter: dangling — no expansion.
        ("self-", 0, 4, (0, 4)),
        # Double hyphen: not a compound component.
        ("self--awareness", 0, 4, (0, 4)),
        # Em-dash isn't `-`: no expansion.
        ("self—dash", 0, 4, (0, 4)),
        # Parentheses stop at `(` / `)` — compound captured but not the paren.
        ("(self-esteem)", 1, 5, (1, 12)),
    ],
)
def test_expand_to_hyphenated_compound(text, start, end, expected):
    assert _expand_to_hyphenated_compound(text, start, end) == expected


# ─── Core user requirement: `self` → whole compound ─────────────────────────

def test_standalone_self_highlights_only_self():
    """Standalone word stays at length 4 — expansion only kicks in when the
    match is adjacent to a hyphenated compound component."""
    cl = _single_list("self")
    out = find_term_matches("A sense of self and purpose", [cl])
    assert _spans(out) == [(11, 15, "self")]


@pytest.mark.parametrize(
    "sentence,expected_match",
    [
        ("The self-awareness is key.", "self-awareness"),
        ("Her self-respect returned.", "self-respect"),
        ("Build self-esteem over time.", "self-esteem"),
        ("Promote self-care daily.", "self-care"),
        ("The pre-self-check reflex.", "pre-self-check"),
    ],
)
def test_self_matches_entire_hyphenated_compound(sentence, expected_match):
    cl = _single_list("self")
    out = find_term_matches(sentence, [cl])
    assert len(out) == 1
    assert out[0]["matched_text"] == expected_match
    # Document offsets land on the full compound.
    assert sentence[out[0]["start"] : out[0]["end"]] == expected_match


# ─── Other hyphenated compounds with assigned term components ───────────────

def test_hyphenated_compound_matched_via_trailing_component():
    """Term is `aware`; `self-aware` should expand to the full compound."""
    cl = _single_list("aware")
    out = find_term_matches("Be self-aware in meetings.", [cl])
    assert _spans(out) == [(3, 13, "self-aware")]


def test_hyphenated_compound_matched_via_middle_component():
    """Term is `self`; appears in the middle of `pre-self-aware`."""
    cl = _single_list("self")
    out = find_term_matches("The pre-self-aware classification.", [cl])
    assert _spans(out) == [(4, 18, "pre-self-aware")]


def test_three_part_compound_with_assigned_middle_term():
    """Term is `self`; `self-respect-again` is a three-part compound."""
    cl = _single_list("self")
    out = find_term_matches("Our self-respect-again framework.", [cl])
    assert _spans(out) == [(4, 22, "self-respect-again")]


# ─── Multi-paragraph / multi-occurrence correctness ─────────────────────────

def test_multiple_occurrences_in_same_paragraph_expand_independently():
    cl = _single_list("self")
    text = "Build self-awareness and nurture self-respect every day."
    out = find_term_matches(text, [cl])
    assert _spans(out) == [
        (6, 20, "self-awareness"),
        (33, 45, "self-respect"),
    ]


def test_mix_of_standalone_and_compound_in_one_paragraph():
    """Standalone `self` and compound `self-care` must each produce a correctly
    sized finding — the compound expands, the standalone stays short."""
    cl = _single_list("self")
    text = "The self in self-care matters."
    out = find_term_matches(text, [cl])
    assert _spans(out) == [
        (4, 8, "self"),
        (12, 21, "self-care"),
    ]


def test_same_compound_in_two_separate_sentences_both_matched():
    cl = _single_list("self")
    text = "self-awareness grows with practice. We cultivate self-awareness."
    out = find_term_matches(text, [cl])
    assert len(out) == 2
    assert out[0]["matched_text"] == "self-awareness"
    assert out[1]["matched_text"] == "self-awareness"
    # Different offsets — distinct occurrences.
    assert out[0]["start"] != out[1]["start"]


# ─── Dedup when multiple terms match the same compound ──────────────────────

def test_two_terms_matching_same_compound_dedupe_to_one_finding():
    """`self` AND `awareness` both match inside `self-awareness`. After
    expansion they share the key (0, 14) and should produce one finding —
    not two — attributed to the first list that fired."""
    cl = _single_list("self", "awareness")
    out = find_term_matches("self-awareness drives growth.", [cl])
    assert len(out) == 1
    assert _spans(out) == [(0, 14, "self-awareness")]


def test_cross_list_overlap_notes_also_in_list_names():
    """Two lists both contain terms that match the same compound after
    expansion. Only one finding, with the second list attributed via
    `also_in_list_names`."""
    cl_a = compile_term_list(1, "List A", [(100, "self")])
    cl_b = compile_term_list(2, "List B", [(200, "awareness")])
    out = find_term_matches("Our self-awareness framework.", [cl_a, cl_b])
    assert len(out) == 1
    m = out[0]
    assert m["matched_text"] == "self-awareness"
    assert m["term_list_name"] == "List A"
    assert m["also_in_list_names"] == ["List B"]


# ─── Term-id linkage survives the expansion ─────────────────────────────────

def test_term_id_links_to_original_matched_term_not_the_expansion():
    """The expanded surface (`self-awareness`) is not in the term list — the
    finding must still link to the Term row that triggered it (`self`)."""
    cl = _single_list("self")
    out = find_term_matches("Grow self-awareness.", [cl])
    assert len(out) == 1
    assert out[0]["term_id"] == 1000  # synthetic id assigned by _single_list


# ─── Boundaries that must NOT expand across unrelated chars ─────────────────

def test_do_not_expand_across_whitespace():
    """Space between words is a hard wall."""
    cl = _single_list("self")
    out = find_term_matches("self aware without hyphen", [cl])
    assert _spans(out) == [(0, 4, "self")]


def test_do_not_expand_across_em_dash():
    """Em-dash is not `-` and must not trigger compound expansion."""
    cl = _single_list("self")
    out = find_term_matches("self—dash", [cl])
    assert _spans(out) == [(0, 4, "self")]


def test_do_not_match_inside_longer_unhyphenated_word():
    """`self` inside `yourself` is not a word-boundary match, so the term
    matcher never fires there — nothing to expand."""
    cl = _single_list("self")
    out = find_term_matches("Trust yourself completely.", [cl])
    assert out == []


# ─── Interaction with longer-first ordering ─────────────────────────────────

def test_longer_phrase_term_still_wins_before_expansion():
    """Multi-word phrases are placed earlier in the alternation so they
    take precedence. Verify compound expansion doesn't break that."""
    cl = _single_list("self-aware", "self")
    out = find_term_matches("A self-aware mind.", [cl])
    assert len(out) == 1
    assert out[0]["matched_text"] == "self-aware"
    assert out[0]["start"] == 2
    assert out[0]["end"] == 12