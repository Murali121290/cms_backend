import os
import zipfile
import requests
import redis
import shutil
import tempfile
import logging
import time
from sqlalchemy.orm import Session
from datetime import datetime

from app import models
from app.core.config import get_settings
from app.domains.projects.models import Project

logger = logging.getLogger("app.processing")

class InDesignToXMLEngine:
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
        """
        Zips up the INDD document and any adjacent Links/artfile folders and sends it to the remote InDesign Server.
        Saves the returned XML file in the chapter's Misc directory.
        """
        settings = get_settings()
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        if not project:
            raise ValueError(f"Project with ID {file_record.project_id} not found.")

        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not chapter:
            raise ValueError(f"Chapter with ID {file_record.chapter_id} not found.")

        # 1. Package the file and directories into a temporary ZIP
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Add INDD file at root of the zip
                indd_filename = os.path.basename(file_path)
                zf.write(file_path, indd_filename)
                
                # Check for adjacent artfile or Links folder next to the INDD file
                indd_dir = os.path.dirname(file_path)
                for subfolder in ["artfile", "Links"]:
                    sub_path = os.path.join(indd_dir, subfolder)
                    if os.path.exists(sub_path) and os.path.isdir(sub_path):
                        logger.info(f"Packaging adjacent folder {subfolder} from: {sub_path}")
                        for root, _, files in os.walk(sub_path):
                            for file in files:
                                full_file_path = os.path.join(root, file)
                                rel_path = os.path.relpath(full_file_path, indd_dir)
                                zf.write(full_file_path, rel_path)

            # 2. Call InDesign Server using Redis Lock (prioritized locker loop)
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-indesign-to-xml"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering prioritization lock loop...")
            while True:
                if job:
                    db.refresh(job)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                        return []

                # Check for higher priority jobs waiting
                higher_job = None
                if job:
                    higher_job = db.query(models.ProcessingJob).filter(
                        models.ProcessingJob.status.in_(["pending", "processing"]),
                        models.ProcessingJob.id != job.id,
                        models.ProcessingJob.process_type.in_([
                            "xml_to_indesign",
                            "indesign_to_xml",
                            "post_prod_conversion",
                            "ppd",
                            "reference_validation"
                        ])
                    ).filter(
                        (models.ProcessingJob.priority > job.priority) |
                        ((models.ProcessingJob.priority == job.priority) & (models.ProcessingJob.id < job.id))
                    ).first()

                if higher_job:
                    time.sleep(2)
                    continue

                # Try to acquire lock
                acquired = lock.acquire(blocking=False)
                if acquired:
                    break
                time.sleep(2)

            try:
                logger.info(f"Lock acquired. Sending remote InDesign XML extraction request to: {url}")
                client_name = project.client_name or ""
                with open(temp_zip_path, "rb") as zf_in:
                    response = requests.post(
                        url,
                        params={"client": client_name},
                        files={"file": (os.path.basename(temp_zip_path), zf_in.read(), "application/octet-stream")},
                        timeout=(30.0, 900)
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

            # 3. Save response content (expecting a ZIP file containing the generated XML file)
            import io
            misc_dir = os.path.join(upload_dir, project.code, chapter.chapters, "Misc")
            proof_dir = os.path.join(upload_dir, project.code, chapter.chapters, "Proof")
            os.makedirs(misc_dir, exist_ok=True)
            os.makedirs(proof_dir, exist_ok=True)

            try:
                with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                    file_list = z.namelist()
                    logger.info(f"Received files from Windows InDesign Conversion Server: {file_list}")
                    
                    saved_files = []
                    extracted_paths = set()
                    for zname in file_list:
                        if zname.endswith("/") or zname.endswith("\\"):
                            continue
                        basename = os.path.basename(zname)
                        ext = os.path.splitext(basename)[1].lower()
                        if ext in (".xml", ".epub", ".log", ".jpg", ".jpeg", ".docx", ".pdf", ".xhtml", ".css"):
                            if ext in (".pdf", ".xhtml", ".css"):
                                out_path = os.path.join(proof_dir, basename)
                            else:
                                out_path = os.path.join(misc_dir, basename)
                            
                            # Deduplicate by destination path
                            if out_path in extracted_paths:
                                logger.info(f"Skipping duplicate extraction of {zname} to {out_path}")
                                continue
                            
                            extracted_paths.add(out_path)
                            with open(out_path, "wb") as out_f:
                                out_f.write(z.read(zname))
                            logger.info(f"Saved generated InDesign output file: {out_path}")
                            saved_files.append(out_path)
                            
                    if not any(f.lower().endswith(".xml") for f in saved_files):
                        raise RuntimeError("No XML file (.xml) found in InDesign Server response ZIP")
                        
                    return saved_files
            except zipfile.BadZipFile:
                raise RuntimeError("Response from InDesign Server is not a valid ZIP file.")

        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception as e:
                    logger.warning(f"Failed to remove temp zip {temp_zip_path}: {e}")
