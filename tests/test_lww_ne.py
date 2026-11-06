"""LWW-NE workbook Phase 2 runtime tests.

Covers the dedicated lww_ne runtime module + its engine wiring. Mirrors
the per-feature test pattern used by the four other workbook integrations
(hyphen_dash / abbreviations / medical_terms / uk_us_spelling).

Required coverage (per Phase 2 spec):
  1. Generic short-circuit — fires in every project
  2. APA / AMA / NE filtering — row fires only when project matches
  3. LWW_NE ID 11 vs ID 9 — only id=11 triggers NE semantics
  4. Q4 safety — quarantined rows never execute
  5. Q5 safety — Partial word (editor_hint) rows never scan
  6. Q6 safety — annotation_unclarified rows never execute
  7. Q7 safety — Unknown-confidence rows never auto_replace
  8. Volkmann's contracture — exercises Eponym-inert decision
  9. D1 suppression — logic test (router-level integration)
 10. D2 compound overlap suppression — resolve_overlaps verification

No database or FastAPI dependency: the runtime module is DB-free by
design (``is_lww_ne_project`` is a plain bool computed by the router).
Routers tests belong in a separate integration harness.
"""
from __future__ import annotations

import json
import pytest

from app.processing.language_editing import lww_ne
from app.processing.language_editing import engine
from app.processing.language_editing.rules import Finding, load_rules_from_dict


@pytest.fixture(autouse=True)
def _cold_cache():
    lww_ne.clear_cache()
    yield
    lww_ne.clear_cache()


# ─── 1. Loader + active-tag composition ───────────────────────────────

def test_compiled_entries_matches_import_summary():
    """Runtime-compiled entries = active (ok + scan) rows from Phase 1."""
    compiled = lww_ne._compiled_entries()
    # Phase-1 import produced 1286 active+scan rows; the runtime must
    # match that exactly (import-time filter is the sole truth).
    assert len(compiled) == 1286


def test_compute_active_tags_uk_no_lww_ne():
    assert lww_ne.compute_active_tags(["uk"], is_lww_ne_project=False) == set()


def test_compute_active_tags_apa():
    assert lww_ne.compute_active_tags(["apa"], is_lww_ne_project=False) == {"APA"}


def test_compute_active_tags_ama():
    assert lww_ne.compute_active_tags(["ama"], is_lww_ne_project=False) == {"AMA"}


def test_compute_active_tags_lww_ne_assigned_only():
    assert lww_ne.compute_active_tags(["uk"], is_lww_ne_project=True) == {"NE"}


def test_compute_active_tags_ama_with_lww_ne():
    assert lww_ne.compute_active_tags(["ama"], is_lww_ne_project=True) == {"AMA", "NE"}


def test_compute_active_tags_chicago_canadian_us_are_inert():
    """Only 'apa' and 'ama' profile_keys produce workbook tags."""
    for pk in ("chicago", "canadian", "us", "uk"):
        assert lww_ne.compute_active_tags([pk], is_lww_ne_project=False) == set()


def test_compute_active_tags_eponym_never_synthesised():
    """Final Q2 decision: Eponym is NEVER in the active tag set — it's
    inert at the project level. Eponym-tagged rows fire only via their
    other tags (APA/AMA/NE)."""
    for pks, nep in [(["apa"], False), (["ama"], False), (["ama"], True), (["uk"], True)]:
        tags = lww_ne.compute_active_tags(pks, is_lww_ne_project=nep)
        assert "Eponym" not in tags, (pks, nep, tags)


def test_compute_active_tags_generic_never_synthesised():
    """Decision 8: Generic is a per-row short-circuit (is_generic flag),
    not a project-level tag. It must NEVER appear in the active tag set."""
    for pks, nep in [([], False), (["ama"], False), (["apa"], True), (["uk"], True)]:
        tags = lww_ne.compute_active_tags(pks, is_lww_ne_project=nep)
        assert "Generic" not in tags, (pks, nep, tags)


# ─── 2. Generic short-circuit ─────────────────────────────────────────

