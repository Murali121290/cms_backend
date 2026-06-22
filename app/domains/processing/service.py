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
    "language": ["Editor", "CopyEditor", "Admin"],
    "technical": ["Editor", "CopyEditor", "Admin"],
    "macro_processing": ["Editor", "CopyEditor", "Admin"],
    "ppd": ["PPD", "ProjectManager", "Admin"],
    "permissions": ["PermissionsManager", "ProjectManager", "Admin"],
    "reference_validation": ["Editor", "CopyEditor", "Admin"],
    "structuring": ["Editor", "CopyEditor", "Admin"],
    "bias_scan": ["Editor", "CopyEditor", "Admin", "ProjectManager"],
    "credit_extractor_ai": ["PermissionsManager", "ProjectManager", "Admin"],
    "word_to_xml": ["PPD", "ProjectManager", "Admin"],
}


def check_permission(user, process_type: str, *, logger):
    allowed = PROCESS_PERMISSIONS.get(process_type, ["Admin"])
    user_role_names = [role.name for role in user.roles]
    if not any(role in user_role_names for role in allowed):
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


def background_processing_task(
    file_id: int,
    process_type: str,
    user_id: int,
    user_username: str,
    mode: str = "style",
    options: Optional[dict[str, Any]] = None,
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

        file_record = db.query(models.File).filter(models.File.id == file_id).first()
        if not file_record:
            logger.error(f"File {file_id} not found in background task.")
            return

        file_path = os.path.abspath(file_record.path)
        success_msg = ""
        generated_files = []

        try:
            if process_type == "permissions":
                generated_files = permissions_engine_cls().process_document(file_path)
                success_msg = "Permissions Log generated successfully"

            elif process_type == "ppd":
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

                if structuring_method == "manual":
                    logger.info(f"Starting manual structuring (mode={mode}) using app.utils.utils.structuring_lib for: {os.path.basename(file_path)}")
                    from app.utils.utils.structuring_lib.styler import process_docx as manual_process_docx
                    dir_name = os.path.dirname(file_path)
                    base_name = os.path.basename(file_path)
                    name_only = os.path.splitext(base_name)[0]
                    output_filename = f"{name_only}_Processed.docx"
                    output_path = os.path.join(dir_name, output_filename)
                    
                    result = manual_process_docx(
                        input_path=file_path,
                        output_path=output_path,
                        mode=mode
                    )
                    if not result.get("success", False):
                        error_msg = "; ".join(result.get("errors", ["Unknown structuring error"]))
                        logger.error(f"Manual structuring failed: {error_msg}")
                        raise Exception(f"Manual structuring failed: {error_msg}")
                    generated_files = [output_path]
                    success_msg = f"Manual structuring completed (mode: {mode})"
                else:
                    generated_files = structuring_engine_cls().process_document(file_path, mode=mode)
                    success_msg = f"Structuring completed (mode: {mode})"

            elif process_type == "bias_scan":
                if os.environ.get("PPH_ENABLED", "false").lower() in ("true", "1", "yes"):
                    generated_files = _run_via_pph(file_path, "/bias-scan")
                    success_msg = "Bias Scan completed via PPH"
                else:
                    generated_files = bias_engine_cls().process_document(file_path)
                    success_msg = "Bias Scan completed successfully"

            elif process_type == "credit_extractor_ai":
                if os.environ.get("PPH_ENABLED", "false").lower() in ("true", "1", "yes"):
                    generated_files = _run_via_pph(file_path, "/credit-extractor")
                    success_msg = "AI Credit Extraction completed via PPH"
                else:
                    generated_files = ai_extractor_engine_cls().process_document(file_path)
                    success_msg = "AI Credit Extraction completed"

            elif process_type == "word_to_xml":
                if os.environ.get("PPH_ENABLED", "false").lower() in ("true", "1", "yes"):
                    generated_files = _run_via_pph(file_path, "/word-to-xml")
                    success_msg = "Word to XML conversion completed via PPH"
                else:
                    generated_files = xml_engine_cls().process_document(file_path)
                    success_msg = "Word to XML conversion completed"

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

                    # For structuring and technical: move staging file to original path (in-place update)
                    if process_type in ("structuring", "technical") and os.path.exists(processed_path):
                        if processed_filename.endswith(".docx"):
                            try:
                                inject_publisher_styles_func(processed_path)
                                logger.info(f"Publisher styles injected into: {processed_filename}")
                            except Exception as style_err:
                                logger.warning(f"Style injection failed for {processed_filename}: {style_err}")

                        shutil.move(processed_path, file_path)
                        file_record.uploaded_at = now_ist_naive()
                        logger.info(f"In-place overwrite: {file_record.filename} (v{file_record.version})")
                    else:
                        # All other types (references, bias, xml, etc.) create new records
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
                        elif processed_filename.endswith(".txt"):
                            mime = "text/plain"
                        elif processed_filename.endswith(".zip"):
                            mime = "application/zip"
                        elif processed_filename.endswith(".xml"):
                            mime = "application/xml"

                        new_record = models.File(
                            filename=processed_filename,
                            path=processed_path,
                            file_type=mime,
                            project_id=file_record.project_id,
                            chapter_id=file_record.chapter_id,
                            version=1,
                            category=file_record.category,
                        )
                        db.add(new_record)
                        logger.info(
                            f"Registered result file: {processed_filename} to category {file_record.category}"
                        )
            else:
                logger.warning(f"No generated files returned from {process_type} processing")

            file_record.is_checked_out = False
            file_record.checked_out_by_id = None
            file_record.checked_out_at = None

            db.commit()
            logger.info(f"Processing success: {success_msg}")

        except Exception as exc:
            logger.error(f"Processing FAILED for file {file_id}: {str(exc)}")
            logger.error(traceback.format_exc())
            file_record.is_checked_out = False
            file_record.checked_out_by_id = None
            db.commit()

    finally:
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

    file_path = os.path.abspath(file_record.path)
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
        db.commit()

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

    background_tasks.add_task(
        background_task_callable,
        file_id=file_id,
        process_type=process_type,
        user_id=user.id,
        user_username=user.username,
        mode=mode,
        options=options,
    )

    return JSONResponse(
        content={
            "message": (
                f"{process_type.capitalize()} started in background. "
                "The file is locked and will be updated shortly."
            ),
            "status": "processing",
        }
    )


def get_structuring_status(db: Session, *, file_id: int, user):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    # If the file is unlocked, background structuring has completed!
    if not file_record.is_checked_out:
        return {"status": "completed", "new_file_id": file_record.id}
    return {"status": "processing"}


def get_reference_validation_status(db: Session, *, file_id: int, user):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    # If the parent file is still checked out, the job is still running
    if file_record.is_checked_out:
        return {"status": "processing"}

    # Completed! Let's find the derived Processed file or fall back to Structured or original
    derived_file = db.query(models.File).filter(
        models.File.project_id == file_record.project_id,
        models.File.chapter_id == file_record.chapter_id,
        models.File.filename.like("%_Processed.docx")
    ).order_by(models.File.id.desc()).first()

    if not derived_file:
        derived_file = db.query(models.File).filter(
            models.File.project_id == file_record.project_id,
            models.File.chapter_id == file_record.chapter_id,
            models.File.filename.like("%_Structured.docx")
        ).order_by(models.File.id.desc()).first()

    new_file_id = derived_file.id if derived_file else file_record.id
    return {"status": "completed", "new_file_id": new_file_id}

