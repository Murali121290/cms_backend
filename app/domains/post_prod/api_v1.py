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

from .epub_utils import decode_bytes, load_epub
from .report import build_report, to_html, to_csv
from fastapi.responses import JSONResponse
import json

from app.domains.auth.rbac_config import has_post_prod_access

def check_post_prod_access(user = Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(status_code=403, detail="Access denied to Post Production / Backlist.")
    return user

router = APIRouter(prefix="/post-prod", tags=["Post Production"], dependencies=[Depends(check_post_prod_access)])
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
def check_and_update_project_status(db: Session, project_name: str, client_code: str):
    project = db.query(PostProdProject).filter(
        PostProdProject.project_name == project_name,
        PostProdProject.client_code == client_code
    ).first()
    if not project:
        return
        
    chapters = db.query(PostProdChapter).filter(
        PostProdChapter.project_name == project_name,
        PostProdChapter.client_code == client_code
    ).all()
    
    if chapters and all(c.status == "Completed" for c in chapters):
        project.status = "Completed"
        db.commit()

def run_conversion_background(chapter_id: int, session_factory):
    db = session_factory()
    try:
        chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
        if not chapter:
            return
        
        chapter.status = "In-Progress"
        chapter.conversion_status = "Converting"
        chapter.conversion_started_at = datetime.utcnow()
        chapter.attempts += 1
        db.commit()

        settings = get_settings()
        project_dir = os.path.join(settings.UPLOAD_FOLDER, "post_prod", chapter.client_code or "default_client", chapter.project_name or "default_project")
        output_dir = os.path.join(project_dir, "converted")
        os.makedirs(output_dir, exist_ok=True)
        
        source_base = os.path.splitext(chapter.source_filename)[0]
        dest_filename = f"{source_base}.docx"
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
                
                # Exclude other chapters' source filenames to only send this chapter
                all_chaps = db.query(PostProdChapter).filter(
                    PostProdChapter.project_name == chapter.project_name,
                    PostProdChapter.client_code == chapter.client_code
                ).all()
                other_source_filenames = {c.source_filename for c in all_chaps if c.id != chapter.id}
                other_chapter_nos = {c.chapter_no for c in all_chaps if c.id != chapter.id}
                
                try:
                    logger.info(f"Packaging chapter directory {chapter_dir} into ZIP: {temp_zip_path}")
                    with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for root, _, filenames in os.walk(chapter_dir):
                            # Check if the folder path belongs to another chapter
                            rel_root = os.path.relpath(root, chapter_dir)
                            path_parts = rel_root.replace("\\", "/").lower().split("/")
                            
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
                                if f.startswith("._") or f.startswith("__MACOSX") or f == zip_name:
                                    continue
                                if f in other_source_filenames:
                                    continue
                                full_file_path = os.path.join(root, f)
                                rel_path = os.path.relpath(full_file_path, chapter_dir)
                                zf.write(full_file_path, rel_path)
                    
                    url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert"
                    try:
                        logger.info(f"Sending packaged ZIP to remote InDesign server: {url}")
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
                                    params={"client": client_name},
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
            settings = get_settings()
            if settings.INDESIGN_SERVER_URL:
                url = f"{settings.INDESIGN_SERVER_URL.rstrip('/')}/convert-pdf"
                try:
                    logger.info(f"Sending remote PDF conversion request to: {url}")
                    with open(chapter.source_file_path, "rb") as pdf_file:
                        response = requests.post(
                            url,
                            files={"file": (chapter.source_filename, pdf_file.read(), "application/octet-stream")},
                            timeout=(30.0, 900)
                        )
                    if response.status_code == 200:
                        with open(dest_path, "wb") as out_f:
                            out_f.write(response.content)
                        success = True
                    else:
                        raise Exception(f"Remote PDF server returned {response.status_code}: {response.text}")
                except Exception as pdf_err:
                    error_msg = f"Remote PDF conversion failed: {str(pdf_err)}"
            else:
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
                
            chapter.conversion_status = "Completed"
            chapter.conversion_completed_at = datetime.utcnow()
            chapter.converted_file_path = dest_path
            
            if chapter.qc_status == "Completed":
                chapter.status = "Completed"
                chapter.completed_at = datetime.utcnow()
        else:
            chapter.status = "Failed"
            chapter.conversion_status = "Failed"
            chapter.error_message = error_msg or "Unknown error"
        
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
        "client": p.client,
        "client_code": p.client_code,
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
                "size_bytes": c.size_bytes,
                "conversion_status": c.conversion_status,
                "conversion_started_at": c.conversion_started_at,
                "conversion_completed_at": c.conversion_completed_at,
                "qc_status": c.qc_status,
                "qc_completed_at": c.qc_completed_at,
                "qc_active_seconds": c.qc_active_seconds,
                "qc_last_started_at": c.qc_last_started_at,
                "created_at": c.created_at,
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
        "client": project.client,
        "client_code": project.client_code,
        "project_name": project.project_name,
        "status": project.status,
        "assignee": project.assignee
    }

