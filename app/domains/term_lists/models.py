"""Term Lists — client-specific and generic lists of terms highlighted during Language Editing."""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.database import Base


class TermList(Base):
    """A named collection of terms. Scoped either to a client (e.g. LWW nursing)
    or 'generic' (e.g. APA Bias-Free, usable across any project).
    """
    __tablename__ = "term_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    scope = Column(String(32), nullable=False, default="client", index=True)  # 'client' | 'generic'
    client_id = Column(BigInteger, ForeignKey("clients.id", ondelete="SET NULL"),
                       nullable=True, index=True)
    source_file = Column(String(255), nullable=True)
    source_file_path = Column(String(1024), nullable=True)
    term_count = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                           nullable=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    client = relationship("Client", foreign_keys=[client_id])
    created_by = relationship("User", foreign_keys=[created_by_id])
    terms = relationship("Term", back_populates="term_list", cascade="all, delete-orphan")
    project_assignments = relationship("ProjectTermList", back_populates="term_list",
                                       cascade="all, delete-orphan")


class Term(Base):
    """A single term within a term list.

    `term_norm` holds a lowercased form used for lookup / dedup. `group_id` is
    an integer that groups adjacent-row variants that share a concept
    (e.g. ``1-D`` / ``one-dimensional`` / ``one dimensional``). ``is_italic``
    and ``is_bold`` preserve typographic metadata from the source Excel.
    """
    __tablename__ = "terms"

    id = Column(Integer, primary_key=True, index=True)
    term_list_id = Column(Integer, ForeignKey("term_lists.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    term = Column(String(512), nullable=False)
    term_norm = Column(String(512), nullable=False, index=True)
    group_id = Column(Integer, nullable=True, index=True)
    order_in_group = Column(Integer, nullable=False, default=0)
    is_italic = Column(Boolean, nullable=False, default=False)
    is_bold = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("term_list_id", "term", name="uq_terms_list_term"),
    )

    term_list = relationship("TermList", back_populates="terms")


class ProjectTermList(Base):
    """Many-to-many: a project can have multiple term lists assigned.
    Rules Picker is per-project; Term Lists are per-project too, but drawn
    from a shared library.
    """
    __tablename__ = "project_term_lists"

    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"),
                        primary_key=True)
    term_list_id = Column(Integer, ForeignKey("term_lists.id", ondelete="CASCADE"),
                          primary_key=True)
    assigned_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"),
                            nullable=True)
    assigned_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    term_list = relationship("TermList", back_populates="project_assignments")
    project = relationship("Project", foreign_keys=[project_id])
    assigned_by = relationship("User", foreign_keys=[assigned_by_id])
