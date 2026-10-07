from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
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


class ProjectLanguageRules(Base):
    """DB-first storage for the per-project Rules Picker selection.

    One row per project. `rules` holds the full list of rule dicts with
    `enabled` flags; the engine reads this row at analyze time. JSON view
    and download endpoints serialise the same row.
    """
    __tablename__ = "project_language_rules"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"),
                        unique=True, nullable=False, index=True)
    profile_key = Column(String(64), nullable=False, default="uk", server_default="uk")
    rules = Column(JSON, nullable=False)
    variant_to_canonical = Column(JSON, nullable=True)
    name = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    updated_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                           nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                        nullable=False)

    project = relationship("Project", foreign_keys=[project_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])


class ProjectLanguageRulesHistory(Base):
    """Audit log of per-project language-rule selections.

    One row per Save on the Rules Picker page. `enabled_rule_ids` /
    `disabled_rule_ids` are convenience summaries; `new_rules` is the full
    snapshot of what was saved so a reviewer can diff two rows directly.
    """
    __tablename__ = "project_language_rules_history"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    profile_key = Column(String(64), nullable=True)
    enabled_rule_ids = Column(JSON, nullable=True)
    disabled_rule_ids = Column(JSON, nullable=True)
    previous_rules = Column(JSON, nullable=True)
    new_rules = Column(JSON, nullable=False)
    note = Column(Text, nullable=True)

    project = relationship("Project", foreign_keys=[project_id])
    changed_by = relationship("User", foreign_keys=[changed_by_id])
