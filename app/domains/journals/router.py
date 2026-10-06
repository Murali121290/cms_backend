from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional
import logging
import shutil
import os
import re
import tempfile

from datetime import datetime

from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.journals.checks import CHECK_STAGES, REGISTRY, CheckNotImplemented, blocking_issues, missing_output, run_check
from app.domains.journals.models import (
    JournalClient, Journal, JournalArticle, JournalStageDetail, JournalStylesheet, JournalGrammarsheet,
    JournalCheckRun, JournalIssue, JournalWorkflow, JournalFile
)
from app.domains.journals.schemas import (
    JournalClientCreate, JournalClientResponse,
    JournalCreate, JournalResponse,
    JournalArticleCreate, JournalArticleResponse,
    StageAssignmentRequest, ArticleAssignRequest, ArticleDelayUpdateRequest, StageAdvanceBody,
    JournalStylesheetCreate, JournalStylesheetResponse,
    JournalGrammarsheetCreate, JournalGrammarsheetResponse,
    JournalCheckRunResponse, JournalIssueResponse, JournalIssueAction,
    JournalWorkflowCreate, JournalWorkflowResponse, ArticleCounts, JournalClientOverview, JournalOverview,
    JournalArticleRow, ArticleStageStatus
)
from app.domains.journals.files import latest_file, save_version
from app.domains.journals.service import (
    initialize_article_stages, advance_article_stage, default_workflow, ensure_default_workflows, stage_names,
    STAGE_PIPELINE as STAGE_NAMES, INDESIGN,
)


def require_journal_user(user=Depends(get_current_user_from_cookie)):
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to use Journal Production")
    return user


router = APIRouter(prefix="/journals", tags=["Journal Production"], dependencies=[Depends(require_journal_user)])
logger = logging.getLogger(__name__)


def _get_article(db: Session, article_id: int) -> JournalArticle:
    article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


def _get_journal(db: Session, journal_id: int) -> Journal:
    journal = db.query(Journal).filter(Journal.id == journal_id).first()
    if not journal:
        raise HTTPException(status_code=404, detail="Journal not found")
    return journal


# --- Journal Users / Team Members ---
@router.get("/users")
def list_journal_users(db: Session = Depends(get_db)):
    """List active system users for assignment in Journal Production."""
    from app.domains.auth.models import User
    users = db.query(User).filter(User.active_status == True).order_by(User.id).all()
    out = []
    for u in users:
        full_name = " ".join(p for p in (u.first_name, u.last_name) if p).strip() or u.username
        out.append({
            "id": u.id,
            "username": u.username,
            "name": full_name,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "email": u.email,
            "role": u.role or u.designation or "Operator",
            "team": u.team
        })
    return out


# --- Journal Clients ---
@router.get("/clients", response_model=List[JournalClientResponse])
def list_journal_clients(db: Session = Depends(get_db)):
    return db.query(JournalClient).filter(JournalClient.active_status == True).all()


@router.post("/clients", response_model=JournalClientResponse, status_code=status.HTTP_201_CREATED)
def create_journal_client(client_in: JournalClientCreate, db: Session = Depends(get_db)):
    existing = db.query(JournalClient).filter(JournalClient.client_code == client_in.client_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Client code already exists")
    client = JournalClient(**client_in.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


# --- Journals (Publication Titles) ---
@router.get("", response_model=List[JournalResponse])
def list_journals(client_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Journal)
    if client_id:
        query = query.filter(Journal.client_id == client_id)
    return query.all()


@router.post("", response_model=JournalResponse, status_code=status.HTTP_201_CREATED)
def create_journal(journal_in: JournalCreate, db: Session = Depends(get_db)):
    existing = db.query(Journal).filter(Journal.journal_code == journal_in.journal_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Journal code already exists")
    if not db.query(JournalClient).filter(JournalClient.id == journal_in.client_id).first():
        raise HTTPException(status_code=404, detail="Journal client not found")
    data = journal_in.model_dump()
    if data["workflow_id"] is None:
        data["workflow_id"] = default_workflow(db).id
    elif not db.query(JournalWorkflow).filter(JournalWorkflow.id == data["workflow_id"], JournalWorkflow.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=400, detail="Unknown or inactive workflow")
    journal = Journal(**data)
    db.add(journal)
    db.commit()
    db.refresh(journal)
    return journal


# --- Journal Articles ---
@router.get("/articles", response_model=List[JournalArticleResponse])
def list_journal_articles(journal_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(JournalArticle)
    if journal_id:
        query = query.filter(JournalArticle.journal_id == journal_id)
    return query.order_by(JournalArticle.created_at.desc()).all()


@router.post("/articles", response_model=JournalArticleResponse, status_code=status.HTTP_201_CREATED)
def create_journal_article(article_in: JournalArticleCreate, db: Session = Depends(get_db)):
    article = JournalArticle(**article_in.model_dump())
    db.add(article)
    db.commit()
    db.refresh(article)
    
    # Initialize 8 stages
    initialize_article_stages(db, article)
    return article


# --- Article Stage Advancement & Assignment ---
@router.post("/articles/{article_id}/advance-stage")
def advance_stage(article_id: int, req: Optional[StageAdvanceBody] = None, db: Session = Depends(get_db)):
    from app.domains.journals.checks.runner import stage_number
    from app.domains.journals.pre_editing import unfinished_step

    article = _get_article(db, article_id)
    missing = missing_output(article)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": f"{missing} before leaving {article.current_stage}", "blocking_issues": []},
        )
    blocking = blocking_issues(db, article)
    if blocking:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"{len(blocking)} open error(s) must be fixed before leaving {article.current_stage}",
                "blocking_issues": [JournalIssueResponse.model_validate(i).model_dump(mode="json") for i in blocking],
            },
        )
    if stage_number(article.current_stage) == 1:
        step = unfinished_step(db, article)
        if step:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": f"Pre-Editing step {step['number']} ({step['label']}) is not finished", "blocking_issues": [],
                        "step": step["key"]},
            )
    remarks = req.remarks if req else None
    try:
        res = advance_article_stage(db, article_id, remarks)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Entering Language Editing: run that stage's check so its findings are waiting in the editor.
    if res.get("new_stage"):
        db.refresh(article)
        res["check_runs"] = _run_text_checks(db, article, only_stage=True)
    return res


TEXT_CHECKS = ("structuring", "references", "ia_rules", "technical", "language")


def _run_text_checks(db: Session, article: JournalArticle, only_stage: bool = False, user_id: Optional[int] = None):
    """Run the manuscript checks for the article's current stage (only_stage) or for every stage up to it."""
    from app.domains.journals.checks.runner import stage_number
    current = stage_number(article.current_stage)
    out = {}
    for key in TEXT_CHECKS:
        stage = CHECK_STAGES[key]
        if (stage == current) if only_stage else (stage <= current):
            try:
                out[key] = JournalCheckRunResponse.model_validate(run_check(db, article, key, user_id)).model_dump(mode="json")
            except Exception as e:
                out[key] = {"module": key, "status": "Failed", "error_message": str(e)}
    return out


@router.post("/articles/assign-stage")
def assign_stage(req: StageAssignmentRequest, db: Session = Depends(get_db)):
    article = _get_article(db, req.article_id)
    stage_detail = db.query(JournalStageDetail).filter(
        JournalStageDetail.article_id == req.article_id,
        JournalStageDetail.stage_name == req.target_stage
    ).first()
    if not stage_detail:
        raise HTTPException(status_code=400, detail=f"Unknown stage '{req.target_stage}' for this article")
    if req.planned_start_date and req.planned_end_date and req.planned_end_date < req.planned_start_date:
        raise HTTPException(status_code=400, detail="Planned end date must be on or after the planned start date")

    stage_detail.assignee_id = req.assignee_id
    stage_detail.planned_start_date = req.planned_start_date
    stage_detail.planned_end_date = req.planned_end_date
    stage_detail.sla_hours = req.sla_hours
    if req.target_stage == article.current_stage:
        article.current_assignee_id = req.assignee_id
        article.complexity_level = req.complexity_level

    db.commit()
    return {"status": "success", "message": "Workflow assignment saved"}


@router.patch("/articles/{article_id}/assign")
def assign_article(article_id: int, req: ArticleAssignRequest, db: Session = Depends(get_db)):
    """Assign an article to a user/operator, plan stage dates & SLA hours."""
    article = _get_article(db, article_id)

    if req.assignee_id:
        article.current_assignee_id = req.assignee_id
    if req.assignee_name:
        article.assigned_user_name = req.assignee_name
    if req.planned_start_date:
        article.planned_start_date = req.planned_start_date
    if req.planned_end_date:
        article.planned_end_date = req.planned_end_date
    if req.sla_hours is not None:
        article.sla_hours = req.sla_hours
    if req.complexity_level:
        article.complexity_level = req.complexity_level
    if req.remarks:
        article.assignment_remarks = req.remarks

    # Also update JournalStageDetail for target or current stage
    if req.stage_number:
        stage_detail = db.query(JournalStageDetail).filter(
            JournalStageDetail.article_id == article_id,
            JournalStageDetail.stage_number == req.stage_number
        ).first()
    else:
        stage_detail = db.query(JournalStageDetail).filter(
            JournalStageDetail.article_id == article_id,
            JournalStageDetail.stage_name == article.current_stage
        ).first()

    if stage_detail:
        if req.assignee_id:
            stage_detail.assignee_id = req.assignee_id
        if req.planned_start_date:
            stage_detail.planned_start_date = req.planned_start_date
        if req.planned_end_date:
            stage_detail.planned_end_date = req.planned_end_date
        if req.sla_hours is not None:
            stage_detail.sla_hours = req.sla_hours
        if req.remarks:
            stage_detail.remarks = req.remarks

    db.commit()
    db.refresh(article)
    return {
        "status": "success",
        "message": f"Article #{article_id} assigned successfully",
        "article_id": article_id,
        "assigned_user_name": article.assigned_user_name,
        "current_stage": article.current_stage
    }


