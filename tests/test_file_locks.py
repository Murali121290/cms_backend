"""Download-with-lock / check-in, editor locks, admin release and time tracking (app.domains.files.lock_service)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app import models
from app.domains.files import lock_service
from app.domains.workflow.models import ChapterInfo, StageDetail


@pytest.fixture()
def world(db_session, tmp_path, docx_factory):
    db = db_session
    db.execute(text("INSERT INTO stage_master (stage_name, description, roles, active_status) "
                    "VALUES ('Copyediting', 'Copyediting', '[\"Copyeditor\"]', 1)"))
    db.commit()
    from app.domains.projects.models import Project
    project = Project(code="P1", title="Book", client_name="CUP", xml_standard="NLM", status="Planning")
    db.add(project)
    people = {
        "emp": models.User(username="ce_priya", email="priya@example.com", password_hash="x", role="Copyeditor", team="Editorial"),
        "emp2": models.User(username="ce_david", email="david@example.com", password_hash="x", role="Copyeditor", team="Editorial"),
        "admin": models.User(username="boss", email="boss@example.com", password_hash="x", role="Admin", access_level="Admin"),
    }
    db.add_all(people.values())
    db.commit()
    chapter = ChapterInfo(client="CUP", project="P1", chapters="Ch01", chapter_title="Chapter 1", workflow="WF",
                          stage_name="Copyediting",
                          status="In-progress", current_assignee_name="ce_priya")
    db.add(chapter)
    db.commit()
    sd = StageDetail(client="CUP", project="P1", chapters="Ch01", stage_name="Copyediting", workflow="WF",
                     stage_status="In-progress", assignee_name="ce_priya", custody_status="in_progress")
    db.add(sd)
    path = docx_factory(tmp_path / "uploads" / "P1" / "Ch01" / "Manuscript" / "ch01.docx", ["Original text"])
    f = models.File(project_id=project.id, chapter_id=chapter.id, filename="ch01.docx", file_type="docx",
                    category="Manuscript", path=str(path), version=3)
    db.add(f)
    db.commit()
    return {"db": db, "project": project, "chapter": chapter, "stage": sd, "file": f, **people}


@pytest.fixture()
def as_user(auth_cookie_client):
    return lambda u: auth_cookie_client(u)


def _fresh(db, obj):
    db.expire_all()
    return db.get(type(obj), obj.id)


# ── download with lock / check-in ─────────────────────────────────────────────

def test_download_with_lock_blocks_others_and_checkin_releases(world, as_user, docx_factory, tmp_path):
    fid = world["file"].id
    emp, admin = as_user(world["emp"]), as_user(world["admin"])

    r = emp.post(f"/api/v2/files/{fid}/download-with-lock")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lock"]["is_checked_out"] and body["lock"]["lock_kind"] == "download"
    assert body["lock"]["locked_by_me"] is True
    assert body["session"]["stage_name"] == "Copyediting" and body["session"]["from_version"] == 3

    # Taking it again is idempotent for the holder; anyone else gets 409 with the holder's name.
    assert emp.post(f"/api/v2/files/{fid}/download-with-lock").json()["session"]["id"] == body["session"]["id"]
    r = admin.post(f"/api/v2/files/{fid}/download-with-lock")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "LOCKED_BY_OTHER"
    assert r.json()["detail"]["lock_kind"] == "download"

    # Nobody else can replace, delete or check in while it is locked.
    new_doc = docx_factory(tmp_path / "edited.docx", ["Edited text"])
    with open(new_doc, "rb") as fh:
        data = fh.read()
    assert admin.post(f"/api/v2/files/{fid}/replace", files={"file": ("ch01.docx", data)},
                      data={"reason": "overwrite"}).status_code == 409
    assert admin.delete(f"/api/v2/files/{fid}").status_code == 409
    assert admin.post(f"/api/v2/files/{fid}/checkin", files={"file": ("ch01.docx", data)}).status_code == 409

    # The holder checks in: new version, time recorded, lock released, history on the stage.
    r = emp.post(f"/api/v2/files/{fid}/checkin", files={"file": ("my-edit.docx", data)}, data={"note": "CE done"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["version"] == 4
    assert out["session"]["end_reason"] == "checked_in"
    assert out["session"]["to_version"] == 4 and out["session"]["duration_seconds"] >= 0
    assert out["lock"]["is_checked_out"] is False

    db = world["db"]
    f = _fresh(db, world["file"])
    assert f.version == 4 and not f.is_checked_out and f.lock_kind is None
    assert db.query(models.FileVersion).filter_by(file_id=fid, version_num=3).count() == 1
    sd = _fresh(db, world["stage"])
    events = [e for e in (sd.history or []) if e.get("type") == "file_lock"]
    assert events and events[-1]["end_reason"] == "checked_in" and events[-1]["to_version"] == 4


def test_checkin_requires_lock_and_matching_extension(world, as_user):
    fid = world["file"].id
    emp = as_user(world["emp"])
    r = emp.post(f"/api/v2/files/{fid}/checkin", files={"file": ("ch01.docx", b"PK..")})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_LOCKED_BY_YOU"
    emp.post(f"/api/v2/files/{fid}/download-with-lock")
    r = emp.post(f"/api/v2/files/{fid}/checkin", files={"file": ("ch01.pdf", b"%PDF")})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "EXTENSION_MISMATCH"


def test_read_only_user_cannot_lock(world, as_user):
    r = as_user(world["emp2"]).post(f"/api/v2/files/{world['file'].id}/download-with-lock")
    assert r.status_code == 403


def test_cancel_lock_records_time_without_version(world, as_user):
    fid = world["file"].id
    emp = as_user(world["emp"])
    emp.post(f"/api/v2/files/{fid}/download-with-lock")
    r = emp.post(f"/api/v2/files/{fid}/lock/cancel")
    assert r.status_code == 200
    assert r.json()["session"]["end_reason"] == "cancelled" and r.json()["session"]["to_version"] is None
    assert _fresh(world["db"], world["file"]).version == 3


def test_legacy_checkout_endpoint_opens_a_session(world, as_user):
    fid = world["file"].id
    emp = as_user(world["emp"])
    assert emp.post(f"/api/v2/files/{fid}/checkout").status_code == 200
    f = _fresh(world["db"], world["file"])
    assert f.lock_kind == "download" and f.active_lock_session_id
    assert emp.delete(f"/api/v2/files/{fid}/checkout").status_code == 200
    s = world["db"].get(models.FileLockSession, f.active_lock_session_id)
    assert s.end_reason == "cancelled"


# ── admin release ─────────────────────────────────────────────────────────────

def test_admin_force_release(world, as_user, monkeypatch):
    sent = []
    from app.domains.notifications import email_service
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw))
    fid = world["file"].id
    emp, admin = as_user(world["emp"]), as_user(world["admin"])
    emp.post(f"/api/v2/files/{fid}/download-with-lock")

    assert as_user(world["emp2"]).post(f"/api/v2/files/{fid}/lock/force-release", json={"note": "x"}).status_code == 403
    assert admin.post(f"/api/v2/files/{fid}/lock/force-release", json={"note": "  "}).status_code == 400

    locks = admin.get("/api/v2/file-locks").json()
    assert locks["is_admin"] and len(locks["locks"]) == 1 and locks["locks"][0]["can_force_release"]
    assert as_user(world["emp2"]).get("/api/v2/file-locks").json()["locks"] == []

    r = admin.post(f"/api/v2/files/{fid}/lock/force-release", json={"note": "Holder on leave"})
    assert r.status_code == 200, r.text
    s = r.json()["session"]
    assert s["end_reason"] == "admin_released" and s["release_note"] == "Holder on leave"
    assert s["released_by"] == "boss"
    assert r.json()["lock"]["is_checked_out"] is False
    assert sent and "priya@example.com" == sent[0]["to_email"]


# ── editor sessions ───────────────────────────────────────────────────────────

def test_editor_session_lock_heartbeat_and_multi_tab_close(world, as_user):
    fid = world["file"].id
    emp, admin = as_user(world["emp"]), as_user(world["admin"])

    r = emp.post(f"/api/v2/files/{fid}/editor-session", json={"kind": "editor_wysiwyg", "client_id": "tab-a"})
    assert r.status_code == 200, r.text
    sid = r.json()["session"]["id"]
    assert emp.post(f"/api/v2/files/{fid}/editor-session",
                    json={"kind": "editor_wysiwyg", "client_id": "tab-b"}).json()["session"]["id"] == sid

    r = admin.post(f"/api/v2/files/{fid}/editor-session", json={"kind": "editor_wysiwyg", "client_id": "x"})
    assert r.status_code == 409 and r.json()["detail"]["lock_kind"] == "editor_wysiwyg"

    # Someone else's in-app save is refused while the editor is open.
    r = admin.post(f"/api/v2/files/{fid}/xhtml/save", json={"html_content": "<p>x</p>"})
    assert r.status_code == 409

    assert emp.post(f"/api/v2/editor-sessions/{sid}/heartbeat?client_id=tab-a").status_code == 200
    # First tab closes: still locked. Last tab closes: released.
    emp.post(f"/api/v2/editor-sessions/{sid}/close?client_id=tab-a")
    assert _fresh(world["db"], world["file"]).is_checked_out
    r = emp.post(f"/api/v2/editor-sessions/{sid}/close?client_id=tab-b&saved=false")
    assert r.json()["session"]["end_reason"] == "editor_closed"
    assert not _fresh(world["db"], world["file"]).is_checked_out

    # A heartbeat after the lock is gone tells the editor it lost the lock.
    r = emp.post(f"/api/v2/editor-sessions/{sid}/heartbeat")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "LOCK_LOST"


def test_editor_cannot_open_over_own_download_lock(world, as_user):
    fid = world["file"].id
    emp = as_user(world["emp"])
    emp.post(f"/api/v2/files/{fid}/download-with-lock")
    r = emp.post(f"/api/v2/files/{fid}/editor-session", json={"kind": "editor_wysiwyg"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DOWNLOAD_LOCK_HELD"


def test_editor_session_by_path(world, as_user):
    emp = as_user(world["emp"])
    r = emp.post("/api/v2/editor-session/by-path", json={
        "project_id": world["project"].id, "chapter": "Ch01", "subfolder": "Manuscript",
        "filename": "ch01.docx", "kind": "editor_tinymce"})
    assert r.status_code == 200, r.text
    assert r.json()["lock"]["lock_kind"] == "editor_tinymce"
    r = emp.post("/api/v2/editor-session/by-path", json={
        "project_id": world["project"].id, "chapter": "Ch01", "filename": "nope.xml", "kind": "editor_source"})
    assert r.json()["status"] == "untracked"


def test_sweeper_closes_idle_editor_at_last_heartbeat(world):
    db, f, emp = world["db"], world["file"], world["emp"]
    s = lock_service.acquire(db, f, emp, lock_service.EDITOR_WYSIWYG)
    start = datetime.now(timezone.utc) - timedelta(minutes=40)
    s.started_at = start
    s.last_heartbeat_at = start + timedelta(minutes=15)
    db.commit()
    assert lock_service.sweep_stale_editor_sessions(db) == 1
    db.refresh(s)
    assert s.end_reason == "editor_timeout"
    assert abs(s.duration_seconds - 15 * 60) <= 1
    assert not _fresh(db, f).is_checked_out


def test_download_lock_never_expires(world):
    db, f, emp = world["db"], world["file"], world["emp"]
    s = lock_service.acquire(db, f, emp, lock_service.DOWNLOAD)
    s.started_at = s.last_heartbeat_at = datetime.now(timezone.utc) - timedelta(days=3)
    db.commit()
    assert lock_service.sweep_stale_editor_sessions(db) == 0
    assert _fresh(db, f).is_checked_out


# ── processing / custody / report ─────────────────────────────────────────────

def test_processing_lock_is_not_a_user_lock(world):
    db, f, emp = world["db"], world["file"], world["emp"]
    f.is_checked_out, f.checked_out_by_id, f.lock_kind = True, emp.id, "processing"
    db.commit()
    assert lock_service.is_locked_by_other(f, emp.id)  # even the starter can't write mid-job
    with pytest.raises(lock_service.FileLockedError):
        lock_service.acquire(db, f, emp, lock_service.DOWNLOAD)
    from app.domains.processing.service import _is_processing_locked, _release_processing_lock
    assert _is_processing_locked(f)
    f.lock_kind = "download"
    assert not _is_processing_locked(f)
    _release_processing_lock(f)
    assert f.is_checked_out  # a user's own lock survives the job


def test_custody_change_closes_locks(world):
    db, f, emp = world["db"], world["file"], world["emp"]
    lock_service.acquire(db, f, emp, lock_service.DOWNLOAD)
    from app.domains.workflow.workspace_tasks import release_chapter_locks
    assert release_chapter_locks(db, world["stage"]) == 1
    db.commit()
    s = db.query(models.FileLockSession).one()
    assert s.end_reason == "custody_change" and not _fresh(db, f).is_checked_out


def test_time_report_groups_by_stage_and_user(world, as_user):
    db, f = world["db"], world["file"]
    now = datetime.now(timezone.utc)
    db.add_all([
        models.FileLockSession(file_id=f.id, filename=f.filename, chapter_id=world["chapter"].id, user_id=world["emp"].id,
                               lock_kind="download", stage_name="Copyediting", started_at=now - timedelta(hours=3),
                               ended_at=now - timedelta(hours=2), duration_seconds=3600, end_reason="checked_in"),
        models.FileLockSession(file_id=f.id, filename=f.filename, chapter_id=world["chapter"].id, user_id=world["admin"].id,
                               lock_kind="editor_word", stage_name="Copyediting", started_at=now - timedelta(hours=1),
                               ended_at=now - timedelta(minutes=30), duration_seconds=1800, end_reason="editor_closed"),
        models.FileLockSession(file_id=f.id, filename=f.filename, chapter_id=world["chapter"].id, user_id=world["emp"].id,
                               lock_kind="download", stage_name="Pre-editing", started_at=now - timedelta(days=2),
                               ended_at=now - timedelta(days=2) + timedelta(minutes=20), duration_seconds=1200,
                               end_reason="cancelled"),
    ])
    db.commit()
    r = as_user(world["emp"]).get(f"/api/v2/projects/{world['project'].id}/chapters/{world['chapter'].id}/time-report")
    assert r.status_code == 200
    stages = {s["stage_name"]: s for s in r.json()["stages"]}
    assert stages["Copyediting"]["seconds"] == 5400 and stages["Copyediting"]["sessions"] == 2
    assert {u["user"]: u["seconds"] for u in stages["Copyediting"]["users"]} == {"ce_priya": 3600, "boss": 1800}
    assert stages["Pre-editing"]["seconds"] == 1200
    assert r.json()["total_seconds"] == 6600

    hist = as_user(world["emp"]).get(f"/api/v2/files/{f.id}/lock-sessions").json()
    assert len(hist["sessions"]) == 3


def test_file_list_reports_lock_fields(world, as_user):
    fid = world["file"].id
    emp, admin = as_user(world["emp"]), as_user(world["admin"])
    emp.post(f"/api/v2/files/{fid}/download-with-lock")
    files = admin.get(f"/api/v2/projects/{world['project'].id}/chapters/{world['chapter'].id}/files").json()
    rec = next(x for x in files["files"] if x["id"] == fid)
    assert rec["lock"]["lock_kind"] == "download" and rec["lock"]["can_force_release"] is True
    assert rec["lock"]["locked_by_me"] is False and rec["lock"]["lock_stage_name"] == "Copyediting"
