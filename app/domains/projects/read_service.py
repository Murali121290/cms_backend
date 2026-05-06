from sqlalchemy.orm import Session

from app import models
from app.services import project_service


def get_projects_page_data(db: Session, *, skip: int = 0, limit: int = 100):
    return {"projects": project_service.get_projects(db, skip=skip, limit=limit)}


def get_project_chapters_page_data(db: Session, project_id: int):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        return {"project": None, "chapters": []}

    processed_chapters = []
    for chapter in project.chapters:
        chapter.has_art = any(file_record.category == "Art" for file_record in chapter.files)
        chapter.has_ms = any(file_record.category == "Manuscript" for file_record in chapter.files)
        chapter.has_ind = any(file_record.category == "InDesign" for file_record in chapter.files)
        chapter.has_proof = any(file_record.category == "Proof" for file_record in chapter.files)
        chapter.has_xml = any(file_record.category == "XML" for file_record in chapter.files)
        processed_chapters.append(chapter)

    return {"project": project, "chapters": processed_chapters}


def get_chapter_detail_page_data(db: Session, project_id: int, chapter_id: int):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    files = db.query(models.File).filter(models.File.chapter_id == chapter_id).all()

    return {
        "project": project,
        "chapter": chapter,
        "files": files,
    }
