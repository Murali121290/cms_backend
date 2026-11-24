"""File locks with time tracking.

A lock is taken when someone downloads a file "with lock" or opens it in an editor (OnlyOffice, Word/WebDAV,
Collabora, or the in-app WYSIWYG / TinyMCE / source editors). While it is held nobody else may replace, upload
over, save or delete the file. Releasing it (new version uploaded, editor closed, cancelled, admin release,
editor idle timeout, custody change) closes a FileLockSession row whose duration_seconds is the wall-clock time
the person held the file, attributed to the chapter's stage at the moment the lock was taken.

files.is_checked_out / checked_out_by_id / checked_out_at remain the canonical "is it locked" fields (many
readers use them); files.lock_kind says what kind of lock it is and active_lock_session_id points at the open
session.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.utils.timezone import now_ist_naive

logger = logging.getLogger(__name__)

DOWNLOAD = "download"
EDITOR_ONLYOFFICE = "editor_onlyoffice"
EDITOR_WORD = "editor_word"
EDITOR_COLLABORA = "editor_collabora"
EDITOR_WYSIWYG = "editor_wysiwyg"
EDITOR_TINYMCE = "editor_tinymce"
EDITOR_SOURCE = "editor_source"
PROCESSING = "processing"

EDITOR_KINDS = {EDITOR_ONLYOFFICE, EDITOR_WORD, EDITOR_COLLABORA, EDITOR_WYSIWYG, EDITOR_TINYMCE, EDITOR_SOURCE}
USER_KINDS = EDITOR_KINDS | {DOWNLOAD}
BROWSER_EDITOR_KINDS = {EDITOR_WYSIWYG, EDITOR_TINYMCE, EDITOR_SOURCE, EDITOR_ONLYOFFICE}

KIND_LABELS = {
    DOWNLOAD: "Download lock",
    EDITOR_ONLYOFFICE: "OnlyOffice",
    EDITOR_WORD: "Word",
    EDITOR_COLLABORA: "Collabora",
    EDITOR_WYSIWYG: "WYSIWYG editor",
    EDITOR_TINYMCE: "TinyMCE editor",
    EDITOR_SOURCE: "Source editor",
    PROCESSING: "Processing",
}

CHECKED_IN = "checked_in"
CANCELLED = "cancelled"
ADMIN_RELEASED = "admin_released"
EDITOR_CLOSED = "editor_closed"
EDITOR_TIMEOUT = "editor_timeout"
CUSTODY_CHANGE = "custody_change"

# Editor locks with no heartbeat for this long are closed by the sweeper. Word refreshes its WebDAV lock
# far less often, so it gets the WebDAV TTL instead.
EDITOR_IDLE_TIMEOUT = timedelta(minutes=10)
WORD_IDLE_TIMEOUT = timedelta(minutes=125)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _display_name(user: Optional[models.User]) -> Optional[str]:
    if user is None:
        return None
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


class FileLockedError(HTTPException):
    def __init__(self, file_record: models.File, holder: Optional[models.User], message: Optional[str] = None):
        kind = file_record.lock_kind or PROCESSING
        who = _display_name(holder) or "another user"
        detail = {
            "code": "LOCKED_BY_OTHER" if kind != PROCESSING else "FILE_PROCESSING",
            "message": message or (
                f"{file_record.filename} is being processed. Try again when processing finishes."
                if kind == PROCESSING else
                f"{file_record.filename} is locked by {who} ({KIND_LABELS.get(kind, kind)})."
            ),
            "file_id": file_record.id,
            "lock_kind": kind,
            "locked_by_id": file_record.checked_out_by_id,
            "locked_by": who,
            "locked_at": file_record.checked_out_at.isoformat() if file_record.checked_out_at else None,
        }
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


# ── helpers ───────────────────────────────────────────────────────────────────

def _lock_row(db: Session, file_id: int) -> Optional[models.File]:
    """Re-read the file row with a row lock (Postgres) so two people can't take the same lock at once."""
    q = db.query(models.File).filter(models.File.id == file_id)
    try:
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            q = q.with_for_update()
    except Exception:
        pass
    return q.first()


