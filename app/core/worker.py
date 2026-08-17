from app.core.celery_app import celery_app
from docx import Document
import lxml.etree as ET
import os

@celery_app.task(acks_late=True)
def process_document(file_path: str, project_id: int):
    """
    Background task to process uploaded docx files.
    Demonstrates python-docx and lxml usage.
    """
    try:
        if not os.path.exists(file_path):
            return {"status": "failed", "error": "File not found"}

        # 1. Read DOCX
        doc = Document(file_path)
        
        # 2. Extract Metadata (Mocking complex logic)
        word_count = sum(len(p.text.split()) for p in doc.paragraphs)
        
        # 3. XML Processing (Mocking JATS/BITS generation)
        # In a real scenario, this would convert docx content to XML
        root = ET.Element("article")
        meta = ET.SubElement(root, "front")
        ET.SubElement(meta, "word-count").text = str(word_count)
        
        xml_content = ET.tostring(root, pretty_print=True).decode()
        
        # Return result (in production, save this to DB)
        return {
            "status": "completed", 
            "project_id": project_id, 
            "word_count": word_count,
            "preview_xml": xml_content
        }
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(acks_late=True)
def run_post_prod_conversion_task(chapter_id: int, job_id: int | None = None):
    """
    Background task to run post-production InDesign/PDF conversion sequentially
    using a Redis lock.
    """
    import redis
    import logging
    import time
    from app.core.config import get_settings
    from app.domains.post_prod.word_conversion.converter import run_conversion_background
    from app.database import SessionLocal

    logger = logging.getLogger("app.worker.post_prod")
    settings = get_settings()
    
    redis_client = redis.from_url(settings.REDIS_URL)
    lock = redis_client.lock("indesign_conversion_lock", timeout=1200)
    
    db = SessionLocal()
    try:
        from app.models import ProcessingJob
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first() if job_id else None
        
        logger.info(f"Task {job_id} entering prioritization lock loop...")
        while True:
            if job:
                db.refresh(job)
                if job.status == "cancelled":
                    logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                    return {"status": "cancelled", "chapter_id": chapter_id}
            
            # Check for higher priority jobs waiting
            higher_job = None
            if job:
                higher_job = db.query(ProcessingJob).filter(
                    ProcessingJob.status.in_(["pending", "processing"]),
                    ProcessingJob.id != job.id,
                    ProcessingJob.process_type.in_([
                        "xml_to_indesign",
                        "post_prod_conversion",
                        "ppd",
                        "reference_validation",
                        "reference_number_validation",
                        "reference_apa_chicago_validation",
                        "reference_report_only",
                        "reference_structuring"
                    ])
                ).filter(
                    (ProcessingJob.priority > job.priority) |
                    ((ProcessingJob.priority == job.priority) & (ProcessingJob.id < job.id))
                ).first()
            
            if higher_job:
                time.sleep(2)
                continue
                
            # Attempt to acquire lock non-blockingly
            acquired = lock.acquire(blocking=False)
            if acquired:
                break
            time.sleep(2)
            
        logger.info(f"Acquired conversion lock. Starting conversion for chapter {chapter_id}")
        run_conversion_background(chapter_id, SessionLocal, job_id)
        return {"status": "completed", "chapter_id": chapter_id}
    except Exception as e:
        logger.exception(f"Error in Celery conversion task for chapter {chapter_id}")
        return {"status": "failed", "error": str(e)}
    finally:
        db.close()
        try:
            lock.release()
            logger.info(f"Released conversion lock for chapter {chapter_id}")
        except Exception:
            pass


@celery_app.task(bind=True, acks_late=True, name="app.core.worker.run_epub_validation_task")
def run_epub_validation_task(
    self,
    folder_name: str,
    epub_folder: str,
    customer: str | None = None,
    user_id: int | None = None,
    username: str | None = None,
):
    """
    Background Celery task for EPUB validation.

    Runs validate_epub() and streams per-rule progress to Redis so the
    frontend can poll and display 'Currently running: <rule_name>'.
    """
    import json
    import logging
    import redis as redis_lib

    from app.core.config import get_settings
    from app.database import SessionLocal
    from app.domains.post_prod.epub_validator.engine.runner import validate_epub
    from app.domains.post_prod.epub_validator.services import ev_projects_db

    logger = logging.getLogger("app.worker.epub_validator")
    settings = get_settings()
    r = redis_lib.from_url(settings.REDIS_URL)
    task_id = self.request.id
    progress_key = f"epub_progress:{task_id}"

    def _write_progress(info: dict):
        """Write current rule progress to Redis (TTL 10 min)."""
        r.setex(progress_key, 600, json.dumps({"status": "running", **info}))

    logger.info(f"[epub-task] {task_id} starting validation for {folder_name}")

    try:
        result = validate_epub(
            epub_folder=epub_folder,
            folder_name=folder_name,
            customer=customer,
            progress_callback=_write_progress,
        )

        # Save result to DB
        db = SessionLocal()
        try:
            ev_projects_db.save_validation_run(
                db,
                folder_name=folder_name,
                validation_result=result,
                user_id=user_id,
                username=username,
            )
        finally:
            db.close()

        # Mark completed in Redis
        r.setex(progress_key, 300, json.dumps({"status": "completed"}))
        logger.info(f"[epub-task] {task_id} completed for {folder_name}")
        return result

    except Exception as e:
        logger.exception(f"[epub-task] {task_id} failed for {folder_name}")
        r.setex(progress_key, 300, json.dumps({"status": "failed", "error": str(e)}))
        raise

