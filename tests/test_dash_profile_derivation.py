"""Regression tests for the ``profile_keys`` → ``dash_profile`` mapping.

Background
----------
The Rules UI only saves ``profile_keys`` (editorial styles like
``apa`` / ``ama`` / ``chicago`` / ``uk`` / ``us`` / ``canadian``). The
hyphenation engine runs under a separate ``dash_profile`` axis
(``mw_dictionary`` / ``chicago_ama_apa``) and before this fix the two
were disconnected: picking "Chicago" in the UI left ``dash_profile``
stuck at the backward-compat default ``"all"`` so Chicago-specific
en-dash rules (risk-benefit, dose-response, joint eponyms) never
flagged correctly.

The derivation lives in ``language_rule_service.py`` and fires in
three places:

  1. ``derive_dash_profile_from_profile_keys`` — the pure helper.
  2. ``save_project_language_rules`` — persist the derived value on save.
  3. ``get_project_language_rules`` — on read, upgrade legacy sidecars
     whose persisted value is the default ``"all"`` so projects
     benefit without having to resave.

Precedence rule (product decision; documented alongside the helper):
when both groups appear, Chicago wins because ``chicago_ama_apa`` is
a strict superset of ``mw_dictionary`` and never suppresses MW
findings.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.services.language_rule_service import (
    DEFAULT_DASH_PROFILE,
    derive_dash_profile_from_profile_keys,
    get_project_language_rules,
)


def _write_sidecar(project_code: str, payload: dict) -> None:
    """Minimal sidecar writer — bypasses the save path's FK-heavy side
    effects (auto-creates CE Support chapter, registers a files row,
    appends an audit entry) which aren't relevant to testing the
    derivation. Same helper shape as tests/test_language_rules_user_selected.py.
    """
    from app.services.language_rule_service import get_project_language_rules_path
    path = Path(get_project_language_rules_path(project_code))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


@pytest.fixture()
def _rules_path_override(monkeypatch, tmp_path):
    """Isolate the on-disk sidecar path per test. Same pattern as
    tests/test_language_rules_user_selected.py."""
    from app.services import language_rule_service as svc

    def _fake_dir(project_code: str, client_name: str = "unknown") -> str:
        d = tmp_path / project_code
        d.mkdir(parents=True, exist_ok=True)
        return str(d)

    def _fake_path(project_code: str) -> str:
        return os.path.join(_fake_dir(project_code), f"{project_code}_language_rules.json")

    monkeypatch.setattr(svc, "get_project_language_rules_dir", _fake_dir)
    monkeypatch.setattr(svc, "get_project_language_rules_path", _fake_path)
    return tmp_path


# ─── Pure helper ──────────────────────────────────────────────────

@pytest.mark.parametrize("keys,expected", [
    (["chicago"], "chicago_ama_apa"),
    (["apa"], "chicago_ama_apa"),
    (["ama"], "chicago_ama_apa"),
    (["uk"], "mw_dictionary"),
    (["us"], "mw_dictionary"),
    (["canadian"], "mw_dictionary"),
    (["APA"], "chicago_ama_apa"),       # case-insensitive
    (["US", "Chicago"], "chicago_ama_apa"),  # mixed → Chicago wins
    (["uk", "ama"], "chicago_ama_apa"),       # mixed → Chicago wins
    (["uk", "us"], "mw_dictionary"),          # all MW-group
    (["chicago", "apa"], "chicago_ama_apa"),  # all Chicago-group
    ([], None),                                 # empty → None
    (None, None),                               # no list → None
    (["unknown-style"], None),                  # unrecognised → None
    (["", "   "], None),                        # blanks → None
    (["uk", "unknown"], "mw_dictionary"),       # ignore unknown
])
def test_derive_dash_profile_mapping(keys, expected):
    """The helper never raises, never returns a value outside
    {None, 'mw_dictionary', 'chicago_ama_apa'}, and honours the
    Chicago-wins precedence when both groups are present."""
    assert derive_dash_profile_from_profile_keys(keys) == expected


# ─── Save-path derivation (via the service helper, not the
#      FK-coupled save_project_language_rules wrapper) ──────────────

def test_save_path_derivation_logic_via_helper_directly():
    """The derivation helper is the authoritative mapping; exercising
    it directly covers the save path's behaviour without touching the
    FK-coupled side effects (CE Support chapter + files row + audit
    history) that live inside ``save_project_language_rules``. The
    read-path tests below verify the sidecar round-trip end-to-end."""
    assert derive_dash_profile_from_profile_keys(["chicago", "ama"]) == "chicago_ama_apa"
    assert derive_dash_profile_from_profile_keys(["uk"]) == "mw_dictionary"
    assert derive_dash_profile_from_profile_keys(["uk", "ama"]) == "chicago_ama_apa"
    # Empty / unknown → None (caller falls back to DEFAULT_DASH_PROFILE).
    assert derive_dash_profile_from_profile_keys([]) is None
    assert derive_dash_profile_from_profile_keys(["mystery-style"]) is None


# ─── Read path: upgrade legacy ``"all"`` sidecars ─────────────────

def test_read_upgrades_legacy_all_to_derived_value(
    db_session, project_record, _rules_path_override,
):
    """A sidecar written before this fix carries ``dash_profile='all'``
    (the old hardcoded default). On read we upgrade to the value
    derived from ``profile_keys`` so projects start firing the right
    dash rules on the next analyze — no resave required."""
    _write_sidecar(project_record.project_code, {
        "project_id": project_record.id,
        "project_code": project_record.project_code,
        "profile_key": "chicago",
        "profile_keys": ["chicago"],
        "dash_profile": "all",   # legacy default
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["dash_profile"] == "chicago_ama_apa", (
        "legacy sidecar with dash_profile='all' + profile_keys=['chicago'] "
        "must be upgraded to 'chicago_ama_apa' on read"
    )


def test_read_upgrades_legacy_all_to_mw_for_uk_project(
    db_session, project_record, _rules_path_override,
):
    """Same upgrade path for an MW-group project — ``profile_keys=['uk']``
    + ``dash_profile='all'`` lifts to ``'mw_dictionary'`` on read."""
    _write_sidecar(project_record.project_code, {
        "profile_key": "uk",
        "profile_keys": ["uk"],
        "dash_profile": "all",
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["dash_profile"] == "mw_dictionary"


def test_read_preserves_admin_set_non_default_value(
    db_session, project_record, _rules_path_override,
):
    """A sidecar with an explicit non-default dash_profile (e.g. set
    by an admin via API) is NOT re-derived on read. Only the legacy
    ``"all"`` sentinel triggers the upgrade."""
    _write_sidecar(project_record.project_code, {
        "profile_key": "chicago",
        "profile_keys": ["chicago"],
        "dash_profile": "mw_dictionary",   # explicit admin choice
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["dash_profile"] == "mw_dictionary"


def test_read_fallback_when_no_sidecar_derives_from_default_profile(
    db_session, project_record, _rules_path_override,
):
    """Brand-new project with no sidecar: the fallback config returns
    ``profile_keys=['uk']``. The dash_profile must mirror the
    derivation so the first analyze doesn't run under a different
    profile than every subsequent save."""
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["profile_keys"] == ["uk"]
    assert cfg["dash_profile"] == "mw_dictionary"
    assert cfg["is_user_selected"] is False


# ─── Cache invalidation ────────────────────────────────────────────

def test_cache_version_covers_recent_hyphenation_fixes():
    """CACHE_VERSION must be bumped past ``v7`` so pre-fix cached jobs
    invalidate once the hyphenation + derivation changes land. The
    actual value is an opaque string — we just assert it moved."""
    from app.processing.language_editing import engine
    assert engine.CACHE_VERSION != "v7", (
        "CACHE_VERSION still reads 'v7'; Hyphenation Step-7 overlap "
        "resolver + joint-eponym surfacing + profile_keys→dash_profile "
        "derivation all change finding output and require a cache bump."
    )


def test_cache_key_changes_when_profile_keys_change(
    db_session, project_record, _rules_path_override,
):
    """rules_hash must depend on dash_profile (via profile_keys) so a
    Chicago→UK re-save forces a re-analyze instead of returning the
    old Chicago findings from cache."""
    from app.routers.language_edit import _sha256_of_rules_input

    _write_sidecar(project_record.project_code, {
        "profile_key": "chicago",
        "profile_keys": ["chicago"],
        "dash_profile": "all",   # legacy default; read-path upgrades
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg_chi = get_project_language_rules(db_session, project_id=project_record.id)
    hash_chi = _sha256_of_rules_input(cfg_chi, assigned_term_list_ids=[])
    assert cfg_chi["dash_profile"] == "chicago_ama_apa"

    _write_sidecar(project_record.project_code, {
        "profile_key": "uk",
        "profile_keys": ["uk"],
        "dash_profile": "all",   # legacy default; read-path upgrades
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg_uk = get_project_language_rules(db_session, project_id=project_record.id)
    hash_uk = _sha256_of_rules_input(cfg_uk, assigned_term_list_ids=[])
    assert cfg_uk["dash_profile"] == "mw_dictionary"

    assert hash_chi != hash_uk, (
        "rules_hash must change when the derived dash_profile changes — "
        "otherwise the analyze endpoint would return cached Chicago "
        "findings for a project that just switched to UK"
    )


# ─── End-to-end: Kaplan-Meier engine behaviour under each path ───

def test_kaplan_meier_fires_under_chicago_derived_profile(
    db_session, project_record, _rules_path_override,
):
    """Integration smoke test: persist Chicago, read back the derived
    dash_profile, and confirm the hyphenation engine emits
    EN-0039 (Kaplan-Meier) with the en-dash autofix suggestion."""
    from app.processing.language_editing import hyphen_dash

    _write_sidecar(project_record.project_code, {
        "profile_key": "chicago",
        "profile_keys": ["chicago", "apa"],
        "dash_profile": "all",   # legacy; read-path derives
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["dash_profile"] == "chicago_ama_apa"

    text = "The Kaplan-Meier survival estimate was reported."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile=cfg["dash_profile"])
    km = [f for f in findings if f.original == "Kaplan-Meier"]
    assert len(km) == 1
    assert km[0].suggestion == "Kaplan–Meier"
    assert km[0].autofixable is True
    assert km[0].category == "hyphenation"


def test_kaplan_meier_not_flagged_under_uk_derived_profile(
    db_session, project_record, _rules_path_override,
):
    """Under ``mw_dictionary`` (derived from ``uk`` / ``us`` /
    ``canadian``) the MW headword is the hyphen form — so
    ``Kaplan-Meier`` is already correct and no autofix fires on the
    hyphen surface."""
    from app.processing.language_editing import hyphen_dash

    _write_sidecar(project_record.project_code, {
        "profile_key": "uk",
        "profile_keys": ["uk"],
        "dash_profile": "all",   # legacy; read-path derives
        "rules": [],
        "variant_to_canonical": {},
    })
    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["dash_profile"] == "mw_dictionary"

    text = "The Kaplan-Meier survival estimate was reported."
    findings = hyphen_dash.analyze_hyphen_dash(text, dash_profile=cfg["dash_profile"])
    hyphen_hits = [f for f in findings if f.original == "Kaplan-Meier"]
    assert hyphen_hits == [], (
        "Under mw_dictionary the hyphen form of Kaplan-Meier is correct "
        "per the MW headword and must not be flagged"
    )
