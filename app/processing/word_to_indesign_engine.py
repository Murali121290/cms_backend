import os
import zipfile
import requests
import redis
import shutil
import tempfile
import logging
import time
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app import models
from app.core.config import get_settings
from app.domains.projects.models import Project

logger = logging.getLogger("app.processing")

class WordToInDesignEngine:
    def process_document(
        self,
        db: Session,
        file_path: str,
        file_record: models.File,
        template_file_id: int | None = None,
        user_id: int | None = None,
        upload_dir: str | None = None,
        logger=logger,
        job_id: int | None = None,
    ) -> list[str]:
        """
        Packages Word (.docx) manuscript, InDesign template (.indt/.indd),
        art files (Links/artfile), and design assets, and sends them to the Windows
        Conversion Server executing the d2id Python engine.
        Saves the returned .indd, .idml, .pdf, and report.html and registers them in DB.
        """
        settings = get_settings()

        from app.domains.processing.service import resolve_physical_file_path
        from app.services.file_service import UPLOAD_DIR
        target_upload_dir = upload_dir or UPLOAD_DIR

        # 1. Fetch template file record
        template_file = None
        if template_file_id:
            template_file = db.query(models.File).filter(models.File.id == template_file_id).first()

        # If not passed, auto-detect template from project
        if not template_file and file_record.project_id:
            template_file = db.query(models.File).filter(
                models.File.project_id == file_record.project_id,
                models.File.filename.ilike("%.indt")
            ).order_by(models.File.created_at.desc()).first()

            if not template_file:
                template_file = db.query(models.File).filter(
                    models.File.project_id == file_record.project_id,
                    models.File.category.in_(["Design", "InDesign", "template"]),
                    models.File.filename.ilike("%.indd")
                ).order_by(models.File.created_at.desc()).first()

        if not template_file:
            raise FileNotFoundError("InDesign template (.indt or .indd) not found. Please upload or specify a template.")

        template_path = resolve_physical_file_path(template_file.path, str(target_upload_dir))
        if not os.path.exists(template_path):
            raise FileNotFoundError(f"Physical template file missing on disk: {template_path}")

        # 2. Identify project and chapter
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not project or not chapter:
            raise ValueError("Associated project or chapter details are missing.")

        # 3. Create target directories
        indesign_dir = os.path.join(upload_dir or UPLOAD_DIR, project.client_name or "unknown", project.code, chapter.number, "InDesign")
        proof_dir = os.path.join(upload_dir or UPLOAD_DIR, project.client_name or "unknown", project.code, chapter.number, "Proof")
        manuscript_dir = os.path.join(upload_dir or UPLOAD_DIR, project.client_name or "unknown", project.code, chapter.number, "Manuscript")
        os.makedirs(indesign_dir, exist_ok=True)
        os.makedirs(proof_dir, exist_ok=True)
        os.makedirs(manuscript_dir, exist_ok=True)

        docx_base = os.path.splitext(os.path.basename(file_path))[0]

        # 4. Generate temp ZIP file
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        project_dir = os.path.abspath(os.path.join(upload_dir or UPLOAD_DIR, project.client_name or "unknown", project.code))
        chapter_dir = os.path.abspath(os.path.join(project_dir, chapter.number))

        try:
            logger.info(f"Packaging Word-to-InDesign assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Add Word file at root of the zip
                docx_filename = os.path.basename(file_path)
                zf.write(file_path, docx_filename)

                # Add Template (.indt/.indd) file
                template_rel = os.path.relpath(template_path, project_dir) if project_dir in template_path else os.path.basename(template_path)
                zf.write(template_path, template_rel)
                fname = os.path.basename(template_path)
                zf.write(template_path, f"Design/template/indesign/{fname}")
                zf.write(template_path, f"Design/template/InDesign/{fname}")

                # Add Design folders (Fonts, Libraries, Common Art)
                design_folders = [
                    "Design/template/Common Art",
                    "Design/template/Font",
                    "Design/template/Document fonts",
                    "Design/template/Library",
                    "Design/template/indesign",
                    "Design/template/InDesign",
                ]
                for folder in design_folders:
                    folder_path = os.path.join(project_dir, folder)
                    if os.path.exists(folder_path):
                        for root, dirs, files in os.walk(folder_path):
                            dirs[:] = [d for d in dirs if d.lower() != "archive"]
                            for file in files:
                                full_file_path = os.path.join(root, file)
                                rel_path = os.path.relpath(full_file_path, project_dir)
                                if "archive" in rel_path.lower().replace("\\", "/").split("/"):
                                    continue
                                zf.write(full_file_path, rel_path)

                # Add Chapter Art files packaged under 'artfile/'
                from app.services.file_service import resolve_chapter_art_folder
                art_folder = resolve_chapter_art_folder(
                    project_dir=project_dir,
                    chapter_dir=chapter_dir,
                    chapter_number=chapter.number,
                )

                if art_folder and os.path.exists(art_folder):
                    logger.info(f"Packaging art files from folder: {art_folder} into artfile/")
                    for root, _, files in os.walk(art_folder):
                        for file in files:
                            full_file_path = os.path.join(root, file)
                            rel_path = os.path.relpath(full_file_path, art_folder)
                            zf.write(full_file_path, os.path.join("artfile", rel_path))
                else:
                    logger.warning(f"Could not locate art folder for chapter {chapter.number} (searched project dir {project_dir})")

            # 5. Call InDesign Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-word-to-indesign"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering Word-to-InDesign lock loop...")
            while True:
                if job:
                    db.refresh(job)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                        return []

                higher_job = None
                if job:
                    higher_job = db.query(models.ProcessingJob).filter(
                        models.ProcessingJob.status.in_(["pending", "processing"]),
                        models.ProcessingJob.id != job.id,
                        models.ProcessingJob.process_type.in_([
                            "word_to_indesign",
                            "xml_to_indesign",
                            "post_prod_conversion",
                            "ppd",
                        ])
                    ).filter(
                        (models.ProcessingJob.priority > job.priority) |
                        ((models.ProcessingJob.priority == job.priority) & (models.ProcessingJob.id < job.id))
                    ).first()

                if higher_job:
                    time.sleep(2)
                    continue

                acquired = lock.acquire(blocking=False)
                if acquired:
                    break
                time.sleep(2)

            try:
                logger.info(f"Lock acquired. Sending Word-to-InDesign request to: {url}")
                client_name = project.client_name or ""
                with open(temp_zip_path, "rb") as zf_in:
                    response = requests.post(
                        url,
                        params={"client": client_name},
                        files={"file": (os.path.basename(temp_zip_path), zf_in.read(), "application/octet-stream")},
                        timeout=(30.0, 1200)
                    )
                if response.status_code != 200:
                    raise RuntimeError(f"Remote InDesign server returned status code {response.status_code}. Response: {response.text}")
            finally:
                try:
                    lock.release()
                except Exception:
                    pass

            if job:
                db.refresh(job)
                if job.status == "cancelled":
                    logger.info(f"Job {job_id} was cancelled during conversion. Discarding output.")
                    return []

            # 6. Save response content (ZIP containing INDD, IDML, PDF, and report.html)
            import io
            output_files = []

            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                file_list = z.namelist()
                logger.info(f"Received files from Windows Server Word-to-InDesign: {file_list}")

                # 6a. Process InDesign INDD & IDML files
                for f in file_list:
                    f_lower = f.lower()
                    if f_lower.endswith(".indd") or f_lower.endswith(".idml"):
                        clean_name = f"{docx_base}{os.path.splitext(f)[1]}"
                        dest_path = os.path.join(indesign_dir, clean_name)
                        with open(dest_path, "wb") as out_f:
                            out_f.write(z.read(f))
                        logger.info(f"Saved generated InDesign file: {dest_path}")
                        output_files.append(dest_path)

                        # Register in database
                        self._register_file(
                            db, project_id=project.id, chapter_id=chapter.id,
                            category="InDesign", filename=clean_name, file_path=dest_path,
                            file_type="application/x-indesign" if clean_name.endswith(".indd") else "application/vnd.adobe.indesign-idml-package",
                            user_id=user_id
                        )

                # Copy art files into indesign_dir/artfile and indesign_dir/Links
                if art_folder and os.path.exists(art_folder):
                    for sub_folder_name in ["artfile", "Links"]:
                        target_art_dir = os.path.join(indesign_dir, sub_folder_name)
                        os.makedirs(target_art_dir, exist_ok=True)
                        for root_art, _, art_files in os.walk(art_folder):
                            for art_file in art_files:
                                src_art_path = os.path.join(root_art, art_file)
                                rel_art_path = os.path.relpath(src_art_path, art_folder)
                                dst_art_path = os.path.join(target_art_dir, rel_art_path)
                                os.makedirs(os.path.dirname(dst_art_path), exist_ok=True)
                                shutil.copy2(src_art_path, dst_art_path)

                    # Also ensure chapter_dir/Art has the art files if not already there
                    ch_art_dir = os.path.join(chapter_dir, "Art")
                    if os.path.abspath(ch_art_dir) != os.path.abspath(art_folder):
                        os.makedirs(ch_art_dir, exist_ok=True)
                        for root_art, _, art_files in os.walk(art_folder):
                            for art_file in art_files:
                                src_art_path = os.path.join(root_art, art_file)
                                rel_art_path = os.path.relpath(src_art_path, art_folder)
                                dst_art_path = os.path.join(ch_art_dir, rel_art_path)
                                os.makedirs(os.path.dirname(dst_art_path), exist_ok=True)
                                shutil.copy2(src_art_path, dst_art_path)

                # 6b. Process PDF file
                pdf_in_zip = next((f for f in file_list if f.lower().endswith(".pdf")), None)
                if pdf_in_zip:
                    clean_pdf_name = f"{docx_base}.pdf"
                    dest_pdf_path = os.path.join(proof_dir, clean_pdf_name)
                    with open(dest_pdf_path, "wb") as out_f:
                        out_f.write(z.read(pdf_in_zip))
                    logger.info(f"Saved generated PDF file: {dest_pdf_path}")
                    output_files.append(dest_pdf_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Proof", filename=clean_pdf_name, file_path=dest_pdf_path,
                        file_type="application/pdf", user_id=user_id
                    )

                # 6c. Process report.html
                report_in_zip = next((f for f in file_list if f.lower().endswith(".html")), None)
                if report_in_zip:
                    clean_report_name = f"{docx_base}_Word_to_InDesign_Report.html"
                    dest_report_path = os.path.join(manuscript_dir, clean_report_name)
                    with open(dest_report_path, "wb") as out_f:
                        out_f.write(z.read(report_in_zip))
                    logger.info(f"Saved Word-to-InDesign report: {dest_report_path}")
                    output_files.append(dest_report_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Manuscript", filename=clean_report_name, file_path=dest_report_path,
                        file_type="text/html", user_id=user_id
                    )

            db.commit()
            return output_files

        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception:
                    pass

    def _register_file(
        self,
        db: Session,
        *,
        project_id: int,
        chapter_id: int,
        category: str,
        filename: str,
        file_path: str,
        file_type: str,
        user_id: int | None
    ):
        from app.domains.files.version_service import archive_existing_file

        existing = db.query(models.File).filter(
            models.File.chapter_id == chapter_id,
            models.File.category == category,
            models.File.filename == filename
        ).first()

        if existing:
            archive_dir = os.path.join(os.path.dirname(existing.path or file_path), "archive")
            archive_existing_file(
                db,
                existing_file=existing,
                base_path=archive_dir,
                uploaded_by_id=user_id,
            )
            existing.path = file_path
            existing.version = (existing.version or 1) + 1
            existing.uploaded_by_id = user_id
            existing.uploaded_at = datetime.now(timezone.utc)
            existing.file_type = file_type
            logger.info(f"Updated file version: {existing.filename} (v{existing.version})")
        else:
            new_file = models.File(
                filename=filename,
                path=file_path,
                category=category,
                file_type=file_type,
                version=1,
                is_original=False,
                project_id=project_id,
                chapter_id=chapter_id,
                uploaded_by_id=user_id,
                uploaded_at=datetime.now(timezone.utc),
            )
            db.add(new_file)
            logger.info(f"Created new file record: {filename}")
