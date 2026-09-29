import logging
import os
from datetime import datetime, timezone
from app.core.celery_app import celery_app
from app.database import SessionLocal
from app.domains.books_on_demand.models import BodClientConfig, BodJob
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.notifications.email_service import send_bod_new_job_email
from app.core.config import get_settings

logger = logging.getLogger("app.worker.bod")

@celery_app.task(acks_late=True)
def watch_ftp_for_new_pdfs():
    logger.info("Starting FTP watch for Books on Demand PDFs...")
    db = SessionLocal()
    settings = get_settings()
    upload_dir = getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads")
    bod_upload_dir = os.path.join(upload_dir, "bod")
    os.makedirs(bod_upload_dir, exist_ok=True)
    
    try:
        active_configs = db.query(BodClientConfig).filter(BodClientConfig.is_active == True).all()
        for config in active_configs:
            try:
                with BodFtpService(config.ftp_host, config.ftp_username, config.ftp_password) as ftp:
                    # Navigate to the configured base path or default to "BOD"
                    target_dir = config.ftp_base_path if config.ftp_base_path else "BOD"
                    try:
                        ftp.ftp.cwd(target_dir)
                    except Exception as e:
                        logger.error(f"Failed to change directory to BOD on FTP {config.ftp_host}: {str(e)}")
                        continue
                        
                    pdfs = ftp.list_pdfs()
                    for pdf_name in pdfs:
                        # Check if job already exists
                        existing_job = db.query(BodJob).filter(
                            BodJob.client_id == config.id,
                            BodJob.pdf_filename == pdf_name
                        ).first()
                        
                        if not existing_job:
                            logger.info(f"Found new PDF for {config.client_name} in BOD folder: {pdf_name}")
                            project_name = pdf_name.rsplit('.', 1)[0]
                            
                            # Create directory bod_upload_dir / client_name / project_name
                            project_dir = os.path.join(bod_upload_dir, config.client_name, project_name)
                            os.makedirs(project_dir, exist_ok=True)
                            
                            local_path = os.path.join(project_dir, pdf_name)
                            ftp.download_file(pdf_name, local_path)
                            
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
                                logger.error(f"Failed to extract page count and type for {pdf_name}: {e}")
                            
                            # Create Job
                            initial_stage_name = config.custom_stages[0] if config.custom_stages else "Add job"
                            now_iso = datetime.now(timezone.utc).isoformat()
                            initial_history = {
                                initial_stage_name: {
                                    "start_time": now_iso
                                }
                            }
                        
                            new_job = BodJob(
                                client_id=config.id,
                                project_name=project_name,
                                pdf_filename=pdf_name,
                                pdf_filepath=local_path,
                                pdf_page_count=page_count,
                                pdf_type=pdf_type,
                                pdf_language=pdf_language,
                                current_stage_index=0,
                                current_stage_name=initial_stage_name,
                                stage_history=initial_history,
                                status="Active"
                            )
                            db.add(new_job)
                            db.commit()
                            db.refresh(new_job)
                            
                            if config.manager_email:
                                send_bod_new_job_email(config.manager_email, new_job.project_name, pdf_name)
                            
            except Exception as e:
                logger.error(f"Error processing FTP for client {config.client_name}: {str(e)}")
    finally:
        db.close()
