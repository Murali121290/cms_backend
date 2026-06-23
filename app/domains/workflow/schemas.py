from datetime import datetime, date
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, model_validator, field_validator

from app.domains.workflow.models import (
    ProjectStatus, ProjectPriority, ComplexityLevel,
    ChapterStatus, PublishedStatus
)


# RolesMaster Schemas
class RolesMasterBase(BaseModel):
    role_name: str
    team: str
    description: Optional[str] = None
    active_status: bool = True


class RolesMasterCreate(RolesMasterBase):
    pass


class RolesMasterUpdate(BaseModel):
    role_name: Optional[str] = None
    team: Optional[str] = None
    description: Optional[str] = None
    active_status: Optional[bool] = None


class RolesMasterResponse(RolesMasterBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# StageActivityMaster Schemas
class StageActivityMasterBase(BaseModel):
    stage_activity_name: str
    description: Optional[str] = None
    active_status: bool = True


class StageActivityMasterCreate(StageActivityMasterBase):
    pass


class StageActivityMasterUpdate(BaseModel):
    stage_activity_name: Optional[str] = None
    description: Optional[str] = None
    active_status: Optional[bool] = None


class StageActivityMasterResponse(StageActivityMasterBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# StageMaster Schemas
class StageMasterBase(BaseModel):
    stage_name: str
    description: Optional[str] = None
    stage_activities: List[int] = []
    sla_level1: Optional[int] = None
    sla_level2: Optional[int] = None
    sla_level3: Optional[int] = None
    roles: List[str] = []
    active_status: bool = True


class StageMasterCreate(StageMasterBase):
    pass


class StageMasterUpdate(BaseModel):
    stage_name: Optional[str] = None
    description: Optional[str] = None
    stage_activities: Optional[List[int]] = None
    sla_level1: Optional[int] = None
    sla_level2: Optional[int] = None
    sla_level3: Optional[int] = None
    roles: Optional[List[str]] = None
    active_status: Optional[bool] = None


class StageMasterResponse(StageMasterBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# StageDetail Schemas
class StageDetailBase(BaseModel):
    client: str
    project: str
    chapters: str
    project_manager_name: Optional[str] = None
    assignee_name: Optional[str] = None
    planned_start_date: Optional[datetime] = None
    planned_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    stage_name: str
    stage_activity: Optional[str] = None
    workflow: str = "Workflow1"
    complexity_level: Optional[str] = None
    stage_level: Optional[int] = None
    sla: Optional[int] = None
    stage_status: str = "In-progress"
    stage_activity_status: str = "In-progress"
    delayed: bool = False
    delay_days: Optional[int] = None
    remarks: Optional[str] = None

    @model_validator(mode="after")
    def validate_dates_and_sla(self):
        if self.planned_end_date and self.planned_start_date and self.planned_end_date < self.planned_start_date:
            raise ValueError("planned_end_date must be >= planned_start_date")
        if self.actual_end_date and self.actual_start_date and self.actual_end_date < self.actual_start_date:
            raise ValueError("actual_end_date must be >= actual_start_date")
        if self.sla is not None and self.sla < 0:
            raise ValueError("sla must be >= 0")
        if self.stage_level is not None and self.stage_level < 0:
            raise ValueError("stage_level must be >= 0")
        return self


class StageDetailCreate(StageDetailBase):
    pass


class StageDetailUpdate(BaseModel):
    client: Optional[str] = None
    project: Optional[str] = None
    chapters: Optional[str] = None
    project_manager_name: Optional[str] = None
    assignee_name: Optional[str] = None
    planned_start_date: Optional[datetime] = None
    planned_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    stage_name: Optional[str] = None
    stage_activity: Optional[str] = None
    workflow: Optional[str] = None
    complexity_level: Optional[str] = None
    stage_level: Optional[int] = None
    sla: Optional[int] = None
    stage_status: Optional[str] = None
    stage_activity_status: Optional[str] = None
    delayed: Optional[bool] = None
    delay_days: Optional[int] = None
    remarks: Optional[str] = None


class BulkPlannedItem(BaseModel):
    chapters: str
    stage_name: str
    planned_start_date: datetime
    planned_end_date: datetime
    sla: Optional[int] = None


class BulkPlannedCreate(BaseModel):
    client: str
    project: str
    workflow: str
    complexity_level: Optional[str] = None
    project_manager_name: Optional[str] = None
    items: List[BulkPlannedItem]


class StageDetailResponse(StageDetailBase):
    id: int
    total_time_taken: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# WorkflowMaster Schemas
class StageEntry(BaseModel):
    stage_name: str
    previous_stage: Optional[str] = None
    next_stage: Optional[str] = None


class WorkflowCreate(BaseModel):
    workflow_name: str
    description: Optional[str] = None
    active_status: bool = True
    stages: List[StageEntry]


class WorkflowUpdate(BaseModel):
    workflow_name: Optional[str] = None
    description: Optional[str] = None
    active_status: Optional[bool] = None
    stages: List[StageEntry]


class WorkflowStageUpdate(BaseModel):
    stage_name: Optional[str] = None
    previous_stage: Optional[str] = None
    next_stage: Optional[str] = None
    active_status: Optional[bool] = None


class WorkflowStageResponse(BaseModel):
    id: int
    workflow_name: str
    stage_name: str
    previous_stage: Optional[str]
    next_stage: Optional[str]
    description: Optional[str]
    active_status: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ChapterInfo Schemas
class ChapterInfoBase(BaseModel):
    client: str
    project: str
    chapters: str
    chapter_title: Optional[str] = None
    project_manager_name: Optional[str] = None
    due_date: Optional[date] = None
    stage_name: Optional[str] = None
    current_stage_activity: Optional[str] = None
    current_assignee_name: Optional[str] = None
    status: str = "In-progress"
    complexity_level: str = "Medium"
    stage_level: int = 1
    workflow: str = "Workflow1"
    published_status: str = "Draft"
    remarks: Optional[str] = None
    manuscript_pages: Optional[int] = None
    word_count: Optional[int] = None
    priority: str = "Normal"
    delayed_stages: Optional[Dict[str, int]] = None

    @field_validator("delayed_stages", mode="before")
    @classmethod
    def coerce_delayed_stages(cls, v: Any) -> Optional[Dict[str, int]]:
        if isinstance(v, list):
            return {s: 0 for s in v if isinstance(s, str)}
        return v


class ChapterInfoCreate(ChapterInfoBase):
    pass


class ChapterInfoUpdate(BaseModel):
    client: Optional[str] = None
    project: Optional[str] = None
    chapters: Optional[str] = None
    chapter_title: Optional[str] = None
    project_manager_name: Optional[str] = None
    due_date: Optional[date] = None
    stage_name: Optional[str] = None
    current_stage_activity: Optional[str] = None
    current_assignee_name: Optional[str] = None
    status: Optional[str] = None
    complexity_level: Optional[str] = None
    stage_level: Optional[int] = None
    workflow: Optional[str] = None
    published_status: Optional[str] = None
    remarks: Optional[str] = None
    manuscript_pages: Optional[int] = None
    priority: Optional[str] = None
    delayed_stages: Optional[Dict[str, int]] = None


class ChapterInfoResponse(ChapterInfoBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
