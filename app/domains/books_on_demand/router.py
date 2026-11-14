from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
import os
import re
import shutil
import logging
from datetime import datetime, timezone, timedelta

from app.database import get_db, SessionLocal
from app.domains.books_on_demand.models import BodJob
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.books_on_demand.utils import calculate_bod_due_date, generate_bod_history_csv
from app.domains.notifications.email_service import (
    send_bod_qc_ready_email,
    send_bod_new_job_email,
    send_bod_job_completed_email,
    send_bod_ready_to_dispatch_email,
    send_bod_fastrack_alert_email
)
from pydantic import BaseModel
from app.domains.auth.security import get_current_user_from_cookie
from app.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/jobs")
def list_jobs(status: str = None, db: Session = Depends(get_db)):
    """List all Books on Demand jobs with optional filtering."""
    query = db.query(BodJob).filter(BodJob.is_deleted == False)
    if status:
        query = query.filter(BodJob.status == status)
    
    jobs = query.all()
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")

    # Serialize to include client_name and deliverable readiness flags
    result = []
    for job in jobs:
        prod_info = (job.stage_history or {}).get("Production", {})
        pdf_downloaded = bool(prod_info.get("pdf_downloaded") or prod_info.get("pdf_downloaded_at"))

        has_epub = bool(job.epub_filepath and os.path.exists(job.epub_filepath))
        has_ace = bool(job.ace_report_filepath and os.path.exists(job.ace_report_filepath))
        has_epubcheck = bool(job.epubcheck_report_filepath and os.path.exists(job.epubcheck_report_filepath))

        bod_proj_dir = os.path.join(upload_dir, "bod", "BOD", job.project_name) if job.project_name else None
        history_csv_path = os.path.join(bod_proj_dir, "history.csv") if bod_proj_dir else None
        has_history_csv = bool(history_csv_path and os.path.exists(history_csv_path))
        if not has_history_csv and job.epub_filepath:
            alt_csv = os.path.join(os.path.dirname(job.epub_filepath), "history.csv")
            has_history_csv = os.path.exists(alt_csv)

        is_dispatchable = bool(
            has_epub and has_ace and has_epubcheck and has_history_csv
        )

        job_dict = {
            "id": job.id,
            "project_name": job.project_name,
            "pdf_filename": job.pdf_filename,
            "pdf_filepath": job.pdf_filepath,
            "eisbn": getattr(job, "eisbn", None),
            "cover_filename": getattr(job, "cover_filename", None),
            "cover_filepath": getattr(job, "cover_filepath", None),
            "pdf_page_count": job.pdf_page_count,
            "pdf_type": job.pdf_type,
            "pdf_language": job.pdf_language,
            "epub_filename": job.epub_filename,
            "epub_filepath": job.epub_filepath,
            "has_epub": has_epub,
            "has_ace": has_ace,
            "has_epubcheck": has_epubcheck,
            "has_history_csv": has_history_csv,
            "is_dispatchable": is_dispatchable,
            "current_stage_index": job.current_stage_index,
            "current_stage_name": job.current_stage_name,
            "current_assignee": job.current_assignee,
            "assigned_users": job.assigned_users,
            "stage_history": job.stage_history,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "due_date": job.due_date,
            "due_date_history": job.due_date_history,
            "client_name": "BOD",
            "pdf_downloaded": pdf_downloaded,
            "pdf_downloaded_at": prod_info.get("pdf_downloaded_at"),
            "ace_report_filepath": job.ace_report_filepath,
            "ace_report_filename": os.path.basename(job.ace_report_filepath) if job.ace_report_filepath else None,
            "dispatched_by": job.dispatched_by,
            "dispatched_at": job.dispatched_at,
            "is_fastrack": bool(job.is_fastrack),
            "fastrack_requested_date": job.fastrack_requested_date,
            "file_history": job.file_history or [],
            "epubcheck_report_filepath": job.epubcheck_report_filepath,
            "epubcheck_report_filename": os.path.basename(job.epubcheck_report_filepath) if job.epubcheck_report_filepath else None
        }
        result.append(job_dict)
    return result


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    """Get a specific BOD job."""
    job = db.query(BodJob).filter(BodJob.id == job_id, BodJob.is_deleted == False).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    prod_info = (job.stage_history or {}).get("Production", {})
    pdf_downloaded = bool(prod_info.get("pdf_downloaded") or prod_info.get("pdf_downloaded_at"))

    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_proj_dir = os.path.join(upload_dir, "bod", "BOD", job.project_name) if job.project_name else None
    history_csv_path = os.path.join(bod_proj_dir, "history.csv") if bod_proj_dir else None
    has_history_csv = bool(history_csv_path and os.path.exists(history_csv_path))

    return {
        "id": job.id,
        "project_name": job.project_name,
        "pdf_filename": job.pdf_filename,
        "pdf_filepath": job.pdf_filepath,
        "eisbn": getattr(job, "eisbn", None),
        "cover_filename": getattr(job, "cover_filename", None),
        "cover_filepath": getattr(job, "cover_filepath", None),
        "pdf_page_count": job.pdf_page_count,
        "pdf_type": job.pdf_type,
        "pdf_language": job.pdf_language,
        "epub_filename": job.epub_filename,
        "epub_filepath": job.epub_filepath,
        "current_stage_index": job.current_stage_index,
        "current_stage_name": job.current_stage_name,
        "current_assignee": job.current_assignee,
        "assigned_users": job.assigned_users,
        "stage_history": job.stage_history,
        "status": job.status,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "due_date": job.due_date,
        "due_date_history": job.due_date_history,
        "client_name": "BOD",
        "pdf_downloaded": pdf_downloaded,
        "pdf_downloaded_at": prod_info.get("pdf_downloaded_at"),
        "ace_report_filepath": job.ace_report_filepath,
        "ace_report_filename": os.path.basename(job.ace_report_filepath) if job.ace_report_filepath else None,
        "dispatched_by": job.dispatched_by,
        "dispatched_at": job.dispatched_at,
        "is_fastrack": bool(job.is_fastrack),
        "fastrack_requested_date": job.fastrack_requested_date,
        "file_history": job.file_history or [],
        "epubcheck_report_filepath": job.epubcheck_report_filepath,
        "epubcheck_report_filename": os.path.basename(job.epubcheck_report_filepath) if job.epubcheck_report_filepath else None,
        "has_history_csv": has_history_csv,
        "history_csv_filename": "history.csv" if has_history_csv else None
    }

@router.get("/jobs/{job_id}/download-pdf")
def download_pdf(job_id: int, db: Session = Depends(get_db)):
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.pdf_filepath or not os.path.exists(job.pdf_filepath):
        raise HTTPException(status_code=404, detail="PDF not found")
        
    # Only track production work start if the job is actually in Production stage
    if job.current_stage_name == "Production":
        now_iso = datetime.now(timezone.utc).isoformat()
        history = dict(job.stage_history) if job.stage_history else {}
        prod_data = dict(history.get("Production", {}))
        if not prod_data.get("pdf_downloaded"):
            prod_data["pdf_downloaded"] = True
            prod_data["pdf_downloaded_at"] = now_iso
            history["Production"] = prod_data
            job.stage_history = history
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(job, "stage_history")
            db.commit()

    return FileResponse(path=job.pdf_filepath, filename=job.pdf_filename, media_type='application/pdf')

@router.get("/jobs/{job_id}/download-cover")
def download_cover(job_id: int, db: Session = Depends(get_db)):
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.cover_filepath or not os.path.exists(job.cover_filepath):
        raise HTTPException(status_code=404, detail="Cover image not found")
        
    ext = os.path.splitext(job.cover_filename or '')[1].lower()
    media_type = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png' if ext == '.png' else 'application/octet-stream'
    return FileResponse(path=job.cover_filepath, filename=job.cover_filename or "cover.jpg", media_type=media_type)

@router.post("/jobs/{job_id}/start-work")
def start_work(job_id: int, db: Session = Depends(get_db)):
    """Mark that work on the job in Production has started (e.g. after downloading PDF)."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if job.current_stage_name == "Production":
        now_iso = datetime.now(timezone.utc).isoformat()
        history = dict(job.stage_history) if job.stage_history else {}
        prod_data = dict(history.get("Production", {}))
        prod_data["pdf_downloaded"] = True
        prod_data["pdf_downloaded_at"] = now_iso
        history["Production"] = prod_data
        job.stage_history = history
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(job, "stage_history")
        db.commit()
        db.refresh(job)
    return {"message": "Work started", "job": job}

@router.get("/jobs/{job_id}/download-epub")
def download_epub(job_id: int, db: Session = Depends(get_db)):
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.epub_filepath or not os.path.exists(job.epub_filepath):
        raise HTTPException(status_code=404, detail="EPUB not found")
    return FileResponse(path=job.epub_filepath, filename=job.epub_filename, media_type='application/epub+zip')


@router.get("/jobs/{job_id}/download-ace")
def download_ace(job_id: int, db: Session = Depends(get_db)):
    """Download ACE report for a job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.ace_report_filepath or not os.path.exists(job.ace_report_filepath):
        raise HTTPException(status_code=404, detail="ACE report not found")
    return FileResponse(path=job.ace_report_filepath, filename=os.path.basename(job.ace_report_filepath), media_type='application/zip')


