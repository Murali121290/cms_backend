import os
import zipfile
import shutil
import tempfile
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app import database, models
from app.domains.auth.security import get_current_user_from_cookie
from .models import PostProdProject, PostProdChapter
from app.services.conversion_service import BatchConversionService
import logging
import requests
from app.core.config import get_settings
from jose import jwt
import urllib.parse
from app.services.scripts.docx_post_processor import post_process_docx

router = APIRouter(prefix="/post-prod", tags=["Post Production"])
logger = logging.getLogger("app.post_prod")

def parse_chapter_number(filename: str) -> str:
    """
    Parses chapter number from filename (e.g. 'Ch_01.indd', 'chapter02.indd' -> '1', '2')
    """
    match = re.search(r'(?:ch|chap|chapter|c)[^\d]*(\d+)', filename, re.IGNORECASE)
    if match:
        return str(int(match.group(1)))
    match_digits = re.search(r'(\d+)', filename)
    if match_digits:
        return str(int(match_digits.group(1)))
    return "1"
def run_conversion_background(chapter_id: int, session_factory):
    db = session_factory()
    try:
        chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
        if not chapter:
            return
        
        chapter.status = "Converting"
        chapter.attempts += 1
        db.commit()

        settings = get_settings()
        project_dir = os.path.join(settings.UPLOAD_FOLDER, "post_prod", f"project_{chapter.project_id}")
        output_dir = os.path.join(project_dir, "converted")
        os.makedirs(output_dir, exist_ok=True)
        
        dest_filename = f"Chapter_{chapter.chapter_no}.docx"
        dest_path = os.path.join(output_dir, dest_filename)

        success = False
        error_msg = None

        if chapter.source_filename.lower().endswith(".indd"):
            settings = get_settings()
            if not settings.INDESIGN_SERVER_URL:
                error_msg = "InDesign server URL is not configured"
            else:
                # Package the entire chapter directory into a ZIP archive to preserve Links/ and Document Fonts/
                chapter_dir = os.path.dirname(chapter.source_file_path)
                zip_name = f"packaged_{os.path.splitext(chapter.source_filename)[0]}.zip"
                temp_zip_path = os.path.join(project_dir, zip_name)
                
                try:
                    logger.info(f"Packaging chapter directory {chapter_dir} into ZIP: {temp_zip_path}")
                    with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for root, _, filenames in os.walk(chapter_dir):
                            for f in filenames:
                                if f.startswith("._") or f.startswith("__MACOSX") or f == zip_name:
                                    continue
                                full_file_path = os.path.join(root, f)
                                rel_path = os.path.relpath(full_file_path, chapter_dir)
                                zf.write(full_file_path, rel_path)
                    
                    url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert"
                    try:
                        logger.info(f"Sending packaged ZIP to remote InDesign server: {url}")
                        with open(temp_zip_path, "rb") as zip_file:
                            response = requests.post(
                                url,
                                files={"file": (zip_name, zip_file.read(), "application/octet-stream")},
                                timeout=(30.0, 900)
                            )
                        if response.status_code == 200:
                            with open(dest_path, "wb") as out_f:
                                out_f.write(response.content)
                            success = True
                        else:
                            raise Exception(f"InDesign server returned {response.status_code}: {response.text}")
                    except Exception as indd_err:
                        try:
                            url_fallback = settings.INDESIGN_SERVER_URL
                            logger.info(f"Trying fallback remote InDesign conversion to root URL: {url_fallback}")
                            with open(temp_zip_path, "rb") as zip_file:
                                response_fb = requests.post(
                                    url_fallback,
                                    files={"file": (zip_name, zip_file.read(), "application/octet-stream")},
                                    timeout=(30.0, 900)
                                )
                            if response_fb.status_code == 200:
                                with open(dest_path, "wb") as out_f:
                                    out_f.write(response_fb.content)
                                success = True
                            else:
                                raise Exception(f"InDesign server returned {response_fb.status_code}: {response_fb.text}")
                        except Exception as fb_err:
                            error_msg = f"InDesign conversion failed: {str(indd_err)} -> Fallback: {str(fb_err)}"
                except Exception as zip_err:
                    error_msg = f"Failed to package InDesign chapter assets: {str(zip_err)}"
                finally:
                    # Clean up the temporary package zip
                    if os.path.exists(temp_zip_path):
                        try:
                            os.remove(temp_zip_path)
                        except Exception as rm_err:
                            logger.warning(f"Could not remove temp zip file {temp_zip_path}: {rm_err}")
        
        elif chapter.source_filename.lower().endswith(".pdf"):
            try:
                from pdf2docx import Converter
                cv = Converter(chapter.source_file_path)
                cv.convert(dest_path, start=0, end=None)
                cv.close()
                success = True
            except Exception as pdf_err:
                error_msg = f"PDF converter failed: {str(pdf_err)}"

        if success:
            try:
                logger.info(f"Applying post-processing layout reconstruction to formatted DOCX file: {dest_path}")
                post_process_docx(dest_path)
            except Exception as post_err:
                logger.warning(f"DOCX post-processor failed for {dest_path}: {post_err}")
                
            chapter.status = "Completed"
            chapter.converted_file_path = dest_path
            chapter.completed_at = datetime.utcnow()
        else:
            chapter.status = "Failed"
            chapter.error_message = error_msg or "Unknown error"
        
        db.commit()

    except Exception as e:
        logger.exception("Error in background conversion task")
        try:
            chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
            if chapter:
                chapter.status = "Failed"
                chapter.error_message = str(e)
                db.commit()
        except:
            pass
    finally:
        db.close()

