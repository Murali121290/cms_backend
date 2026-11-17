import logging
import os
import re
import csv
from datetime import datetime, timezone
from app.core.celery_app import celery_app
from app.database import SessionLocal
from app.domains.books_on_demand.models import BodJob, BodCsvEntry
from app.domains.books_on_demand.services.ftp_service import BodFtpService
from app.domains.books_on_demand.utils import calculate_bod_due_date
from app.domains.notifications.email_service import send_bod_new_job_email
from app.core.config import get_settings

logger = logging.getLogger("app.worker.bod")


def _parse_and_store_csv_entries(db, csv_content: str, source_csv_filename: str):
    """
    Parses CSV content and stores all rows/ISBNs into bod_csv_entries table.
    Preserves ISBNs whether or not their PDF has arrived yet.
    """
    try:
        lines = csv_content.strip().splitlines()
        if not lines:
            return

        reader = csv.DictReader(lines)
        if reader.fieldnames:
            isbn_col = None
            filename_col = None
            pages_col = None
            pdf_type_col = None
            lang_col = None

            for col in reader.fieldnames:
                if not col:
                    continue
                cl = col.strip()
                if re.search(r'\b(?:e-?isbn|isbn)\b', cl, re.IGNORECASE):
                    isbn_col = col
                elif re.search(r'\b(?:file\s*name|filename|file)\b', cl, re.IGNORECASE):
                    filename_col = col
                elif re.search(r'\b(?:pages?|page\s*count)\b', cl, re.IGNORECASE):
                    pages_col = col
                elif re.search(r'\b(?:pdf\s*type|type)\b', cl, re.IGNORECASE):
                    pdf_type_col = col
                elif re.search(r'\b(?:lang|language)\b', cl, re.IGNORECASE):
                    lang_col = col

            for row in reader:
                raw_isbn = str(row.get(isbn_col, "") or "").strip() if isbn_col else ""
                raw_fn = str(row.get(filename_col, "") or "").strip() if filename_col else ""

                # Check if raw_fn has clean 10 or 13 digit ISBN
                fn_digits = "".join(ch for ch in raw_fn.rsplit('.', 1)[0] if ch.isdigit()) if raw_fn else ""

                # Valid ISBNs are standard 10 or 13 digits
                isbn_digits = ""
                raw_digits = "".join(ch for ch in raw_isbn if ch.isdigit())

                if "e+" in raw_isbn.lower() and len(fn_digits) in (10, 13):
                    isbn_digits = fn_digits
                elif len(raw_digits) in (10, 13):
                    isbn_digits = raw_digits
                elif len(fn_digits) in (10, 13):
                    isbn_digits = fn_digits

                # Do NOT treat random numbers like "3" from "Demo_Book_3.pdf" as an ISBN!
                if not isbn_digits and not raw_fn:
                    continue

                # Parse optional columns
                pages_val = None
                if pages_col and row.get(pages_col):
                    p_digits = "".join(ch for ch in str(row.get(pages_col)) if ch.isdigit())
                    if p_digits:
                        pages_val = int(p_digits)

                ptype_val = str(row.get(pdf_type_col, "") or "").strip() if pdf_type_col else None
                lang_val = str(row.get(lang_col, "") or "").strip() if lang_col else None

                # Look up existing entry by raw_filename or isbn
                existing = None
                if raw_fn:
                    existing = db.query(BodCsvEntry).filter(BodCsvEntry.raw_filename.ilike(raw_fn)).first()
                if not existing and isbn_digits:
                    existing = db.query(BodCsvEntry).filter(BodCsvEntry.isbn == isbn_digits).first()

                if not existing:
                    entry = BodCsvEntry(
                        isbn=isbn_digits or None,
                        raw_filename=raw_fn or None,
                        source_csv_filename=source_csv_filename,
                        pages=pages_val,
                        pdf_type=ptype_val or None,
                        language=lang_val or None,
                        extra_data=dict(row)
                    )
                    db.add(entry)
                else:
                    if isbn_digits:
                        existing.isbn = isbn_digits
                    if raw_fn and not existing.raw_filename:
                        existing.raw_filename = raw_fn
                    if pages_val and not existing.pages:
                        existing.pages = pages_val
                    if ptype_val and not existing.pdf_type:
                        existing.pdf_type = ptype_val
                    if lang_val and not existing.language:
                        existing.language = lang_val
                    existing.source_csv_filename = source_csv_filename
                    existing.extra_data = dict(row)
                    # Update metadata if newer info is available
                    if raw_fn and not existing.raw_filename:
                        existing.raw_filename = raw_fn
                    if pages_val and not existing.pages:
                        existing.pages = pages_val
                    if ptype_val and not existing.pdf_type:
                        existing.pdf_type = ptype_val
                    if lang_val and not existing.language:
                        existing.language = lang_val
                    existing.source_csv_filename = source_csv_filename
                    existing.extra_data = dict(row)

            db.commit()
    except Exception as e:
        logger.error(f"Error parsing and storing CSV entries from {source_csv_filename}: {e}")
        db.rollback()


