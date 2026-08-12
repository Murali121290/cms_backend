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

class XMLToInDesignEngine:
    def process_document(
        self,
        db: Session,
        file_path: str,
        file_record: models.File,
        template_file_id: int,
        user_id: int,
        upload_dir: str,
        logger,
        job_id: int | None = None,
    ) -> list[str]:
        """
        Zips up the XML, the template (.indt), related art files (Links),
        and design assets (Fonts, Libraries, Common Art) and sends it to the remote InDesign Server.
        Saves the returned .indd file and registers it in database.
        Also creates the .idml file in the indesign folder by copying the template.
        """
        settings = get_settings()
        
        # 1. Fetch template file record
        template_file = db.query(models.File).filter(models.File.id == template_file_id).first()
        if not template_file:
            raise FileNotFoundError(f"Template file with ID {template_file_id} not found.")
            
        template_path = os.path.abspath(template_file.path)
        if not os.path.exists(template_path):
            raise FileNotFoundError(f"Physical template file missing: {template_path}")
            
        # 2. Identify project and chapter
        project = db.query(Project).filter(Project.id == file_record.project_id).first()
        chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == file_record.chapter_id).first()
        if not project or not chapter:
            raise ValueError("Associated project or chapter details are missing.")
            
        # 3. Create target directory
        indesign_dir = os.path.join(upload_dir, project.code, chapter.number, "InDesign")
        os.makedirs(indesign_dir, exist_ok=True)
        
        xml_base = os.path.splitext(os.path.basename(file_path))[0]
        
        # 4. Generate temp ZIP file
        temp_zip_fd, temp_zip_path = tempfile.mkstemp(suffix=".zip")
        os.close(temp_zip_fd)
        
        project_dir = os.path.abspath(os.path.join(upload_dir, project.code))
        chapter_dir = os.path.abspath(os.path.join(project_dir, chapter.number))
        
        try:
            logger.info(f"Packaging assets into ZIP: {temp_zip_path}")
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # Add XML file at root of the zip
                xml_filename = os.path.basename(file_path)
                zf.write(file_path, xml_filename)
                
                # Add Template (.indt) file at its relative path: Design/template/indesign/name
                template_rel = os.path.relpath(template_path, project_dir)
                zf.write(template_path, template_rel)
                
                # Add Design folders
                design_folders = [
                    "Design/template/Common Art",
                    "Design/template/Font",
                    "Design/template/Library"
                ]
                for folder in design_folders:
                    folder_path = os.path.join(project_dir, folder)
                    if os.path.exists(folder_path):
                        for root, _, files in os.walk(folder_path):
                            for file in files:
                                full_file_path = os.path.join(root, file)
                                rel_path = os.path.relpath(full_file_path, project_dir)
                                zf.write(full_file_path, rel_path)
                                
                # Add Chapter Art files (Links) packaged under 'artfile/'
                art_folder = None
                
                # Candidate 1: chapter_dir/Art
                c1 = os.path.join(chapter_dir, "Art")
                if os.path.exists(c1) and os.path.isdir(c1) and len(os.listdir(c1)) > 0:
                    art_folder = c1
                
                # Candidate 2: lowercase art folder
                if not art_folder:
                    c2 = os.path.join(chapter_dir, "art")
                    if os.path.exists(c2) and os.path.isdir(c2) and len(os.listdir(c2)) > 0:
                        art_folder = c2
                        
                # Candidate 3: Search project level for chapter art folders like "Ch 01 - Art/Art"
                if not art_folder:
                    ch_num = chapter.number.strip()
                    ch_num_clean = ch_num.lstrip('0') if ch_num.lstrip('0') else '0'
                    ch_num_padded = ch_num.zfill(2)
                    
                    possible_names = [
                        f"Ch {ch_num} - Art",
                        f"Ch {ch_num_clean} - Art",
                        f"Ch {ch_num_padded} - Art",
                        f"Ch_{ch_num}_Art",
                        f"Ch_{ch_num_clean}_Art",
                        f"Ch_{ch_num_padded}_Art",
                        f"Chapter {ch_num} - Art",
                        f"Chapter {ch_num_clean} - Art",
                        f"Chapter {ch_num_padded} - Art",
                        f"Ch {ch_num}",
                        f"Ch {ch_num_clean}",
                        f"Ch {ch_num_padded}",
                        f"Chapter {ch_num}",
                        f"Chapter {ch_num_clean}",
                        f"Chapter {ch_num_padded}",
                    ]
                    
                    if os.path.exists(project_dir):
                        for entry in os.listdir(project_dir):
                            entry_path = os.path.join(project_dir, entry)
                            if os.path.isdir(entry_path):
                                entry_lower = entry.lower()
                                matched = False
                                for name in possible_names:
                                    if entry_lower == name.lower():
                                        matched = True
                                        break
                                if matched:
                                    for sub in ["Art", "art"]:
                                        sub_path = os.path.join(entry_path, sub)
                                        if os.path.exists(sub_path) and os.path.isdir(sub_path) and len(os.listdir(sub_path)) > 0:
                                            art_folder = sub_path
                                            break
                                    if art_folder:
                                        break

                # Fallback: if no folder with files is found, fallback to existing empty folder (for logging/structure)
                if not art_folder:
                    c1 = os.path.join(chapter_dir, "Art")
                    if os.path.exists(c1) and os.path.isdir(c1):
                        art_folder = c1
                    else:
                        c2 = os.path.join(chapter_dir, "art")
                        if os.path.exists(c2) and os.path.isdir(c2):
                            art_folder = c2

                if art_folder and os.path.exists(art_folder):
                    logger.info(f"Packaging art files from folder: {art_folder}")
                    for root, _, files in os.walk(art_folder):
                        for file in files:
                            full_file_path = os.path.join(root, file)
                            rel_path = os.path.relpath(full_file_path, art_folder)
                            zf.write(full_file_path, os.path.join("artfile", rel_path))
                else:
                    logger.warning(f"Could not locate art folder for chapter {chapter.number} (searched project dir {project_dir})")
                            
            # 5. Call InDesign Server using Redis Lock (prioritized locker loop)
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")
                
            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-xml-to-indesign"
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
                logger.info(f"Lock acquired. Sending remote InDesign XML conversion request to: {url}")
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
                    
            # 6. Save response content (expecting a ZIP file containing INDD and PDF)
            import io

            try:
                # Attempt to extract files from the response ZIP
                with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                    file_list = z.namelist()
                    logger.info(f"Received files from Windows InDesign Conversion Server: {file_list}")
                    
                    output_files = []
                    
                    # 6a. Find and process InDesign INDD file
                    indd_in_zip = next((f for f in file_list if f.lower().endswith(".indd")), None)
                    if indd_in_zip:
                        # Clean name: remove suffix '_indd' if present or use original base
                        clean_indd_name = f"{xml_base}.indd"
                        indd_path = os.path.join(indesign_dir, clean_indd_name)
                        with open(indd_path, "wb") as out_f:
                            out_f.write(z.read(indd_in_zip))
                        logger.info(f"Saved generated InDesign file: {indd_path}")
                        
                        # Copy art files into indesign_dir/artfile and indesign_dir/Links to preserve graphic links
                        if art_folder and os.path.exists(art_folder):
                            for sub_folder_name in ["artfile", "Links"]:
                                target_art_dir = os.path.join(indesign_dir, sub_folder_name)
                                os.makedirs(target_art_dir, exist_ok=True)
                                logger.info(f"Copying art files from {art_folder} to {target_art_dir}...")
                                for root_art, _, art_files in os.walk(art_folder):
                                    for art_file in art_files:
                                        src_art_path = os.path.join(root_art, art_file)
                                        rel_art_path = os.path.relpath(src_art_path, art_folder)
                                        dst_art_path = os.path.join(target_art_dir, rel_art_path)
                                        os.makedirs(os.path.dirname(dst_art_path), exist_ok=True)
                                        shutil.copy2(src_art_path, dst_art_path)
                        
                        # Register the INDD file in the database
                        db_indd_file = db.query(models.File).filter(
                            models.File.chapter_id == chapter.id,
                            models.File.category == "InDesign",
                            models.File.filename == clean_indd_name
                        ).first()
                        
                        if not db_indd_file:
                            db_indd_file = models.File(
                                project_id=project.id,
                                chapter_id=chapter.id,
                                filename=clean_indd_name,
                                file_type="application/octet-stream",
                                category="InDesign",
                                path=indd_path,
                                version=1,
                                is_original=False
                            )
                            db.add(db_indd_file)
                        else:
                            db_indd_file.version = (db_indd_file.version or 1) + 1
                            db_indd_file.path = indd_path
                            db_indd_file.uploaded_at = datetime.utcnow()
                            if user_id:
                                db_indd_file.uploaded_by_id = user_id
                        db.commit()
                        logger.info(f"Registered INDD file in database: {clean_indd_name}")
                        output_files.append(indd_path)
                    else:
                        raise RuntimeError("No INDD file (.indd) found in InDesign Server response ZIP")
                    
                    # 6b. Find and process Proof PDF file
                    pdf_in_zip = next((f for f in file_list if f.lower().endswith(".pdf")), None)
                    if pdf_in_zip:
                        # target folder: uploads/{project_code}/{chapter_number}/Proof
                        proof_dir = os.path.join(upload_dir, project.code, chapter.number, "Proof")
                        os.makedirs(proof_dir, exist_ok=True)
                        
                        clean_pdf_name = f"{xml_base}.pdf"
                        pdf_path = os.path.join(proof_dir, clean_pdf_name)
                        with open(pdf_path, "wb") as out_f:
                            out_f.write(z.read(pdf_in_zip))
                        logger.info(f"Saved generated Proof PDF file: {pdf_path}")
                        
                        # Register the Proof PDF file in the database
                        db_pdf_file = db.query(models.File).filter(
                            models.File.chapter_id == chapter.id,
                            models.File.category == "Proof",
                            models.File.filename == clean_pdf_name
                        ).first()
                        
                        if not db_pdf_file:
                            db_pdf_file = models.File(
                                project_id=project.id,
                                chapter_id=chapter.id,
                                filename=clean_pdf_name,
                                file_type="application/pdf",
                                category="Proof",
                                path=pdf_path,
                                version=1,
                                is_original=False
                            )
                            db.add(db_pdf_file)
                        else:
                            db_pdf_file.version = (db_pdf_file.version or 1) + 1
                            db_pdf_file.path = pdf_path
                            db_pdf_file.uploaded_at = datetime.utcnow()
                            if user_id:
                                db_pdf_file.uploaded_by_id = user_id
                        db.commit()
                        logger.info(f"Registered Proof PDF file in database: {clean_pdf_name}")
                        # We don't append to output_files anymore to prevent calling service from duplicate registration
                        pass
                    else:
                        logger.warning("No PDF file (.pdf) found in InDesign Server response ZIP")
                        
                return []

            except zipfile.BadZipFile:
                # Fallback: if it's not a ZIP file, it could be the raw INDD file as before
                logger.warning("InDesign Server returned raw content instead of a ZIP file. Attempting raw INDD fallback...")
                indd_filename = f"{xml_base}.indd"
                indd_path = os.path.join(indesign_dir, indd_filename)
                with open(indd_path, "wb") as out_f:
                    out_f.write(response.content)
                logger.info(f"Generated InDesign INDD file (fallback): {indd_path}")
                
                # Copy art files into indesign_dir/artfile and indesign_dir/Links to preserve graphic links
                if art_folder and os.path.exists(art_folder):
                    for sub_folder_name in ["artfile", "Links"]:
                        target_art_dir = os.path.join(indesign_dir, sub_folder_name)
                        os.makedirs(target_art_dir, exist_ok=True)
                        logger.info(f"Copying art files from {art_folder} to {target_art_dir}...")
                        for root_art, _, art_files in os.walk(art_folder):
                            for art_file in art_files:
                                src_art_path = os.path.join(root_art, art_file)
                                rel_art_path = os.path.relpath(src_art_path, art_folder)
                                dst_art_path = os.path.join(target_art_dir, rel_art_path)
                                os.makedirs(os.path.dirname(dst_art_path), exist_ok=True)
                                shutil.copy2(src_art_path, dst_art_path)
                
                # Register the fallback INDD file in the database
                db_indd_file = db.query(models.File).filter(
                    models.File.chapter_id == chapter.id,
                    models.File.category == "InDesign",
                    models.File.filename == indd_filename
                ).first()
                
                if not db_indd_file:
                    db_indd_file = models.File(
                        project_id=project.id,
                        chapter_id=chapter.id,
                        filename=indd_filename,
                        file_type="application/octet-stream",
                        category="InDesign",
                        path=indd_path,
                        version=1,
                        is_original=False
                    )
                    db.add(db_indd_file)
                else:
                    db_indd_file.version = (db_indd_file.version or 1) + 1
                    db_indd_file.path = indd_path
                    db_indd_file.uploaded_at = datetime.utcnow()
                    if user_id:
                        db_indd_file.uploaded_by_id = user_id
                db.commit()
                logger.info(f"Registered fallback INDD file in database: {indd_filename}")
                return []
            
        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception as e:
                    logger.warning(f"Failed to remove temp zip {temp_zip_path}: {e}")