@router.get("/jobs/{job_id}/download-epubcheck")
def download_epubcheck(job_id: int, db: Session = Depends(get_db)):
    """Download Epubcheck report for a job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.epubcheck_report_filepath or not os.path.exists(job.epubcheck_report_filepath):
        raise HTTPException(status_code=404, detail="Epubcheck report not found")
    return FileResponse(path=job.epubcheck_report_filepath, filename=os.path.basename(job.epubcheck_report_filepath), media_type='text/plain')


@router.get("/jobs/{job_id}/download-history-csv")
def download_history_csv(job_id: int, db: Session = Depends(get_db)):
    """Download history.csv for a job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_proj_dir = os.path.join(upload_dir, "bod", "BOD", job.project_name) if job.project_name else None
    history_csv_path = os.path.join(bod_proj_dir, "history.csv") if bod_proj_dir else None
    if not history_csv_path or not os.path.exists(history_csv_path):
        if job.epub_filepath and os.path.exists(job.epub_filepath):
            history_csv_path = os.path.join(os.path.dirname(job.epub_filepath), "history.csv")
    if not history_csv_path or not os.path.exists(history_csv_path):
        raise HTTPException(
            status_code=404,
            detail="history.csv not found. Please complete QC to generate history.csv first."
        )
    return FileResponse(path=history_csv_path, filename="history.csv", media_type="text/csv")


@router.get("/jobs/{job_id}/download-dispatch-package")
def download_dispatch_package(job_id: int, db: Session = Depends(get_db)):
    """
    Builds and downloads the full dispatch package ZIP containing:
      1. ePub file OR ePDF ({eisbn}_ePub_all.epub)
      2. history.csv (with WCAG Conformance level)
      3. ACE_report.zip
      4. EPUB-checker_log.txt
    Allows the user to inspect the exact archive that will be sent to the FTP server.
    """
    job = db.query(BodJob).filter(BodJob.id == job_id, BodJob.is_deleted == False).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    settings = get_settings()

    has_epub = bool(job.epub_filepath and os.path.exists(job.epub_filepath))
    has_pdf = bool(job.pdf_filepath and os.path.exists(job.pdf_filepath))
    if not (has_epub or has_pdf):
        raise HTTPException(status_code=400, detail="Cannot build package: ePub file or ePDF is missing.")

    if not (job.ace_report_filepath and os.path.exists(job.ace_report_filepath)):
        raise HTTPException(status_code=400, detail="Cannot build package: ACE report is missing.")

    if not (job.epubcheck_report_filepath and os.path.exists(job.epubcheck_report_filepath)):
        raise HTTPException(status_code=400, detail="Cannot build package: EPUBCheck log is missing.")

    if job.pdf_filename:
        zip_filename = job.pdf_filename.replace('.pdf', '.zip')
    else:
        zip_filename = (job.epub_filename or f"deliverable_{job.id}").replace('.epub', '.zip')

    if job.epub_filepath and os.path.exists(job.epub_filepath):
        local_dir = os.path.dirname(job.epub_filepath)
    elif job.pdf_filepath and os.path.exists(job.pdf_filepath):
        local_dir = os.path.dirname(job.pdf_filepath)
    else:
        upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
        local_dir = os.path.join(upload_dir, "bod")
    os.makedirs(local_dir, exist_ok=True)
    zip_filepath = os.path.join(local_dir, zip_filename)

    # Determine eisbn
    eisbn = getattr(job, "eisbn", None) or ""
    if not eisbn:
        for candidate in (job.pdf_filename, job.epub_filename, job.project_name):
            if candidate:
                m_isbn = re.search(r'(\d{10,13})', candidate)
                if m_isbn:
                    eisbn = m_isbn.group(1)
                    break

    if not eisbn:
        if job.pdf_filename:
            eisbn = job.pdf_filename.rsplit('.', 1)[0].strip()
        elif job.project_name:
            eisbn = str(job.project_name).strip()
        elif job.epub_filename:
            eisbn = job.epub_filename.rsplit('.', 1)[0].strip()

    target_epub_entry_name = f"{eisbn}_ePub_all.epub" if eisbn else (os.path.basename(job.epub_filepath) if has_epub else os.path.basename(job.pdf_filepath))
    target_ace_entry_name = "ACE_report.zip"
    target_epubcheck_entry_name = "EPUB-checker_log.txt"

    # Verify history.csv generated during QC completion exists
    history_csv_filepath = os.path.join(local_dir, "history.csv")
    if not os.path.exists(history_csv_filepath):
        upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
        alt_path = os.path.join(upload_dir, "bod", "BOD", job.project_name or "", "history.csv")
        if os.path.exists(alt_path):
            history_csv_filepath = alt_path
        else:
            raise HTTPException(
                status_code=400,
                detail="history.csv not found. Please complete QC to generate history.csv before downloading the dispatch package."
            )

    import zipfile
    with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
        if has_epub:
            zipf.write(job.epub_filepath, target_epub_entry_name)
        elif has_pdf:
            zipf.write(job.pdf_filepath, target_epub_entry_name)
        zipf.write(job.ace_report_filepath, target_ace_entry_name)
        zipf.write(job.epubcheck_report_filepath, target_epubcheck_entry_name)
        zipf.write(history_csv_filepath, "history.csv")

    return FileResponse(path=zip_filepath, filename=zip_filename, media_type="application/zip")


