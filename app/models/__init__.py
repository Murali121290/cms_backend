from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Date, JSON, Enum as SQLEnum, TypeDecorator, BigInteger, Text, func
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY, JSONB
from sqlalchemy.orm import relationship, synonym
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

class CompatibilityRoleItem:
    def __init__(self, name: str, role_id: int = 1):
        self.name = name
        self.id = role_id

    def __repr__(self):
        return f"<CompatibilityRoleItem name={self.name}>"

    def __eq__(self, other):
        if isinstance(other, str):
            return self.name.lower() == other.lower()
        if isinstance(other, CompatibilityRoleItem):
            return self.name.lower() == other.name.lower()
        return False

class CompatibilityRolesList(list):
    def __contains__(self, item):
        if isinstance(item, str):
            return any(r.name.lower() == item.lower() for r in self)
        return super().__contains__(item)

ROLE_MAP = {
    "admin": "Admin",
    "viewer": "Viewer",
    "manager": "ProjectManager",
    "copyeditor": "CopyEditor",
    "technical_copyeditor": "TechnicalCopyEditor",
    "typesetter": "Typesetter",
    "pereditor": "PreEditor",
    "qa_reviewer": "QAReviewer",
    "operations_manager": "OperationsManager",
    "finance_analyst": "FinanceAnalyst",
    "support": "Support",
    "developer": "Developer",
    "analyst": "Analyst",
    "designer": "Designer"
}

def map_role_to_capitalized(role_name: str) -> str:
    if not role_name:
        return "Viewer"
    return ROLE_MAP.get(role_name.lower(), role_name.capitalize())


class DialectJSONB(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)
        return dialect.type_descriptor(JSON)


class User(Base):
    __tablename__ = "users"
    id              = Column(BigInteger, primary_key=True, autoincrement=True)
    username        = Column(String(150),  unique=True, nullable=False, index=True)
    email           = Column(String(255),  unique=True, nullable=False, index=True)
    password_hash   = Column(Text,         nullable=False)
    role            = Column(String(50),   nullable=False)
    team            = Column(String(50),   nullable=False)
    customer_access = Column(DialectJSONB,  nullable=False, default=list)
    active_status   = Column(Boolean,      nullable=False, default=True)
    created_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    is_active       = synonym("active_status")

    @property
    def roles(self):
        if not self.role:
            return CompatibilityRolesList()
        cap_role = map_role_to_capitalized(self.role)
        role_id = 1
        if self.role.lower() == "admin":
            role_id = 4
        elif self.role.lower() == "viewer":
            role_id = 1
        elif self.role.lower() == "manager":
            role_id = 3
        return CompatibilityRolesList([CompatibilityRoleItem(cap_role, role_id)])

class Project(Base):
    __tablename__ = "projects"

    id               = Column(Integer,     primary_key=True, autoincrement=True)
    client_id        = Column(BigInteger,  ForeignKey("clients.id", ondelete="CASCADE"), nullable=True)
    project_code     = Column(String(100), unique=True, nullable=True, index=True)
    client_name      = Column(String,      nullable=True)
    xml_standard     = Column(String,      nullable=True)
    division_code    = Column(String(100), nullable=True)
    customer_contact = Column(String(255), nullable=True)
    category         = Column(String(100), nullable=True)
    composition      = Column(String(50),  nullable=True)
    workflow_name    = Column(String(255), nullable=True)
    status           = Column(String(50),  nullable=True)
    project_manager  = Column(String(150), ForeignKey("users.username", ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    sales_person     = Column(String(255), nullable=True)
    priority         = Column(String(50),  nullable=True)
    project_title    = Column(Text,        nullable=True)
    edition          = Column(String(50),  nullable=True)
    color            = Column(String(100), nullable=True)
    trim_size        = Column(String(50),  nullable=True)
    copyright_year   = Column(Integer,     nullable=True)
    manuscript_pages = Column(Integer,     nullable=True)
    estimated_pages  = Column(Integer,     nullable=True)
    actual_pages     = Column(Integer,     nullable=False, default=0)
    chapter_count    = Column(Integer,     nullable=True)
    isbn_no          = Column(String(20),  nullable=True)
    billing_location = Column(String(255), nullable=True)
    due_date         = Column(Date,        nullable=True)
    file_details     = Column(JSON,        nullable=True)
    created_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # ORM Relationships
    files = relationship("File", back_populates="project")
    chapters = relationship("Chapter", back_populates="project", cascade="all, delete-orphan")
    stylesheets = relationship("ProjectStylesheet", back_populates="project", cascade="all, delete-orphan")
    client = relationship("Client", back_populates="projects")

    # SQLAlchemy Synonyms for backward compatibility
    title = synonym("project_title")
    code = synonym("project_code")
    chapter_count_wms = synonym("chapter_count")

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



