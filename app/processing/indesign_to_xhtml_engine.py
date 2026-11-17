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


class InDesignToXHTMLEngine:
    """
    Part 2: InDesign -> XHTML Engine
    Extracts editorial XHTML, visual PDF proof, IDML, and revision map from
    a chapter's InDesign document via Windows Conversion Server (d2id indd-to-xhtml).
    Guarantees consistent <filename> naming matching the original manuscript/chapter.
    """

    def process_document(
        self,
        db: Session,
        file_path: str,
        file_record: models.File,
        user_id: int | None = None,
        upload_dir: str | None = None,
        logger=logger,
        job_id: int | None = None,
    ) -> list[str]:
        settings = get_settings()

        from app.domains.processing.service import resolve_physical_file_path
        from app.services.file_service import UPLOAD_DIR
        target_upload_dir = upload_dir or UPLOAD_DIR

        # 1. Resolve project and chapter
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not project or not chapter:
            raise ValueError("Associated project or chapter details are missing.")

        # 2. Resolve verified physical path of input .indd
        if not os.path.exists(file_path):
            file_path = resolve_physical_file_path(file_path, str(target_upload_dir))
            if not os.path.exists(file_path) and file_record and file_record.path:
                file_path = resolve_physical_file_path(file_record.path, str(target_upload_dir))

        if not os.path.exists(file_path) or not file_path.lower().endswith(".indd"):
            raise FileNotFoundError(f"Valid physical InDesign (.indd) file not found: {file_path}")

        chapter_code = chapter.chapters or chapter.number
        base_name = os.path.splitext(os.path.basename(file_path))[0]

        # 3. Create target directories
        project_dir = os.path.abspath(os.path.join(str(target_upload_dir), project.client_name or "unknown", project.code))
        chapter_dir = os.path.abspath(os.path.join(project_dir, chapter_code))
        
        stages_r1_dir = os.path.join(chapter_dir, "Stages", "R1")
        proof_dir = os.path.join(chapter_dir, "Proof")
        xml_dir = os.path.join(chapter_dir, "XML")
        indesign_dir = os.path.join(chapter_dir, "InDesign")

        os.makedirs(stages_r1_dir, exist_ok=True)
        os.makedirs(proof_dir, exist_ok=True)
        os.makedirs(xml_dir, exist_ok=True)
        os.makedirs(indesign_dir, exist_ok=True)

        # 4. Discover linked artwork
        from app.services.file_service import resolve_chapter_art_folder, resolve_project_common_art_files
        common_art_files = resolve_project_common_art_files(project_dir=project_dir, db=db, project_id=project.id)
        art_folder = resolve_chapter_art_folder(
            project_dir=project_dir,
            chapter_dir=chapter_dir,
            chapter_number=chapter_code,
        )

        # 5. Package .indd and artwork into temporary ZIP
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging InDesign-to-XHTML assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                written_in_zip = set()

                def safe_zf_write(src_path: str, arc_name: str):
                    norm_arc = arc_name.replace("\\", "/")
                    if norm_arc not in written_in_zip and os.path.exists(src_path):
                        zf.write(src_path, norm_arc)
                        written_in_zip.add(norm_arc)

                # Write main .indd
                safe_zf_write(file_path, os.path.basename(file_path))

                # Write common art
                if common_art_files:
                    for ca_file in common_art_files:
                        safe_zf_write(ca_file, f"artfile/{os.path.basename(ca_file)}")

                # Write chapter artwork
                if art_folder and os.path.exists(art_folder):
                    logger.info(f"Packaging art files from: {art_folder}")
                    for root_a, _, files_a in os.walk(art_folder):
                        for f in files_a:
                            full_p = os.path.join(root_a, f)
                            rel_p = os.path.relpath(full_p, art_folder).replace("\\", "/")
                            safe_zf_write(full_p, f"artfile/{rel_p}")

            # 6. Call Windows Conversion Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-indesign-to-xhtml"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering InDesign-to-XHTML lock loop...")
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
                            "indesign_to_xhtml",
                            "xhtml_to_indesign",
                            "xml_to_indesign",
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
                logger.info(f"Lock acquired. Sending InDesign-to-XHTML request to: {url}")
                client_name = project.client_name or ""
                with open(temp_zip_path, "rb") as zf_in:
                    response = requests.post(
                        url,
                        params={"client": client_name},
                        files={"file": (os.path.basename(temp_zip_path), zf_in.read(), "application/octet-stream")},
                        timeout=(30.0, 1200)
                    )
                if response.status_code != 200:
                    raise RuntimeError(f"Windows server returned {response.status_code}: {response.text}")
            finally:
                try:
                    lock.release()
                except Exception:
                    pass

            if job:
                db.refresh(job)
                if job.status == "cancelled":
                    logger.info(f"Job {job_id} cancelled during conversion. Discarding output.")
                    return []

            # 7. Extract artifacts into Stages/R1/ and normalize to <base_name>.*
            import io
            output_files = []

            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                file_list = z.namelist()
                logger.info(f"Received files from Windows Server indd-to-xhtml: {file_list}")

                # Save all files to Stages/R1/ for stage history
                for f in file_list:
                    dest_path = os.path.join(stages_r1_dir, os.path.basename(f))
                    with open(dest_path, "wb") as out_f:
                        out_f.write(z.read(f))

                # Extract and register <base_name>.xhtml in Proof/ folder
                xhtml_file = next((f for f in file_list if f.lower().endswith(".xhtml")), None)
                if xhtml_file:
                    clean_xhtml_name = f"{base_name}.xhtml"
                    dest_xhtml_path = os.path.join(proof_dir, clean_xhtml_name)
                    with open(dest_xhtml_path, "wb") as out_f:
                        out_f.write(z.read(xhtml_file))
                    logger.info(f"Saved editorial XHTML to Proof folder: {dest_xhtml_path}")
                    output_files.append(dest_xhtml_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Proof", filename=clean_xhtml_name, file_path=dest_xhtml_path,
                        file_type="application/xhtml+xml", user_id=user_id
                    )

                # Extract and register <base_name>.pdf
                pdf_file = next((f for f in file_list if f.lower().endswith(".pdf")), None)
                if pdf_file:
                    clean_pdf_name = f"{base_name}.pdf"
                    dest_pdf_path = os.path.join(proof_dir, clean_pdf_name)
                    with open(dest_pdf_path, "wb") as out_f:
                        out_f.write(z.read(pdf_file))
                    logger.info(f"Saved visual proof PDF: {dest_pdf_path}")
                    output_files.append(dest_pdf_path)

                    self._register_file(
                        db, project_id=project.id, chapter_id=chapter.id,
                        category="Proof", filename=clean_pdf_name, file_path=dest_pdf_path,
                        file_type="application/pdf", user_id=user_id
                    )

                # Extract and register <base_name>.idml & <base_name>.indd
                for f in file_list:
                    f_lower = f.lower()
                    if f_lower.endswith(".indd") or f_lower.endswith(".idml"):
                        clean_ext = os.path.splitext(f)[1]
                        clean_name = f"{base_name}{clean_ext}"
                        dest_path = os.path.join(indesign_dir, clean_name)
                        with open(dest_path, "wb") as out_f:
                            out_f.write(z.read(f))
                        logger.info(f"Saved InDesign artifact: {dest_path}")
                        output_files.append(dest_path)

                        self._register_file(
                            db, project_id=project.id, chapter_id=chapter.id,
                            category="InDesign", filename=clean_name, file_path=dest_path,
                            file_type="application/x-indesign" if clean_name.endswith(".indd") else "application/vnd.adobe.indesign-idml-package",
                            user_id=user_id
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