@router.patch("/articles/{article_id}/delay")
def update_article_delay(article_id: int, req: ArticleDelayUpdateRequest, db: Session = Depends(get_db)):
    """Log or update operational/publisher delay on an article and set revised due date."""
    article = _get_article(db, article_id)

    article.is_delayed = True
    article.delay_category = req.delay_category
    article.delay_reason = req.delay_reason
    article.revised_due_date = req.revised_due_date
    article.delay_days = req.delay_days or 0
    article.delay_logged_at = datetime.utcnow()

    # Also update stage detail
    stage_detail = db.query(JournalStageDetail).filter(
        JournalStageDetail.article_id == article_id,
        JournalStageDetail.stage_name == article.current_stage
    ).first()
    if stage_detail:
        stage_detail.delayed = True

    db.commit()
    db.refresh(article)
    return {
        "status": "success",
        "message": f"Delay logged for Article #{article_id} ({req.delay_category})",
        "article_id": article_id,
        "is_delayed": article.is_delayed,
        "delay_category": article.delay_category,
        "revised_due_date": article.revised_due_date
    }


# --- ZIP Upload & Metadata Extraction Endpoints ---
@router.post("/articles/extract-metadata")
async def extract_metadata_from_file(file: UploadFile = File(...)):
    """Uploads a .docx file and returns extracted metadata for preview."""
    if not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files supported for metadata extraction")

    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, file.filename)
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        from app.domains.journals.metadata_extractor import extract_docx_metadata_advanced
        metadata = extract_docx_metadata_advanced(temp_path)
        return {"filename": file.filename, "extracted_metadata": metadata}
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@router.post("/articles/upload-zip")
async def upload_article_zip_package(
    background_tasks: BackgroundTasks,
    journal_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_journal_user),
):
    """
    Uploads a ZIP manuscript package (e.g. JAPPC_V11.1__189115-Manuscript_1.zip).
    Extracts contained files, parses manuscript DOCX metadata, creates JournalArticle record,
    attaches JournalFile records, and initializes the 8 workflow stages.
    """
    from app.domains.journals.files import incoming_dir

    zip_name = os.path.basename(file.filename or "")
    if not zip_name.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .zip archive")

    # 1. Save uploaded ZIP
    storage_dir = incoming_dir(_get_journal(db, journal_id))
    zip_path = os.path.join(storage_dir, zip_name)

    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 2. Extract ZIP & Parse Metadata
    extract_target_dir = os.path.join(storage_dir, "package")
    from app.domains.journals.metadata_extractor import process_uploaded_zip_package
    
    try:
        parsed_data = process_uploaded_zip_package(zip_path, extract_target_dir)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process ZIP package: {str(e)}")

    title = parsed_data.get("article_title") or f"Article from {file.filename}"
    doi = (parsed_data.get("article_doi") or "").strip() or None
    if doi and db.query(JournalArticle).filter(JournalArticle.article_doi == doi).first():
        raise HTTPException(status_code=409, detail=f"An article with DOI {doi} already exists")
    lead_author = parsed_data.get("lead_author")
    abstract = parsed_data.get("abstract")
    keywords = parsed_data.get("keywords")

    # 3. Create JournalArticle Record
    article = JournalArticle(
        journal_id=journal_id,
        article_doi=doi,
        article_title=title,
        lead_author=lead_author,
        abstract=abstract,
        keywords=keywords,
        extracted_metadata=parsed_data,
        original_docx_path=parsed_data.get("primary_docx_path"),
        current_stage=STAGE_NAMES[0],
        status="In-progress"
    )
    db.add(article)
    db.commit()
    db.refresh(article)

    # 4. Attach unzipped JournalFiles
    from app.domains.journals.models import JournalFile
    for item in parsed_data.get("extracted_files", []):
        jfile = JournalFile(
            article_id=article.id,
            filename=item["filename"],
            file_type=item["ext"].lstrip('.'),
            category=item["category"],
            path=item["full_path"],
            uploaded_by_id=user.id,
        )
        db.add(jfile)

    db.commit()

    # 5. Initialize the production stages and start Pre-Editing step 1 (Structuring)
    initialize_article_stages(db, article)
    _queue_structuring(background_tasks, article.id, user.id)

    return {
        "status": "success",
        "message": f"Successfully unzipped package and created article '{title}'",
        "article_id": article.id,
        "extracted_metadata": parsed_data
    }


# --- Article Files & Pre-Editing Pipeline (Structuring + Ref Validation -> XHTML) ---
@router.post("/articles/{article_id}/upload-files")
async def upload_article_files(
    article_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_journal_user),
):
    """
    Uploads multiple files (DOCX manuscript, figures, XML, PDF proofs) for an article.
    Art goes to articles/article_<id>/art/ as versioned files linked to their figure when the
    name says which ("fig2.tif"); everything else is kept as uploaded under original/.
    """
    from app.domains.journals.art import figure_from_name
    from app.domains.journals.files import ART_EXTENSIONS, article_dir, save_version

    article = _get_article(db, article_id)
    storage_dir = article_dir(article, "original")

    saved_files = []
    for f in files:
        name = os.path.basename(f.filename or "")
        if not name:
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext in ART_EXTENSIONS - {".pdf"}:
            row = save_version(db, article, "Art", name, f.file.read(), "art", figure_number=figure_from_name(name))
            row.uploaded_by_id = user.id
            saved_files.append(row.filename)
            continue

        fpath = os.path.join(storage_dir, name)
        with open(fpath, "wb") as buffer:
            shutil.copyfileobj(f.file, buffer)
        category = "Manuscript"
        if ext in ['.xml', '.jats']:
            category = "XML"
        elif ext in ['.pdf']:
            category = "Proof"

        if ext == '.docx' and not article.original_docx_path:
            article.original_docx_path = fpath

        db.add(JournalFile(article_id=article_id, filename=name, file_type=ext.lstrip('.'), category=category, path=fpath,
                           uploaded_by_id=user.id))
        saved_files.append(name)

    db.commit()
    return {
        "status": "success",
        "message": f"Successfully uploaded {len(saved_files)} file(s)",
        "saved_files": saved_files
    }


