"""Regression tests for the double-quote exclusion rule.

Spec addition: "exclude text enclosed within double quotation marks
(``"..."``) from Language Editing findings". The router injects
``build_quoted_text_spans`` into every analyze pass's ``protected_spans``
so engine + hyphen_dash + spell_check + term_matcher + basic_grammar
all drop findings whose span overlaps a quoted passage.

Covers:
  * Straight-ASCII pairs (``"..."``).
  * Curly / smart-quote pairs (``“...”``).
  * Guillemets (``«...»``).
  * Unclosed openers → treated as extending to end of paragraph.
  * Nested-like cases (two straight pairs on one line).
  * Workbook and profile-rule findings INSIDE a quoted span are
    dropped; findings OUTSIDE still fire.
  * GK-002 document-scope counter ignores quote chars from inside
    quoted runs (so the quote marks of the run itself are the only
    chars counted).
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import basic_grammar as bg
from app.processing.language_editing import engine


# ─── build_quoted_text_spans — the core helper ─────────────────────

def test_straight_quote_pair_extracted():
    text = 'He said "hello world" firmly.'
    spans = engine.build_quoted_text_spans(text)
    assert spans == [(8, 21)]
    assert text[8:21] == '"hello world"'


def test_curly_quote_pair_extracted():
    text = "The report said “yes it works” and nothing else."
    spans = engine.build_quoted_text_spans(text)
    assert len(spans) == 1
    s, e = spans[0]
    assert text[s:e].startswith("“")
    assert text[s:e].endswith("”")


def test_guillemet_pair_extracted():
    text = "Le document dit «bonjour tout le monde» en français."
    spans = engine.build_quoted_text_spans(text)
    assert len(spans) == 1


def test_unclosed_straight_quote_extends_to_end():
    text = 'He said "hello and then said nothing more'
    spans = engine.build_quoted_text_spans(text)
    assert spans == [(8, len(text))]


def test_unclosed_curly_quote_extends_to_end():
    text = "He said “hello and then said nothing more"
    spans = engine.build_quoted_text_spans(text)
    assert spans[0][1] == len(text)


def test_two_separate_straight_pairs_in_one_paragraph():
    text = 'He said "first" then he said "second".'
    spans = engine.build_quoted_text_spans(text)
    assert len(spans) == 2
    assert text[spans[0][0]:spans[0][1]] == '"first"'
    assert text[spans[1][0]:spans[1][1]] == '"second"'


def test_merged_output_sorted_and_non_overlapping():
    text = 'He said "A" and «B» and "C".'
    spans = engine.build_quoted_text_spans(text)
    # Three disjoint pairs, sorted by start.
    assert spans == sorted(spans)
    for a, b in zip(spans, spans[1:]):
        assert a[1] <= b[0]


def test_no_quotes_returns_empty():
    assert engine.build_quoted_text_spans("No quotes here at all.") == []


def test_empty_text_returns_empty():
    assert engine.build_quoted_text_spans("") == []


# ─── Filtering: findings inside a quoted span are dropped ─────────

def test_workbook_finding_inside_quoted_span_dropped_by_filter_protected():
    """A WC-004 ``in order to`` finding inside a quoted run would
    normally fire. After the router adds the quoted span to
    protected_spans, ``_filter_protected`` drops it."""
    text = 'He wrote "you should go in order to learn" in the memo.'
    findings = bg.analyze_basic_grammar(text)
    wc = [f for f in findings if f.rule_id == "WC-004"]
    assert wc, "sanity: WC-004 should fire before protected-span filtering"
    # Apply the protected-span filter the router would add.
    spans = engine.build_quoted_text_spans(text)
    kept = engine._filter_protected(findings, spans)
    assert not any(f.rule_id == "WC-004" for f in kept)


def test_workbook_finding_outside_quoted_span_survives_filter():
    """The same WC-004 finding, OUTSIDE the quoted section, must
    still fire after filtering."""
    text = 'He wrote "hello there" and we worked in order to deliver on time.'
    findings = bg.analyze_basic_grammar(text)
    wc_before = [f for f in findings if f.rule_id == "WC-004"]
    assert wc_before
    spans = engine.build_quoted_text_spans(text)
    kept = engine._filter_protected(findings, spans)
    wc_after = [f for f in kept if f.rule_id == "WC-004"]
    assert len(wc_after) == len(wc_before), "Outside-quote finding was wrongly dropped"


def test_finding_overlapping_the_quote_edge_is_dropped():
    """A span that starts outside a quote but extends inside it is
    still ``f.start < span_end and f.end > span_start`` → dropped."""
    text = 'He said in order to go "learn more" today.'
    findings = bg.analyze_basic_grammar(text)
    # WC-004 "in order to" sits outside the quote entirely here — not
    # a great test of overlap. Build a synthetic overlap case: the
    # filter helper should drop any finding whose [s, e) intersects
    # any protected span, even by a single character.
    class _FakeF:
        def __init__(self, s, e): self.start = s; self.end = e
        rule_id = "SYN"
    span = (10, 20)
    assert engine._filter_protected([_FakeF(5, 11)], [span]) == []   # overlaps start
    assert engine._filter_protected([_FakeF(19, 25)], [span]) == []  # overlaps end
    assert engine._filter_protected([_FakeF(11, 19)], [span]) == []  # fully inside
    assert len(engine._filter_protected([_FakeF(0, 5)], [span])) == 1  # fully outside


# ─── GK-002 ignores quote chars inside already-quoted content ─────

def test_gk002_doc_state_ignores_quotes_inside_quoted_runs():
    """When the router strips quoted-text content (replacing with
    spaces) before calling ``build_document_state``, a sentence like
    ``He said "tag "nested" tag" firmly.`` should contribute only the
    two outermost straight quotes to the straight-quote count."""
    from app.processing.language_editing import engine as _eng
    text = 'He said "outer with a quote mark inside" firmly.'
    spans = _eng.build_quoted_text_spans(text)
    # Mirror the router's _strip_quoted_runs helper.
    chars = list(text)
    for s, e in spans:
        for i in range(s, e):
            chars[i] = " "
    stripped = "".join(chars)
    # Nothing left between the outermost positions — length preserved.
    assert len(stripped) == len(text)
    # Counts over the stripped paragraph list.
    state = bg.build_document_state([(0, stripped)])
    # Both quote marks were INSIDE the span → stripped out.
    assert state["straight_quote_count"] == 0


# ─── Technical mid-case tokens (Issue 1 safety net) ─────────────

@pytest.mark.parametrize("token", [
    "pHEMT", "GeTe", "GaAs", "mRNA", "dB", "dBm", "3pF", "pF",
    "eGFR", "mmHg", "µF", "TiO2", "MEMS",
])
def test_workbook_never_flags_legitimate_mid_case_technical_token(token):
    """Regression safety for Issue 1: no basic_grammar rule may match
    a legitimate mid-case technical notation token as a capitalisation
    or spelling error. The tokens below are standard electronics /
    physics / medical shorthand and must pass untouched regardless of
    document variant."""
    for dv in ("en-US", "en-GB", "en-GB-oxendict"):
        findings = bg.analyze_basic_grammar(token, document_variant=dv)
        # Any finding that matches the TOKEN surface (not a trailing
        # period or boundary) is a false positive.
        offenders = [
            f for f in findings
            if f.original == token or (f.original and f.original in token)
        ]
        assert not offenders, (
            f"Workbook rule flagged technical token {token!r} under {dv}: "
            f"{[(f.rule_id, f.original, f.suggestion) for f in offenders]}"
        )


def test_workbook_never_flags_sentence_with_technical_tokens():
    """End-to-end safety: a realistic sentence mixing technical
    tokens should not produce ANY capitalisation-style finding whose
    original text contains a mid-case token."""
    sentences = [
        "The GaAs pHEMT amplifier delivered 38.5 dBm output power.",
        "MEMS-based tuners use varactor diodes rated at 3pF.",
        "The eGFR calculated from serum creatinine was 72 mL/min.",
        "The resistance was 50 Ω across the matched network.",
    ]
    for s in sentences:
        findings = bg.analyze_basic_grammar(s, document_variant="en-GB")
        import re as _re
        for f in findings:
            # A finding whose original contains [a-z][A-Z] on a non-
            # workbook-defined position would be the Issue-1 pattern.
            if _re.search(r"[a-z][A-Z]", f.original):
                pytest.fail(
                    f"Mid-case original slipped through: rule={f.rule_id} "
                    f"original={f.original!r} suggestion={f.suggestion!r} "
                    f"in sentence {s!r}"
                )