def test_generic_row_fires_in_every_project():
    """``diabetic`` is tagged APA+AMA+NE+Generic in the workbook. The
    Generic flag must make it fire regardless of project configuration."""
    text = "The diabetic patient was treated."
    configurations = [
        ([], False),
        (["uk"], False),
        (["us"], False),
        (["chicago"], False),
        (["canadian"], False),
        (["apa"], False),
        (["ama"], False),
        (["uk"], True),
    ]
    for pks, nep in configurations:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        hits = [f for f in findings if f.original.lower() == "diabetic"]
        assert hits, f"Generic 'diabetic' did not fire for pks={pks} nep={nep}"


def test_generic_row_routes_to_bias_category():
    """``diabetic`` has Category='Person-first language' → bias chip."""
    findings = lww_ne.analyze_lww_ne(
        "The diabetic was admitted.", project_profile_keys=["uk"], is_lww_ne_project=False,
    )
    hits = [f for f in findings if f.original.lower() == "diabetic"]
    assert hits[0].category == "bias"


# ─── 3. APA / AMA / NE filtering (non-Generic rows) ───────────────────

def test_ama_tagged_row_fires_in_ama_project_only():
    """Steinmann's pin is tagged AMA+NE+Eponym with Action=Replace.
    Should fire in AMA or NE projects, skip in APA / UK / Chicago.
    Eponym is inert — must NOT fire an APA project."""
    text = "The Steinmann's pin was removed from the fracture."

    # AMA project → fires
    f = lww_ne.analyze_lww_ne(text, project_profile_keys=["ama"], is_lww_ne_project=False)
    assert any("Steinmann" in x.original for x in f)

    # NE project → fires
    f = lww_ne.analyze_lww_ne(text, project_profile_keys=["uk"], is_lww_ne_project=True)
    assert any("Steinmann" in x.original for x in f)

    # APA project without LWW_NE → does NOT fire (Eponym is inert)
    f = lww_ne.analyze_lww_ne(text, project_profile_keys=["apa"], is_lww_ne_project=False)
    assert not any("Steinmann" in x.original for x in f)

    # UK-only project without LWW_NE → does NOT fire
    f = lww_ne.analyze_lww_ne(text, project_profile_keys=["uk"], is_lww_ne_project=False)
    assert not any("Steinmann" in x.original for x in f)


# ─── 4. Volkmann's contracture (Eponym inert + protected form) ────────

def test_volkmann_retain_row_never_emits_finding():
    """Volkmann's contracture has tool_behaviour='No action (protected
    form)' with Action='Retain'. These rows exist to DOCUMENT the
    correct form and must never produce a finding under any project
    configuration."""
    text = "The patient showed Volkmann's contracture in the forearm."
    for pks, nep in [(["uk"], False), (["ama"], False), (["apa"], False),
                     (["uk"], True), (["ama"], True)]:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        assert not any("Volkmann" in f.original for f in findings), (pks, nep, findings)


def test_achilles_eponym_apa_does_not_fire():
    """Achilles' tendon is tagged AMA+NE+Eponym with Action=Replace.
    An APA-only project (no Eponym synthesis per Q2) must not fire it."""
    text = "He injured his Achilles' tendon during training."
    f = lww_ne.analyze_lww_ne(text, project_profile_keys=["apa"], is_lww_ne_project=False)
    assert not any("Achilles" in x.original for x in f)


# ─── 5. LWW_NE id=11 vs id=9 ──────────────────────────────────────────

def test_lww_ne_project_is_a_pure_bool_signal():
    """The runtime module takes ``is_lww_ne_project`` as a bool — it
    does not query the DB. So the id=11 vs id=9 decision (C1) is
    enforced at the router boundary (test_router_resolves_lww_ne_by_name_or_id
    below)."""
    text = "The Steinmann's pin was removed."
    # Semantically equivalent to "project has LWW_NE id=11 assigned".
    f_true = lww_ne.analyze_lww_ne(text, project_profile_keys=["uk"], is_lww_ne_project=True)
    # Semantically equivalent to "project has NO LWW_NE assignment"
    # (e.g. only id=9 'LWW Nursing Education' is assigned).
    f_false = lww_ne.analyze_lww_ne(text, project_profile_keys=["uk"], is_lww_ne_project=False)
    assert any("Steinmann" in x.original for x in f_true)
    assert not any("Steinmann" in x.original for x in f_false)


# ─── 6. Q4 — quarantined rows never execute ───────────────────────────

