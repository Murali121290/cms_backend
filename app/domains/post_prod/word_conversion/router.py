"""Word conversion API router for chapter format conversion."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import database
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.post_prod.models import PostProdChapter
from .converter import run_conversion_background

router = APIRouter(prefix="/word-conversion/chapters", tags=["Word Conversion"])


@router.post("/{chapter_id}/convert")
def convert_chapter(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user=Depends(get_current_user_from_cookie)
):
    """
    Trigger background conversion for a chapter.

    Converts INDD or PDF source files to DOCX format. The conversion runs
    asynchronously via Celery background task.

    Args:
        chapter_id: Chapter ID to convert
        db: Database session
        user: Authenticated user

    Returns:
        Status message and chapter ID

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

    # Queue background conversion task
    from app.core.worker import run_post_prod_conversion_task
    run_post_prod_conversion_task.delay(chapter.id)

    return {"message": "Conversion started", "chapter_id": chapter.id}
