"""Word conversion engine for INDD and PDF to DOCX conversion."""

import os
import zipfile
import logging
import requests
from datetime import datetime

from app.core.config import get_settings
from app.domains.post_prod.word_conversion.models import PostProdChapter
from app.services.scripts.docx_post_processor import post_process_docx
from .utils import check_and_update_project_status

logger = logging.getLogger("app.post_prod.word_conversion")


def run_conversion_background(chapter_id: int, session_factory, job_id: int | None = None) -> None:
    """
    Convert INDD/PDF chapters to DOCX format.

    Handles:
    - InDesign (.indd) → DOCX via remote InDesign server
    - PDF → DOCX via remote server or local pdf2docx
    - Post-processing for layout reconstruction

    Args:
        chapter_id: Chapter ID to convert
        session_factory: Database session factory
    """
    db = session_factory()
    job = None
    try:
        chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
        if not chapter:
            return

        from app.models import ProcessingJob
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first() if job_id else None
        if job:
            job.status = "processing"
            job.current_step = "Converting document formats"
            job.progress_pct = 20
            db.commit()

        chapter.status = "In-Progress"
        chapter.conversion_status = "Converting"
        chapter.conversion_started_at = datetime.utcnow()
        chapter.attempts += 1
        db.commit()

        settings = get_settings()
        project_dir = os.path.join(
            settings.UPLOAD_FOLDER,
            "post_prod",
            chapter.client_code or "default_client",
            chapter.project_name or "default_project"
        )
        output_dir = os.path.join(project_dir, "converted")
        os.makedirs(output_dir, exist_ok=True)

        source_base = os.path.splitext(chapter.source_filename)[0]
        dest_filename = f"{source_base}.docx"
        dest_path = os.path.join(output_dir, dest_filename)

        success = False
        error_msg = None

        # Handle InDesign files
        if chapter.source_filename.lower().endswith(".indd"):
            success, error_msg = _convert_indesign(chapter, project_dir, dest_path, db)

        # Handle PDF files
        elif chapter.source_filename.lower().endswith(".pdf"):
            success, error_msg = _convert_pdf(chapter, dest_path)

        # Post-process and finalize
        if success:
            try:
                logger.info(f"Applying post-processing layout reconstruction: {dest_path}")
                post_process_docx(dest_path)
            except Exception as post_err:
                logger.warning(f"DOCX post-processor failed for {dest_path}: {post_err}")

            chapter.conversion_status = "Completed"
            chapter.conversion_completed_at = datetime.utcnow()
            chapter.converted_file_path = dest_path

            if chapter.qc_status == "Completed":
                chapter.status = "Completed"
                chapter.completed_at = datetime.utcnow()

            if job:
                job.status = "completed"
                job.progress_pct = 100
                job.completed_at = datetime.utcnow()
        else:
            chapter.status = "Failed"
            chapter.conversion_status = "Failed"
            chapter.error_message = error_msg or "Unknown error"

            if job:
                job.status = "failed"
                job.progress_pct = 100
                job.error_message = error_msg or "Unknown error"
                job.completed_at = datetime.utcnow()

        db.commit()
        try:
            check_and_update_project_status(db, chapter.project_name, chapter.client_code)
        except Exception as check_err:
            logger.warning(f"Failed to check and update project status: {check_err}")

    except Exception as e:
        logger.exception("Error in background conversion task")
        try:
            chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
            if chapter:
                chapter.status = "Failed"
                chapter.conversion_status = "Failed"
                chapter.error_message = str(e)
                db.commit()
            if job:
                job.status = "failed"
                job.progress_pct = 100
                job.error_message = str(e)
                job.completed_at = datetime.utcnow()
                db.commit()
        except:
            pass
    finally:
        db.close()


