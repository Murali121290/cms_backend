import os
import time
import zipfile
import tempfile
import requests
import redis
import logging
import shutil
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


class ViewProofEngine:
    """
    Process 2: View Proof (Xhtml2Indd)
    Takes an InDesign layout document (.indd), art files, active proof XHTML (.xhtml), and source XML (.xml).
    Invokes C:\\Users\\muraliba\\Documents\\applylayouts.jsx on the Windows InDesign Server.
    Re-applies proof corrections, paragraph and character overrides, updates the InDesign layout (.indd),
    and exports a high-quality Proof PDF (.pdf).
    Saves the updated .indd into InDesign/ folder and .pdf into Proof/ folder with version bumps in the DB.
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

        # Resolve file_path to verified physical path if needed
        if not os.path.isabs(file_path) or not os.path.exists(file_path):
            from app.domains.processing.service import resolve_physical_file_path
            from app.services.file_service import UPLOAD_DIR
            target_upload_dir = upload_dir or UPLOAD_DIR
            file_path = resolve_physical_file_path(file_path, str(target_upload_dir))
            if not os.path.exists(file_path) and file_record and file_record.path:
                file_path = resolve_physical_file_path(file_record.path, str(target_upload_dir))

        chapter_dir = os.path.join(upload_dir, project.client_name or "unknown", project.code, chapter.chapters)
        project_dir = os.path.join(upload_dir, project.client_name or "unknown", project.code)

        # 2. Resolve Active Proof XHTML (.xhtml) file
        xhtml_file_path = file_path
        if not xhtml_file_path.lower().endswith(".xhtml"):
            file_stem = os.path.splitext(os.path.basename(file_path))[0]
            candidate_xhtml = None

            for sub in ["Proof", "Manuscript", "XML", ""]:
                cand = os.path.join(chapter_dir, sub, f"{file_stem}.xhtml") if sub else os.path.join(chapter_dir, f"{file_stem}.xhtml")
                if os.path.exists(cand):
                    candidate_xhtml = cand
                    break

            if not candidate_xhtml:
                for root, _, files in os.walk(chapter_dir):
                    for f in files:
                        if f.lower().endswith(".xhtml"):
                            candidate_xhtml = os.path.join(root, f)
                            if file_stem.lower() in f.lower():
                                break
                    if candidate_xhtml:
                        break

            if candidate_xhtml:
                xhtml_file_path = candidate_xhtml
            else:
                raise ValueError(f"No active XHTML manuscript (.xhtml) found for chapter {chapter.chapters}. View Proof requires an .xhtml file.")

        logger.info(f"Using proof XHTML file: {xhtml_file_path}")

        # 3. Locate the chapter's InDesign Document (.indd)
        indd_path = None
        indesign_folder = os.path.join(chapter_dir, "InDesign")
        file_stem = os.path.splitext(os.path.basename(xhtml_file_path))[0]

        if os.path.exists(indesign_folder):
            for f in os.listdir(indesign_folder):
                if f.lower().endswith(".indd"):
                    cand = os.path.join(indesign_folder, f)
                    if file_stem.lower() in f.lower():
                        indd_path = cand
                        break
                    if not indd_path:
                        indd_path = cand

        if not indd_path:
            # Fallback search across chapter directory
            for root, dirs, files in os.walk(chapter_dir):
                dirs[:] = [d for d in dirs if d.lower() != "archive"]
                for f in files:
                    if f.lower().endswith(".indd"):
                        indd_path = os.path.join(root, f)
                        break
                if indd_path:
                    break

        if not indd_path:
            # Fallback to Design/template if no INDD exists in chapter
            for root, dirs, files in os.walk(project_dir):
                dirs[:] = [d for d in dirs if d.lower() != "archive"]
                for f in files:
                    if f.lower().endswith(".indd") or f.lower().endswith(".indt"):
                        indd_path = os.path.join(root, f)
                        break
                if indd_path:
                    break

        if not indd_path:
            raise ValueError(f"Could not find any InDesign layout (.indd) file for chapter {chapter.chapters}. View Proof requires an InDesign document.")

        logger.info(f"Using InDesign document: {indd_path}")

        # 4. Locate matching XML file (.xml) strictly from the chapter's XML folder
        xml_path = None
        xml_folder = os.path.join(chapter_dir, "XML")

        # Check database first for XML record in this chapter under category XML
        db_xml = db.query(models.File).filter(
            models.File.project_id == file_record.project_id,
            models.File.chapter_id == file_record.chapter_id,
            func.lower(models.File.category) == "xml",
            models.File.filename.ilike(f"{file_stem}.xml")
        ).first()

        if db_xml and db_xml.path:
            cand = resolve_physical_file_path(db_xml.path, str(target_upload_dir))
            if os.path.exists(cand):
                xml_path = cand

        # Fallback to physical XML folder on disk
        if not xml_path and os.path.exists(xml_folder):
            cand = os.path.join(xml_folder, f"{file_stem}.xml")
            if os.path.exists(cand):
                xml_path = cand
            else:
                for f in os.listdir(xml_folder):
                    f_lower = f.lower()
                    if f_lower.endswith(".xml") and not f_lower.endswith("_indd.xml") and not f_lower.startswith("."):
                        cand = os.path.join(xml_folder, f)
                        if os.path.isfile(cand):
                            xml_path = cand
                            break

        if xml_path:
            logger.info(f"Using source XML file from XML folder: {xml_path}")
        else:
            logger.warning(f"No source XML file found in XML folder for chapter {chapter.chapters}.")

        # 5. Package assets into temporary ZIP archive
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)

        try:
            logger.info(f"Packaging assets for View Proof into: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Use a common stem based on the INDD document so applylayouts.jsx finds all files
                indd_stem = os.path.splitext(os.path.basename(indd_path))[0]
                zf.write(indd_path, f"{indd_stem}.indd")
                zf.write(xhtml_file_path, f"{indd_stem}.xhtml")

                if xml_path and os.path.exists(xml_path):
                    zf.write(xml_path, f"{indd_stem}.xml")

                # Collect Art / Links files into artfile/
                seen_art_files = set()
                for root, dirs, _ in os.walk(chapter_dir):
                    dirs[:] = [d for d in dirs if d.lower() != "archive"]
                    for dname in dirs:
                        if dname.lower() in ("artfile", "links", "art"):
                            art_folder = os.path.join(root, dname)
                            target_sub = "artfile"
                            for r, _, sub_files in os.walk(art_folder):
                                for f in sub_files:
                                    f_full = os.path.join(r, f)
                                    if f_full in seen_art_files:
                                        continue
                                    seen_art_files.add(f_full)
                                    rel_within = os.path.relpath(f_full, art_folder)
                                    zf.write(f_full, f"{target_sub}/{rel_within}".replace("\\", "/"))

                # Also include project-level common art if present
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

            # 6. Call Windows InDesign Server using Redis Lock
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

            # 7. Extract returned ZIP containing strictly updated .indd and generated .pdf
            indesign_dir = os.path.join(chapter_dir, "InDesign")
            proof_dir = os.path.join(chapter_dir, "Proof")

            os.makedirs(indesign_dir, exist_ok=True)
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

                    if ext == ".indd":
                        out_path = os.path.join(indesign_dir, basename)
                    elif ext == ".pdf":
                        out_path = os.path.join(proof_dir, basename)
                    else:
                        # Strictly only accept .indd and .pdf outputs in View Proof
                        continue

                    if out_path in extracted_paths:
                        continue
                    extracted_paths.add(out_path)

                    with open(out_path, "wb") as out_f:
                        out_f.write(z_out.read(zname))
                    logger.info(f"Saved View Proof output file: {out_path}")
                    saved_files.append(out_path)

            # 8. Register/overwrite files in Database
            registered_filenames = []
            for spath in saved_files:
                pname = os.path.basename(spath)
                pext = os.path.splitext(pname)[1].lower()

                if pext == ".indd":
                    category = "InDesign"
                elif pext == ".pdf":
                    category = "Proof"
                else:
                    continue

                db_rel_path = os.path.relpath(spath, upload_dir).replace("\\", "/")
                mime, _ = mimetypes.guess_type(spath)
                if not mime:
                    mime = "application/pdf" if pext == ".pdf" else "application/x-indesign" if pext == ".indd" else "application/octet-stream"

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
