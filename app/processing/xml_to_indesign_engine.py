import os
import zipfile
import requests
import redis
import shutil
import tempfile
import logging
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
        logger
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
            
        # 3. Create target directories and copy the template as a matching .idml file
        # target folder: uploads/{project_code}/{chapter_number}/InDesign
        indesign_dir = os.path.join(upload_dir, project.code, chapter.number, "InDesign")
        os.makedirs(indesign_dir, exist_ok=True)
        
        xml_base = os.path.splitext(os.path.basename(file_path))[0]
        idml_filename = f"{xml_base}.idml"
        idml_path = os.path.join(indesign_dir, idml_filename)
        
        # Copy template file to target .idml path
        shutil.copy2(template_path, idml_path)
        logger.info(f"Copied template to {idml_path}")
        
        # Register the .idml file in DB
        db_idml_file = db.query(models.File).filter(
            models.File.chapter_id == chapter.id,
            models.File.category == "InDesign",
            models.File.filename == idml_filename
        ).first()
        
        if not db_idml_file:
            db_idml_file = models.File(
                project_id=project.id,
                chapter_id=chapter.id,
                filename=idml_filename,
                file_type="application/octet-stream",
                category="InDesign",
                path=idml_path,
                version=1,
                is_original=False
            )
            db.add(db_idml_file)
        else:
            db_idml_file.version = (db_idml_file.version or 1) + 1
            db_idml_file.path = idml_path
            db_idml_file.uploaded_at = datetime.utcnow()
            db_idml_file.uploaded_by_id = user_id
        db.commit()
        
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
                art_folder = os.path.join(chapter_dir, "Art")
                if os.path.exists(art_folder):
                    for root, _, files in os.walk(art_folder):
                        for file in files:
                            full_file_path = os.path.join(root, file)
                            rel_path = os.path.relpath(full_file_path, art_folder)
                            zf.write(full_file_path, os.path.join("artfile", rel_path))
                            
            # 5. Call InDesign Server using Redis Lock
            if not settings.INDESIGN_SERVER_URL:
                raise ValueError("Windows InDesign Conversion Server is not configured. Please set INDESIGN_SERVER_URL.")
                
            url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-xml-to-indesign"
            redis_client = redis.from_url(settings.REDIS_URL)
            lock = redis_client.lock("indesign_conversion_lock", timeout=1200, blocking_timeout=1200)
            
            logger.info("Attempting to acquire InDesign conversion lock (Redis)...")
            with lock:
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
                    
            # 6. Save response content (INDD file directly)
            indd_filename = f"{xml_base}.indd"
            indd_path = os.path.join(indesign_dir, indd_filename)
            
            with open(indd_path, "wb") as out_f:
                out_f.write(response.content)
            logger.info(f"Generated InDesign INDD file: {indd_path}")
            
            return [indd_path]
            
        finally:
            if os.path.exists(temp_zip_path):
                try:
                    os.remove(temp_zip_path)
                except Exception as e:
                    logger.warning(f"Failed to remove temp zip {temp_zip_path}: {e}")
