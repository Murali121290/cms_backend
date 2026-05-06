import os
import shutil

from sqlalchemy.orm import Session

from app import models


_CHAPTER_CATEGORIES = ["Manuscript", "Art", "InDesign", "Proof", "XML"]


def create_chapter(db: Session, *, project_id: int, number: str, title: str, upload_dir: str):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return {"project": None, "chapter": None}

    new_chapter = models.Chapter(project_id=project_id, number=number, title=title)
    db.add(new_chapter)
    db.commit()
    db.refresh(new_chapter)

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
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    project = db.query(models.Project).filter(models.Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    old_number = chapter.number
    chapter.number = number
    chapter.title = title
    db.commit()

    if old_number != number:
        old_dir = f"{upload_dir}/{project.code}/{old_number}"
        new_dir = f"{upload_dir}/{project.code}/{number}"
        if os.path.exists(old_dir):
            os.rename(old_dir, new_dir)

    return {"project": project, "chapter": chapter}


def delete_chapter_primary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    project = db.query(models.Project).filter(models.Project.id == project_id).first()

    if not chapter or not project:
        return {"project": project, "chapter": chapter}

    chapter_dir = f"{upload_dir}/{project.code}/{chapter.number}"
    if os.path.exists(chapter_dir):
        shutil.rmtree(chapter_dir)

    db.delete(chapter)
    db.commit()
    return {"project": project, "chapter": chapter}


def delete_chapter_secondary(db: Session, *, project_id: int, chapter_id: int, upload_dir: str):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()

    if not chapter:
        return {"project": project, "chapter": chapter}

    chapter_path = f"{upload_dir}/{project.code}/{chapter.number}"
    if os.path.exists(chapter_path):
        shutil.rmtree(chapter_path, ignore_errors=True)

    db.delete(chapter)
    db.commit()
    return {"project": project, "chapter": chapter}