@router.get("/projects/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    p = db.query(PostProdProject).filter(PostProdProject.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "id": p.id,
        "customer_name": p.customer_name,
        "project_name": p.project_name,
        "status": p.status,
        "assignee": p.assignee,
        "created_at": p.created_at,
        "chapters": [
            {
                "id": c.id,
                "chapter_no": c.chapter_no,
                "status": c.status,
                "source_filename": c.source_filename,
                "error_message": c.error_message,
                "attempts": c.attempts,
                "completed_at": c.completed_at
            } for c in p.chapters
        ]
    }

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks

from pydantic import BaseModel

class ProjectUpdatePayload(BaseModel):
    assignee: str | None = None
    status: str | None = None

@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectUpdatePayload,
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    project = db.query(PostProdProject).filter(PostProdProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if payload.assignee is not None:
        project.assignee = payload.assignee if payload.assignee != "" else None
    if payload.status is not None:
        project.status = payload.status
        
    db.commit()
    db.refresh(project)
    return {
        "id": project.id,
        "customer_name": project.customer_name,
        "project_name": project.project_name,
        "status": project.status,
        "assignee": project.assignee
    }

@router.get("/projects")
def list_projects(db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    projects = db.query(PostProdProject).order_by(PostProdProject.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "customer_name": p.customer_name,
            "project_name": p.project_name,
            "status": p.status,
            "assignee": p.assignee,
            "created_at": p.created_at,
            "chapters": [
                {
                    "id": c.id,
                    "chapter_no": c.chapter_no,
                    "status": c.status,
                    "source_filename": c.source_filename,
                    "error_message": c.error_message,
                    "attempts": c.attempts,
                    "completed_at": c.completed_at
                } for c in p.chapters
            ]
        } for p in projects
    ]

@router.post("/projects")
async def create_project(
    background_tasks: BackgroundTasks,
    customer_name: str = Form(...),
    project_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a ZIP file.")
    
    project = PostProdProject(
        customer_name=customer_name,
        project_name=project_name,
        status="Active",
        assignee=user.username if user else "System"
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    settings = get_settings()
    project_dir = os.path.join(settings.UPLOAD_FOLDER, "post_prod", f"project_{project.id}")
    os.makedirs(project_dir, exist_ok=True)
    
    zip_path = os.path.join(project_dir, "input.zip")
    with open(zip_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    extract_dir = os.path.join(project_dir, "extracted")
    os.makedirs(extract_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to extract zip file: {str(e)}")
    
    supported_extensions = (".indd", ".pdf")
    chapters_to_create = []
    
    for root, dirs, files in os.walk(extract_dir):
        for f_name in files:
            if f_name.startswith("._") or f_name.startswith("__MACOSX"):
                continue
            if f_name.lower().endswith(supported_extensions):
                chapter_no = parse_chapter_number(f_name)
                source_path = os.path.join(root, f_name)
                
                chapter = PostProdChapter(
                    project_id=project.id,
                    chapter_no=chapter_no,
                    status="YTS",
                    source_filename=f_name,
                    source_file_path=source_path,
                    attempts=0
                )
                db.add(chapter)
                chapters_to_create.append(chapter)
    
    db.commit()
    
    return {"message": "Project created successfully and extraction completed.", "project_id": project.id}

@router.get("/chapters/{chapter_id}/download")
def download_chapter(chapter_id: int, db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    if chapter.status != "Completed" or not chapter.converted_file_path or not os.path.exists(chapter.converted_file_path):
        raise HTTPException(status_code=400, detail="Converted file not available for download.")
    
    return FileResponse(
        path=chapter.converted_file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"converted_Chapter_{chapter.chapter_no}.docx"
    )

def get_chapter_from_string(text: str) -> str | None:
    """
    Attempts to find a chapter number prefix/indicator in the text (filename or path).
    Returns the parsed chapter number as a string (e.g. '1', '2') if found, or None.
    """
    match = re.search(r'(?:\b|_|-)(?:ch|chap|chapter|c)[^\d\w]*(\d+)', text, re.IGNORECASE)
    if match:
        return str(int(match.group(1)))
    
    # Standalone numbers or numbers preceded by separator: e.g. "image_01.png", "01.png"
    matches = re.findall(r'(?:\b|_|-)(\d+)(?:\b|_|-)', text)
    if matches:
        return str(int(matches[0]))
        
    return None

@router.get("/chapters/{chapter_id}/source-files")
def get_chapter_source_files(chapter_id: int, db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    
    if not chapter.source_file_path or not os.path.exists(chapter.source_file_path):
        return {"indesign": [], "docx": [], "images": [], "misc": []}
    
    chapter_dir = os.path.dirname(chapter.source_file_path)
    
    # Get all chapter numbers in this project to prevent showing files belonging to other chapters
    all_chapters = db.query(PostProdChapter).filter(PostProdChapter.project_id == chapter.project_id).all()
    project_chapter_nos = {c.chapter_no for c in all_chapters}
    other_source_filenames = {c.source_filename for c in all_chapters if c.id != chapter.id}
    
    indesign_files = []
    docx_files = []
    image_files = []
    misc_files = []
    
    for root, dirs, files in os.walk(chapter_dir):
        for f in files:
            if f.startswith("._") or f.startswith("__MACOSX"):
                continue
            
            # Check if this file is explicitly the source filename of another chapter
            if f in other_source_filenames:
                continue
                
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, chapter_dir)
            
            # Check if filename or relative path indicates it belongs to another chapter
            file_chap = get_chapter_from_string(f)
            if not file_chap:
                file_chap = get_chapter_from_string(rel_path)
                
            # Font files or files in Document Fonts directories are shared/global and should never be excluded
            is_font = f.lower().endswith((".otf", ".ttf", ".woff", ".woff2")) or "font" in rel_path.lower()
            
            if not is_font and file_chap and file_chap != chapter.chapter_no and file_chap in project_chapter_nos:
                continue
                
            size = os.path.getsize(full_path)
            
            lowered = f.lower()
            file_info = {"name": f, "path": rel_path, "size": size}
            
            if file_chap is None:
                misc_files.append(file_info)
            elif lowered.endswith((".indd", ".idml")):
                indesign_files.append(file_info)
            elif lowered.endswith(".docx"):
                docx_files.append(file_info)
            elif lowered.endswith((".png", ".jpg", ".jpeg", ".gif", ".tiff", ".eps", ".ai", ".psd", ".svg", ".tif")):
                image_files.append(file_info)
            else:
                misc_files.append(file_info)
                
    if chapter.status == "Completed" and chapter.converted_file_path and os.path.exists(chapter.converted_file_path):
        conv_size = os.path.getsize(chapter.converted_file_path)
        conv_name = os.path.basename(chapter.converted_file_path)
        docx_files.append({"name": conv_name, "path": "__converted__", "size": conv_size})
                
    return {
        "indesign": sorted(indesign_files, key=lambda x: x["name"]),
        "docx": sorted(docx_files, key=lambda x: x["name"]),
        "images": sorted(image_files, key=lambda x: x["name"]),
        "misc": sorted(misc_files, key=lambda x: x["name"]),
    }

@router.get("/chapters/{chapter_id}/download-source")
def download_chapter_source_file(chapter_id: int, path: str, db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    if path == "__converted__":
        if not chapter.converted_file_path or not os.path.exists(chapter.converted_file_path):
            raise HTTPException(status_code=404, detail="Converted file not found")
        return FileResponse(chapter.converted_file_path, filename=os.path.basename(chapter.converted_file_path))
        
    if not chapter.source_file_path or not os.path.exists(chapter.source_file_path):
        raise HTTPException(status_code=404, detail="Source directory not found")
        
    chapter_dir = os.path.dirname(chapter.source_file_path)
    target_path = os.path.abspath(os.path.join(chapter_dir, path))
    
    if not target_path.startswith(os.path.abspath(chapter_dir)):
        raise HTTPException(status_code=403, detail="Access denied")
        
    if not os.path.exists(target_path) or os.path.isdir(target_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(target_path, filename=os.path.basename(target_path))

@router.post("/chapters/{chapter_id}/upload-file")
async def upload_chapter_file(
    chapter_id: int,
    file: UploadFile = File(...),
    target_path: str = Form(None),
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    if not chapter.source_file_path or not os.path.exists(chapter.source_file_path):
        raise HTTPException(status_code=404, detail="Source directory not found")
        
    chapter_dir = os.path.dirname(chapter.source_file_path)
    
    if target_path:
        dest_path = os.path.abspath(os.path.join(chapter_dir, target_path))
        if not dest_path.startswith(os.path.abspath(chapter_dir)):
            raise HTTPException(status_code=403, detail="Access denied")
    else:
        # Save to default folder based on extension
        lowered = file.filename.lower()
        if lowered.endswith((".indd", ".idml")):
            dest_path = os.path.join(chapter_dir, file.filename)
        elif lowered.endswith(".docx"):
            dest_path = os.path.join(chapter_dir, file.filename)
        elif lowered.endswith((".png", ".jpg", ".jpeg", ".gif", ".tiff", ".eps", ".ai", ".psd", ".svg", ".tif")):
            links_dir = os.path.join(chapter_dir, "Links")
            if os.path.exists(links_dir) and os.path.isdir(links_dir):
                dest_path = os.path.join(links_dir, file.filename)
            else:
                dest_path = os.path.join(chapter_dir, file.filename)
        else:
            fonts_dir = os.path.join(chapter_dir, "Document Fonts")
            if not os.path.exists(fonts_dir):
                fonts_dir = os.path.join(chapter_dir, "Document fonts")
            if os.path.exists(fonts_dir) and os.path.isdir(fonts_dir):
                dest_path = os.path.join(fonts_dir, file.filename)
            else:
                dest_path = os.path.join(chapter_dir, file.filename)
                
    # Save the file
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    return {"message": "File uploaded successfully", "filename": os.path.basename(dest_path), "path": os.path.relpath(dest_path, chapter_dir)}

@router.post("/chapters/{chapter_id}/convert")
def convert_chapter(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    chapter.status = "Pending"
    chapter.error_message = None
    db.commit()
    
    from app.core.worker import run_post_prod_conversion_task
    run_post_prod_conversion_task.delay(chapter.id)
    return {"message": "Conversion started", "chapter_id": chapter.id}

