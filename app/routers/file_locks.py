"""File locks: download-with-lock / check-in, editor sessions, admin release, time reports.

Mounted under /api/v2 (see app.main). The lock rules live in app.domains.files.lock_service.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from fastapi import APIRouter, Body, Depends, File as FastAPIFile, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import database, models
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.files import lock_service
from app.domains.workflow import access as wf_access
from app.utils.timezone import now_ist_naive

logger = logging.getLogger(__name__)
router = APIRouter()


def _require_user(user):
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "AUTH_REQUIRED", "message": "Authentication required."})
    return user


def _get_file(db: Session, file_id: int) -> models.File:
    f = db.get(models.File, file_id)
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "FILE_NOT_FOUND", "message": "File not found."})
    return f


def _lock_payload(db: Session, f: models.File, viewer) -> dict:
    from app.routers.api_v2 import _serialize_lock
    return _serialize_lock(f, db=db, viewer=viewer).model_dump(mode="json")


# ── download with lock / check-in / cancel / admin release ───────────────────

@router.post("/files/{file_id}/download-with-lock")
def download_with_lock(file_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    """Take a download lock. The client then fetches GET /files/{id}/download as usual."""
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    s = lock_service.acquire(db, f, viewer, lock_service.DOWNLOAD)
    db.refresh(f)
    return {
        "status": "ok",
        "file_id": f.id,
        "version": f.version,
        "download_url": f"/api/v2/files/{f.id}/download",
        "session": lock_service.serialize_session(db, s, viewer=viewer),
        "lock": _lock_payload(db, f, viewer),
    }


@router.post("/files/{file_id}/checkin")
async def checkin_file(
    file_id: int,
    file: UploadFile = FastAPIFile(...),
    note: Optional[str] = Form(None),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Upload the new version of a file you hold, then release the lock with the time taken."""
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    if not f.is_checked_out or f.checked_out_by_id != viewer.id or f.lock_kind == lock_service.PROCESSING:
        if f.is_checked_out:
            raise lock_service.FileLockedError(f, f.checked_out_by)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "NOT_LOCKED_BY_YOU",
            "message": "Download the file with lock before uploading a new version.",
        })
    wf_access.ensure_can_write_file(db, viewer, f)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail={"code": "EMPTY_UPLOAD", "message": "The uploaded file is empty."})
    src_ext = os.path.splitext(file.filename or "")[1].lower()
    dst_ext = os.path.splitext(f.filename or "")[1].lower()
    if src_ext and dst_ext and src_ext != dst_ext:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={
            "code": "EXTENSION_MISMATCH",
            "message": f"Upload a {dst_ext} file to replace {f.filename} (got {src_ext}).",
        })

    from app.domains.processing.service import resolve_physical_file_path
    from app.services import version_service
    from app.services.file_service import UPLOAD_DIR

    target = f.path if (f.path and os.path.isabs(f.path) and os.path.exists(f.path)) else resolve_physical_file_path(f.path, UPLOAD_DIR)
    note_clean = (note or "").strip() or None
    if target and os.path.exists(target):
        version_service.archive_existing_file(
            db, existing_file=f, base_path=os.path.dirname(target), uploaded_by_id=viewer.id,
            source_path=target, reason=("Check-in: " + note_clean) if note_clean else "Check-in",
        )
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = target + ".tmp"
    try:
        with open(tmp, "wb") as out:
            out.write(raw)
        os.replace(tmp, target)
    except Exception as exc:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        db.rollback()
        logger.error("Check-in write failed for file %s: %s", file_id, exc)
        raise HTTPException(status_code=500, detail={"code": "WRITE_FAILED", "message": f"Could not save the file: {exc}"})

    f.version = (f.version or 1) + 1
    f.uploaded_at = now_ist_naive()
    f.uploaded_by_id = viewer.id
    s = lock_service.checkin_after_upload(db, f, viewer, note=note_clean)
    db.commit()
    db.refresh(f)
    return {
        "status": "ok",
        "file_id": f.id,
        "version": f.version,
        "session": lock_service.serialize_session(db, s, viewer=viewer) if s else None,
        "lock": _lock_payload(db, f, viewer),
    }


