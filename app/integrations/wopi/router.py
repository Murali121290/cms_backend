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
    body = await request.body()
    return wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="original",
        body=body,
        logger=logger,
        uploaded_by_id=editor.id,
    )


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
    body = await request.body()
    result = wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="structuring",
        body=body,
        logger=logger,
        uploaded_by_id=editor.id,
    )

    # Trigger XHTML regeneration in background if body was written
    if body:
        background_tasks.add_task(_regen_xhtml_background, file_id=file_id)

    return result
