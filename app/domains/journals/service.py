from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Union
from sqlalchemy.orm import Session
from app.domains.journals.models import Journal, JournalArticle, JournalStageDetail, JournalWorkflow

# Pre-Editing covers structuring, references, IA rules and technical checks as four gated steps
# (see pre_editing.py); the separate Technical Editing stage was merged into it (migration 0037).
# 8-Stage Journal Production Pipeline with Stage 1: MS Analysis & ELOG
STAGE_PIPELINE = [
    "1. MS Analysis & ELOG",
    "2. Pre-Editing",
    "3. Language Editing",
    "4. XML Conversion",
    "5. Generate InDesign",
    "6. InDesign Final QC",
    "7. View Proof",
    "8. Final Delivery"
]

# Stage numbers used by the pipeline code, so the numbering lives in one place.
MS_ANALYSIS, PRE_EDITING, LANGUAGE, XML_CONVERSION, INDESIGN, INDESIGN_QC, PROOF, DELIVERY = range(1, 9)

# Seeded when the workflow table is empty (also by migration 0034).
MASTER_JOURNAL_STAGES = [
    {
        "id": 1,
        "stage_name": "1. MS review & elog",
        "short_name": "MS review & elog",
        "description": "Manuscript analysis, metadata extraction, queries log, and ELOG report generation",
        "roles": ["Reviewer", "Editor", "Managing Editor"]
    },
    {
        "id": 2,
        "stage_name": "2. Pre-editing",
        "short_name": "Pre-editing",
        "description": "Structuring, references, 121 mechanical rules, and citation checks",
        "roles": ["Pre-editor", "Copyeditor"]
    },
    {
        "id": 3,
        "stage_name": "3. Language editing",
        "short_name": "Language editing",
        "description": "Linguistic refinement, grammar rules (UK/US house style), readability, and tracked changes",
        "roles": ["Language Editor", "Copyeditor"]
    },
    {
        "id": 4,
        "stage_name": "4. XML Conversion",
        "short_name": "XML Conversion",
        "description": "Conversion to JATS 1.3 XML and DTD validation",
        "roles": ["XML Specialist", "Production Editor"]
    },
    {
        "id": 5,
        "stage_name": "5. Generate InDesign",
        "short_name": "Generate InDesign",
        "description": "Automated InDesign typesetting from XML and templates",
        "roles": ["Typesetter", "Layout Artist"]
    },
    {
        "id": 6,
        "stage_name": "6. InDesign Final QC",
        "short_name": "InDesign Final QC",
        "description": "Quality control of InDesign layouts, font checks, and visual inspection",
        "roles": ["QC Specialist", "Layout Artist"]
    },
    {
        "id": 7,
        "stage_name": "7. View Proof",
        "short_name": "View Proof",
        "description": "Proof PDF inspection, TinyMCE proof corrections, and proof sign-off",
        "roles": ["Proofreader", "Author", "Editor"]
    },
    {
        "id": 8,
        "stage_name": "8. Final Delivery",
        "short_name": "final delivery",
        "description": "Assembly of final publication package (ZIP) with all validated deliverables",
        "roles": ["Production Manager", "Dispatcher"]
    },
]

# Seeded when the workflow table is empty (also by migration 0034).
DEFAULT_WORKFLOWS = [
    {
        "name": "PA Editorial (4 stages)",
        "stage_numbers": [1, 2, 3, 4],
        "custom_stages": [
            "1. MS review & elog",
            "2. Pre-editing",
            "3. Language editing",
            "4. final delivery"
        ],
        "is_default": False,
        "description": "Streamlined 4-stage editorial pipeline: MS review & elog, Pre-editing, Language editing, and final delivery."
    },
    {
        "name": "Full production",
        "stage_numbers": [1, 2, 3, 4, 5, 6, 7, 8],
        "custom_stages": None,
        "is_default": True,
        "description": "MS Analysis & ELOG, pre-editing (structuring, references, IA rules, technical), language editing, JATS XML, InDesign typesetting, QC, proof and delivery."
    },
    {
        "name": "XML only (no typesetting)",
        "stage_numbers": [1, 2, 4, 7, 8],
        "custom_stages": None,
        "is_default": False,
        "description": "MS Analysis, pre-editing, edited and delivered as JATS XML; the publisher typesets."
    },
    {
        "name": "Fast track (no language edit)",
        "stage_numbers": [1, 2, 4, 5, 6, 7, 8],
        "custom_stages": None,
        "is_default": False,
        "description": "MS Analysis, pre-editing; skips language editing for articles that arrive copy-edited."
    },
]


def stage_names(stage_numbers: List[int]) -> List[str]:
    return [STAGE_PIPELINE[n - 1] for n in sorted(set(stage_numbers)) if 1 <= n <= len(STAGE_PIPELINE)]


def workflow_stage_names(wf: Optional[JournalWorkflow]) -> List[str]:
    if wf and wf.custom_stages and isinstance(wf.custom_stages, list) and len(wf.custom_stages) > 0:
        return list(wf.custom_stages)
    if wf and wf.stage_numbers:
        return stage_names(wf.stage_numbers)
    return list(STAGE_PIPELINE)