@router.post("/articles/{article_id}/files/replace")
async def replace_article_file(
    article_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Replaces an active manuscript (.docx), JATS XML (.xml), InDesign (.indd/.idml), or Proof PDF (.pdf) file.
    Automatically creates a version backup snapshot of the previous file before updating the active copy.
    """
    from app.domains.journals.files import article_dir, save_version
    from app.domains.journals.production import snapshot_working_copy

    article = _get_article(db, article_id)
    name = os.path.basename(file.filename or "")
    if not name:
        raise HTTPException(status_code=400, detail="Filename missing")

    ext = os.path.splitext(name)[1].lower()
    content = await file.read()

    # 1. Take automatic snapshot backup of current file
    snapshot_working_copy(db, article, f"backup before manual replace with {name}")

    # 2. Determine target category & update active article path
    category = "Manuscript"
    target_kind = "edited"
    if ext == ".docx":
        category = "Manuscript"
        target_kind = "edited"
        base = os.path.splitext(name)[0]
        dest_path = os.path.join(article_dir(article, "edited"), f"{base}_structured.docx")
        with open(dest_path, "wb") as fh:
            fh.write(content)
        article.edited_docx_path = dest_path
        if not article.original_docx_path:
            article.original_docx_path = dest_path
    elif ext in [".xml", ".jats"]:
        category = "JATS_XML"
        target_kind = "xml"
        dest_path = os.path.join(article_dir(article, "xml"), name)
        with open(dest_path, "wb") as fh:
            fh.write(content)
        article.jats_xml_path = dest_path
    elif ext in [".indd", ".idml"]:
        category = "INDD"
        target_kind = "indesign"
        dest_path = os.path.join(article_dir(article, "indesign"), name)
        with open(dest_path, "wb") as fh:
            fh.write(content)
        article.indesign_path = dest_path
    elif ext == ".pdf":
        category = "Proof_PDF"
        target_kind = "proof"
        dest_path = os.path.join(article_dir(article, "proof"), name)
        with open(dest_path, "wb") as fh:
            fh.write(content)
        article.proof_pdf_path = dest_path
    else:
        raise HTTPException(status_code=400, detail="Only .docx, .xml, .indd, .idml, or .pdf files can be replaced")

    # 3. Save new version row in database
    row = save_version(db, article, category, name, content, target_kind)
    db.commit()

    return {
        "status": "success",
        "message": f"Successfully replaced active {category} file with {name}. Version {row.version} backup saved.",
        "file_id": row.id,
        "version": row.version,
        "filename": row.filename,
        "category": category
    }



@router.get("/articles/{article_id}/files")
def get_article_files(article_id: int, db: Session = Depends(get_db)):
    """Returns list of files (manuscript, figures, XML, etc.) associated with an article."""
    from app.domains.journals.models import JournalFile
    files = db.query(JournalFile).filter(JournalFile.article_id == article_id).all()
    return files


@router.post("/articles/{article_id}/process-pre-editing")
def process_pre_editing_xhtml(article_id: int, restructure: bool = False, db: Session = Depends(get_db),
                              user=Depends(require_journal_user)):
    """
    Pre-Editing step 1 (Structuring). Kept for older clients; the editor uses
    POST /articles/{id}/pre-editing/structuring/run. The first run structures the upload with
    structuring_lib into the working copy; later runs reuse that copy so editor changes are kept,
    unless restructure=true. Writes versioned XHTML and runs the structuring check.
    """
    from app.domains.journals.pre_editing import StepError, run_step, step_status

    article = _get_article(db, article_id)
    try:
        out = run_step(db, article, "structuring", user.id, restructure=restructure)
    except StepError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    db.refresh(article)
    with open(article.xhtml_path, encoding="utf-8") as fh:
        xhtml_content = fh.read()
    return {
        "status": "success",
        "article_id": article_id,
        "xhtml_version": out["xhtml_version"],
        "structuring": out.get("structuring"),
        "xhtml_content": xhtml_content,
        "check_runs": {"structuring": JournalCheckRunResponse.model_validate(out["check_run"]).model_dump(mode="json")},
        "open_issues": _open_counts(db, article_id, ["structuring"]),
        "pre_editing": step_status(db, article),
    }


# --- Pre-Editing steps: Structuring -> References -> IA rules -> Technical (gated) ---
class StepFinishBody(BaseModel):
    accept_warnings: bool = False


@router.get("/articles/{article_id}/pre-editing")
def get_pre_editing(article_id: int, db: Session = Depends(get_db)):
    from app.domains.journals.pre_editing import step_status
    return step_status(db, _get_article(db, article_id))


@router.post("/articles/{article_id}/pre-editing/{step}/run")
def run_pre_editing_step(article_id: int, step: str, restructure: bool = False, db: Session = Depends(get_db),
                         user=Depends(require_journal_user)):
    """Run one step (409 while it is locked or already running). Returns the step states and the new XHTML version."""
    from app.domains.journals.pre_editing import StepError, run_step, step_status

    article = _get_article(db, article_id)
    try:
        out = run_step(db, article, step, user.id, restructure=restructure)
    except StepError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    db.refresh(article)
    return {
        "pre_editing": step_status(db, article),
        "xhtml_version": out.get("xhtml_version"),
        "check_run": JournalCheckRunResponse.model_validate(out["check_run"]).model_dump(mode="json"),
        "reference_styling": out.get("reference_styling"),
    }


@router.post("/articles/{article_id}/pre-editing/{step}/finish")
def finish_pre_editing_step(article_id: int, step: str, body: Optional[StepFinishBody] = None, db: Session = Depends(get_db),
                            user=Depends(require_journal_user)):
    """Finish a step: 0 open errors, and open warnings resolved or accepted (accept_warnings=true signs them off)."""
    from app.domains.journals.pre_editing import StepError, finish_step
    try:
        return finish_step(db, _get_article(db, article_id), step, user.id, accept_warnings=bool(body and body.accept_warnings))
    except StepError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.post("/articles/{article_id}/pre-editing/{step}/reopen")
def reopen_pre_editing_step(article_id: int, step: str, db: Session = Depends(get_db)):
    from app.domains.journals.pre_editing import StepError, reopen_step
    try:
        return reopen_step(db, _get_article(db, article_id), step)
    except StepError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


class XhtmlSaveBody(BaseModel):
    html_content: str


@router.put("/articles/{article_id}/xhtml")
def save_article_xhtml(article_id: int, body: XhtmlSaveBody, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    """
    Save the WYSIWYG editor's HTML. Changes are written into the article's edited DOCX copy
    (the original upload is never modified) with XhtmlToDocxDeltaEngine, which keeps paragraph
    styles and turns <ins>/<del> into Word tracked changes. The XHTML is then regenerated from
    that DOCX and the Stage 1 checks re-run, so fixed issues clear.
    """
    from app.domains.journals.files import article_dir
    from app.domains.journals.manuscript import resolve_manuscript_path
    from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine
    from app.processing.xhtml_to_docx_delta import XhtmlToDocxDeltaEngine

    article = _get_article(db, article_id)
    if not body.html_content.strip():
        raise HTTPException(status_code=400, detail="The document is empty")
    source = resolve_manuscript_path(db, article)
    if not source:
        raise HTTPException(status_code=400, detail="No manuscript DOCX is attached to this article")

    edited = article.edited_docx_path
    if not edited or not os.path.exists(edited):
        base = os.path.splitext(os.path.basename(article.original_docx_path or source))[0]
        edited = os.path.join(article_dir(article, "edited"), f"{base}_edited.docx")
        shutil.copyfile(source, edited)
    else:
        from app.domains.journals.production import snapshot_working_copy
        snapshot_working_copy(db, article, "before editor save")  # the delta engine patches the file in place

    with tempfile.NamedTemporaryFile("w", suffix=".xhtml", delete=False, encoding="utf-8") as tmp:
        tmp.write(body.html_content)
        html_path = tmp.name
    try:
        XhtmlToDocxDeltaEngine().convert(html_path, edited, username=user.username)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not apply the edits to the manuscript: {e}")
    finally:
        os.remove(html_path)
    article.edited_docx_path = edited

    xhtml_content = DocxToXhtmlRunsEngine().convert(edited)
    row = save_version(db, article, "XHTML", f"{os.path.splitext(os.path.basename(edited))[0]}.xhtml",
                       xhtml_content.encode("utf-8"), "xhtml")
    article.xhtml_path = row.path
    db.commit()

    from app.domains.journals.checks.runner import stage_number
    from app.domains.journals.pre_editing import recheck_after_edit, step_status
    if stage_number(article.current_stage) == 1:
        # Pre-Editing: re-check the steps that have run; a finished step with new errors reopens.
        runs = {k: (JournalCheckRunResponse.model_validate(r).model_dump(mode="json") if not isinstance(r, Exception)
                    else {"module": k, "status": "Failed", "error_message": str(r)})
                for k, r in recheck_after_edit(db, article, user.id).items()}
    else:
        runs = _run_text_checks(db, article, user_id=user.id)  # every manuscript check up to the current stage
    return {
        "pre_editing": step_status(db, article),
        "status": "saved",
        "xhtml_version": row.version,
        "xhtml_content": xhtml_content,
        "check_runs": runs,
        "open_issues": _open_counts(db, article_id, list(TEXT_CHECKS)),
    }


# --- Journal Style Sheets & Grammar Sheets ---
@router.get("/{journal_id}/stylesheets", response_model=List[JournalStylesheetResponse])
def list_stylesheets(journal_id: int, db: Session = Depends(get_db)):
    _get_journal(db, journal_id)
    return db.query(JournalStylesheet).filter(JournalStylesheet.journal_id == journal_id).order_by(JournalStylesheet.id).all()


@router.post("/{journal_id}/stylesheets", response_model=JournalStylesheetResponse, status_code=status.HTTP_201_CREATED)
def create_stylesheet(journal_id: int, sheet_in: JournalStylesheetCreate, db: Session = Depends(get_db)):
    """Each save is a new version; an active new version deactivates the previous one (kept for rollback)."""
    _get_journal(db, journal_id)
    if sheet_in.is_active:
        db.query(JournalStylesheet).filter(JournalStylesheet.journal_id == journal_id).update({JournalStylesheet.is_active: False})
    sheet = JournalStylesheet(journal_id=journal_id, **sheet_in.model_dump())
    db.add(sheet)
    db.commit()
    db.refresh(sheet)
    return sheet


@router.post("/{journal_id}/stylesheets/{sheet_id}/activate", response_model=JournalStylesheetResponse)
def activate_stylesheet(journal_id: int, sheet_id: int, db: Session = Depends(get_db)):
    sheet = db.query(JournalStylesheet).filter(JournalStylesheet.id == sheet_id, JournalStylesheet.journal_id == journal_id).first()
    if not sheet:
        raise HTTPException(status_code=404, detail="Style sheet not found")
    db.query(JournalStylesheet).filter(JournalStylesheet.journal_id == journal_id).update({JournalStylesheet.is_active: False})
    sheet.is_active = True
    db.commit()
    db.refresh(sheet)
    return sheet


@router.get("/{journal_id}/grammarsheets", response_model=List[JournalGrammarsheetResponse])
def list_grammarsheets(journal_id: int, db: Session = Depends(get_db)):
    _get_journal(db, journal_id)
    return db.query(JournalGrammarsheet).filter(JournalGrammarsheet.journal_id == journal_id).order_by(JournalGrammarsheet.id).all()


@router.post("/{journal_id}/grammarsheets", response_model=JournalGrammarsheetResponse, status_code=status.HTTP_201_CREATED)
def create_grammarsheet(journal_id: int, sheet_in: JournalGrammarsheetCreate, db: Session = Depends(get_db)):
    """Each save is a new version; an active new version deactivates the previous one (kept for rollback)."""
    _get_journal(db, journal_id)
    if sheet_in.is_active:
        db.query(JournalGrammarsheet).filter(JournalGrammarsheet.journal_id == journal_id).update({JournalGrammarsheet.is_active: False})
    sheet = JournalGrammarsheet(journal_id=journal_id, **sheet_in.model_dump())
    db.add(sheet)
    db.commit()
    db.refresh(sheet)
    return sheet


@router.post("/{journal_id}/grammarsheets/{sheet_id}/activate", response_model=JournalGrammarsheetResponse)
def activate_grammarsheet(journal_id: int, sheet_id: int, db: Session = Depends(get_db)):
    sheet = db.query(JournalGrammarsheet).filter(JournalGrammarsheet.id == sheet_id, JournalGrammarsheet.journal_id == journal_id).first()
    if not sheet:
        raise HTTPException(status_code=404, detail="Grammar sheet not found")
    db.query(JournalGrammarsheet).filter(JournalGrammarsheet.journal_id == journal_id).update({JournalGrammarsheet.is_active: False})
    sheet.is_active = True
    db.commit()
    db.refresh(sheet)
    return sheet


# --- Validation Checks & Issues ---
@router.get("/checks")
def list_checks():
    """The check modules, the stage each belongs to, and whether it is implemented yet."""
    return [
        {"key": key, "name": check.name, "stage_number": CHECK_STAGES[key], "implemented": check.implemented}
        for key, check in REGISTRY.items()
    ]


@router.post("/articles/{article_id}/checks/run-all")
def run_all_checks(article_id: int, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    article = _get_article(db, article_id)
    runs, skipped, failed = [], [], []
    for key, check in REGISTRY.items():
        if check.auto_only:
            continue
        if not check.implemented:
            skipped.append(key)
            continue
        try:
            runs.append(JournalCheckRunResponse.model_validate(run_check(db, article, key, user.id)).model_dump(mode="json"))
        except FileNotFoundError as e:
            failed.append({"module": key, "error_message": str(e)})
    return {"runs": runs, "not_implemented": skipped, "failed": failed}


@router.post("/articles/{article_id}/checks/{module}/run", response_model=JournalCheckRunResponse)
def run_single_check(article_id: int, module: str, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    article = _get_article(db, article_id)
    check = REGISTRY.get(module)
    if check is not None and check.auto_only:
        raise HTTPException(status_code=409, detail=f"The '{module}' check runs automatically when a new InDesign layout is generated")
    try:
        return run_check(db, article, module, user.id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown check '{module}'. Known checks: {', '.join(REGISTRY)}")
    except CheckNotImplemented:
        raise HTTPException(status_code=501, detail=f"The '{module}' check is not implemented yet")
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"{e}.")


@router.get("/articles/{article_id}/check-runs", response_model=List[JournalCheckRunResponse])
def list_check_runs(article_id: int, module: Optional[str] = None, db: Session = Depends(get_db)):
    _get_article(db, article_id)
    query = db.query(JournalCheckRun).filter(JournalCheckRun.article_id == article_id)
    if module:
        query = query.filter(JournalCheckRun.module == module)
    return query.order_by(JournalCheckRun.id.desc()).all()


@router.get("/articles/{article_id}/issues", response_model=List[JournalIssueResponse])
def list_issues(
    article_id: int,
    module: Optional[str] = None,
    severity: Optional[str] = None,
    issue_status: Optional[str] = None,
    include_superseded: bool = False,
    db: Session = Depends(get_db),
):
    _get_article(db, article_id)
    query = db.query(JournalIssue).filter(JournalIssue.article_id == article_id)
    if module:
        query = query.filter(JournalIssue.module == module)
    if severity:
        query = query.filter(JournalIssue.severity == severity)
    if issue_status:
        query = query.filter(JournalIssue.status == issue_status)
    elif not include_superseded:
        query = query.filter(JournalIssue.status != "superseded")
    return query.order_by(JournalIssue.id).all()


@router.patch("/articles/{article_id}/issues/{issue_id}", response_model=JournalIssueResponse)
def update_issue(
    article_id: int,
    issue_id: int,
    body: JournalIssueAction,
    db: Session = Depends(get_db),
    user=Depends(require_journal_user),
):
    issue = db.query(JournalIssue).filter(JournalIssue.id == issue_id, JournalIssue.article_id == article_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    if issue.status == "superseded":
        raise HTTPException(status_code=409, detail="This issue was replaced by a newer check run")

    if body.action == "reopen":
        issue.status, issue.resolution, issue.resolved_by_id, issue.resolved_at = "open", None, None, None
    elif body.action == "ignore":
        if issue.severity == "error":
            raise HTTPException(status_code=422, detail="Errors cannot be ignored. Fix the issue or accept its suggested fix.")
        issue.status, issue.resolution = "ignored", "ignored"
        issue.resolved_by_id, issue.resolved_at = user.id, datetime.utcnow()
    else:
        # Applying the suggestion to the XHTML as a tracked change is added with the Week 2 editor.
        kind = (issue.suggestion or {}).get("type")
        issue.status = "fixed"
        issue.resolution = "signed_off" if kind == "signoff" else "accepted_fix" if issue.suggestion else "manual_edit"
        issue.resolved_by_id, issue.resolved_at = user.id, datetime.utcnow()

    db.commit()
    db.refresh(issue)
    return issue


def _open_counts(db: Session, article_id: int, modules: List[str]):
    counts = {}
    for issue in db.query(JournalIssue).filter(JournalIssue.article_id == article_id, JournalIssue.status == "open",
                                               JournalIssue.module.in_(modules)).all():
        counts.setdefault(issue.module, {"error": 0, "warning": 0, "info": 0})[issue.severity] += 1
    return counts


def _file_info(row):
    if row is None:
        return None
    return {"id": row.id, "filename": row.filename, "category": row.category, "version": row.version, "uploaded_at": row.uploaded_at}


@router.get("/articles/{article_id}/workspace")
def article_workspace(article_id: int, db: Session = Depends(get_db)):
    """Everything the article editor shows, without re-running any processing."""
    from app.domains.journals.checks.structuring import active_stylesheet

    article = _get_article(db, article_id)
    journal = db.query(Journal).filter(Journal.id == article.journal_id).first()
    stages = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id) \
        .order_by(JournalStageDetail.stage_number).all()
    xhtml_row = latest_file(db, article_id, "XHTML")
    xhtml = None
    if xhtml_row and os.path.exists(xhtml_row.path):
        with open(xhtml_row.path, encoding="utf-8") as fh:
            xhtml = fh.read()
    jats_row = latest_file(db, article_id, "JATS_XML")
    if jats_row and not os.path.exists(jats_row.path):
        jats_row = None
    last_runs = {}
    for run in db.query(JournalCheckRun).filter(JournalCheckRun.article_id == article_id).order_by(JournalCheckRun.id).all():
        last_runs[run.module] = JournalCheckRunResponse.model_validate(run).model_dump(mode="json")
    sheet = active_stylesheet(db, article)
    grammar = db.query(JournalGrammarsheet).filter(JournalGrammarsheet.journal_id == article.journal_id,
                                                   JournalGrammarsheet.is_active == True).order_by(JournalGrammarsheet.id.desc()).first()  # noqa: E712
    return {
        "article": {
            "id": article.id, "journal_id": article.journal_id, "article_title": article.article_title,
            "article_doi": article.article_doi, "current_stage": article.current_stage, "status": article.status,
        },
        "journal": {"id": journal.id, "journal_code": journal.journal_code, "journal_title": journal.journal_title} if journal else None,
        "stages": [ArticleStageStatus(stage_number=s.stage_number, stage_name=s.stage_name, stage_status=s.stage_status,
                                      assignee_id=s.assignee_id, planned_end_date=s.planned_end_date).model_dump(mode="json") for s in stages],
        "xhtml": {"file": _file_info(xhtml_row), "content": xhtml} if xhtml is not None else None,
        "jats": _file_info(jats_row) if jats_row else None,  # the editor shows the XML tab once this exists
        "pre_editing": _pre_editing_status(db, article),
        "check_runs": last_runs,
        "open_issues": _open_counts(db, article_id, list(CHECK_STAGES)),
        "stylesheet": sheet.name if sheet else None,
        "grammarsheet": grammar.name if grammar else None,
        # Saved in a book review page since the last XHTML: the editor offers to refresh.
        "working_copy_changed": _working_copy_changed(article),
    }


def _pre_editing_status(db, article):
    from app.domains.journals.pre_editing import step_status
    return step_status(db, article)


def _working_copy_changed(article):
    from app.domains.journals.book_review import working_copy_changed
    return working_copy_changed(article)


# --- Stage 4: JATS XML Conversion & DTD Validation ---
@router.post("/articles/{article_id}/xml/convert")
def convert_article_to_jats(article_id: int, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    """Windows XSLT server when JATS_XSLT_URL is set, else (or on failure) the built-in converter; then DTD validation."""
    from app.domains.journals.production import convert_to_jats

    article = _get_article(db, article_id)
    try:
        result = convert_to_jats(db, article, user.id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"{e}. Upload the manuscript first.")
    return {
        "converter": result["converter"],
        "fallback_reason": result["fallback_reason"],
        "file": _file_info(result["file"]),
        "check_run": JournalCheckRunResponse.model_validate(result["check_run"]).model_dump(mode="json"),
        "open_issues": _open_counts(db, article_id, ["xml"]),
    }


@router.post("/articles/{article_id}/xml/validate", response_model=JournalCheckRunResponse)
def validate_article_jats(article_id: int, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    article = _get_article(db, article_id)
    try:
        return run_check(db, article, "xml", user.id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"{e}.")


def _xml_findings(db: Session, article_id: int, content: str) -> List[dict]:
    """DTD + publisher-rule findings for the XML editor: line-numbered, like a validation log."""
    from app.domains.journals.files import art_file_paths
    from app.domains.journals.jats.validator import validate_jats
    assets = [os.path.basename(p) for p in art_file_paths(db, article_id)]
    return [{"line": f.line, "severity": f.severity, "rule_id": f.rule_id, "title": f.title, "message": f.message}
            for f in validate_jats(content.encode("utf-8"), assets=assets)]


@router.get("/articles/{article_id}/xml")
def get_article_jats(article_id: int, db: Session = Depends(get_db)):
    article = _get_article(db, article_id)
    row = latest_file(db, article_id, "JATS_XML")
    if not row or not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="No JATS XML exists for this article yet")
    with open(row.path, encoding="utf-8") as fh:
        content = fh.read()
    return {"file": _file_info(row), "content": content, "is_current": row.path == article.jats_xml_path,
            "findings": _xml_findings(db, article_id, content)}


@router.get("/articles/{article_id}/xml/layout-html")
def get_article_layout_html(article_id: int, db: Session = Depends(get_db)):
    """Generate layout HTML preview from the latest JATS XML of an article."""
    from fastapi.responses import HTMLResponse
    from app.processing.xml_engine import XMLEngine
    article = _get_article(db, article_id)
    row = latest_file(db, article_id, "JATS_XML")
    if not row or not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="No JATS XML exists for this article yet")
    try:
        html_str = XMLEngine.generate_layout_html(db, row.path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate layout HTML: {str(e)}")

    return HTMLResponse(
        content=html_str,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    )



class XmlContentBody(BaseModel):
    content: str


@router.post("/articles/{article_id}/xml/lint")
def lint_article_jats(article_id: int, body: XmlContentBody, db: Session = Depends(get_db)):
    """Validate XML from the editor against the JATS 1.3 DTD without saving it."""
    _get_article(db, article_id)
    return {"findings": _xml_findings(db, article_id, body.content)}


@router.put("/articles/{article_id}/xml")
def save_article_jats(article_id: int, body: XmlContentBody, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    """Save hand edits from the XML editor as the next JATS XML version, then re-run the XML & DTD check.
    XML that is not well-formed is refused, so every stored version can be parsed."""
    from lxml import etree
    article = _get_article(db, article_id)
    try:
        etree.fromstring(body.content.encode("utf-8"), etree.XMLParser(load_dtd=False, no_network=True, resolve_entities=False))
    except etree.XMLSyntaxError as e:
        raise HTTPException(status_code=422, detail=f"XML is not well-formed (line {getattr(e, 'lineno', '?')}): {e}")
    base = re.sub(r"[^\w.-]+", "_", article.article_doi or f"article_{article.id}")
    row = save_version(db, article, "JATS_XML", f"{base}.xml", body.content.encode("utf-8"), "xml")
    article.jats_xml_path = row.path
    db.commit()
    run = run_check(db, article, "xml", user.id)
    return {
        "file": _file_info(row),
        "check_run": JournalCheckRunResponse.model_validate(run).model_dump(mode="json"),
        "open_issues": _open_counts(db, article_id, ["xml"]),
        "findings": _xml_findings(db, article_id, body.content),
    }


# --- Stages 5-7: InDesign, Final QC, Proof ---
@router.post("/articles/{article_id}/indesign/generate", status_code=status.HTTP_202_ACCEPTED)
def generate_indesign(article_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                      user=Depends(require_journal_user)):
    from app.domains.journals.production import preflight_indesign, run_indesign_job

    article = _get_article(db, article_id)
    problem = preflight_indesign(db, article)
    if problem:
        raise HTTPException(status_code=409, detail=problem)
    stage5 = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id,
                                                 JournalStageDetail.stage_number == INDESIGN).first()
    if stage5:
        stage5.remarks = "InDesign generation queued"
        db.commit()
    background_tasks.add_task(run_indesign_job, article_id, user.id)
    return {"status": "queued", "message": "InDesign generation started. Check the status endpoint for results."}


@router.get("/articles/{article_id}/indesign")
def indesign_status(article_id: int, db: Session = Depends(get_db)):
    _get_article(db, article_id)
    stage5 = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id,
                                                 JournalStageDetail.stage_number == INDESIGN).first()
    return {
        "status": stage5.remarks if stage5 else None,
        "indd": _file_info(latest_file(db, article_id, "INDD")),
        "idml": _file_info(latest_file(db, article_id, "IDML")),
        "proof_pdf": _file_info(latest_file(db, article_id, "Proof_PDF")),
        "preflight": _file_info(latest_file(db, article_id, "Preflight")),
        "open_issues": _open_counts(db, article_id, ["indesign_qc", "proof"]),
    }


class IaRulesBody(BaseModel):
    selected_ia_rows: List[dict]
    name: Optional[str] = None


@router.get("/{journal_id}/ia-rules")
def get_ia_rules(journal_id: int, db: Session = Depends(get_db)):
    """IA rule catalog plus this journal's selection (the book Technical page's editorial stylesheet)."""
    import json
    from app.domains.journals.book_review import ia_catalog, journal_ia_stylesheet
    journal = _get_journal(db, journal_id)
    project, sheet = journal_ia_stylesheet(db, journal)
    db.commit()
    return {
        "catalog": ia_catalog(),
        "selected": json.loads(sheet.selected_ia_rows or "[]") if sheet else [],
        "stylesheet": {"id": sheet.id, "name": sheet.name, "updated_at": sheet.updated_at} if sheet else None,
        "project_id": project.id,
    }


@router.put("/{journal_id}/ia-rules")
def save_ia_rules(journal_id: int, body: IaRulesBody, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    from app.domains.journals.book_review import save_journal_ia_rules
    journal = _get_journal(db, journal_id)
    project, sheet, rows = save_journal_ia_rules(db, journal, body.selected_ia_rows, user.id, body.name)
    return {"selected": rows, "stylesheet": {"id": sheet.id, "name": sheet.name, "updated_at": sheet.updated_at},
            "project_id": project.id}


@router.delete("/articles/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db)):
    """Delete an article with its stages, checks, issues, files on disk and its shadow book review file."""
    from app.domains.journals.files import article_dir, storage_root
    from app.services.file_service import delete_file_and_capture_context

    article = _get_article(db, article_id)
    title = article.article_title
    root = os.path.abspath(str(storage_root()))
    folder = os.path.abspath(article_dir(article))
    # Uploaded files (e.g. incoming/<batch>/) that belong only to this article.
    own_files = [f.path for f in db.query(JournalFile).filter(JournalFile.article_id == article_id).all() if f.path]
    review_file_id = article.review_file_id
    article.review_file_id = None
    db.flush()
    if review_file_id:
        delete_file_and_capture_context(db, file_id=review_file_id)  # book comments, versions, language jobs cascade
    db.query(JournalIssue).filter(JournalIssue.article_id == article_id).delete(synchronize_session=False)
    db.query(JournalCheckRun).filter(JournalCheckRun.article_id == article_id).delete(synchronize_session=False)
    db.delete(article)
    db.commit()

    removed = 0
    for p in own_files:
        ap = os.path.abspath(p)
        if ap.startswith(root + os.sep) and os.path.isfile(ap):  # never touch anything outside journal storage
            os.remove(ap)
            removed += 1
    if folder.startswith(root + os.sep) and os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    return {"status": "deleted", "article_id": article_id, "title": title, "files_removed": removed}


@router.post("/articles/{article_id}/review-file")
def open_in_book_review(article_id: int, db: Session = Depends(get_db)):
    """Shadow book file for the book Structuring / Technical / Language review pages: {file_id, project_id}."""
    from app.domains.journals.book_review import NoWorkingCopy, ensure_review_file
    article = _get_article(db, article_id)
    try:
        return ensure_review_file(db, article)
    except NoWorkingCopy as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/articles/{article_id}/references/process", status_code=status.HTTP_202_ACCEPTED)
def process_references(article_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                       user=Depends(require_journal_user)):
    """Stage 1: reference structuring (bib_* styles, bookmarks, citation links) and validation, in the background."""
    from app.domains.journals.manuscript import resolve_manuscript_path
    from app.domains.journals.production import REF_JOB_PREFIX, reference_options, run_reference_job

    article = _get_article(db, article_id)
    if not resolve_manuscript_path(db, article):
        raise HTTPException(status_code=400, detail="No manuscript DOCX is attached to this article")
    stage1 = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id, JournalStageDetail.stage_number == 1).first()
    if stage1:
        stage1.remarks = REF_JOB_PREFIX + "running"
        db.commit()
    background_tasks.add_task(run_reference_job, article_id, user.id)
    return {"status": "queued", "engine": reference_options(db, article)["engine"]}


@router.get("/articles/{article_id}/references")
def reference_status(article_id: int, db: Session = Depends(get_db)):
    from app.domains.journals.production import REF_JOB_PREFIX
    _get_article(db, article_id)
    stage1 = db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article_id, JournalStageDetail.stage_number == 1).first()
    remarks = stage1.remarks if stage1 and (stage1.remarks or "").startswith(REF_JOB_PREFIX) else None
    reports = db.query(JournalFile).filter(JournalFile.article_id == article_id, JournalFile.category == "Reference_Report") \
        .order_by(JournalFile.id.desc()).all()
    return {"status": remarks[len(REF_JOB_PREFIX):] if remarks else None,
            "reports": [_file_info(r) for r in reports],
            "qa_report": _file_info(next((r for r in reports if r.filename.lower().endswith(".html")), None))}


@router.get("/articles/{article_id}/files/{file_id}/download")
def download_article_file(article_id: int, file_id: int, inline: bool = False, db: Session = Depends(get_db)):
    row = db.query(JournalFile).filter(JournalFile.id == file_id, JournalFile.article_id == article_id).first()
    if not row or not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="File not found")
    if inline:
        # Shown in the browser (View in the file manager): HTML reports, PDFs, images, text and XML.
        import mimetypes
        media = mimetypes.guess_type(row.filename)[0] or "application/octet-stream"
        if media.startswith(("text/", "image/")) or media in ("application/pdf", "application/xml"):
            return FileResponse(row.path, media_type=media)
    return FileResponse(row.path, filename=row.filename)


# --- Article file manager: folders, history, restore, zips, delivery ---
def _zip_response(data: bytes, filename: str):
    from fastapi.responses import Response
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/articles/{article_id}/folders")
def article_folders(article_id: int, db: Session = Depends(get_db)):
    """Manuscript / Art / XML / InDesign / Proof / Final delivery / Backup, each with the latest version of its files."""
    from app.domains.journals.article_files import folder_listing
    article = _get_article(db, article_id)
    journal = article.journal
    return {
        "article": {"id": article.id, "article_title": article.article_title, "article_doi": article.article_doi,
                    "current_stage": article.current_stage, "status": article.status},
        "journal": {"id": journal.id, "journal_code": journal.journal_code, "journal_title": journal.journal_title,
                    "client_code": journal.client.client_code if journal.client else None,
                    "client_id": journal.client_id, "volume": journal.volume, "issue": journal.issue} if journal else None,
        **folder_listing(db, article),
    }


@router.get("/articles/{article_id}/files/{file_id}/versions")
def article_file_versions(article_id: int, file_id: str, db: Session = Depends(get_db)):
    """Every version of the file's document, oldest first ("working" = the working copy and its snapshots)."""
    from app.domains.journals.article_files import history
    try:
        return history(db, _get_article(db, article_id), file_id)
    except (LookupError, ValueError):
        raise HTTPException(status_code=404, detail="File not found")