@router.get("/jobs/{job_id}/view-history-csv")
def view_history_csv(job_id: int, db: Session = Depends(get_db)):
    """View content of history.csv for a job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_proj_dir = os.path.join(upload_dir, "bod", "BOD", job.project_name) if job.project_name else None
    history_csv_path = os.path.join(bod_proj_dir, "history.csv") if bod_proj_dir else None
    if not history_csv_path or not os.path.exists(history_csv_path):
        if job.epub_filepath and os.path.exists(job.epub_filepath):
            history_csv_path = os.path.join(os.path.dirname(job.epub_filepath), "history.csv")
    if not history_csv_path or not os.path.exists(history_csv_path):
        target_dir = bod_proj_dir or (os.path.dirname(job.epub_filepath) if job.epub_filepath and os.path.exists(job.epub_filepath) else (os.path.dirname(job.pdf_filepath) if job.pdf_filepath and os.path.exists(job.pdf_filepath) else os.path.join(upload_dir, "bod", "BOD", f"bod_job_{job.id}")))
        try:
            history_csv_path = generate_bod_history_csv(job, target_dir)
        except Exception as e:
            logger.error(f"Error generating history.csv for job {job_id}: {e}")
    if not history_csv_path or not os.path.exists(history_csv_path):
        raise HTTPException(status_code=404, detail="history.csv could not be located or generated")
    with open(history_csv_path, "r", encoding="utf-8") as f:
        content = f.read()
    return {"content": content, "filename": "history.csv"}



@router.get("/report")
def get_customer_report(
    status: str = None, 
    start_date: str = None, 
    end_date: str = None, 
    db: Session = Depends(get_db)
):
    """Dynamic customer report with detailed process info and filtering."""
    query = db.query(BodJob).filter(BodJob.is_deleted == False)
    
    if status and status != 'all':
        query = query.filter(BodJob.status == status)
        
    if start_date:
        try:
            start_date_clean = start_date.replace('Z', '+00:00')
            sd = datetime.fromisoformat(start_date_clean)
            query = query.filter(BodJob.created_at >= sd)
        except ValueError as e:
            logger.error(f"Error parsing start_date {start_date}: {e}")
            
    if end_date:
        try:
            end_date_clean = end_date.replace('Z', '+00:00')
            ed = datetime.fromisoformat(end_date_clean)
            query = query.filter(BodJob.created_at <= ed)
        except ValueError as e:
            logger.error(f"Error parsing end_date {end_date}: {e}")
            
    jobs = query.all()
    
    report = []
    for job in jobs:
        customer_due = None
        if job.due_date:
            customer_due = job.due_date
            # customer_due = job.due_date + timedelta(days=1)
        elif job.created_at:
            is_image = bool(job.pdf_type and "image" in str(job.pdf_type).lower())
            days = 7 if is_image else 4
            customer_due = job.created_at + timedelta(days=days)

        report.append({
            "id": job.id,
            "client_name": "BOD",
            "project_name": job.project_name,
            "pdf_filename": job.pdf_filename,
            "eisbn": getattr(job, "eisbn", None),
            "cover_filename": getattr(job, "cover_filename", None),
            "cover_filepath": getattr(job, "cover_filepath", None),
            "pdf_type": job.pdf_type,
            "pdf_language": job.pdf_language,
            "pdf_page_count": job.pdf_page_count,
            "epub_filename": job.epub_filename,
            "current_stage": job.current_stage_name,
            "status": job.status,
            "stage_history": job.stage_history,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "due_date": customer_due,
            "internal_due_date": job.due_date,
            "customer_due_date": customer_due,
            "is_fastrack": bool(job.is_fastrack),
            "fastrack_requested_date": job.fastrack_requested_date,
            "due_date_history": job.due_date_history
        })
    return {"jobs": report}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user_from_cookie)):
    """Delete a job and its associated files. Only Admins can do this."""
    is_authorized = (
        (current_user.access_level and current_user.access_level.lower() in ('admin', 'manager')) or
        (current_user.role and any(r in current_user.role.lower() for r in ('admin', 'manager'))) or
        (current_user.designation and any(d in current_user.designation.lower() for d in ('admin', 'manager')))
    )
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Only Admins or Managers can delete jobs")
        
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job.is_deleted = True
    db.commit()
    
    # Clean up local project files and any linked EPUB validator files
    import os, shutil, re
    if job.pdf_filepath:
        project_dir = os.path.dirname(job.pdf_filepath)
        if os.path.exists(project_dir):
            try:
                shutil.rmtree(project_dir, ignore_errors=True)
            except Exception as e:
                print(f"Error removing {project_dir}: {e}")

    if job.epub_filepath:
        epub_dir = os.path.dirname(job.epub_filepath)
        if os.path.exists(epub_dir):
            try:
                shutil.rmtree(epub_dir, ignore_errors=True)
            except Exception as e:
                print(f"Error removing {epub_dir}: {e}")

    try:
        from app.domains.post_prod.epub_validator.services.upload_service import UPLOAD_DIR
        from app.domains.post_prod.epub_validator.services import ev_projects_db
        from app.domains.post_prod.epub_validator.models import EvProject

        folder_name = job.project_name or (job.pdf_filename.rsplit('.', 1)[0] if job.pdf_filename else f"bod_job_{job.id}")
        folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)

        ev_proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
        if ev_proj:
            ev_projects_db.hard_delete_project(db, project_id=ev_proj.id)

        validator_disk_folder = os.path.join(UPLOAD_DIR, folder_name)
        if os.path.exists(validator_disk_folder):
            shutil.rmtree(validator_disk_folder, ignore_errors=True)
    except Exception as e:
        print(f"Error cleaning up EPUB validator project for deleted BOD job {job.id}: {e}")
            
    return {"status": "success"}


class BodFastrackToggleRequest(BaseModel):
    is_fastrack: bool
    fastrack_requested_date: Optional[str] = None
    reason: Optional[str] = None


@router.put("/jobs/{job_id}/fastrack")
def toggle_fastrack(
    job_id: int,
    payload: BodFastrackToggleRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Enable, update, or disable fastrack status for a BOD job, tracking changes in due_date_history."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    old_fastrack = bool(job.is_fastrack)
    old_date = job.fastrack_requested_date
    new_fastrack = bool(payload.is_fastrack)
    new_date = None

    if new_fastrack:
        if payload.fastrack_requested_date:
            try:
                # Handle pure date "YYYY-MM-DD"
                clean_date = payload.fastrack_requested_date.split('T')[0]
                new_date = datetime.strptime(clean_date, "%Y-%m-%d")
            except Exception as e:
                logger.error(f"Error parsing fastrack_requested_date {payload.fastrack_requested_date}: {e}")
                new_date = None

    # Determine changes
    changes = []
    if old_fastrack != new_fastrack:
        changes.append({
            "field": "Priority",
            "old": "Fastrack" if old_fastrack else "Normal",
            "new": "Fastrack" if new_fastrack else "Normal"
        })

    old_date_str = old_date.strftime("%d %b %Y") if old_date else None
    new_date_str = new_date.strftime("%d %b %Y") if new_date else None
    if old_date_str != new_date_str:
        changes.append({
            "field": "Fastrack Date",
            "old": old_date_str,
            "new": new_date_str
        })

    # Update job state
    job.is_fastrack = new_fastrack
    job.fastrack_requested_date = new_date

    # Record history if changes occurred
    if changes:
        fn = (getattr(current_user, "first_name", None) or "").strip() if current_user else ""
        ln = (getattr(current_user, "last_name", None) or "").strip() if current_user else ""
        if fn and ln:
            full_name = fn if (fn.endswith(f" {ln}") or fn.endswith(ln)) else f"{fn} {ln}"
        else:
            full_name = fn or ln or getattr(current_user, "username", getattr(current_user, "user_name", "System")) if current_user else "System"

        reason = (payload.reason or "").strip()
        if not reason:
            if not new_fastrack:
                reason = "Turned off Fastrack"
            elif not old_fastrack:
                reason = "Enabled Fastrack"
            else:
                reason = "Updated Fastrack expected date"

        history_entry = {
            "changes": changes,
            "reason": reason,
            "changed_by": full_name,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if new_date:
            history_entry["date"] = new_date.strftime("%Y-%m-%d")

        history = list(job.due_date_history) if job.due_date_history else []
        history.append(history_entry)
        job.due_date_history = history
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(job, "due_date_history")

    db.commit()
    db.refresh(job)

    # Notify BOD Manager if Fastrack is enabled
    if job.is_fastrack and job.fastrack_requested_date:
        settings = get_settings()
        if settings.BOD_MANAGER_EMAIL:
            try:
                formatted_expected = job.fastrack_requested_date.strftime("%d %b %Y")
                formatted_due = job.due_date.strftime("%d %b %Y") if job.due_date else "Not set"
                send_bod_fastrack_alert_email(
                    manager_email=settings.BOD_MANAGER_EMAIL,
                    project_name=job.project_name or "",
                    pdf_filename=job.pdf_filename,
                    expected_date=formatted_expected,
                    due_date=formatted_due
                )
            except Exception as e:
                logger.error(f"Failed to send fastrack notification email to {settings.BOD_MANAGER_EMAIL}: {e}")

    return {
        "status": "success",
        "job_id": job.id,
        "is_fastrack": bool(job.is_fastrack),
        "fastrack_requested_date": job.fastrack_requested_date.strftime("%Y-%m-%d") if job.fastrack_requested_date else None,
        "due_date_history": job.due_date_history
    }


class BodDueDateRequest(BaseModel):
    due_date: str | None
    reason: str

@router.put("/jobs/{job_id}/due-date")
def update_due_date(
    job_id: int, 
    payload: BodDueDateRequest, 
    db: Session = Depends(get_db), 
    current_user = Depends(get_current_user_from_cookie)
):
    """Update due date of a BOD job (Manager only)."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    new_date = None
    if payload.due_date:
        try:
            from datetime import datetime
            new_date = datetime.fromisoformat(payload.due_date.replace('Z', '+00:00'))
            new_date = new_date.replace(tzinfo=None) # Store as naive UTC matching other dates
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")

    fn = (getattr(current_user, "first_name", None) or "").strip()
    ln = (getattr(current_user, "last_name", None) or "").strip()
    if fn and ln:
        full_name = fn if (fn.endswith(f" {ln}") or fn.endswith(ln)) else f"{fn} {ln}"
    else:
        full_name = fn or ln or getattr(current_user, "username", getattr(current_user, "user_name", "Unknown"))

    old_str = job.due_date.strftime("%d %b %Y") if job.due_date else None
    new_str = new_date.strftime("%d %b %Y") if new_date else None

    changes = [
        {
            "field": "Due Date",
            "old": old_str,
            "new": new_str
        }
    ]

    history_entry = {
        "date": payload.due_date,
        "reason": payload.reason,
        "changed_by": full_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "changes": changes
    }
    
    history = list(job.due_date_history) if job.due_date_history else []
    history.append(history_entry)
    
    job.due_date = new_date
    job.due_date_history = history
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(job, "due_date_history")
    db.commit()
    
    return {"status": "success"}


class BodAnalysisUpdateRequest(BaseModel):
    pdf_page_count: Optional[int] = None
    pdf_type: Optional[str] = None
    pdf_language: Optional[str] = None
    eisbn: Optional[str] = None
    due_date: Optional[str] = None
    due_date_reason: Optional[str] = None


