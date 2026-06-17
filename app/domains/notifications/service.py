from sqlalchemy.orm import Session

from app import models
from app.utils.timezone import now_ist_naive


def _format_relative_time(timestamp):
    delta = now_ist_naive() - timestamp
    if delta.days > 0:
        return f"{delta.days}d ago"
    if delta.seconds > 3600:
        return f"{delta.seconds // 3600}h ago"
    if delta.seconds > 60:
        return f"{delta.seconds // 60}m ago"
    return "Just now"


def get_recent_upload_notifications(db: Session, *, limit: int = 5):
    recent_files = db.query(models.File).order_by(models.File.uploaded_at.desc()).limit(limit).all()

    return [
        {
            "title": "File Uploaded",
            "desc": file_record.filename,
            "time": _format_relative_time(file_record.uploaded_at),
            "icon": "fa-file-upload",
            "color": "text-primary",
        }
        for file_record in recent_files
    ]
