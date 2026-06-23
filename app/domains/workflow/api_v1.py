from typing import List, Optional
from pydantic import BaseModel

class StatusPayload(BaseModel):
    active_status: bool

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.workflow import crud
from app.domains.workflow.models import StageDetail, StageMaster, StageActivityMaster
from app.domains.workflow.schemas import (
    RolesMasterCreate, RolesMasterResponse, RolesMasterUpdate,
    StageMasterCreate, StageMasterResponse, StageMasterUpdate,
    StageActivityMasterCreate, StageActivityMasterResponse, StageActivityMasterUpdate,
    StageDetailCreate, StageDetailResponse, StageDetailUpdate, BulkPlannedCreate,
    WorkflowCreate, WorkflowStageResponse, WorkflowUpdate,
    ChapterInfoCreate, ChapterInfoResponse, ChapterInfoUpdate
)

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


# ── StageActivityMaster Endpoints ─────────────────────────────────────────────

@router.post("/stage-activities", response_model=StageActivityMasterResponse, status_code=status.HTTP_201_CREATED)
def create_stage_activity(data: StageActivityMasterCreate, db: Session = Depends(get_db)):
    return crud.create_stage_activity(db, data)


@router.get("/stage-activities", response_model=List[StageActivityMasterResponse])
def list_stage_activities(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stage_activities(db, skip=skip, limit=limit)


def resolve_activity(db: Session, identifier: str):
    from sqlalchemy import select
    if identifier.isdigit():
        return db.execute(select(StageActivityMaster).where(StageActivityMaster.id == int(identifier))).scalars().first()
    else:
        return db.execute(select(StageActivityMaster).where(StageActivityMaster.stage_activity_name == identifier)).scalars().first()


@router.get("/stage-activities/{activity_id_or_name}", response_model=StageActivityMasterResponse)
def get_stage_activity(activity_id_or_name: str, db: Session = Depends(get_db)):
    activity = resolve_activity(db, activity_id_or_name)
    if not activity:
        raise HTTPException(status_code=404, detail="Stage activity not found")
    return activity


@router.put("/stage-activities/{activity_id_or_name}", response_model=StageActivityMasterResponse)
def update_stage_activity(activity_id_or_name: str, data: StageActivityMasterUpdate, db: Session = Depends(get_db)):
    activity = resolve_activity(db, activity_id_or_name)
    if not activity:
        raise HTTPException(status_code=404, detail="Stage activity not found")
    updated = crud.update_stage_activity(db, activity.id, data)
    return updated


@router.delete("/stage-activities/{activity_id_or_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage_activity(activity_id_or_name: str, db: Session = Depends(get_db)):
    activity = resolve_activity(db, activity_id_or_name)
    if not activity or not crud.delete_stage_activity(db, activity.id):
        raise HTTPException(status_code=404, detail="Stage activity not found")


@router.patch("/stage-activities/{activity_id_or_name}/status", response_model=StageActivityMasterResponse)
def set_stage_activity_status(activity_id_or_name: str, payload: StatusPayload, db: Session = Depends(get_db)):
    activity = resolve_activity(db, activity_id_or_name)
    if not activity:
        raise HTTPException(status_code=404, detail="Stage activity not found")
    activity.active_status = payload.active_status
    db.commit()
    db.refresh(activity)
    return activity


# ── StageMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/stages", response_model=StageMasterResponse, status_code=status.HTTP_201_CREATED)
def create_stage(data: StageMasterCreate, db: Session = Depends(get_db)):
    return crud.create_stage(db, data)


@router.get("/stages", response_model=List[StageMasterResponse])
def list_stages(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stages(db, skip=skip, limit=limit)


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


@router.post("/stage-details/plan", response_model=List[StageDetailResponse])
def create_planning_rows(payload: BulkPlannedCreate, db: Session = Depends(get_db)):
    details = []
    for item in payload.items:
        db_detail = StageDetail(
            client=payload.client,
            project=payload.project,
            workflow=payload.workflow,
            complexity_level=payload.complexity_level,
            project_manager_name=payload.project_manager_name,
            chapters=item.chapters,
            stage_name=item.stage_name,
            planned_start_date=item.planned_start_date,
            planned_end_date=item.planned_end_date,
            sla=item.sla,
            stage_status="In-progress",
            stage_activity_status="In-progress",
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
    if payload.dt:
        try:
            db_detail.actual_start_date = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
        except ValueError:
            db_detail.actual_start_date = datetime.utcnow()
    else:
        db_detail.actual_start_date = datetime.utcnow()
        
    db.commit()
    db.refresh(db_detail)
    return db_detail


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
    
    transition_time = datetime.utcnow()
    if payload.dt:
        try:
            transition_time = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
        except ValueError:
            pass
            
    if from_detail:
        from_detail.stage_status = "Completed"
        from_detail.actual_end_date = transition_time
        if from_detail.actual_start_date:
            delta = transition_time - from_detail.actual_start_date
            from_detail.total_time_taken = delta.total_seconds() / 3600.0
    
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
