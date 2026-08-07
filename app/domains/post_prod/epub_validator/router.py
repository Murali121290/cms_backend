"""EPUB Validator FastAPI router.

Provides two groups of endpoints:

  1. Project CRUD  — /projects  (new, mirrors Word Conversion pattern)
  2. Validator workspace — /validate, /file-data, /ace, /pdf, /export
     (unchanged; keyed by folder_name which links project → disk)
"""
import asyncio
import io
import os
import shutil
import zipfile
from fastapi import APIRouter, Depends, Form, Query, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, Response
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.rbac_config import has_post_prod_access

from .services.upload_service import process_upload, get_extract_files, UPLOAD_DIR, EXTRACT_DIR
from .services.validate_service import validate_epub as _validate_epub_legacy
from .engine.runner import validate_epub as _validate_epub_v2
from .services import ev_projects_db
from .services.pdf_service import find_pdf_page, render_pdf_page, get_chapter_pdf
from .services.ace_service import (
    run_ace,
    get_cached_report as get_cached_ace_report,
    html_report_dir as ace_html_report_dir,
)


def _select_validate_epub():
    """Return v2 (default) or legacy engine based on EPUB_VALIDATOR_ENGINE env var."""
    return (
        _validate_epub_legacy
        if os.getenv("EPUB_VALIDATOR_ENGINE") == "legacy"
        else _validate_epub_v2
    )


def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(
            status_code=403, detail="Access denied to Post Production / Backlist."
        )
    return user


router = APIRouter(
    prefix="/post-prod/epub-validator",
    tags=["EPUB Validator"],
    dependencies=[Depends(check_post_prod_access)],
)


# ── Pydantic bodies ──────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    failed: int = 0
    warnings: int = 0
    pending: int = 0
    force: bool = False


class SaveFileRequest(BaseModel):
    content: str


# ════════════════════════════════════════════════════════════════════════════
# 1.  Project CRUD
# ════════════════════════════════════════════════════════════════════════════

