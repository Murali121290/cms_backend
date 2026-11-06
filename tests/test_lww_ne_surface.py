"""Phase 4 tests — LWW-NE workbook_rules_surface + Rules Picker wire format.

Verifies the surface functions that feed the Rules Picker GET endpoint:
  * list_lww_ne_rules(overrides) — full normalised wire payload
  * lww_ne_rule_summary(overrides) — count tuple for header stats
  * Per-row category routing (Spelling → spelling, Hyphenation → hyphenation, etc.)
  * Surface-level filtering matches runtime filter (same rows surface
    as execute — toggling a surfaced rule actually changes analyze output)
  * Scope-C override application (enabled flag + tool_behaviour flip)
"""
from __future__ import annotations

import pytest

from app.processing.language_editing import workbook_rules_surface as ws
from app.processing.language_editing import lww_ne


@pytest.fixture(autouse=True)
def _cold_cache():
    ws.clear_cache()
    lww_ne.clear_cache()
    yield
    ws.clear_cache()
    lww_ne.clear_cache()


# ─── Surface filter ≡ runtime filter ─────────────────────────────────

def test_surface_row_count_matches_runtime_compiled_entries():
    """The Rules Picker should list exactly the rows that CAN fire at
    runtime. Toggling a visible rule off must affect analyze output.
    'No action (protected form)' rows are filtered at both layers."""
    surfaced = ws.list_lww_ne_rules()
    runtime = lww_ne._compiled_entries()
    # Runtime compiled includes 'No action' rows (filtered later in
    # analyze_lww_ne); surface excludes them. Verify equal cardinality
    # after subtracting that one class.
    runtime_actionable = [
        e for e in runtime
        if (e.get("tool_behaviour") or "") != "No action (protected form)"
    ]
    assert len(surfaced) == len(runtime_actionable)


def test_surface_excludes_quarantined_annotation_editor_hint_and_no_action():
    """Surface filters applied: validation_status='ok' + runtime_mode=
    'scan' + tool_behaviour != 'No action (protected form)'. The 402
    'No action' rows inside the 1,286 active-scan bucket are hidden
    from the Rules Picker — toggling a view-only protection row would
    be meaningless.

    Runtime compiled count minus the 'No action' slice equals the
    surface count. Verify that invariant rather than hardcoding the
    exact surface total (which would drift if the workbook changes).
    """
    surfaced = ws.list_lww_ne_rules()
    runtime = lww_ne._compiled_entries()
    runtime_no_action = sum(
        1 for e in runtime
        if (e.get("tool_behaviour") or "") == "No action (protected form)"
    )
    assert len(surfaced) == len(runtime) - runtime_no_action
    # Sanity: there SHOULD be some 'No action' rows being filtered
    # (if zero, the whole filter is a no-op and the invariant is weak).
    assert runtime_no_action > 0


# ─── Wire shape per row ──────────────────────────────────────────────

def test_surface_entry_has_required_fields():
    surfaced = ws.list_lww_ne_rules()
    assert surfaced  # must not be empty
    required = {
        "id", "category", "type", "enabled", "tool_behaviour", "severity",
        "message", "source_of", "source", "suggestions", "replacement",
        "alt_suggestions", "workbook_category", "action",
        "tool_behaviour_raw", "match_type", "match_case", "confidence",
        "rule_runs_display", "rule_runs_raw", "is_generic",
        "source_badge", "source_raw",
    }
    for r in surfaced[:20]:
        missing = required - set(r.keys())
        assert not missing, (r["id"], missing)
    # source_badge is always 'LWW-NE' for these rows so the UI can
    # render a consistent provenance chip.
    assert all(r["source_badge"] == "LWW-NE" for r in surfaced)


def test_surface_id_format_matches_runtime_rule_id():
    """Surface id and runtime Finding.rule_id must match character-for-
    character so the Rules Picker's enable/disable maps 1:1 to findings."""
    surfaced = ws.list_lww_ne_rules()
    # Pick an entry that we know fires at runtime (e.g. diabetic).
    diabetic = [r for r in surfaced if r["source"] == "diabetic"]
    assert diabetic
    assert diabetic[0]["id"] == "LWW-NE-diabetic"


# ─── Category routing per workbook Category column ───────────────────

def test_surface_category_routes_to_existing_engine_categories():
    """Every surfaced row's category must be one of the existing engine
    categories (spelling / hyphenation / abbreviations / bias) — never
    a new category that the frontend doesn't know about."""
    surfaced = ws.list_lww_ne_rules()
    allowed = {"spelling", "hyphenation", "abbreviations", "bias"}
    found = {r["category"] for r in surfaced}
    assert found <= allowed, f"unexpected categories: {found - allowed}"


def test_surface_person_first_language_rows_route_to_bias():
    surfaced = ws.list_lww_ne_rules()
    pfl = [r for r in surfaced if r["workbook_category"] == "Person-first language"]
    assert pfl
    assert all(r["category"] == "bias" for r in pfl)


