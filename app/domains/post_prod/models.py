from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class PostProdProject(Base):
    __tablename__ = "post_prod_projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_name = Column(String(255), nullable=False)
    project_name = Column(String(255), nullable=False)
    status = Column(String(50), default="Active")  # e.g., "Active", "Completed"
    assignee = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chapters = relationship("PostProdChapter", back_populates="project", cascade="all, delete-orphan")

class PostProdChapter(Base):
    __tablename__ = "post_prod_chapters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("post_prod_projects.id", ondelete="CASCADE"), nullable=False)
    chapter_no = Column(String(50), nullable=False)
    status = Column(String(50), default="YTS")  # "YTS", "Pending", "Converting", "Completed", "Failed"
    source_filename = Column(String, nullable=True)
    source_file_path = Column(String, nullable=True)
    converted_file_path = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    attempts = Column(Integer, default=0)

    project = relationship("PostProdProject", back_populates="chapters")