def current_stage_detail(db: Session, chapter_id: Optional[int]):
    """The chapter's open StageDetail row for its current stage (None for chapters outside the workflow)."""
    if not chapter_id:
        return None
    from app.domains.workflow.models import ChapterInfo, StageDetail
    info = db.get(ChapterInfo, chapter_id)
    if not info or not info.stage_name:
        return None
    return (
        db.query(StageDetail)
        .filter(StageDetail.project == info.project, StageDetail.chapters == info.chapters,
                StageDetail.stage_name == info.stage_name)
        .order_by(StageDetail.id.desc())
        .first()
    )


def active_session(db: Session, file_record: models.File) -> Optional[models.FileLockSession]:
    if file_record.active_lock_session_id:
        s = db.get(models.FileLockSession, file_record.active_lock_session_id)
        if s and s.ended_at is None:
            return s
    return (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.file_id == file_record.id, models.FileLockSession.ended_at.is_(None))
        .order_by(models.FileLockSession.id.desc())
        .first()
    )


def is_locked_by_other(file_record: models.File, user_id: Optional[int]) -> bool:
    """True when the user may not write the file: someone else holds it, or a processing job is running."""
    if not file_record.is_checked_out:
        return False
    if file_record.lock_kind == PROCESSING:
        return True
    return file_record.checked_out_by_id != user_id  # user locks and legacy (pre-0074, lock_kind NULL) locks


def is_user_lock(file_record: models.File) -> bool:
    return bool(file_record.is_checked_out) and file_record.lock_kind in USER_KINDS


def _add_client(s: models.FileLockSession, client_id: Optional[str]) -> None:
    if not client_id:
        return
    now = _utcnow().isoformat()
    clients = dict(s.clients or {})
    clients[client_id] = now
    s.clients = clients
    try:
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(s, "clients")
    except Exception:
        pass


# ── acquire / release ─────────────────────────────────────────────────────────

def acquire(db: Session, file_record: models.File, user: models.User, kind: str, *, editor_ref: Optional[str] = None,
            client_id: Optional[str] = None, check_write: bool = True, commit: bool = True) -> models.FileLockSession:
    """Take (or re-enter) a lock. Raises FileLockedError (409) when someone else holds it, 403 when the user can't
    write to the chapter. Re-acquiring a lock you already hold returns the open session (idempotent)."""
    if kind not in USER_KINDS:
        raise ValueError(f"Unknown lock kind {kind}")
    if check_write:
        from app.domains.workflow import access as wf_access
        wf_access.ensure_can_write_file(db, user, file_record)

    row = _lock_row(db, file_record.id) or file_record
    if row.is_checked_out:
        if row.lock_kind == PROCESSING or row.checked_out_by_id != user.id:
            raise FileLockedError(row, row.checked_out_by)
        existing = active_session(db, row)
        if existing is not None:
            if existing.lock_kind != kind and kind in EDITOR_KINDS and existing.lock_kind == DOWNLOAD:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
                    "code": "DOWNLOAD_LOCK_HELD",
                    "message": "You hold a download lock on this file. Upload the new version or cancel the lock "
                               "before opening it in an editor.",
                    "file_id": row.id,
                })
            existing.last_heartbeat_at = _utcnow()
            if editor_ref:
                existing.editor_ref = editor_ref  # e.g. a new OnlyOffice document key after a save
            _add_client(existing, client_id)
            if commit:
                db.commit()
            return existing
        # Held by this user from before 0074 (no session): fall through and open one.

    stage = current_stage_detail(db, row.chapter_id)
    now = _utcnow()
    s = models.FileLockSession(
        file_id=row.id, filename=row.filename, category=row.category, project_id=row.project_id, chapter_id=row.chapter_id, user_id=user.id, lock_kind=kind,
        stage_detail_id=stage.id if stage else None, stage_name=stage.stage_name if stage else None,
        started_at=now, last_heartbeat_at=now, from_version=row.version or 1, editor_ref=editor_ref,
    )
    _add_client(s, client_id)
    db.add(s)
    db.flush()
    row.is_checked_out = True
    row.checked_out_by_id = user.id
    row.checked_out_at = now_ist_naive()
    row.lock_kind = kind
    row.active_lock_session_id = s.id
    if commit:
        db.commit()
        db.refresh(s)
    return s