@router.put("/jobs/{job_id}/analysis")
def update_job_analysis(
    job_id: int, 
    payload: BodAnalysisUpdateRequest, 
    db: Session = Depends(get_db), 
    current_user = Depends(get_current_user_from_cookie)
):
    """Update job analysis step details: Pages, Type, Language, Due Date. Tracks only changed fields in history."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.current_stage_name != "Add job":
        raise HTTPException(status_code=400, detail="Job analysis can only be updated in 'Add job' stage")

    changes = []

    # 1. Pages
    if payload.pdf_page_count is not None and payload.pdf_page_count != job.pdf_page_count:
        old_val = f"{job.pdf_page_count} pages" if job.pdf_page_count is not None else None
        new_val = f"{payload.pdf_page_count} pages"
        changes.append({
            "field": "Pages",
            "old": old_val,
            "new": new_val
        })
        job.pdf_page_count = payload.pdf_page_count

    # 2. PDF Type
    type_changed = False
    if payload.pdf_type is not None:
        new_type = payload.pdf_type.strip() if payload.pdf_type else ""
        old_type = (job.pdf_type or "").strip()
        if new_type != old_type:
            type_changed = True
            changes.append({
                "field": "PDF Type",
                "old": old_type if old_type else None,
                "new": new_type if new_type else None
            })
            job.pdf_type = new_type or None

    # 3. Language
    if payload.pdf_language is not None:
        new_lang = payload.pdf_language.strip() if payload.pdf_language else ""
        old_lang = (job.pdf_language or "").strip()
        if new_lang != old_lang:
            changes.append({
                "field": "Language",
                "old": old_lang if old_lang else None,
                "new": new_lang if new_lang else None
            })
            job.pdf_language = new_lang or None

    # 4. eISBN
    if payload.eisbn is not None:
        new_eisbn = payload.eisbn.strip() if payload.eisbn else ""
        old_eisbn = (getattr(job, "eisbn", None) or "").strip()
        if new_eisbn != old_eisbn:
            changes.append({
                "field": "eISBN",
                "old": old_eisbn if old_eisbn else None,
                "new": new_eisbn if new_eisbn else None
            })
            job.eisbn = new_eisbn or None

    # 5. Due Date
    if payload.due_date is not None and payload.due_date.strip():
        new_due_date = None
        try:
            new_due_date = datetime.fromisoformat(payload.due_date.replace('Z', '+00:00'))
            new_due_date = new_due_date.replace(tzinfo=None)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")

        old_ymd = job.due_date.strftime("%Y-%m-%d") if job.due_date else None
        new_ymd = new_due_date.strftime("%Y-%m-%d") if new_due_date else None

        if old_ymd != new_ymd:
            old_str = job.due_date.strftime("%d %b %Y") if job.due_date else None
            new_str = new_due_date.strftime("%d %b %Y") if new_due_date else None
            changes.append({
                "field": "Due Date",
                "old": old_str,
                "new": new_str
            })
            job.due_date = new_due_date
    elif type_changed:
        calc_due = calculate_bod_due_date(job.pdf_type, job.pdf_page_count, job.created_at)
        new_due_date = calc_due.replace(tzinfo=None)
        old_ymd = job.due_date.strftime("%Y-%m-%d") if job.due_date else None
        new_ymd = new_due_date.strftime("%Y-%m-%d") if new_due_date else None

        if old_ymd != new_ymd:
            old_str = job.due_date.strftime("%d %b %Y") if job.due_date else None
            new_str = new_due_date.strftime("%d %b %Y") if new_due_date else None
            changes.append({
                "field": "Due Date",
                "old": old_str,
                "new": new_str
            })
            job.due_date = new_due_date

    if changes:
        if not payload.due_date_reason or not payload.due_date_reason.strip():
            raise HTTPException(status_code=400, detail="Update reason is mandatory")

        fn = (getattr(current_user, "first_name", None) or "").strip()
        ln = (getattr(current_user, "last_name", None) or "").strip()
        if fn and ln:
            full_name = fn if (fn.endswith(f" {ln}") or fn.endswith(ln)) else f"{fn} {ln}"
        else:
            full_name = fn or ln or getattr(current_user, "username", getattr(current_user, "user_name", "Unknown"))

        history_entry = {
            "changes": changes,
            "reason": payload.due_date_reason.strip(),
            "changed_by": full_name,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if payload.due_date:
            history_entry["date"] = payload.due_date

        history = list(job.due_date_history) if job.due_date_history else []
        history.append(history_entry)
        job.due_date_history = history
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(job, "due_date_history")

    db.commit()
    db.refresh(job)

    prod_info = (job.stage_history or {}).get("Production", {})
    pdf_downloaded = bool(prod_info.get("pdf_downloaded") or prod_info.get("pdf_downloaded_at"))

    return {
        "message": "Job analysis updated successfully",
        "job": {
            "id": job.id,
            "pdf_filename": job.pdf_filename,
            "pdf_filepath": job.pdf_filepath,
            "eisbn": getattr(job, "eisbn", None),
            "pdf_page_count": job.pdf_page_count,
            "pdf_type": job.pdf_type,
            "pdf_language": job.pdf_language,
            "epub_filename": job.epub_filename,
            "epub_filepath": job.epub_filepath,
            "current_stage_index": job.current_stage_index,
            "current_stage_name": job.current_stage_name,
            "current_assignee": job.current_assignee,
            "assigned_users": job.assigned_users,
            "stage_history": job.stage_history,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "due_date": job.due_date,
            "due_date_history": job.due_date_history,
            "client_name": "BOD",
            "pdf_downloaded": pdf_downloaded,
            "pdf_downloaded_at": prod_info.get("pdf_downloaded_at"),
            "ace_report_filepath": job.ace_report_filepath,
            "ace_report_filename": os.path.basename(job.ace_report_filepath) if job.ace_report_filepath else None,
            "epubcheck_report_filepath": job.epubcheck_report_filepath,
            "epubcheck_report_filename": os.path.basename(job.epubcheck_report_filepath) if job.epubcheck_report_filepath else None
        }
    }


@router.post("/jobs/{job_id}/assign")
def assign_job(
    job_id: int, 
    payload: Dict[str, Any], 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Assign a user to the current stage of the job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    user_id = payload.get("user_id")
    assigned_by = current_user.username if current_user else "System"

    if not user_id:
        job.current_assignee = None
        
        history_list = job.assigned_users if isinstance(job.assigned_users, list) else []
        new_history = list(history_list)
        new_history.append({
            "user_id": None,
            "stage": job.current_stage_name,
            "time": datetime.now(timezone.utc).isoformat(),
            "assigned_by": assigned_by,
            "action": "Unassigned"
        })
        job.assigned_users = new_history
        
        history = dict(job.stage_history)
        stage_data = history.get(job.current_stage_name, {})
        stage_data["assignee"] = None
        history[job.current_stage_name] = stage_data
        job.stage_history = history
        
        db.commit()
        db.refresh(job)
        return {"message": "User unassigned successfully", "job": job}

    job.current_assignee = user_id

    # Update assigned users history
    history_list = job.assigned_users if isinstance(job.assigned_users, list) else []
    new_history = list(history_list)
    new_history.append({
        "user_id": user_id,
        "stage": job.current_stage_name,
        "time": datetime.now(timezone.utc).isoformat(),
        "assigned_by": assigned_by
    })
    job.assigned_users = new_history
    
    # Update stage history
    history = dict(job.stage_history)
    stage_data = history.get(job.current_stage_name, {})
    stage_data["assignee"] = user_id
    history[job.current_stage_name] = stage_data
    job.stage_history = history
    
    db.commit()
    db.refresh(job)
    
    return {"message": "User assigned successfully", "job": job}


@router.post("/jobs/{job_id}/advance")
def advance_job_stage(job_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Advance job to the next stage (e.g., Add job -> Production -> QC -> Archive)."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    return _advance_job_logic(job, background_tasks, db)

def _advance_job_logic(job: BodJob, background_tasks: BackgroundTasks, db: Session):
    settings = get_settings()
    stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Production,QC,Ready to Dispatch,Archive"
    stages = [s.strip() for s in stages_str.split(",")]
    
    try:
        curr_idx = stages.index(job.current_stage_name)
    except ValueError:
        curr_idx = job.current_stage_index
    
    if curr_idx >= len(stages) - 1:
        raise HTTPException(status_code=400, detail="Job is already at the final stage")
        
    # Mark end time for current stage
    now_iso = datetime.now(timezone.utc).isoformat()
    history = dict(job.stage_history) if job.stage_history else {}
    current_stage = job.current_stage_name
    stage_data = history.get(current_stage, {})
    stage_data["end_time"] = now_iso
    history[current_stage] = stage_data
    
    # If currently at Ready to Dispatch, advancing requires FTP upload success
    if current_stage == "Ready to Dispatch" or stages[curr_idx + 1] == "Archive":
        success, error = _execute_dispatch_and_upload(job, db, settings)
        if not success:
            raise HTTPException(status_code=400, detail=error or "Failed to upload deliverable to FTP")
        return {"message": "Job dispatched successfully and uploaded to FTP", "job": job}

    # Advance
    next_idx = curr_idx + 1
    job.current_stage_index = next_idx
    new_stage = stages[next_idx]
    job.current_stage_name = new_stage
    
    # Set start time for next stage
    new_stage_data = history.get(new_stage, {})
    new_stage_data["start_time"] = now_iso
    
    from sqlalchemy.orm.attributes import flag_modified
    if new_stage == "Ready to Dispatch":
        # Auto-assign to BOD Manager (resolved via BOD_MANAGER_EMAIL or fallback to manager username/email)
        from app.domains.auth.models import User
        manager_email = getattr(settings, "BOD_MANAGER_EMAIL", None)
        manager_user = None
        if manager_email:
            manager_user = db.query(User).filter(User.email.ilike(manager_email.strip())).first()
        
        manager_assignee = manager_user.username if manager_user else (manager_email or "System")
        manager_full_name = ""
        if manager_user:
            fn = (manager_user.first_name or "").strip()
            ln = (manager_user.last_name or "").strip()
            manager_full_name = f"{fn} {ln}".strip() or manager_assignee
        else:
            manager_full_name = manager_assignee

        job.current_assignee = manager_assignee
        new_stage_data["assignee"] = manager_assignee

        history_list = job.assigned_users if isinstance(job.assigned_users, list) else []
        new_history = list(history_list)
        new_history.append({
            "user_id": manager_assignee,
            "stage": new_stage,
            "time": now_iso,
            "assigned_by": "System",
            "action": f"Auto-assigned to BOD Manager ({manager_full_name}) on move to Ready to Dispatch"
        })
        job.assigned_users = new_history
        flag_modified(job, "assigned_users")
    elif new_stage == "Production" or current_stage == "QC":
        # Unassign assignee when moving to Production
        job.current_assignee = None
        new_stage_data["assignee"] = None
        
        history_list = job.assigned_users if isinstance(job.assigned_users, list) else []
        new_history = list(history_list)
        new_history.append({
            "user_id": None,
            "stage": new_stage,
            "time": now_iso,
            "assigned_by": "System",
            "action": f"Unassigned on move to {new_stage}"
        })
        job.assigned_users = new_history
        flag_modified(job, "assigned_users")
    elif job.current_assignee and not new_stage_data.get("assignee"):
        new_stage_data["assignee"] = job.current_assignee
        
    history[new_stage] = new_stage_data
    job.stage_history = history
    flag_modified(job, "stage_history")
    
    # If moving to Archive, status becomes Completed
    if job.current_stage_index == len(stages) - 1:
        job.status = "Completed"
        new_stage_data["end_time"] = now_iso
        
    db.commit()
    db.refresh(job)
    
    manager_email = settings.BOD_MANAGER_EMAIL
    
    # Send email if moving to QC, Ready to Dispatch, or Archive
    if job.current_stage_name == "QC" and manager_email:
        send_bod_qc_ready_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)
    elif job.current_stage_name == "Ready to Dispatch" and manager_email:
        send_bod_ready_to_dispatch_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)
    elif job.current_stage_name == "Archive" and manager_email:
        send_bod_job_completed_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)
        
    return {"message": "Job advanced successfully", "job": job}


import zipfile

def _execute_dispatch_and_upload(job: BodJob, db: Session, settings, dispatched_by: str = "System") -> tuple[bool, str | None]:
    """
    Validates all 4 required delivery files:
      1. ePub file OR ePDF (job.epub_filepath or job.pdf_filepath)
      2. history.csv (without line breaks in data row)
      3. ACE report (job.ace_report_filepath)
      4. Epub Checker Log (job.epubcheck_report_filepath)
    Packages them into a ZIP, uploads to FTP, and ONLY transitions
    the job to Archive / Completed status after the FTP upload succeeds.
    Returns (success: bool, error_message: str | None).
    """
    # 1. Check ePub file OR ePDF
    has_epub = bool(job.epub_filepath and os.path.exists(job.epub_filepath))
    has_pdf = bool(job.pdf_filepath and os.path.exists(job.pdf_filepath))
    if not (has_epub or has_pdf):
        return False, "Cannot dispatch: ePub file or ePDF is missing."

    # 2. Check ACE report
    if not (job.ace_report_filepath and os.path.exists(job.ace_report_filepath)):
        return False, "Cannot dispatch: ACE report is missing. Please upload the ACE report before dispatching."

    # 3. Check Epub Checker Log
    if not (job.epubcheck_report_filepath and os.path.exists(job.epubcheck_report_filepath)):
        return False, "Cannot dispatch: Epub Checker Log is missing. Please upload the Epubcheck log before dispatching."

    if not settings.BOD_FTP_HOST:
        return False, "BOD FTP host is not configured in settings."

    delivery_dir = settings.BOD_FTP_DELIVERY_PATH
    if not delivery_dir:
        return False, "BOD_FTP_DELIVERY_PATH is missing from environment configuration."

    try:
        # Create a combined zip file named after the PDF or EPUB
        if job.pdf_filename:
            zip_filename = job.pdf_filename.replace('.pdf', '.zip')
        else:
            zip_filename = (job.epub_filename or f"deliverable_{job.id}").replace('.epub', '.zip')
            
        if job.epub_filepath and os.path.exists(job.epub_filepath):
            local_dir = os.path.dirname(job.epub_filepath)
        elif job.pdf_filepath and os.path.exists(job.pdf_filepath):
            local_dir = os.path.dirname(job.pdf_filepath)
        else:
            upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
            local_dir = os.path.join(upload_dir, "bod")
        os.makedirs(local_dir, exist_ok=True)
        zip_filepath = os.path.join(local_dir, zip_filename)

        # Determine eisbn base:
        # First priority: job.eisbn if set, else find 10 to 13 digits (ISBN) in pdf_filename, epub_filename, or project_name
        eisbn = getattr(job, "eisbn", None) or ""
        if not eisbn:
            for candidate in (job.pdf_filename, job.epub_filename, job.project_name):
                if candidate:
                    m_isbn = re.search(r'(\d{10,13})', candidate)
                    if m_isbn:
                        eisbn = m_isbn.group(1)
                        break

        # Fallback if no numeric ISBN found (e.g. non-standard or test names)
        if not eisbn:
            if job.pdf_filename:
                eisbn = job.pdf_filename.rsplit('.', 1)[0].strip()
            elif job.project_name:
                eisbn = str(job.project_name).strip()
            elif job.epub_filename:
                eisbn = job.epub_filename.rsplit('.', 1)[0].strip()

        # Target entry names inside the deliverable ZIP:
        # 1. {eisbn}_ePub_all.epub (or ePDF if only PDF exists)
        # 2. history.csv (single-line comma-separated record without line breaks)
        # 3. ACE_report.zip
        # 4. EPUB-checker_log.txt
        target_epub_entry_name = f"{eisbn}_ePub_all.epub" if eisbn else (os.path.basename(job.epub_filepath) if has_epub else os.path.basename(job.pdf_filepath))
        target_ace_entry_name = "ACE_report.zip"
        target_epubcheck_entry_name = "EPUB-checker_log.txt"

        # Verify history.csv generated during QC completion exists
        history_csv_filepath = os.path.join(local_dir, "history.csv")
        if not os.path.exists(history_csv_filepath):
            upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
            alt_path = os.path.join(upload_dir, "bod", "BOD", job.project_name or "", "history.csv")
            if os.path.exists(alt_path):
                history_csv_filepath = alt_path
            else:
                return False, "Cannot dispatch: history.csv not found. Please complete QC to generate history.csv first."

        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 1. ePub file OR ePDF
            if has_epub:
                zipf.write(job.epub_filepath, target_epub_entry_name)
            elif has_pdf:
                zipf.write(job.pdf_filepath, target_epub_entry_name)

            # 2. ACE report
            zipf.write(job.ace_report_filepath, target_ace_entry_name)

            # 3. Epub Checker Log
            zipf.write(job.epubcheck_report_filepath, target_epubcheck_entry_name)

            # 4. history.csv (without line breaks in data row)
            zipf.write(history_csv_filepath, "history.csv")

        # Upload to FTP server
        with BodFtpService(
            settings.BOD_FTP_HOST,
            settings.BOD_FTP_USERNAME,
            settings.BOD_FTP_PASSWORD,
            port=getattr(settings, "BOD_FTP_PORT", 21),
            timeout=getattr(settings, "BOD_FTP_TIMEOUT", 30)
        ) as ftp:
            ftp.ensure_dir(delivery_dir)
            ftp.upload_file(zip_filepath, zip_filename)
            
    except Exception as e:
        logger.error(f"Failed FTP upload for job {job.id} ({job.pdf_filename}): {str(e)}")
        return False, f"FTP upload failed: {str(e)}"

    # ONLY AFTER FTP SUCCEEDS: Update stage to Archive and status to Completed
    stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Production,QC,Ready to Dispatch,Archive"
    stages = [s.strip() for s in stages_str.split(",")]
    archive_index = stages.index("Archive") if "Archive" in stages else len(stages) - 1

    now_iso = datetime.now(timezone.utc).isoformat()
    history = dict(job.stage_history) if job.stage_history else {}
    current_stage = job.current_stage_name
    stage_data = history.get(current_stage, {})
    stage_data["end_time"] = now_iso
    stage_data["dispatched_by"] = dispatched_by
    if not stage_data.get("assignee"):
        stage_data["assignee"] = dispatched_by
    history[current_stage] = stage_data

    # Update job's current assignee to the user who dispatched it
    job.current_assignee = dispatched_by
    job.dispatched_by = dispatched_by
    job.dispatched_at = datetime.now(timezone.utc)
    job.current_stage_index = archive_index
    job.current_stage_name = "Archive"
    job.status = "Completed"

    new_stage_data = history.get("Archive", {})
    new_stage_data["start_time"] = now_iso
    new_stage_data["end_time"] = now_iso
    new_stage_data["dispatched_by"] = dispatched_by
    new_stage_data["assignee"] = dispatched_by
    history["Archive"] = new_stage_data

    from sqlalchemy.orm.attributes import flag_modified
    job.stage_history = history
    flag_modified(job, "stage_history")

    history_list = job.assigned_users if isinstance(job.assigned_users, list) else []
    new_history = list(history_list)
    new_history.append({
        "user_id": dispatched_by,
        "stage": "Ready to Dispatch",
        "time": now_iso,
        "assigned_by": dispatched_by,
        "action": f"Dispatched to FTP by {dispatched_by}"
    })
    job.assigned_users = new_history
    flag_modified(job, "assigned_users")

    db.commit()
    db.refresh(job)

    manager_email = settings.BOD_MANAGER_EMAIL
    if manager_email:
        send_bod_job_completed_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)

    return True, None


class SingleDispatchPayload(BaseModel):
    dispatched_by: Optional[str] = None


@router.post("/jobs/{job_id}/dispatch")
def dispatch_job(
    job_id: int, 
    payload: Optional[SingleDispatchPayload] = None,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Dispatch job to FTP: packages EPUB and QC reports into ZIP, uploads to FTP, and marks job Completed only on success."""
    job = db.query(BodJob).filter(BodJob.id == job_id, BodJob.is_deleted == False).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == "Completed" or job.current_stage_name == "Archive":
        raise HTTPException(status_code=400, detail="Job is already completed")

    user_identifier = (payload.dispatched_by if payload and payload.dispatched_by else None) or (current_user.username if current_user else None) or "System"

    settings = get_settings()
    success, error = _execute_dispatch_and_upload(job, db, settings, dispatched_by=user_identifier)
    if not success:
        raise HTTPException(status_code=400, detail=error or "Failed to upload to FTP")

    return {"message": "Job dispatched successfully and uploaded to FTP", "job": job}


