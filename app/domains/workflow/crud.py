from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.workflow.models import (
    RolesMaster, StageMaster, StageActivityMaster, StageDetail, WorkflowMaster, ChapterInfo
)
from app.domains.workflow.schemas import (
    RolesMasterCreate, RolesMasterUpdate,
    StageMasterCreate, StageMasterUpdate,
    StageActivityMasterCreate, StageActivityMasterUpdate,
    StageDetailCreate, StageDetailUpdate,
    WorkflowCreate, WorkflowUpdate,
    ChapterInfoCreate, ChapterInfoUpdate
)


# ── RolesMaster CRUD ──────────────────────────────────────────────────────────

def create_role(db: Session, data: RolesMasterCreate) -> RolesMaster:
    db_role = RolesMaster(**data.model_dump())
    db.add(db_role)
    db.commit()
    db.refresh(db_role)
    return db_role


def get_role(db: Session, role_id: int) -> Optional[RolesMaster]:
    return db.execute(select(RolesMaster).where(RolesMaster.id == role_id)).scalars().first()


def get_roles(db: Session, skip: int = 0, limit: int = 100) -> List[RolesMaster]:
    return list(db.execute(select(RolesMaster).offset(skip).limit(limit)).scalars().all())


def get_role_by_name_team(db: Session, role_name: str, team: str) -> Optional[RolesMaster]:
    return db.execute(
        select(RolesMaster).where(RolesMaster.role_name == role_name, RolesMaster.team == team)
    ).scalars().first()


def update_role(db: Session, role_id: int, data: RolesMasterUpdate) -> Optional[RolesMaster]:
    db_role = get_role(db, role_id)
    if not db_role:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_role, field, value)
    db.commit()
    db.refresh(db_role)
    return db_role


def delete_role(db: Session, role_id: int) -> bool:
    db_role = get_role(db, role_id)
    if not db_role:
        return False
    db.delete(db_role)
    db.commit()
    return True


# ── StageActivityMaster CRUD ──────────────────────────────────────────────────

def create_stage_activity(db: Session, data: StageActivityMasterCreate) -> StageActivityMaster:
    db_activity = StageActivityMaster(**data.model_dump())
    db.add(db_activity)
    db.commit()
    db.refresh(db_activity)
    return db_activity


def get_stage_activity(db: Session, activity_id: int) -> Optional[StageActivityMaster]:
    return db.execute(select(StageActivityMaster).where(StageActivityMaster.id == activity_id)).scalars().first()


def get_stage_activities(db: Session, skip: int = 0, limit: int = 100) -> List[StageActivityMaster]:
    return list(db.execute(select(StageActivityMaster).offset(skip).limit(limit)).scalars().all())


def update_stage_activity(db: Session, activity_id: int, data: StageActivityMasterUpdate) -> Optional[StageActivityMaster]:
    db_activity = get_stage_activity(db, activity_id)
    if not db_activity:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_activity, field, value)
    db.commit()
    db.refresh(db_activity)
    return db_activity


def delete_stage_activity(db: Session, activity_id: int) -> bool:
    db_activity = get_stage_activity(db, activity_id)
    if not db_activity:
        return False
    db.delete(db_activity)
    db.commit()
    return True


# ── StageMaster CRUD ──────────────────────────────────────────────────────────

def create_stage(db: Session, data: StageMasterCreate) -> StageMaster:
    db_stage = StageMaster(**data.model_dump())
    db.add(db_stage)
    db.commit()
    db.refresh(db_stage)
    return db_stage


def get_stage(db: Session, stage_id: int) -> Optional[StageMaster]:
    return db.execute(select(StageMaster).where(StageMaster.id == stage_id)).scalars().first()


def get_stages(db: Session, skip: int = 0, limit: int = 100) -> List[StageMaster]:
    return list(db.execute(select(StageMaster).offset(skip).limit(limit)).scalars().all())


def get_stage_by_name(db: Session, stage_name: str) -> Optional[StageMaster]:
    return db.execute(select(StageMaster).where(StageMaster.stage_name == stage_name)).scalars().first()


def update_stage(db: Session, stage_id: int, data: StageMasterUpdate) -> Optional[StageMaster]:
    db_stage = get_stage(db, stage_id)
    if not db_stage:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_stage, field, value)
    db.commit()
    db.refresh(db_stage)
    return db_stage