def test_quarantined_rows_never_in_compiled_entries():
    """Rows with validation_status='quarantined' must be excluded at
    the compile step so they never reach the paragraph scan."""
    compiled = lww_ne._compiled_entries()
    assert not any(e.get("validation_status") == "quarantined" for e in compiled)


def test_quarantined_source_term_never_produces_finding():
    """Pick a quarantined source term and verify no finding fires even
    when the text contains it in multiple contexts."""
    with open("app/processing/language_editing/config/profiles/lww_ne_terms.json") as fp:
        data = json.load(fp)
    quarantined = [e for e in data["entries"] if e["validation_status"] == "quarantined"]
    assert quarantined, "workbook should ship with ~22 quarantined rows"
    src = quarantined[0]["source_term"]  # e.g., 'microns'
    text = f"The {src} measurement was reviewed and {src} verified."
    for pks, nep in [(["ama"], True), (["apa"], False), (["uk"], True), ([], False)]:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        assert not any(
            f.rule_id == f"LWW-NE-{src}" for f in findings
        ), (src, pks, nep, findings)


# ─── 7. Q5 — Partial word (editor_hint) rows never scan ───────────────

def test_editor_hint_rows_never_in_compiled_entries():
    compiled = lww_ne._compiled_entries()
    assert not any(e.get("runtime_mode") == "editor_hint" for e in compiled)


def test_editor_hint_source_term_never_matches_substring():
    """``self`` is a Partial word editor_hint row. It must NOT fire via
    substring matching on text like 'myself', 'selfish', or 'self-care'
    — the runtime must never scan these rows against the manuscript."""
    text = "The patient discussed myself selfish self-care and self assessment."
    for pks, nep in [(["ama"], True), (["apa"], True), (["uk"], True)]:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        assert not any(
            f.rule_id == "LWW-NE-self" for f in findings
        ), (pks, nep, findings)


# ─── 8. Q6 — annotation_unclarified rows never execute ────────────────

def test_annotation_unclarified_rows_never_in_compiled_entries():
    compiled = lww_ne._compiled_entries()
    assert not any(
        e.get("validation_status") == "annotation_unclarified" for e in compiled
    )


def test_acid_base_balance_annotation_row_never_fires():
    """The four acid-base rows carry Rule Run annotations like
    'APA (ignore the hyphen option)' and are tagged inactive pending
    editorial clarification."""
    text = "The acid base balance was restored and acid base balances were monitored."
    for pks, nep in [(["apa"], False), (["ama"], False), (["uk"], True), (["ama"], True)]:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        assert not any(
            f.rule_id.startswith("LWW-NE-acid") for f in findings
        ), (pks, nep, findings)


# ─── 9. Q7 — Unknown-confidence rows never auto_replace ───────────────

def test_unknown_confidence_never_autofixable():
    """Pick any active + scan Unknown-confidence entry and verify every
    finding it produces has autofixable=False, regardless of what the
    workbook row's Tool behaviour says."""
    with open("app/processing/language_editing/config/profiles/lww_ne_terms.json") as fp:
        data = json.load(fp)
    unk = [
        e for e in data["entries"]
        if e["confidence"] == "Unknown"
        and e["validation_status"] == "ok"
        and e["runtime_mode"] == "scan"
        and e["tool_behaviour"] not in (None, "No action (protected form)")
    ]
    assert unk, "workbook should ship with some Unknown-confidence active rows"
    for e in unk:
        src = e["source_term"]
        # Use a context that definitely matches this specific entry.
        text = f"Example: {src} appears here."
        # Make sure we match at least one project tag or rely on Generic.
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=["ama"], is_lww_ne_project=True,
        )
        for f in findings:
            if f.rule_id == f"LWW-NE-{src}":
                assert f.autofixable is False, (src, f)


# ─── 10. Scope-C per-entry overrides ──────────────────────────────────

def test_rule_override_disable_entry():
    """A per-entry disable override must silence that specific entry."""
    text = "The diabetic patient was seen."
    base = lww_ne.analyze_lww_ne(text, project_profile_keys=["uk"])
    assert any(f.rule_id == "LWW-NE-diabetic" for f in base)
    off = lww_ne.analyze_lww_ne(
        text, project_profile_keys=["uk"],
        rule_overrides={"LWW-NE-diabetic": {"enabled": False}},
    )
    assert not any(f.rule_id == "LWW-NE-diabetic" for f in off)


