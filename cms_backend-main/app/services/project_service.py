from sqlalchemy.orm import Session
from app import models, schemas

def create_project(db: Session, project: schemas.ProjectCreate):
    db_project = models.Project(**project.dict(), status="RECEIVED")
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
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
