import os
import time
import uuid
import zipfile
import tempfile
import requests
import redis
import logging
import shutil
import mimetypes
import io
from app.core.config import get_settings
from app import models
from app.domains.projects.models import Project
from app.domains.files.version_service import archive_existing_file
from app.utils.timezone import now_ist_naive

logger = logging.getLogger(__name__)

class ViewProofEngine:
    def process_document(self, db, file_path: str, file_record, user_id: int, upload_dir: str, logger, job_id: int = None) -> list[str]:
        settings = get_settings()
        
        # 1. Fetch project and chapter details
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        if not project:
            raise ValueError(f"Project with ID {file_record.project_id} not found.")
            
        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not chapter:
            raise ValueError(f"Chapter with ID {file_record.chapter_id} not found.")

        # 2. Find the project InDesign template (.indt) file recursively
        logger.info("Locating project InDesign template (.indt) file...")
        indt_path = None
        project_dir = os.path.join(upload_dir, project.code)
        
        for root, _, files in os.walk(project_dir):
            for f in files:
                if f.lower().endswith(".indt"):
                    indt_path = os.path.join(root, f)
                    break
            if indt_path:
                break
                
        if not indt_path:
            logger.warning("No template (.indt) file found recursively in project. Attempting to search for .indd in design directories...")
            # Fallback: search for any .indd in Design folders
            for root, _, files in os.walk(project_dir):
                if "design" in root.lower() or "template" in root.lower():
                    for f in files:
                        if f.lower().endswith(".indd"):
                            indt_path = os.path.join(root, f)
                            break
                if indt_path:
                    break
                    
        if not indt_path:
            raise ValueError("Could not find any InDesign template (.indt) or layout (.indd) file in the project's folders to use as a typesetting template.")

        logger.info(f"Using template file: {indt_path}")

        # 3. Package the XHTML, template, and adjacent artfile/Links into a temporary ZIP
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging view-proof assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Add edited XHTML file
                zf.write(file_path, os.path.basename(file_path))

                # Add template (.indt/.indd) under relative project path (e.g. Design/template/indesign/Degeneffe.indt)
                project_dir = os.path.join(upload_dir, project.code)
                if indt_path.startswith(project_dir):
                    template_rel = os.path.relpath(indt_path, project_dir)
                else:
                    template_rel = os.path.join("Design", "template", "indesign", os.path.basename(indt_path))
                zf.write(indt_path, template_rel)

                # Add Design folders (Font, Common Art, Library) matching XML to InDesign process
                design_folders = [
                    "Design/template/Common Art",
                    "Design/template/Font",
                    "Design/template/Library",
                    "Design/template/indesign",
                    "Design/template"
                ]
                seen_design_files = {indt_path}
                for folder in design_folders:
                    folder_path = os.path.join(project_dir, folder)
                    if os.path.exists(folder_path):
                        for root, _, files in os.walk(folder_path):
                            for file in files:
                                full_file_path = os.path.join(root, file)
                                if full_file_path in seen_design_files:
                                    continue
                                seen_design_files.add(full_file_path)
                                rel_path = os.path.relpath(full_file_path, project_dir)
                                zf.write(full_file_path, rel_path)
                
                # Include adjacent artfile or Links folder if present next to the original chapter files
                chapter_dir = os.path.join(upload_dir, project.code, chapter.chapters)
                seen_art_files = set()
                for root, dirs, files in os.walk(chapter_dir):
                    for dname in dirs:
                        if dname.lower() in ["artfile", "links"]:
                            sub_path = os.path.join(root, dname)
                            target_subfolder = "artfile" if dname.lower() == "artfile" else "Links"
                            logger.info(f"Packaging adjacent art folder {dname} from: {sub_path} into root {target_subfolder}/")
                            for r, _, sub_files in os.walk(sub_path):
                                for f in sub_files:
                                    f_full = os.path.join(r, f)
                                    if f_full in seen_art_files:
                                        continue
                                    seen_art_files.add(f_full)
                                    rel_within_art = os.path.relpath(f_full, sub_path)
                                    zip_entry_path = os.path.join(target_subfolder, rel_within_art).replace("\\", "/")
                                    zf.write(f_full, zip_entry_path)

            # 4. Call Windows InDesign Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")

            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/view-proof"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200)

            job = db.query(models.ProcessingJob).filter(models.ProcessingJob.id == job_id).first() if job_id else None

            logger.info(f"Job {job_id} entering prioritization lock loop for View Proof...")
            while True:
                if job:
                    db.refresh(job)
                    if job.status == "cancelled":
                        logger.info(f"Job {job_id} was cancelled by user. Exiting.")
                        return []

                # Prioritize jobs
                higher_job = db.query(models.ProcessingJob).filter(
                    models.ProcessingJob.status.in_(["pending", "processing"]),
                    models.ProcessingJob.id != (job.id if job else 0),
                    models.ProcessingJob.process_type.in_(["xml_to_indesign", "indesign_to_xml", "view_proof"])
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
                logger.info(f"Lock acquired. Sending remote /view-proof request to: {url}")
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

            # 5. Extract returned ZIP containing proofs & final files
            indesign_dir = os.path.join(upload_dir, project.code, chapter.chapters, "InDesign")
            misc_dir = os.path.join(upload_dir, project.code, chapter.chapters, "Misc")
            proof_dir = os.path.join(upload_dir, project.code, chapter.chapters, "Proof")
            os.makedirs(indesign_dir, exist_ok=True)
            os.makedirs(misc_dir, exist_ok=True)
            os.makedirs(proof_dir, exist_ok=True)

            logger.info("Extracting view-proof output zip files...")
            saved_files = []
            extracted_paths = set()
            
            with zipfile.ZipFile(io.BytesIO(response.content)) as z_out:
                for zname in z_out.namelist():
                    if zname.endswith("/") or zname.endswith("\\"):
                        continue
                    basename = os.path.basename(zname)
                    ext = os.path.splitext(basename)[1].lower()

                    # Ignore template (.indt) and source editor (.xhtml) files during View Proof stage
                    if ext in (".xml", ".epub", ".log", ".jpg", ".jpeg", ".docx", ".pdf", ".css", ".indd"):
                        # Determine category folder
                        if ext == ".indd":
                            out_path = os.path.join(indesign_dir, basename)
                        elif ext in (".pdf", ".css"):
                            out_path = os.path.join(proof_dir, basename)
                        else:
                            out_path = os.path.join(misc_dir, basename)

                        if out_path in extracted_paths:
                            continue
                        extracted_paths.add(out_path)

                        with open(out_path, "wb") as out_f:
                            out_f.write(z_out.read(zname))
                        logger.info(f"Saved typeset file: {out_path}")
                        saved_files.append(out_path)

            # 6. Register/overwrite files in Database
            from sqlalchemy import func
            registered_filenames = []
            for spath in saved_files:
                pname = os.path.basename(spath)
                pext = os.path.splitext(pname)[1].lower()
                
                # Determine DB category and path format
                if pext == ".indd":
                    category = "InDesign"
                elif pext in (".pdf", ".css"):
                    category = "Proof"
                else:
                    category = "Misc"

                db_rel_path = os.path.relpath(spath, upload_dir).replace("\\", "/")
                mime, _ = mimetypes.guess_type(spath)
                if not mime:
                    mime = "text/css" if pext == ".css" else "application/xhtml+xml" if pext == ".xhtml" else "application/octet-stream"

                # Check if file record already exists (case-insensitive category match to handle legacy DB entries)
                existing_file = db.query(models.File).filter(
                    models.File.project_id == file_record.project_id,
                    models.File.chapter_id == file_record.chapter_id,
                    func.lower(models.File.category) == category.lower(),
                    models.File.filename == pname
                ).first()

                if existing_file:
                    try:
                        # Full absolute path of existing file on disk before overwriting
                        full_existing_disk_path = os.path.join(upload_dir, existing_file.path.replace("/", os.sep)) if existing_file.path else None

                        # Backup first
                        archive_existing_file(
                            db,
                            existing_file=existing_file,
                            base_path=os.path.dirname(spath),
                            uploaded_by_id=user_id,
                            source_path=full_existing_disk_path if full_existing_disk_path and os.path.exists(full_existing_disk_path) else (spath if os.path.exists(spath) else None),
                        )
                        # Update details and increment version
                        existing_file.path = db_rel_path
                        existing_file.version = (existing_file.version or 1) + 1
                        existing_file.uploaded_by_id = user_id
                        existing_file.uploaded_at = now_ist_naive()
                        existing_file.file_type = mime
                        logger.info(f"Updated view proof file record: {pname} to version {existing_file.version}")
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
                    logger.info(f"Registered new view proof file record: {pname}")
                    
                registered_filenames.append(pname)

            db.commit()
            return registered_filenames

        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception as e:
                    logger.warning(f"Failed to remove temp zip {temp_zip_path}: {e}")