@router.post("/files/{file_id}/lock/cancel")
def cancel_lock(file_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    s = lock_service.release(db, f, viewer, lock_service.CANCELLED)
    db.refresh(f)
    return {"status": "ok", "file_id": f.id,
            "session": lock_service.serialize_session(db, s, viewer=viewer) if s else None,
            "lock": _lock_payload(db, f, viewer)}


class ForceReleaseBody(BaseModel):
    note: str


@router.post("/files/{file_id}/lock/force-release")
def force_release(file_id: int, body: ForceReleaseBody, db: Session = Depends(database.get_db),
                  user=Depends(get_current_user_from_cookie)):
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    holder = f.checked_out_by
    s = lock_service.force_release(db, f, viewer, body.note)
    db.refresh(f)
    _notify_holder(holder, viewer, f, body.note)
    return {"status": "ok", "file_id": f.id,
            "session": lock_service.serialize_session(db, s, viewer=viewer) if s else None,
            "lock": _lock_payload(db, f, viewer)}


def _notify_holder(holder, admin, f: models.File, note: str) -> None:
    if not holder or holder.id == admin.id or not getattr(holder, "email", None):
        return
    try:
        from app.domains.notifications.email_service import send_email
        admin_name = f"{admin.first_name or ''} {admin.last_name or ''}".strip() or admin.username
        send_email(
            to_email=holder.email,
            subject=f"Your lock on {f.filename} was released",
            text_body=(f"Hi,\n\n{admin_name} released your lock on {f.filename}.\n\nReason: {note}\n\n"
                       "If you have changes you haven't uploaded yet, download the file again with lock and re-apply them.\n"),
        )
    except Exception as exc:  # pragma: no cover - SMTP is environment specific
        logger.warning("Lock release notification not sent: %s", exc)


# ── history / reports / admin list ────────────────────────────────────────────

@router.get("/files/{file_id}/lock-sessions")
def file_lock_sessions(file_id: int, db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    return {
        "file_id": f.id,
        "filename": f.filename,
        "version": f.version,
        "lock": _lock_payload(db, f, viewer),
        "sessions": [lock_service.serialize_session(db, s, viewer=viewer) for s in lock_service.file_sessions(db, f.id)],
    }


@router.get("/projects/{project_id}/chapters/{chapter_id}/time-report")
def chapter_time_report(project_id: int, chapter_id: int, db: Session = Depends(database.get_db),
                        user=Depends(get_current_user_from_cookie)):
    viewer = _require_user(user)
    report = lock_service.chapter_time_report(db, chapter_id)
    report["project_id"] = project_id
    report["active"] = [lock_service.serialize_session(db, s, viewer=viewer)
                        for s in lock_service.active_locks(db, chapter_id=chapter_id)]
    return report


@router.get("/file-locks")
def list_active_locks(
    project_id: Optional[int] = Query(None),
    chapter_id: Optional[int] = Query(None),
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Admins see every open lock; everyone else sees only their own."""
    viewer = _require_user(user)
    rows = lock_service.active_locks(db, project_id=project_id, chapter_id=chapter_id)
    is_admin = wf_access.is_admin(viewer)
    if not is_admin:
        rows = [s for s in rows if s.user_id == viewer.id]
    out = []
    projects: dict[int, Optional[str]] = {}
    for s in rows:
        item = lock_service.serialize_session(db, s, viewer=viewer)
        if s.project_id and s.project_id not in projects:
            from app.domains.projects.models import Project
            p = db.get(Project, s.project_id)
            projects[s.project_id] = (getattr(p, "code", None) or getattr(p, "project_code", None)) if p else None
        item["project_code"] = projects.get(s.project_id)
        ch = db.get(models.Chapter, s.chapter_id) if s.chapter_id else None
        item["chapter"] = ch.chapters if ch else None
        item["can_force_release"] = is_admin and s.user_id != viewer.id
        out.append(item)
    return {"is_admin": is_admin, "locks": out}


# ── editor sessions (in-app editors) ──────────────────────────────────────────

class EditorSessionBody(BaseModel):
    kind: str = lock_service.EDITOR_WYSIWYG
    client_id: Optional[str] = None


def _editor_session_response(db: Session, f: models.File, s, viewer) -> dict:
    return {
        "status": "ok",
        "file_id": f.id,
        "session": lock_service.serialize_session(db, s, viewer=viewer),
        "lock": _lock_payload(db, f, viewer),
    }


def _validate_editor_kind(kind: str) -> str:
    if kind not in lock_service.EDITOR_KINDS:
        raise HTTPException(status_code=400, detail={"code": "BAD_KIND", "message": f"Unknown editor kind {kind}."})
    return kind


@router.post("/files/{file_id}/editor-session")
def open_editor_session(file_id: int, body: EditorSessionBody = Body(default_factory=EditorSessionBody),
                        db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    """An editor opened the file: take the editor lock (or re-enter your own). 409 with the holder when locked,
    403 when the user can only read the chapter; the page then opens read-only."""
    viewer = _require_user(user)
    f = _get_file(db, file_id)
    s = lock_service.acquire(db, f, viewer, _validate_editor_kind(body.kind), client_id=body.client_id)
    db.refresh(f)
    return _editor_session_response(db, f, s, viewer)


class EditorSessionByPathBody(EditorSessionBody):
    project_id: int
    chapter: str
    chapter_id: Optional[int] = None
    subfolder: Optional[str] = None
    filename: str


@router.post("/editor-session/by-path")
def open_editor_session_by_path(body: EditorSessionByPathBody, db: Session = Depends(database.get_db),
                                user=Depends(get_current_user_from_cookie)):
    """Same as /files/{id}/editor-session for pages that address files by folder path (chapter editor)."""
    viewer = _require_user(user)
    from app.domains.projects.models import Project
    from app.routers.web import _resolve_chapter
    project = db.get(Project, body.project_id)
    chapter = _resolve_chapter(db, project=project, chapter_name=body.chapter, chapter_id=body.chapter_id) if project else None
    f = None
    if chapter:
        f = db.query(models.File).filter(
            models.File.project_id == body.project_id,
            models.File.chapter_id == chapter.id,
            models.File.filename == body.filename,
        ).first()
    if not f:
        # Not a tracked file (generated output with no files row): nothing to lock.
        return {"status": "untracked", "file_id": None, "session": None, "lock": None}
    s = lock_service.acquire(db, f, viewer, _validate_editor_kind(body.kind), client_id=body.client_id)
    db.refresh(f)
    return _editor_session_response(db, f, s, viewer)


@router.post("/editor-sessions/{session_id}/heartbeat")
def editor_heartbeat(session_id: int, client_id: Optional[str] = Query(None), db: Session = Depends(database.get_db),
                     user=Depends(get_current_user_from_cookie)):
    viewer = _require_user(user)
    s = lock_service.heartbeat(db, session_id, viewer, client_id=client_id)
    return {"status": "ok", "session": lock_service.serialize_session(db, s, viewer=viewer)}


@router.post("/editor-sessions/{session_id}/close")
def editor_close(session_id: int, client_id: Optional[str] = Query(None), saved: bool = Query(False),
                 db: Session = Depends(database.get_db), user=Depends(get_current_user_from_cookie)):
    """Called on unmount / pagehide (navigator.sendBeacon), so it takes query params and tolerates repeats."""
    viewer = _require_user(user)
    s = lock_service.close_client(db, session_id, viewer, client_id=client_id, saved=saved)
    return {"status": "ok", "session": lock_service.serialize_session(db, s, viewer=viewer) if s else None}


# ── stale editor sweeper ──────────────────────────────────────────────────────

SWEEP_INTERVAL_SECONDS = 300


async def sweeper_loop() -> None:
    while True:
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_sweep_once)
        except Exception as exc:  # keep the loop alive
            logger.warning("File lock sweeper failed: %s", exc)


def _sweep_once() -> int:
    db = database.SessionLocal()
    try:
        n = lock_service.sweep_stale_editor_sessions(db)
        if n:
            logger.info("Closed %s idle editor lock(s)", n)
        return n
    finally:
        db.close()