def _clear_file_lock(file_record: models.File) -> None:
    file_record.is_checked_out = False
    file_record.checked_out_by_id = None
    file_record.checked_out_at = None
    file_record.lock_kind = None
    file_record.active_lock_session_id = None


def close_session(db: Session, s: models.FileLockSession, *, reason: str, actor: Optional[models.User] = None,
                  new_version: Optional[int] = None, note: Optional[str] = None, end_at: Optional[datetime] = None,
                  clear_file: bool = True) -> models.FileLockSession:
    """Close a session (no commit). end_at lets the sweeper stop the clock at the last heartbeat."""
    if s.ended_at is not None:
        return s
    end = _aware(end_at) or _utcnow()
    start = _aware(s.started_at) or end
    s.ended_at = end
    s.duration_seconds = max(0, int((end - start).total_seconds()))
    s.end_reason = reason
    if new_version is not None:
        s.to_version = new_version
    s.released_by_id = actor.id if actor else None
    if note:
        s.release_note = note[:2000]
    if clear_file and s.file_id:
        f = db.get(models.File, s.file_id)
        if f is not None and f.is_checked_out and f.lock_kind != PROCESSING and (
                f.active_lock_session_id in (None, s.id)) and f.checked_out_by_id == s.user_id:
            _clear_file_lock(f)
    _record_stage_event(db, s, actor)
    return s


def _record_stage_event(db: Session, s: models.FileLockSession, actor: Optional[models.User]) -> None:
    if not s.stage_detail_id:
        return
    try:
        from app.domains.workflow import custody
        from app.domains.workflow.models import StageDetail
        sd = db.get(StageDetail, s.stage_detail_id)
        if sd is None:
            return
        holder = db.get(models.User, s.user_id) if s.user_id else None
        custody.record_event(sd, "file_lock_released", (actor or holder).username if (actor or holder) else None,
                             notes=s.release_note, extra={
                                 "type": "file_lock",
                                 "file_id": s.file_id,
                                 "file": s.filename,
                                 "user": holder.username if holder else None,
                                 "lock_kind": s.lock_kind,
                                 "seconds": s.duration_seconds,
                                 "from_version": s.from_version,
                                 "to_version": s.to_version,
                                 "end_reason": s.end_reason,
                             })
    except Exception as exc:  # history is best effort; never block a release
        logger.warning("Could not record file lock event on stage %s: %s", s.stage_detail_id, exc)


def release(db: Session, file_record: models.File, actor: models.User, reason: str, *,
            new_version: Optional[int] = None, note: Optional[str] = None,
            commit: bool = True) -> Optional[models.FileLockSession]:
    """Release the actor's own lock. Returns the closed session (None if the file had no user lock)."""
    s = active_session(db, file_record)
    if s is None:
        if file_record.is_checked_out and file_record.lock_kind != PROCESSING and file_record.checked_out_by_id == actor.id:
            _clear_file_lock(file_record)  # legacy lock without a session
            if commit:
                db.commit()
        return None
    if s.user_id != actor.id:
        raise FileLockedError(file_record, file_record.checked_out_by)
    close_session(db, s, reason=reason, actor=None if reason != ADMIN_RELEASED else actor,
                  new_version=new_version, note=note)
    if commit:
        db.commit()
    return s


def force_release(db: Session, file_record: models.File, admin: models.User, note: str,
                  commit: bool = True) -> Optional[models.FileLockSession]:
    from app.domains.workflow import access as wf_access
    if not wf_access.is_admin(admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "ADMIN_ONLY", "message": "Only administrators can release other people's locks."})
    if not (note or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail={"code": "REASON_REQUIRED", "message": "Give a reason for releasing the lock."})
    if file_record.lock_kind == PROCESSING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "FILE_PROCESSING", "message": "The file is being processed; wait for the job to finish."})
    s = active_session(db, file_record)
    if s is not None:
        close_session(db, s, reason=ADMIN_RELEASED, actor=admin, note=note.strip())
    _clear_file_lock(file_record)
    _drop_webdav_locks(db, file_record.id)
    if commit:
        db.commit()
    return s