class BulkDispatchPayload(BaseModel):
    job_ids: List[int]
    dispatched_by: Optional[str] = None


@router.post("/jobs/bulk-dispatch")
def bulk_dispatch_jobs(
    payload: BulkDispatchPayload, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Bulk dispatch multiple jobs to FTP: only successfully uploaded jobs are marked Completed."""
    if not payload.job_ids:
        raise HTTPException(status_code=400, detail="No job IDs provided")

    user_identifier = (payload.dispatched_by if payload and payload.dispatched_by else None) or (current_user.username if current_user else None) or "System"

    settings = get_settings()
    results = []
    success_count = 0
    failed_count = 0

    for jid in payload.job_ids:
        job = db.query(BodJob).filter(BodJob.id == jid, BodJob.is_deleted == False).first()
        if not job:
            results.append({"job_id": jid, "success": False, "error": "Job not found"})
            failed_count += 1
            continue
        if job.status == "Completed" or job.current_stage_name == "Archive":
            results.append({"job_id": jid, "job_name": job.pdf_filename, "success": False, "error": "Job already completed"})
            failed_count += 1
            continue
        if job.current_stage_name != "Ready to Dispatch":
            results.append({"job_id": jid, "job_name": job.pdf_filename, "success": False, "error": f"Job is in '{job.current_stage_name}', not 'Ready to Dispatch'"})
            failed_count += 1
            continue

        success, err = _execute_dispatch_and_upload(job, db, settings, dispatched_by=user_identifier)
        if success:
            success_count += 1
            results.append({"job_id": jid, "job_name": job.pdf_filename, "success": True})
        else:
            failed_count += 1
            results.append({"job_id": jid, "job_name": job.pdf_filename, "success": False, "error": err})

    return {
        "message": f"Bulk dispatch finished: {success_count} succeeded, {failed_count} failed",
        "success_count": success_count,
        "failed_count": failed_count,
        "results": results
    }


@router.post("/jobs/{job_id}/upload-qc-reports")
def upload_qc_reports(
    job_id: int,
    ace_report: UploadFile = File(None),
    epubcheck_report: UploadFile = File(None),
    db: Session = Depends(get_db)
):
    """Upload ACE and Epubcheck reports for a job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    project_dir = os.path.join(upload_dir, "bod", "BOD", job.project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    if ace_report:
        ace_name_lower = (ace_report.filename or "").lower()
        if not (ace_name_lower.endswith("_ace_report.zip") or ace_name_lower.endswith("ace_report.zip") or ace_name_lower.endswith(".zip")):
            raise HTTPException(status_code=400, detail="ACE validation report must be a .zip file (e.g. 'ACE_report.zip' or ending with '_ace_report.zip')")
        ace_path = os.path.join(project_dir, ace_report.filename)
        with open(ace_path, "wb") as buffer:
            shutil.copyfileobj(ace_report.file, buffer)
        job.ace_report_filepath = ace_path
        
    if epubcheck_report:
        epubcheck_name_lower = (epubcheck_report.filename or "").lower()
        if not (epubcheck_name_lower.endswith("_log.txt") or epubcheck_name_lower.endswith("epub-checker_log.txt") or epubcheck_name_lower.endswith(".txt")):
            raise HTTPException(status_code=400, detail="Epubcheck validation report must be a .txt file (e.g. 'EPUB-checker_log.txt' or ending with '_log.txt')")
        epubcheck_path = os.path.join(project_dir, epubcheck_report.filename)
        with open(epubcheck_path, "wb") as buffer:
            shutil.copyfileobj(epubcheck_report.file, buffer)
        job.epubcheck_report_filepath = epubcheck_path
        
    db.commit()
    return {"message": "Reports uploaded successfully"}
@router.post("/jobs/{job_id}/upload-epub")
def upload_epub(
    job_id: int, 
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...), 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Upload EPUB and advance job to the next stage."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if not file.filename.endswith('.epub'):
        raise HTTPException(status_code=400, detail="File must be an EPUB")

    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_upload_dir = os.path.join(upload_dir, "bod")
    
    project_dir = os.path.join(bod_upload_dir, "BOD", job.project_name)
    os.makedirs(project_dir, exist_ok=True)

    # Determine user identifier (firstname + lastname preferred, fallback to username)
    user_identifier = None
    if current_user:
        first_name = current_user.get("first_name") if isinstance(current_user, dict) else getattr(current_user, "first_name", None)
        last_name = current_user.get("last_name") if isinstance(current_user, dict) else getattr(current_user, "last_name", None)
        full_name = f"{first_name or ''} {last_name or ''}".strip()
        if full_name:
            user_identifier = full_name
        else:
            user_identifier = current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None)
    
    if not user_identifier:
        user_identifier = job.current_assignee or "unknown"
        
    user_identifier = re.sub(r'[^a-zA-Z0-9_\-]', '_', user_identifier)

    # If an EPUB already exists for this job, create a backup
    if job.epub_filepath and os.path.exists(job.epub_filepath):
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        old_basename = os.path.basename(job.epub_filepath)
        name_no_ext, ext = os.path.splitext(old_basename)
        if not ext:
            ext = ".epub"
        backup_filename = f"{name_no_ext}_{user_identifier}_{timestamp_str}{ext}"
        
        # 1. Create a dedicated backup folder
        backup_dir = os.path.join(project_dir, "backup")
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, backup_filename)
        
        try:
            shutil.move(job.epub_filepath, backup_path)
            logger.info(f"Backed up existing EPUB to {backup_path}")
            
            # Record in job.file_history
            now_iso = datetime.now(timezone.utc).isoformat()
            file_hist = list(job.file_history or [])
            file_hist.append({
                "action": "reupload_backup",
                "original_filename": old_basename,
                "backup_filename": backup_filename,
                "backup_filepath": backup_path,
                "new_filename": file.filename,
                "user": user_identifier,
                "timestamp": now_iso,
                "stage": job.current_stage_name or "QC",
            })
            job.file_history = file_hist
        except Exception as e:
            logger.warning(f"Could not backup existing EPUB before upload: {e}")
    
    local_path = os.path.join(project_dir, file.filename)
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    job.epub_filename = file.filename
    job.epub_filepath = local_path
    
    # Clean up any previously extracted EPUB validator files & project records
    # so the new EPUB starts completely fresh in EPUB Validator
    try:
        from app.domains.post_prod.epub_validator.services.upload_service import UPLOAD_DIR
        from app.domains.post_prod.epub_validator.services import ev_projects_db
        from app.domains.post_prod.epub_validator.models import EvProject
        
        validator_folder_name = job.project_name or (job.pdf_filename.rsplit('.', 1)[0] if job.pdf_filename else f"bod_job_{job.id}")
        validator_folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', validator_folder_name)
        
        existing_ev_project = db.query(EvProject).filter(
            EvProject.folder_name == validator_folder_name
        ).first()
        
        if existing_ev_project:
            ev_projects_db.hard_delete_project(db, project_id=existing_ev_project.id)
            
        validator_disk_folder = os.path.join(UPLOAD_DIR, validator_folder_name)
        if os.path.exists(validator_disk_folder):
            shutil.rmtree(validator_disk_folder, ignore_errors=True)
    except Exception as e:
        logger.warning(f"Could not reset existing EPUB validator data on reupload: {e}")

    now_iso = datetime.now(timezone.utc).isoformat()
    history = dict(job.stage_history)
    
    stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Production,QC,Ready to Dispatch,Archive"
    stages = [s.strip() for s in stages_str.split(",")]
    
    qc_index = stages.index("QC") if "QC" in stages else 2
    
    # Auto-advance directly to QC if not already there or past it
    if job.current_stage_index < qc_index:
        # End current stage
        current_stage = job.current_stage_name
        stage_data = history.get(current_stage, {})
        stage_data["end_time"] = now_iso
        history[current_stage] = stage_data
        
        # Advance directly to QC
        job.current_stage_index = qc_index
        job.current_stage_name = "QC"
        
        # Set start time for QC
        new_stage_data = history.get("QC", {})
        new_stage_data["start_time"] = now_iso
        history["QC"] = new_stage_data
        
        # Unassign the job
        job.current_assignee = None
        
        # Send email
        if settings.BOD_MANAGER_EMAIL:
            send_bod_qc_ready_email(settings.BOD_MANAGER_EMAIL, job.project_name, job.epub_filename or job.pdf_filename)
            
    job.stage_history = history
    db.commit()
    db.refresh(job)
    
    return {"message": "EPUB uploaded and moved to QC", "job": job}


