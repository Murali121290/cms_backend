from sqlalchemy.orm import Session

from app import models
from app.utils.timezone import now_ist_naive


def is_locked_by_other(file_record: models.File, actor_user_id: int):
    return file_record.is_checked_out and file_record.checked_out_by_id != actor_user_id


def checkout_file(db: Session, *, file_record: models.File, actor_user_id: int):
    if is_locked_by_other(file_record, actor_user_id):
        return {"status": "locked_by_other", "file": file_record}

    file_record.is_checked_out = True
    file_record.checked_out_by_id = actor_user_id
    file_record.checked_out_at = now_ist_naive()
    db.commit()
    return {"status": "checked_out", "file": file_record}


def cancel_checkout(db: Session, *, file_record: models.File, actor_user_id: int):
    if file_record.is_checked_out and file_record.checked_out_by_id == actor_user_id:
        file_record.is_checked_out = False
        file_record.checked_out_by_id = None
        db.commit()
    return file_record


def reset_checkout_after_overwrite(file_record: models.File):
    file_record.is_checked_out = False
    file_record.checked_out_by_id = None
    return file_record
