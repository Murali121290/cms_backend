from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy.orm import Session
import os
import logging
from typing import Dict, Any

from app import database
from app.auth import get_current_user_from_cookie
from app.models import User
from app.services import structuring_review_service
from app.processing.structuring_lib.doc_utils import (
    extract_document_structure,
    load_document,
    save_document,
)
from app.processing.structuring_lib.rules_loader import get_rules_loader
from app.integrations.collabora.config import (
    COLLABORA_BASE_URL,
    COLLABORA_PUBLIC_URL,
    WOPI_BASE_URL,
)
from app.processing.structuring_lib.styler import process_docx

# Configure logger
logger = logging.getLogger("app.routers.structuring")

router = APIRouter()

templates = Jinja2Templates(directory="app/templates")


@router.get("/files/{file_id}/structuring/review", response_class=HTMLResponse)
async def review_structuring(
    request: Request,
    file_id: int,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Serve the review interface for a processed file.
    Expects the file to be already processed (name_Processed.docx exists).
    """
    if not user:
        return RedirectResponse(url="/login")

    try:
        page_state = structuring_review_service.build_review_page_state(
            db,
            file_id=file_id,
            collabora_public_url=COLLABORA_PUBLIC_URL,
            wopi_base_url=WOPI_BASE_URL,
            extract_document_structure_func=extract_document_structure,
            get_rules_loader_func=get_rules_loader,
        )

        if page_state["status"] == "error":
            return templates.TemplateResponse(request, "error.html",
                {
                    "request": request,
                    "error_message": page_state["error_message"],
                },
            )

        return templates.TemplateResponse(request, "structuring_review.html",
            {
                "request": request,
                "file": page_state["file"],
                "filename": page_state["filename"],
                "collabora_url": page_state["collabora_url"],
                "user": user,
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error loading review interface: {exc}", exc_info=True)
        return templates.TemplateResponse(request, "error.html",
            {
                "request": request,
                "error_message": f"Error loading document structure: {str(exc)}",
            },
        )


@router.post("/files/{file_id}/structuring/save")
async def save_structuring_changes(
    file_id: int,
    changes: Dict[str, Any],
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """Apply changes from the review interface."""
    logger.info(f"SAVE ENDPOINT HIT for file {file_id}")
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    from app.processing.structuring_lib.doc_utils import update_document_structure

    result = structuring_review_service.save_changes(
        db,
        file_id=file_id,
        changes=changes,
        update_document_structure_func=update_document_structure,
        logger=logger,
    )
    return JSONResponse(content=result)


@router.get("/files/{file_id}/structuring/review/export")
async def export_structuring(
    file_id: int,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Download the processed document.
    """
    from fastapi.responses import FileResponse

    if not user:
        return RedirectResponse(url="/login")

    export_payload = structuring_review_service.get_export_payload(
        db,
        file_id=file_id,
        logger=logger,
    )

    return FileResponse(
        path=export_payload["path"],
        filename=export_payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


# ─────────────────────────────────────────────────────────────────────────────
# XHTML Review Panel Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/files/{file_id}/structuring/xhtml")
async def get_xhtml_content_endpoint(
    file_id: int,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Retrieve XHTML content for the review panel.
    Returns {"content": str, "exists": bool, "mtime": float, "xhtml_path": str}
    """
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = structuring_review_service.get_xhtml_content(db, file_id=file_id)
    return JSONResponse(payload)


@router.post("/files/{file_id}/structuring/xhtml/generate")
async def generate_xhtml_endpoint(
    file_id: int,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Generate XHTML from the processed DOCX.
    Runs as a background task.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = structuring_review_service.generate_xhtml(db, file_id=file_id, logger=logger)
    return JSONResponse(result)


@router.post("/files/{file_id}/structuring/xhtml")
async def save_xhtml_endpoint(
    file_id: int,
    request: Request,
    db: Session = Depends(database.get_db),
    user: User = Depends(get_current_user_from_cookie),
):
    """
    Save edited XHTML and convert back to DOCX.
    The DOCX update triggers Collabora auto-reload via Version hash change.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = await request.json()
    html_content = body.get("html_content", "")

    try:
        result = structuring_review_service.save_xhtml_and_convert(
            db,
            file_id=file_id,
            html_content=html_content,
            username=user.username,
            logger=logger,
        )
        return JSONResponse(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Unexpected error saving XHTML: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