@router.post("/jobs/{job_id}/upload-cover")
def upload_cover(
    job_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_from_cookie)
):
    """Upload or replace the cover image for a Books on Demand job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    allowed_exts = ('.jpg', '.jpeg')
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Cover file must be an image ({', '.join(allowed_exts)})")

    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_upload_dir = os.path.join(upload_dir, "bod")
    project_dir = os.path.join(bod_upload_dir, "BOD", job.project_name or f"job_{job.id}")
    os.makedirs(project_dir, exist_ok=True)

    # Determine user identifier for backup/audit
    user_identifier = None
    if current_user:
        first_name = current_user.get("first_name") if isinstance(current_user, dict) else getattr(current_user, "first_name", None)
        last_name = current_user.get("last_name") if isinstance(current_user, dict) else getattr(current_user, "last_name", None)
        full_name = f"{first_name or ''} {last_name or ''}".strip()
        user_identifier = full_name or (current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None))
    if not user_identifier:
        user_identifier = job.current_assignee or "System"

    # Backup existing cover if present
    if job.cover_filepath and os.path.exists(job.cover_filepath):
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        old_basename = os.path.basename(job.cover_filepath)
        name_no_ext, old_ext = os.path.splitext(old_basename)
        backup_filename = f"{name_no_ext}_{re.sub(r'[^a-zA-Z0-9_-]', '_', user_identifier)}_{timestamp_str}{old_ext}"
        backup_dir = os.path.join(project_dir, "backup")
        os.makedirs(backup_dir, exist_ok=True)
        backup_path = os.path.join(backup_dir, backup_filename)
        try:
            shutil.move(job.cover_filepath, backup_path)
            logger.info(f"Backed up existing cover to {backup_path}")
        except Exception as e:
            logger.warning(f"Could not backup existing cover image: {e}")

    cover_filename = file.filename
    target_cover_path = os.path.join(project_dir, cover_filename)
    with open(target_cover_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    job.cover_filename = cover_filename
    job.cover_filepath = target_cover_path

    # Record in file history
    from sqlalchemy.orm.attributes import flag_modified
    now_iso = datetime.now(timezone.utc).isoformat()
    file_hist = list(job.file_history or [])
    file_hist.append({
        "action": "upload_cover",
        "cover_filename": cover_filename,
        "cover_filepath": target_cover_path,
        "user": user_identifier,
        "timestamp": now_iso,
        "stage": job.current_stage_name or "Production"
    })
    job.file_history = file_hist
    flag_modified(job, "file_history")

    db.commit()
    db.refresh(job)

    return {
        "status": True,
        "message": "Cover image uploaded successfully",
        "cover_filename": job.cover_filename,
        "job": job
    }


@router.post("/jobs")
def create_job(
    file: UploadFile = File(...),
    cover_file: Optional[UploadFile] = File(None),
    is_fastrack: bool = Form(False),
    db: Session = Depends(get_db)
):
    """Manually upload a PDF to create a Books on Demand job via the UI."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
        
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_upload_dir = os.path.join(upload_dir, "bod")
    
    project_name = file.filename.rsplit('.', 1)[0]
    
    project_dir = os.path.join(bod_upload_dir, "BOD", project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    local_path = os.path.join(project_dir, file.filename)
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    page_count = None
    pdf_type = None
    pdf_language = "None"
    try:
        import fitz
        doc = fitz.open(local_path)
        page_count = doc.page_count
        
        # Determine PDF type and language
        pdf_type = "Image PDF"
        text_content = ""
        for i in range(min(5, doc.page_count)):
            page = doc[i]
            text = page.get_text().strip()
            if text:
                pdf_type = "Text PDF"
                text_content += text + " "
        
        if text_content:
            try:
                from langdetect import detect
                code = detect(text_content)
                from app.core.config import LANGUAGE_MAP
                pdf_language = LANGUAGE_MAP.get(code, code.upper())
            except Exception:
                pass
        
        doc.close()
    except Exception as e:
        logger.error(f"Failed to extract page count and type for {file.filename}: {e}")
        
    stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Production,QC,Ready to Dispatch,Archive"
    stages = [s.strip() for s in stages_str.split(",")]
    first_stage = stages[0]
    
    now_iso = datetime.now(timezone.utc).isoformat()
    now_utc = datetime.now(timezone.utc)
    from datetime import timedelta
    
    initial_history = {
        first_stage: {
            "start_time": now_iso
        }
    }
    
    # Handle optional cover image upload during job creation
    cover_filename = None
    cover_filepath = None
    if cover_file and cover_file.filename:
        c_ext = os.path.splitext(cover_file.filename)[1].lower()
        if c_ext in ('.jpg', '.jpeg'):
            cover_filename = cover_file.filename
            cover_filepath = os.path.join(project_dir, cover_filename)
            with open(cover_filepath, "wb") as c_buf:
                shutil.copyfileobj(cover_file.file, c_buf)

    # Automatically extract eISBN if present in filename or project_name
    extracted_eisbn = None
    for cand in (file.filename, project_name):
        if cand:
            m_isbn = re.search(r'(\d{10,13})', cand)
            if m_isbn:
                extracted_eisbn = m_isbn.group(1)
                break

    new_job = BodJob(
        project_name=project_name,
        pdf_filename=file.filename,
        pdf_filepath=local_path,
        eisbn=extracted_eisbn,
        cover_filename=cover_filename,
        cover_filepath=cover_filepath,
        pdf_page_count=page_count,
        pdf_type=pdf_type,
        pdf_language=pdf_language,
        current_stage_index=0,
        current_stage_name=first_stage,
        stage_history=initial_history,
        status="Active",
        created_at=now_utc,
        due_date=calculate_bod_due_date(pdf_type, page_count, now_utc),
        is_fastrack=is_fastrack
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)
    
    # Send email
    if settings.BOD_MANAGER_EMAIL:
        send_bod_new_job_email(settings.BOD_MANAGER_EMAIL, new_job.project_name, file.filename, cover_filename=cover_filename)
    
    return {"message": "Job created successfully", "job": new_job}


@router.post("/jobs/{job_id}/sync-validator")
def sync_job_to_validator(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_from_cookie)
):
    """
    Sync/export the BOD job's EPUB and PDF into the Post-Prod EPUB Validator workspace
    under client='Books on Demand', client_code='BOD'.
    Returns the EPUB Validator project details so the frontend can redirect directly.
    """
    import zipfile
    from app.domains.post_prod.epub_validator.services.upload_service import UPLOAD_DIR, EXTRACT_DIR
    from app.domains.post_prod.epub_validator.services import ev_projects_db
    from app.domains.post_prod.epub_validator.models import EvProject

    job = db.query(BodJob).filter(BodJob.id == job_id, BodJob.is_deleted == False).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not job.epub_filepath or not os.path.exists(job.epub_filepath):
        raise HTTPException(status_code=400, detail="Processed EPUB not found for this job. Please ensure EPUB is uploaded first.")

    folder_name = job.project_name or (job.pdf_filename.rsplit('.', 1)[0] if job.pdf_filename else f"bod_job_{job.id}")
    folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)

    project_dir = os.path.join(UPLOAD_DIR, folder_name)
    extract_folder = os.path.join(project_dir, EXTRACT_DIR)
    os.makedirs(extract_folder, exist_ok=True)

    # Check if project already exists in ev_projects and is already extracted
    existing_proj = db.query(EvProject).filter(
        EvProject.folder_name == folder_name,
        EvProject.is_deleted == False
    ).first()

    dest_epub_path = os.path.join(extract_folder, job.epub_filename or os.path.basename(job.epub_filepath))
    epub_extract_path = os.path.join(extract_folder, "epub")

    # Only copy and extract if not already extracted or if epub folder is missing
    already_extracted = os.path.exists(epub_extract_path) and any(os.scandir(epub_extract_path))

    if not already_extracted:
        # Copy EPUB file to extract folder
        try:
            shutil.copy2(job.epub_filepath, dest_epub_path)
        except Exception as e:
            logger.error(f"Error copying EPUB to validator folder: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to copy EPUB: {str(e)}")

        # Copy PDF file if available
        if job.pdf_filepath and os.path.exists(job.pdf_filepath):
            dest_pdf_path = os.path.join(extract_folder, job.pdf_filename or os.path.basename(job.pdf_filepath))
            try:
                shutil.copy2(job.pdf_filepath, dest_pdf_path)
            except Exception as e:
                logger.warning(f"Could not copy PDF to validator folder: {e}")

        # Extract EPUB contents into extract/epub/
        if os.path.exists(epub_extract_path):
            shutil.rmtree(epub_extract_path, ignore_errors=True)
        os.makedirs(epub_extract_path, exist_ok=True)

        try:
            with zipfile.ZipFile(dest_epub_path, "r") as epub_ref:
                epub_ref.extractall(epub_extract_path)
        except Exception as e:
            logger.error(f"Failed to unzip EPUB {dest_epub_path}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to unpack EPUB: {str(e)}")

    total_files = sum(len(files) for _, _, files in os.walk(epub_extract_path))

    # Priority source: eisbn from bod_jobs table (always synced to EPUB Validator)
    job_eisbn = (getattr(job, "eisbn", None) or "").strip() or None
    if not job_eisbn:
        m = re.search(r'(\d{10,13})', job.epub_filename or "")
        if m:
            job_eisbn = m.group(1)

    user_id = current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id", None)
    username = current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None)
    assignee_to_set = username or job.current_assignee or None

    if existing_proj:
        existing_proj.epub_path = dest_epub_path
        existing_proj.total_files = total_files
        existing_proj.client = "Books on Demand"
        existing_proj.client_code = "BOD"
        existing_proj.updated_at = datetime.now(timezone.utc)
        if assignee_to_set:
            existing_proj.assignee = assignee_to_set
        # Every time EPUB validator is opened/synced, update eisbn from BoD
        existing_proj.eisbn = job_eisbn
        db.commit()
        db.refresh(existing_proj)
        proj_data = ev_projects_db._serialize(existing_proj)
    else:
        proj_data = ev_projects_db.create_project(
            db,
            client="Books on Demand",
            client_code="BOD",
            project_name=job.project_name or folder_name,
            folder_name=folder_name,
            epub_path=dest_epub_path,
            total_files=total_files,
            user_id=user_id,
            assignee=assignee_to_set,
            eisbn=job_eisbn,
        )

    return {
        "status": True,
        "message": "Job synced to EPUB Validator successfully",
        "project": proj_data,
        "project_id": proj_data.get("id"),
        "folder_name": folder_name
    }