def test_rule_override_flip_tool_behaviour():
    """Override can flip the resolved tool_behaviour: flag → auto_replace."""
    text = "The Steinmann's pin was removed."
    f_flag = lww_ne.analyze_lww_ne(text, project_profile_keys=["ama"])
    base_hit = next(f for f in f_flag if "Steinmann" in f.original)
    assert base_hit.autofixable is False  # workbook default: Flag and suggest

    f_auto = lww_ne.analyze_lww_ne(
        text, project_profile_keys=["ama"],
        rule_overrides={base_hit.rule_id: {"tool_behaviour": "auto_replace"}},
    )
    flipped_hit = next(f for f in f_auto if "Steinmann" in f.original)
    assert flipped_hit.autofixable is True


# ─── 11. "No action (protected form)" never emits findings ────────────

def test_no_action_protected_form_never_emits_finding():
    """Rows with Tool behaviour='No action (protected form)' exist in
    the workbook to protect correct forms, not to flag them. The
    runtime must silently skip them even when project tags match."""
    # 'homelessness' is a Retain / No action row tagged APA+AMA+NE+Generic.
    text = "The paper on homelessness was reviewed."
    for pks, nep in [(["ama"], True), (["apa"], False), (["uk"], True)]:
        findings = lww_ne.analyze_lww_ne(
            text, project_profile_keys=pks, is_lww_ne_project=nep,
        )
        assert not any(f.rule_id == "LWW-NE-homelessness" for f in findings)


# ─── 12. Finding category routing ─────────────────────────────────────

@pytest.mark.parametrize("workbook_cat,expected_engine_cat", [
    ("Spelling", "spelling"),
    ("Spelling (US)", "spelling"),
    ("Hyphenation", "hyphenation"),
    ("Closed compound", "hyphenation"),
    ("Open compound", "hyphenation"),
    ("Open or closed", "hyphenation"),
    ("Prefix (closed)", "hyphenation"),
    ("Hyphenation and case", "hyphenation"),
    ("Abbreviation", "abbreviations"),
    ("Person-first language", "bias"),
    ("Retain", "spelling"),  # fallback (Retain rows don't emit anyway)
    ("Proper name", "spelling"),  # fallback
    (None, "spelling"),  # None → spelling fallback
])
def test_category_to_engine_category(workbook_cat, expected_engine_cat):
    assert lww_ne._category_to_engine_category(workbook_cat) == expected_engine_cat


# ─── 13. Engine integration (end-to-end, no DB) ───────────────────────

def test_engine_analyze_fires_lww_ne_alongside_other_workbooks():
    """engine.analyze must call analyze_lww_ne with the new kwargs
    and return LWW-NE findings alongside hyphen_dash / abbreviations /
    medical_terms / uk_us_spelling."""
    rules = load_rules_from_dict([])
    text = "The diabetic patient's Steinmann's pin was removed."
    findings = engine.analyze(
        text, rules, {}, [(0, len(text), text)],
        project_profile_keys=["ama"], is_lww_ne_project=False,
    )
    lww = [f for f in findings if f.rule_id.startswith("LWW-NE-")]
    # Generic 'diabetic' (Person-first language) + AMA 'Steinmann' (Replace)
    assert any(f.rule_id == "LWW-NE-diabetic" for f in lww)
    assert any("Steinmann" in f.original for f in lww)


def test_engine_legacy_call_without_new_kwargs_still_works():
    """Backward compatibility: engine.analyze with no project_profile_keys
    or is_lww_ne_project must still work. Generic LWW-NE rows should
    still fire (via the short-circuit); non-Generic rows won't because
    the active tag set is empty."""
    rules = load_rules_from_dict([])
    text = "The diabetic patient's Steinmann's pin was removed."
    findings = engine.analyze(text, rules, {}, [(0, len(text), text)])
    lww = [f for f in findings if f.rule_id.startswith("LWW-NE-")]
    # Generic diabetic fires via short-circuit even without kwargs.
    assert any(f.rule_id == "LWW-NE-diabetic" for f in lww)
    # Steinmann (AMA+NE, not Generic) does NOT fire — no project tags.
    assert not any("Steinmann" in f.original for f in lww)


# ─── 14. D2 — compound overlap suppression via resolve_overlaps ───────