def _convert_indesign(chapter: PostProdChapter, project_dir: str, dest_path: str, db) -> tuple[bool, str]:
    """
    Convert InDesign file to DOCX.

    Packages chapter assets (fonts, images) and sends to remote InDesign server.

    Args:
        chapter: PostProdChapter instance
        project_dir: Project directory path
        dest_path: Destination DOCX file path
        db: Database session

    Returns:
        (success: bool, error_msg: str | None)
    """
    settings = get_settings()

    if not settings.INDESIGN_SERVER_URL:
        return False, "InDesign server URL is not configured"

    chapter_dir = os.path.dirname(chapter.source_file_path)
    zip_name = f"packaged_{os.path.splitext(chapter.source_filename)[0]}.zip"
    temp_zip_path = os.path.join(project_dir, zip_name)

    # Get other chapters to exclude their files
    all_chaps = db.query(PostProdChapter).filter(
        PostProdChapter.project_name == chapter.project_name,
        PostProdChapter.client_code == chapter.client_code
    ).all()
    other_source_filenames = {c.source_filename for c in all_chaps if c.id != chapter.id}
    other_chapter_nos = {c.chapter_no for c in all_chaps if c.id != chapter.id}

    try:
        # Package chapter assets into ZIP
        logger.info(f"Packaging chapter directory {chapter_dir} into ZIP: {temp_zip_path}")
        with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, filenames in os.walk(chapter_dir):
                rel_root = os.path.relpath(root, chapter_dir)
                path_parts = rel_root.replace("\\", "/").lower().split("/")

                # Skip folders belonging to other chapters
                is_other_chapter_folder = False
                for part in path_parts:
                    for other_no in other_chapter_nos:
                        if other_no and (f"ch{other_no}" in part or f"chap{other_no}" in part or part == other_no):
                            is_other_chapter_folder = True
                            break
                    if is_other_chapter_folder:
                        break

                if is_other_chapter_folder:
                    continue

                for f in filenames:
                    # Skip system files and other chapters
                    if f.startswith("._") or f.startswith("__MACOSX") or f == zip_name:
                        continue
                    if f in other_source_filenames:
                        continue

                    full_file_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_file_path, chapter_dir)
                    zf.write(full_file_path, rel_path)

        # Send to InDesign server
        url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert"
        try:
            logger.info(f"Sending packaged ZIP to InDesign server: {url}")
            client_name = chapter.project.client if chapter.project else None
            with open(temp_zip_path, "rb") as zip_file:
                response = requests.post(
                    url,
                    params={"client": client_name},
                    files={"file": (zip_name, zip_file.read(), "application/octet-stream")},
                    timeout=(30.0, 900)
                )
            if response.status_code == 200:
                with open(dest_path, "wb") as out_f:
                    out_f.write(response.content)
                return True, None
            else:
                raise Exception(f"InDesign server returned {response.status_code}: {response.text}")

        except Exception as indd_err:
            # Try fallback to root URL
            try:
                url_fallback = settings.INDESIGN_SERVER_URL
                logger.info(f"Trying fallback to root URL: {url_fallback}")
                with open(temp_zip_path, "rb") as zip_file:
                    response_fb = requests.post(
                        url_fallback,
                        params={"client": client_name},
                        files={"file": (zip_name, zip_file.read(), "application/octet-stream")},
                        timeout=(30.0, 900)
                    )
                if response_fb.status_code == 200:
                    with open(dest_path, "wb") as out_f:
                        out_f.write(response_fb.content)
                    return True, None
                else:
                    raise Exception(f"InDesign server returned {response_fb.status_code}: {response_fb.text}")

            except Exception as fb_err:
                error_msg = f"InDesign conversion failed: {str(indd_err)} -> Fallback: {str(fb_err)}"
                return False, error_msg

    except Exception as zip_err:
        error_msg = f"Failed to package InDesign chapter assets: {str(zip_err)}"
        return False, error_msg

    finally:
        # Clean up temporary ZIP
        if os.path.exists(temp_zip_path):
            try:
                os.remove(temp_zip_path)
            except Exception as rm_err:
                logger.warning(f"Could not remove temp zip file {temp_zip_path}: {rm_err}")


def _convert_pdf(chapter: PostProdChapter, dest_path: str) -> tuple[bool, str]:
    """
    Convert PDF to DOCX.

    Uses remote InDesign server if configured, otherwise falls back to pdf2docx.

    Args:
        chapter: PostProdChapter instance
        dest_path: Destination DOCX file path

    Returns:
        (success: bool, error_msg: str | None)
    """
    settings = get_settings()

    # Try remote server first
    if settings.INDESIGN_SERVER_URL:
        url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-pdf"
        try:
            logger.info(f"Sending PDF to remote server: {url}")
            with open(chapter.source_file_path, "rb") as pdf_file:
                response = requests.post(
                    url,
                    files={"file": (chapter.source_filename, pdf_file.read(), "application/octet-stream")},
                    timeout=(30.0, 900)
                )
            if response.status_code == 200:
                with open(dest_path, "wb") as out_f:
                    out_f.write(response.content)
                return True, None
            else:
                raise Exception(f"Remote PDF server returned {response.status_code}: {response.text}")

        except Exception as pdf_err:
            error_msg = f"Remote PDF conversion failed: {str(pdf_err)}"
            logger.warning(error_msg)

    # Fallback to local pdf2docx
    try:
        from pdf2docx import Converter
        logger.info(f"Converting PDF locally using pdf2docx: {chapter.source_file_path}")
        cv = Converter(chapter.source_file_path)
        cv.convert(dest_path, start=0, end=None)
        cv.close()
        return True, None

    except Exception as pdf_err:
        error_msg = f"PDF converter failed: {str(pdf_err)}"
        return False, error_msg
