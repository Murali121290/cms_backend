from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel

class StatusPayload(BaseModel):
    active_status: bool

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.workflow import crud
from app.domains.workflow.models import StageDetail, StageMaster
from app.domains.workflow.schemas import (
    RolesMasterCreate, RolesMasterResponse, RolesMasterUpdate,
    StageMasterCreate, StageMasterResponse, StageMasterUpdate,
    ProcessingActionDefinition, ProcessingActionsMappingUpdate,
    StageDetailCreate, StageDetailResponse, StageDetailUpdate, BulkPlannedCreate,
    WorkflowCreate, WorkflowStageResponse, WorkflowUpdate,
    ChapterInfoCreate, ChapterInfoResponse, ChapterInfoUpdate
)

AVAILABLE_PROCESSING_ACTIONS = [
    {
        "key": "structuring",
        "label": "Structuring",
        "description": "Generate structured document tags, styling, and XML markers",
        "icon": "Layers"
    },
    {
        "key": "structuringQa",
        "label": "Run QA Report",
        "description": "Run automated style and structuring QA report",
        "icon": "ShieldCheck"
    },
    {
        "key": "referenceValidation",
        "label": "Reference Validation",
        "description": "Validate citations and references against CrossRef and PubMed APIs",
        "icon": "BookCheck"
    },
    {
        "key": "referenceReview",
        "label": "Reference Review",
        "description": "Review and edit bibliography references in the Reference Editor",
        "icon": "BookCheck"
    },
    {
        "key": "styleValidation",
        "label": "Style Validation & Match",
        "description": "Validate and match manuscript styling against publisher templates",
        "icon": "ShieldCheck"
    },
    {
        "key": "artValidation",
        "label": "Art Validation",
        "description": "Inspect and validate embedded figures, resolution, and color profiles",
        "icon": "Image"
    },
    {
        "key": "languageEdit",
        "label": "Language Edit",
        "description": "Linguistic copyediting for grammar, syntax, and phrasing",
        "icon": "Languages"
    },
    {
        "key": "technicalEdit",
        "label": "Technical Edit",
        "description": "Review mathematical notation, equations, and technical nomenclature",
        "icon": "Wrench"
    },
    {
        "key": "unifiedReview",
        "label": "Review Studio",
        "description": "Unified interactive editor with track changes, comments, and side-by-side view",
        "icon": "Layout"
    },
    {
        "key": "manuscriptAnalysis",
        "label": "Manuscript Analysis",
        "description": "Automated analysis of manuscript content, structural integrity, and word count",
        "icon": "FileOutput"
    },
    {
        "key": "permissionsCheck",
        "label": "Permissions Check",
        "description": "Audit and track third-party copyright, figures, and citation permissions",
        "icon": "ShieldCheck"
    },
    {
        "key": "aiCreditExtraction",
        "label": "AI Credit Extraction",
        "description": "Extract contributor credits, affiliations, and funding sources using AI",
        "icon": "Sparkles"
    },
    {
        "key": "biasScan",
        "label": "Bias Scan",
        "description": "Scan text for cultural, gender, accessibility, or inclusivity bias",
        "icon": "ScanLine"
    },
    {
        "key": "wordToXml",
        "label": "Word to XML",
        "description": "Convert Word DOCX manuscript directly into JATS or BITS XML",
        "icon": "FileCode"
    },
    {
        "key": "wordToIndesign",
        "label": "Word to InDesign",
        "description": "Typeset Word document into Adobe InDesign INDD/IDML layout",
        "icon": "Layers"
    },
    {
        "key": "xmlToIndesign",
        "label": "Generate InDesign (XML to INDD)",
        "description": "Flow structured XML content into an InDesign template layout",
        "icon": "Layers"
    },
    {
        "key": "indesignToXml",
        "label": "InDesign to XML",
        "description": "Extract structured XML from an InDesign document",
        "icon": "FileCode"
    },
    {
        "key": "viewProof",
        "label": "View Proof",
        "description": "Inspect and view rendered page proof PDF",
        "icon": "Eye"
    }
]

