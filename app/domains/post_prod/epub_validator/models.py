from datetime import datetime

from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class EvProject(Base):
    """One row per uploaded EPUB book in the EPUB Validator tool.

    Replaces the legacy EpubBook / EpubBookEvent models.
    Disk layout: <UPLOAD_DIR>/<folder_name>/  (flat, unique slug)
    """

    __tablename__ = "post_prod_ev_projects"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Client info (from the Clients table at upload time — stored as strings so
    # the record survives client renames / deletions)
    client = Column(String(255), nullable=False)          # company display name
    client_code = Column(String(100), nullable=True)      # division / client code

    # Project identification
    project_name = Column(String(255), nullable=False)    # user-typed at upload
    folder_name = Column(String(255), unique=True, nullable=False, index=True)  # disk key / slug

    # EPUB metadata
    epub_path = Column(Text, nullable=False)              # abs path to extracted epub/
    total_files = Column(Integer, nullable=False, default=0)
    eisbn = Column(String(100), nullable=True)            # optional eISBN
    copyright_year = Column(String(50), nullable=True)    # optional copyright year

    # Lifecycle status
    # "uploaded" → "validated" | "failed"
    status = Column(String(50), nullable=False, default="uploaded")
    # "pass" | "fail" | null (null means never validated)
    validation_status = Column(String(50), nullable=True)
    latest_validation_file = Column(String(255), nullable=True)
    # Assignee username (free string, mirrors WC pattern)
    assignee = Column(String(255), nullable=True)

    # Audit
    uploaded_by_id = Column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    uploaded_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    is_deleted = Column(Boolean, nullable=False, default=False)

    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])


class EvHistory(Base):
    """Assignee change & validation execution history for post_prod_ev_projects."""

    __tablename__ = "post_prod_ev_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(
        Integer,
        ForeignKey("post_prod_ev_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    changed_by_id = Column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    changed_by_username = Column(String(255), nullable=True)
    old_assignee = Column(String(255), nullable=True)
    new_assignee = Column(String(255), nullable=True)
    result_type = Column(String(50), nullable=False, default="assignee_change")  # "assignee_change" | "validation"
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    project = relationship("EvProject", foreign_keys=[project_id])
    changed_by = relationship("User", foreign_keys=[changed_by_id])