@router.get("/health")
def health_check():
    return {"status": "healthy"}


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    """List all non-deleted EV projects (newest first)."""
    return ev_projects_db.list_projects(db)


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = ev_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/projects")
async def create_project(
    client: str = Form(...),
    client_code: str = Form(""),
    project_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Create a new EV project by uploading a ZIP (epub + pdf)."""
    result = await process_upload(
        file,
        db=db,
        user_id=user.id if user else None,
        client=client,
        client_code=client_code or None,
        project_name=project_name,
    )

    if not result.get("status"):
        raise HTTPException(status_code=400, detail=result.get("message", "Upload failed"))

    project = ev_projects_db.create_project(
        db,
        client=client,
        client_code=client_code or None,
        project_name=project_name,
        folder_name=result["folder_name"],
        epub_path=result["epub_extract_path"],
        total_files=result.get("total_files", 0),
        user_id=user.id if user else None,
    )
    return {"message": "Project created successfully", "project": project}


class ProjectUpdateRequest(BaseModel):
    assignee: Optional[str] = None


@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    project = ev_projects_db.update_project(
        db,
        project_id,
        assignee=body.assignee,
        user_id=getattr(user, "id", None),
        username=getattr(user, "username", None) or getattr(user, "user_name", None),
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    # Find project to get folder_name for disk cleanup
    project = ev_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    removed = ev_projects_db.soft_delete_project(
        db, project_id=project_id, user_id=user.id if user else None
    )
    if not removed:
        raise HTTPException(status_code=404, detail="Project not found")

    # Optionally clean up disk (non-blocking)
    folder_path = Path(UPLOAD_DIR) / project["folder_name"]
    if folder_path.exists():
        asyncio.get_event_loop().run_in_executor(None, shutil.rmtree, str(folder_path))

    return {"status": True, "message": "Project deleted"}


# ════════════════════════════════════════════════════════════════════════════
# 2.  Validator workspace  (keyed by folder_name — unchanged contract)
# ════════════════════════════════════════════════════════════════════════════

@router.get("/file-data/{folder_name}")
def list_files(folder_name: str):
    return get_extract_files(folder_name)


@router.get("/file-data/{folder_name}/{file_path:path}")
async def get_file_content(folder_name: str, file_path: str):
    base = (Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR / "epub").resolve()
    target = (base / file_path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(target)


@router.put("/file-data/{folder_name}/{file_path:path}")
async def save_file_content(
    folder_name: str,
    file_path: str,
    body: SaveFileRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    base = (Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR / "epub").resolve()
    target = (base / file_path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    await asyncio.to_thread(target.write_text, body.content, encoding="utf-8")
    return {"status": True, "message": "File saved"}


@router.get("/pdf/{folder_name}")
async def get_pdf(folder_name: str):
    base = (Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR).resolve()
    pdf_path = (base / f"{folder_name}.pdf").resolve()
    if not str(pdf_path).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not pdf_path.is_file():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(pdf_path, media_type="application/pdf")


@router.get("/pdf/{folder_name}/page")
async def get_pdf_page(folder_name: str, file: str = Query(...)):
    return await asyncio.to_thread(find_pdf_page, folder_name, file)


@router.get("/pdf/{folder_name}/chapter")
async def get_chapter_pdf_endpoint(folder_name: str, file: str = Query(...)):
    try:
        path = await asyncio.to_thread(get_chapter_pdf, folder_name, file)
        return FileResponse(path, media_type="application/pdf")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="PDF not found")


@router.get("/pdf/{folder_name}/render")
async def render_pdf_page_endpoint(folder_name: str, page: int = Query(1)):
    try:
        png_bytes = await asyncio.to_thread(render_pdf_page, folder_name, page)
        return Response(content=png_bytes, media_type="image/png")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="PDF not found")


@router.get("/ace/{folder_name}")
def get_ace_report(folder_name: str):
    report = get_cached_ace_report(folder_name)
    if report is None:
        return {"status": False, "message": "No accessibility report yet."}
    return {"status": True, "report": report}


@router.post("/ace/{folder_name}")
async def run_ace_report(
    folder_name: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    report = await asyncio.to_thread(run_ace, folder_name)
    validation_status = (
        "pass"
        if isinstance(report, dict) and report.get("status") == "pass"
        else "fail"
    )
    ev_projects_db.update_validation_status(
        db, folder_name=folder_name, validation_status=validation_status
    )
    return {"status": True, "report": report}


@router.get("/ace/{folder_name}/report/{path:path}")
def get_ace_html_report(folder_name: str, path: str = "report.html"):
    if not path:
        path = "report.html"
    base = ace_html_report_dir(folder_name).resolve()
    target = (base / path).resolve()
    if base not in target.parents and target != base:
        raise HTTPException(status_code=400, detail="Invalid path.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Report file not found.")
    return FileResponse(target)


@router.get("/validate/{filename}")
async def validate_file(
    filename: str,
    file: str = Query(None),
    customer: str = Query(None, description="Override auto-detected customer (v2 engine only)"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    epub_folder = os.path.join(UPLOAD_DIR, filename, "extract", "epub")
    engine = _select_validate_epub()
    kwargs = {"epub_folder": epub_folder, "folder_name": filename, "target_file": file}
    if engine is _validate_epub_v2:
        kwargs["customer"] = customer
    result = await asyncio.to_thread(engine, **kwargs)

    files = result.get("files", []) if isinstance(result, dict) else []
    total_issues = sum(
        f.get("result", {}).get("issues_count", 0) for f in files if isinstance(f, dict)
    )
    validation_status = "pass" if total_issues == 0 else "fail"
    ev_projects_db.update_validation_status(
        db, folder_name=filename, validation_status=validation_status
    )
    return result


@router.post("/export/{folder_name}")
async def export_epub(folder_name: str, body: ExportRequest):
    if body.failed > 0:
        raise HTTPException(
            status_code=400,
            detail="There are validation errors. Please fix them before downloading.",
        )

    if (body.warnings > 0 or body.pending > 0) and not body.force:
        parts: list[str] = []
        if body.warnings > 0:
            parts.append(f"{body.warnings} warning{'s' if body.warnings != 1 else ''}")
        if body.pending > 0:
            parts.append(f"{body.pending} unvalidated file{'s' if body.pending != 1 else ''}")
        return {
            "status": "confirm",
            "message": (
                f"There {'are' if len(parts) > 1 else 'is'} {' and '.join(parts)}."
                " Proceed with export anyway?"
            ),
        }

    epub_dir = (Path(UPLOAD_DIR) / folder_name / "extract" / "epub").resolve()
    if not epub_dir.is_dir():
        raise HTTPException(status_code=404, detail="EPUB source directory not found.")

    def _build_zip() -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            mimetype_path = epub_dir / "mimetype"
            if mimetype_path.is_file():
                zf.write(mimetype_path, "mimetype", compress_type=zipfile.ZIP_STORED)
            else:
                info = zipfile.ZipInfo("mimetype")
                info.compress_type = zipfile.ZIP_STORED
                zf.writestr(info, "application/epub+zip")
            for fp in sorted(epub_dir.rglob("*")):
                if fp.is_file() and fp.name != "mimetype":
                    zf.write(
                        fp,
                        fp.relative_to(epub_dir).as_posix(),
                        compress_type=zipfile.ZIP_DEFLATED,
                    )
        return buf.getvalue()

    zip_bytes = await asyncio.to_thread(_build_zip)
    return Response(
        content=zip_bytes,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="{folder_name}.epub"'},
    )
