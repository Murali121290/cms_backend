from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Date, JSON, Enum as SQLEnum, TypeDecorator
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
import enum

class DialectArray(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_ARRAY(String))
        return dialect.type_descriptor(JSON)

class WorkflowStatus(str, enum.Enum):
    RECEIVED = "RECEIVED"
    PROCESSING = "PROCESSING"
    XML_GENERATED = "XML_GENERATED"
    PUBLISHED = "PUBLISHED"

class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String)
    users = relationship("User", secondary="user_roles", back_populates="roles")

class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(String, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    
    users = relationship("User", back_populates="team", foreign_keys="[User.team_id]")
    projects = relationship("Project", back_populates="team")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    is_active = Column(Boolean, default=True)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    customer_access = Column(DialectArray, nullable=True, default=list)

    team = relationship("Team", back_populates="users", foreign_keys=[team_id])
    roles = relationship("Role", secondary="user_roles", back_populates="users")

class UserRole(Base):
    __tablename__ = "user_roles"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id"), primary_key=True)

class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    code = Column(String, unique=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    client_name = Column(String, nullable=True)
    xml_standard = Column(String)
    status = Column(String, default="RECEIVED")
    team_id = Column(Integer, ForeignKey("teams.id"))
    workflow_type = Column(String, nullable=True)
    workflow_stage_no = Column(String, nullable=True)
    # WMS project fields
    division_code = Column(String, nullable=True)
    customer_contact = Column(String, nullable=True)
    category = Column(String, nullable=True)
    composition = Column(String, nullable=True)
    project_manager = Column(String, nullable=True)
    sales_person = Column(String, nullable=True)
    priority = Column(String, nullable=True)
    edition = Column(String, nullable=True)
    color = Column(String, nullable=True)
    trim_size = Column(String, nullable=True)
    copyright_year = Column(Integer, nullable=True)
    manuscript_pages = Column(Integer, nullable=True)
    estimated_pages = Column(Integer, nullable=True)
    actual_pages = Column(Integer, nullable=True)
    chapter_count_wms = Column(Integer, nullable=True)
    isbn_no = Column(String, nullable=True)
    billing_location = Column(String, nullable=True)
    due_date = Column(Date, nullable=True)
    file_details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    team = relationship("Team", back_populates="projects")
    files = relationship("File", back_populates="project")
    chapters = relationship("Chapter", back_populates="project", cascade="all, delete-orphan")
    stylesheets = relationship("ProjectStylesheet", back_populates="project", cascade="all, delete-orphan")

class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    number = Column(String, index=True)
    title = Column(String)
    
    project = relationship("Project", back_populates="chapters")
    files = relationship("File", back_populates="chapter")

class File(Base):
    __tablename__ = "files"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    chapter_id = Column(Integer, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=True, index=True)
    filename = Column(String, index=True)
    file_type = Column(String)
    category = Column(String, default="Manuscript") # Art, Manuscript, InDesign, Proof, XML
    path = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    version = Column(Integer, default=1)
    
    project = relationship("Project", back_populates="files")
    chapter = relationship("Chapter", back_populates="files")
    
    # Checkout Logic
    is_checked_out = Column(Boolean, default=False)
    checked_out_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    checked_out_at = Column(DateTime, nullable=True)
    
    checked_out_by = relationship("User", foreign_keys=[checked_out_by_id])
    versions = relationship("FileVersion", back_populates="original_file", cascade="all, delete-orphan")

class FileVersion(Base):
    __tablename__ = "file_versions"
    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), index=True)
    version_num = Column(Integer)
    path = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    original_file = relationship("File", back_populates="versions")
    uploaded_by = relationship("User")

class ProjectStylesheet(Base):
    __tablename__ = "project_stylesheets"
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    selected_ia_rows = Column(String, nullable=False, default="[]")
    analyzed_file_ids = Column(String, nullable=True, default="[]")  # JSON list of file IDs used to build this stylesheet
    is_active = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    project = relationship("Project", back_populates="stylesheets")
    created_by = relationship("User", foreign_keys=[created_by_id])


# Import all other domain models to register them in Base.metadata for foreign keys
from app.domains.clients.models import Client  # noqa: F401
from app.domains.workflow.models import (  # noqa: F401
    RolesMaster,
    StageActivityMaster,
    StageMaster,
    StageDetail,
    WorkflowMaster,
    ChapterInfo,
)



