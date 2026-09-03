from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any
import os
import shutil
import logging
from datetime import datetime, timezone

from app.database import get_db, SessionLocal
from app.domains.books_on_demand.models import BodJob, BodClientConfig
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.notifications.email_service import send_bod_qc_ready_email, send_bod_new_job_email, send_bod_job_completed_email
from app.domains.auth.security import get_current_user_from_cookie
from app.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/configs")
def list_configs(db: Session = Depends(get_db)):
    """List active BOD client configurations."""
    configs = db.query(BodClientConfig).filter(BodClientConfig.is_active == True).all()
    return configs


@router.get("/jobs")
def list_jobs(client_id: int = None, status: str = None, db: Session = Depends(get_db)):
    """List all Book on Demand jobs with optional filtering."""
    query = db.query(BodJob).filter(BodJob.is_deleted == False)
    if client_id:
        query = query.filter(BodJob.client_id == client_id)
    if status:
        query = query.filter(BodJob.status == status)
    
    jobs = query.all()
    # Serialize to include client_name
    result = []
    for job in jobs:
        job_dict = {
            "id": job.id,
            "client_id": job.client_id,
            "pdf_filename": job.pdf_filename,
            "pdf_filepath": job.pdf_filepath,
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
            "client_name": job.client_config.client_name if job.client_config else "Unknown"
        }
        result.append(job_dict)
    return result


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    """Get a specific BOD job."""
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    return {
        "id": job.id,
        "client_id": job.client_id,
        "pdf_filename": job.pdf_filename,
        "pdf_filepath": job.pdf_filepath,
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
        "client_name": job.client_config.client_name if job.client_config else "Unknown"
    }

@router.get("/jobs/{job_id}/download-pdf")
def download_pdf(job_id: int, db: Session = Depends(get_db)):
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.pdf_filepath or not os.path.exists(job.pdf_filepath):
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(path=job.pdf_filepath, filename=job.pdf_filename, media_type='application/pdf')

@router.get("/jobs/{job_id}/download-epub")
def download_epub(job_id: int, db: Session = Depends(get_db)):
    job = db.query(BodJob).filter(BodJob.id == job_id).first()
    if not job or not job.epub_filepath or not os.path.exists(job.epub_filepath):
        raise HTTPException(status_code=404, detail="EPUB not found")
    return FileResponse(path=job.epub_filepath, filename=job.epub_filename, media_type='application/epub+zip')


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
        report.append({
            "id": job.id,
            "client_name": job.client_config.client_name if job.client_config else "Unknown",
            "pdf_filename": job.pdf_filename,
            "epub_filename": job.epub_filename,
            "current_stage": job.current_stage_name,
            "status": job.status,
            "stage_history": job.stage_history,
            "created_at": job.created_at,
            "updated_at": job.updated_at
        })
    return {"jobs": report}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db), current_user = Depends(get_current_user_from_cookie)):
    """Delete a job and its associated files. Only Admins can do this."""
    is_admin = (
        (current_user.access_level and current_user.access_level.lower() == 'admin') or
        (current_user.role and current_user.role.lower() == 'admin') or
        (current_user.designation and current_user.designation.lower() == 'admin')
    )
    if not is_admin:
        raise HTTPException(status_code=403, detail="Only Admins can delete jobs")
        
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
        raise HTTPException(status_code=400, detail="user_id is required")

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
    
    # Auto-advance if assigned during 'Add job'
    if job.current_stage_name == "Add job":
        # Call advance_job_stage logic
        _advance_job_logic(job, background_tasks, db)
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
    config = db.query(BodClientConfig).filter(BodClientConfig.id == job.client_id).first()
    
    stages = config.custom_stages if config.custom_stages else ["Add job", "Production", "QC", "Archive"]
    
    if job.current_stage_index >= len(stages) - 1:
        raise HTTPException(status_code=400, detail="Job is already at the final stage")
        
    # Mark end time for current stage
    now_iso = datetime.now(timezone.utc).isoformat()
    history = dict(job.stage_history)
    current_stage = job.current_stage_name
    stage_data = history.get(current_stage, {})
    stage_data["end_time"] = now_iso
    history[current_stage] = stage_data
    
    # Advance
    job.current_stage_index += 1
    new_stage = stages[job.current_stage_index]
    job.current_stage_name = new_stage
    
    # Set start time for next stage
    new_stage_data = history.get(new_stage, {})
    new_stage_data["start_time"] = now_iso
    history[new_stage] = new_stage_data
    
    job.stage_history = history
    
    # If moving to Archive, status becomes Completed
    if job.current_stage_index == len(stages) - 1:
        job.status = "Completed"
        
    db.commit()
    db.refresh(job)
    
    # Send email if moving to QC or Archive
    if job.current_stage_name == "QC":
        send_bod_qc_ready_email(config.manager_email, job.project_name, job.epub_filename or job.pdf_filename)
    elif job.current_stage_name == "Archive":
        send_bod_job_completed_email(config.manager_email, job.project_name, job.epub_filename or job.pdf_filename)
        
    # Upload to FTP if moving to Archive and epub exists
    if job.current_stage_name == "Archive" and job.epub_filename and job.epub_filepath:
        background_tasks.add_task(_upload_to_ftp_task, job.client_id, job.epub_filepath, job.epub_filename)

        
    return {"message": "Job advanced to next stage", "job": job}


