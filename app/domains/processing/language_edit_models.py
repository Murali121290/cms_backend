from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base




class LanguageEditJob(Base):
    __tablename__ = "language_edit_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String, unique=True, index=True, nullable=False)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), index=True, nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    status = Column(String, default="processing", index=True)  # processing | in_review | completed | failed
    total_findings = Column(Integer, default=0)
    accepted_count = Column(Integer, default=0)
    edited_count = Column(Integer, default=0)
    rejected_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    file = relationship("File", foreign_keys=[file_id])
    project = relationship("Project", foreign_keys=[project_id])


class LanguageEditFinding(Base):
    __tablename__ = "language_edit_findings"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String, ForeignKey("language_edit_jobs.job_id", ondelete="CASCADE"), index=True, nullable=False)
    file_id = Column(Integer, ForeignKey("files.id", ondelete="CASCADE"), index=True, nullable=False)
    para_index = Column(Integer, nullable=False)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    rule_id = Column(String, nullable=False)
    category = Column(String, nullable=False)    # grammar | spelling | sentence
    severity = Column(String, default="warning") # error | warning | suggestion
    original_text = Column(Text, nullable=False)
    suggestion = Column(Text, nullable=False)
    message = Column(Text, default="")
    autofixable = Column(Boolean, default=True)
    status = Column(String, default="pending", index=True) # pending | accepted | edited | rejected
    edited_text = Column(Text, nullable=True)
    reviewer = Column(String, nullable=True)
    decided_at = Column(DateTime, nullable=True)