@router.post("/jobs/{job_id}/sync-qc-reports-and-complete")
def sync_qc_reports_and_complete(
    job_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user_from_cookie)
):
    """
    Syncs the latest validated EPUB, ACE report, and EPUBCheck report from EPUB Validator
    into the BOD project folder, backs up existing files to _before, and advances QC stage.
    """
    import zipfile
    import io
    from app.domains.post_prod.epub_validator.services.upload_service import UPLOAD_DIR
    from app.domains.post_prod.epub_validator.services.epubcheck_service import get_cached_epubcheck_report, generate_epubcheck_txt_report
    from app.domains.post_prod.epub_validator.services.ace_service import get_ace_report_zip_path, html_report_dir

    job = db.query(BodJob).filter(BodJob.id == job_id, BodJob.is_deleted == False).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    folder_name = job.project_name or (job.pdf_filename.rsplit('.', 1)[0] if job.pdf_filename else f"bod_job_{job.id}")
    folder_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', folder_name)

    validator_project_dir = os.path.join(UPLOAD_DIR, folder_name)
    epub_source_dir = os.path.join(validator_project_dir, "extract", "epub")

    if not os.path.exists(epub_source_dir):
        raise HTTPException(status_code=404, detail=f"Validated EPUB source directory not found for '{folder_name}'")

    settings = get_settings()
    bod_upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_project_dir = os.path.join(bod_upload_dir, "bod", "BOD", job.project_name or folder_name)
    os.makedirs(bod_project_dir, exist_ok=True)

    # 1. Prepare _before folder to archive current files
    before_dir = os.path.join(bod_project_dir, "_before")
    os.makedirs(before_dir, exist_ok=True)

    timestamp_suffix = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    # Move current EPUB to _before if exists
    if job.epub_filepath and os.path.exists(job.epub_filepath):
        old_epub_name = os.path.basename(job.epub_filepath)
        dest_before_epub = os.path.join(before_dir, f"{old_epub_name}.{timestamp_suffix}")
        try:
            shutil.copy2(job.epub_filepath, dest_before_epub)
        except Exception as e:
            logger.warning(f"Could not backup existing EPUB: {e}")

    # Move current ACE report to _before if exists
    if job.ace_report_filepath and os.path.exists(job.ace_report_filepath):
        old_ace_name = os.path.basename(job.ace_report_filepath)
        dest_before_ace = os.path.join(before_dir, f"{old_ace_name}.{timestamp_suffix}")
        try:
            shutil.copy2(job.ace_report_filepath, dest_before_ace)
        except Exception as e:
            logger.warning(f"Could not backup existing ACE report: {e}")

    # Move current Epubcheck report to _before if exists
    if job.epubcheck_report_filepath and os.path.exists(job.epubcheck_report_filepath):
        old_check_name = os.path.basename(job.epubcheck_report_filepath)
        dest_before_check = os.path.join(before_dir, f"{old_check_name}.{timestamp_suffix}")
        try:
            shutil.copy2(job.epubcheck_report_filepath, dest_before_check)
        except Exception as e:
            logger.warning(f"Could not backup existing Epubcheck report: {e}")

    # 2. Package the latest EPUB from validator into bod_project_dir
    target_epub_filename = job.epub_filename or f"{folder_name}.epub"
    target_epub_path = os.path.join(bod_project_dir, target_epub_filename)

    with zipfile.ZipFile(target_epub_path, "w") as zf:
        mimetype_path = os.path.join(epub_source_dir, "mimetype")
        if os.path.isfile(mimetype_path):
            zf.write(mimetype_path, "mimetype", compress_type=zipfile.ZIP_STORED)
        else:
            info = zipfile.ZipInfo("mimetype")
            info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, "application/epub+zip")
        for root, _, files in os.walk(epub_source_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, epub_source_dir)
                if rel_path != "mimetype":
                    zf.write(full_path, rel_path, compress_type=zipfile.ZIP_DEFLATED)

    job.epub_filename = target_epub_filename
    job.epub_filepath = target_epub_path

    # 3. Locate or generate ACE Report ZIP
    try:
        h_dir = html_report_dir(folder_name)
        if h_dir.is_dir():
            ace_zip_source = get_ace_report_zip_path(folder_name)
            if ace_zip_source.is_file():
                ace_filename = f"{job.project_name or folder_name}_ace_report.zip"
                ace_dest_path = os.path.join(bod_project_dir, ace_filename)
                shutil.copy2(str(ace_zip_source), ace_dest_path)
                job.ace_report_filepath = ace_dest_path
    except Exception as e:
        logger.warning(f"ACE report sync skipped: {e}")

    # 4. Locate or generate EPUBCheck Report TXT
    try:
        cached_epubcheck = get_cached_epubcheck_report(folder_name)
        if cached_epubcheck and cached_epubcheck.get("status") != "fatal":
            txt_content, txt_fn, _ = generate_epubcheck_txt_report(folder_name, db)
            epubcheck_filename = f"{job.project_name or folder_name}_log.txt"
            epubcheck_dest_path = os.path.join(bod_project_dir, epubcheck_filename)
            with open(epubcheck_dest_path, "w", encoding="utf-8") as f:
                f.write(txt_content)
            job.epubcheck_report_filepath = epubcheck_dest_path
    except Exception as e:
        logger.warning(f"EPUBCheck report sync skipped: {e}")

    # 5. Generate history.csv for the job
    try:
        generate_bod_history_csv(job, bod_project_dir)
        logger.info(f"Generated history.csv for job {job.id} ({job.project_name})")
    except Exception as e:
        logger.warning(f"Could not generate history.csv during QC complete: {e}")

    db.commit()
    db.refresh(job)

    # 6. Advance stage to Ready to Dispatch if in QC & auto-assign to BOD Manager
    if job.current_stage_name == "QC":
        _advance_job_logic(job, background_tasks, db)
    else:
        from app.domains.auth.models import User
        settings = get_settings()
        manager_email = getattr(settings, "BOD_MANAGER_EMAIL", None)
        manager_user = None
        if manager_email:
            manager_user = db.query(User).filter(User.email.ilike(manager_email.strip())).first()
        manager_assignee = manager_user.username if manager_user else (manager_email or "System")

        job.current_assignee = manager_assignee
        db.commit()
        db.refresh(job)

    # Also unassign the EPUB Validator project record
    from app.domains.post_prod.epub_validator.models import EvProject
    ev_proj = db.query(EvProject).filter(
        EvProject.folder_name == folder_name,
        EvProject.is_deleted == False
    ).first()
    if ev_proj:
        ev_proj.assignee = None
        db.commit()

    return {
        "status": True,
        "message": "EPUB and QC reports updated to BOD folder, old files archived to _before, stage moved to Ready to Dispatch, and job unassigned.",
        "job": job
    }