def _find_matching_isbn_for_pdf(db, pdf_filename: str) -> tuple[str | None, BodCsvEntry | None]:
    """
    Checks if a PDF matches any stored BodCsvEntry in the database.
    Matches by:
    1. Exact filename match (e.g. raw_filename == 'Demo_Book_1.pdf' or '9783695199488_B.pdf')
    2. Exact 10- or 13-digit ISBN match
    """
    clean_pdf_digits = "".join(ch for ch in pdf_filename.rsplit('.', 1)[0] if ch.isdigit())

    # 1. Check exact raw_filename match first
    entry = db.query(BodCsvEntry).filter(
        BodCsvEntry.raw_filename.ilike(pdf_filename.strip())
    ).first()
    if entry and entry.isbn:
        return entry.isbn, entry

    # 2. Check by valid ISBN digits (only if 10 or 13 digits)
    if len(clean_pdf_digits) in (10, 13):
        # Direct equality
        entry = db.query(BodCsvEntry).filter(
            BodCsvEntry.isbn == clean_pdf_digits
        ).first()
        if entry:
            return entry.isbn, entry

        # Partial match only when both have valid 10/13-digit ISBN lengths
        all_entries = db.query(BodCsvEntry).filter(BodCsvEntry.isbn != None).all()
        for e in all_entries:
            if e.isbn and len(e.isbn) in (10, 13):
                if e.isbn in clean_pdf_digits or clean_pdf_digits in e.isbn:
                    return e.isbn, e

    return None, None


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
                timeout=getattr(settings, "BOD_FTP_TIMEOUT", 15),
                use_tls=getattr(settings, "BOD_FTP_USE_TLS", True),
                passive=getattr(settings, "BOD_FTP_PASSIVE", True),
                ssl_verify=getattr(settings, "BOD_FTP_SSL_VERIFY", True),
                ca_file=getattr(settings, "BOD_FTP_CA_FILE", None) or None
            ) as ftp:
                target_dir = settings.BOD_FTP_BASE_PATH if settings.BOD_FTP_BASE_PATH else "BOD"
                try:
                    ftp.ftp.cwd(target_dir)
                except Exception as e:
                    logger.error(f"Failed to change directory to BOD on FTP {settings.BOD_FTP_HOST}: {str(e)}")
                    return
                    
                all_ftp_files = ftp.list_files()
                pdfs = [f for f in all_ftp_files if f.lower().endswith('.pdf')]
                csv_files = [f for f in all_ftp_files if f.lower().endswith('.csv')]

                # Pre-download and cache CSV files from FTP, and store/persist all rows into DB
                csv_cache = {}
                for csv_name in csv_files:
                    try:
                        # Option C: Store CSV locally in /uploads/bod/
                        local_csv_path = os.path.join(bod_upload_dir, csv_name)
                        ftp.download_file(csv_name, local_csv_path)
                        with open(local_csv_path, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                            csv_cache[csv_name] = content
                            # SCENARIO 1: Store/update all CSV entries and ISBNs into database
                            _parse_and_store_csv_entries(db, content, csv_name)
                        logger.info(f"Saved CSV file locally at: {local_csv_path}")

                        # Move CSV file on the FTP into the /Production remote directory
                        try:
                            remote_src = f"/{target_dir.strip('/')}/{csv_name}"
                            remote_dest = f"/Production/{csv_name}"
                            ftp.ftp.rename(remote_src, remote_dest)
                            logger.info(f"Moved CSV on FTP from {remote_src} to {remote_dest}")
                        except Exception as mv_err:
                            logger.warning(f"Could not move CSV {csv_name} to /Production on FTP: {mv_err}")

                    except Exception as err:
                        logger.warning(f"Could not read CSV file {csv_name} from FTP: {err}")

                stages_str = settings.BOD_CUSTOM_STAGES if settings.BOD_CUSTOM_STAGES else "Add job,Job Analysis,Production,QC,Ready to Dispatch,Archive"
                stages = [s.strip() for s in stages_str.split(",")]
                add_job_stage = stages[0] if len(stages) > 0 else "Add job"
                job_analysis_stage = stages[1] if len(stages) > 1 else "Job Analysis"

                # 1. Check all existing pending jobs in 'Add job' stage in the database.
                # If matching ISBN/metadata exists in the stored CSV entries, advance them to 'Job Analysis'!
                pending_add_jobs = db.query(BodJob).filter(
                    BodJob.current_stage_name == add_job_stage,
                    BodJob.is_deleted == False
                ).all()

                now_utc = datetime.now(timezone.utc)
                now_iso = now_utc.isoformat()

                for existing_job in pending_add_jobs:
                    pdf_name = existing_job.pdf_filename
                    matched_isbn, csv_entry = _find_matching_isbn_for_pdf(db, pdf_name)

                    if matched_isbn:
                        src_csv = csv_entry.source_csv_filename if csv_entry else "stored_csv"
                        logger.info(f"Matching stored CSV entry ({src_csv}) found for existing pending job {existing_job.id} ({pdf_name}). Moving to '{job_analysis_stage}' with eISBN {matched_isbn}.")
                        existing_job.eisbn = matched_isbn
                        existing_job.current_stage_name = job_analysis_stage
                        existing_job.current_stage_index = stages.index(job_analysis_stage) if job_analysis_stage in stages else 1
                        
                        # Populate any extra metadata from CSV if missing
                        if csv_entry:
                            csv_entry.matched_job_id = existing_job.id
                            if csv_entry.pages and not existing_job.pdf_page_count:
                                existing_job.pdf_page_count = csv_entry.pages
                            if csv_entry.pdf_type and not existing_job.pdf_type:
                                existing_job.pdf_type = csv_entry.pdf_type
                            if csv_entry.language and (not existing_job.pdf_language or existing_job.pdf_language == "None"):
                                existing_job.pdf_language = csv_entry.language

                        existing_job.due_date = calculate_bod_due_date(existing_job.pdf_type, existing_job.pdf_page_count, now_utc)

                        history = dict(existing_job.stage_history) if existing_job.stage_history else {}
                        if add_job_stage in history:
                            history[add_job_stage]["end_time"] = now_iso
                        history[job_analysis_stage] = {
                            "start_time": now_iso,
                            "matched_csv": src_csv,
                            "matched_isbn": matched_isbn
                        }
                        existing_job.stage_history = history
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(existing_job, "stage_history")
                        db.commit()

                # 2. Process all incoming PDFs currently on FTP
                for pdf_name in pdfs:
                    # Check if an active (non-deleted) job already exists
                    active_job = db.query(BodJob).filter(
                        BodJob.pdf_filename == pdf_name,
                        BodJob.is_deleted == False
                    ).first()

                    # SCENARIO 2: Check matching ISBN in stored CSV entries (whether uploaded now or earlier)
                    matched_isbn, csv_entry = _find_matching_isbn_for_pdf(db, pdf_name)

                    if active_job:
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
                    
                    # Determine stage:
                    # If matching ISBN is found in stored CSV, move directly to 'Job Analysis', and calculate due date from now_utc.
                    # If matching CSV/ISBN is not present, stay in 'Add job' with no due date set yet.
                    src_csv = csv_entry.source_csv_filename if csv_entry else "stored_csv"
                    if matched_isbn:
                        initial_stage_name = job_analysis_stage
                        initial_stage_index = stages.index(job_analysis_stage) if job_analysis_stage in stages else 1
                        calculated_due_date = calculate_bod_due_date(pdf_type, page_count, now_utc)
                        initial_history = {
                            add_job_stage: {
                                "start_time": now_iso,
                                "end_time": now_iso
                            },
                            job_analysis_stage: {
                                "start_time": now_iso,
                                "matched_csv": src_csv,
                                "matched_isbn": matched_isbn
                            }
                        }
                    else:
                        initial_stage_name = add_job_stage
                        initial_stage_index = 0
                        calculated_due_date = None  # due date calculated only upon moving to Job Analysis
                        initial_history = {
                            add_job_stage: {
                                "start_time": now_iso
                            }
                        }
                
                    new_job = BodJob(
                        project_name=project_name,
                        pdf_filename=pdf_name,
                        pdf_filepath=local_path,
                        eisbn=matched_isbn,
                        cover_filename=cover_filename,
                        cover_filepath=cover_filepath,
                        pdf_page_count=page_count,
                        pdf_type=pdf_type,
                        pdf_language=pdf_language,
                        current_stage_index=initial_stage_index,
                        current_stage_name=initial_stage_name,
                        stage_history=initial_history,
                        status="Active",
                        created_at=now_utc,
                        due_date=calculated_due_date
                    )
                    db.add(new_job)
                    db.commit()
                    db.refresh(new_job)

                    if csv_entry:
                        csv_entry.matched_job_id = new_job.id
                        db.commit()
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
                    # Structure: {prod_folder}/{year}/{month}/{date}/{project_name}/
                    prod_base = getattr(settings, "BOD_FTP_PRODUCTION_PATH", "Production") or "Production"
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
