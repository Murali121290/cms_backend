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