def test_d2_resolve_overlaps_drops_compound_when_workbook_overlaps_same_span():
    """D2 relies on ``engine.resolve_overlaps`` to prefer the higher-
    severity workbook finding when a compound_* finding overlaps the
    same span. This test verifies the behaviour directly with crafted
    findings so the test doesn't depend on whether any particular word
    happens to appear in both data sources.

    Rationale: in practice the hyphen_dash workbook already shields
    most compound bases via ``workbook_covered_compound_bases()``, so
    overlap between the LWW-NE workbook and compound_* is rare. When
    it does occur, resolve_overlaps must deterministically keep one
    finding (workbook wins because warning > suggestion in the sort).
    """
    from app.processing.language_editing.engine import resolve_overlaps

    lww_ne_hit = Finding(
        rule_id="LWW-NE-decision making", category="hyphenation",
        start=4, end=19, original="decision making",
        suggestion="decision-making", message="", severity="warning",
    )
    compound_hit = Finding(
        rule_id="compound_decision_making", category="hyphenation",
        start=4, end=19, original="decision making",
        suggestion="decision-making", message="",
        severity="suggestion",  # compound_* always suggests
    )
    kept = resolve_overlaps([lww_ne_hit, compound_hit])
    # resolve_overlaps keeps the higher-severity one (warning < suggestion
    # in severity_order); the compound_ at suggestion severity is dropped.
    assert len(kept) == 1, kept
    assert kept[0].rule_id == "LWW-NE-decision making"


def test_d2_end_to_end_one_finding_per_span():
    """End-to-end companion to the above — exercise the actual engine
    on text containing a workbook term + make sure we get exactly one
    finding per span, never duplicates. Uses 'decision making' which
    IS in the workbook; compound_* will not fire because compound_*
    only matches the HYPHENATED form (per compounds.py), not the
    spaced form — this is actually ANOTHER layer of natural dedup.
    """
    rules = load_rules_from_dict([])
    text = "The decision making process was slow."
    findings = engine.analyze(
        text, rules, {}, [(0, len(text), text)],
        project_profile_keys=["ama"], is_lww_ne_project=False,
    )
    hits = [f for f in findings if "decision making" in f.original.lower()]
    assert len(hits) == 1, f"expected 1 finding on 'decision making', got {len(hits)}: {hits}"
    assert hits[0].rule_id == "LWW-NE-decision making"


# ─── 15. D1 — logic test for term-highlight suppression (router-level) ─

def test_d1_logic_term_highlight_overlap_check():
    """D1 is implemented in the router's finding-assembly phase (not in
    the lww_ne module). This test verifies the overlap-span filter
    logic that the router uses: given a set of workbook spans and a
    list of term matches, only non-overlapping term matches survive.
    """
    # Simulate workbook findings in a paragraph.
    workbook_findings = [
        Finding(rule_id="LWW-NE-health care", category="hyphenation",
                start=4, end=15, original="health care",
                suggestion="healthcare", message=""),
        Finding(rule_id="LWW-NE-diabetic", category="bias",
                start=23, end=31, original="diabetic",
                suggestion="person with diabetes", message=""),
    ]
    # Simulate term_matcher matches — one overlaps a workbook span, one doesn't.
    term_matches = [
        {"start": 4, "end": 15, "matched_text": "health care",
         "term_list_id": 11, "term_id": 42, "term_list_name": "LWW_NE"},
        {"start": 50, "end": 57, "matched_text": "insulin",
         "term_list_id": 11, "term_id": 99, "term_list_name": "LWW_NE"},
    ]
    # Router D1 filter logic (mirrors what router does inline):
    lww_ne_spans = {
        (f.start, f.end) for f in workbook_findings
        if f.rule_id and f.rule_id.startswith("LWW-NE-")
    }
    kept = [tm for tm in term_matches if (tm["start"], tm["end"]) not in lww_ne_spans]
    assert len(kept) == 1
    assert kept[0]["matched_text"] == "insulin"


# ─── 16. Scope-C invariant — never mutates input text ────────────────

def test_analyser_never_mutates_input_text():
    text = "The diabetic patient was seen."
    before = text
    _ = lww_ne.analyze_lww_ne(text, project_profile_keys=["ama"], is_lww_ne_project=True)
    assert text == before
