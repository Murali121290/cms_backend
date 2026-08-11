from datetime import datetime
from typing import Any, Optional
from sqlalchemy.orm import Session
from ..models import WebPdfProject, WebPdfHistory


def _serialize(p: WebPdfProject) -> dict[str, Any]:
    return {
        "id": p.id,
        "client": p.client,
        "client_code": p.client_code,
        "project_name": p.project_name,
        "folder_name": p.folder_name,
        "pdf_path": p.pdf_path,
        "total_files": p.total_files,
        "status": p.status,
        "validation_status": p.validation_status,
        "latest_validation_file": p.latest_validation_file,
        "assignee": p.assignee,
        "uploaded_by_id": p.uploaded_by_id,
        "uploaded_at": p.uploaded_at.isoformat() if p.uploaded_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def list_projects(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.is_deleted.is_(False))
        .order_by(WebPdfProject.uploaded_at.desc())
        .all()
    )
    return [_serialize(p) for p in rows]


def get_project_by_id(db: Session, project_id: int) -> Optional[dict[str, Any]]:
    p = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.id == project_id, WebPdfProject.is_deleted.is_(False))
        .first()
    )
    return _serialize(p) if p else None


def get_project_by_folder(db: Session, folder_name: str) -> Optional[WebPdfProject]:
    return (
        db.query(WebPdfProject)
        .filter(WebPdfProject.folder_name == folder_name, WebPdfProject.is_deleted.is_(False))
        .first()
    )


def create_project(
    db: Session,
    *,
    client: str,
    client_code: Optional[str],
    project_name: str,
    folder_name: str,
    pdf_path: str,
    total_files: int,
    user_id: Optional[int],
    assignee: Optional[str] = "admin_hema",
) -> dict[str, Any]:
    # Purge any old soft-deleted project records matching folder_name or project_name
    db.query(WebPdfProject).filter(
        (WebPdfProject.folder_name == folder_name) | (WebPdfProject.project_name == project_name),
        WebPdfProject.is_deleted.is_(True),
    ).delete(synchronize_session=False)

    now = datetime.utcnow()
    project = WebPdfProject(
        client=client,
        client_code=client_code,
        project_name=project_name,
        folder_name=folder_name,
        pdf_path=pdf_path,
        total_files=total_files,
        status="Active",
        validation_status=None,
        assignee=assignee,
        uploaded_by_id=user_id,
        uploaded_at=now,
        updated_at=now,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _serialize(project)


def update_project(
    db: Session,
    project_id: int,
    *,
    assignee: Optional[str] = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    p = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.id == project_id, WebPdfProject.is_deleted.is_(False))
        .first()
    )
    if not p:
        return None
    if assignee is not None:
        target_val = assignee if assignee != "" else None
        if p.assignee != target_val:
            history = WebPdfHistory(
                project_id=p.id,
                changed_by_id=user_id,
                changed_by_username=username,
                old_assignee=p.assignee,
                new_assignee=target_val,
                result_type="assignee_change",
                created_at=datetime.utcnow(),
            )
            db.add(history)
            p.assignee = target_val
    db.commit()
    db.refresh(p)
    return _serialize(p)


def soft_delete_project(db: Session, *, project_id: int) -> bool:
    p = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.id == project_id, WebPdfProject.is_deleted.is_(False))
        .first()
    )
    if p is None:
        return False
    p.is_deleted = True
    db.commit()
    return True