def _drop_webdav_locks(db: Session, file_id: int) -> None:
    try:
        db.query(models.WebDAVLock).filter(models.WebDAVLock.file_id == file_id).delete(synchronize_session=False)
    except Exception:
        pass


def record_new_version(db: Session, file_record: models.File, user: models.User) -> None:
    """A save inside an open editor session produced a new version: remember it as the session's to_version."""
    s = active_session(db, file_record)
    if s is not None and s.user_id == user.id:
        s.to_version = file_record.version
        s.last_heartbeat_at = _utcnow()


def checkin_after_upload(db: Session, file_record: models.File, user: models.User, *, note: Optional[str] = None) -> Optional[models.FileLockSession]:
    """The lock holder uploaded a new version over the file (bulk upload / check-in): close the session as
    checked_in and clear the lock. No commit."""
    s = active_session(db, file_record)
    if s is not None and s.user_id == user.id:
        close_session(db, s, reason=CHECKED_IN, new_version=file_record.version, note=note)
        return s
    if file_record.is_checked_out and file_record.lock_kind != PROCESSING and file_record.checked_out_by_id == user.id:
        _clear_file_lock(file_record)
    return None


# ── guards for write paths ────────────────────────────────────────────────────

def assert_can_modify(db: Session, file_record: models.File, user: Optional[models.User]) -> None:
    """Writes (replace, delete, upload over, processing) are refused while someone else holds the file, or while
    a processing job runs. The holder may write."""
    if file_record is None or not file_record.is_checked_out:
        return
    if file_record.lock_kind == PROCESSING:
        raise FileLockedError(file_record, file_record.checked_out_by)
    if user is None or file_record.checked_out_by_id != user.id:
        raise FileLockedError(file_record, file_record.checked_out_by)


def assert_editor_save_allowed(db: Session, file_record: models.File, user: Optional[models.User]) -> None:
    """In-app editor saves: allowed for the lock holder; allowed on an unlocked file (older clients that don't
    take a lock yet); refused when someone else holds it."""
    assert_can_modify(db, file_record, user)
    if file_record is not None and user is not None and file_record.is_checked_out:
        s = active_session(db, file_record)
        if s is not None:
            s.last_heartbeat_at = _utcnow()


# ── heartbeats, client close, sweeper ─────────────────────────────────────────

def heartbeat(db: Session, session_id: int, user: models.User, client_id: Optional[str] = None) -> models.FileLockSession:
    s = db.get(models.FileLockSession, session_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "SESSION_NOT_FOUND", "message": "Lock session not found."})
    if s.ended_at is not None:
        f = db.get(models.File, s.file_id) if s.file_id else None
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": "LOCK_LOST",
            "message": "Your lock on this file was released" + (
                " by an administrator" if s.end_reason == ADMIN_RELEASED else
                " after the editor was idle" if s.end_reason == EDITOR_TIMEOUT else "") +
                ". Copy any unsaved changes before reloading.",
            "end_reason": s.end_reason,
            "release_note": s.release_note,
            "file_id": s.file_id,
            "file": f.filename if f else None,
        })
    s.last_heartbeat_at = _utcnow()
    _add_client(s, client_id)
    db.commit()
    return s


def close_client(db: Session, session_id: int, user: models.User, *, client_id: Optional[str] = None,
                 saved: bool = False) -> Optional[models.FileLockSession]:
    """An editor tab closed. With several tabs open on the same lock, only the last one releases it."""
    s = db.get(models.FileLockSession, session_id)
    if s is None or s.user_id != user.id or s.ended_at is not None:
        return s
    if client_id and s.clients:
        clients = dict(s.clients)
        clients.pop(client_id, None)
        s.clients = clients
        try:
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(s, "clients")
        except Exception:
            pass
        if clients:
            db.commit()
            return s
    if saved and s.to_version is None and s.file_id:
        f = db.get(models.File, s.file_id)
        if f is not None and (f.version or 1) > (s.from_version or 1):
            s.to_version = f.version
    close_session(db, s, reason=EDITOR_CLOSED)
    db.commit()
    return s


