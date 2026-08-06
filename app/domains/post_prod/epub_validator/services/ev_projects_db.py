"""DB helpers for EvProject (post_prod_ev_projects table)."""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import EvProject, EvHistory


def _serialize(p: EvProject) -> dict[str, Any]:
    return {
        "id": p.id,
        "client": p.client,
        "client_code": p.client_code,
        "project_name": p.project_name,
        "folder_name": p.folder_name,
        "epub_path": p.epub_path,
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
        db.query(EvProject)
        .filter(EvProject.is_deleted.is_(False))
        .order_by(EvProject.uploaded_at.desc())
        .all()
    )
    return [_serialize(p) for p in rows]


def get_project_by_id(db: Session, project_id: int) -> Optional[dict[str, Any]]:
    p = (
        db.query(EvProject)
        .filter(EvProject.id == project_id, EvProject.is_deleted.is_(False))
        .first()
    )
    return _serialize(p) if p else None


def get_project_by_folder(db: Session, folder_name: str) -> Optional[EvProject]:
    return (
        db.query(EvProject)
        .filter(EvProject.folder_name == folder_name, EvProject.is_deleted.is_(False))
        .first()
    )


def create_project(
    db: Session,
    *,
    client: str,
    client_code: Optional[str],
    project_name: str,
    folder_name: str,
    epub_path: str,
    total_files: int,
    user_id: Optional[int],
    assignee: Optional[str] = None,
) -> dict[str, Any]:
    # Purge any old soft-deleted project records matching folder_name or project_name
    db.query(EvProject).filter(
        (EvProject.folder_name == folder_name) | (EvProject.project_name == project_name),
        EvProject.is_deleted.is_(True),
    ).delete(synchronize_session=False)

    now = datetime.utcnow()
    project = EvProject(
        client=client,
        client_code=client_code,
        project_name=project_name,
        folder_name=folder_name,
        epub_path=epub_path,
        total_files=total_files,
        status="uploaded",
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
        db.query(EvProject)
        .filter(EvProject.id == project_id, EvProject.is_deleted.is_(False))
        .first()
    )
    if not p:
        return None
    if assignee is not None:
        target_val = assignee if assignee != "" else None
        if p.assignee != target_val:
            history = EvHistory(
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


def save_validation_run(
    db: Session,
    *,
    folder_name: str,
    validation_result: dict[str, Any],
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> None:
    """Save a full validation run snapshot as JSON to disk and record execution in DB."""
    import json
    import os
    from .upload_service import UPLOAD_DIR

    p = get_project_by_folder(db, folder_name)
    if p is None:
        return

    # Update project status fields
    files = validation_result.get("files", []) if isinstance(validation_result, dict) else []
    total_issues = sum(
        f.get("result", {}).get("issues_count", 0) for f in files if isinstance(f, dict)
    )
    val_status = "pass" if total_issues == 0 else "fail"
    p.validation_status = val_status
    p.status = "validated" if val_status == "pass" else "failed"

    # Determine assignee slug for filename: {assignee_name}_{timestamp}.json
    raw_assignee = (p.assignee or username or "unassigned").strip().replace(" ", "_")
    timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    val_filename = f"{raw_assignee}_{timestamp_str}.json"

    # Ensure project validations folder exists on disk
    val_dir = os.path.join(UPLOAD_DIR, folder_name, "validations")
    os.makedirs(val_dir, exist_ok=True)

    # Save JSON file on disk
    val_file_path = os.path.join(val_dir, val_filename)
    with open(val_file_path, "w", encoding="utf-8") as f:
        json.dump(validation_result, f, indent=2)

    p.latest_validation_file = val_filename

    history = EvHistory(
        project_id=p.id,
        changed_by_id=user_id,
        changed_by_username=username,
        old_assignee=p.assignee,
        new_assignee=p.assignee,
        result_type="validation",
        created_at=datetime.utcnow(),
    )
    db.add(history)
    db.commit()


def get_latest_validation_run(
    db: Session,
    folder_name: str,
) -> Optional[dict[str, Any]]:
    """Retrieve the latest stored validation result payload from disk."""
    import glob
    import json
    import os
    from .upload_service import UPLOAD_DIR

    p = get_project_by_folder(db, folder_name)
    if p is None:
        return None

    val_dir = os.path.join(UPLOAD_DIR, folder_name, "validations")

    # Fast path: read the file specified in latest_validation_file column
    if p.latest_validation_file:
        file_path = os.path.join(val_dir, p.latest_validation_file)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass

    # Fallback: find newest *.json file under validations directory
    pattern = os.path.join(val_dir, "*.json")
    files = glob.glob(pattern)
    if not files:
        return None

    files.sort(key=os.path.getmtime, reverse=True)
    try:
        with open(files[0], "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def update_validation_status(
    db: Session,
    *,
    folder_name: str,
    validation_status: str,
) -> None:
    """Called by the validator/ACE routes after a run completes."""
    p = get_project_by_folder(db, folder_name)
    if p is None:
        return
    p.validation_status = validation_status
    p.status = "validated" if validation_status == "pass" else "failed"
    db.commit()


def soft_delete_project(db: Session, *, project_id: int, user_id: Optional[int]) -> bool:
    p = (
        db.query(EvProject)
        .filter(EvProject.id == project_id, EvProject.is_deleted.is_(False))
        .first()
    )
    if p is None:
        return False
    p.is_deleted = True
    db.commit()
    return True
