from app.utils.timezone import now_ist_naive
from fastapi import BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any

from app import database, models

import os
import io
import zipfile
import shutil
import traceback


def docx_has_changes(path1: str, path2: str) -> bool:
    try:
        import zipfile
        def get_xml_content(zip_path, member):
            with zipfile.ZipFile(zip_path) as z:
                if member in z.namelist():
                    return z.read(member)
            return b""

        # Compare main document text and styles
        if get_xml_content(path1, "word/document.xml") != get_xml_content(path2, "word/document.xml"):
            return True
        if get_xml_content(path1, "word/styles.xml") != get_xml_content(path2, "word/styles.xml"):
            return True
        return False
    except Exception:
        # Fallback to assuming changed if error occurs
        return True


def _run_via_pph(file_path: str, endpoint: str, extra_data: dict = None, file_field: str = "files") -> list:
    """Submit a single file to a PPH endpoint and return extracted output file paths."""
    from app.integrations.pph.client import PPHClient
    client = PPHClient()
    with open(file_path, "rb") as f:
        files = {
            file_field: (
                os.path.basename(file_path),
                f.read(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        }
    zip_bytes = client.submit_and_wait(endpoint=endpoint, files=files, data=extra_data or {})
    folder = os.path.dirname(file_path)
    generated_files = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        z.extractall(folder)
        for name in z.namelist():
            full_path = os.path.join(folder, os.path.basename(name))
            if os.path.isfile(full_path):
                generated_files.append(full_path)
    return generated_files


PROCESS_PERMISSIONS = {
    "language": ["Team Lead - Editorial", "Technical Editor", "Admin","Language Editor", "Team Lead - Language Editing"],
    "technical": ["Team Lead - Editorial", "Technical Editor", "Admin","Language Editor", "Team Lead - Language Editing"],
    "macro_processing": ["Pre Editor", "Team Lead - Prediting", "Admin","Non-XML Manager", "Non-XML Operator"],
    "ppd": ["Manuscript Analysis Operator", "ProjectManager", "Admin"],
    "permissions": ["PermissionsManager", "ProjectManager", "Admin"],
    "reference_validation": ["Pre Editor", "Team Lead - Prediting", "Admin","Non-XML Manager", "Non-XML Operator"],
    "structuring": ["ProjectManager","Pre Editor", "Team Lead - Prediting", "Admin","Non-XML Manager", "Non-XML Operator", "XML Manager", "XML Operator", "Senior XML Operator"],
    "bias_scan": ["Team Lead - Editorial", "Technical Editor", "Admin","Language Editor", "Team Lead - Language Editing"],
    "credit_extractor_ai": ["PermissionsManager", "ProjectManager", "Admin"],
    "word_to_xml": ["Admin", "XML Manager", "XML manager", "XML Operator", "Senior XML Operator"],
    "xml_to_indesign": ["Admin", "XML Manager", "XML manager", "XML Operator", "Senior XML Operator"],
    "indesign_to_xml": ["Admin", "XML Manager", "XML manager", "XML Operator", "Senior XML Operator", "Compositor", "Senior Compositor", "Production Manager"],
    "extract_design_css": ["Admin", "XML Manager", "XML manager", "XML Operator", "Senior XML Operator"],
    "style_validation": ["Admin", "XML Manager", "XML manager", "XML Operator", "Senior XML Operator"],
    "view_proof": ["Admin", "XML Manager", "XML manager", "Author", "Reviewer", "Editor", "XML Operator", "Technical Editor", "Pre Editor", "Language Editor", "Compositor", "Senior Compositor", "Production Manager"],
}


def check_permission(user, process_type: str, *, logger):
    allowed = PROCESS_PERMISSIONS.get(process_type, ["Admin"])
    user_role_names = [role.name for role in user.roles]
    
    # Normalize to lowercase and strip whitespace for robust case-insensitive matching
    user_role_names_lower = {role_name.strip().lower() for role_name in user_role_names}
    is_allowed = any(allowed_role.strip().lower() in user_role_names_lower for allowed_role in allowed)
    
    if not is_allowed:
        logger.warning(
            f"Permission denied for user {user.username} on {process_type}. Roles: {user_role_names}"
        )
        raise HTTPException(
            status_code=403,
            detail=(
                f"Permission denied. Required roles: {', '.join(allowed)}. "
                f"Your roles: {', '.join(user_role_names)}"
            ),
        )


def update_job_status(
    db: Session,
    job_id: Optional[int],
    status: str,
    current_step: Optional[str] = None,
    progress_pct: Optional[int] = None,
    error: Optional[str] = None,
):
    if not job_id:
        return
    try:
        from app.models import ProcessingJob
        from datetime import datetime
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if job:
            job.status = status
            if current_step is not None:
                job.current_step = current_step
            if progress_pct is not None:
                job.progress_pct = progress_pct
            if error is not None:
                job.error_message = error
            if status in ("completed", "failed"):
                job.completed_at = datetime.utcnow()
            db.commit()
    except Exception:
        pass


def background_processing_task(
    file_id: int,
    process_type: str,
    user_id: int,
    user_username: str,
    mode: str = "style",
    options: Optional[dict[str, Any]] = None,
    job_id: Optional[int] = None,
    *,
    logger,
    inject_publisher_styles_func,
    permissions_engine_cls,
    ppd_engine_cls,
    technical_engine_cls,
    references_engine_cls,
    structuring_engine_cls,
    bias_engine_cls,
    ai_extractor_engine_cls,
    xml_engine_cls,
):
    db = database.SessionLocal()
    try:
        logger.info(
            f"Background task started: File {file_id}, Type {process_type}, User {user_username}"
        )
        if not job_id:
            try:
                from app.models import ProcessingJob
                job = (
                    db.query(ProcessingJob)
                    .filter(
                        ProcessingJob.file_id == file_id,
                        ProcessingJob.process_type == process_type,
                        ProcessingJob.status.in_(["pending", "processing"]),
                    )
                    .order_by(ProcessingJob.id.desc())
                    .first()
                )
                if job:
                    job_id = job.id
            except Exception:
                pass

        update_job_status(db, job_id, "processing", f"Starting {process_type} job...", 10)

        file_record = db.query(models.File).filter(models.File.id == file_id).first()
        if not file_record:
            logger.error(f"File {file_id} not found in background task.")
            update_job_status(db, job_id, "failed", "File not found", 100, "File not found in database.")
            return

        file_path = os.path.abspath(file_record.path)
        success_msg = ""
        generated_files = []

        try:
            if process_type in (
                "ppd",
                "reference_validation",
                "reference_number_validation",
                "reference_apa_chicago_validation",
                "reference_report_only",
                "reference_structuring"
            ):
                import redis
                import time
                from app.core.config import get_settings
                settings = get_settings()

                redis_client = redis.from_url(settings.REDIS_URL)
                lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

                logger.info(f"Task {job_id} entering prioritization lock loop for {process_type}...")
                while True:
                    if job_id:
                        db.expire_all()
                        job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first()
                        if job and job.status == "cancelled":
                            logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                            return

                    # Check for higher priority jobs waiting
                    higher_job = None
                    if job_id:
                        job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first()
                        if job:
                            higher_job = db.query(models.ProcessingJob).filter(
                                models.ProcessingJob.status.in_(["pending", "processing"]),
                                models.ProcessingJob.id != job.id,
                                models.ProcessingJob.process_type.in_([
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
                                (models.ProcessingJob.priority > job.priority) |
                                ((models.ProcessingJob.priority == job.priority) & (models.ProcessingJob.id < job.id))
                            ).first()

                    if higher_job:
                        time.sleep(2)
                        continue

                    # Attempt to acquire lock non-blockingly
                    acquired = lock.acquire(blocking=False)
                    if acquired:
                        break
                    time.sleep(2)

                logger.info(f"Acquired queue lock. Starting {process_type} for job {job_id}")

            if process_type == "permissions":
                update_job_status(db, job_id, "processing", "Scanning permissions...", 30)
                generated_files = permissions_engine_cls().process_document(file_path)
                success_msg = "Permissions Log generated successfully"

            elif process_type == "ppd":
                update_job_status(db, job_id, "processing", "Running PPD analysis...", 30)
                if os.environ.get("PPH_ENABLED", "false").lower() in ("true", "1", "yes"):
                    book_title = os.path.splitext(os.path.basename(file_path))[0]
                    generated_files = _run_via_pph(
                        file_path, "/ppd",
                        {"book_title": book_title, "combined_dashboard": "false"},
                        file_field="docfiles",
                    )
                    success_msg = "PPD processing completed via PPH"
                else:
                    generated_files = ppd_engine_cls().process_document(file_path, user_username)
                    success_msg = "PPD processing completed"

            elif process_type == "technical":
                update_job_status(db, job_id, "processing", "Scanning technical style errors...", 30)
                generated_files = technical_engine_cls().process_document(file_path)
                success_msg = "Technical Editing completed successfully"

            elif process_type in [
                "macro_processing",
                "reference_validation",
                "reference_number_validation",
                "reference_apa_chicago_validation",
                "reference_report_only",
                "reference_structuring",
            ]:
                # Define defaults based on process type to prevent UnboundLocalError
                run_struct = False
                run_conversion = False
                run_num = True
                run_apa = True
                report_only = False
                target_style = "Auto"
                citation_format = "auto"

                if process_type == "reference_structuring":
                    # Only run AI Conversion (Gemini); legacy ReferencesStructing.py is OFF
                    run_struct = False
                    run_conversion = True
                    run_num = False
                    run_apa = False
                elif process_type == "reference_number_validation":
                    run_struct = False
                    run_conversion = False
                    run_num = True
                    run_apa = False
                elif process_type == "reference_apa_chicago_validation":
                    run_struct = False
                    run_conversion = False
                    run_num = False
                    run_apa = True
                elif process_type == "reference_report_only":
                    run_struct = False
                    run_conversion = False
                    run_num = True
                    run_apa = True
                    report_only = True
                elif process_type in ("macro_processing", "reference_validation"):
                    run_struct = False
                    run_conversion = bool((options or {}).get("run_conversion", False))

                # Dynamic overrides from options dictionary if provided
                if options:
                    if "run_structuring" in options:
                        run_struct = bool(options["run_structuring"])
                    if "run_conversion" in options:
                        run_conversion = bool(options["run_conversion"])
                    if "run_validation" in options:
                        run_num = bool(options["run_validation"])
                    if "run_name_year_validation" in options:
                        run_apa = bool(options["run_name_year_validation"])
                    if "report_only" in options:
                        report_only = bool(options["report_only"])
                    if "target_style" in options:
                        target_style = str(options["target_style"])
                    if "citation_format" in options:
                        citation_format = str(options["citation_format"])

                logger.info(
                    f"[reference job] type={process_type} "
                    f"run_struct={run_struct} run_conversion={run_conversion} "
                    f"run_num={run_num} run_apa={run_apa} report_only={report_only}"
                )
                update_job_status(db, job_id, "processing", "Processing document references...", 40)
                generated_files = references_engine_cls().process_document(
                    file_path,
                    run_structuring=run_struct,
                    run_conversion=run_conversion,
                    run_num_validation=run_num,
                    run_apa_validation=run_apa,
                    report_only=report_only,
                    target_style=target_style,
                    citation_format=citation_format,
                )
                success_msg = f"References processing completed ({process_type})"

            elif process_type == "structuring":
                structuring_method = "ai"
                if options and isinstance(options, dict):
                    structuring_method = options.get("structuring_method", "ai")
                    tag_set = options.get("tag_set")

                if not tag_set and file_record and file_record.chapter:
                    ch = file_record.chapter
                    c_name = getattr(ch, "client", None)
                    if not c_name or not isinstance(c_name, str):
                        proj = getattr(ch, "project_rel", None)
                        if proj and proj.client:
                            c_name = (
                                getattr(proj.client, "company", None)
                                or getattr(proj.client, "name_company", None)
                                or getattr(proj.client, "division", None)
                            )
                    if c_name and ("springer" in str(c_name).lower() or "spr" in str(c_name).lower()):
                        tag_set = "springer"

                def on_progress_callback(step_name: str, pct: int):
                    update_job_status(db, job_id, "processing", step_name, pct)

                if structuring_method == "manual":
                    logger.info(f"Starting manual structuring (mode={mode}, tag_set={tag_set}) using app.utils.utils.structuring_lib for: {os.path.basename(file_path)}")
                    from app.utils.utils.structuring_lib.styler import process_docx as manual_process_docx
                    dir_name = os.path.dirname(file_path)
                    base_name = os.path.basename(file_path)
                    name_only = os.path.splitext(base_name)[0]
                    output_filename = f"{name_only}_Processed.docx"
                    output_path = os.path.join(dir_name, output_filename)

                    result = manual_process_docx(
                        input_path=file_path,
                        output_path=output_path,
                        mode=mode,
                        tag_set=tag_set,
                        on_progress=on_progress_callback,
                    )
                    if not result.get("success", False):
                        error_msg = "; ".join(result.get("errors", ["Unknown structuring error"]))
                        logger.error(f"Manual structuring failed: {error_msg}")
                        raise Exception(f"Manual structuring failed: {error_msg}")
                    generated_files = [output_path]
                    success_msg = f"Manual structuring completed (mode: {mode})"
                else:
                    update_job_status(db, job_id, "processing", "Offloading document to AI Structuring...", 30)
                    generated_files = structuring_engine_cls().process_document(file_path, mode=mode, tag_set=tag_set)
                    success_msg = f"Structuring completed (mode: {mode})"

            elif process_type == "bias_scan":
                generated_files = bias_engine_cls().process_document(file_path)
                success_msg = "Bias Scan completed successfully"

            elif process_type == "credit_extractor_ai":
                generated_files = ai_extractor_engine_cls().process_document(file_path)
                success_msg = "AI Credit Extraction completed"

            elif process_type == "word_to_xml":
                generated_files = xml_engine_cls().process_document(file_path)
                success_msg = "Word to XML conversion completed"

            elif process_type == "xml_to_indesign":
                update_job_status(db, job_id, "processing", "Processing XML to InDesign conversion...", 30)
                template_file_id = options.get("template_file_id") if options else None
                if not template_file_id:
                    raise ValueError("Missing template_file_id option.")
                
                from app.services.file_service import UPLOAD_DIR
                from app.processing.xml_to_indesign_engine import XMLToInDesignEngine
                generated_files = XMLToInDesignEngine().process_document(
                    db=db,
                    file_path=file_path,
                    file_record=file_record,
                    template_file_id=template_file_id,
                    user_id=user_id,
                    upload_dir=UPLOAD_DIR,
                    logger=logger,
                    job_id=job_id
                )
                success_msg = "XML to InDesign conversion completed"

            elif process_type == "indesign_to_xml":
                update_job_status(db, job_id, "processing", "Processing InDesign to XML conversion...", 30)
                from app.services.file_service import UPLOAD_DIR
                from app.processing.indesign_to_xml_engine import InDesignToXMLEngine
                generated_files = InDesignToXMLEngine().process_document(
                    db=db,
                    file_path=file_path,
                    file_record=file_record,
                    user_id=user_id,
                    upload_dir=UPLOAD_DIR,
                    logger=logger,
                    job_id=job_id
                )
                success_msg = "InDesign to XML conversion completed"

            elif process_type == "view_proof":
                update_job_status(db, job_id, "processing", "Running View Proof XML regeneration and typesetting...", 30)
                from app.services.file_service import UPLOAD_DIR
                from app.processing.view_proof_engine import ViewProofEngine
                ViewProofEngine().process_document(
                    db=db,
                    file_path=file_path,
                    file_record=file_record,
                    user_id=user_id,
                    upload_dir=UPLOAD_DIR,
                    logger=logger,
                    job_id=job_id
                )
                generated_files = []
                success_msg = "View Proof layout regeneration completed"

            elif process_type == "extract_design_css":
                update_job_status(db, job_id, "processing", "Extracting CSS from InDesign template...", 30)
                from app.core.config import get_settings
                import redis
                import requests
                
                settings = get_settings()
                if not settings.INDESIGN_SERVER_URL:
                    raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")
                
                url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/extract-design-css"
                redis_client = redis.from_url(settings.REDIS_URL)
                lock = redis_client.lock("indesign_conversion_lock", timeout=600)
                
                logger.info(f"[{job_id}] Acquiring InDesign lock for CSS extraction...")
                lock.acquire(blocking=True)
                try:
                    logger.info(f"[{job_id}] Lock acquired. Sending CSS extraction request to: {url}")
                    with open(file_path, "rb") as f_in:
                        response = requests.post(
                            url,
                            files={"file": (os.path.basename(file_path), f_in.read(), "application/octet-stream")},
                            timeout=(30.0, 300)
                        )
                    if response.status_code != 200:
                        raise RuntimeError(f"Remote InDesign server returned status code {response.status_code}. Response: {response.text}")
                finally:
                    try:
                        lock.release()
                    except Exception:
                        pass
                
                from app.domains.projects.models import Project
                from app.services.file_service import UPLOAD_DIR
                project = db.query(Project).filter(Project.id == file_record.project_id).first()
                chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
                
                misc_dir = os.path.join(UPLOAD_DIR, project.code, chapter.chapters, "Misc")
                os.makedirs(misc_dir, exist_ok=True)
                
                css_output_path = os.path.join(misc_dir, "layout_design.css")
                with open(css_output_path, "wb") as f_out:
                    f_out.write(response.content)
                logger.info(f"[{job_id}] Saved extracted CSS: {css_output_path}")
                
                generated_files = [css_output_path]
                success_msg = "InDesign CSS extraction completed successfully"

            elif process_type == "style_validation":
                update_job_status(db, job_id, "processing", "Running Word document style validation...", 30)
                import sys
                import subprocess
                from app.domains.projects.models import Project
                from app.services.file_service import UPLOAD_DIR
                
                project = db.query(Project).filter(Project.id == file_record.project_id).first()
                chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
                
                manuscript_dir = os.path.join(UPLOAD_DIR, project.code, chapter.chapters, "Manuscript")
                os.makedirs(manuscript_dir, exist_ok=True)
                
                base_name = os.path.splitext(os.path.basename(file_path))[0]
                output_report_path = os.path.join(manuscript_dir, f"{base_name}_style_report.html")
                
                script_path = os.path.abspath("app/services/scripts/springerstylevalidation.py")
                config_path = os.path.abspath("app/services/scripts/springerstyles.json")
                
                if not os.path.exists(script_path):
                    raise FileNotFoundError(f"Style validation script not found: {script_path}")
                if not os.path.exists(config_path):
                    raise FileNotFoundError(f"Style validation configuration not found: {config_path}")
                    
                logger.info(f"[{job_id}] Executing style validation script: {script_path}")
                try:
                    result = subprocess.run(
                        [sys.executable, script_path, "-d", file_path, "-c", config_path, "-o", output_report_path],
                        capture_output=True,
                        text=True,
                        check=False
                    )
                    logger.info(f"[{job_id}] Style validation output: {result.stdout}")
                    if result.stderr:
                        logger.warning(f"[{job_id}] Style validation stderr: {result.stderr}")
                except Exception as run_err:
                    logger.error(f"[{job_id}] Failed to run style validation subprocess: {str(run_err)}")
                    raise RuntimeError(f"Failed to execute style validation: {str(run_err)}")
                    
                if not os.path.exists(output_report_path) or os.path.getsize(output_report_path) == 0:
                    raise FileNotFoundError("Style validation report was not successfully generated.")
                    
                generated_files = [output_report_path]
                success_msg = "Word document style validation completed"

            else:
                raise HTTPException(
                    status_code=501,
                    detail=(
                        f"Processing type '{process_type}' is not supported. "
                        "Word macro processing is only available on Windows."
                    ),
                )

            if generated_files:
                logger.info(f"Processing generated {len(generated_files)} output files")
                for processed_path in generated_files:
                    processed_filename = os.path.basename(processed_path)
                    logger.info(
                        f"Processing output file: {processed_path}, Exists: {os.path.exists(processed_path)}"
                    )

                    # Filter out intermediate files for reference processes
                    if process_type in [
                        "macro_processing",
                        "reference_validation",
                        "reference_number_validation",
                        "reference_apa_chicago_validation",
                        "reference_report_only",
                        "reference_structuring",
                    ]:
                        keep = False
                        if processed_filename.endswith("_Processed.docx") or processed_filename.endswith("_Structured.docx"):
                            keep = True
                        elif processed_filename.endswith("_log.txt") and not processed_filename.endswith("_conversion_log.txt") and not processed_filename.endswith("_fix_log.txt"):
                            keep = True
                        
                        if not keep:
                            logger.info(f"Deleting intermediate reference job output file: {processed_filename}")
                            if os.path.exists(processed_path):
                                try:
                                    os.remove(processed_path)
                                except Exception as rm_err:
                                    logger.warning(f"Failed to delete intermediate file {processed_path}: {rm_err}")
                            continue

                    # Determine if this file should update the original document in-place
                    is_in_place_docx = False
                    if processed_filename.endswith(".docx"):
                        if process_type in ("structuring", "technical"):
                            is_in_place_docx = True
                        elif process_type in (
                            "macro_processing",
                            "reference_validation",
                            "reference_number_validation",
                            "reference_apa_chicago_validation",
                            "reference_structuring",
                        ):
                            # For references, only update if the document actually changed
                            if docx_has_changes(file_path, processed_path):
                                is_in_place_docx = True
                            else:
                                logger.info(f"No changes detected in reference job output: {processed_filename}. Skipping file update.")
                                # Delete the unused staging file
                                try:
                                    os.remove(processed_path)
                                except Exception as rm_err:
                                    logger.warning(f"Failed to delete unchanged references file {processed_path}: {rm_err}")
                                continue

                    if is_in_place_docx and os.path.exists(processed_path):
                        if processed_filename.endswith(".docx"):
                            try:
                                inject_publisher_styles_func(processed_path)
                                logger.info(f"Publisher styles injected into: {processed_filename}")
                            except Exception as style_err:
                                logger.warning(f"Style injection failed for {processed_filename}: {style_err}")

                        # If this is a reference job, we deferred the backup/version bump to here:
                        if process_type in (
                            "macro_processing",
                            "reference_validation",
                            "reference_number_validation",
                            "reference_apa_chicago_validation",
                            "reference_structuring",
                        ):
                            try:
                                from app.domains.files.version_service import archive_existing_file
                                from app.domains.projects.models import Project
                                from app.services.file_service import UPLOAD_DIR
                                project = db.query(Project).filter(Project.id == file_record.project_id).first()
                                chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
                                
                                if project and chapter:
                                    backup_dir = os.path.abspath(
                                        f"{UPLOAD_DIR}/{project.code}/{chapter.number}/{file_record.category}"
                                    )
                                else:
                                    backup_dir = os.path.dirname(file_path)

                                # Create archive record
                                archive_existing_file(
                                    db,
                                    existing_file=file_record,
                                    base_path=backup_dir,
                                    uploaded_by_id=user_id,
                                )
                                # Increment version of original record
                                file_record.version = (file_record.version or 1) + 1
                                logger.info(f"Deferred auto-backup created and version bumped to {file_record.version}")
                            except Exception as backup_err:
                                logger.error(f"Deferred backup/version bump failed: {backup_err}")

                        file_record.uploaded_by_id = user_id
                        shutil.move(processed_path, file_path)
                        file_record.uploaded_at = now_ist_naive()
                        logger.info(f"In-place overwrite: {file_record.filename} (v{file_record.version})")
                    else:
                        mime = "application/octet-stream"
                        if processed_filename.endswith(".html"):
                            mime = "text/html"
                        elif processed_filename.endswith(".xlsx") or processed_filename.endswith(".xls"):
                            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        elif processed_filename.endswith(".docx"):
                            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            try:
                                inject_publisher_styles_func(processed_path)
                                logger.info(
                                    f"Publisher styles injected into: {processed_filename}"
                                )
                            except Exception as style_err:
                                logger.warning(
                                    f"Style injection failed for {processed_filename}: {style_err}"
                                )
                        elif processed_filename.endswith(".txt") or processed_filename.endswith(".log"):
                            mime = "text/plain"
                        elif processed_filename.endswith(".css"):
                            mime = "text/css"
                        elif processed_filename.endswith(".zip"):
                            mime = "application/zip"
                        elif processed_filename.endswith(".xml"):
                            mime = "application/xml"
                        elif processed_filename.endswith(".epub"):
                            mime = "application/epub+zip"
                        elif processed_filename.endswith((".jpg", ".jpeg")):
                            mime = "image/jpeg"
                        elif processed_filename.endswith(".pdf"):
                            mime = "application/pdf"
                        elif processed_filename.endswith(".xhtml"):
                            mime = "application/xhtml+xml"

                        new_category = (
                            ("Proof" if processed_filename.lower().endswith((".pdf", ".xhtml", ".css")) else "Misc")
                            if process_type == "indesign_to_xml"
                            else "Misc" if process_type == "extract_design_css"
                            else "Manuscript" if (process_type in ("style_validation", "ppd") or processed_filename.lower().endswith("_dashboard.html"))
                            else "XML" if processed_filename.lower().endswith((".xml", ".log", ".html"))
                            else "InDesign" if process_type == "xml_to_indesign"
                            else "XML" if process_type == "word_to_xml"
                            else file_record.category
                        )

                        existing_file = db.query(models.File).filter(
                            models.File.project_id == file_record.project_id,
                            models.File.chapter_id == file_record.chapter_id,
                            models.File.category == new_category,
                            models.File.filename == processed_filename
                        ).first()

                        if existing_file:
                            try:
                                from app.domains.files.version_service import archive_existing_file
                                from app.domains.projects.models import Project
                                from app.services.file_service import UPLOAD_DIR
                                project = db.query(Project).filter(Project.id == file_record.project_id).first()
                                chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
                                
                                if project and chapter:
                                    backup_dir = os.path.abspath(
                                        f"{UPLOAD_DIR}/{project.code}/{chapter.number}/{new_category}"
                                    )
                                else:
                                    backup_dir = os.path.dirname(existing_file.path)

                                # Create archive record
                                archive_existing_file(
                                    db,
                                    existing_file=existing_file,
                                    base_path=backup_dir,
                                    uploaded_by_id=user_id,
                                )
                                # Overwrite existing physical file
                                target_path = existing_file.path
                                if target_path and target_path != processed_path:
                                    if os.path.exists(target_path):
                                        try:
                                            os.remove(target_path)
                                        except Exception:
                                            pass
                                    shutil.move(processed_path, target_path)
                                else:
                                    existing_file.path = processed_path

                                # Increment version and update details
                                existing_file.version = (existing_file.version or 1) + 1
                                existing_file.uploaded_by_id = user_id
                                existing_file.uploaded_at = now_ist_naive()
                                existing_file.file_type = mime
                                logger.info(f"Updated existing file version: {existing_file.filename} (v{existing_file.version})")
                            except Exception as backup_err:
                                logger.error(f"Backup/version bump failed for existing file: {backup_err}")
                        else:
                            new_record = models.File(
                                filename=processed_filename,
                                path=processed_path,
                                file_type=mime,
                                project_id=file_record.project_id,
                                chapter_id=file_record.chapter_id,
                                version=1,
                                category=new_category,
                                is_original=False,
                                uploaded_by_id=user_id,
                            )
                            db.add(new_record)
                            logger.info(
                                f"Registered result file: {processed_filename} to category {new_record.category}"
                            )
            else:
                logger.warning(f"No generated files returned from {process_type} processing")

            file_record.is_checked_out = False
            file_record.checked_out_by_id = None
            file_record.checked_out_at = None
            file_record.processing_error = None

            db.commit()
            logger.info(f"Processing success: {success_msg}")
            update_job_status(db, job_id, "completed", "Job completed successfully", 100)

        except Exception as exc:
            logger.error(f"Processing FAILED for file {file_id}: {str(exc)}")
            logger.error(traceback.format_exc())
            file_record.is_checked_out = False
            file_record.checked_out_by_id = None
            file_record.processing_error = str(exc)
            db.commit()
            update_job_status(db, job_id, "failed", "Error occurred during execution", 100, error=str(exc))

    finally:
        if "lock" in locals():
            try:
                lock.release()
                logger.info(f"Released queue lock for job {job_id}")
            except Exception:
                pass
        db.close()


def start_process(
    db: Session,
    *,
    file_id: int,
    process_type: str,
    background_tasks: BackgroundTasks,
    mode: str,
    user,
    upload_dir: str,
    logger,
    background_task_callable,
    options: Optional[Dict[str, Any]] = None,
):
    logger.info(
        f"Process triggered: {process_type} on file {file_id} by {user.username if user else 'Unknown'}"
    )

    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    check_permission(user, process_type, logger=logger)

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    if os.path.isabs(file_record.path):
        file_path = file_record.path
    else:
        file_path = os.path.abspath(os.path.join(upload_dir, file_record.path))

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Physical file missing: {file_path}")

    if file_record.is_checked_out:
        if file_record.checked_out_by_id != user.id:
            raise HTTPException(
                status_code=400,
                detail=f"File is locked by {file_record.checked_out_by.username}",
            )
    else:
        file_record.is_checked_out = True
        file_record.checked_out_by_id = user.id
        file_record.checked_out_at = now_ist_naive()
        file_record.processing_error = None
        db.commit()

    # For reference validation jobs, we defer version bumping and backup to the background task
    # so we only bump the version if there are actual changes made to the document.
    is_reference_job = process_type in (
        "macro_processing",
        "reference_validation",
        "reference_number_validation",
        "reference_apa_chicago_validation",
        "reference_structuring",
        "reference_report_only",
    )

    if not is_reference_job:
        try:
            from app.domains.projects.models import Project
            version_num = (file_record.version or 1) + 1
            project = db.query(Project).filter(Project.id == file_record.project_id).first()
            chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()

            if project and chapter:
                backup_dir = os.path.abspath(
                    f"{upload_dir}/{project.code}/{chapter.number}/{file_record.category}/Archive"
                )
            else:
                backup_dir = os.path.join(os.path.dirname(file_path), "Archive")

            os.makedirs(backup_dir, exist_ok=True)

            name_only = file_record.filename.rsplit(".", 1)[0]
            ext = file_record.filename.rsplit(".", 1)[1] if "." in file_record.filename else ""
            backup_filename = f"{name_only}_v{(file_record.version or 1)}.{ext}"
            backup_path = os.path.join(backup_dir, backup_filename)

            shutil.copy2(file_path, backup_path)

            new_version = models.FileVersion(
                file_id=file_record.id,
                version_num=(file_record.version or 1),
                path=backup_path,
                uploaded_by_id=user.id,
            )
            db.add(new_version)
            file_record.version = version_num
            db.commit()
            logger.info(f"Auto-backup created: {backup_filename}")
        except Exception as exc:
            logger.error(f"Backup failed: {exc}")

    # Create the ProcessingJob record
    from app.models import ProcessingJob
    
    job = ProcessingJob(
        file_id=file_id,
        process_type=process_type,
        status="pending",
        current_step="Pending queue execution",
        progress_pct=0,
        user_id=user.id if user else None,
        options=options,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        background_task_callable,
        file_id=file_id,
        process_type=process_type,
        user_id=user.id,
        user_username=user.username,
        mode=mode,
        options=options,
        job_id=job.id,
    )

    return {
        "job_id": job.id,
        "message": (
            f"{process_type.capitalize()} started in background. "
            "The file is locked and will be updated shortly."
        ),
        "status": "processing",
    }


def get_structuring_status(db: Session, *, file_id: int, user, process_type: str = "structuring"):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    from app.models import ProcessingJob
    job = db.query(ProcessingJob).filter(
        ProcessingJob.file_id == file_id,
        ProcessingJob.process_type == process_type
    ).order_by(ProcessingJob.created_at.desc()).first()

    if job:
        return {
            "status": job.status,
            "current_step": job.current_step,
            "progress_pct": job.progress_pct,
            "error": job.error_message,
            "new_file_id": file_record.id,
        }

    if file_record.is_checked_out:
        return {"status": "processing"}

    if file_record.processing_error:
        return {"status": "failed", "error": file_record.processing_error, "new_file_id": file_record.id}

    # File is unlocked with no recorded error: background structuring completed!
    return {"status": "completed", "new_file_id": file_record.id}


def get_reference_validation_status(db: Session, *, file_id: int, user):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    from app.models import ProcessingJob
    job = db.query(ProcessingJob).filter(
        ProcessingJob.file_id == file_id,
        ProcessingJob.process_type.in_((
            "macro_processing",
            "reference_validation",
            "reference_number_validation",
            "reference_apa_chicago_validation",
            "reference_structuring",
            "reference_report_only",
        ))
    ).order_by(ProcessingJob.created_at.desc()).first()

    if job:
        return {
            "status": job.status,
            "current_step": job.current_step,
            "progress_pct": job.progress_pct,
            "error": job.error_message,
            "new_file_id": file_record.id,
        }

    # If the parent file is still checked out, the job is still running
    if file_record.is_checked_out:
        return {"status": "processing"}

    if file_record.processing_error:
        return {"status": "failed", "error": file_record.processing_error, "new_file_id": file_record.id}

    # Completed! Since references processing now updates the file in-place,
    # we return the original file's ID.
    return {"status": "completed", "new_file_id": file_record.id}

