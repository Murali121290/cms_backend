from app.utils.timezone import now_ist_naive
from sqlalchemy.orm import Session
from fastapi import UploadFile
from app import models
from app.domains.projects.models import Project
import re
import shutil
import os
from datetime import datetime

from app.core.paths import UPLOADS_DIR
from app.services import checkout_service, version_service

UPLOAD_DIR = str(UPLOADS_DIR)
os.makedirs(UPLOAD_DIR, exist_ok=True)


def extract_chapter_number_from_filename(name: str) -> str | None:
    """Parse a zero-padded chapter number out of a filename or folder name.

    Matches "chapter"/"chap"/"ch" followed by digits (e.g. "Chapter_05.docx"),
    else falls back to a leading or trailing run of digits in the stem
    (e.g. "05_intro.docx" or "intro_05.docx").
    """
    name_lower = name.lower()
    m = re.search(r'(?:chapter|chap|ch)[_\s-]*(\d+)', name_lower)
    if m:
        return f"{int(m.group(1)):02d}"
    base = os.path.splitext(os.path.basename(name))[0]
    m = re.match(r'^(\d+)', base)
    if m:
        return f"{int(m.group(1)):02d}"
    m = re.search(r'(\d+)$', base)
    if m:
        return f"{int(m.group(1)):02d}"
    m = re.search(r'(\d+)', base)
    if m:
        return f"{int(m.group(1)):02d}"
    return None

def save_upload_file(upload_file: UploadFile, destination: str):
    try:
        with open(destination, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
    finally:
        upload_file.file.close()

def create_file_record(db: Session, project_id: int, file: UploadFile, actor_user_id: int | None = None):
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
        version=1, # Logic for version bumping can be added here
        uploaded_by_id=actor_user_id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


def get_project_and_chapter(db: Session, *, project_id: int, chapter_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
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

        if upload.filename.lower().endswith(".zip") and category in ["Design", "Art"]:
            import zipfile
            import io
            try:
                zip_data = upload.file.read()
                upload.file.seek(0)
                with zipfile.ZipFile(io.BytesIO(zip_data)) as z:
                    for member in z.namelist():
                        fname = os.path.basename(member)
                        if not fname or member.endswith("/") or "__MACOSX" in member or fname.startswith("."):
                            continue

                        existing_file = db.query(models.File).filter(
                            models.File.chapter_id == chapter_id,
                            models.File.category == category,
                            models.File.filename == fname,
                        ).first()

                        if existing_file:
                            if checkout_service.is_locked_by_other(existing_file, actor_user_id):
                                skipped_results.append(
                                    {
                                        "filename": f"{upload.filename} -> {fname}",
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
                            with z.open(member) as src, open(file_path, "wb") as dst:
                                shutil.copyfileobj(src, dst)

                            existing_file.version += 1
                            existing_file.uploaded_at = now_ist_naive()
                            existing_file.uploaded_by_id = actor_user_id
                            checkout_service.reset_checkout_after_overwrite(existing_file)
                            uploaded_results.append(
                                {
                                    "file": existing_file,
                                    "operation": "replaced",
                                    "archive_entry": version_entry,
                                }
                            )
                        else:
                            file_path = f"{base_path}/{fname}"
                            with z.open(member) as src, open(file_path, "wb") as dst:
                                shutil.copyfileobj(src, dst)

                            ext = fname.split(".")[-1].lower() if "." in fname else ""
                            db_file = models.File(
                                project_id=project_id,
                                chapter_id=chapter_id,
                                filename=fname,
                                file_type=ext,
                                category=category,
                                path=file_path,
                                version=1,
                                uploaded_by_id=actor_user_id,
                            )
                            db.add(db_file)
                            uploaded_results.append(
                                {
                                    "file": db_file,
                                    "operation": "created",
                                    "archive_entry": None,
                                }
                            )
            except Exception as zip_err:
                skipped_results.append(
                    {
                        "filename": upload.filename,
                        "code": "INVALID_ZIP",
                        "message": f"Failed to extract ZIP: {str(zip_err)}",
                    }
                )
        else:
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
                existing_file.uploaded_by_id = actor_user_id
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
                    uploaded_by_id=actor_user_id,
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
            # Also clean up the corresponding XHTML file if it exists
            dir_name = os.path.dirname(file_record.path)
            base_name = os.path.splitext(os.path.basename(file_record.path))[0]
            xhtml_path = os.path.join(dir_name, "xhtml", f"{base_name}.html")
            if os.path.exists(xhtml_path):
                try:
                    os.remove(xhtml_path)
                except Exception as e:
                    print(f"Error deleting associated XHTML file on disk: {e}")

            os.remove(file_record.path)
        except Exception as e:
            print(f"Error deleting file on disk: {e}")

    db.delete(file_record)
    db.commit()
    return context


def get_processed_docx_path(db: Session, file_id: int, logger=None):
    from app.domains.review.service import resolve_processed_target
    from fastapi import HTTPException
    try:
        resolved = resolve_processed_target(db, file_id=file_id)
        return resolved["processed_path"]
    except HTTPException:
        return None
    except Exception as e:
        if logger:
            logger.warning(f"Could not resolve processed path for file {file_id}: {e}")
        return None
