import os
from typing import Optional, Any
from fastapi import APIRouter, Depends, Form, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime

from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.rbac_config import has_post_prod_access

from .models import WebPdfProject
from .services import web_pdf_projects_db
from .services.upload_service import process_upload
from .services.merge_service import categorize_file, merge_pdfs


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
        assignee=None,
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


@router.get("/projects/{project_id}/files")
def get_project_files(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    extract_dir = os.path.join(project["folder_name"], "extract")
    if not os.path.isdir(extract_dir):
        return []
    
    files_list = []
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if f.lower().endswith(".pdf") and not f.startswith("._"):
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, extract_dir)
                category, order = categorize_file(full_path)
                files_list.append({
                    "filename": f,
                    "relative_path": rel_path,
                    "absolute_path": full_path,
                    "category": category,
                    "order": order,
                    "size": os.path.getsize(full_path)
                })
                
    # Sort by suggested order
    files_list.sort(key=lambda x: (x["order"], x["filename"]))
    return files_list


class MergeFile(BaseModel):
    filename: str
    absolute_path: str
    category: str


class MergeRequest(BaseModel):
    files: list[MergeFile]


@router.post("/projects/{project_id}/merge")
def merge_project_files(
    project_id: int,
    body: MergeRequest,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project_obj = db.query(WebPdfProject).filter(
        WebPdfProject.id == project_id,
        WebPdfProject.is_deleted.is_(False)
    ).first()
    if not project_obj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Extract absolute paths for merge operation
    file_paths = [f.absolute_path for f in body.files]
    merged_output_path = os.path.join(project_obj.folder_name, "merged.pdf")

    # Perform merge
    result = merge_pdfs(file_paths, merged_output_path)

    # Record merge history
    merged_files_data = [
        {"filename": f.filename, "category": f.category, "absolute_path": f.absolute_path}
        for f in body.files
    ]

    if result['success']:
        web_pdf_projects_db.record_merge_history(
            db,
            project_id=project_id,
            user_id=user.id if user else None,
            username=user.username if user else None,
            merged_files=merged_files_data,
            merged_output_path=merged_output_path,
            total_pages=result['total_pages'],
            merge_status="success",
            error_message=None,
        )
        project_obj.status = "Merged"
        project_obj.validation_status = "pass"
        db.commit()
        return {"message": "PDF files merged successfully", "merged_path": merged_output_path}
    else:
        web_pdf_projects_db.record_merge_history(
            db,
            project_id=project_id,
            user_id=user.id if user else None,
            username=user.username if user else None,
            merged_files=merged_files_data,
            merged_output_path=merged_output_path,
            total_pages=0,
            merge_status="failed",
            error_message=result.get('error'),
        )
        raise HTTPException(status_code=500, detail=f"Failed to merge PDF files: {result.get('error', 'Unknown error')}")


@router.get("/projects/{project_id}/merged-pdf")
def get_merged_pdf(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    merged_path = os.path.join(project["folder_name"], "merged.pdf")
    if not os.path.exists(merged_path):
        raise HTTPException(status_code=404, detail="Merged PDF not found. Please merge files first.")

    return FileResponse(merged_path, media_type="application/pdf")


def _serialize_history(h: Any) -> dict:
    return {
        "id": h.id,
        "project_id": h.project_id,
        "changed_by_id": h.changed_by_id,
        "changed_by_username": h.changed_by_username,
        "old_assignee": h.old_assignee,
        "new_assignee": h.new_assignee,
        "result_type": h.result_type,
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "merged_files": h.merged_files,
        "merged_output_path": h.merged_output_path,
        "total_pages": h.total_pages,
        "merge_status": h.merge_status,
        "error_message": h.error_message,
    }


@router.get("/projects/{project_id}/merge-history")
def get_merge_history(
    project_id: int,
    db: Session = Depends(get_db),
    user=Depends(check_post_prod_access),
):
    """Get all merge history records for a project."""
    project = web_pdf_projects_db.get_project_by_id(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from .models import WebPdfHistory
    history_rows = (
        db.query(WebPdfHistory)
        .filter(WebPdfHistory.project_id == project_id, WebPdfHistory.result_type == "merge")
        .order_by(WebPdfHistory.created_at.desc())
        .all()
    )
    return [_serialize_history(h) for h in history_rows]

