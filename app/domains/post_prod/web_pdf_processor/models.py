from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class WebPdfProject(Base):
    """One row per uploaded Web PDF project package."""

    __tablename__ = "post_prod_web_pdf_projects"

    id = Column(Integer, primary_key=True, autoincrement=True)

    client = Column(String(255), nullable=False)
    client_code = Column(String(100), nullable=True)
    project_name = Column(String(255), nullable=False)
    folder_name = Column(String(255), unique=True, nullable=False, index=True)

    pdf_path = Column(Text, nullable=False)
    total_files = Column(Integer, nullable=False, default=0)

    status = Column(String(50), nullable=False, default="Active")
    validation_status = Column(String(50), nullable=True, default=None)
    latest_validation_file = Column(String(255), nullable=True)
    assignee = Column(String(255), nullable=True, default=None)

    uploaded_by_id = Column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    is_deleted = Column(Boolean, nullable=False, default=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])


class WebPdfHistory(Base):
    """History of assignee changes and merge operations for post_prod_web_pdf_projects."""

    __tablename__ = "post_prod_web_pdf_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(
        Integer,
        ForeignKey("post_prod_web_pdf_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    changed_by_id = Column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    changed_by_username = Column(String(255), nullable=True)
    old_assignee = Column(String(255), nullable=True)
    new_assignee = Column(String(255), nullable=True)
    result_type = Column(String(50), nullable=False, default="assignee_change")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Merge-specific fields
    merged_files = Column(JSON, nullable=True)
    merged_output_path = Column(Text, nullable=True)
    total_pages = Column(Integer, nullable=True)
    merge_status = Column(String(20), nullable=True)
    error_message = Column(Text, nullable=True)

    project = relationship("WebPdfProject", foreign_keys=[project_id])
    changed_by = relationship("User", foreign_keys=[changed_by_id])
