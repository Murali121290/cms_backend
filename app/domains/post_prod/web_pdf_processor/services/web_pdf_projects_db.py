import zoneinfo
from datetime import datetime, timezone
from typing import Any, Optional
from sqlalchemy.orm import Session
from ..models import WebPdfProject, WebPdfHistory

_KOLKATA_TZ = zoneinfo.ZoneInfo("Asia/Kolkata")


def _iso_utc(dt_val: Optional[datetime]) -> Optional[str]:
    if not dt_val:
        return None
    # Timestamps in the PostgreSQL DB are recorded in local Asia/Kolkata time without tzinfo.
    # We attach the local timezone and convert to UTC before sending to frontend.
    if dt_val.tzinfo is None:
        dt_val = dt_val.replace(tzinfo=_KOLKATA_TZ)
    return dt_val.astimezone(timezone.utc).isoformat()


def _get_project_timeline_meta(db: Session, project_ids: list[int]) -> dict[int, dict[str, Optional[str]]]:
    if not project_ids:
        return {}
    from sqlalchemy import text
    query = text("""
        SELECT 
            p.id,
            COALESCE(
                (SELECT max(h.created_at) FROM post_prod_web_pdf_history h WHERE h.project_id = p.id AND h.result_type = 'assignee_change' AND h.new_assignee IS NOT NULL),
                CASE WHEN p.assignee IS NOT NULL THEN p.uploaded_at ELSE NULL END
            ) as assigned_at,
            (SELECT min(h.created_at) FROM post_prod_web_pdf_history h WHERE h.project_id = p.id AND h.result_type != 'assignee_change') as started_at,
            CASE 
                WHEN p.status IN ('Glossary Linked', 'Completed') 
                     OR EXISTS (SELECT 1 FROM post_prod_web_pdf_history h WHERE h.project_id = p.id AND h.result_type IN ('glossary_links', 'final_validation'))
                THEN (SELECT max(h.created_at) FROM post_prod_web_pdf_history h WHERE h.project_id = p.id AND h.result_type IN ('glossary_links', 'final_validation'))
                ELSE NULL
            END as completed_at
        FROM post_prod_web_pdf_projects p
        WHERE p.id IN :ids
    """)
    rows = db.execute(query.bindparams(ids=tuple(project_ids))).fetchall()
    result = {}
    for r in rows:
        result[r[0]] = {
            "assigned_at": _iso_utc(r[1]),
            "started_at": _iso_utc(r[2]),
            "completed_at": _iso_utc(r[3]),
        }
    return result


def _serialize(p: WebPdfProject, meta: Optional[dict[str, Optional[str]]] = None) -> dict[str, Any]:
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
        "uploaded_at": _iso_utc(p.uploaded_at),
        "updated_at": _iso_utc(p.updated_at),
        "assigned_at": meta.get("assigned_at") if meta else None,
        "started_at": meta.get("started_at") if meta else None,
        "completed_at": meta.get("completed_at") if meta else None,
    }


def list_projects(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.is_deleted.is_(False))
        .order_by(WebPdfProject.uploaded_at.desc())
        .all()
    )
    p_ids = [p.id for p in rows]
    meta_map = _get_project_timeline_meta(db, p_ids)
    return [_serialize(p, meta_map.get(p.id)) for p in rows]


def get_project_by_id(db: Session, project_id: int) -> Optional[dict[str, Any]]:
    p = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.id == project_id, WebPdfProject.is_deleted.is_(False))
        .first()
    )
    if not p:
        return None
    meta_map = _get_project_timeline_meta(db, [p.id])
    return _serialize(p, meta_map.get(p.id))


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
    assignee: Optional[str] = None,
) -> dict[str, Any]:
    # Purge any old soft-deleted project records matching folder_name or project_name
    db.query(WebPdfProject).filter(
        (WebPdfProject.folder_name == folder_name) | (WebPdfProject.project_name == project_name),
        WebPdfProject.is_deleted.is_(True),
    ).delete(synchronize_session=False)

    now = datetime.now(timezone.utc)
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
                created_at=datetime.now(timezone.utc),
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


def hard_delete_project(db: Session, *, project_id: int) -> bool:
    p = (
        db.query(WebPdfProject)
        .filter(WebPdfProject.id == project_id)
        .first()
    )
    if p is None:
        return False
    db.delete(p)
    db.commit()
    return True


def record_step_completion(
    db: Session,
    *,
    project_id: int,
    step_name: str,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    status: str = "success",
    details: Optional[dict] = None,
) -> WebPdfHistory:
    """Record completion of any workflow step with analysis details."""
    history = WebPdfHistory(
        project_id=project_id,
        changed_by_id=user_id,
        changed_by_username=username,
        result_type=step_name,
        created_at=datetime.now(timezone.utc),
        merge_status=status,
        details=details,
    )
    db.add(history)
    db.commit()
    db.refresh(history)
    return history


def record_merge_history(
    db: Session,
    *,
    project_id: int,
    user_id: Optional[int],
    username: Optional[str],
    merged_files: list,
    merged_output_path: str,
    total_pages: int,
    merge_status: str,
    details: Optional[dict] = None,
) -> WebPdfHistory:
    history = WebPdfHistory(
        project_id=project_id,
        changed_by_id=user_id,
        changed_by_username=username,
        result_type="merge",
        created_at=datetime.now(timezone.utc),
        merged_files=merged_files,
        merged_output_path=merged_output_path,
        total_pages=total_pages,
        merge_status=merge_status,
        details=details,
    )
    db.add(history)
    db.commit()
    db.refresh(history)
    return history
