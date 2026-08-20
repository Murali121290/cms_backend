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
from .services.export_config import get_export_filename
from .services.pdf_service import find_pdf_page, render_pdf_page, get_chapter_pdf
from .services.ace_service import (
    run_ace,
    get_cached_report as get_cached_ace_report,
    html_report_dir as ace_html_report_dir,
    get_ace_report_zip_path,
)

from .services.epubcheck_service import (
    run_epubcheck_report,
    get_cached_epubcheck_report,
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
)


# ── Pydantic bodies ──────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    failed: int = 0
    warnings: int = 0
    pending: int = 0
    force: bool = False


class SaveFileRequest(BaseModel):
    content: str


class RenameFileRequest(BaseModel):
    new_name: str


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
    eisbn: Optional[str] = Form(None),
    copyright_year: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    # Check if an active (non-deleted) project with the same name already exists
    existing = ev_projects_db.get_project_by_folder(db, project_name.strip())
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"{project_name.strip()} already present"
        )

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
        eisbn=eisbn,
        copyright_year=copyright_year,
    )
    return {"message": "Project created successfully", "project": project}


class ProjectUpdateRequest(BaseModel):
    assignee: Optional[str] = None
    eisbn: Optional[str] = None
    copyright_year: Optional[str] = None


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
        eisbn=body.eisbn,
        copyright_year=body.copyright_year,
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

    # Repack extracted files into .epub zip and save to output directory
    try:
        from .services.repack_service import repack_epub
        await asyncio.to_thread(repack_epub, folder_name)
    except Exception:
        pass

    return {"status": True, "message": "File saved"}


