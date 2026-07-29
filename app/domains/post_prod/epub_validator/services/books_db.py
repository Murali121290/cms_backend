from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import EpubBook, EpubBookEvent


def _serialize(book: EpubBook) -> dict[str, Any]:
    """Legacy shape the frontend already consumes, plus new fields (additive)."""
    return {
        "folder_name": book.folder_name,
        "epub_path": book.epub_path,
        "uploaded_at": book.uploaded_at.date().isoformat() if book.uploaded_at else None,
        "total_files": book.total_files,
        "title": book.title,
        "customer": book.customer,
        "status": book.status,
        "validation_status": book.validation_status,
        "uploaded_by_id": book.uploaded_by_id,
    }


def _record_event(
    db: Session,
    *,
    book_id: int,
    user_id: Optional[int],
    action: str,
    changes: Optional[dict[str, Any]] = None,
) -> None:
    db.add(EpubBookEvent(book_id=book_id, user_id=user_id, action=action, changes=changes))


def list_books(db: Session) -> list[dict[str, Any]]:
    rows = (
        db.query(EpubBook)
        .filter(EpubBook.is_deleted.is_(False))
        .order_by(EpubBook.uploaded_at.desc())
        .all()
    )
    return [_serialize(b) for b in rows]


def upsert_book_upload(
    db: Session,
    *,
    folder_name: str,
    epub_path: str,
    total_files: int,
    user_id: Optional[int],
    customer: Optional[str] = None,
    title: Optional[str] = None,
) -> dict[str, Any]:
    book = (
        db.query(EpubBook)
        .filter(EpubBook.folder_name == folder_name)
        .first()
    )

    if book is None:
        book = EpubBook(
            folder_name=folder_name,
            epub_path=epub_path,
            total_files=total_files,
            customer=customer,
            title=title,
            uploaded_by_id=user_id,
            status="uploaded",
        )
        db.add(book)
        db.flush()
        _record_event(
            db,
            book_id=book.id,
            user_id=user_id,
            action="upload",
            changes={
                "folder_name": folder_name,
                "epub_path": epub_path,
                "total_files": total_files,
                "customer": customer,
                "title": title,
            },
        )
    else:
        diff: dict[str, dict[str, Any]] = {}
        if book.epub_path != epub_path:
            diff["epub_path"] = {"old": book.epub_path, "new": epub_path}
            book.epub_path = epub_path
        if book.total_files != total_files:
            diff["total_files"] = {"old": book.total_files, "new": total_files}
            book.total_files = total_files
        if title and book.title != title:
            diff["title"] = {"old": book.title, "new": title}
            book.title = title
        if customer and book.customer != customer:
            diff["customer"] = {"old": book.customer, "new": customer}
            book.customer = customer
        # A re-upload is a fresh upload event on the same folder; keep audit granularity.
        book.status = "uploaded"
        book.is_deleted = False
        _record_event(
            db,
            book_id=book.id,
            user_id=user_id,
            action="upload",
            changes=diff or {"note": "re-uploaded (no field changes)"},
        )

    db.commit()
    return _serialize(book)


def record_validation(
    db: Session,
    *,
    folder_name: str,
    user_id: Optional[int],
    validation_status: str,
    summary: Optional[dict[str, Any]] = None,
) -> None:
    book = (
        db.query(EpubBook)
        .filter(EpubBook.folder_name == folder_name, EpubBook.is_deleted.is_(False))
        .first()
    )
    if book is None:
        return

    old_status = book.validation_status
    book.validation_status = validation_status
    book.status = "validated"
    _record_event(
        db,
        book_id=book.id,
        user_id=user_id,
        action="validate",
        changes={
            "validation_status": {"old": old_status, "new": validation_status},
            **({"summary": summary} if summary else {}),
        },
    )
    db.commit()


def record_edit(
    db: Session,
    *,
    folder_name: str,
    user_id: Optional[int],
    file_path: str,
    bytes_written: Optional[int] = None,
) -> None:
    book = (
        db.query(EpubBook)
        .filter(EpubBook.folder_name == folder_name, EpubBook.is_deleted.is_(False))
        .first()
    )
    if book is None:
        return

    _record_event(
        db,
        book_id=book.id,
        user_id=user_id,
        action="edit",
        changes={"file_path": file_path, "bytes_written": bytes_written},
    )
    db.commit()


def soft_delete_book(
    db: Session,
    *,
    folder_name: str,
    user_id: Optional[int],
) -> bool:
    book = (
        db.query(EpubBook)
        .filter(EpubBook.folder_name == folder_name, EpubBook.is_deleted.is_(False))
        .first()
    )
    if book is None:
        return False

    book.is_deleted = True
    _record_event(db, book_id=book.id, user_id=user_id, action="delete")
    db.commit()
    return True


def get_events(db: Session, folder_name: str, limit: int = 100) -> list[dict[str, Any]]:
    book = db.query(EpubBook).filter(EpubBook.folder_name == folder_name).first()
    if book is None:
        return []
    rows = (
        db.query(EpubBookEvent)
        .filter(EpubBookEvent.book_id == book.id)
        .order_by(EpubBookEvent.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": e.id,
            "action": e.action,
            "user_id": e.user_id,
            "changes": e.changes,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows
    ]
