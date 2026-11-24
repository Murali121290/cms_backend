"""
WOPI (Web Application Open Platform Interface) endpoints for LibreOffice Online / Collabora.

Endpoints:
  GET  /wopi/files/{file_id}           -> CheckFileInfo
  GET  /wopi/files/{file_id}/contents  -> GetFile (serve bytes)
  POST /wopi/files/{file_id}/contents  -> PutFile (save bytes back)
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app import database
from app.domains.auth.security import get_current_user_from_cookie
from app.integrations.collabora.config import (
    COLLABORA_BASE_URL,
    COLLABORA_PUBLIC_URL,
    WOPI_BASE_URL,
)
from app.domains.auth.models import User
from app.services import wopi_service
from app.integrations.wopi import access_token as wopi_token
from app.domains.review import service as review_service

logger = logging.getLogger("app.routers.wopi")

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def _require_writer(db: Session, access_token: str | None, file_id: int) -> User:
    """PutFile: a valid token for this file whose user may write the chapter now (assignee / owner / Admin)."""
    editor = wopi_token.read(db, access_token, file_id)
    if editor is None:
        raise HTTPException(status_code=401, detail="Missing or invalid editor token.")
    if not wopi_token.can_write_file(db, editor, file_id):
        logger.warning("WOPI save refused for %s on file %s: not assignee / stage owner / Admin", editor.username, file_id)
        raise HTTPException(status_code=403, detail="Read-only: only the assignee, the stage owner or Admin can save this chapter.")
    return editor


def _get_target_path(file_record, mode: str = "original"):
    return wopi_service.get_target_path(file_record, mode=mode)


def _ensure_save_allowed(db: Session, editor: User, file_id: int) -> None:
    """PutFile while someone else holds the file (download lock, Word, another editor): 409 per WOPI."""
    from app import models
    from app.domains.files import lock_service
    f = db.get(models.File, file_id)
    if f is not None and lock_service.is_locked_by_other(f, editor.id):
        s = lock_service.active_session(db, f)
        raise HTTPException(status_code=409, detail="File is locked by another user.",
                            headers={"X-WOPI-Lock": (s.editor_ref if s and s.editor_ref else "")})


def _after_save(db: Session, editor: User, file_id: int) -> None:
    from app import models
    from app.domains.files import lock_service
    try:
        f = db.get(models.File, file_id)
        if f is not None:
            db.refresh(f)
            lock_service.record_new_version(db, f, editor)
            db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("Could not record Collabora save on lock session for file %s: %s", file_id, exc)


def _wopi_lock_operation(db: Session, file_id: int, access_token: str | None, request: Request):
    """WOPI LOCK / GET_LOCK / REFRESH_LOCK / UNLOCK / UNLOCK_AND_RELOCK -> the file's editor lock.
    Collabora takes the lock when an editable session opens and unlocks when the last view closes."""
    from fastapi.responses import Response
    from app import models
    from app.domains.files import lock_service

    op = (request.headers.get("X-WOPI-Override") or "").upper()
    lock_id = request.headers.get("X-WOPI-Lock") or ""
    old_lock = request.headers.get("X-WOPI-OldLock") or ""
    f = db.get(models.File, file_id)
    if f is None:
        raise HTTPException(status_code=404)
    current = lock_service.active_session(db, f) if f.is_checked_out else None
    current_ref = (current.editor_ref or "") if current else ""

    def conflict():
        return Response(status_code=409, headers={"X-WOPI-Lock": current_ref})

    if op == "GET_LOCK":
        return Response(status_code=200, headers={"X-WOPI-Lock": current_ref})

    editor = wopi_token.read(db, access_token, file_id)
    if editor is None:
        raise HTTPException(status_code=401, detail="Missing or invalid editor token.")

    if op in ("LOCK", "UNLOCK_AND_RELOCK"):
        if op == "UNLOCK_AND_RELOCK" and current is not None and current_ref and current_ref != old_lock:
            return conflict()
        if current is not None and current.lock_kind == lock_service.EDITOR_COLLABORA and current_ref == lock_id:
            lock_service.touch_by_editor_ref(db, lock_id)  # LOCK with the same id = refresh
            return Response(status_code=200)
        try:
            lock_service.acquire(db, f, editor, lock_service.EDITOR_COLLABORA, editor_ref=lock_id)
        except HTTPException:
            db.rollback()
            return conflict()
        return Response(status_code=200)

    if op == "REFRESH_LOCK":
        if current is None or current_ref != lock_id:
            return conflict()
        lock_service.touch_by_editor_ref(db, lock_id)
        return Response(status_code=200)

    if op == "UNLOCK":
        if current is None:
            return Response(status_code=200)
        if current_ref != lock_id:
            return conflict()
        lock_service.close_by_editor_ref(db, lock_id, reason=lock_service.EDITOR_CLOSED)
        return Response(status_code=200)

    raise HTTPException(status_code=501, detail=f"Unsupported WOPI operation {op}")


# ---------------------------------------------------------------------------
# Generic Editor UI
# ---------------------------------------------------------------------------
@router.get("/files/{file_id}/edit")
async def edit_file_page(
    request: Request,
    file_id: int,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Generic Collabora Editor page for any file.
    """
    if not user:
        return RedirectResponse(url="/login")

    page_state = wopi_service.build_editor_page_state(
        db,
        file_id=file_id,
        collabora_public_url=COLLABORA_PUBLIC_URL,
        wopi_base_url=WOPI_BASE_URL,
        access_token=wopi_token.issue(db, user, file_id),
    )

    return templates.TemplateResponse(request, "editor.html",
        {
            "request": request,
            "file": page_state["file"],
            "filename": page_state["filename"],
            "collabora_url": page_state["collabora_url"],
            "user": user,
        },
    )


