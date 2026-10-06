from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict, Literal
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
    workflow_id: Optional[int] = None


class JournalCreate(JournalBase):
    pass


class JournalResponse(JournalBase):
    id: int
    workflow_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Journal Workflow Schemas
class JournalWorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: Optional[str] = None
    stage_numbers: List[int] = Field(min_length=1)
    is_default: bool = False


class JournalWorkflowResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    stage_numbers: List[int]
    stages: List[str]
    is_default: bool
    is_active: bool


# Overview rows for the client -> journal -> article pages
class ArticleCounts(BaseModel):
    total: int = 0
    in_progress: int = 0
    completed: int = 0
    delayed: int = 0


class JournalClientOverview(JournalClientResponse):
    journal_count: int = 0
    articles: ArticleCounts = Field(default_factory=ArticleCounts)


class JournalSetupStatus(BaseModel):
    template: Optional[str] = None       # active InDesign template file name
    template_version: Optional[int] = None
    fonts: int = 0
    stylesheet: Optional[str] = None     # active style sheet name
    grammarsheet: Optional[str] = None   # active grammar sheet name


class JournalOverview(JournalResponse):
    client_code: Optional[str] = None
    publisher_name: Optional[str] = None
    stages: List[str] = Field(default_factory=list)
    articles: ArticleCounts = Field(default_factory=ArticleCounts)
    setup: JournalSetupStatus = Field(default_factory=JournalSetupStatus)


class ArticleStageStatus(BaseModel):
    stage_number: int
    stage_name: str
    stage_status: str
    assignee_id: Optional[int] = None
    planned_end_date: Optional[datetime] = None


class JournalArticleRow(BaseModel):
    id: int
    article_doi: Optional[str] = None
    article_title: str
    article_type: str
    lead_author: Optional[str] = None
    current_stage: str
    status: str
    priority: str
    complexity_level: str = "Medium"
    due_date: Optional[datetime] = None
    revised_due_date: Optional[datetime] = None
    current_assignee_id: Optional[int] = None
    current_assignee_name: Optional[str] = None
    delayed: bool = False
    delay_category: Optional[str] = None
    delay_reason: Optional[str] = None
    delay_days: Optional[int] = 0
    open_errors: int = 0
    stages: List[ArticleStageStatus] = Field(default_factory=list)
    created_at: datetime


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
    assigned_user_name: Optional[str] = None
    status: str
    is_delayed: bool = False
    delay_category: Optional[str] = None
    delay_reason: Optional[str] = None
    revised_due_date: Optional[datetime] = None
    delay_days: Optional[int] = 0
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


class ArticleAssignRequest(BaseModel):
    stage_number: Optional[int] = None
    assignee_name: Optional[str] = None
    assignee_id: Optional[int] = None
    planned_start_date: Optional[datetime] = None
    planned_end_date: Optional[datetime] = None
    sla_hours: Optional[int] = 24
    complexity_level: Optional[str] = "Medium"
    remarks: Optional[str] = None


class ArticleDelayUpdateRequest(BaseModel):
    delay_category: str
    revised_due_date: datetime
    delay_days: Optional[int] = 0
    delay_reason: str


class StageAdvanceRequest(BaseModel):
    article_id: int
    current_stage: str
    remarks: Optional[str] = None


class StageAdvanceBody(BaseModel):
    remarks: Optional[str] = None


# Journal Style Sheet / Grammar Sheet Schemas
class JournalStylesheetCreate(BaseModel):
    name: str
    description: Optional[str] = None
    style_rules: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class JournalStylesheetResponse(JournalStylesheetCreate):
    id: int
    journal_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class JournalGrammarsheetCreate(BaseModel):
    name: str
    language_variant: str = "US_English"
    grammar_rules: Dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class JournalGrammarsheetResponse(JournalGrammarsheetCreate):
    id: int
    journal_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# Validation Check Schemas
class JournalCheckRunResponse(BaseModel):
    id: int
    article_id: int
    module: str
    stage_number: int
    status: str
    rule_set_version: Optional[str] = None
    rules_total: int
    rules_passed: int
    started_at: datetime
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JournalIssueResponse(BaseModel):
    id: int
    article_id: int
    run_id: Optional[int] = None
    module: str
    rule_id: str
    severity: str
    title: str
    message: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    context_snippet: Optional[str] = None
    suggestion: Optional[Dict[str, Any]] = None
    source_issue_id: Optional[int] = None
    status: str
    resolution: Optional[str] = None
    resolved_by_id: Optional[int] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class JournalIssueAction(BaseModel):
    action: Literal["accept", "ignore", "reopen"]
