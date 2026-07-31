"""One-time importer: uploads/epub_validator/books.json → epub_validator_books.

Idempotent — skips rows whose folder_name already exists in the DB. Runs a
single "upload" backfill event per imported row with user_id=NULL.

Usage:
    source .venv/bin/activate
    set -a && source .env && source .env.local && set +a
    python scripts/import_books_json.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Allow running as `python scripts/import_books_json.py` from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.domains.post_prod.epub_validator.models import EpubBook, EpubBookEvent  # noqa: E402


BOOKS_FILE = Path(os.environ.get("BOOKS_FILE", "uploads/epub_validator/books.json"))


def _parse_uploaded_at(value) -> datetime:
    if not value:
        return datetime.utcnow()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.utcnow()


def main() -> int:
    if not BOOKS_FILE.exists():
        print(f"Nothing to import: {BOOKS_FILE} does not exist.")
        return 0

    try:
        raw = json.loads(BOOKS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Failed to parse {BOOKS_FILE}: {e}", file=sys.stderr)
        return 1

    if not isinstance(raw, list):
        print(f"Expected a list in {BOOKS_FILE}, got {type(raw).__name__}", file=sys.stderr)
        return 1

    imported = 0
    skipped = 0
    db = SessionLocal()
    try:
        for entry in raw:
            folder_name = (entry or {}).get("folder_name")
            if not folder_name:
                skipped += 1
                continue

            existing = db.query(EpubBook).filter(EpubBook.folder_name == folder_name).first()
            if existing:
                skipped += 1
                continue

            uploaded_at = _parse_uploaded_at(entry.get("uploaded_at"))
            book = EpubBook(
                folder_name=folder_name,
                epub_path=entry.get("epub_path") or "",
                total_files=int(entry.get("total_files") or 0),
                status="uploaded",
                uploaded_at=uploaded_at,
                updated_at=uploaded_at,
            )
            db.add(book)
            db.flush()
            db.add(
                EpubBookEvent(
                    book_id=book.id,
                    user_id=None,
                    action="upload",
                    changes={"source": "books.json backfill", "raw": entry},
                    created_at=uploaded_at,
                )
            )
            imported += 1
        db.commit()
    finally:
        db.close()

    print(f"Imported {imported}, skipped {skipped} (already present or invalid).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