def delete_stage(db: Session, stage_id: int) -> bool:
    db_stage = get_stage(db, stage_id)
    if not db_stage:
        return False
    db.delete(db_stage)
    db.commit()
    return True


# ── StageDetail CRUD ──────────────────────────────────────────────────────────

def create_stage_detail(db: Session, data: StageDetailCreate) -> StageDetail:
    db_detail = StageDetail(**data.model_dump())
    db.add(db_detail)
    db.commit()
    db.refresh(db_detail)
    return db_detail


def get_stage_detail(db: Session, detail_id: int) -> Optional[StageDetail]:
    return db.execute(select(StageDetail).where(StageDetail.id == detail_id)).scalars().first()


def get_stage_details(db: Session, skip: int = 0, limit: int = 100) -> List[StageDetail]:
    return list(db.execute(select(StageDetail).offset(skip).limit(limit)).scalars().all())


def get_stage_details_by_project(db: Session, project: str) -> List[StageDetail]:
    return list(db.execute(select(StageDetail).where(StageDetail.project == project)).scalars().all())


def update_stage_detail(db: Session, detail_id: int, data: StageDetailUpdate) -> Optional[StageDetail]:
    db_detail = get_stage_detail(db, detail_id)
    if not db_detail:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_detail, field, value)
    db.commit()
    db.refresh(db_detail)
    return db_detail


def delete_stage_detail(db: Session, detail_id: int) -> bool:
    db_detail = get_stage_detail(db, detail_id)
    if not db_detail:
        return False
    db.delete(db_detail)
    db.commit()
    return True


# ── WorkflowMaster CRUD ───────────────────────────────────────────────────────

def create_workflow(db: Session, data: WorkflowCreate) -> List[WorkflowMaster]:
    workflow_records = []
    for stage in data.stages:
        db_workflow = WorkflowMaster(
            workflow_name=data.workflow_name,
            stage_name=stage.stage_name,
            previous_stage=stage.previous_stage,
            next_stage=stage.next_stage,
            description=data.description,
            active_status=data.active_status
        )
        db.add(db_workflow)
        workflow_records.append(db_workflow)
    db.commit()
    for record in workflow_records:
        db.refresh(record)
    return workflow_records


def get_workflow_by_name(db: Session, workflow_name: str) -> List[WorkflowMaster]:
    return list(db.execute(select(WorkflowMaster).where(WorkflowMaster.workflow_name == workflow_name)).scalars().all())


def get_all_workflows(db: Session) -> List[WorkflowMaster]:
    return list(db.execute(select(WorkflowMaster)).scalars().all())


def delete_workflow(db: Session, workflow_name: str) -> int:
    workflows = get_workflow_by_name(db, workflow_name)
    count = len(workflows)
    for wf in workflows:
        db.delete(wf)
    db.commit()
    return count


# ── ChapterInfo CRUD ──────────────────────────────────────────────────────────

def create_chapter_info(db: Session, data: ChapterInfoCreate) -> ChapterInfo:
    db_chapter = ChapterInfo(**data.model_dump())
    db.add(db_chapter)
    db.commit()
    db.refresh(db_chapter)
    return db_chapter


def get_chapter_info(db: Session, chapter_id: int) -> Optional[ChapterInfo]:
    return db.execute(select(ChapterInfo).where(ChapterInfo.id == chapter_id)).scalars().first()


def get_chapter_infos(db: Session, skip: int = 0, limit: int = 100) -> List[ChapterInfo]:
    return list(db.execute(select(ChapterInfo).offset(skip).limit(limit)).scalars().all())


def get_chapter_infos_by_project(db: Session, project: str) -> List[ChapterInfo]:
    return list(db.execute(select(ChapterInfo).where(ChapterInfo.project == project)).scalars().all())


def update_chapter_info(db: Session, chapter_id: int, data: ChapterInfoUpdate) -> Optional[ChapterInfo]:
    db_chapter = get_chapter_info(db, chapter_id)
    if not db_chapter:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_chapter, field, value)
    db.commit()
    db.refresh(db_chapter)
    return db_chapter


def delete_chapter_info(db: Session, chapter_id: int) -> bool:
    db_chapter = get_chapter_info(db, chapter_id)
    if not db_chapter:
        return False
    db.delete(db_chapter)
    db.commit()
    return True
