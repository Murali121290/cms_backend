"""Create stylesheet -> CE support/Style sheet template/stylesheet.json -> Technical Review sync.

The canonical stylesheet.json always describes the ACTIVE stylesheet; a hand edit to it
updates that stylesheet; a deleted stylesheet is never re-created from a leftover file.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app import schemas_v2
from app.domains.projects.models import Project
from app.services import stylesheet_service as svc

FIXTURE = Path(__file__).parent / "fixtures" / "springer_style_sheet_july2026.docx"


@pytest.fixture()
def project(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "UPLOADS_DIR", tmp_path / "uploads")
    p = Project(project_title="Round-trip Book", project_code="RT-01", client_name="Springer Publishing Company")
    db_session.add(p)
    db_session.commit()
    return p


def _dir(tmp_path) -> Path:
    return tmp_path / "uploads" / "Springer Publishing Company" / "RT-01" / "CE support" / "Style sheet template"


def _canonical(tmp_path) -> dict | None:
    path = _dir(tmp_path) / "stylesheet.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _create(db, project, name, option):
    return svc.create_stylesheet(
        db, project_id=project.id, name=name, description=None,
        selected_ia_rows=[schemas_v2.IARow(element="Percent", subtype="General", pattern="%")],
        created_by_id=None, ce_rules={"6": {"option": option}}, style_profile={"publisher": "test"},
    )


def test_canonical_json_follows_the_active_stylesheet(db_session, project, tmp_path):
    a = _create(db_session, project, "Style A", 1)
    assert (_dir(tmp_path) / "Style_A_stylesheet.json").exists()
    assert _canonical(tmp_path) is None  # inactive: canonical not written

    svc.activate_stylesheet(db_session, stylesheet_id=a.id, project_id=project.id)
    data = _canonical(tmp_path)
    assert data["id"] == a.id and data["format"] == svc.STYLESHEET_JSON_FORMAT and data["content_hash"]

    b = _create(db_session, project, "Style B", 3)
    svc.update_stylesheet(db_session, stylesheet_id=b.id, project_id=project.id, name=None, description=None,
                          selected_ia_rows=None, ce_rules={"6": {"option": 4}})
    assert _canonical(tmp_path)["id"] == a.id  # saving an inactive stylesheet leaves it alone

    active = svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id)
    assert active.id == a.id
    assert json.loads(active.ce_rules)["6"]["option"] == 1  # B never leaked into A


def test_hand_edited_json_updates_the_active_stylesheet(db_session, project, tmp_path):
    a = _create(db_session, project, "Style A", 1)
    svc.activate_stylesheet(db_session, stylesheet_id=a.id, project_id=project.id)

    path = _dir(tmp_path) / "stylesheet.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["ce_rules"]["6"]["option"] = 3  # editor changes R6 to "25 percent" in the file
    path.write_text(json.dumps(data), encoding="utf-8")

    active = svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id)
    assert active.id == a.id
    assert json.loads(active.ce_rules)["6"]["option"] == 3
    refreshed = _canonical(tmp_path)
    assert refreshed["ce_rules"]["6"]["option"] == 3
    assert refreshed["content_hash"] == svc._stylesheet_hash(active)  # re-written: no repeat sync

    # An unchanged file does not touch the stylesheet again
    before = active.updated_at
    assert svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id).updated_at == before


def test_deleted_stylesheet_is_not_recreated(db_session, project, tmp_path):
    a = _create(db_session, project, "Style A", 1)
    svc.activate_stylesheet(db_session, stylesheet_id=a.id, project_id=project.id)
    assert _canonical(tmp_path)["id"] == a.id

    svc.delete_stylesheet(db_session, stylesheet_id=a.id, project_id=project.id)
    assert _canonical(tmp_path) is None
    assert svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id) is None


def test_leftover_canonical_file_of_deleted_stylesheet_is_set_aside(db_session, project, tmp_path):
    folder = _dir(tmp_path)
    folder.mkdir(parents=True)
    (folder / "stylesheet.json").write_text(json.dumps({"id": 999, "name": "Old", "ce_rules": {"6": {"option": 2}}}),
                                            encoding="utf-8")
    assert svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id) is None
    assert not (folder / "stylesheet.json").exists()
    assert (folder / "stylesheet.orphan-999.json").exists()
    assert svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id) is None  # stays ignored


def test_json_without_id_is_imported_when_no_stylesheet_is_active(db_session, project, tmp_path):
    folder = _dir(tmp_path)
    folder.mkdir(parents=True)
    (folder / "stylesheet.json").write_text(
        json.dumps({"name": "Hand made", "ce_rules": {"6": {"option": 2}}, "selected_ia_rows": []}), encoding="utf-8")
    active = svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id)
    assert active is not None and active.is_active and active.name == "Hand made"
    assert json.loads(active.ce_rules)["6"]["option"] == 2
    assert _canonical(tmp_path)["id"] == active.id


def test_invalid_json_is_ignored(db_session, project, tmp_path):
    folder = _dir(tmp_path)
    folder.mkdir(parents=True)
    (folder / "stylesheet.json").write_text(json.dumps({"name": "Bad", "ce_rules": {"6": {"severity": "Huge"}}}),
                                            encoding="utf-8")
    assert svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id) is None


def test_docx_style_sheet_in_ce_support_is_imported(db_session, project, tmp_path):
    folder = _dir(tmp_path).parent  # CE support
    folder.mkdir(parents=True)
    shutil.copy(FIXTURE, folder / "Springer_Style_Sheet.docx")
    active = svc.sync_stylesheet_from_ce_support(db_session, project_id=project.id)
    assert active is not None and active.is_active
    rules = json.loads(active.ce_rules)
    assert rules["6"]["option"] == 1 and rules["5"]["option"] == 2 and rules["8"]["option"] == 2
    assert json.loads(active.style_profile).get("word_replacements")