def _upload_to_ftp_task(config_id: int, local_epub_path: str, remote_epub_name: str):
    db = SessionLocal()
    try:
        config = db.query(BodClientConfig).filter(BodClientConfig.id == config_id).first()
        if config:
            with BodFtpService(config.ftp_host, config.ftp_username, config.ftp_password) as ftp:
                ftp.upload_file(local_epub_path, f"/BOD/Delivery/{remote_epub_name}")
    except Exception as e:
        logger.error(f"Failed background FTP upload for {remote_epub_name}: {str(e)}")
    finally:
        db.close()


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
    
    config = db.query(BodClientConfig).filter(BodClientConfig.id == job.client_id).first()
    project_dir = os.path.join(bod_upload_dir, config.client_name, job.project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    local_path = os.path.join(project_dir, file.filename)
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    job.epub_filename = file.filename
    job.epub_filepath = local_path
    
    now_iso = datetime.now(timezone.utc).isoformat()
    history = dict(job.stage_history)
    
    config = db.query(BodClientConfig).filter(BodClientConfig.id == job.client_id).first()
    stages = config.custom_stages if config.custom_stages else ["Add job", "Production", "QC", "Archive"]
    
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
        send_bod_qc_ready_email(config.manager_email, job.project_name, job.epub_filename or job.pdf_filename)
            
    job.stage_history = history
    db.commit()
    db.refresh(job)
    
    return {"message": "EPUB uploaded and job advanced", "job": job}



def create_job(
    client_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Manually upload a PDF to create a Book on Demand job via the UI."""
    config = db.query(BodClientConfig).filter(BodClientConfig.id == client_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Client not found")
        
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
        
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_upload_dir = os.path.join(upload_dir, "bod")
    
    project_name = file.filename.rsplit('.', 1)[0]
    
    project_dir = os.path.join(bod_upload_dir, config.client_name, project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    local_path = os.path.join(project_dir, file.filename)
    
    with open(local_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    stages = config.custom_stages if config.custom_stages else ["Add job", "Production", "QC", "Archive"]
    first_stage = stages[0]
    
    now_iso = datetime.now(timezone.utc).isoformat()
    initial_history = {
        first_stage: {
            "start_time": now_iso
        }
    }
    
    new_job = BodJob(
        client_id=client_id,
        project_name=project_name,
        pdf_filename=file.filename,
        pdf_filepath=local_path,
        current_stage_index=0,
        current_stage_name=first_stage,
        stage_history=initial_history,
        status="Active"
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)
    
    # Send email
    send_bod_new_job_email(config.manager_email, new_job.project_name, file.filename)
    
    return {"message": "Job created successfully", "job": new_job}
