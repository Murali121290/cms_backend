from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, Text, JSON, DateTime, Date, Boolean, func
from sqlalchemy.orm import relationship, synonym
from datetime import datetime
from app.database import Base

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

    # ORM Relationships (references by string string to prevent circular imports)
    files = relationship("File", back_populates="project")
    chapters = relationship("ChapterInfo", primaryjoin="Project.project_code == ChapterInfo.project", foreign_keys="[ChapterInfo.project]", back_populates="project_rel", cascade="all, delete-orphan")
    stylesheets = relationship("ProjectStylesheet", back_populates="project", cascade="all, delete-orphan")
    client = relationship("Client", back_populates="projects")

    # SQLAlchemy Synonyms for backward compatibility
    title = synonym("project_title")
    code = synonym("project_code")
    chapter_count_wms = synonym("chapter_count")


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
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    project = relationship("Project", back_populates="stylesheets")
    created_by = relationship("User", foreign_keys=[created_by_id])
