"""
WOPI (Web Application Open Platform Interface) endpoints for LibreOffice Online / Collabora.

Endpoints:
  GET  /wopi/files/{file_id}           -> CheckFileInfo
  GET  /wopi/files/{file_id}/contents  -> GetFile (serve bytes)
  POST /wopi/files/{file_id}/contents  -> PutFile (save bytes back)
"""

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app import database
from app.auth import get_current_user_from_cookie
from app.integrations.collabora.config import (
    COLLABORA_BASE_URL,
    COLLABORA_PUBLIC_URL,
    WOPI_BASE_URL,
)
from app.models import User
from app.services import wopi_service

logger = logging.getLogger("app.routers.wopi")

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


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
    )

    return templates.TemplateResponse(
        "editor.html",
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
    db: Session = Depends(database.get_db),
):
    """
    WOPI CheckFileInfo - returns metadata about the file.
    Collabora calls this first to learn about the file.
    """
    payload = wopi_service.build_check_file_info_payload(
        db,
        file_id=file_id,
        mode="original",
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
    db: Session = Depends(database.get_db),
):
    body = await request.body()
    return wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="original",
        body=body,
        logger=logger,
    )


# ---------------------------------------------------------------------------
# Structuring Mode WOPI Endpoints (Prefix: /structuring)
# ---------------------------------------------------------------------------
@router.get("/wopi/files/{file_id}/structuring")
async def wopi_check_file_info_structuring(
    file_id: int,
    db: Session = Depends(database.get_db),
):
    payload = wopi_service.build_check_file_info_payload(
        db,
        file_id=file_id,
        mode="structuring",
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


@router.post("/wopi/files/{file_id}/structuring/contents")
async def wopi_put_file_structuring(
    file_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
):
    body = await request.body()
    return wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode="structuring",
        body=body,
        logger=logger,
    )
