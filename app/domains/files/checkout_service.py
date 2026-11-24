"""Backwards-compatible wrappers over lock_service (download-with-lock check-out / check-in)."""
from sqlalchemy.orm import Session

from app import models
from app.domains.files import lock_service


def is_locked_by_other(file_record: models.File, actor_user_id: int):
    return lock_service.is_locked_by_other(file_record, actor_user_id)


def checkout_file(db: Session, *, file_record: models.File, actor_user_id: int):
    if is_locked_by_other(file_record, actor_user_id):
        return {"status": "locked_by_other", "file": file_record}
    user = db.get(models.User, actor_user_id)
    lock_service.acquire(db, file_record, user, lock_service.DOWNLOAD, check_write=False)
    return {"status": "checked_out", "file": file_record}


def cancel_checkout(db: Session, *, file_record: models.File, actor_user_id: int):
    if file_record.is_checked_out and file_record.checked_out_by_id == actor_user_id \
            and file_record.lock_kind != lock_service.PROCESSING:
        user = db.get(models.User, actor_user_id)
        lock_service.release(db, file_record, user, lock_service.CANCELLED)
    return file_record


def reset_checkout_after_overwrite(file_record: models.File, db: Session | None = None, user: models.User | None = None):
    """The lock holder uploaded over the file: close their session as checked_in (time + new version)."""
    if db is not None and user is not None:
        lock_service.checkin_after_upload(db, file_record, user)
        return file_record
    if file_record.lock_kind != lock_service.PROCESSING:
        file_record.is_checked_out = False
        file_record.checked_out_by_id = None
        file_record.checked_out_at = None
        file_record.lock_kind = None
        file_record.active_lock_session_id = None
    return file_record