@router.get("/projects")
def list_projects(db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    projects = db.query(PostProdProject).filter(PostProdProject.is_deleted != True).order_by(PostProdProject.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "client": p.client,
            "client_code": p.client_code,
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
                    "size_bytes": c.size_bytes,
                    "conversion_status": c.conversion_status,
                    "conversion_started_at": c.conversion_started_at,
                    "conversion_completed_at": c.conversion_completed_at,
                    "qc_status": c.qc_status,
                    "qc_completed_at": c.qc_completed_at,
                    "qc_active_seconds": c.qc_active_seconds,
                    "qc_last_started_at": c.qc_last_started_at,
                    "created_at": c.created_at,
                    "completed_at": c.completed_at
                } for c in p.chapters
            ]
        } for p in projects
    ]

@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    project = db.query(PostProdProject).filter(PostProdProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_deleted = True
    db.commit()
    return {"message": "Project soft deleted successfully"}

@router.post("/projects")
async def create_project(
    background_tasks: BackgroundTasks,
    client: str = Form(...),
    client_code: str = Form(...),
    project_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user_from_cookie)
):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a ZIP file.")
    
    project = PostProdProject(
        client=client,
        client_code=client_code,
        project_name=project_name,
        status="Active",
        assignee=user.username if user else "System"
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    settings = get_settings()
    project_dir = os.path.join(settings.UPLOAD_FOLDER, "post_prod", client_code, project_name)
    os.makedirs(project_dir, exist_ok=True)
    
    zip_path = os.path.join(project_dir, file.filename)
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
                    client_code=client_code,
                    project_name=project_name,
                    chapter_no=chapter_no,
                    status="YTS",
                    source_filename=f_name,
                    source_file_path=source_path,
                    size_bytes=os.path.getsize(source_path),
                    attempts=0
                )
                db.add(chapter)
                chapters_to_create.append(chapter)
    
    db.commit()
    
    return {"message": "Project created successfully and extraction completed.", "project_id": project.id}

from fastapi.responses import FileResponse, StreamingResponse
import io

@router.get("/projects/{project_id}/bulk-download-chapters")
def bulk_download_chapters(
    project_id: int, 
    chapter_ids: str, 
    db: Session = Depends(database.get_db), 
    user = Depends(get_current_user_from_cookie)
):
    ids_list = [int(i.strip()) for i in chapter_ids.split(",") if i.strip().isdigit()]
    if not ids_list:
        raise HTTPException(status_code=400, detail="No valid chapter IDs provided")
        
    chapters = db.query(PostProdChapter).filter(
        PostProdChapter.id.in_(ids_list)
    ).all()
    
    if not chapters:
        raise HTTPException(status_code=404, detail="No chapters found")
        
    downloadable = [c for c in chapters if c.converted_file_path and os.path.exists(c.converted_file_path)]
    if not downloadable:
        raise HTTPException(status_code=400, detail="No completed files are available for download among selected chapters.")
        
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for chap in downloadable:
            base_name = os.path.basename(chap.converted_file_path)
            if not base_name.endswith(".docx"):
                base_name = f"Chapter_{chap.chapter_no}.docx"
            zip_file.write(chap.converted_file_path, base_name)
            
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=converted_chapters.zip"}
    )

