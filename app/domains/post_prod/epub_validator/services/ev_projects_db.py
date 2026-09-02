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
        "eisbn": getattr(p, "eisbn", None),
        "copyright_year": getattr(p, "copyright_year", None),
        "uploaded_by_id": p.uploaded_by_id,
        "uploaded_at": p.uploaded_at.isoformat() if p.uploaded_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "file_mappings": getattr(p, "file_mappings", None),
    }


def _ensure_columns_exist(db: Session) -> None:
    """Ensure eisbn and copyright_year columns exist on post_prod_ev_projects table."""
    try:
        from sqlalchemy import text
        db.execute(text("ALTER TABLE post_prod_ev_projects ADD COLUMN IF NOT EXISTS eisbn VARCHAR(100);"))
        db.execute(text("ALTER TABLE post_prod_ev_projects ADD COLUMN IF NOT EXISTS copyright_year VARCHAR(50);"))
        db.commit()
    except Exception:
        db.rollback()


def list_projects(db: Session) -> list[dict[str, Any]]:
    _ensure_columns_exist(db)
    rows = (
        db.query(EvProject)
        .filter(EvProject.is_deleted.is_(False))
        .order_by(EvProject.uploaded_at.desc())
        .all()
    )
    return [_serialize(p) for p in rows]


def get_project_by_id(db: Session, project_id: int) -> Optional[dict[str, Any]]:
    _ensure_columns_exist(db)
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
    eisbn: Optional[str] = None,
    copyright_year: Optional[str] = None,
) -> dict[str, Any]:
    _ensure_columns_exist(db)
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
        eisbn=eisbn,
        copyright_year=copyright_year,
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
    eisbn: Optional[str] = None,
    copyright_year: Optional[str] = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    _ensure_columns_exist(db)
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
    if eisbn is not None:
        p.eisbn = eisbn.strip() if eisbn.strip() else None
    if copyright_year is not None:
        p.copyright_year = copyright_year.strip() if copyright_year.strip() else None
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
    target_file: Optional[str] = None,
) -> None:
    """Save a full or partial validation run snapshot as JSON to disk and record execution in DB."""
    import json
    import os
    import glob
    from datetime import datetime
    from .upload_service import UPLOAD_DIR

    p = get_project_by_folder(db, folder_name)
    if p is None:
        return

    val_dir = os.path.join(UPLOAD_DIR, folder_name, "validations")
    os.makedirs(val_dir, exist_ok=True)

    if target_file:
        # Sanitize target_file to be used as a filename
        safe_target = target_file.replace("/", "__").replace("\\", "__")
        val_filename = f"{safe_target}.json"
        val_file_path = os.path.join(val_dir, val_filename)
        with open(val_file_path, "w", encoding="utf-8") as f:
            json.dump(validation_result, f, indent=2)
    else:
        # Clear out existing JSON files for an overall validation
        for old_file in glob.glob(os.path.join(val_dir, "*.json")):
            try:
                os.remove(old_file)
            except Exception:
                pass

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
        result_type="partial_validation" if target_file else "validation",
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
    base_result = None

    # Fast path: read the file specified in latest_validation_file column
    if p.latest_validation_file:
        file_path = os.path.join(val_dir, p.latest_validation_file)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    base_result = json.load(f)
            except Exception:
                pass

    # Fallback: find newest *.json file under validations directory
    if not base_result:
        pattern = os.path.join(val_dir, "*.json")
        files = glob.glob(pattern)
        # Avoid picking up individual target_file.json files as the base if possible
        overall_files = [f for f in files if "_" in os.path.basename(f) and not os.path.basename(f).endswith(".xhtml.json") and not os.path.basename(f).endswith(".html.json")]
        if overall_files:
            overall_files.sort(key=os.path.getmtime, reverse=True)
            try:
                with open(overall_files[0], "r", encoding="utf-8") as f:
                    base_result = json.load(f)
            except Exception:
                pass

    if not base_result:
        # If there's no baseline, start with an empty shell so we can still display partial validations
        base_result = {
            "folder": folder_name,
            "customer": p.client_code or p.client,
            "epub_path": p.epub_path,
            "files": []
        }

    # Merge individual file validation overrides dynamically
    pattern = os.path.join(val_dir, "*.json")
    all_files = glob.glob(pattern)
    individual_files = [f for f in all_files if os.path.basename(f) != p.latest_validation_file and (f.endswith(".xhtml.json") or f.endswith(".html.json") or f.endswith(".json"))]
    
    # Only keep the individual files that are NOT the baseline itself (or other baselines)
    # We identify them by the fact that they don't have a date timestamp like _20260818_
    # To be safer, we just exclude the latest_validation_file. But what if there are old baselines?
    # Old baselines should have been deleted by Validate All. If they exist, they might corrupt the merge.
    # A safe heuristic: individual files contain "xhtml" or "html" in their names usually. 
    # For now we'll process all files that don't look like assignee_timestamp.json
    
    if individual_files:
        base_files = base_result.get("files", [])
        
        for ind_file in individual_files:
            # Skip old overall validations (which look like "admin_hema_YYYYMMDD_HHMMSS.json")
            import re
            if re.search(r"_\d{8}_\d{6}\.json$", os.path.basename(ind_file)):
                continue

            try:
                with open(ind_file, "r", encoding="utf-8") as f:
                    ind_data = json.load(f)
                    
                    if isinstance(ind_data, dict) and "files" in ind_data and ind_data["files"]:
                        # Find the target_file_name from the first rule result
                        first_rule = ind_data["files"][0]
                        target_file_name = first_rule.get("file_details", {}).get("file_name")
                        
                        if target_file_name:
                            # Remove old rule results for this specific file from base_result
                            base_files = [
                                rule for rule in base_files
                                if rule.get("file_details", {}).get("file_name") != target_file_name
                            ]
                            # Append the new rule results for this file
                            base_files.extend(ind_data["files"])
            except Exception:
                pass
                
        base_result["files"] = base_files

    return base_result


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

def hard_delete_project(db: Session, *, project_id: int) -> bool:
    p = db.query(EvProject).filter(EvProject.id == project_id).first()
    if p is None:
        return False
    db.query(EvHistory).filter(EvHistory.project_id == project_id).delete()
    db.delete(p)
    db.commit()
    return True
