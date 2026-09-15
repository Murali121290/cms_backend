import os
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app import models


import logging

logger = logging.getLogger("app.domains.files.version_service")


def archive_existing_file(
    db: Session,
    *,
    existing_file: models.File,
    base_path: str,
    uploaded_by_id: int,
    source_path: str | None = None,
    reason: str | None = None,
):
    from app.services.file_service import UPLOAD_DIR

    # Ensure base_path is absolute anchored at UPLOAD_DIR
    if not base_path:
        base_path = UPLOAD_DIR
    elif not os.path.isabs(base_path):
        base_path = os.path.abspath(os.path.join(UPLOAD_DIR, base_path))

    archive_dir = os.path.join(base_path, "Archive")
    os.makedirs(archive_dir, exist_ok=True)

    old_version_num = existing_file.version or 1
    old_ext = existing_file.filename.split(".")[-1] if "." in existing_file.filename else ""
    name_only = existing_file.filename.rsplit(".", 1)[0]
    archived_name = f"{name_only}_v{old_version_num}.{old_ext}" if old_ext else f"{name_only}_v{old_version_num}"
    archived_path = os.path.join(archive_dir, archived_name)

    actual_source = source_path
    if not actual_source and existing_file.path:
        if os.path.isabs(existing_file.path):
            actual_source = existing_file.path
        else:
            cand1 = os.path.abspath(os.path.join(UPLOAD_DIR, existing_file.path))
            cand2 = os.path.abspath(os.path.join(base_path, os.path.basename(existing_file.path)))
            if os.path.exists(cand1):
                actual_source = cand1
            elif os.path.exists(cand2):
                actual_source = cand2
            else:
                actual_source = cand1

    if actual_source and os.path.exists(actual_source):
        try:
            shutil.copy2(actual_source, archived_path)
        except Exception as copy_err:
            logger.warning(f"Could not copy file to archive {archived_path}: {copy_err}")

    version_entry = models.FileVersion(
        file_id=existing_file.id,
        version_num=old_version_num,
        path=archived_path,
        uploaded_by_id=uploaded_by_id,
        reason=reason,
    )
    db.add(version_entry)
    return version_entry


def get_versions_for_file(db: Session, *, file_id: int, limit: int = 50):
    return (
        db.query(models.FileVersion)
        .filter(models.FileVersion.file_id == file_id)
        .order_by(models.FileVersion.version_num.desc())
        .limit(limit)
        .all()
    )


def get_version_for_download(db: Session, *, file_id: int, version_id: int):
    version_entry = (
        db.query(models.FileVersion)
        .filter(
            models.FileVersion.file_id == file_id,
            models.FileVersion.id == version_id,
        )
        .first()
    )
    if not version_entry or not version_entry.path or not os.path.exists(version_entry.path):
        return None
    return version_entry


def get_archived_filename(version_entry: models.FileVersion):
    return Path(version_entry.path).name
