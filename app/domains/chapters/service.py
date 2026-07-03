import os
import shutil

from sqlalchemy.orm import Session

from app import models
from app.domains.projects.models import Project


_CHAPTER_CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML"]


def create_chapter(db: Session, *, project_id: int, number: str, title: str, upload_dir: str, status: str = "In-progress"):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"project": None, "chapter": None}

    from app.domains.workflow.models import WorkflowMaster
    from sqlalchemy import or_
    
    first_stage = None
    if project.workflow_name:
        first_stage_row = db.query(WorkflowMaster).filter(
            WorkflowMaster.workflow_name == project.workflow_name,
            or_(WorkflowMaster.previous_stage.is_(None), WorkflowMaster.previous_stage == "")
        ).first()
        if first_stage_row:
            first_stage = first_stage_row.stage_name

    new_chapter = models.ChapterInfo(
        client=project.division_code or "",
        project=project.project_code or "",
        chapters=number,
        chapter_title=title,
        status=status,
        stage_name=first_stage,
        workflow=project.workflow_name or "Workflow1",
        priority=getattr(project, "priority", None) or "Normal",
        complexity_level=getattr(project, "composition", None) or "Medium",
        project_manager_name=getattr(project, "project_manager", None) or None,
    )
    db.add(new_chapter)

    if project.chapter_count is not None:
        project.chapter_count += 1
    else:
        project.chapter_count = 1

    db.commit()
    db.refresh(new_chapter)
    db.refresh(project)

    chapter_base_dir = f"{upload_dir}/{project.code}/{number}"
    for category in _CHAPTER_CATEGORIES:
        os.makedirs(os.path.join(chapter_base_dir, category), exist_ok=True)

    return {"project": project, "chapter": new_chapter}


def rename_chapter(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    number: str,
    title: str,
    upload_dir: str,
):
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    project = db.query(Project).filter(Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    old_number = chapter.chapters
    chapter.chapters = number
    chapter.chapter_title = title
    db.commit()

    if old_number != number:
        old_dir = f"{upload_dir}/{project.code}/{old_number}"
        new_dir = f"{upload_dir}/{project.code}/{number}"
        if os.path.exists(old_dir):
            os.rename(old_dir, new_dir)

    return {"project": project, "chapter": chapter}


def delete_chapter_primary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    project = db.query(Project).filter(Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    chapter_dir = f"{upload_dir}/{project.code}/{chapter.chapters}"
    if os.path.exists(chapter_dir):
        shutil.rmtree(chapter_dir)

    db.delete(chapter)
    if project.chapter_count is not None and project.chapter_count > 0:
        project.chapter_count -= 1
    db.commit()
    db.refresh(project)
    return {"project": project, "chapter": chapter}


def delete_chapter_secondary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    project = db.query(Project).filter(Project.id == project_id).first()
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    chapter_path = f"{upload_dir}/{project.code}/{chapter.chapters}"
    if os.path.exists(chapter_path):
        shutil.rmtree(chapter_path, ignore_errors=True)

    db.delete(chapter)
    if project.chapter_count is not None and project.chapter_count > 0:
        project.chapter_count -= 1
    db.commit()
    db.refresh(project)
    return {"project": project, "chapter": chapter}