def close_by_editor_ref(db: Session, editor_ref: str, *, reason: str = EDITOR_CLOSED,
                        new_version: Optional[int] = None) -> Optional[models.FileLockSession]:
    s = (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.editor_ref == editor_ref, models.FileLockSession.ended_at.is_(None))
        .order_by(models.FileLockSession.id.desc())
        .first()
    )
    if s is None:
        return None
    close_session(db, s, reason=reason, new_version=new_version)
    db.commit()
    return s


def touch_by_editor_ref(db: Session, editor_ref: str) -> Optional[models.FileLockSession]:
    s = (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.editor_ref == editor_ref, models.FileLockSession.ended_at.is_(None))
        .first()
    )
    if s is not None:
        s.last_heartbeat_at = _utcnow()
        db.commit()
    return s


def sweep_stale_editor_sessions(db: Session, now: Optional[datetime] = None) -> int:
    """Close editor sessions whose heartbeat stopped (browser crashed, laptop closed). Download locks never
    expire. The clock stops at the last heartbeat, so idle time isn't counted."""
    now = _aware(now) or _utcnow()
    n = 0
    rows = (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.ended_at.is_(None), models.FileLockSession.lock_kind.in_(EDITOR_KINDS))
        .all()
    )
    for s in rows:
        last = _aware(s.last_heartbeat_at) or _aware(s.started_at)
        limit = WORD_IDLE_TIMEOUT if s.lock_kind == EDITOR_WORD else EDITOR_IDLE_TIMEOUT
        if last and now - last > limit:
            close_session(db, s, reason=EDITOR_TIMEOUT, end_at=last)
            if s.lock_kind == EDITOR_WORD:
                _drop_webdav_locks(db, s.file_id)
            n += 1
    if n:
        db.commit()
    return n


def release_for_custody_change(db: Session, chapter_id: int, *, keep_user_id: Optional[int] = None) -> int:
    """Custody of the chapter moved: close every user lock on its files (no commit)."""
    n = 0
    for f in db.query(models.File).filter(models.File.chapter_id == chapter_id, models.File.is_checked_out == True).all():  # noqa: E712
        if f.lock_kind == PROCESSING:
            continue
        if keep_user_id is not None and f.checked_out_by_id == keep_user_id:
            continue
        s = active_session(db, f)
        if s is not None:
            close_session(db, s, reason=CUSTODY_CHANGE)
        _clear_file_lock(f)
        n += 1
    return n


# ── serialization / reports ───────────────────────────────────────────────────

def serialize_session(db: Session, s: models.FileLockSession, *, viewer: Optional[models.User] = None) -> dict:
    now = _utcnow()
    start = _aware(s.started_at)
    end = _aware(s.ended_at)
    f = s.file if s.file_id else None
    return {
        "id": s.id,
        "file_id": s.file_id,
        "filename": f.filename if f else s.filename,
        "category": f.category if f else s.category,
        "file_deleted": f is None,
        "project_id": s.project_id,
        "chapter_id": s.chapter_id,
        "user_id": s.user_id,
        "user": _display_name(s.user),
        "username": s.user.username if s.user else None,
        "lock_kind": s.lock_kind,
        "lock_kind_label": KIND_LABELS.get(s.lock_kind, s.lock_kind),
        "stage_detail_id": s.stage_detail_id,
        "stage_name": s.stage_name,
        "started_at": start.isoformat() if start else None,
        "last_heartbeat_at": _aware(s.last_heartbeat_at).isoformat() if s.last_heartbeat_at else None,
        "ended_at": end.isoformat() if end else None,
        "active": s.ended_at is None,
        "duration_seconds": s.duration_seconds if s.ended_at is not None else (
            int((now - start).total_seconds()) if start else None),
        "from_version": s.from_version,
        "to_version": s.to_version,
        "end_reason": s.end_reason,
        "released_by": _display_name(s.released_by),
        "release_note": s.release_note,
        "is_mine": bool(viewer and s.user_id == viewer.id),
    }


