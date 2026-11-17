"""Regression tests for the ``is_user_selected`` flag on the Language
Rules response.

Background: the Language Review page renders an editorial-style badge
beside the filename (APA / AMA / UK / US / NE / …). Per the spec
"If no style is selected, do not display a misleading badge", the
backend must distinguish between:

  * A profile the reviewer / PM explicitly saved on the project
    (sidecar JSON on disk) → ``is_user_selected: True``
  * The fallback UK profile the engine uses when no selection exists
    (so rule execution still works) → ``is_user_selected: False``

Without this flag the frontend can only see "profile_key=uk" and
cannot tell "the reviewer picked UK" from "nobody picked anything".
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture()
def _rules_path_override(monkeypatch, tmp_path):
    """Redirect the on-disk CE support sidecar path so each test gets a
    clean, isolated location. The real path lives under
    ``${UPLOADS_DIR}/<client>/<project_code>/CE support/Style sheet
    template/<project_code>_language_rules.json`` — too much nesting
    to replicate per test; we just stub both helpers to put the file
    directly under ``tmp_path`` keyed by project_code.
    """
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


def test_is_user_selected_false_when_no_sidecar_exists(
    db_session, project_record, _rules_path_override,
):
    """New project with no saved Rules Page selection — the fallback
    UK profile is returned so the engine keeps working, but the flag
    is False so the UI knows not to render a badge."""
    from app.services.language_rule_service import get_project_language_rules

    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["is_user_selected"] is False, (
        "Fallback profile must advertise is_user_selected=False so the "
        "Language Review badge is suppressed when no editorial style is "
        "actually selected"
    )
    # Engine still gets a usable config to analyze against.
    assert cfg.get("profile_key") == "uk"
    assert cfg.get("profile_keys") == ["uk"]


def _write_sidecar(project_code: str, payload: dict) -> None:
    """Write a minimal valid sidecar JSON at the path the service reads
    from. The real save path has heavier side effects (creates a CE
    Support chapter, registers a files row, appends an audit entry)
    that aren't relevant to testing the ``is_user_selected`` signal —
    the only thing that matters here is "a parseable JSON file exists
    at the expected location".
    """
    import json
    from app.services.language_rule_service import get_project_language_rules_path
    from pathlib import Path

    path = Path(get_project_language_rules_path(project_code))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_is_user_selected_true_after_save(
    db_session, project_record, _rules_path_override,
):
    """After the reviewer saves a selection on the Rules page the
    sidecar JSON exists on disk, and the next read must flip the flag
    to True so the badge renders."""
    from app.services.language_rule_service import get_project_language_rules

    _write_sidecar(project_record.project_code, {
        "profile_key": "apa",
        "profile_keys": ["apa"],
        "name": "APA Publication Style",
        "rules": [],
    })

    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["is_user_selected"] is True, (
        "A saved sidecar JSON means the reviewer made an explicit "
        "selection — the badge must render"
    )
    # Profile data round-trips so the badge label can derive from it.
    assert cfg.get("profile_keys") == ["apa"]


def test_is_user_selected_true_for_multiple_profiles(
    db_session, project_record, _rules_path_override,
):
    """Multiple selected profiles must survive the round-trip in
    ``profile_keys`` so the badge can render them as e.g. "APA · NE"
    per the spec ("If multiple styles are selected … display them
    accurately rather than arbitrarily choosing one")."""
    from app.services.language_rule_service import get_project_language_rules

    _write_sidecar(project_record.project_code, {
        "profile_key": "apa",
        "profile_keys": ["apa", "canadian"],
        "name": "APA Publication Style",
        "rules": [],
    })

    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["is_user_selected"] is True
    assert cfg.get("profile_keys") == ["apa", "canadian"]


def test_is_user_selected_false_when_sidecar_is_corrupt(
    db_session, project_record, _rules_path_override,
):
    """A corrupt sidecar (invalid JSON) falls back to UK defaults —
    and the flag must be False so the UI doesn't show a misleading
    badge based on partially-read state."""
    from app.services.language_rule_service import (
        get_project_language_rules,
        get_project_language_rules_path,
    )

    # Write garbage at the exact path the service reads from.
    path = Path(get_project_language_rules_path(project_record.project_code))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{this is not valid json")

    cfg = get_project_language_rules(db_session, project_id=project_record.id)
    assert cfg["is_user_selected"] is False
    assert cfg.get("profile_key") == "uk"