def ensure_pa_editorial_client(db: Session) -> None:
    from app.domains.journals.models import JournalClient, JournalGrammarsheet
    import json
    import os

    pa_client = db.query(JournalClient).filter(JournalClient.client_code == "PA-01").first()
    if not pa_client:
        pa_client = JournalClient(
            client_code="PA-01",
            publisher_name="PA Editorial Ltd., UK",
            jats_version="1.3",
            contact_email="production@paeditorial.co.uk",
            website="https://www.paeditorial.co.uk",
            active_status=True
        )
        db.add(pa_client)
        db.flush()

    pa_wf = db.query(JournalWorkflow).filter(JournalWorkflow.name.ilike("%PA Editorial%")).first()
    pa_journal = db.query(Journal).filter(Journal.journal_code == "PAJ-01").first()
    default_wf = pa_wf or db.query(JournalWorkflow).filter(JournalWorkflow.is_default == True).first()
    if not pa_journal:
        pa_journal = Journal(
            client_id=pa_client.id,
            journal_code="PAJ-01",
            journal_title="PA Journal of Applied Sciences & Medicine",
            issn_online="2976-884X",
            workflow_id=default_wf.id if default_wf else None,
            status="Active"
        )
        db.add(pa_journal)
        db.flush()

        uk_profile_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "processing", "language_editing", "config", "profiles", "uk.json"
        )
        rules = {}
        if os.path.exists(uk_profile_path):
            try:
                with open(uk_profile_path, "r", encoding="utf-8") as f:
                    rules = json.load(f)
            except Exception:
                rules = {}
        db.add(JournalGrammarsheet(
            journal_id=pa_journal.id,
            name="PA UK House Style Grammar Sheet",
            language_variant="UK_English",
            grammar_rules=rules,
            is_active=True
        ))
        db.commit()
    elif pa_wf and pa_journal.workflow_id != pa_wf.id:
        pa_journal.workflow_id = pa_wf.id
        db.commit()


def ensure_default_workflows(db: Session) -> None:
    for dw in DEFAULT_WORKFLOWS:
        prefix = dw["name"].split("(")[0].strip()
        wf = db.query(JournalWorkflow).filter(JournalWorkflow.name.ilike(f"%{prefix}%")).first()
        if not wf:
            db.add(JournalWorkflow(**dw))
        else:
            wf.stage_numbers = dw["stage_numbers"]
            if "custom_stages" in dw:
                wf.custom_stages = dw["custom_stages"]
            wf.description = dw["description"]
    db.commit()
    try:
        ensure_pa_editorial_client(db)
    except Exception:
        db.rollback()


def default_workflow(db: Session) -> JournalWorkflow:
    ensure_default_workflows(db)
    return (db.query(JournalWorkflow).filter(JournalWorkflow.is_default == True, JournalWorkflow.is_active == True).first()  # noqa: E712
            or db.query(JournalWorkflow).order_by(JournalWorkflow.id).first())


def article_stage_numbers(db: Session, article: JournalArticle) -> List[int]:
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    wf = journal.workflow if journal and journal.workflow else None
    if wf and wf.custom_stages and isinstance(wf.custom_stages, list) and len(wf.custom_stages) > 0:
        return list(range(1, len(wf.custom_stages) + 1))
    return sorted(set(wf.stage_numbers)) if wf else list(range(1, len(STAGE_PIPELINE) + 1))


def initialize_article_stages(db: Session, article: JournalArticle):
    """Creates the stage detail records for a new article from its journal's workflow."""
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    wf = journal.workflow if journal and journal.workflow else None

    if wf and wf.custom_stages and isinstance(wf.custom_stages, list) and len(wf.custom_stages) > 0:
        stage_labels = list(wf.custom_stages)
        for pos, label in enumerate(stage_labels):
            db.add(JournalStageDetail(
                article_id=article.id,
                stage_number=pos + 1,
                stage_name=label,
                stage_status="In-progress" if pos == 0 else "Pending",
                actual_start_date=datetime.now(timezone.utc) if pos == 0 else None,
            ))
        article.current_stage = stage_labels[0]
        db.commit()
        return

    numbers = article_stage_numbers(db, article)
    for pos, number in enumerate(numbers):
        db.add(JournalStageDetail(
            article_id=article.id,
            stage_number=number,
            stage_name=STAGE_PIPELINE[number - 1],
            stage_status="In-progress" if pos == 0 else "Pending",
            actual_start_date=datetime.now(timezone.utc) if pos == 0 else None,
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
        curr.actual_end_date = datetime.now(timezone.utc)
        if remarks:
            curr.remarks = remarks

    if idx < len(stages) - 1:
        nxt = stages[idx + 1]
        article.current_stage = nxt.stage_name
        nxt.stage_status = "In-progress"
        nxt.actual_start_date = datetime.now(timezone.utc)
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
