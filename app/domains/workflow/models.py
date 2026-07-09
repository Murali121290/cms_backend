import enum
from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.compiler import compiles

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(element, compiler, **kw):
    return "TEXT"

@compiles(BigInteger, "sqlite")
def compile_bigint_sqlite(element, compiler, **kw):
    return "INTEGER"

from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from typing import Optional

from app.database import Base


# Enums
class ProjectStatus(str, enum.Enum):
    active    = "Active"
    planning  = "Planning"
    completed = "Completed"


class ProjectPriority(str, enum.Enum):
    normal     = "Normal"
    fast_track = "Fast Track"


class ComplexityLevel(str, enum.Enum):
    low    = "Low"
    medium = "Medium"
    high   = "High"


class ChapterStatus(str, enum.Enum):
    in_progress = "In-progress"
    complete    = "complete"
    hold        = "Hold"
    in_query    = "In-query"


class PublishedStatus(str, enum.Enum):
    draft             = "Draft"
    ready_for_publish = "Ready for Publish"
    published         = "Published"
    archived          = "Archived"


# Models
class RolesMaster(Base):
    __tablename__ = "roles_master"

    __table_args__ = (
        UniqueConstraint("role_name", "team", name="uq_roles_name_team"),
    )

    id            = Column(BigInteger, primary_key=True, autoincrement=True)
    role_name     = Column(String(100), nullable=False, index=True)
    team          = Column(String(150), nullable=False)
    description   = Column(Text,        nullable=True)
    active_status = Column(Boolean,     nullable=False, default=True)
    created_at    = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    @property
    def name(self) -> str:
        # Compatibility mapping to capitalized roles for frontend/serializers
        from app.domains.auth.models import map_role_to_capitalized
        return map_role_to_capitalized(self.role_name)


class StageMaster(Base):
    __tablename__ = "stage_master"

    id               = Column(BigInteger, primary_key=True, autoincrement=True)
    stage_name       = Column(String(100), unique=True, nullable=False, index=True)
    description      = Column(Text, nullable=True)
    sla_level1       = Column(Integer,           nullable=True)                        # SLA in days for Level 1
    sla_level2       = Column(Integer,           nullable=True)                        # SLA in days for Level 2
    sla_level3       = Column(Integer,           nullable=True)                        # SLA in days for Level 3
    roles            = Column(ARRAY(String),     nullable=False, server_default="{}")  # array of role names
    active_status    = Column(Boolean,           nullable=False, default=True)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class StageDetail(Base):
    __tablename__ = "stages_details"

    __table_args__ = (
        CheckConstraint("planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date", name="ck_stage_detail_planned_end_after_start"),
        CheckConstraint("actual_end_date IS NULL OR actual_start_date IS NULL OR actual_end_date >= actual_start_date",     name="ck_stage_detail_actual_end_after_start"),
        CheckConstraint("sla >= 0",         name="ck_stage_detail_sla_non_negative"),
        CheckConstraint("stage_level >= 0", name="ck_stage_detail_level_non_negative"),
    )

    id                    = Column(BigInteger,  primary_key=True, autoincrement=True)
    client                = Column(String(150), nullable=False)
    project               = Column(String(200), nullable=False)
    chapters              = Column(String(100), nullable=False)
    project_manager_name  = Column(String(150), ForeignKey("users.username",                          ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    assignee_name         = Column(String(150), ForeignKey("users.username",                          ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    planned_start_date    = Column(DateTime(timezone=True), nullable=True)
    planned_end_date      = Column(DateTime(timezone=True), nullable=True)
    actual_start_date     = Column(DateTime(timezone=True), nullable=True)
    actual_end_date       = Column(DateTime(timezone=True), nullable=True)
    stage_name            = Column(String(100), ForeignKey("stage_master.stage_name",                  ondelete="RESTRICT",  onupdate="CASCADE"), nullable=False)
    total_time_taken      = Column(Float,       nullable=True)
    workflow              = Column(Text,        nullable=False, default="Workflow1")
    complexity_level      = Column(String(20),  nullable=True)
    stage_level           = Column(Integer,     nullable=True)
    sla                   = Column(Integer,     nullable=True)
    stage_status          = Column(String(20),  nullable=False, default="In-progress")
    delayed               = Column(Boolean,     nullable=False, default=False)
    delay_days            = Column(Integer,     nullable=True)
    remarks               = Column(Text,        nullable=True)
    created_at            = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at            = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class WorkflowMaster(Base):
    __tablename__ = "workflow_master"

    id             = Column(Integer,  primary_key=True, autoincrement=True)
    workflow_name  = Column(String(255), nullable=False, index=True)
    stage_name     = Column(String(255), nullable=False)
    previous_stage = Column(String(255), nullable=True)
    next_stage     = Column(String(255), nullable=True)
    description    = Column(String(500), nullable=True)
    active_status  = Column(Boolean,  nullable=False, default=True)
    created_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class ChapterInfo(Base):
    __tablename__ = "chapter_details"

    id                     = Column(BigInteger, primary_key=True, autoincrement=True)
    client                 = Column(String(150), nullable=False)
    project                = Column(String(200), nullable=False)
    chapters               = Column(String(100), nullable=False)
    chapter_title          = Column(Text,        nullable=True)
    project_manager_name   = Column(String(150), ForeignKey("users.username",          ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    due_date               = Column(DateTime(timezone=True), nullable=True)
    stage_name             = Column(String(100), ForeignKey("stage_master.stage_name",  ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    current_assignee_name  = Column(String(150), ForeignKey("users.username",          ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    status                 = Column(String(20),  nullable=False, default="In-progress")
    complexity_level       = Column(String(20),  nullable=True,  default="Medium")
    stage_level            = Column(Integer,     nullable=True,  default=1)
    workflow               = Column(Text,        nullable=False, default="Workflow1")
    published_status       = Column(String(30),  nullable=False, default="Draft")
    remarks                = Column(Text,        nullable=True)
    manuscript_pages       = Column(Integer,     nullable=True)
    word_count             = Column(Integer,     nullable=True)
    priority               = Column(String(20),  nullable=False, default="Normal")
    delayed_stages         = Column(String,      nullable=True)  # JSON stored as text
    created_at             = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at             = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    project_rel = relationship("Project", primaryjoin="Project.project_code == ChapterInfo.project", foreign_keys="[ChapterInfo.project]", back_populates="chapters")
    files = relationship("File", back_populates="chapter", cascade="all, delete-orphan")

    # Compatibility properties for WMS chapters table
    @property
    def project_id(self) -> Optional[int]:
        return self.project_rel.id if self.project_rel else None

    @property
    def number(self) -> str:
        return self.chapters

    @number.setter
    def number(self, val: str):
        self.chapters = val

    @property
    def title(self) -> Optional[str]:
        return self.chapter_title

    @title.setter
    def title(self, val: Optional[str]):
        self.chapter_title = val

