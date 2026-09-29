from sqlalchemy import (
    Column, Integer, BigInteger, String, ForeignKey, Text, JSON, DateTime, Date, Boolean, Float, func
)
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class JournalClient(Base):
    """Journal Publisher Client (e.g. Elsevier, Springer, Wiley)"""
    __tablename__ = "journal_clients"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    client_code = Column(String(100), unique=True, nullable=False, index=True)
    publisher_name = Column(String(255), nullable=False)
    jats_version = Column(String(50), default="1.3", nullable=False) # e.g. JATS 1.3, BITS
    contact_email = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    active_status = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    journals = relationship("Journal", back_populates="client", cascade="all, delete-orphan")


class Journal(Base):
    """Journal Publication Title (equivalent to Book / Project entity)"""
    __tablename__ = "journals"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    client_id = Column(BigInteger, ForeignKey("journal_clients.id", ondelete="CASCADE"), nullable=False, index=True)
    journal_code = Column(String(100), unique=True, nullable=False, index=True)
    journal_title = Column(Text, nullable=False)
    issn_print = Column(String(50), nullable=True)
    issn_online = Column(String(50), nullable=True)
    volume = Column(String(50), nullable=True)
    issue = Column(String(50), nullable=True)
    journal_manager = Column(String(150), ForeignKey("users.username", ondelete="SET NULL", onupdate="CASCADE"), nullable=True)
    status = Column(String(50), default="Active", nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    client = relationship("JournalClient", back_populates="journals")
    articles = relationship("JournalArticle", back_populates="journal", cascade="all, delete-orphan")
    stylesheets = relationship("JournalStylesheet", back_populates="journal", cascade="all, delete-orphan")
    grammarsheets = relationship("JournalGrammarsheet", back_populates="journal", cascade="all, delete-orphan")


class JournalArticle(Base):
    """Journal Article Manuscript (equivalent to Chapter entity)"""
    __tablename__ = "journal_articles"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    journal_id = Column(BigInteger, ForeignKey("journals.id", ondelete="CASCADE"), nullable=False, index=True)
    article_doi = Column(String(255), unique=True, nullable=True, index=True)
    vendor_article_id = Column(String(100), nullable=True, index=True)
    article_title = Column(Text, nullable=False)
    article_type = Column(String(100), default="Research Article", nullable=False)
    lead_author = Column(String(255), nullable=True)
    corresponding_email = Column(String(255), nullable=True)
    abstract = Column(Text, nullable=True)
    keywords = Column(JSON, nullable=True)
    extracted_metadata = Column(JSON, nullable=True) # Extracted fields from DOCX frontmatter
    manuscript_pages = Column(Integer, nullable=True)
    word_count = Column(Integer, nullable=True)
    
    # Workflow Status & Assignee
    current_stage = Column(String(100), default="1. Pre-Editing (XHTML)", nullable=False)
    current_assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(30), default="In-progress", nullable=False) # In-progress, Completed, Hold
    priority = Column(String(30), default="Normal", nullable=False)
    complexity_level = Column(String(30), default="Medium", nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True)
    
    # Process Paths
    original_docx_path = Column(String(500), nullable=True)
    xhtml_path = Column(String(500), nullable=True)
    edited_docx_path = Column(String(500), nullable=True)
    jats_xml_path = Column(String(500), nullable=True)
    indesign_path = Column(String(500), nullable=True)
    proof_pdf_path = Column(String(500), nullable=True)
    final_delivery_path = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    journal = relationship("Journal", back_populates="articles")
    stages = relationship("JournalStageDetail", back_populates="article", cascade="all, delete-orphan")
    files = relationship("JournalFile", back_populates="article", cascade="all, delete-orphan")
    deliveries = relationship("JournalDelivery", back_populates="article", cascade="all, delete-orphan")
    current_assignee = relationship("User", foreign_keys=[current_assignee_id])


class JournalStageDetail(Base):
    """Detail tracking per stage (Stages 1 through 8) for an article"""
    __tablename__ = "journal_stage_details"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    article_id = Column(BigInteger, ForeignKey("journal_articles.id", ondelete="CASCADE"), nullable=False, index=True)
    stage_number = Column(Integer, nullable=False) # 1 through 8
    stage_name = Column(String(100), nullable=False) # 1. Pre-Editing (XHTML), ..., 8. Final Delivery
    assignee_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    planned_start_date = Column(DateTime(timezone=True), nullable=True)
    planned_end_date = Column(DateTime(timezone=True), nullable=True)
    actual_start_date = Column(DateTime(timezone=True), nullable=True)
    actual_end_date = Column(DateTime(timezone=True), nullable=True)
    sla_hours = Column(Integer, default=24, nullable=True)
    stage_status = Column(String(30), default="Pending", nullable=False) # Pending, In-progress, Completed, Hold
    delayed = Column(Boolean, default=False, nullable=False)
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    article = relationship("JournalArticle", back_populates="stages")
    assignee = relationship("User", foreign_keys=[assignee_id])


class JournalStylesheet(Base):
    """Journal-level pre-configured Style Sheet for Technical Editing stage rules"""
    __tablename__ = "journal_stylesheets"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    journal_id = Column(BigInteger, ForeignKey("journals.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    style_rules = Column(JSON, nullable=False, default=dict) # Section, Figure, Table, MathML rules
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    journal = relationship("Journal", back_populates="stylesheets")


class JournalGrammarsheet(Base):
    """Journal-level pre-configured Grammar Sheet for Language Editing stage rules"""
    __tablename__ = "journal_grammarsheets"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    journal_id = Column(BigInteger, ForeignKey("journals.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    language_variant = Column(String(50), default="US_English", nullable=False)
    grammar_rules = Column(JSON, nullable=False, default=dict) # Dictionary, hyphenation, terminology
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    journal = relationship("Journal", back_populates="grammarsheets")


class JournalFile(Base):
    """Files attached to a Journal Article"""
    __tablename__ = "journal_files"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    article_id = Column(BigInteger, ForeignKey("journal_articles.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    category = Column(String(100), nullable=False) # Manuscript, XHTML, JATS_XML, Ref_Log, INDD, Proof_PDF, Delivery_ZIP
    path = Column(String(500), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    version = Column(Integer, default=1, nullable=False)
    is_original = Column(Boolean, default=True, nullable=False)

    article = relationship("JournalArticle", back_populates="files")


class JournalDelivery(Base):
    """Log of Final Delivery Packages exported to publishers"""
    __tablename__ = "journal_deliveries"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    article_id = Column(BigInteger, ForeignKey("journal_articles.id", ondelete="CASCADE"), nullable=False, index=True)
    package_name = Column(String(255), nullable=False) # e.g. ELSA_JAIS_10-1016-jais-2026-04-001.zip
    jats_xml_file = Column(String(500), nullable=True)
    pdf_file = Column(String(500), nullable=True)
    indd_file = Column(String(500), nullable=True)
    delivery_channel = Column(String(100), default="FTP_UPLOAD", nullable=False) # FTP, S3, WebDAV, API
    delivery_status = Column(String(50), default="Delivered", nullable=False)
    delivered_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    exported_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    article = relationship("JournalArticle", back_populates="deliveries")
