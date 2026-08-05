"""Word conversion API router for chapter format conversion."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app import database
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.rbac_config import has_post_prod_access
from app.domains.post_prod.word_conversion.models import PostProdChapter

router = APIRouter(prefix="/word-conversion/chapters", tags=["Word Conversion"])


def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(status_code=403, detail="Access denied to Post Production / Backlist.")
    return user


@router.post("/{chapter_id}/convert", dependencies=[Depends(check_post_prod_access)])
def convert_chapter(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie),
):
    """
    Trigger background conversion for a chapter.

    Converts INDD or PDF source files to DOCX format. The conversion runs
    asynchronously via Celery background task, tracked via a ProcessingJob.

    Args:
        chapter_id: Chapter ID to convert
        db: Database session
        user: Authenticated user

    Returns:
        Status message, chapter ID, and job ID

    Raises:
        404: Chapter not found
    """
    chapter = db.query(PostProdChapter).filter(PostProdChapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    chapter.status = "Pending"
    chapter.conversion_status = "Pending"
    chapter.error_message = None
    db.commit()

    # Create a ProcessingJob for progress tracking and queue management
    from app.models import ProcessingJob
    job = ProcessingJob(
        file_id=None,
        process_type="post_prod_conversion",
        status="pending",
        current_step="Pending queue execution",
        progress_pct=0,
        user_id=user.id if user else None,
        project_code=chapter.project_name,
        chapter_number=chapter.chapter_no,
        filename=chapter.source_filename,
        options={"chapter_id": chapter_id},
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Queue background conversion task with job tracking
    from app.core.worker import run_post_prod_conversion_task
    run_post_prod_conversion_task.delay(chapter.id, job.id)

    return {"message": "Conversion started", "chapter_id": chapter.id, "job_id": job.id}
