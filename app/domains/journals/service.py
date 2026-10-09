from datetime import datetime
from typing import Optional, Dict, Any, List, Union
from sqlalchemy.orm import Session
from app.domains.journals.models import Journal, JournalArticle, JournalStageDetail, JournalWorkflow

# Pre-Editing covers structuring, references, IA rules and technical checks as four gated steps
# (see pre_editing.py); the separate Technical Editing stage was merged into it (migration 0037).
STAGE_PIPELINE = [
    "1. Pre-Editing",
    "2. Language Editing",
    "3. XML Conversion",
    "4. Generate InDesign",
    "5. InDesign Final QC",
    "6. View Proof",
    "7. Final Delivery"
]

# Stage numbers used by the pipeline code, so the numbering lives in one place.
PRE_EDITING, LANGUAGE, XML_CONVERSION, INDESIGN, INDESIGN_QC, PROOF, DELIVERY = range(1, 8)

# Seeded when the workflow table is empty (also by migration 0034).
DEFAULT_WORKFLOWS = [
    {"name": "Full production", "stage_numbers": [1, 2, 3, 4, 5, 6, 7], "is_default": True,
     "description": "Pre-editing (structuring, references, IA rules, technical), language editing, JATS XML, InDesign typesetting, QC, proof and delivery."},
    {"name": "XML only (no typesetting)", "stage_numbers": [1, 3, 6, 7], "is_default": False,
     "description": "Edited and delivered as JATS XML; the publisher typesets."},
    {"name": "Fast track (no language edit)", "stage_numbers": [1, 3, 4, 5, 6, 7], "is_default": False,
     "description": "Skips language editing for articles that arrive copy-edited."},
]


def stage_names(stage_numbers: List[int]) -> List[str]:
    return [STAGE_PIPELINE[n - 1] for n in sorted(set(stage_numbers)) if 1 <= n <= len(STAGE_PIPELINE)]


def ensure_default_workflows(db: Session) -> None:
    for dw in DEFAULT_WORKFLOWS:
        prefix = dw["name"].split("(")[0].strip()
        wf = db.query(JournalWorkflow).filter(JournalWorkflow.name.ilike(f"%{prefix}%")).first()
        if not wf:
            db.add(JournalWorkflow(**dw))
        else:
            wf.stage_numbers = dw["stage_numbers"]
            wf.description = dw["description"]
            wf.is_default = dw["is_default"]
    db.commit()


def default_workflow(db: Session) -> JournalWorkflow:
    ensure_default_workflows(db)
    return (db.query(JournalWorkflow).filter(JournalWorkflow.is_default == True, JournalWorkflow.is_active == True).first()  # noqa: E712
            or db.query(JournalWorkflow).order_by(JournalWorkflow.id).first())


def article_stage_numbers(db: Session, article: JournalArticle) -> List[int]:
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    wf = journal.workflow if journal and journal.workflow else None
    return sorted(set(wf.stage_numbers)) if wf else list(range(1, len(STAGE_PIPELINE) + 1))


def initialize_article_stages(db: Session, article: JournalArticle):
    """Creates the stage detail records for a new article from its journal's workflow."""
    numbers = article_stage_numbers(db, article)
    for pos, number in enumerate(numbers):
        db.add(JournalStageDetail(
            article_id=article.id,
            stage_number=number,
            stage_name=STAGE_PIPELINE[number - 1],
            stage_status="In-progress" if pos == 0 else "Pending",
            actual_start_date=datetime.utcnow() if pos == 0 else None,
        ))
    article.current_stage = STAGE_PIPELINE[numbers[0] - 1]
    db.commit()


def advance_article_stage(db: Session, article_id: int, remarks: Optional[str] = None) -> Dict[str, Any]:
    """Advances an article to the next stage of its workflow (the stage rows created for it)."""
    article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
    if not article:
        raise ValueError(f"Article with id {article_id} not found")
    if article.status == "Completed":
        return {"status": "completed", "message": "Article has already completed its workflow"}

    stages = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id) \
        .order_by(JournalStageDetail.stage_number).all()
    names = [s.stage_name for s in stages]
    current_stage = article.current_stage if article.current_stage in names else (names[0] if names else STAGE_PIPELINE[0])
    idx = names.index(current_stage) if current_stage in names else 0

    if stages:
        curr = stages[idx]
        curr.stage_status = "Completed"
        curr.actual_end_date = datetime.utcnow()
        if remarks:
            curr.remarks = remarks

    if idx < len(stages) - 1:
        nxt = stages[idx + 1]
        article.current_stage = nxt.stage_name
        nxt.stage_status = "In-progress"
        nxt.actual_start_date = datetime.utcnow()
        article.current_assignee_id = nxt.assignee_id
        db.commit()
        return {"status": "success", "previous_stage": current_stage, "new_stage": nxt.stage_name}

    article.status = "Completed"
    db.commit()
    return {"status": "completed", "message": f"Article has completed all {len(stages)} stages of its workflow"}


def revert_article_stage(db: Session, article_id: int, target_stage: Union[int, str], remarks: Optional[str] = None) -> Dict[str, Any]:
    """Reverts an article from any stage back to any earlier workflow stage."""
    article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
    if not article:
        raise ValueError(f"Article with id {article_id} not found")

    stages = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id) \
        .order_by(JournalStageDetail.stage_number).all()
    if not stages:
        raise ValueError(f"No stage details found for article {article_id}")

    target_idx = None
    if isinstance(target_stage, int):
        for i, s in enumerate(stages):
            if s.stage_number == target_stage:
                target_idx = i
                break
    else:
        for i, s in enumerate(stages):
            if s.stage_name.lower() == str(target_stage).lower() or STAGE_PIPELINE[s.stage_number - 1].lower() == str(target_stage).lower():
                target_idx = i
                break

    if target_idx is None:
        raise ValueError(f"Target stage '{target_stage}' not found for article {article_id}")

    names = [s.stage_name for s in stages]
    current_stage = article.current_stage if article.current_stage in names else names[-1]
    curr_idx = names.index(current_stage) if current_stage in names else len(names) - 1

    if target_idx >= curr_idx and article.status != "Completed":
        raise ValueError(f"Target stage must be an earlier stage than current stage ({current_stage})")

    prev_stage_name = article.current_stage
    target_stage_obj = stages[target_idx]
    article.current_stage = target_stage_obj.stage_name
    article.status = "In-progress"
    article.current_assignee_id = target_stage_obj.assignee_id

    for i, s in enumerate(stages):
        if i == target_idx:
            s.stage_status = "In-progress"
            s.actual_end_date = None
            if remarks:
                s.remarks = f"Moved back from {prev_stage_name}: {remarks}"
        elif i > target_idx:
            s.stage_status = "Pending"
            s.actual_start_date = None
            s.actual_end_date = None

    db.commit()
    return {
        "status": "success",
        "previous_stage": prev_stage_name,
        "new_stage": target_stage_obj.stage_name,
        "new_stage_number": target_stage_obj.stage_number
    }