def file_sessions(db: Session, file_id: int, limit: int = 200) -> list[models.FileLockSession]:
    return (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.file_id == file_id)
        .order_by(models.FileLockSession.started_at.desc())
        .limit(limit)
        .all()
    )


def active_locks(db: Session, *, project_id: Optional[int] = None, chapter_id: Optional[int] = None,
                 limit: int = 500) -> list[models.FileLockSession]:
    q = db.query(models.FileLockSession).filter(models.FileLockSession.ended_at.is_(None))
    if project_id:
        q = q.filter(models.FileLockSession.project_id == project_id)
    if chapter_id:
        q = q.filter(models.FileLockSession.chapter_id == chapter_id)
    return q.order_by(models.FileLockSession.started_at.asc()).limit(limit).all()


def chapter_time_report(db: Session, chapter_id: int) -> dict:
    """Time held per stage, broken down per user and per file. Running sessions count up to now."""
    now = _utcnow()
    rows = (
        db.query(models.FileLockSession)
        .filter(models.FileLockSession.chapter_id == chapter_id)
        .order_by(models.FileLockSession.started_at.asc())
        .all()
    )
    stages: dict[str, dict] = {}
    for s in rows:
        start = _aware(s.started_at)
        secs = s.duration_seconds if s.ended_at is not None else int((now - start).total_seconds()) if start else 0
        key = s.stage_name or "No stage"
        st = stages.setdefault(key, {"stage_name": key, "stage_detail_ids": set(), "seconds": 0, "sessions": 0,
                                     "running": 0, "users": {}, "files": {}})
        if s.stage_detail_id:
            st["stage_detail_ids"].add(s.stage_detail_id)
        st["seconds"] += secs or 0
        st["sessions"] += 1
        if s.ended_at is None:
            st["running"] += 1
        uname = _display_name(s.user) or "Unknown"
        u = st["users"].setdefault(s.user_id or 0, {"user_id": s.user_id, "user": uname, "seconds": 0, "sessions": 0})
        u["seconds"] += secs or 0
        u["sessions"] += 1
        f = s.file if s.file_id else None
        fe = st["files"].setdefault(s.file_id or f"deleted:{s.filename}", {
            "file_id": s.file_id, "filename": f.filename if f else s.filename, "seconds": 0, "sessions": 0})
        fe["seconds"] += secs or 0
        fe["sessions"] += 1
    out = []
    for st in stages.values():
        out.append({
            "stage_name": st["stage_name"],
            "stage_detail_ids": sorted(st["stage_detail_ids"]),
            "seconds": st["seconds"],
            "sessions": st["sessions"],
            "running": st["running"],
            "users": sorted(st["users"].values(), key=lambda x: -x["seconds"]),
            "files": sorted(st["files"].values(), key=lambda x: -x["seconds"]),
        })
    return {"chapter_id": chapter_id, "stages": out, "total_seconds": sum(x["seconds"] for x in out)}


def lock_state(db: Session, file_record: models.File, viewer: Optional[models.User] = None) -> dict:
    """Extra lock fields for the file list (merged into schemas_v2.LockState)."""
    s = active_session(db, file_record) if file_record.is_checked_out else None
    from app.domains.workflow import access as wf_access
    elapsed = None
    if file_record.is_checked_out:
        start = _aware(s.started_at) if s else None
        if start:
            elapsed = int((_utcnow() - start).total_seconds())
    return {
        "lock_kind": (file_record.lock_kind or (PROCESSING if file_record.is_checked_out else None)),
        "lock_session_id": s.id if s else None,
        "lock_stage_name": s.stage_name if s else None,
        "lock_started_at": _aware(s.started_at) if s else None,
        "lock_elapsed_seconds": elapsed,
        "locked_by_me": bool(viewer and file_record.is_checked_out and file_record.checked_out_by_id == viewer.id),
        "can_force_release": bool(viewer and file_record.is_checked_out and file_record.lock_kind in USER_KINDS
                                  and wf_access.is_admin(viewer)),
    }
