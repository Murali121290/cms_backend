from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class PostProdProject(Base):
    __tablename__ = "post_prod_projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client = Column(String(255), nullable=False)
    client_code = Column(String(100), nullable=True)
    project_name = Column(String(255), nullable=False)
    status = Column(String(50), default="Active")  # e.g., "Active", "Completed"
    assignee = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chapters = relationship(
        "PostProdChapter",
        primaryjoin="and_(PostProdProject.project_name == PostProdChapter.project_name, PostProdProject.client_code == PostProdChapter.client_code)",
        foreign_keys="[PostProdChapter.project_name, PostProdChapter.client_code]",
        back_populates="project",
        cascade="all, delete-orphan"
    )

class PostProdChapter(Base):
    __tablename__ = "post_prod_chapters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_code = Column(String(100), nullable=True)
    project_name = Column(String(255), nullable=True)
    chapter_no = Column(String(50), nullable=False)
    status = Column(String(50), default="YTS")  # "YTS", "Pending", "Converting", "Completed", "Failed"
    source_filename = Column(String, nullable=True)
    source_file_path = Column(String, nullable=True)
    converted_file_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    attempts = Column(Integer, default=0)

    project = relationship(
        "PostProdProject",
        primaryjoin="and_(PostProdProject.project_name == PostProdChapter.project_name, PostProdProject.client_code == PostProdChapter.client_code)",
        foreign_keys="[PostProdChapter.project_name, PostProdChapter.client_code]",
        back_populates="chapters"
    )

