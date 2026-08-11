from typing import Optional
from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.rbac_config import has_post_prod_access

from .services import web_pdf_projects_db
from .services.upload_service import process_upload


def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(
            status_code=403, detail="Access denied to Post Production / Backlist."
        )
    return user


router = APIRouter(
    prefix="/post-prod/web-pdf-processor",
    tags=["Web PDF Processor"],
)


@router.get("/health")
def health_check():
    return {"status": "healthy"}


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """List all non-deleted Web PDF projects."""
    return web_pdf_projects_db.list_projects(db)


@router.post("/projects")
async def create_project(
    client: str = Form(...),
    client_code: str = Form(""),
    project_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    # Check if an active project with the same name already exists
    existing = web_pdf_projects_db.get_project_by_folder(db, project_name.strip())
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Project name '{project_name.strip()}' is already taken."
        )

    result = await process_upload(
        file=file,
        client_code=client_code,
        project_name=project_name,
    )

    if not result.get("status"):
        raise HTTPException(status_code=400, detail=result.get("message", "Upload failed"))

    project = web_pdf_projects_db.create_project(
        db,
        client=client,
        client_code=client_code or None,
        project_name=project_name,
        folder_name=result["folder_name"],
        pdf_path=result["pdf_path"],
        total_files=result.get("total_files", 0),
        user_id=user.id if user else None,
        assignee="admin_hema",
    )
    return {"message": "Project created successfully", "project": project}


class ProjectUpdateRequest(BaseModel):
    assignee: Optional[str] = None


@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    updated = web_pdf_projects_db.update_project(
        db,
        project_id,
        assignee=body.assignee,
        user_id=user.id if user else None,
        username=user.username if user else None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    success = web_pdf_projects_db.soft_delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project deleted successfully"}
