import logging
import os
from datetime import datetime, timezone
from app.core.celery_app import celery_app
from app.database import SessionLocal
from app.domains.books_on_demand.models import BodJob
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.books_on_demand.utils import calculate_bod_due_date
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
        if not getattr(settings, "BOD_FTP_WATCH_ENABLED", True):
            logger.info("BOD FTP watch is disabled via BOD_FTP_WATCH_ENABLED. Skipping.")
            return

        if not settings.BOD_FTP_HOST:
            logger.error("BOD_FTP_HOST is not set. Skipping FTP watch.")
            return

        try:
            with BodFtpService(
                settings.BOD_FTP_HOST,
                settings.BOD_FTP_USERNAME,
                settings.BOD_FTP_PASSWORD,
                port=getattr(settings, "BOD_FTP_PORT", 21),
                timeout=getattr(settings, "BOD_FTP_TIMEOUT", 15)
            ) as ftp:
                target_dir = settings.BOD_FTP_BASE_PATH if settings.BOD_FTP_BASE_PATH else "BOD"
                try:
                    ftp.ftp.cwd(target_dir)
                except Exception as e:
                    logger.error(f"Failed to change directory to BOD on FTP {settings.BOD_FTP_HOST}: {str(e)}")
                    return
                    
                all_ftp_files = ftp.list_files()
                pdfs = [f for f in all_ftp_files if f.lower().endswith('.pdf')]

                for pdf_name in pdfs:
                    # Check if an active (non-deleted) job already exists
                    active_job = db.query(BodJob).filter(
                        BodJob.pdf_filename == pdf_name,
                        BodJob.is_deleted == False
                    ).first()
                    
                    if active_job:
                        # Skip if there is already an active job for this PDF
                        continue

                    # If no active job exists (or previous was soft-deleted), ingest as a new row
                    logger.info(f"Found new PDF for BOD folder: {pdf_name}")
                    project_name = pdf_name.rsplit('.', 1)[0]
                    
                    project_dir = os.path.join(bod_upload_dir, "BOD", project_name)
                    os.makedirs(project_dir, exist_ok=True)
                    
                    local_path = os.path.join(project_dir, pdf_name)
                    ftp.download_file(pdf_name, local_path)

                    # Look for matching image/cover file (e.g. .jpg, .jpeg, .png)
                    cover_filename = None
                    cover_filepath = None
                    for ext in ('.jpg', '.jpeg', '.png', '.tif', '.tiff'):
                        candidate_name = f"{project_name}{ext}"
                        candidate_match = next((f for f in all_ftp_files if f.lower() == candidate_name.lower()), None)
                        if candidate_match:
                            cover_filename = candidate_match
                            cover_filepath = os.path.join(project_dir, candidate_match)
                            try:
                                ftp.download_file(candidate_match, cover_filepath)
                                logger.info(f"Found and downloaded matching cover {candidate_match} for {pdf_name}")
                            except Exception as err:
                                logger.error(f"Failed to download matching cover {candidate_match}: {err}")
                                cover_filename = None
                                cover_filepath = None
                            break
                    
                    page_count = None
                    pdf_type = None
                    pdf_language = "None"
                    try:
                        import fitz
                        doc = fitz.open(local_path)
                        page_count = doc.page_count
                        
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
                    
                    stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Production,QC,Ready to Dispatch,Archive"
                    stages = [s.strip() for s in stages_str.split(",")]
                    initial_stage_name = stages[0]
                    now_utc = datetime.now(timezone.utc)
                    now_iso = now_utc.isoformat()
                    
                    initial_history = {
                        initial_stage_name: {
                            "start_time": now_iso
                        }
                    }
                
                    new_job = BodJob(
                        project_name=project_name,
                        pdf_filename=pdf_name,
                        pdf_filepath=local_path,
                        cover_filename=cover_filename,
                        cover_filepath=cover_filepath,
                        pdf_page_count=page_count,
                        pdf_type=pdf_type,
                        pdf_language=pdf_language,
                        current_stage_index=0,
                        current_stage_name=initial_stage_name,
                        stage_history=initial_history,
                        status="Active",
                        created_at=now_utc,
                        due_date=calculate_bod_due_date(pdf_type, page_count, now_utc)
                    )
                    db.add(new_job)
                    db.commit()
                    db.refresh(new_job)
                    
                    if settings.BOD_MANAGER_EMAIL:
                        send_bod_new_job_email(
                            settings.BOD_MANAGER_EMAIL,
                            new_job.project_name,
                            pdf_name,
                            cover_filename=cover_filename
                        )

                    # Move the processed file(s) from input folder to dedicated project folder under Production on FTP
                    # Structure: BOD/Production/{year}/{month}/{date}/{project_name}/
                    prod_base = getattr(settings, "BOD_FTP_PRODUCTION_PATH", "Production") or "Production"
                    # If base_path is e.g. "BOD" and prod_base is "Production", resolve to "BOD/Production"
                    if target_dir and target_dir != "/" and not prod_base.startswith(target_dir):
                        prod_folder = f"{target_dir.strip('/')}/{prod_base.strip('/')}"
                    else:
                        prod_folder = prod_base.strip('/')

                    # Date-based folder structure: YYYY/MM/DD
                    year_str = now_utc.strftime("%Y")
                    month_str = now_utc.strftime("%m")
                    day_str = now_utc.strftime("%d")
                    project_prod_dir = f"{prod_folder}/{year_str}/{month_str}/{day_str}/{project_name}"

                    try:
                        # Ensure remote Production/{year}/{month}/{date}/{project_name} directory exists
                        ftp.ensure_dir(project_prod_dir)
                        
                        # Move PDF: e.g. from target_dir/pdf_name -> {project_prod_dir}/pdf_name
                        ftp.ftp.cwd("/")
                        remote_input_pdf = f"{target_dir.strip('/')}/{pdf_name}" if target_dir != "/" else f"/{pdf_name}"
                        remote_prod_pdf = f"{project_prod_dir}/{pdf_name}"
                        ftp.rename_or_move(remote_input_pdf, remote_prod_pdf)

                        # If cover was also downloaded, move cover file as well
                        if cover_filename:
                            remote_input_cover = f"{target_dir.strip('/')}/{cover_filename}" if target_dir != "/" else f"/{cover_filename}"
                            remote_prod_cover = f"{project_prod_dir}/{cover_filename}"
                            try:
                                ftp.rename_or_move(remote_input_cover, remote_prod_cover)
                            except Exception as ce:
                                logger.warning(f"Could not move cover {cover_filename} to {project_prod_dir}: {ce}")

                        # Switch back to input target_dir for remaining iterations
                        ftp.ftp.cwd("/")
                        ftp.ftp.cwd(target_dir)
                    except Exception as move_err:
                        logger.error(f"Failed to move {pdf_name} to {project_prod_dir} on FTP: {move_err}")
                        try:
                            ftp.ftp.cwd("/")
                            ftp.ftp.cwd(target_dir)
                        except Exception:
                            pass
                        
        except Exception as e:
            logger.error(f"Error processing FTP for BOD: {str(e)}")
    finally:
        db.close()