@router.get("/chapters/{chapter_id}/download")
def download_chapter(chapter_id: int, db: Session = Depends(database.get_db), user = Depends(get_current_user_from_cookie)):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    if chapter.status != "Completed" or not chapter.converted_file_path or not os.path.exists(chapter.converted_file_path):
        raise HTTPException(status_code=400, detail="Converted file not available for download.")
    
    source_base = os.path.splitext(chapter.source_filename)[0]
    return FileResponse(
        path=chapter.converted_file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{source_base}.docx"
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
    all_chapters = db.query(PostProdChapter).filter(
        PostProdChapter.project_name == chapter.project_name,
        PostProdChapter.client_code == chapter.client_code
    ).all()
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
            elif lowered.endswith((".indd", ".idml",".pdf")):
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
    chapter.conversion_status = "Pending"
    chapter.error_message = None
    db.commit()
    
    from app.core.worker import run_post_prod_conversion_task
    run_post_prod_conversion_task.delay(chapter.id)
    return {"message": "Conversion started", "chapter_id": chapter.id}


@router.get("/chapters/{chapter_id}/open-in-word")
def api_post_prod_open_in_word(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
        
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    if chapter.conversion_status != "Completed" or not chapter.converted_file_path or not os.path.exists(chapter.converted_file_path):
        raise HTTPException(status_code=400, detail="Converted file not available for editing.")
        
    if chapter.qc_status == "YTS":
        chapter.qc_status = "In-Progress"
        chapter.qc_last_started_at = datetime.utcnow()
        db.commit()
        
    from datetime import timedelta
    from app.domains.auth.security import create_access_token
    from app.integrations.webdav.config import WEBDAV_BASE_URL, WEBDAV_TOKEN_EXPIRE_MINUTES
    import urllib.parse

    token = create_access_token(
        {"sub": user.username},
        expires_delta=timedelta(minutes=WEBDAV_TOKEN_EXPIRE_MINUTES)
    )
    
    filename = f"Chapter_{chapter.chapter_no}.docx"
    quoted_filename = urllib.parse.quote(filename, safe="")
    webdav_url = f"{WEBDAV_BASE_URL}/webdav/post-prod/chapters/{chapter_id}/{token}/{quoted_filename}"
    ms_word_uri = f"ms-word:ofe|u|{webdav_url}"
    
    return {"ms_word_uri": ms_word_uri, "webdav_url": webdav_url}

from pydantic import BaseModel
class QCStatusUpdate(BaseModel):
    status: str

@router.post("/chapters/{chapter_id}/qc-status")
def update_chapter_qc_status(
    chapter_id: int,
    payload: QCStatusUpdate,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie)
):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    if payload.status not in ["In-Progress", "Paused"]:
        raise HTTPException(status_code=400, detail="Invalid status")
        
    if payload.status == "In-Progress" and chapter.qc_status != "In-Progress":
        chapter.qc_last_started_at = datetime.utcnow()
    elif payload.status == "Paused" and chapter.qc_status == "In-Progress":
        if chapter.qc_last_started_at:
            delta = datetime.utcnow() - chapter.qc_last_started_at
            chapter.qc_active_seconds = (chapter.qc_active_seconds or 0) + int(delta.total_seconds())
        chapter.qc_last_started_at = None
        
    chapter.qc_status = payload.status
    db.commit()
    
    return {"message": f"QC status updated to {payload.status}"}

@router.post("/chapters/{chapter_id}/qc-complete")
def complete_chapter_qc(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie)
):
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
        
    if chapter.qc_status == "In-Progress":
        if chapter.qc_last_started_at:
            delta = datetime.utcnow() - chapter.qc_last_started_at
            chapter.qc_active_seconds = (chapter.qc_active_seconds or 0) + int(delta.total_seconds())
            
    chapter.qc_status = "Completed"
    chapter.qc_last_started_at = None
    chapter.qc_completed_at = datetime.utcnow()
    
    if chapter.conversion_status == "Completed":
        chapter.status = "Completed"
        chapter.completed_at = datetime.utcnow()
        
    db.commit()
    
    try:
        check_and_update_project_status(db, chapter.project_name, chapter.client_code)
    except Exception as e:
        logger.warning(f"Failed to update project status: {e}")
        
    return {"message": "QC marked as completed"}


MAX_CSS_MATCHER_BYTES = 80 * 1024 * 1024  # 80 MB guard

@router.post("/css-matcher/analyze")
async def analyze_css(
    epub: UploadFile = File(...),
    master_css: UploadFile = File(...),
    package_files: str = Form(""),          # comma/newline separated filenames in the delivery folder
    expected_sidecars: str = Form("frontlist.csv"),
    user=Depends(get_current_user_from_cookie)
):
    epub_bytes = await epub.read()
    css_bytes = await master_css.read()

    if not epub_bytes or not css_bytes:
        raise HTTPException(status_code=400, detail="Both an EPUB and a master CSS file are required.")
    if len(epub_bytes) > MAX_CSS_MATCHER_BYTES:
        raise HTTPException(status_code=413, detail="EPUB exceeds the 80 MB limit.")

    if not epub.filename.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="First file must be a .epub")

    try:
        epub_info = load_epub(epub_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read EPUB as a ZIP archive: {exc}")

    if not epub_info.stylesheets:
        raise HTTPException(status_code=422, detail="No .css stylesheet found inside the EPUB.")

    master_text, _, _ = decode_bytes(css_bytes)

    pkg = [p.strip() for p in package_files.replace(",", "\n").splitlines() if p.strip()]
    # the uploaded epub is itself part of the delivery package
    pkg.append(epub.filename)
    expected = [s.strip() for s in expected_sidecars.replace(",", "\n").splitlines() if s.strip()]

    report = build_report(
        epub_info,
        master_text,
        package_filenames=pkg,
        expected_sidecars=expected or None,
        epub_bytes=epub_bytes,
    )

    return JSONResponse(
        {
            "report": report,
            "artifacts": {
                "html": to_html(report),
                "csv": to_csv(report),
                "json": json.dumps(report, indent=2, ensure_ascii=False),
            },
        }
    )

