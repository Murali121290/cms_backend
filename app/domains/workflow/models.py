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

    @property
    def art_count(self) -> int:
        return sum(1 for f in self.files if f.category == "Art")

    @property
    def xml_status(self) -> Optional[str]:
        """Derive XML validation status from uploaded files.
        - None      → no XML file present
        - 'pending' → XML present but no .log file yet
        - 'valid'   → .log has no error/invalid markers
        - 'invalid' → .log contains error/invalid markers
        """
        import os
        xml_files = [f for f in self.files if f.category == "XML" and f.filename.lower().endswith(".xml")]
        if not xml_files:
            return None
        # Pick the latest XML file
        xml_file = sorted(xml_files, key=lambda f: f.uploaded_at)[-1]
        base = os.path.splitext(xml_file.filename)[0]
        log_files = [f for f in self.files if f.filename == f"{base}.log"]
        if not log_files:
            return "pending"
        log_file = sorted(log_files, key=lambda f: f.uploaded_at)[-1]
        if log_file.path:
            from app.services.file_service import UPLOAD_DIR
            full_path = os.path.join(UPLOAD_DIR, log_file.path) if not os.path.isabs(log_file.path) else log_file.path
            if os.path.exists(full_path):
                try:
                    content = open(full_path, encoding="utf-8", errors="ignore").read()
                    content_upper = content.upper()
                    # Explicit pass marker written by the DTD validator (e.g. "? VALIDATION PASSED")
                    if "VALIDATION PASSED" in content_upper:
                        return "valid"
                    # Explicit fail/skip markers
                    if "VALIDATION FAILED" in content_upper or "VALIDATION SKIPPED" in content_upper:
                        return "invalid"
                    # Fallback: any line prefixed "ERROR:" is a failure
                    if any(line.strip().lower().startswith("error") for line in content.splitlines()):
                        return "invalid"
                    # Log exists but no clear marker yet
                    return "pending"
                except Exception:
                    pass
        return "pending"

    @property
    def indesign_status(self) -> Optional[str]:
        """Returns 'generated' if an .indd/.idml file exists in the InDesign/Indesign category."""
        import os
        from app.services.file_service import UPLOAD_DIR
        for f in self.files:
            cat = (f.category or "").strip().lower()
            fname = (f.filename or "").strip().lower()
            if cat in ("indesign", "design", "template") or fname.endswith((".indd", ".idml", ".indt")):
                if f.path:
                    full = os.path.join(UPLOAD_DIR, f.path) if not os.path.isabs(f.path) else f.path
                    if os.path.exists(full):
                        return "generated"
                    # Fallback for Linux case-sensitive directory mismatch (InDesign vs Indesign)
                    alt = full.replace("/InDesign/", "/Indesign/") if "/InDesign/" in full else full.replace("/Indesign/", "/InDesign/")
                    if os.path.exists(alt):
                        return "generated"
                    # Return generated if file record exists in database
                    return "generated"
        return None

    @property
    def final_delivery_status(self) -> Optional[str]:
        """Returns 'generated' if any file exists in the Misc (Final delivery) category (and on disk)."""
        import os
        from app.services.file_service import UPLOAD_DIR
        for f in self.files:
            if f.category.lower() in ("misc", "final delivery", "miscellaneous"):
                if f.path:
                    full = os.path.join(UPLOAD_DIR, f.path) if not os.path.isabs(f.path) else f.path
                    if os.path.exists(full):
                        return "generated"
        return None

    @property
    def style_status(self) -> Optional[str]:
        """Derive style validation status from uploaded files.
        - None      → no style report file present
        - 'valid'   → compliance is 100% (PASS)
        - 'invalid' → compliance is < 100% (FAIL or WARNING)
        """
        import os
        from app.services.file_service import UPLOAD_DIR
        report_files = [f for f in self.files if f.category == "Manuscript" and f.filename.lower().endswith("_style_report.html")]
        if not report_files:
            return None
        report_file = sorted(report_files, key=lambda f: f.uploaded_at)[-1]
        if report_file.path:
            full_path = os.path.join(UPLOAD_DIR, report_file.path) if not os.path.isabs(report_file.path) else report_file.path
            if os.path.exists(full_path):
                try:
                    content = open(full_path, encoding="utf-8", errors="ignore").read()
                    if 'gauge-status tag-allowed">PASS' in content:
                        return "valid"
                    else:
                        return "invalid"
                except Exception:
                    pass
        return "pending"

    @property
    def structuring_status(self) -> Optional[str]:
        """Derive structuring status from processing jobs or files.
        - None        → no structuring job or file present
        - 'completed' → structuring completed successfully
        - 'pending'   → structuring job is running/processing
        - 'failed'    → structuring job failed
        """
        from app.models import ProcessingJob
        from app.database import SessionLocal
        
        file_ids = [f.id for f in self.files if f.category == "Manuscript"]
        if not file_ids:
            return None
            
        db = SessionLocal()
        try:
            job = db.query(ProcessingJob).filter(
                ProcessingJob.file_id.in_(file_ids),
                ProcessingJob.process_type == "structuring"
            ).order_by(ProcessingJob.created_at.desc()).first()
            if job:
                if job.status == "processing":
                    return "pending"
                elif job.status == "completed":
                    return "completed"
                elif job.status == "failed":
                    return "failed"
        except Exception:
            pass
        finally:
            db.close()
            
        # Fallback to check file presence
        for f in self.files:
            if f.category == "Manuscript":
                if "_processed.docx" in f.filename.lower() or "_structured.docx" in f.filename.lower():
                    return "completed"
                    
        return None