def test_surface_hyphenation_rows_route_to_hyphenation():
    surfaced = ws.list_lww_ne_rules()
    hyph = [r for r in surfaced if r["workbook_category"] == "Hyphenation"]
    assert hyph
    assert all(r["category"] == "hyphenation" for r in hyph)


def test_surface_closed_compound_rows_route_to_hyphenation():
    surfaced = ws.list_lww_ne_rules()
    cc = [r for r in surfaced if r["workbook_category"] == "Closed compound"]
    assert cc
    assert all(r["category"] == "hyphenation" for r in cc)


def test_surface_abbreviation_rows_route_to_abbreviations():
    surfaced = ws.list_lww_ne_rules()
    abbr = [r for r in surfaced if r["workbook_category"] == "Abbreviation"]
    assert abbr
    assert all(r["category"] == "abbreviations" for r in abbr)


def test_surface_spelling_rows_route_to_spelling():
    surfaced = ws.list_lww_ne_rules()
    sp = [r for r in surfaced if r["workbook_category"] == "Spelling"]
    assert sp
    assert all(r["category"] == "spelling" for r in sp)


# ─── Tool behaviour + severity derivation ────────────────────────────

def test_surface_unknown_confidence_never_auto_replace():
    """Q7 safety: Unknown-confidence rows must surface with
    tool_behaviour='flag' even if the workbook row has Auto-replace."""
    surfaced = ws.list_lww_ne_rules()
    unk = [r for r in surfaced if r["confidence"] == "Unknown"]
    assert unk, "surface should expose some Unknown-confidence rows"
    for r in unk:
        assert r["tool_behaviour"] == "flag", r


def test_surface_auto_replace_workbook_row_maps_to_auto():
    """A row with Tool behaviour='Auto-replace' + known confidence
    must surface with tool_behaviour='auto_replace'."""
    surfaced = ws.list_lww_ne_rules()
    auto = [r for r in surfaced
            if r["tool_behaviour_raw"] == "Auto-replace"
            and r["confidence"] != "Unknown"]
    assert auto
    for r in auto:
        assert r["tool_behaviour"] == "auto_replace", r


def test_surface_flag_only_review_is_suggestion_severity():
    surfaced = ws.list_lww_ne_rules()
    flag_only = [r for r in surfaced if r["tool_behaviour_raw"] == "Flag only (review)"]
    assert flag_only
    for r in flag_only:
        assert r["severity"] == "suggestion", r


# ─── Summary counts ──────────────────────────────────────────────────

def test_summary_matches_list_counts():
    """summary.total == len(list); summary.enabled == rows with enabled=True;
    summary.auto_replace + summary.flag == summary.enabled (one each)."""
    surfaced = ws.list_lww_ne_rules()
    summary = ws.lww_ne_rule_summary()
    assert summary["total"] == len(surfaced)
    assert summary["enabled"] == sum(1 for r in surfaced if r["enabled"])
    assert summary["auto_replace"] + summary["flag"] == summary["enabled"]


# ─── Scope-C overrides apply at surface level ────────────────────────

def test_override_disables_in_surface_and_summary():
    surfaced_base = ws.list_lww_ne_rules()
    target = next(r for r in surfaced_base if r["source"] == "diabetic")
    assert target["enabled"] is True

    overrides = {target["id"]: {"enabled": False}}
    surfaced_off = ws.list_lww_ne_rules(overrides)
    target_off = next(r for r in surfaced_off if r["source"] == "diabetic")
    assert target_off["enabled"] is False

    summary_off = ws.lww_ne_rule_summary(overrides)
    summary_base = ws.lww_ne_rule_summary()
    assert summary_off["enabled"] == summary_base["enabled"] - 1


def test_override_flip_tool_behaviour_in_surface():
    surfaced_base = ws.list_lww_ne_rules()
    # Find a flag-default row (something with action=Review for example)
    target = next(r for r in surfaced_base if r["tool_behaviour"] == "flag" and r["suggestions"])
    overrides = {target["id"]: {"tool_behaviour": "auto_replace"}}
    surfaced_flipped = ws.list_lww_ne_rules(overrides)
    target_flipped = next(r for r in surfaced_flipped if r["id"] == target["id"])
    assert target_flipped["tool_behaviour"] == "auto_replace"


# ─── Rule-run display ────────────────────────────────────────────────

def test_rule_runs_display_shows_comma_separated_tags():
    surfaced = ws.list_lww_ne_rules()
    diabetic = next(r for r in surfaced if r["source"] == "diabetic")
    # diabetic is APA + AMA + NE + Generic
    tags = {t.strip() for t in diabetic["rule_runs_display"].split(",")}
    assert {"APA", "AMA", "NE", "Generic"} <= tags


def test_is_generic_flag_preserved_in_surface():
    surfaced = ws.list_lww_ne_rules()
    diabetic = next(r for r in surfaced if r["source"] == "diabetic")
    assert diabetic["is_generic"] is True
    # Pick a non-Generic row (any AMA-only or NE-only row)
    non_generic = next(r for r in surfaced if not r["is_generic"])
    assert non_generic["is_generic"] is False
