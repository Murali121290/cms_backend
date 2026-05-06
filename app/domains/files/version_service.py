import os
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app import models


def archive_existing_file(db: Session, *, existing_file: models.File, base_path: str, uploaded_by_id: int):
    archive_dir = f"{base_path}/Archive"
    os.makedirs(archive_dir, exist_ok=True)

    old_version_num = existing_file.version
    old_ext = existing_file.filename.split(".")[-1] if "." in existing_file.filename else ""
    name_only = existing_file.filename.rsplit(".", 1)[0]
    archived_name = f"{name_only}_v{old_version_num}.{old_ext}"
    archived_path = f"{archive_dir}/{archived_name}"

    if os.path.exists(existing_file.path):
        shutil.copy2(existing_file.path, archived_path)

    version_entry = models.FileVersion(
        file_id=existing_file.id,
        version_num=old_version_num,
        path=archived_path,
        uploaded_by_id=uploaded_by_id,
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
