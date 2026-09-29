from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from datetime import datetime


# Journal Client Schemas
class JournalClientBase(BaseModel):
    client_code: str
    publisher_name: str
    jats_version: str = "1.3"
    contact_email: Optional[str] = None
    website: Optional[str] = None
    active_status: bool = True


class JournalClientCreate(JournalClientBase):
    pass


class JournalClientResponse(JournalClientBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Journal Schemas
class JournalBase(BaseModel):
    journal_code: str
    journal_title: str
    client_id: int
    issn_print: Optional[str] = None
    issn_online: Optional[str] = None
    volume: Optional[str] = None
    issue: Optional[str] = None
    journal_manager: Optional[str] = None
    status: str = "Active"


class JournalCreate(JournalBase):
    pass


class JournalResponse(JournalBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Journal Article Schemas
class JournalArticleBase(BaseModel):
    journal_id: int
    article_doi: Optional[str] = None
    vendor_article_id: Optional[str] = None
    article_title: str
    article_type: str = "Research Article"
    lead_author: Optional[str] = None
    corresponding_email: Optional[str] = None
    abstract: Optional[str] = None
    keywords: Optional[List[str]] = None
    priority: str = "Normal"
    complexity_level: str = "Medium"
    due_date: Optional[datetime] = None


class JournalArticleCreate(JournalArticleBase):
    extracted_metadata: Optional[Dict[str, Any]] = None


class JournalArticleResponse(JournalArticleBase):
    id: int
    current_stage: str
    current_assignee_id: Optional[int] = None
    status: str
    xhtml_path: Optional[str] = None
    jats_xml_path: Optional[str] = None
    proof_pdf_path: Optional[str] = None
    final_delivery_path: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Stage Assignment & Advance Schema
class StageAssignmentRequest(BaseModel):
    article_id: int
    target_stage: str
    assignee_id: int
    planned_start_date: Optional[datetime] = None
    planned_end_date: Optional[datetime] = None
    sla_hours: int = 24
    complexity_level: str = "Medium"


class StageAdvanceRequest(BaseModel):
    article_id: int
    current_stage: str
    remarks: Optional[str] = None
