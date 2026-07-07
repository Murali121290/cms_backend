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
def run_post_prod_conversion_task(chapter_id: int):
    """
    Background task to run post-production InDesign/PDF conversion sequentially
    using a Redis lock.
    """
    import redis
    import logging
    from app.core.config import get_settings
    from app.domains.post_prod.api_v1 import run_conversion_background
    from app.database import SessionLocal

    logger = logging.getLogger("app.worker.post_prod")
    settings = get_settings()
    
    redis_client = redis.from_url(settings.REDIS_URL)
    
    lock = redis_client.lock("indesign_conversion_lock", timeout=1200, blocking_timeout=1200)
    acquired = lock.acquire()
    if not acquired:
        logger.error(f"Failed to acquire conversion lock for chapter {chapter_id}")
        return {"status": "failed", "error": "Could not acquire conversion lock"}
        
    try:
        logger.info(f"Acquired conversion lock. Starting conversion for chapter {chapter_id}")
        run_conversion_background(chapter_id, SessionLocal)
        return {"status": "completed", "chapter_id": chapter_id}
    except Exception as e:
        logger.exception(f"Error in Celery conversion task for chapter {chapter_id}")
        return {"status": "failed", "error": str(e)}
    finally:
        try:
            lock.release()
            logger.info(f"Released conversion lock for chapter {chapter_id}")
        except Exception:
            pass
