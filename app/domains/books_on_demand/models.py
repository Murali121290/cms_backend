from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

class BodClientConfig(Base):
    __tablename__ = "bod_client_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_name = Column(String(255), nullable=False, unique=True)
    ftp_host = Column(String(255), nullable=False)
    ftp_username = Column(String(255), nullable=False)
    ftp_password = Column(String(255), nullable=False)
    manager_email = Column(String(255), nullable=False)
    custom_stages = Column(JSON, nullable=False, default=list) # e.g. ["Add job", "Production", "QC", "Archive"]
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    jobs = relationship("BodJob", back_populates="client_config", cascade="all, delete-orphan")


class BodJob(Base):
    __tablename__ = "bod_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer, ForeignKey("bod_client_configs.id"), nullable=False)
    project_name = Column(String(255), nullable=True)
    pdf_filename = Column(String(255), nullable=False)
    pdf_filepath = Column(String(1024), nullable=True)
    epub_filename = Column(String(255), nullable=True)
    epub_filepath = Column(String(1024), nullable=True)
    current_stage_index = Column(Integer, default=0, nullable=False)
    current_stage_name = Column(String(255), nullable=False)
    current_assignee = Column(String(255), nullable=True)
    assigned_users = Column(JSON, nullable=False, default=list) # History of assignments: [{"user_id": "...", "stage": "...", "time": "...", "assigned_by": "..."}]
    stage_history = Column(JSON, nullable=False, default=dict) # e.g. {"Production": {"assignee": "user", "start_time": "...", "end_time": "..."}}
    status = Column(String(50), default="Active") # "Active", "Completed", "Failed"
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    client_config = relationship("BodClientConfig", back_populates="jobs")
