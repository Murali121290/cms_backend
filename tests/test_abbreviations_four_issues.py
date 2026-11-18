"""Regression tests for four reported abbreviation false positives.

Each test reproduces the exact document text, asserts the wrong
finding is NOT emitted, and checks a representative guard so the
underlying rule continues to fire on legitimate cases.

Issues (as reported):

  1. AB01 — ``adverse childhood experiences (ACE)`` wrongly produced
     ``… (ACEs)`` first-use suggestion. The parenthetical is already
     a valid definition; the engine missed it because the author's
     plural ``experiences`` didn't match the workbook's singular
     canonical form.

  2. AB01 — ``World Health Organization (WHO, 2022)`` wrongly
     produced a first-use suggestion. ``_detect_definitions``
     required the abbreviation to be immediately followed by ``)``,
     so the ``WHO, 2022`` citation form dropped through.

  3. AB14 — ``(National Cancer Institute, 2023)`` wrongly suggested
     ``Cancer → cancer``. The proper-name parenthetical detector
     only recognised ``(ACRONYM)`` definitions, not comma-year
     citation parentheticals.

  4. AB13 — ``(adapted from SAMHSA, n.d.)`` wrongly suggested
     ``n.d. → nd``. The periods-in-initialism whitelist did not
     cover APA citation abbreviations.
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import abbreviations as ab
from app.processing.language_editing import abbreviations_metadata as meta


@pytest.fixture(autouse=True)
def _reset_caches():
    meta.clear_cache()
    ab.clear_cache()
    yield
    meta.clear_cache()
    ab.clear_cache()


def _run(text: str, paras: list[tuple[int, str]] | None = None) -> list:
    """Run analysis and return every AB-rule finding as
    (rule_id, original, suggestion) tuples."""
    paragraphs = paras or [(0, text)]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    out: list[tuple[str, str, str]] = []
    for pi, t in paragraphs:
        findings = ab.analyze_abbreviations(t, para_idx=pi, document_state=state)
        for f in findings:
            if f.rule_id.startswith("AB"):
                out.append((f.rule_id, f.original, f.suggestion))
    return out


# ─── Issue 1 — ACE plural-expansion / singular-abbreviation ────────

def test_issue1_plural_expansion_singular_abbr_recognized_as_definition():
    """``adverse childhood experiences (ACE)`` must be treated as a
    valid first-use definition — no AB01 "(ACEs)" suggestion."""
    findings = _run(
        "The authors report that adverse childhood experiences (ACE) are common."
    )
    # No AB01 may fire on this phrase, because the (ACE) parenthetical
    # IS the first-use definition.
    bad = [f for f in findings
           if f[0] == "AB01" and "adverse childhood experiences" in f[1].lower()]
    assert bad == [], f"wrong AB01 first-use on ACE phrase: {bad}"


def test_issue1_ace_in_prose_with_followups_does_not_suggest_plural():
    """With later ACE mentions in the document, the engine must not
    propose ``(ACEs)`` as the first-use form — the author already
    paired the plural phrase with the singular workbook abbreviation
    in the definition."""
    paragraphs = [
        (0, "The authors report that adverse childhood experiences (ACE) are common."),
        (1, "ACE exposure correlates with later health risk."),
        (2, "Researchers often group ACE scores by category."),
    ]
    findings = _run("", paragraphs)
    bad = [f for f in findings if f[0] == "AB01" and "(ACEs)" in f[2]]
    assert bad == [], f"AB01 wrongly proposed plural (ACEs): {bad}"


# ─── Issue 2 — (WHO, 2022) citation definition ──────────────────────

def test_issue2_abbr_followed_by_citation_year_counts_as_definition():
    """``World Health Organization (WHO, 2022)`` is a valid APA-style
    first-use definition. The citation year after the abbreviation
    must not prevent the engine from recognising the pair."""
    for text in (
        "According to the World Health Organization (WHO, 2022), cases rose.",
        "The World Health Organization (WHO, 2022) reported rising cases.",
    ):
        findings = _run(text)
        bad = [f for f in findings
               if f[0] == "AB01" and "World Health Organization" in f[1]]
        assert bad == [], (
            f"wrong AB01 first-use on WHO citation parenthetical in: {text}\n"
            f"findings: {bad}"
        )


def test_issue2_citation_separators_also_accepted():
    """The citation separator can be ``,`` or ``;`` — both are APA
    acceptable. The engine must recognize both."""
    for text in (
        "The World Health Organization (WHO, 2022) released guidance.",
        "The World Health Organization (WHO; see also 2022 report) issued guidance.",
    ):
        findings = _run(text)
        bad = [f for f in findings
               if f[0] == "AB01" and "World Health Organization" in f[1]]
        assert bad == [], f"wrong AB01 on separator form: {text!r} -> {bad}"


# ─── Issue 3 — citation parenthetical blocks AB14 ───────────────────

def test_issue3_citation_parenthetical_blocks_ab14_title_case_check():
    """``(National Cancer Institute, 2023)`` quotes a proper
    organization name. AB14 must not suggest lowercasing ``Cancer``."""
    findings = _run(
        "A cancer screening toolkit (National Cancer Institute, 2023) was published."
    )
    bad = [f for f in findings if f[0] == "AB14"]
    assert bad == [], f"wrong AB14 Title-Case inside citation: {bad}"


def test_issue3_variety_of_citation_parentheticals_protected():
    """Generic coverage: any ``(Capitalized Phrase, YEAR)`` must
    protect its inner capitals from AB14, not just National Cancer
    Institute. Covers American Psychological Association, Centers
    for Disease Control, World Health Organization, etc."""
    for text in (
        "A report (American Psychological Association, 2021) summarised the data.",
        "Data are collected (Centers for Disease Control and Prevention, 2020).",
        "See also World Bank (World Bank, 2023).",
    ):
        findings = _run(text)
        bad = [f for f in findings if f[0] == "AB14"]
        assert bad == [], (
            f"wrong AB14 inside citation parenthetical: {text!r} -> {bad}"
        )


def test_issue3_ordinary_title_case_expansion_still_flagged():
    """Guard: AB14 must continue to flag a legitimately mis-cased
    workbook expansion in body text. ``Intensive Care Unit`` in the
    middle of a sentence should still fire — it's the common term
    workbook expansion, not a proper-name citation."""
    findings = _run(
        "The Intensive Care Unit admitted the patient after surgery."
    )
    assert any(f[0] == "AB14" and "Intensive Care Unit" in f[1] for f in findings), (
        f"AB14 should still fire on body-text Title Case common-term "
        f"expansion; got: {findings}"
    )


# ─── Issue 4 — n.d. citation abbreviation whitelist ─────────────────

def test_issue4_nd_citation_marker_not_flagged_by_ab13():
    """``n.d.`` is APA "no date" notation, not an initialism. AB13
    must not propose ``n.d. → nd``."""
    findings = _run("The guidelines were adapted from SAMHSA (adapted from SAMHSA, n.d.).")
    bad = [f for f in findings if f[0] == "AB13" and f[1].lower() == "n.d."]
    assert bad == [], f"wrong AB13 on n.d. citation marker: {bad}"


def test_issue4_other_citation_shorthands_also_whitelisted():
    """Common academic citation shorthands must share the whitelist:
    ``cf.``, ``ibid.``, ``op. cit.`` — never AB13 candidates."""
    for text in (
        "The author elaborates elsewhere (cf. earlier chapter).",
        "A similar claim appears ibid.",
    ):
        findings = _run(text)
        bad = [f for f in findings if f[0] == "AB13"]
        assert bad == [], f"AB13 wrongly fired on citation shorthand: {text!r} -> {bad}"


def test_issue4_genuine_initialism_still_flagged():
    """Guard: AB13 must continue to flag legitimate periods-in-
    initialism (``U.S.A.``, ``I.C.U.``) per the selected style."""
    findings = _run("The U.S.A. is a federation. An I.C.U. nurse monitors patients.")
    assert any(f[0] == "AB13" and f[1] == "U.S.A." for f in findings), (
        f"AB13 should still fire on U.S.A.; got {findings}"
    )


# ─── Cross-issue guard: first-use rules keep working elsewhere ──────

def test_regression_guard_first_use_rule_still_fires_in_normal_prose():
    """AB01 first-use must still fire when the author has NOT
    provided a parenthetical definition (plural or singular). Guards
    against the fix over-suppressing first-use everywhere."""
    paragraphs = [
        (0, "A nurse practitioner reviewed the patient. The nurse practitioner updated the chart."),
        (1, "An NP is a licensed clinician."),
    ]
    findings = _run("", paragraphs)
    assert any(
        f[0] == "AB01" and "nurse practitioner" in f[1].lower()
        for f in findings
    ), f"AB01 should still fire on undefined 'nurse practitioner' prose: {findings}"


# ─── Issue 5 — square-bracket definition form ──────────────────────

def test_issue5_square_bracket_definition_recognized():
    """``B-type natriuretic peptide [BNP]`` is a valid first-use
    definition in medical/scientific prose. The engine must treat
    square brackets equivalently to parentheses — no AB01 ``…
    (BNP)`` suggestion, and the original ``[BNP]`` delimiter must
    stay in the stored definition span (never silently rewritten
    to parens)."""
    paragraphs = [
        (0, "Elevated B-type natriuretic peptide [BNP] indicates heart failure."),
        (1, "The BNP value correlates with ventricular stress."),
        (2, "Elevated BNP is a common finding in elderly patients."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    assert "BNP" in state
    defs = state["BNP"].definitions
    assert len(defs) == 1, (
        f"expected exactly 1 BNP definition from [BNP] form, got {defs}"
    )
    # The stored surface must carry the ORIGINAL square-bracket
    # delimiter verbatim — not a rewrite to parens.
    surface = defs[0][3]
    assert "[BNP]" in surface, (
        f"square brackets must be preserved in the stored surface; got {surface!r}"
    )
    assert "(BNP)" not in surface

    findings = _run("", paragraphs)
    # AB01 must not fire — [BNP] already defines the abbreviation.
    bad_ab01 = [f for f in findings
                if f[0] == "AB01" and "B-type natriuretic peptide" in f[1]]
    assert bad_ab01 == [], (
        f"AB01 wrongly fired on [BNP] definition: {bad_ab01}"
    )


def test_issue5_bracket_definition_still_blocks_ab01_on_bare_prose():
    """A bare ``B-type natriuretic peptide`` mention in a later
    paragraph must NOT trigger AB01 — the [BNP] definition in an
    earlier paragraph has already introduced the abbreviation."""
    paragraphs = [
        (0, "Elevated B-type natriuretic peptide [BNP] indicates heart failure."),
        (1, "Clinicians monitor BNP across admissions."),
        (2, "A second B-type natriuretic peptide draw confirmed the diagnosis."),
    ]
    findings = _run("", paragraphs)
    bad_ab01 = [f for f in findings
                if f[0] == "AB01" and "B-type natriuretic peptide" in f[1]]
    assert bad_ab01 == [], (
        f"AB01 wrongly re-emitted first-use after [BNP] already defined: {bad_ab01}"
    )


def test_issue5_bracket_citation_form_also_recognized():
    """``[ABBR, 2022]`` citation form inside square brackets must be
    recognized the same way as ``(ABBR, 2022)``. Mirrors the Issue-2
    comma-year citation fix for parentheses."""
    paragraphs = [
        (0, "Elevated B-type natriuretic peptide [BNP, 2022] indicates heart failure."),
        (1, "Monitoring BNP changes over time is clinically important."),
        (2, "Elevated BNP correlates with ventricular stress."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    defs = state["BNP"].definitions
    assert len(defs) == 1
    assert "[BNP" in defs[0][3] or "[BNP, 2022]" in defs[0][3]


def test_issue5_paren_form_still_works_regression():
    """Guard: the original ``(ABBR)`` form must still be recognized
    after the square-bracket extension."""
    paragraphs = [
        (0, "Elevated B-type natriuretic peptide (BNP) indicates heart failure."),
        (1, "Clinicians monitor BNP across admissions."),
        (2, "Elevated BNP is a common finding in elderly patients."),
    ]
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    defs = state["BNP"].definitions
    assert len(defs) == 1
    assert "(BNP)" in defs[0][3]


def test_issue5_no_cross_delimiter_matching():
    """Guard: the opener and closer must MATCH. ``(BNP]`` or
    ``[BNP)`` are malformed and must NOT be recognized as
    definitions."""
    for text in (
        "Elevated B-type natriuretic peptide (BNP] indicates heart failure.",
        "Elevated B-type natriuretic peptide [BNP) indicates heart failure.",
    ):
        state = ab.build_document_state([(0, text)], audience="general", min_uses=2)
        defs = state["BNP"].definitions
        assert len(defs) == 0, (
            f"mismatched delimiters must not form a definition: {text!r} -> {defs}"
        )


# ─── AB04 cascade — three-definition plural+singular+title-case ─────

def test_ab04_treats_first_plural_definition_as_the_first_use():
    """Audit regression for Issue 2 of the four-issues follow-up:
    when a document defines an abbreviation three times — plural
    expansion first, singular second, Title-Case singular third —
    the plural form IS the author's first use and the two later
    singular forms are the ``definitions[1:]`` that AB04 flags.

    Pins the current behaviour so a future refactor cannot regress
    to the earlier state (where _detect_definitions ignored the
    plural pairing and para 10 wrongly appeared to be ``definitions[0]``)."""
    paragraphs = [
        (0, "The group includes clinical specialists (PMHCNS) and "
            "psychiatric-mental health nurse practitioners (PMHNP). "
            "Educational preparation varies by discipline."),
        (1, "Later, psychiatric-mental health nurse practitioner (PMHNP) "
            "programs expanded nationwide."),
        (2, "The Psychiatric-Mental Health Nurse Practitioner (PMHNP) is "
            "educated to provide longitudinal, comprehensive care."),
        # Bare PMHNP mentions so the engine has a subject for its
        # first-use / repeated-definition machinery.
        (3, "PMHNP curricula emphasise cultural competence. "
            "Any PMHNP trained in these competencies must demonstrate "
            "proficiency in diverse settings. Finally, each PMHNP "
            "candidate completes a capstone project before graduation."),
    ]
    findings = _run("", paragraphs)
    ab04 = [(para, orig) for para, orig in
            [(pi, f[1]) for pi, _ in enumerate(paragraphs)
             for f in findings] if False]
    # Rebuild via a direct per-paragraph trace.
    state = ab.build_document_state(paragraphs, audience="general", min_uses=2)
    assert "PMHNP" in state, "PMHNP must be a known workbook entry"
    defs = state["PMHNP"].definitions
    assert len(defs) == 3, f"expected 3 PMHNP definitions, got {defs}"
    assert defs[0][0] == 0, (
        f"first PMHNP definition must be para 0 (the plural-expansion "
        f"form) — got para {defs[0][0]}: {defs[0]}"
    )

    # AB04 fires on defs[1] and defs[2], never on defs[0].
    ab04_paras = set()
    for pi, text in paragraphs:
        for f in ab.analyze_abbreviations(text, para_idx=pi, document_state=state):
            if f.rule_id == "AB04" and "PMHNP" in f.original.upper():
                ab04_paras.add(pi)
    assert 0 not in ab04_paras, (
        "AB04 must NOT fire on the first valid definition (para 0, "
        "plural-expansion form)"
    )
    assert ab04_paras == {1, 2}, (
        f"AB04 must fire on paras 1 and 2 (the repeated definitions); "
        f"got {ab04_paras}"
    )


def test_ab04_ignores_definitions_in_excluded_regions():
    """If the first ``expansion (ABBR)`` occurrence sits in an
    excluded region (references, abstract, extract, …), it never
    reaches build_document_state — exclusion happens in the router
    before analysis. The body-level first definition therefore
    remains the engine's ``definitions[0]`` and is NOT flagged
    AB04. This test documents the invariant by feeding the body-
    only paragraph list the router would pass after region
    filtering."""
    body_only = [
        (0, "Later, psychiatric-mental health nurse practitioner (PMHNP) "
            "programs expanded nationwide."),
        (1, "The Psychiatric-Mental Health Nurse Practitioner (PMHNP) is "
            "educated to provide longitudinal care."),
        (2, "PMHNP curricula emphasise cultural competence. "
            "Any PMHNP trained in these competencies must demonstrate "
            "proficiency. Finally, each PMHNP candidate completes a "
            "capstone project."),
    ]
    state = ab.build_document_state(body_only, audience="general", min_uses=2)
    defs = state["PMHNP"].definitions
    assert len(defs) == 2
    assert defs[0][0] == 0, (
        "With the excluded-region definition filtered out upstream, "
        "the body's first definition takes definitions[0]"
    )

    ab04_paras = set()
    for pi, text in body_only:
        for f in ab.analyze_abbreviations(text, para_idx=pi, document_state=state):
            if f.rule_id == "AB04" and "PMHNP" in f.original.upper():
                ab04_paras.add(pi)
    assert 0 not in ab04_paras, (
        "the body-level first definition must still enjoy first-use "
        "protection"
    )
    assert ab04_paras == {1}, (
        f"AB04 must fire on the second body-level definition only; "
        f"got {ab04_paras}"
    )
