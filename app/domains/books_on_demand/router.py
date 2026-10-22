from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
import os
import shutil
import logging
from datetime import datetime, timezone, timedelta

from app.database import get_db, SessionLocal
from app.domains.books_on_demand.models import BodJob
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.books_on_demand.utils import calculate_bod_due_date
from app.domains.notifications.email_service import send_bod_qc_ready_email, send_bod_new_job_email, send_bod_job_completed_email
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
    # Serialize to include client_name
    result = []
    for job in jobs:
        prod_info = (job.stage_history or {}).get("Production", {})
        pdf_downloaded = bool(prod_info.get("pdf_downloaded") or prod_info.get("pdf_downloaded_at"))
        job_dict = {
            "id": job.id,
            "pdf_filename": job.pdf_filename,
            "pdf_filepath": job.pdf_filepath,
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
            "epubcheck_report_filepath": job.epubcheck_report_filepath,
            "epubcheck_report_filename": os.path.basename(job.epubcheck_report_filepath) if job.epubcheck_report_filepath else None
        }
        result.append(job_dict)
    return result


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    """Get a specific BOD job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    prod_info = (job.stage_history or {}).get("Production", {})
    pdf_downloaded = bool(prod_info.get("pdf_downloaded") or prod_info.get("pdf_downloaded_at"))
    return {
        "id": job.id,
        "pdf_filename": job.pdf_filename,
        "pdf_filepath": job.pdf_filepath,
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
        "epubcheck_report_filepath": job.epubcheck_report_filepath,
        "epubcheck_report_filename": os.path.basename(job.epubcheck_report_filepath) if job.epubcheck_report_filepath else None
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
            customer_due = job.due_date + timedelta(days=1)
        elif job.created_at:
            is_image = bool(job.pdf_type and "image" in str(job.pdf_type).lower())
            days = 7 if is_image else 4
            customer_due = job.created_at + timedelta(days=days)

        report.append({
            "id": job.id,
            "client_name": "BOD",
            "pdf_filename": job.pdf_filename,
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
            "is_fastrack": bool(job.is_fastrack)
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
    
    # Attempt to delete local project directory
    import os, shutil
    if job.pdf_filepath:
        project_dir = os.path.dirname(job.pdf_filepath)
        if os.path.exists(project_dir):
            try:
                shutil.rmtree(project_dir)
            except Exception as e:
                print(f"Error removing {project_dir}: {e}")
            
    return {"status": "success"}


class BodFastrackToggleRequest(BaseModel):
    is_fastrack: bool


@router.put("/jobs/{job_id}/fastrack")
def toggle_fastrack(
    job_id: int,
    payload: BodFastrackToggleRequest,
    db: Session = Depends(get_db)
):
    """Enable or disable fastrack status for a BOD job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.is_fastrack = bool(payload.is_fastrack)
    db.commit()
    db.refresh(job)
    return {"status": "success", "job_id": job.id, "is_fastrack": bool(job.is_fastrack)}


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

    # 4. Due Date
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
    if new_stage in ("Production", "Ready to Dispatch") or current_stage == "QC":
        # Unassign assignee when moving to Production or when QC is completed
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
    
    # Send email if moving to QC or Archive
    if job.current_stage_name == "QC" and manager_email:
        send_bod_qc_ready_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)
    elif job.current_stage_name == "Archive" and manager_email:
        send_bod_job_completed_email(manager_email, job.project_name, job.epub_filename or job.pdf_filename)
        
    return {"message": "Job advanced successfully", "job": job}


import zipfile

def _execute_dispatch_and_upload(job: BodJob, db: Session, settings, dispatched_by: str = "System") -> tuple[bool, str | None]:
    """
    Packages EPUB and QC reports into a ZIP, uploads to FTP, and ONLY transitions
    the job to Archive / Completed status after the FTP upload succeeds.
    Returns (success: bool, error_message: str | None).
    """
    if not job.epub_filepath or not os.path.exists(job.epub_filepath):
        return False, "Cannot dispatch: EPUB file is missing"

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
            
        if job.epub_filepath:
            local_dir = os.path.dirname(job.epub_filepath)
        else:
            upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
            local_dir = os.path.join(upload_dir, "bod")
        os.makedirs(local_dir, exist_ok=True)
        zip_filepath = os.path.join(local_dir, zip_filename)

        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if os.path.exists(job.epub_filepath):
                zipf.write(job.epub_filepath, os.path.basename(job.epub_filepath))
            if job.ace_report_filepath and os.path.exists(job.ace_report_filepath):
                zipf.write(job.ace_report_filepath, os.path.basename(job.ace_report_filepath))
            if job.epubcheck_report_filepath and os.path.exists(job.epubcheck_report_filepath):
                zipf.write(job.epubcheck_report_filepath, os.path.basename(job.epubcheck_report_filepath))

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
        if not ace_report.filename.endswith("_ace_report.zip"):
            raise HTTPException(status_code=400, detail="ACE validation report must end with '_ace_report.zip'")
        ace_path = os.path.join(project_dir, ace_report.filename)
        with open(ace_path, "wb") as buffer:
            shutil.copyfileobj(ace_report.file, buffer)
        job.ace_report_filepath = ace_path
        
    if epubcheck_report:
        if not epubcheck_report.filename.endswith("_log.txt"):
            raise HTTPException(status_code=400, detail="Epubcheck validation report must end with '_log.txt'")
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
    db: Session = Depends(get_db)
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
    
    local_path = os.path.join(project_dir, file.filename)
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    job.epub_filename = file.filename
    job.epub_filepath = local_path
    
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


@router.post("/jobs")
def create_job(
    file: UploadFile = File(...),
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
    
    new_job = BodJob(
        project_name=project_name,
        pdf_filename=file.filename,
        pdf_filepath=local_path,
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
        send_bod_new_job_email(settings.BOD_MANAGER_EMAIL, new_job.project_name, file.filename)
    
    return {"message": "Job created successfully", "job": new_job}
