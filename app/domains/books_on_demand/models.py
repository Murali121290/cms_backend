from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base

class BodJob(Base):
    __tablename__ = "bod_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_name = Column(String(255), nullable=True)
    eisbn = Column(String(100), nullable=True)
    pdf_filename = Column(String(255), nullable=False)
    pdf_filepath = Column(String(1024), nullable=True)
    cover_filename = Column(String(255), nullable=True)
    cover_filepath = Column(String(1024), nullable=True)
    pdf_page_count = Column(Integer, nullable=True)
    pdf_type = Column(String(50), nullable=True)
    pdf_language = Column(String(50), nullable=True)
    epub_filename = Column(String(255), nullable=True)
    epub_filepath = Column(String(1024), nullable=True)
    ace_report_filepath = Column(String(1024), nullable=True)
    epubcheck_report_filepath = Column(String(1024), nullable=True)
    current_stage_index = Column(Integer, default=0, nullable=False)
    current_stage_name = Column(String(255), nullable=False)
    current_assignee = Column(String(255), nullable=True)
    assigned_users = Column(JSON, nullable=False, default=list) # History of assignments: [{"user_id": "...", "stage": "...", "time": "...", "assigned_by": "..."}]
    stage_history = Column(JSON, nullable=False, default=dict) # e.g. {"Production": {"assignee": "user", "start_time": "...", "end_time": "..."}}
    status = Column(String(50), default="Active") # "Active", "Completed", "Failed"
    is_deleted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    due_date = Column(DateTime(timezone=True), nullable=True)
    due_date_history = Column(JSON, nullable=False, default=list) # [{"date": "...", "reason": "...", "changed_by": "...", "timestamp": "..."}]
    dispatched_by = Column(String(255), nullable=True)
    dispatched_at = Column(DateTime(timezone=True), nullable=True)
    is_fastrack = Column(Boolean, default=False, nullable=False)
    fastrack_requested_date = Column(DateTime(timezone=True), nullable=True)
    file_history = Column(JSON, nullable=False, default=list) # [{"filename": "...", "backup_filename": "...", "backup_filepath": "...", "uploaded_by": "...", "timestamp": "...", "stage": "..."}]
    hold_support_history = Column(JSON, nullable=False, default=list) # [{"id": "...", "type": "Hold"|"Support", "status": "Open"|"Resolved", "query_reason": "...", "created_by": "...", "created_at": "...", "resolution_notes": "...", "resolved_by": "...", "resolved_at": "..."}]


class BodCsvEntry(Base):
    """
    Stores CSV manifest metadata fetched from the FTP or uploaded.
    Used for matching incoming PDFs to their expected ISBN and metadata.
    """
    __tablename__ = "bod_csv_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    isbn = Column(String(100), nullable=True, index=True)
    raw_filename = Column(String(255), nullable=True) # File Name in CSV if present (e.g. Demo_Book_1.pdf)
    source_csv_filename = Column(String(255), nullable=True)
    pages = Column(Integer, nullable=True)
    pdf_type = Column(String(50), nullable=True)
    language = Column(String(50), nullable=True)
    extra_data = Column(JSON, nullable=True) # Full row data as dict
    matched_job_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))



