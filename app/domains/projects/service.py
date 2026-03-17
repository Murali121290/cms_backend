import os
import re
import shutil
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app import models, schemas


class ProjectBootstrapValidationError(Exception):
    pass


_CHAPTER_CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML"]


def _derive_safe_filename_stem(filename: str) -> str:
    original_stem = Path(os.path.basename(filename)).stem.strip()
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", original_stem).strip(" ._-")
    if not safe_stem:
        raise ProjectBootstrapValidationError("Each uploaded file must have a usable filename.")
    return safe_stem


def _build_project_bootstrap_upload_plan(
    *,
    chapter_count: int,
    files: list[UploadFile] | None,
):
    valid_uploads = [upload for upload in files or [] if upload.filename]
    if chapter_count != len(valid_uploads):
        raise ProjectBootstrapValidationError(
            "Number of chapters must exactly match the number of uploaded files."
        )

    seen_stems: set[str] = set()
    upload_plan = []
    for index, upload in enumerate(valid_uploads, start=1):
        safe_stem = _derive_safe_filename_stem(upload.filename)
        normalized_stem = safe_stem.casefold()
        if normalized_stem in seen_stems:
            raise ProjectBootstrapValidationError(
                "Uploaded files must have unique filename stems."
            )
        seen_stems.add(normalized_stem)

        folder_name = f"Chapter {index} - {safe_stem}"
        file_extension = Path(upload.filename).suffix.lstrip(".").lower()
        upload_plan.append(
            {
                "chapter_number": f"{index:02d}",
                "upload": upload,
                "safe_stem": safe_stem,
                "folder_name": folder_name,
                "file_type": file_extension,
            }
        )

    return upload_plan

def create_project(db: Session, project: schemas.ProjectCreate):
    db_project = models.Project(**project.dict(), status="RECEIVED")
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


def create_project_with_initial_files(
    db: Session,
    *,
    code: str,
    title: str,
    client_name: str | None,
    xml_standard: str,
    chapter_count: int,
    files: list[UploadFile] | None,
    upload_dir: str,
):
    upload_plan = _build_project_bootstrap_upload_plan(
        chapter_count=chapter_count,
        files=files,
    )

    new_project = schemas.ProjectCreate(
        title=title,
        code=code,
        xml_standard=xml_standard,
        team_id=1,
    )
    db_project = create_project(db, new_project)

    if client_name:
        db_project.client_name = client_name
        db.commit()
        db.refresh(db_project)

    base_path = f"{upload_dir}/{code}"
    os.makedirs(base_path, exist_ok=True)

    for plan_item in upload_plan:
        chapter_number = plan_item["chapter_number"]
        chapter_folder_name = plan_item["folder_name"]
        chapter = models.Chapter(
            project_id=db_project.id,
            number=chapter_number,
            title=plan_item["safe_stem"],
        )
        db.add(chapter)
        db.commit()
        db.refresh(chapter)

        chapter_base_path = f"{base_path}/{chapter_folder_name}"
        for category in _CHAPTER_CATEGORIES:
            os.makedirs(f"{chapter_base_path}/{category}", exist_ok=True)

        manuscript_path = f"{chapter_base_path}/Manuscript"

        upload = plan_item["upload"]
        file_path = f"{manuscript_path}/{upload.filename}"
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        db_file = models.File(
            project_id=db_project.id,
            chapter_id=chapter.id,
            filename=upload.filename,
            file_type=plan_item["file_type"],
            category="Manuscript",
            path=file_path,
        )
        db.add(db_file)

    db.commit()

    return db_project

def update_project_status(db: Session, project_id: int, status: str):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project:
        project.status = status
        db.commit()
        db.refresh(project)
    return project

def get_projects(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Project).offset(skip).limit(limit).all()

def delete_project(db, project_id: int):
    from app.models import Project, Chapter, File
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None
    # Delete in correct order respecting foreign keys
    for chapter in db.query(Chapter).filter(Chapter.project_id == project_id).all():
        for file in db.query(File).filter(File.chapter_id == chapter.id).all():
            db.execute(db.bind.connect().execution_options(autocommit=True) if False else __import__('sqlalchemy').text("DELETE FROM file_versions WHERE file_id = :fid"), {"fid": file.id})
            db.execute(__import__('sqlalchemy').text("DELETE FROM processing_results WHERE file_id = :fid"), {"fid": file.id})
        db.query(File).filter(File.chapter_id == chapter.id).delete()
    db.query(Chapter).filter(Chapter.project_id == project_id).delete()
    db.delete(project)
    db.commit()
    return True


def delete_project_v2(db, project_id: int):
    from app.models import Project, Chapter, File
    from sqlalchemy import text
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None
    for chapter in db.query(Chapter).filter(Chapter.project_id == project_id).all():
        for file in db.query(File).filter(File.chapter_id == chapter.id).all():
            db.execute(text("DELETE FROM file_versions WHERE file_id = :fid"), {"fid": file.id})
            db.delete(file)
        db.flush()
        db.delete(chapter)
    db.flush()
    db.delete(project)
    db.commit()
    return True


def delete_project_with_filesystem(db: Session, *, project_id: int, upload_dir: str):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return None

    project_path = f"{upload_dir}/{project.code}"
    if os.path.exists(project_path):
        shutil.rmtree(project_path, ignore_errors=True)

    db.delete(project)
    db.commit()
    return project
