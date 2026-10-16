import os
import time
import zipfile
import tempfile
import requests
import redis
import logging
import mimetypes
import io
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.config import get_settings
from app import models
from app.domains.projects.models import Project
from app.domains.files.version_service import archive_existing_file
from app.utils.timezone import now_ist_naive

logger = logging.getLogger(__name__)


class InddToProofEngine:
    """
    Process 1: InDesign to Proof (Indd2Xhtml)
    Takes an InDesign layout document (.indd) and adjacent art/image files.
    Invokes C:\\Users\\muraliba\\Documents\\capturelayouts.jsx on the Windows InDesign Server.
    Extracts and registers the generated XHTML (.xhtml), CSS (.css), and figure JPGs into the chapter's Proof folder.
    """

    def process_document(
        self,
        db: Session,
        file_path: str,
        file_record: models.File,
        user_id: int,
        upload_dir: str,
        logger,
        job_id: int | None = None,
    ) -> list[str]:
        settings = get_settings()

        # 1. Fetch project and chapter details
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        if not project:
            raise ValueError(f"Project with ID {file_record.project_id} not found.")

        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not chapter:
            raise ValueError(f"Chapter with ID {file_record.chapter_id} not found.")

        # Resolve physical INDD path
        if not os.path.isabs(file_path) or not os.path.exists(file_path):
            from app.domains.processing.service import resolve_physical_file_path
            from app.services.file_service import UPLOAD_DIR
            target_upload_dir = upload_dir or UPLOAD_DIR
            file_path = resolve_physical_file_path(file_path, str(target_upload_dir))
            if not os.path.exists(file_path) and file_record and file_record.path:
                file_path = resolve_physical_file_path(file_record.path, str(target_upload_dir))

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Physical InDesign (.indd) file not found: {file_path}")

        # 2. Package INDD and Art files into temporary ZIP
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging assets for InDesign to Proof into: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Add INDD file at root
                indd_basename = os.path.basename(file_path)
                zf.write(file_path, indd_basename)

                # Collect Art / Links files from chapter and project directories
                chapter_dir = os.path.join(upload_dir, project.client_name or "unknown", project.code, chapter.chapters)
                project_dir = os.path.join(upload_dir, project.client_name or "unknown", project.code)

                seen_art_files = set()

                # Search chapter subfolders: artfile, links, art
                for root, dirs, _ in os.walk(chapter_dir):
                    dirs[:] = [d for d in dirs if d.lower() != "archive"]
                    for dname in dirs:
                        if dname.lower() in ("artfile", "links", "art"):
                            art_folder = os.path.join(root, dname)
                            target_prefix = "artfile" if dname.lower() in ("artfile", "art") else "Links"
                            for r, _, sub_files in os.walk(art_folder):
                                for f in sub_files:
                                    f_full = os.path.join(r, f)
                                    if f_full in seen_art_files:
                                        continue
                                    seen_art_files.add(f_full)
                                    rel_within = os.path.relpath(f_full, art_folder)
                                    zf.write(f_full, f"{target_prefix}/{rel_within}".replace("\\", "/"))

                # Also search project-level Design/template/Common Art if present
                common_art = os.path.join(project_dir, "Design", "template", "Common Art")
                if os.path.exists(common_art):
                    for r, _, sub_files in os.walk(common_art):
                        for f in sub_files:
                            f_full = os.path.join(r, f)
                            if f_full in seen_art_files:
                                continue
                            seen_art_files.add(f_full)
                            rel_within = os.path.relpath(f_full, common_art)
                            zf.write(f_full, f"artfile/{rel_within}".replace("\\", "/"))

            # 3. Call Windows InDesign Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-indesign-to-proof"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering prioritization lock loop for InDesign to Proof...")
            while True:
                if job:
                    db.refresh(job)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                        return []

                higher_job = db.query(models.ProcessingJob).filter(
                    models.ProcessingJob.status.in_(["pending", "processing"]),
                    models.ProcessingJob.id != (job.id if job else 0),
                    models.ProcessingJob.process_type.in_(["xml_to_indesign", "indesign_to_xml", "view_proof", "indd_to_proof"])
                ).filter(
                    (models.ProcessingJob.priority > (job.priority if job else 0)) |
                    ((models.ProcessingJob.priority == (job.priority if job else 0)) & (models.ProcessingJob.id < (job.id if job else 0)))
                ).first()

                if higher_job:
                    time.sleep(2)
                    continue

                acquired = lock.acquire(blocking=False)
                if acquired:
                    break
                time.sleep(2)

            try:
                logger.info(f"Lock acquired. Sending remote /convert-indesign-to-proof request to: {url}")
                with open(temp_zip_path, "rb") as zf_in:
                    response = requests.post(
                        url,
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

            # 4. Extract returned ZIP into chapter Proof folder
            proof_dir = os.path.join(upload_dir, project.client_name or "unknown", project.code, chapter.chapters, "Proof")
            os.makedirs(proof_dir, exist_ok=True)

            logger.info("Extracting indesign-to-proof output files into Proof directory...")
            saved_files = []
            extracted_paths = set()

            with zipfile.ZipFile(io.BytesIO(response.content)) as z_out:
                for zname in z_out.namelist():
                    if zname.endswith("/") or zname.endswith("\\"):
                        continue
                    basename = os.path.basename(zname)
                    ext = os.path.splitext(basename)[1].lower()

                    # Save proof assets (.xhtml, .css, .jpg, .png, .pdf, etc.)
                    if ext in (".xhtml", ".css", ".jpg", ".jpeg", ".png", ".svg", ".pdf"):
                        out_path = os.path.join(proof_dir, basename)
                        if out_path in extracted_paths:
                            continue
                        extracted_paths.add(out_path)

                        with open(out_path, "wb") as out_f:
                            out_f.write(z_out.read(zname))
                        logger.info(f"Saved proof asset: {out_path}")
                        saved_files.append(out_path)

            # 5. Register files in Database
            registered_filenames = []
            for spath in saved_files:
                pname = os.path.basename(spath)
                pext = os.path.splitext(pname)[1].lower()
                category = "Proof"

                db_rel_path = os.path.relpath(spath, upload_dir).replace("\\", "/")
                mime, _ = mimetypes.guess_type(spath)
                if not mime:
                    if pext == ".pdf":
                        mime = "application/pdf"
                    elif pext == ".css":
                        mime = "text/css"
                    elif pext == ".xhtml":
                        mime = "application/xhtml+xml"
                    else:
                        mime = "application/octet-stream"

                existing_file = db.query(models.File).filter(
                    models.File.project_id == file_record.project_id,
                    models.File.chapter_id == file_record.chapter_id,
                    func.lower(models.File.category) == category.lower(),
                    models.File.filename == pname
                ).first()

                if existing_file:
                    try:
                        full_existing_disk_path = os.path.join(upload_dir, existing_file.path.replace("/", os.sep)) if existing_file.path else None
                        archive_existing_file(
                            db,
                            existing_file=existing_file,
                            base_path=os.path.dirname(spath),
                            uploaded_by_id=user_id,
                            source_path=full_existing_disk_path if full_existing_disk_path and os.path.exists(full_existing_disk_path) else (spath if os.path.exists(spath) else None),
                        )
                        existing_file.path = db_rel_path
                        existing_file.version = (existing_file.version or 1) + 1
                        existing_file.uploaded_by_id = user_id
                        existing_file.uploaded_at = now_ist_naive()
                        existing_file.file_type = mime
                        logger.info(f"Updated proof file record: {pname} to version {existing_file.version}")
                    except Exception as backup_err:
                        logger.error(f"Backup/version bump failed for {pname}: {backup_err}")
                else:
                    new_record = models.File(
                        project_id=file_record.project_id,
                        chapter_id=file_record.chapter_id,
                        filename=pname,
                        file_type=mime,
                        category=category,
                        path=db_rel_path,
                        version=1,
                        uploaded_by_id=user_id,
                        uploaded_at=now_ist_naive(),
                        is_original=False
                    )
                    db.add(new_record)
                    logger.info(f"Registered new proof file record: {pname}")

                registered_filenames.append(pname)

            db.commit()
            return registered_filenames

        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception as e:
                    logger.warning(f"Failed to remove temp zip {temp_zip_path}: {e}")
