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
from app.domains.notifications.email_service import (
    send_bod_new_job_email,
    send_bod_daily_receipt_summary_email,
)
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
                    # Only execute move if BOD_FTP_PRODUCTION_PATH is explicitly configured in env
                    raw_prod_base = getattr(settings, "BOD_FTP_PRODUCTION_PATH", None)
                    prod_base = raw_prod_base.strip() if isinstance(raw_prod_base, str) else ""

                    if prod_base:
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
                    else:
                        logger.info(f"BOD_FTP_PRODUCTION_PATH not configured in environment. Skipping FTP move for {pdf_name}.")
                        
        except Exception as e:
            logger.error(f"Error processing FTP for BOD: {str(e)}")
    finally:
        db.close()


@celery_app.task(acks_late=True)
def send_bod_daily_receipt_summary(target_date_str: str | None = None):
    """
    Daily task scheduled at 6:30 PM (or manually triggered) to send
    BOD Job Receipt Summary to BOD_MANAGER_EMAIL.
    
    Includes:
    1. CSV entries received today (matched with arriving PDFs/covers).
    2. Any PDFs received directly today that were not listed in the CSV.
    
    Remarks:
    - 'File Not received' (ISBN in CSV, but PDF has not arrived on FTP)
    - 'File received but cover missing' (PDF arrived, but cover image was not found)
    - 'File and cover received' (Both PDF and cover image arrived)
    - 'file received not in csv' (PDF received on FTP, but not in today's CSV)
    """
    logger.info("Generating BOD daily receipt summary...")
    db = SessionLocal()
    settings = get_settings()

    manager_email = getattr(settings, "BOD_MANAGER_EMAIL", None)
    if not manager_email:
        logger.warning("BOD_MANAGER_EMAIL is not configured. Skipping daily summary email.")
        db.close()
        return

    try:
        now_utc = datetime.now(timezone.utc)
        # Determine target date window (in Asia/Kolkata timezone: UTC+5:30)
        from zoneinfo import ZoneInfo
        kolkata_tz = ZoneInfo("Asia/Kolkata")
        now_local = datetime.now(kolkata_tz)

        if target_date_str:
            try:
                ref_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
            except Exception:
                ref_date = now_local.date()
        else:
            ref_date = now_local.date()
            # If scheduled automatically (no target_date_str provided) and today is Sunday, skip
            if ref_date.weekday() == 6:  # 6 = Sunday
                logger.info(f"Today is {ref_date.strftime('%A')}. Skipping BOD daily receipt summary.")
                return {"status": "skipped", "reason": "sunday", "date": ref_date.isoformat()}
            
            # Guard against Celery Beat catch-up triggers:
            # If triggered without explicit date, ensure current local time is within 30 minutes of configured schedule time
            summary_time_str = getattr(settings, "BOD_DAILY_SUMMARY_TIME", None)
            if summary_time_str and str(summary_time_str).strip():
                try:
                    s_hour, s_minute = [int(p) for p in str(summary_time_str).strip().split(":", 1)]
                    # Allow execution within a 30-minute window of the scheduled time
                    scheduled_minutes = s_hour * 60 + s_minute
                    current_minutes = now_local.hour * 60 + now_local.minute
                    diff = abs(current_minutes - scheduled_minutes)
                    if diff > 30:
                        logger.warning(
                            f"Skipping catch-up/stale execution: current time {now_local.strftime('%H:%M')} "
                            f"is not near scheduled BOD_DAILY_SUMMARY_TIME {summary_time_str}."
                        )
                        return {
                            "status": "skipped",
                            "reason": "outside_scheduled_window",
                            "current_time": now_local.strftime("%H:%M"),
                            "scheduled_time": summary_time_str
                        }
                except Exception as ex:
                    logger.warning(f"Could not parse BOD_DAILY_SUMMARY_TIME for window check: {ex}")

        display_date = ref_date.strftime("%m/%d/%Y")

        # Start and end of today in local time, converted to UTC
        start_of_day_local = datetime(ref_date.year, ref_date.month, ref_date.day, 0, 0, 0, tzinfo=kolkata_tz)
        end_of_day_local = datetime(ref_date.year, ref_date.month, ref_date.day, 23, 59, 59, tzinfo=kolkata_tz)
        start_utc = start_of_day_local.astimezone(timezone.utc)
        end_utc = end_of_day_local.astimezone(timezone.utc)

        # 1. Fetch CSV entries to report:
        # - Any CSV entry received on target date
        # - OR any older CSV entry that is STILL pending (matched_job_id is None / File Not received)
        # - OR any older CSV entry whose matching PDF arrived today!
        all_csv_entries = db.query(BodCsvEntry).order_by(BodCsvEntry.id.asc()).all()

        # 2. Fetch BodJobs ingested today
        jobs_today = db.query(BodJob).filter(
            BodJob.is_deleted == False,
            BodJob.created_at >= start_utc,
            BodJob.created_at <= end_utc
        ).order_by(BodJob.id.asc()).all()
        jobs_today_ids = {j.id for j in jobs_today}

        summary_rows = []
        matched_job_ids = set()

        def extract_title_from_pdf(pdf_path: str) -> str:
            if not pdf_path or not os.path.isfile(pdf_path):
                return "-"
            try:
                import fitz
                doc = fitz.open(pdf_path)
                meta_title = (doc.metadata.get("title") or "").strip()
                doc.close()
                if meta_title and not meta_title.lower().startswith("microsoft word -"):
                    return meta_title
                elif meta_title:
                    return meta_title.replace("Microsoft Word -", "").strip()
            except Exception:
                pass
            return "-"

        def get_file_size_kb(file_path: str) -> str:
            if file_path and os.path.isfile(file_path):
                try:
                    size_bytes = os.path.getsize(file_path)
                    return f"{round(size_bytes / 1024)}"
                except Exception:
                    pass
            return "-"

        # Filter relevant CSV entries according to Option 1:
        # - Entry was received today
        # - OR Entry was received earlier, but is STILL pending (File Not received)
        # - OR Entry was received earlier, but its file arrived today!
        for entry in all_csv_entries:
            entry_created_local = entry.created_at.astimezone(kolkata_tz) if entry.created_at else None
            is_entry_today = bool(entry.created_at and start_utc <= entry.created_at <= end_utc)

            extra = entry.extra_data or {}
            
            # Find Title Name in CSV row
            title_val = None
            for k, v in extra.items():
                if re.search(r'\b(?:title|book\s*title|title\s*name)\b', k, re.IGNORECASE) and v:
                    title_val = str(v).strip()
                    break

            # Find matching BodJob
            matched_job = None
            if entry.matched_job_id:
                matched_job = db.query(BodJob).filter(BodJob.id == entry.matched_job_id).first()

            if not matched_job and entry.isbn:
                matched_job = db.query(BodJob).filter(
                    BodJob.is_deleted == False,
                    BodJob.eisbn == entry.isbn
                ).first()

            if not matched_job and entry.raw_filename:
                matched_job = db.query(BodJob).filter(
                    BodJob.is_deleted == False,
                    BodJob.pdf_filename == entry.raw_filename
                ).first()

            is_job_today = bool(matched_job and matched_job.id in jobs_today_ids)

            # Inclusion criteria for Option 1:
            # 1) Entry arrived today
            # 2) Older entry whose file arrived today
            # 3) Older entry that still has no file arrived
            if not (is_entry_today or is_job_today or matched_job is None):
                # Older entry whose file already arrived on a previous day -> skip
                continue

            # Display date: if job arrived today, show today's date; otherwise show entry's original receipt date
            if matched_job and matched_job.created_at:
                row_date_display = matched_job.created_at.astimezone(kolkata_tz).strftime("%m/%d/%Y")
            elif entry_created_local:
                row_date_display = entry_created_local.strftime("%m/%d/%Y")
            else:
                row_date_display = display_date

            isbn_display = entry.isbn or extra.get("ISBN") or extra.get("PISBN") or "-"
            pages_display = str(entry.pages) if entry.pages else (str(matched_job.pdf_page_count) if matched_job and matched_job.pdf_page_count else "-")
            type_display = entry.pdf_type or (matched_job.pdf_type if matched_job else "-") or "-"
            lang_display = entry.language or (matched_job.pdf_language if matched_job and matched_job.pdf_language != "None" else "-") or "-"
            alt_text_display = extra.get("Alt Text Available?") or extra.get("Alt Text") or "No"

            if matched_job:
                matched_job_ids.add(matched_job.id)
                has_cover = bool(matched_job.cover_filename and matched_job.cover_filepath and os.path.exists(matched_job.cover_filepath))
                cover_display = "Yes" if has_cover else "No"
                file_size_display = get_file_size_kb(matched_job.pdf_filepath)

                if not title_val:
                    title_val = extract_title_from_pdf(matched_job.pdf_filepath)

                if has_cover:
                    remarks = "File and cover received"
                else:
                    remarks = "File received but cover missing"
            else:
                cover_display = "No"
                file_size_display = "-"
                remarks = "File Not received"

            summary_rows.append({
                "date": row_date_display,
                "isbn": isbn_display,
                "title": title_val or "-",
                "pages": pages_display,
                "input_type": type_display,
                "cover": cover_display,
                "language": lang_display,
                "file_size_kb": file_size_display,
                "alt_text": alt_text_display,
                "remarks": remarks
            })

        # Process any standalone PDFs received today that were NOT in any CSV entry
        for job in jobs_today:
            if job.id in matched_job_ids:
                continue

            title_val = extract_title_from_pdf(job.pdf_filepath)
            has_cover = bool(job.cover_filename and job.cover_filepath and os.path.exists(job.cover_filepath))
            cover_display = "Yes" if has_cover else "No"
            file_size_display = get_file_size_kb(job.pdf_filepath)
            job_date_str = job.created_at.astimezone(kolkata_tz).strftime("%m/%d/%Y") if job.created_at else display_date

            summary_rows.append({
                "date": job_date_str,
                "isbn": job.eisbn or job.project_name or "-",
                "title": title_val or "-",
                "pages": str(job.pdf_page_count) if job.pdf_page_count else "-",
                "input_type": job.pdf_type or "-",
                "cover": cover_display,
                "language": job.pdf_language if job.pdf_language and job.pdf_language != "None" else "-",
                "file_size_kb": file_size_display,
                "alt_text": "No",
                "remarks": "File received not in CSV"
            })

        logger.info(f"Sending BOD daily receipt summary to {manager_email} with {len(summary_rows)} rows...")
        send_bod_daily_receipt_summary_email(
            manager_email=manager_email,
            report_date_str=display_date,
            summary_rows=summary_rows
        )
        logger.info("BOD daily receipt summary email sent successfully!")
        return {"status": "sent", "rows_count": len(summary_rows), "date": display_date}

    except Exception as e:
        logger.error(f"Failed to generate and send BOD daily receipt summary email: {e}")
        raise
    finally:
        db.close()

