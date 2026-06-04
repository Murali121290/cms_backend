from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.workflow import crud
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


@router.get("/stage-activities/{activity_id}", response_model=StageActivityMasterResponse)
def get_stage_activity(activity_id: int, db: Session = Depends(get_db)):
    activity = crud.get_stage_activity(db, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Stage activity not found")
    return activity


@router.put("/stage-activities/{activity_id}", response_model=StageActivityMasterResponse)
def update_stage_activity(activity_id: int, data: StageActivityMasterUpdate, db: Session = Depends(get_db)):
    updated = crud.update_stage_activity(db, activity_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Stage activity not found")
    return updated


@router.delete("/stage-activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage_activity(activity_id: int, db: Session = Depends(get_db)):
    if not crud.delete_stage_activity(db, activity_id):
        raise HTTPException(status_code=404, detail="Stage activity not found")


# ── StageMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/stages", response_model=StageMasterResponse, status_code=status.HTTP_201_CREATED)
def create_stage(data: StageMasterCreate, db: Session = Depends(get_db)):
    return crud.create_stage(db, data)


@router.get("/stages", response_model=List[StageMasterResponse])
def list_stages(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stages(db, skip=skip, limit=limit)


@router.get("/stages/{stage_id}", response_model=StageMasterResponse)
def get_stage(stage_id: int, db: Session = Depends(get_db)):
    stage = crud.get_stage(db, stage_id)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


@router.put("/stages/{stage_id}", response_model=StageMasterResponse)
def update_stage(stage_id: int, data: StageMasterUpdate, db: Session = Depends(get_db)):
    updated = crud.update_stage(db, stage_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Stage not found")
    return updated


@router.delete("/stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(stage_id: int, db: Session = Depends(get_db)):
    if not crud.delete_stage(db, stage_id):
        raise HTTPException(status_code=404, detail="Stage not found")


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


# ── WorkflowMaster Endpoints ──────────────────────────────────────────────────

@router.post("/workflows", response_model=List[WorkflowStageResponse], status_code=status.HTTP_201_CREATED)
def create_workflow(data: WorkflowCreate, db: Session = Depends(get_db)):
    return crud.create_workflow(db, data)


@router.get("/workflows/{workflow_name}", response_model=List[WorkflowStageResponse])
def get_workflow(workflow_name: str, db: Session = Depends(get_db)):
    workflows = crud.get_workflow_by_name(db, workflow_name)
    if not workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflows


@router.delete("/workflows/{workflow_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(workflow_name: str, db: Session = Depends(get_db)):
    if not crud.delete_workflow(db, workflow_name):
        raise HTTPException(status_code=404, detail="Workflow not found")


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