@router.post("/articles/{article_id}/files/{file_id}/restore")
def restore_article_file(article_id: int, file_id: int, db: Session = Depends(get_db), user=Depends(require_journal_user)):
    """Make an older version current again as the next version (nothing is overwritten)."""
    from app.domains.journals.article_files import restore
    article = _get_article(db, article_id)
    row = db.query(JournalFile).filter(JournalFile.id == file_id, JournalFile.article_id == article_id).first()
    if not row or not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        message, new_row = restore(db, article, row, user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if new_row is not None and new_row.category == "JATS_XML":
        run_check(db, article, "xml", user.id)
    return {"message": message, "file": _file_info(new_row)}


@router.delete("/articles/{article_id}/files/{file_id}")
def delete_article_file(article_id: int, file_id: int, db: Session = Depends(get_db)):
    """Delete an uploaded file. The original upload and files the article currently uses are protected."""
    from app.domains.journals.article_files import current_paths
    from app.domains.journals.files import storage_root
    article = _get_article(db, article_id)
    row = db.query(JournalFile).filter(JournalFile.id == file_id, JournalFile.article_id == article_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    if row.path in current_paths(article):
        raise HTTPException(status_code=409, detail=f"{row.filename} is in use by the article (original upload or current version) and cannot be deleted")
    if row.category == "Working_Copy":
        raise HTTPException(status_code=409, detail="Working-copy snapshots are kept for the archive")
    path, name = row.path, row.filename
    db.delete(row)
    db.commit()
    try:
        if os.path.exists(path) and os.path.abspath(path).startswith(os.path.abspath(str(storage_root()))):
            os.remove(path)
    except OSError:
        logger.warning("Could not remove %s from disk", path)
    return {"status": "deleted", "filename": name}


class BulkDownloadBody(BaseModel):
    file_ids: List[str]


@router.post("/articles/{article_id}/files/bulk-download")
def bulk_download_article_files(article_id: int, body: BulkDownloadBody, db: Session = Depends(get_db)):
    """The selected files as one zip ("working" = the working copy)."""
    from app.domains.journals.article_files import build_zip
    article = _get_article(db, article_id)
    ids = [int(i) for i in body.file_ids if str(i).isdigit()]
    rows = db.query(JournalFile).filter(JournalFile.article_id == article_id, JournalFile.id.in_(ids)).all() if ids else []
    entries = [(r.path, r.filename) for r in rows]
    if "working" in body.file_ids and article.edited_docx_path:
        entries.append((article.edited_docx_path, os.path.basename(article.edited_docx_path)))
    if not entries:
        raise HTTPException(status_code=400, detail="Select at least one file")
    return _zip_response(build_zip(entries), f"article_{article_id}_files.zip")


@router.get("/articles/{article_id}/archive")
def download_article_archive(article_id: int, db: Session = Depends(get_db)):
    """Every file and version of the article in one zip, arranged by folder."""
    from app.domains.journals.article_files import archive_entries, build_zip
    article = _get_article(db, article_id)
    code = re.sub(r"[^\w.-]+", "_", article.article_doi or f"article_{article_id}")
    return _zip_response(build_zip(archive_entries(db, article)), f"{code}_archive.zip")


class DeliveryBody(BaseModel):
    include_indesign: bool = True
    include_art: bool = True


@router.post("/articles/{article_id}/delivery")
def create_article_delivery(article_id: int, body: Optional[DeliveryBody] = None, db: Session = Depends(get_db),
                            user=Depends(require_journal_user)):
    """Build the client package (current JATS XML, proof, InDesign, art) as the next Delivery_ZIP version.
    At Final Delivery this also completes the article. Sending to the client's server is not built yet;
    the package is downloaded from the Final delivery folder."""
    from app.domains.journals.article_files import build_delivery
    from app.domains.journals.checks.runner import stage_number
    from app.domains.journals.service import DELIVERY
    article = _get_article(db, article_id)
    body = body or DeliveryBody()
    try:
        row, readiness = build_delivery(db, article, body.include_indesign, body.include_art, user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    completed = False
    if stage_number(article.current_stage) == DELIVERY and article.status != "Completed":
        advance_article_stage(db, article_id, remarks=f"Delivery package {row.filename}")
        completed = True
    return {"file": _file_info(row), "readiness": readiness, "completed": completed}


@router.get("/articles/{article_id}/files/latest")
def download_latest_article_file(article_id: int, ext: str = "docx", db: Session = Depends(get_db)):
    """Downloads the latest file of type ext (docx, xhtml, xml, pdf, indd) for the given article."""
    from app.domains.journals.files import latest_file
    from app.domains.journals.manuscript import resolve_manuscript_path

    article = _get_article(db, article_id)
    ext_clean = ext.lower().lstrip(".")

    file_path = None
    filename = None

    if ext_clean == "docx":
        file_path = resolve_manuscript_path(db, article)
        if not file_path or not os.path.exists(file_path):
            row = latest_file(db, article_id, "Manuscript") or latest_file(db, article_id, "Working_Copy")
            if row and row.path and os.path.exists(row.path):
                file_path = row.path
                filename = row.filename
    elif ext_clean in ["xhtml", "html"]:
        if article.xhtml_path and os.path.exists(article.xhtml_path):
            file_path = article.xhtml_path
        else:
            row = latest_file(db, article_id, "XHTML")
            if row and row.path and os.path.exists(row.path):
                file_path = row.path
                filename = row.filename
    elif ext_clean == "xml":
        if article.jats_xml_path and os.path.exists(article.jats_xml_path):
            file_path = article.jats_xml_path
        else:
            row = latest_file(db, article_id, "JATS_XML")
            if row and row.path and os.path.exists(row.path):
                file_path = row.path
                filename = row.filename
    elif ext_clean == "pdf":
        if article.proof_pdf_path and os.path.exists(article.proof_pdf_path):
            file_path = article.proof_pdf_path
        else:
            row = latest_file(db, article_id, "Proof_PDF")
            if row and row.path and os.path.exists(row.path):
                file_path = row.path
                filename = row.filename
    elif ext_clean in ["indd", "idml"]:
        if article.indesign_path and os.path.exists(article.indesign_path):
            file_path = article.indesign_path
        else:
            row = latest_file(db, article_id, "INDD") or latest_file(db, article_id, "IDML")
            if row and row.path and os.path.exists(row.path):
                file_path = row.path
                filename = row.filename

    # Universal fallback: query any JournalFile matching extension for this article
    if not file_path or not os.path.exists(file_path):
        all_files = db.query(JournalFile).filter(JournalFile.article_id == article_id).all()
        for f in all_files:
            if f.path and os.path.exists(f.path) and f.filename.lower().endswith(f".{ext_clean}"):
                file_path = f.path
                filename = f.filename
                break

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"No .{ext_clean} file is available for article #{article_id} yet.")

    if not filename:
        filename = os.path.basename(file_path)

    return FileResponse(file_path, filename=filename)




@router.get("/articles/{article_id}/proof")
def download_proof(article_id: int, db: Session = Depends(get_db)):
    _get_article(db, article_id)
    row = latest_file(db, article_id, "Proof_PDF")
    if not row or not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="No proof PDF has been generated yet")
    return FileResponse(row.path, media_type="application/pdf", filename=row.filename)


# --- Workflows, overviews and batch upload (client -> journal -> articles pages) ---
def _workflow_out(wf: JournalWorkflow) -> JournalWorkflowResponse:
    return JournalWorkflowResponse(id=wf.id, name=wf.name, description=wf.description, stage_numbers=sorted(set(wf.stage_numbers)),
                                   stages=stage_names(wf.stage_numbers), is_default=wf.is_default, is_active=wf.is_active)


def _is_delayed(article: JournalArticle, stages) -> bool:
    if article.status == "Completed":
        return False
    if any(s.delayed for s in stages):
        return True
    due = article.due_date
    if due is None:
        return False
    now = datetime.now(due.tzinfo) if due.tzinfo else datetime.utcnow()
    return due < now


def _article_counts(db: Session, journal_ids: List[int]):
    """{journal_id: ArticleCounts}"""
    counts = {jid: ArticleCounts() for jid in journal_ids}
    if not journal_ids:
        return counts
    articles = db.query(JournalArticle).filter(JournalArticle.journal_id.in_(journal_ids)).all()
    stages_by_article = {}
    if articles:
        for s in db.query(JournalStageDetail).filter(JournalStageDetail.article_id.in_([a.id for a in articles])).all():
            stages_by_article.setdefault(s.article_id, []).append(s)
    for a in articles:
        c = counts[a.journal_id]
        c.total += 1
        if a.status == "Completed":
            c.completed += 1
        else:
            c.in_progress += 1
        if _is_delayed(a, stages_by_article.get(a.id, [])):
            c.delayed += 1
    return counts


@router.get("/workflows", response_model=List[JournalWorkflowResponse])
def list_workflows(db: Session = Depends(get_db)):
    ensure_default_workflows(db)
    rows = db.query(JournalWorkflow).filter(JournalWorkflow.is_active == True).order_by(JournalWorkflow.is_default.desc(), JournalWorkflow.id).all()  # noqa: E712
    return [_workflow_out(w) for w in rows]


@router.post("/workflows", response_model=JournalWorkflowResponse, status_code=status.HTTP_201_CREATED)
def create_workflow(body: JournalWorkflowCreate, db: Session = Depends(get_db)):
    numbers = sorted(set(body.stage_numbers))
    if any(n < 1 or n > len(STAGE_NAMES) for n in numbers):
        raise HTTPException(status_code=400, detail=f"Stage numbers must be between 1 and {len(STAGE_NAMES)}")
    if db.query(JournalWorkflow).filter(JournalWorkflow.name == body.name).first():
        raise HTTPException(status_code=400, detail="A workflow with this name already exists")
    if body.is_default:
        db.query(JournalWorkflow).update({JournalWorkflow.is_default: False})
    wf = JournalWorkflow(name=body.name, description=body.description, stage_numbers=numbers, is_default=body.is_default)
    db.add(wf)
    db.commit()
    db.refresh(wf)
    return _workflow_out(wf)


@router.get("/clients/overview", response_model=List[JournalClientOverview])
def clients_overview(db: Session = Depends(get_db)):
    clients = db.query(JournalClient).filter(JournalClient.active_status == True).order_by(JournalClient.publisher_name).all()  # noqa: E712
    journals = db.query(Journal).filter(Journal.client_id.in_([c.id for c in clients])).all() if clients else []
    per_journal = _article_counts(db, [j.id for j in journals])
    out = []
    for c in clients:
        own = [j for j in journals if j.client_id == c.id]
        total = ArticleCounts()
        for j in own:
            jc = per_journal[j.id]
            total.total += jc.total
            total.in_progress += jc.in_progress
            total.completed += jc.completed
            total.delayed += jc.delayed
        row = JournalClientOverview.model_validate(c, from_attributes=True)
        row.journal_count, row.articles = len(own), total
        out.append(row)
    return out


@router.get("/clients/{client_id}", response_model=JournalClientResponse)
def get_journal_client(client_id: int, db: Session = Depends(get_db)):
    client = db.query(JournalClient).filter(JournalClient.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Journal client not found")
    return client


def _journal_overviews(db: Session, journals: List[Journal]) -> List[JournalOverview]:
    counts = _article_counts(db, [j.id for j in journals])
    clients = {c.id: c for c in db.query(JournalClient).filter(JournalClient.id.in_({j.client_id for j in journals})).all()} if journals else {}
    out = []
    for j in journals:
        row = JournalOverview.model_validate(j, from_attributes=True)
        c = clients.get(j.client_id)
        row.client_code = c.client_code if c else None
        row.publisher_name = c.publisher_name if c else None
        row.stages = stage_names(j.workflow.stage_numbers) if j.workflow else list(STAGE_NAMES)
        row.articles = counts[j.id]
        row.setup = _setup_status(db, j.id)
        out.append(row)
    return out


def _setup_status(db: Session, journal_id: int):
    from app.domains.journals.files import active_assets
    from app.domains.journals.schemas import JournalSetupStatus
    templates = active_assets(db, journal_id, "template")
    sheet = db.query(JournalStylesheet).filter(JournalStylesheet.journal_id == journal_id, JournalStylesheet.is_active == True) \
        .order_by(JournalStylesheet.id.desc()).first()  # noqa: E712
    grammar = db.query(JournalGrammarsheet).filter(JournalGrammarsheet.journal_id == journal_id, JournalGrammarsheet.is_active == True) \
        .order_by(JournalGrammarsheet.id.desc()).first()  # noqa: E712
    return JournalSetupStatus(
        template=templates[0].filename if templates else None, template_version=templates[0].version if templates else None,
        fonts=len(active_assets(db, journal_id, "font")),
        stylesheet=sheet.name if sheet else None, grammarsheet=grammar.name if grammar else None,
    )


@router.get("/overview", response_model=List[JournalOverview])
def journals_overview(client_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Journal)
    if client_id:
        query = query.filter(Journal.client_id == client_id)
    return _journal_overviews(db, query.order_by(Journal.journal_title).all())


@router.get("/{journal_id}/articles", response_model=List[JournalArticleRow])
def journal_article_rows(journal_id: int, db: Session = Depends(get_db)):
    """Articles of a journal with their per-stage status, like a book's chapter list."""
    from app.domains.auth.models import User

    _get_journal(db, journal_id)
    articles = db.query(JournalArticle).filter(JournalArticle.journal_id == journal_id).order_by(JournalArticle.id).all()
    ids = [a.id for a in articles]
    stages, errors = {}, {}
    if ids:
        for s in db.query(JournalStageDetail).filter(JournalStageDetail.article_id.in_(ids)).order_by(JournalStageDetail.stage_number).all():
            stages.setdefault(s.article_id, []).append(s)
        for i in db.query(JournalIssue).filter(JournalIssue.article_id.in_(ids), JournalIssue.status == "open", JournalIssue.severity == "error").all():
            errors[i.article_id] = errors.get(i.article_id, 0) + 1
    user_ids = {a.current_assignee_id for a in articles if a.current_assignee_id}
    names = {u.id: (" ".join(p for p in (u.first_name, u.last_name) if p) or u.username)
             for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    rows = []
    for a in articles:
        own = stages.get(a.id, [])
        assignee_name = names.get(a.current_assignee_id) or a.assigned_user_name
        rows.append(JournalArticleRow(
            id=a.id, article_doi=a.article_doi, article_title=a.article_title, article_type=a.article_type,
            lead_author=a.lead_author, current_stage=a.current_stage, status=a.status, priority=a.priority,
            complexity_level=a.complexity_level or "Medium", due_date=a.due_date, revised_due_date=a.revised_due_date,
            current_assignee_id=a.current_assignee_id, current_assignee_name=assignee_name,
            delayed=_is_delayed(a, own), delay_category=a.delay_category, delay_reason=a.delay_reason,
            delay_days=a.delay_days or 0, open_errors=errors.get(a.id, 0), created_at=a.created_at,
            stages=[ArticleStageStatus(stage_number=s.stage_number, stage_name=s.stage_name, stage_status=s.stage_status,
                                       assignee_id=s.assignee_id, planned_end_date=s.planned_end_date) for s in own],
        ))
    return rows


@router.post("/{journal_id}/articles/upload")
async def upload_articles(journal_id: int, background_tasks: BackgroundTasks, files: List[UploadFile] = File(...),
                          db: Session = Depends(get_db), user=Depends(require_journal_user)):
    """Create one article per uploaded .docx manuscript or .zip package, using the journal's workflow.
    Pre-Editing step 1 (Structuring) starts in the background for each new article."""
    from app.domains.journals.art import figure_from_name
    from app.domains.journals.files import incoming_dir
    from app.domains.journals.metadata_extractor import extract_docx_metadata_advanced, process_uploaded_zip_package

    journal = _get_journal(db, journal_id)
    created, failed = [], []
    for upload in files:
        name = os.path.basename(upload.filename or "")
        ext = os.path.splitext(name)[1].lower()
        if ext not in (".docx", ".zip"):
            failed.append({"filename": name, "error": "Only .docx manuscripts and .zip packages are accepted"})
            continue
        batch_dir = incoming_dir(journal)
        path = os.path.join(batch_dir, name)
        with open(path, "wb") as fh:
            shutil.copyfileobj(upload.file, fh)
        try:
            if ext == ".zip":
                meta = process_uploaded_zip_package(path, os.path.join(batch_dir, "package"))
                docx_path = meta.get("primary_docx_path")
                extracted = meta.pop("extracted_files", [])
                if not docx_path:
                    failed.append({"filename": name, "error": "The ZIP contains no .docx manuscript"})
                    continue
            else:
                meta = extract_docx_metadata_advanced(path)
                docx_path = path
                extracted = [{"filename": name, "full_path": path, "category": "Manuscript", "ext": ".docx"}]
        except Exception as e:
            failed.append({"filename": name, "error": f"Could not read the file: {e}"})
            continue

        doi = (meta.get("article_doi") or "").strip() or None
        if doi and db.query(JournalArticle).filter(JournalArticle.article_doi == doi).first():
            failed.append({"filename": name, "error": f"An article with DOI {doi} already exists"})
            continue
        keywords = meta.get("keywords")
        article = JournalArticle(
            journal_id=journal_id, article_doi=doi,
            article_title=(meta.get("article_title") or "").strip() or os.path.splitext(name)[0],
            lead_author=meta.get("lead_author"), abstract=meta.get("abstract"),
            keywords=keywords if isinstance(keywords, list) else None,
            extracted_metadata={k: v for k, v in meta.items() if isinstance(v, (str, int, float, bool, list, dict, type(None)))},
            word_count=meta.get("word_count") if isinstance(meta.get("word_count"), int) else None,
            original_docx_path=docx_path, status="In-progress",
        )
        db.add(article)
        db.flush()
        for item in extracted:
            is_art = item["category"] == "Art"
            db.add(JournalFile(article_id=article.id, filename=item["filename"], file_type=item["ext"].lstrip(".").lower(),
                               category=item["category"], path=item["full_path"], uploaded_by_id=user.id,
                               figure_number=figure_from_name(item["filename"]) if is_art else None))
        db.commit()
        initialize_article_stages(db, article)
        _queue_structuring(background_tasks, article.id, user.id)
        created.append({"id": article.id, "article_title": article.article_title, "article_doi": article.article_doi,
                        "current_stage": article.current_stage, "filename": name})
    return {"created": created, "failed": failed}


def _queue_structuring(background_tasks: BackgroundTasks, article_id: int, user_id: Optional[int] = None) -> None:
    """Start Pre-Editing step 1 for a new article (JOURNAL_AUTO_STRUCTURE=0 turns this off)."""
    if os.getenv("JOURNAL_AUTO_STRUCTURE", "1") == "0":
        return
    from app.domains.journals.pre_editing import run_structuring_background
    background_tasks.add_task(run_structuring_background, article_id, user_id)


# --- Journal design pack (template, fonts, library, logo, css) ---
ASSET_EXTENSIONS = {
    "template": {".indt", ".indd", ".idml"}, "font": {".otf", ".ttf", ".ttc"}, "library": {".indl"},
    "logo": {".eps", ".pdf", ".svg", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".ai"}, "css": {".css"},
}


def _asset_out(a):
    return {"id": a.id, "kind": a.kind, "filename": a.filename, "version": a.version, "is_active": a.is_active,
            "note": a.note, "size_bytes": a.size_bytes, "uploaded_by_id": a.uploaded_by_id, "uploaded_at": a.uploaded_at}


def _get_asset(db: Session, journal_id: int, asset_id: int):
    from app.domains.journals.models import JournalAsset
    a = db.query(JournalAsset).filter(JournalAsset.id == asset_id, JournalAsset.journal_id == journal_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Design file not found")
    return a


@router.get("/{journal_id}/assets")
def list_assets(journal_id: int, kind: Optional[str] = None, db: Session = Depends(get_db)):
    from app.domains.journals.models import JournalAsset
    _get_journal(db, journal_id)
    q = db.query(JournalAsset).filter(JournalAsset.journal_id == journal_id)
    if kind:
        q = q.filter(JournalAsset.kind == kind)
    return [_asset_out(a) for a in q.order_by(JournalAsset.kind, JournalAsset.filename, JournalAsset.version.desc()).all()]


@router.post("/{journal_id}/assets", status_code=status.HTTP_201_CREATED)
async def upload_assets(journal_id: int, kind: str = Form(...), note: Optional[str] = Form(None),
                        files: List[UploadFile] = File(...), db: Session = Depends(get_db), user=Depends(require_journal_user)):
    from app.domains.journals.files import save_asset
    journal = _get_journal(db, journal_id)
    if kind not in ASSET_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unknown kind '{kind}'. Use one of: {', '.join(ASSET_EXTENSIONS)}")
    saved = []
    for f in files:
        name = os.path.basename(f.filename or "")
        if os.path.splitext(name)[1].lower() not in ASSET_EXTENSIONS[kind]:
            raise HTTPException(status_code=400, detail=f"{name}: a {kind} must be {', '.join(sorted(ASSET_EXTENSIONS[kind]))}")
        saved.append(save_asset(db, journal, kind, name, await f.read(), note=note, user_id=user.id))
    db.commit()
    return [_asset_out(a) for a in saved]


@router.post("/{journal_id}/assets/{asset_id}/activate")
def activate_journal_asset(journal_id: int, asset_id: int, db: Session = Depends(get_db)):
    from app.domains.journals.files import activate_asset
    a = _get_asset(db, journal_id, asset_id)
    activate_asset(db, a)
    db.commit()
    return _asset_out(a)


@router.get("/{journal_id}/assets/{asset_id}/download")
def download_asset(journal_id: int, asset_id: int, db: Session = Depends(get_db)):
    a = _get_asset(db, journal_id, asset_id)
    if not os.path.exists(a.path):
        raise HTTPException(status_code=404, detail="The file is missing from storage")
    return FileResponse(a.path, filename=a.filename)


# --- Article art files ---
class ArtLinkBody(BaseModel):
    figure_number: Optional[int] = None


def _art_file(db: Session, article_id: int, file_id: int) -> JournalFile:
    row = db.query(JournalFile).filter(JournalFile.id == file_id, JournalFile.article_id == article_id,
                                       JournalFile.category == "Art").first()
    if not row:
        raise HTTPException(status_code=404, detail="Art file not found")
    return row


@router.get("/articles/{article_id}/art")
def article_art(article_id: int, db: Session = Depends(get_db)):
    """Current art per figure with measurements and the journal's art checks, and the figures the article cites."""
    from app.domains.journals.art import art_rules, article_figures, check_art, effective_ppi, measure
    from app.domains.journals.checks.structuring import active_stylesheet
    from app.domains.journals.files import art_files

    article = _get_article(db, article_id)
    sheet = active_stylesheet(db, article)
    rules = art_rules(sheet.style_rules if sheet else None)
    counts = {}
    for r in db.query(JournalFile).filter(JournalFile.article_id == article_id, JournalFile.category == "Art").all():
        if r.figure_number is not None:
            counts[r.figure_number] = counts.get(r.figure_number, 0) + 1
    files_out = []
    for r in art_files(db, article_id):
        m = measure(r.path)
        checks = check_art(r.filename, r.figure_number, m, rules)
        files_out.append({
            "id": r.id, "filename": r.filename, "figure_number": r.figure_number, "version": r.version,
            "versions": counts.get(r.figure_number, 1), "uploaded_at": r.uploaded_at, **m, "ppi": effective_ppi(m, rules),
            "checks": checks, "status": "error" if any(c["status"] == "error" for c in checks)
            else "warning" if any(c["status"] == "warning" for c in checks) else "ok",
        })
    figures = []
    for n in sorted(set(article_figures(db, article)) | {f["figure_number"] for f in files_out if f["figure_number"]}):
        f = next((x for x in files_out if x["figure_number"] == n), None)
        figures.append({"number": n, "file_id": f["id"] if f else None, "filename": f["filename"] if f else None,
                        "status": (f["status"] if f else "missing")})
    return {"rules": rules, "figures": figures, "files": files_out}


@router.post("/articles/{article_id}/art", status_code=status.HTTP_201_CREATED)
async def upload_art(article_id: int, files: List[UploadFile] = File(...), figure_number: Optional[int] = Form(None),
                     db: Session = Depends(get_db)):
    """Add or replace art. A file for a figure that already has art becomes that figure's next version."""
    from app.domains.journals.art import figure_from_name
    from app.domains.journals.files import ART_EXTENSIONS, save_version

    article = _get_article(db, article_id)
    saved = []
    for f in files:
        name = os.path.basename(f.filename or "")
        if os.path.splitext(name)[1].lower() not in ART_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"{name} is not an art file ({', '.join(sorted(ART_EXTENSIONS))})")
        fig = figure_number if (figure_number is not None and len(files) == 1) else figure_from_name(name)
        row = save_version(db, article, "Art", name, await f.read(), "art", figure_number=fig)
        saved.append({"id": row.id, "filename": row.filename, "figure_number": row.figure_number, "version": row.version})
    db.commit()
    return saved


@router.patch("/articles/{article_id}/art/{file_id}")
def link_art(article_id: int, file_id: int, body: ArtLinkBody, db: Session = Depends(get_db)):
    row = _art_file(db, article_id, file_id)
    row.figure_number = body.figure_number
    db.commit()
    return {"id": row.id, "filename": row.filename, "figure_number": row.figure_number, "version": row.version}


@router.post("/articles/{article_id}/art/{file_id}/rename")
def rename_art(article_id: int, file_id: int, db: Session = Depends(get_db)):
    """Store a copy named by the journal's pattern (e.g. fig2.tif) as the figure's next version; nothing is overwritten."""
    from app.domains.journals.art import art_rules
    from app.domains.journals.checks.structuring import active_stylesheet
    from app.domains.journals.files import save_version

    article = _get_article(db, article_id)
    row = _art_file(db, article_id, file_id)
    if row.figure_number is None:
        raise HTTPException(status_code=400, detail="Link the file to a figure first")
    sheet = active_stylesheet(db, article)
    pattern = art_rules(sheet.style_rules if sheet else None)["naming"]
    new_name = os.path.splitext(pattern.replace("{n}", str(row.figure_number)))[0] + os.path.splitext(row.filename)[1].lower()
    with open(row.path, "rb") as fh:
        data = fh.read()
    new = save_version(db, article, "Art", new_name, data, "art", figure_number=row.figure_number)
    db.commit()
    return {"id": new.id, "filename": new.filename, "figure_number": new.figure_number, "version": new.version}


@router.get("/articles/{article_id}/art/{file_id}/download")
def download_art(article_id: int, file_id: int, db: Session = Depends(get_db)):
    row = _art_file(db, article_id, file_id)
    if not os.path.exists(row.path):
        raise HTTPException(status_code=404, detail="The file is missing from storage")
    return FileResponse(row.path, filename=row.filename)


@router.get("/{journal_id}", response_model=JournalOverview)
def get_journal(journal_id: int, db: Session = Depends(get_db)):
    return _journal_overviews(db, [_get_journal(db, journal_id)])[0]
