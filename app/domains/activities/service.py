from datetime import timedelta

from sqlalchemy.orm import Session

from app import models
from app.domains.notifications.service import _format_relative_time
from app.utils.timezone import now_ist_naive


def get_recent_activities(db: Session, *, file_limit: int = 50, version_limit: int = 50):
    recent_files = db.query(models.File).order_by(models.File.uploaded_at.desc()).limit(file_limit).all()
    recent_versions = (
        db.query(models.FileVersion).order_by(models.FileVersion.uploaded_at.desc()).limit(version_limit).all()
    )

    activities = []

    for file_record in recent_files:
        project = db.query(models.Project).filter(models.Project.id == file_record.project_id).first()
        chapter = db.query(models.Chapter).filter(models.Chapter.id == file_record.chapter_id).first()

        activities.append(
            {
                "type": "upload",
                "title": "File Uploaded",
                "description": file_record.filename,
                "project": project.title if project else "Unknown",
                "chapter": chapter.title if chapter else "Unknown",
                "category": file_record.category,
                "time": _format_relative_time(file_record.uploaded_at),
                "timestamp": file_record.uploaded_at,
                "icon": "fa-file-upload",
                "color": "text-primary",
            }
        )

    for version_record in recent_versions:
        file_record = db.query(models.File).filter(models.File.id == version_record.file_id).first()
        if not file_record:
            continue

        project = db.query(models.Project).filter(models.Project.id == file_record.project_id).first()
        chapter = db.query(models.Chapter).filter(models.Chapter.id == file_record.chapter_id).first()

        activities.append(
            {
                "type": "version",
                "title": "File Processed",
                "description": f"{file_record.filename} (v{version_record.version_num})",
                "project": project.title if project else "Unknown",
                "chapter": chapter.title if chapter else "Unknown",
                "category": file_record.category,
                "time": _format_relative_time(version_record.uploaded_at),
                "timestamp": version_record.uploaded_at,
                "icon": "fa-cogs",
                "color": "text-success",
            }
        )

    activities.sort(key=lambda activity: activity["timestamp"], reverse=True)

    today_cutoff = now_ist_naive() - timedelta(days=1)
    today_count = sum(1 for activity in activities if activity["timestamp"] > today_cutoff)

    return activities, today_count
