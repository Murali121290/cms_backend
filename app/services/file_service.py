from app.utils.timezone import now_ist_naive
from sqlalchemy.orm import Session
from fastapi import UploadFile
from app import models
import shutil
import os
from datetime import datetime

from app.core.paths import UPLOADS_DIR
from app.services import checkout_service, version_service

UPLOAD_DIR = str(UPLOADS_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)

def save_upload_file(upload_file: UploadFile, destination: str):
    try:
        with open(destination, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
    finally:
        upload_file.file.close()

def create_file_record(db: Session, project_id: int, file: UploadFile):
    # Determine local path (mocking S3 for now)
    # Using timestamp to avoid collisions
    timestamp = now_ist_naive().strftime("%Y%m%d%H%M%S")
    filename = f"{project_id}_{timestamp}_{file.filename}"
    path = os.path.join(UPLOAD_DIR, filename)
    
    save_upload_file(file, path)
    
    db_file = models.File(
        project_id=project_id,
        path=path,
        file_type=file.content_type,
        version=1 # Logic for version bumping can be added here
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


def get_project_and_chapter(db: Session, *, project_id: int, chapter_id: int):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    return project, chapter


def upload_chapter_files(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    category: str,
    files: list[UploadFile],
    actor_user_id: int,
    upload_dir: str,
):
    project, chapter = get_project_and_chapter(db, project_id=project_id, chapter_id=chapter_id)
    if not project or not chapter:
        return {"project": project, "chapter": chapter, "uploaded": [], "skipped": []}

    safe_cat = category.replace(" ", "_")
    base_path = f"{upload_dir}/{project.code}/{chapter.number}/{safe_cat}"
    os.makedirs(base_path, exist_ok=True)
    uploaded_results = []
    skipped_results = []

    for upload in files:
        if not upload.filename:
            continue

        existing_file = db.query(models.File).filter(
            models.File.chapter_id == chapter_id,
            models.File.category == category,
            models.File.filename == upload.filename,
        ).first()

        if existing_file:
            if checkout_service.is_locked_by_other(existing_file, actor_user_id):
                skipped_results.append(
                    {
                        "filename": upload.filename,
                        "code": "LOCKED_BY_OTHER",
                        "message": "File is locked by another user.",
                    }
                )
                continue

            version_entry = version_service.archive_existing_file(
                db,
                existing_file=existing_file,
                base_path=base_path,
                uploaded_by_id=actor_user_id,
            )

            file_path = existing_file.path
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(upload.file, buffer)

            existing_file.version += 1
            existing_file.uploaded_at = now_ist_naive()
            checkout_service.reset_checkout_after_overwrite(existing_file)
            uploaded_results.append(
                {
                    "file": existing_file,
                    "operation": "replaced",
                    "archive_entry": version_entry,
                }
            )
        else:
            file_path = f"{base_path}/{upload.filename}"
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(upload.file, buffer)

            ext = upload.filename.split(".")[-1].lower() if "." in upload.filename else ""
            db_file = models.File(
                project_id=project_id,
                chapter_id=chapter_id,
                filename=upload.filename,
                file_type=ext,
                category=category,
                path=file_path,
                version=1,
            )
            db.add(db_file)
            uploaded_results.append(
                {
                    "file": db_file,
                    "operation": "created",
                    "archive_entry": None,
                }
            )

    db.commit()
    return {
        "project": project,
        "chapter": chapter,
        "uploaded": uploaded_results,
        "skipped": skipped_results,
    }


def get_file_for_download(db: Session, *, file_id: int):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record or not file_record.path or not os.path.exists(file_record.path):
        return None
    return file_record


def delete_file_and_capture_context(db: Session, *, file_id: int):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        return None

    context = {
        "project_id": file_record.project_id,
        "chapter_id": file_record.chapter_id,
        "category": file_record.category,
    }

    if file_record.path and os.path.exists(file_record.path):
        try:
            os.remove(file_record.path)
        except Exception as e:
            print(f"Error deleting file on disk: {e}")

    db.delete(file_record)
    db.commit()
    return context