@router.post("/file-data/{folder_name}/{file_path:path}/rename")
async def rename_file_content(
    folder_name: str,
    file_path: str,
    body: RenameFileRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    base = (Path(UPLOAD_DIR) / folder_name / EXTRACT_DIR / "epub").resolve()
    target = (base / file_path).resolve()
    
    if not str(target).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    new_target = (target.parent / body.new_name).resolve()
    
    if not str(new_target).startswith(str(target.parent)):
        raise HTTPException(status_code=403, detail="Invalid new name")
        
    if new_target.exists() and str(new_target) != str(target):
         raise HTTPException(status_code=409, detail="A file with the new name already exists")
         
    target.rename(new_target)

    # Repack extracted files into .epub zip and save to output directory
    try:
        from .services.repack_service import repack_epub
        await asyncio.to_thread(repack_epub, folder_name)
    except Exception:
        pass

    return {"status": True, "message": "File renamed successfully"}



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


@router.get("/ace/{folder_name}/download-zip")
def download_ace_report_zip(folder_name: str):
    zip_path = get_ace_report_zip_path(folder_name)
    return FileResponse(
        zip_path,
        filename=f"{folder_name}-ace-report.zip",
        media_type="application/zip",
    )



@router.get("/epubcheck/{folder_name}")
def get_epubcheck_report_route(folder_name: str):
    report = get_cached_epubcheck_report(folder_name)
    if report is None:
        return {"status": False, "message": "No EPUBCheck report yet."}
    return {"status": True, "report": report}


@router.post("/epubcheck/{folder_name}")
async def run_epubcheck_report_route(
    folder_name: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    report = await asyncio.to_thread(run_epubcheck_report, folder_name)
    return {"status": True, "report": report}


@router.post("/validate/{filename}/start")
async def start_validation(
    filename: str,
    file: str = Query(None),
    customer: str = Query(None, description="Override customer / client_code"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user_from_cookie),
):
    """Dispatch EPUB validation as a Celery background task.

    Returns immediately with a task_id. Poll
    GET /validate/{filename}/task-status/{task_id} to track progress.
    """
    from app.core.worker import run_epub_validation_task

    epub_folder = os.path.join(UPLOAD_DIR, filename, "extract", "epub")

    # Resolve customer from DB if not provided
    resolved_customer = customer
    if not resolved_customer:
        proj = ev_projects_db.get_project_by_folder(db, filename)
        if proj:
            resolved_customer = proj.client_code or proj.client

    user_id = getattr(user, "id", None)
    username = getattr(user, "username", None) or getattr(user, "user_name", None)

    task = run_epub_validation_task.delay(
        folder_name=filename,
        epub_folder=epub_folder,
        target_file=file,
        customer=resolved_customer,
        user_id=user_id,
        username=username,
    )
    return {"task_id": task.id, "status": "pending"}


@router.get("/validate/{filename}/task-status/{task_id}")
async def get_validation_task_status(filename: str, task_id: str):
    """Poll the status of a background EPUB validation task.

    Response shape:
      { "status": "pending" }
      { "status": "running", "rule_id": "URL002", "rule_name": "...", "index": 5, "total": 22 }
      { "status": "completed", "result": { ... } }
      { "status": "failed", "error": "..." }
    """
    import json
    from app.core.celery_app import celery_app
    from app.core.config import get_settings

    # Use a cached Redis client to avoid connection pool exhaustion
    global _redis_client
    if 'redis_lib' not in globals():
        import redis as redis_lib
    if globals().get('_redis_client') is None:
        settings = get_settings()
        globals()['_redis_client'] = redis_lib.from_url(settings.REDIS_URL)
    
    r = globals()['_redis_client']

    # 1. Check Redis progress key first (fast path — written by the task)
    raw = r.get(f"epub_progress:{task_id}")
    if raw:
        progress = json.loads(raw)
        if progress.get("status") in ("running", "failed"):
            return progress
        if progress.get("status") == "completed":
            # Fetch actual result from Celery backend
            task_result = celery_app.AsyncResult(task_id)
            result = task_result.result if task_result.ready() else None
            return {"status": "completed", "result": result}

    # 2. Fall back to Celery task state
    task_result = celery_app.AsyncResult(task_id)
    state = task_result.state  # PENDING | STARTED | SUCCESS | FAILURE

    if state == "SUCCESS":
        return {"status": "completed", "result": task_result.result}
    if state == "FAILURE":
        return {"status": "failed", "error": str(task_result.result)}
    # PENDING or STARTED
    return {"status": "pending"}


@router.get("/validate/{filename}/latest")
def get_latest_validation(
    filename: str,
    db: Session = Depends(get_db),
):
    """Retrieve the latest stored validation result payload for a project."""
    run = ev_projects_db.get_latest_validation_run(db, filename)
    if not run:
        return {"status": False, "message": "No validation run history found."}
    return run


@router.get("/validate/{filename}")
async def validate_file(
    filename: str,
    file: str = Query(None),
    customer: str = Query(None, description="Override customer / client_code (v2 engine only)"),
    user=Depends(get_current_user_from_cookie),
):
    from app.database import SessionLocal
    epub_folder = os.path.join(UPLOAD_DIR, filename, "extract", "epub")
    engine = _select_validate_epub()

    # Automatically resolve customer/client_code from DB if not provided
    resolved_customer = customer
    if not resolved_customer:
        with SessionLocal() as db:
            proj = ev_projects_db.get_project_by_folder(db, filename)
            if proj:
                resolved_customer = proj.client_code or proj.client

    kwargs = {"epub_folder": epub_folder, "folder_name": filename, "target_file": file}
    if engine is _validate_epub_v2:
        kwargs["customer"] = resolved_customer
    result = await asyncio.to_thread(engine, **kwargs)


    user_id = getattr(user, "id", None)
    username = getattr(user, "username", None) or getattr(user, "user_name", None)

    # Save full validation run snapshot to history table
    if isinstance(result, dict):
        with SessionLocal() as db:
            ev_projects_db.save_validation_run(
                db,
                folder_name=filename,
                validation_result=result,
                user_id=user_id,
                username=username,
            )
            ev_projects_db.update_project_status(db, filename, "completed", error=None)

    return {"status": True, "result": result}


@router.post("/export/{folder_name}")
async def export_epub(
    folder_name: str,
    body: ExportRequest,
    db: Session = Depends(get_db),
):
    if (body.failed > 0 or body.warnings > 0 or body.pending > 0) and not body.force:
        parts: list[str] = []
        if body.failed > 0:
            parts.append(f"{body.failed} error{'s' if body.failed != 1 else ''}")
        if body.warnings > 0:
            parts.append(f"{body.warnings} warning{'s' if body.warnings != 1 else ''}")
        if body.pending > 0:
            parts.append(f"{body.pending} unvalidated file{'s' if body.pending != 1 else ''}")
        return {
            "status": "confirm",
            "message": (
                f"There {'are' if len(parts) > 1 or 'error' in parts[0] or 'warning' in parts[0] else 'is'} {' and '.join(parts)}."
                " Proceed with export anyway?"
            ),
        }

    epub_dir = (Path(UPLOAD_DIR) / folder_name / "extract" / "epub").resolve()
    if not epub_dir.is_dir():
        raise HTTPException(status_code=404, detail="EPUB source directory not found.")

    # Get export filename based on customer configuration
    project = ev_projects_db.get_project_by_folder(db, folder_name)
    if project and project.eisbn:
        filename = f"{project.eisbn}_EPUB.epub"
    elif project and project.project_name:
        filename = f"{project.project_name}_EPUB.epub"
    else:
        filename = f"{folder_name}_EPUB.epub"

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
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
