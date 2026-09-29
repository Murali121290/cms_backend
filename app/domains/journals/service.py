from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from app.domains.journals.models import JournalArticle, JournalStageDetail

STAGE_PIPELINE = [
    "1. Pre-Editing (XHTML)",
    "2. Technical Editing",
    "3. Language Editing",
    "4. XML Conversion",
    "5. Generate InDesign",
    "6. InDesign Final QC",
    "7. View Proof",
    "8. Final Delivery"
]


def initialize_article_stages(db: Session, article: JournalArticle):
    """Creates initial 8 stage detail records for a new journal article."""
    for idx, stage_name in enumerate(STAGE_PIPELINE, start=1):
        stage_status = "In-progress" if idx == 1 else "Pending"
        actual_start = datetime.utcnow() if idx == 1 else None
        
        detail = JournalStageDetail(
            article_id=article.id,
            stage_number=idx,
            stage_name=stage_name,
            stage_status=stage_status,
            actual_start_date=actual_start
        )
        db.add(detail)
    db.commit()


def advance_article_stage(db: Session, article_id: int, remarks: Optional[str] = None) -> Dict[str, Any]:
    """Advances an article from its current stage to the next stage in the 8-step pipeline."""
    article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
    if not article:
        raise ValueError(f"Article with id {article_id} not found")

    current_stage = article.current_stage
    if current_stage not in STAGE_PIPELINE:
        current_stage = STAGE_PIPELINE[0]

    current_idx = STAGE_PIPELINE.index(current_stage)

    # 1. Update current stage detail row to Completed
    curr_detail = db.query(JournalStageDetail).filter(
        JournalStageDetail.article_id == article_id,
        JournalStageDetail.stage_name == current_stage
    ).first()

    if curr_detail:
        curr_detail.stage_status = "Completed"
        curr_detail.actual_end_date = datetime.utcnow()
        if remarks:
            curr_detail.remarks = remarks

    # 2. Check if next stage exists
    if current_idx < len(STAGE_PIPELINE) - 1:
        next_stage_name = STAGE_PIPELINE[current_idx + 1]
        article.current_stage = next_stage_name
        
        next_detail = db.query(JournalStageDetail).filter(
            JournalStageDetail.article_id == article_id,
            JournalStageDetail.stage_name == next_stage_name
        ).first()

        if next_detail:
            next_detail.stage_status = "In-progress"
            next_detail.actual_start_date = datetime.utcnow()

        db.commit()
        return {"status": "success", "previous_stage": current_stage, "new_stage": next_stage_name}
    else:
        article.status = "Completed"
        db.commit()
        return {"status": "completed", "message": "Article has completed all 8 production stages"}
