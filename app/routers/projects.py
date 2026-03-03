from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app import database, schemas
from app.services import project_service
from app.rbac import require_role
from app.auth import get_current_user

router = APIRouter()

@router.post("/")
def create_project(
    data: schemas.ProjectCreate,
    db: Session = Depends(database.get_db),
    # Only ProjectManager can create projects
    user = Depends(require_role("ProjectManager")) 
):
    # require_role dependency already verifies the role and returns the user
    return project_service.create_project(db, data)

@router.get("/")
def read_projects(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(database.get_db),
    user = Depends(get_current_user)
):
    return project_service.get_projects(db, skip=skip, limit=limit)

@router.put("/{project_id}/status")
def update_project_status(
    project_id: int,
    status: str,
    db: Session = Depends(database.get_db),
    user = Depends(require_role("ProjectManager"))
):
    project = project_service.update_project_status(db, project_id, status)
    if not project:
         raise HTTPException(status_code=404, detail="Project not found")
    return project