router = APIRouter(prefix="/api/v1", tags=["Workflow"])


# ── RolesMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/roles-master", response_model=RolesMasterResponse, status_code=status.HTTP_201_CREATED)
def create_role(data: RolesMasterCreate, db: Session = Depends(get_db)):
    return crud.create_role(db, data)


@router.get("/roles-master", response_model=List[RolesMasterResponse])
def list_roles(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_roles(db, skip=skip, limit=limit)


@router.get("/roles-master/{role_id}", response_model=RolesMasterResponse)
def get_role(role_id: int, db: Session = Depends(get_db)):
    role = crud.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.put("/roles-master/{role_id}", response_model=RolesMasterResponse)
def update_role(role_id: int, data: RolesMasterUpdate, db: Session = Depends(get_db)):
    updated = crud.update_role(db, role_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Role not found")
    return updated


@router.delete("/roles-master/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    if not crud.delete_role(db, role_id):
        raise HTTPException(status_code=404, detail="Role not found")


# ── StageMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/stages", response_model=StageMasterResponse, status_code=status.HTTP_201_CREATED)
def create_stage(data: StageMasterCreate, db: Session = Depends(get_db)):
    return crud.create_stage(db, data)


@router.get("/stages", response_model=List[StageMasterResponse])
def list_stages(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stages(db, skip=skip, limit=limit)


@router.get("/stages/processing-actions/definitions", response_model=List[ProcessingActionDefinition])
def get_processing_action_definitions():
    return AVAILABLE_PROCESSING_ACTIONS


@router.get("/stages/processing-actions/mapping")
def get_processing_actions_mapping(db: Session = Depends(get_db)):
    from sqlalchemy import select
    stages = list(db.execute(select(StageMaster).order_by(StageMaster.id)).scalars().all())
    mapping: dict[str, list[str]] = {a["key"]: [] for a in AVAILABLE_PROCESSING_ACTIONS}
    for stage in stages:
        for action in (stage.processing_actions or []):
            if action in mapping:
                mapping[action].append(stage.stage_name)
            else:
                mapping[action] = [stage.stage_name]
    return {
        "definitions": AVAILABLE_PROCESSING_ACTIONS,
        "mapping": mapping,
        "stages": [{"id": s.id, "stage_name": s.stage_name, "active_status": s.active_status, "processing_actions": s.processing_actions} for s in stages]
    }


@router.put("/stages/processing-actions/mapping")
def update_processing_actions_mapping(data: ProcessingActionsMappingUpdate, db: Session = Depends(get_db)):
    from sqlalchemy import select
    stages = list(db.execute(select(StageMaster)).scalars().all())
    
    # Invert mapping: for each stage name, compute list of action keys
    stage_actions_map: dict[str, list[str]] = {s.stage_name.lower(): [] for s in stages}
    for action_key, stage_names in data.mapping.items():
        for sname in stage_names:
            low = sname.strip().lower()
            if low in stage_actions_map:
                if action_key not in stage_actions_map[low]:
                    stage_actions_map[low].append(action_key)
            else:
                for real_stage in stages:
                    if real_stage.stage_name.lower() == low:
                        if action_key not in stage_actions_map[real_stage.stage_name.lower()]:
                            stage_actions_map[real_stage.stage_name.lower()].append(action_key)

    for stage in stages:
        stage.processing_actions = stage_actions_map.get(stage.stage_name.lower(), [])

    db.commit()
    for s in stages:
        db.refresh(s)

    mapping: dict[str, list[str]] = {a["key"]: [] for a in AVAILABLE_PROCESSING_ACTIONS}
    for stage in stages:
        for action in (stage.processing_actions or []):
            if action in mapping:
                mapping[action].append(stage.stage_name)
            else:
                mapping[action] = [stage.stage_name]

    return {
        "success": True,
        "message": "Processing actions mapping updated successfully",
        "definitions": AVAILABLE_PROCESSING_ACTIONS,
        "mapping": mapping,
        "stages": [{"id": s.id, "stage_name": s.stage_name, "active_status": s.active_status, "processing_actions": s.processing_actions} for s in stages]
    }


def resolve_stage(db: Session, identifier: str):
    from sqlalchemy import select
    if identifier.isdigit():
        return db.execute(select(StageMaster).where(StageMaster.id == int(identifier))).scalars().first()
    else:
        return db.execute(select(StageMaster).where(StageMaster.stage_name == identifier)).scalars().first()


@router.get("/stages/{stage_id_or_name}", response_model=StageMasterResponse)
def get_stage(stage_id_or_name: str, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


@router.put("/stages/{stage_id_or_name}", response_model=StageMasterResponse)
def update_stage(stage_id_or_name: str, data: StageMasterUpdate, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    updated = crud.update_stage(db, stage.id, data)
    return updated


@router.delete("/stages/{stage_id_or_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(stage_id_or_name: str, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage or not crud.delete_stage(db, stage.id):
        raise HTTPException(status_code=404, detail="Stage not found")


@router.patch("/stages/{stage_id_or_name}/status", response_model=StageMasterResponse)
def set_stage_status(stage_id_or_name: str, payload: StatusPayload, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    stage.active_status = payload.active_status
    db.commit()
    db.refresh(stage)
    return stage


# ── StageDetail Endpoints ─────────────────────────────────────────────────────

@router.post("/stage-details", response_model=StageDetailResponse, status_code=status.HTTP_201_CREATED)
def create_stage_detail(data: StageDetailCreate, db: Session = Depends(get_db)):
    return crud.create_stage_detail(db, data)


@router.get("/stage-details", response_model=List[StageDetailResponse])
def list_stage_details(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stage_details(db, skip=skip, limit=limit)


@router.get("/stage-details/{detail_id}", response_model=StageDetailResponse)
def get_stage_detail(detail_id: int, db: Session = Depends(get_db)):
    detail = crud.get_stage_detail(db, detail_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Stage detail not found")
    return detail


@router.put("/stage-details/{detail_id}", response_model=StageDetailResponse)
def update_stage_detail(detail_id: int, data: StageDetailUpdate, db: Session = Depends(get_db)):
    updated = crud.update_stage_detail(db, detail_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Stage detail not found")
    return updated


@router.delete("/stage-details/{detail_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage_detail(detail_id: int, db: Session = Depends(get_db)):
    if not crud.delete_stage_detail(db, detail_id):
        raise HTTPException(status_code=404, detail="Stage detail not found")


from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.models import User


@router.post("/stage-details/plan", response_model=List[StageDetailResponse])
def create_planning_rows(
    payload: BulkPlannedCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    from sqlalchemy import select, or_
    from sqlalchemy.orm.attributes import flag_modified
    from datetime import datetime, timezone
    from app.domains.projects.models import Project

    def _format_user_full_name(u) -> Optional[str]:
        if not u:
            return None
        fn = (getattr(u, "first_name", None) or "").strip()
        ln = (getattr(u, "last_name", None) or "").strip()
        if fn and ln:
            if fn.endswith(f" {ln}") or fn.endswith(ln):
                return fn
            return f"{fn} {ln}"
        return fn or ln or getattr(u, "username", None)

    operator = None
    if payload.changed_by:
        matched = db.query(User).filter(
            or_(
                User.username == payload.changed_by,
                User.email == payload.changed_by,
            )
        ).first()
        if matched:
            operator = _format_user_full_name(matched)
        else:
            operator = payload.changed_by

    if not operator and current_user:
        operator = _format_user_full_name(current_user)

    if not operator and payload.project_manager_name:
        matched_pm = db.query(User).filter(
            or_(
                User.username == payload.project_manager_name,
                User.email == payload.project_manager_name,
            )
        ).first()
        if matched_pm:
            operator = _format_user_full_name(matched_pm)
        else:
            operator = payload.project_manager_name

    if not operator:
        operator = "System"

    # Validate against project due date
    project = db.query(Project).filter(
        or_(Project.project_code == payload.project, Project.code == payload.project)
    ).first()

    if project and project.due_date:
        due_str = str(project.due_date)
        for item in payload.items:
            if item.planned_end_date:
                end_str = str(item.planned_end_date).split("T")[0]
                if end_str > due_str:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Planned date {end_str} for {item.chapters} - {item.stage_name} cannot be above the project due date {due_str}.",
                    )

    details = []
    for item in payload.items:
        existing = db.execute(
            select(StageDetail).where(
                StageDetail.project == payload.project,
                StageDetail.chapters == item.chapters,
                StageDetail.stage_name == item.stage_name,
            )
        ).scalars().first()

        if existing:
            if existing.stage_status == "Completed":
                details.append(existing)
                continue

            old_start = existing.planned_start_date.isoformat() if existing.planned_start_date else None
            old_due = existing.planned_end_date.isoformat() if existing.planned_end_date else None
            old_sla = existing.sla

            new_start = item.planned_start_date.isoformat() if item.planned_start_date else None
            new_due = item.planned_end_date.isoformat() if item.planned_end_date else None
            new_sla = item.sla

            # Check if dates or SLA actually changed
            dates_changed = (
                (old_start and new_start and old_start.split("T")[0] != new_start.split("T")[0]) or
                (bool(old_start) != bool(new_start)) or
                (old_due and new_due and old_due.split("T")[0] != new_due.split("T")[0]) or
                (bool(old_due) != bool(new_due)) or
                (old_sla != new_sla)
            )

            if dates_changed:
                history_list = list(existing.history or [])
                history_entry = {
                    "reason": payload.reason or "Planning adjustment",
                    "changed_at": datetime.now(timezone.utc).isoformat(),
                    "changed_by": operator,
                    "before": {
                        "planned_start_date": old_start,
                        "planned_end_date": old_due,
                        "sla": old_sla,
                    },
                    "after": {
                        "planned_start_date": new_start,
                        "planned_end_date": new_due,
                        "sla": new_sla,
                    }
                }
                history_list.append(history_entry)
                existing.history = history_list
                flag_modified(existing, "history")

            existing.workflow = item.workflow if item.workflow else payload.workflow
            existing.complexity_level = payload.complexity_level
            existing.project_manager_name = payload.project_manager_name
            existing.planned_start_date = item.planned_start_date
            existing.planned_end_date = item.planned_end_date
            existing.sla = item.sla
            details.append(existing)
        else:
            db_detail = StageDetail(
                client=payload.client,
                project=payload.project,
                workflow=item.workflow if item.workflow else payload.workflow,
                complexity_level=payload.complexity_level,
                project_manager_name=payload.project_manager_name,
                chapters=item.chapters,
                stage_name=item.stage_name,
                planned_start_date=item.planned_start_date,
                planned_end_date=item.planned_end_date,
                sla=item.sla,
                stage_status="In-progress",
            )
            db.add(db_detail)
            details.append(db_detail)
    db.commit()
    for d in details:
        db.refresh(d)
    return details


@router.get("/stage-details/project/{project}", response_model=List[StageDetailResponse])
def get_stage_details_by_project(project: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    return list(db.execute(select(StageDetail).where(StageDetail.project == project)).scalars().all())


@router.get("/stage-details/project/{project}/chapter/{chapters}", response_model=List[StageDetailResponse])
def get_stage_details_by_chapter(project: str, chapters: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    return list(db.execute(select(StageDetail).where(StageDetail.project == project, StageDetail.chapters == chapters)).scalars().all())


class AssignPayload(BaseModel):
    assignee_name: Optional[str]
    dt: Optional[str] = None


@router.post("/stage-details/project/{project}/chapter/{chapters}/stage/{stage_name}/assign", response_model=Optional[StageDetailResponse])
def assign_stage(project: str, chapters: str, stage_name: str, payload: AssignPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    db_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == stage_name
        )
    ).scalars().first()
    
    if not db_detail:
        db_detail = StageDetail(
            client=project,
            project=project,
            chapters=chapters,
            stage_name=stage_name,
            workflow="Workflow1",
        )
        db.add(db_detail)
    
    db_detail.assignee_name = payload.assignee_name
    if not db_detail.actual_start_date and not db_detail.actual_end_date:
        if payload.dt:
            try:
                dt_val = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
                if dt_val.tzinfo is not None:
                    dt_val = dt_val.replace(tzinfo=None)
                db_detail.actual_start_date = dt_val
            except ValueError:
                db_detail.actual_start_date = datetime.now(timezone.utc)
        else:
            db_detail.actual_start_date = datetime.now(timezone.utc)
        
    db.commit()
    db.refresh(db_detail)
    return db_detail


class AssignmentTarget(BaseModel):
    project: str
    chapters: str
    stage_name: str


class BulkAssignPayload(BaseModel):
    assignee_name: Optional[str]
    targets: List[AssignmentTarget]
    dt: Optional[str] = None


@router.post("/stage-details/bulk-assign", response_model=List[StageDetailResponse])
def bulk_assign_stages(payload: BulkAssignPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    
    updated_details = []
    
    assign_time = datetime.now(timezone.utc)
    if payload.dt:
        try:
            assign_time = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
            if assign_time.tzinfo is not None:
                assign_time = assign_time.replace(tzinfo=None)
        except ValueError:
            pass
            
    for target in payload.targets:
        db_detail = db.execute(
            select(StageDetail)
            .where(
                StageDetail.project == target.project,
                StageDetail.chapters == target.chapters,
                StageDetail.stage_name == target.stage_name
            )
        ).scalars().first()
        
        if not db_detail:
            db_detail = StageDetail(
                client=target.project,
                project=target.project,
                chapters=target.chapters,
                stage_name=target.stage_name,
                workflow="Workflow1",
            )
            db.add(db_detail)
            
        db_detail.assignee_name = payload.assignee_name
        if not db_detail.actual_start_date and not db_detail.actual_end_date:
            db_detail.actual_start_date = assign_time
        updated_details.append(db_detail)
        
    db.commit()
    for d in updated_details:
        db.refresh(d)
        
    return updated_details


class TransitionPayload(BaseModel):
    from_stage: str
    to_stage: str
    dt: Optional[str] = None


@router.post("/stage-details/project/{project}/chapter/{chapters}/stage-transition", response_model=Optional[StageDetailResponse])
def stage_transition(project: str, chapters: str, payload: TransitionPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    
    from_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == payload.from_stage
        )
    ).scalars().first()
    
    transition_time = datetime.now(timezone.utc)
    if payload.dt:
        try:
            transition_time = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
            if transition_time.tzinfo is not None:
                transition_time = transition_time.replace(tzinfo=None)
        except ValueError:
            pass
            
    if from_detail:
        from_detail.stage_status = "Completed"
        from_detail.actual_end_date = transition_time
        if from_detail.actual_start_date:
            t_naive = transition_time.replace(tzinfo=None) if transition_time.tzinfo is not None else transition_time
            s_naive = from_detail.actual_start_date.replace(tzinfo=None) if from_detail.actual_start_date.tzinfo is not None else from_detail.actual_start_date
            delta = t_naive - s_naive
            from_detail.total_time_taken = delta.total_seconds() / 3600.0
        
        # Calculate completion delay
        if from_detail.planned_end_date and transition_time.date() > from_detail.planned_end_date.date():
            from_detail.delayed = True
            from_detail.delay_days = (transition_time.date() - from_detail.planned_end_date.date()).days
        else:
            from_detail.delayed = False
            from_detail.delay_days = 0

        # Cascade delay propagation (shifting subsequent stages)
        if from_detail.delay_days and from_detail.delay_days > 0:
            from app.domains.workflow.models import WorkflowMaster
            wf_stages = db.execute(
                select(WorkflowMaster)
                .where(WorkflowMaster.workflow_name == from_detail.workflow)
            ).scalars().all()
            
            stage_by_name = {s.stage_name: s for s in wf_stages}
            subsequent_stages = []
            visited = set()
            curr = stage_by_name.get(payload.to_stage)
            while curr and curr.stage_name not in visited:
                subsequent_stages.append(curr.stage_name)
                visited.add(curr.stage_name)
                curr = stage_by_name.get(curr.next_stage) if curr.next_stage else None
                
            if subsequent_stages:
                from datetime import timedelta
                shift_delta = timedelta(days=from_detail.delay_days)
                subsequent_details = db.execute(
                    select(StageDetail)
                    .where(
                        StageDetail.project == project,
                        StageDetail.chapters == chapters,
                        StageDetail.stage_name.in_(subsequent_stages)
                    )
                ).scalars().all()
                for sd in subsequent_details:
                    if sd.planned_start_date:
                        sd.planned_start_date += shift_delta
                    if sd.planned_end_date:
                        sd.planned_end_date += shift_delta

        # Sync ChapterInfo delayed_stages
        from app.domains.workflow.models import ChapterInfo
        import json
        chapter_info = db.execute(
            select(ChapterInfo)
            .where(
                ChapterInfo.project == project,
                ChapterInfo.chapters == chapters
            )
        ).scalars().first()
        if chapter_info:
            current_delays = {}
            if chapter_info.delayed_stages:
                try:
                    current_delays = json.loads(chapter_info.delayed_stages)
                    if not isinstance(current_delays, dict):
                        current_delays = {}
                except Exception:
                    current_delays = {}
            if from_detail.delayed:
                current_delays[from_detail.stage_name] = from_detail.delay_days
            else:
                current_delays.pop(from_detail.stage_name, None)
            chapter_info.delayed_stages = json.dumps(current_delays)

    
    to_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == payload.to_stage
        )
    ).scalars().first()
    
    if not to_detail:
        to_detail = StageDetail(
            client=from_detail.client if from_detail else project,
            project=project,
            chapters=chapters,
            stage_name=payload.to_stage,
            workflow=from_detail.workflow if from_detail else "Workflow1",
        )
        db.add(to_detail)
    
    from app.domains.workflow.models import WorkflowMaster
    wf_name = to_detail.workflow
    wf_stage = db.execute(
        select(WorkflowMaster)
        .where(
            WorkflowMaster.workflow_name == wf_name,
            WorkflowMaster.stage_name == payload.to_stage
        )
    ).scalars().first()

    if wf_stage and not wf_stage.next_stage:
        to_detail.stage_status = "Completed"
        to_detail.actual_end_date = transition_time
    else:
        to_detail.stage_status = "In-progress"
        to_detail.actual_end_date = None

    to_detail.actual_start_date = transition_time
    
    db.commit()
    db.refresh(to_detail)
    return to_detail


class ShiftDatesPayload(BaseModel):
    chapters: str
    stage_names: List[str]
    days: int


@router.post("/stage-details/project/{project}/shift-planned-dates")
def shift_planned_dates(project: str, payload: ShiftDatesPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import timedelta
    details = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == payload.chapters,
            StageDetail.stage_name.in_(payload.stage_names)
        )
    ).scalars().all()
    
    for d in details:
        if d.planned_start_date:
            d.planned_start_date += timedelta(days=payload.days)
        if d.planned_end_date:
            d.planned_end_date += timedelta(days=payload.days)
            
    db.commit()
    return {"ok": True}


# ── WorkflowMaster Endpoints ──────────────────────────────────────────────────

@router.post("/workflows", response_model=List[WorkflowStageResponse], status_code=status.HTTP_201_CREATED)
def create_workflow(data: WorkflowCreate, db: Session = Depends(get_db)):
    return crud.create_workflow(db, data)


@router.get("/workflows", response_model=List[str])
def list_workflows(db: Session = Depends(get_db)):
    workflows = crud.get_all_workflows(db)
    seen = set()
    names = []
    for wf in workflows:
        if wf.workflow_name not in seen:
            seen.add(wf.workflow_name)
            names.append(wf.workflow_name)
    return names


@router.get("/workflows/all", response_model=List[WorkflowStageResponse])
def list_all_workflow_stages(db: Session = Depends(get_db)):
    return crud.get_all_workflows(db)


@router.get("/workflows/{workflow_name}", response_model=List[WorkflowStageResponse])
def get_workflow(workflow_name: str, db: Session = Depends(get_db)):
    workflows = crud.get_workflow_by_name(db, workflow_name)
    if not workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflows


@router.put("/workflows/{workflow_name}", response_model=List[WorkflowStageResponse])
def update_workflow(workflow_name: str, data: WorkflowUpdate, db: Session = Depends(get_db)):
    existing = crud.get_workflow_by_name(db, workflow_name)
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow not found")
    crud.delete_workflow(db, workflow_name)
    new_data = WorkflowCreate(
        workflow_name=data.workflow_name or workflow_name,
        description=data.description,
        active_status=data.active_status if data.active_status is not None else True,
        stages=data.stages
    )
    return crud.create_workflow(db, new_data)


@router.delete("/workflows/{workflow_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(workflow_name: str, db: Session = Depends(get_db)):
    if not crud.delete_workflow(db, workflow_name):
        raise HTTPException(status_code=404, detail="Workflow not found")


@router.get("/workflows/{workflow_name}/next/{stage_name}", response_model=dict)
def get_next_stage(workflow_name: str, stage_name: str, db: Session = Depends(get_db)):
    stages = crud.get_workflow_by_name(db, workflow_name)
    if not stages:
        raise HTTPException(status_code=404, detail="Workflow not found")
    stage = next((s for s in stages if s.stage_name == stage_name), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found in workflow")
    return {"next_stage": stage.next_stage}


@router.get("/workflows/{workflow_name}/previous/{stage_name}", response_model=dict)
def get_previous_stage(workflow_name: str, stage_name: str, db: Session = Depends(get_db)):
    stages = crud.get_workflow_by_name(db, workflow_name)
    if not stages:
        raise HTTPException(status_code=404, detail="Workflow not found")
    stage = next((s for s in stages if s.stage_name == stage_name), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found in workflow")
    return {"previous_stage": stage.previous_stage}


# ── ChapterInfo Endpoints ─────────────────────────────────────────────────────

@router.post("/chapter-infos", response_model=ChapterInfoResponse, status_code=status.HTTP_201_CREATED)
def create_chapter_info(data: ChapterInfoCreate, db: Session = Depends(get_db)):
    return crud.create_chapter_info(db, data)


@router.get("/chapter-infos", response_model=List[ChapterInfoResponse])
def list_chapter_infos(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_chapter_infos(db, skip=skip, limit=limit)


@router.get("/chapter-infos/{chapter_id}", response_model=ChapterInfoResponse)
def get_chapter_info(chapter_id: int, db: Session = Depends(get_db)):
    chapter = crud.get_chapter_info(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter info not found")
    return chapter


@router.put("/chapter-infos/{chapter_id}", response_model=ChapterInfoResponse)
def update_chapter_info(chapter_id: int, data: ChapterInfoUpdate, db: Session = Depends(get_db)):
    updated = crud.update_chapter_info(db, chapter_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Chapter info not found")
    return updated


@router.delete("/chapter-infos/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chapter_info(chapter_id: int, db: Session = Depends(get_db)):
    if not crud.delete_chapter_info(db, chapter_id):
        raise HTTPException(status_code=404, detail="Chapter info not found")
