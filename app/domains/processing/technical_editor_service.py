import os

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models


def scan_errors(
    db: Session,
    *,
    file_id: int,
    logger,
    technical_editor_cls,
):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        logger.error(f"Scan failed: File ID {file_id} not found in DB")
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.abspath(file_record.path)
    if not os.path.exists(file_path):
        logger.error(f"Scan failed: Physical file missing at {file_path}")
        raise HTTPException(status_code=404, detail=f"Physical file missing: {file_path}")

    try:
        editor = technical_editor_cls()
        return editor.scan(file_path)
    except Exception as exc:
        logger.error(f"Technical Scan Error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


def apply_edits(
    db: Session,
    *,
    file_id: int,
    replacements,
    username: str,
    logger,
    technical_editor_cls,
):
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    file_path = os.path.abspath(file_record.path)

    base = os.path.splitext(file_record.filename)[0]
    ext = os.path.splitext(file_record.filename)[1]
    output_filename = f"{base}_TechEdited{ext}"
    output_path = os.path.join(os.path.dirname(file_path), output_filename)

    try:
        editor = technical_editor_cls()
        editor.process(file_path, output_path, replacements, author=username)

        if os.path.exists(output_path):
            new_record = models.File(
                filename=output_filename,
                path=output_path,
                file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                project_id=file_record.project_id,
                chapter_id=file_record.chapter_id,
                version=1,
                category=file_record.category,
            )
            db.add(new_record)
            db.commit()

            return {"status": "completed", "new_file_id": new_record.id}

        raise HTTPException(status_code=500, detail="Output file generation failed")

    except Exception as exc:
        logger.error(f"Technical Apply Error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
