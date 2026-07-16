import os
import re
import shutil
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app import models
from app.domains.projects.models import Project
from app.domains.projects.schemas import ProjectCreate


class ProjectBootstrapValidationError(Exception):
    pass


_CHAPTER_CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML"]
_DESIGN_CATEGORIES = [
    "Indesign",
    "Common Art",
    "Pdf",
    "Font",
    "Library",
    "template",
    "Print Preset"
]
_CE_SUPPORT_CATEGORIES = ["Style sheet template"]



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

def create_predefined_project_folders(base_path: str):
    predefined_folders = [
        "Design/Indesign",
        "Design/Common Art",
        "Design/Pdf",
        "Design/Font",
        "Design/Library",
        "Design/template",
        "Design/Print Preset",
        "CE support/Style sheet template",
    ]
    for folder in predefined_folders:
        os.makedirs(os.path.join(base_path, folder), exist_ok=True)

    # Copy files from D:\Main\cms_backend\app\processing\results if any exist
    source_results_dir = r"D:\Main\cms_backend\app\processing\results"
    if os.path.exists(source_results_dir) and os.path.isdir(source_results_dir):
        dest_dir = os.path.join(base_path, "CE support", "Style sheet template")
        for item in os.listdir(source_results_dir):
            item_path = os.path.join(source_results_dir, item)
            if os.path.isfile(item_path):
                if not item.endswith("_scan.json"):
                    shutil.copy2(item_path, os.path.join(dest_dir, item))

def create_project(db: Session, project: ProjectCreate):
    db_project = Project(**project.dict(), status="Planning")
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
    chapter_count: int | None = None,
    files: list[UploadFile] | None = None,
    upload_dir: str,
):
    valid_uploads = [upload for upload in files or [] if upload.filename]
    if chapter_count is None or chapter_count <= 0:
        chapter_count = len(valid_uploads)

    if not valid_uploads:
        new_project = ProjectCreate(
            title=title,
            code=code,
            xml_standard=xml_standard,
        )
        db_project = create_project(db, new_project)
        db_project.chapter_count = chapter_count

        if client_name:
            db_project.client_name = client_name
        db.commit()
        db.refresh(db_project)

        base_path = f"{upload_dir}/{code}"
        os.makedirs(base_path, exist_ok=True)
        create_predefined_project_folders(base_path)

        for i in range(1, chapter_count + 1):
            chapter_number = f"{i:02d}"
            chapter = models.ChapterInfo(
                client=db_project.division_code or "",
                project=db_project.project_code or "",
                chapters=chapter_number,
                chapter_title=f"Chapter {chapter_number}",
                status="In-progress"
            )
            db.add(chapter)
            db.commit()
            db.refresh(chapter)

            chapter_base_path = f"{base_path}/{chapter_number}"
            for category in _CHAPTER_CATEGORIES:
                os.makedirs(f"{chapter_base_path}/{category}", exist_ok=True)

        from app.domains.workflow.models import WorkflowMaster as _WorkflowMaster
        from sqlalchemy import or_ as _or
        first_stage = None
        if db_project.workflow_name:
            first_stage_row = db.query(_WorkflowMaster).filter(
                _WorkflowMaster.workflow_name == db_project.workflow_name,
                _or(_WorkflowMaster.previous_stage.is_(None), _WorkflowMaster.previous_stage == "")
            ).first()
            if first_stage_row:
                first_stage = first_stage_row.stage_name

        for virt_num, virt_title in [("Design", "Design"), ("CE support", "CE support")]:
            chapter = models.ChapterInfo(
                client=db_project.division_code or "",
                project=db_project.project_code or "",
                chapters=virt_num,
                chapter_title=virt_title,
                status="In-progress",
                workflow=db_project.workflow_name or "",
                stage_level=1,
                stage_name=first_stage,
            )
            db.add(chapter)
            db.commit()
            db.refresh(chapter)

        return db_project

    upload_plan = _build_project_bootstrap_upload_plan(
        chapter_count=chapter_count,
        files=files,
    )

    new_project = ProjectCreate(
        title=title,
        code=code,
        xml_standard=xml_standard,
    )
    db_project = create_project(db, new_project)
    db_project.chapter_count = chapter_count

    if client_name:
        db_project.client_name = client_name
    db.commit()
    db.refresh(db_project)

    base_path = f"{upload_dir}/{code}"
    os.makedirs(base_path, exist_ok=True)
    create_predefined_project_folders(base_path)

    for plan_item in upload_plan:
        chapter_number = plan_item["chapter_number"]
        chapter_folder_name = plan_item["folder_name"]
        chapter = models.ChapterInfo(
            client=db_project.division_code or "",
            project=db_project.project_code or "",
            chapters=chapter_number,
            chapter_title=plan_item["safe_stem"],
            status="In-progress"
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

    from app.domains.workflow.models import WorkflowMaster as _WorkflowMaster
    from sqlalchemy import or_ as _or
    first_stage = None
    if db_project.workflow_name:
        first_stage_row = db.query(_WorkflowMaster).filter(
            _WorkflowMaster.workflow_name == db_project.workflow_name,
            _or(_WorkflowMaster.previous_stage.is_(None), _WorkflowMaster.previous_stage == "")
        ).first()
        if first_stage_row:
            first_stage = first_stage_row.stage_name

    for virt_num, virt_title in [("Design", "Design"), ("CE support", "CE support")]:
        chapter = models.ChapterInfo(
            client=db_project.division_code or "",
            project=db_project.project_code or "",
            chapters=virt_num,
            chapter_title=virt_title,
            status="In-progress",
            workflow=db_project.workflow_name or "",
            stage_level=1,
            stage_name=first_stage,
        )
        db.add(chapter)
        db.commit()
        db.refresh(chapter)

    db.commit()

    return db_project


def update_project_status(db: Session, project_id: int, status: str):
    project = db.query(Project).filter(Project.id == project_id).first()
    if project:
        project.status = status
        db.commit()
        db.refresh(project)
    return project

def get_projects(db: Session, skip: int = 0, limit: int = 100):
    return db.query(Project).filter(Project.is_deleted != True).offset(skip).limit(limit).all()

def delete_project(db, project_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None
    project.is_deleted = True
    db.commit()
    return True


def delete_project_v2(db, project_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None
    project.is_deleted = True
    db.commit()
    return True


def delete_project_with_filesystem(db: Session, *, project_id: int, upload_dir: str):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError(f"Project with ID {project_id} not found")

    # Soft delete
    project.is_deleted = True
    db.commit()

    project_path = f"{upload_dir}/{project.code}"
    if os.path.exists(project_path):
        shutil.rmtree(project_path, ignore_errors=True)

    return project