# ---------------------------------------------------------------------------
# CheckFileInfo
# ---------------------------------------------------------------------------
@router.get("/wopi/files/{file_id}")
async def wopi_check_file_info(
    file_id: int,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    """
    WOPI CheckFileInfo - returns metadata about the file.
    Collabora calls this first to learn about the file. UserCanWrite comes from the signed access token:
    only the chapter's assignee, its stage owner or Admin get an editable session.
    """
    payload = wopi_service.build_check_file_info_payload(
        db,
        file_id=file_id,
        mode="original",
        user=wopi_token.read(db, access_token, file_id),
    )
    return JSONResponse(payload)


@router.post("/wopi/files/{file_id}")
async def wopi_lock_ops(
    file_id: int,
    request: Request,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    return _wopi_lock_operation(db, file_id, access_token, request)


# ---------------------------------------------------------------------------
# GetFile
# ---------------------------------------------------------------------------
@router.get("/wopi/files/{file_id}/contents")
async def wopi_get_file(
    file_id: int,
    db: Session = Depends(database.get_db),
):
    """
    WOPI GetFile - serve the raw .docx bytes to Collabora.
    """
    payload = wopi_service.build_file_response_payload(
        db,
        file_id=file_id,
        mode="original",
    )
    return FileResponse(
        path=payload["path"],
        filename=payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.post("/wopi/files/{file_id}/contents")
async def wopi_put_file(
    file_id: int,
    request: Request,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    editor = _require_writer(db, access_token, file_id)
    _ensure_save_allowed(db, editor, file_id)
    body = await request.body()
    result = wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="original",
        body=body,
        logger=logger,
        uploaded_by_id=editor.id,
    )
    _after_save(db, editor, file_id)
    return result


# ---------------------------------------------------------------------------
# Structuring Mode WOPI Endpoints (Prefix: /structuring)
# ---------------------------------------------------------------------------
@router.get("/wopi/files/{file_id}/structuring")
async def wopi_check_file_info_structuring(
    file_id: int,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    payload = wopi_service.build_check_file_info_payload(
        db,
        file_id=file_id,
        mode="structuring",
        user=wopi_token.read(db, access_token, file_id),
    )
    return JSONResponse(payload)


@router.post("/wopi/files/{file_id}/structuring")
async def wopi_lock_ops_structuring(
    file_id: int,
    request: Request,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    return _wopi_lock_operation(db, file_id, access_token, request)


@router.get("/wopi/files/{file_id}/structuring/contents")
async def wopi_get_file_structuring(
    file_id: int,
    db: Session = Depends(database.get_db),
):
    payload = wopi_service.build_file_response_payload(
        db,
        file_id=file_id,
        mode="structuring",
    )
    return FileResponse(
        path=payload["path"],
        filename=payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


def _regen_xhtml_background(file_id: int):
    """Background task to regenerate XHTML after DOCX save."""
    try:
        db = database.SessionLocal()
        review_service.generate_xhtml(db, file_id=file_id, logger=logger)
        logger.info(f"Background XHTML regeneration completed for file {file_id}")
    except Exception as e:
        logger.error(f"Background XHTML regeneration failed for file {file_id}: {e}", exc_info=True)
    finally:
        db.close()


@router.post("/wopi/files/{file_id}/structuring/contents")
async def wopi_put_file_structuring(
    file_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    access_token: str | None = Query(None),
    db: Session = Depends(database.get_db),
):
    editor = _require_writer(db, access_token, file_id)
    _ensure_save_allowed(db, editor, file_id)
    body = await request.body()
    result = wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="structuring",
        body=body,
        logger=logger,
        uploaded_by_id=editor.id,
    )
    _after_save(db, editor, file_id)

    # Trigger XHTML regeneration in background if body was written
    if body:
        background_tasks.add_task(_regen_xhtml_background, file_id=file_id)

    return result
