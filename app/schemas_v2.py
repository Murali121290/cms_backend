from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.domains.workflow.schemas import ChapterInfoResponse


class ErrorResponse(BaseModel):
    status: Literal["error"] = "error"
    code: str
    message: str
    field_errors: dict[str, str] | None = None
    details: dict[str, str | int | float | bool | None] | None = None


class Viewer(BaseModel):
    id: int
    username: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    roles: list[str]
    role: str | None = None
    additional_roles: list[str] = []
    additional_teams: list[str] = []
    is_active: bool
    team: str | None = None
    designation: str | None = None
    access_level: str | None = "standard"
    permissions: list[str] = []


class SessionAuth(BaseModel):
    mode: Literal["cookie", "bearer"] | None = None
    expires_at: datetime | None = None


class SessionState(BaseModel):
    authenticated: bool
    auth_mode: Literal["cookie"]
    expires_at: datetime | None = None


class SessionLoginRequest(BaseModel):
    username: str
    password: str
    redirect_to: str | None = None


class SessionLoginResponse(BaseModel):
    status: Literal["ok"] = "ok"
    session: SessionState
    viewer: Viewer
    redirect_to: str


class SessionRegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    confirm_password: str
    redirect_to: str | None = None


class SessionRegisterResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: Viewer
    redirect_to: str


class SessionGetResponse(BaseModel):
    authenticated: bool
    viewer: Viewer | None = None
    auth: SessionAuth


class SessionDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    redirect_to: str


class DashboardStats(BaseModel):
    total_projects: int
    on_time_rate: int
    on_time_trend: str
    avg_days: float
    avg_days_trend: str
    delayed_count: int
    delayed_trend: str


class LockState(BaseModel):
    is_checked_out: bool
    checked_out_by_id: int | None = None
    checked_out_by_username: str | None = None
    checked_out_at: datetime | None = None
    webdav_locked: bool = False
    webdav_locked_by: str | None = None
    webdav_locked_at: datetime | None = None


class ProjectSummary(BaseModel):
    id: int
    code: str
    title: str
    # WMS aliases
    project_code: str | None = None
    project_title: str | None = None
    workflow_name: str | None = None
    cilent_name: str | None = None
    # CMS fields
    client_id: int | None = None
    client_name: str | None = None
    xml_standard: str
    status: str | None = None
    chapter_count: int
    file_count: int
    workflow_name: str | None = None
    # WMS project fields
    division_code: str | None = None
    customer_contact: str | None = None
    category: str | None = None
    composition: str | None = None
    copyediting_level: str | None = None
    project_manager: str | None = None
    client_project_manager: str | None = None
    sales_person: str | None = None
    priority: str | None = None
    edition: str | None = None
    color: str | None = None
    trim_size: str | None = None
    copyright_year: int | None = None
    manuscript_pages: int | None = None
    estimated_pages: int | None = None
    actual_pages: int | None = None
    isbn_no: str | None = None
    billing_location: str | None = None
    billing_type: str | None = None
    project_type: str | None = None
    alt_text: str | None = None
    accessibility: str | None = None
    due_date: str | None = None
    due_date_history: list | None = None
    file_details: dict | None = None
    created_at: str | None = None
    updated_at: str | None = None
    is_delayed: bool = False


class POExtractionResponse(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    extras: dict[str, Any] = Field(default_factory=dict)
    template_detected: str
    warnings: list[str] = Field(default_factory=list)


class ChapterSummary(BaseModel):
    id: int
    project_id: int
    number: str
    title: str
    has_art: bool
    has_manuscript: bool
    has_indesign: bool
    has_proof: bool
    has_xml: bool
    xml_status: str | None = None
    indesign_status: str | None = None
    final_delivery_status: str | None = None
    style_status: str | None = None
    design_match_status: str | None = None
    structuring_status: str | None = None
    art_status: str | None = None


class FileRecord(BaseModel):
    id: int
    project_id: int
    chapter_id: int | None = None
    filename: str
    file_type: str
    category: str
    uploaded_at: datetime
    version: int
    lock: LockState
    available_actions: list[str] = Field(default_factory=list)
    size_bytes: int | None = None
    file_size: str | None = None
    uploaded_by: str | None = None
    page_count: int | None = None
    # Populated for image files (and the first page of PDFs). Powers the
    # Dimensions / DPI / Color Profile columns in the chapter file list.
    width: int | None = None
    height: int | None = None
    dpi: int | None = None
    color_profile: str | None = None
    # Set when this file was generated from another file (e.g. Figure PDF from
    # its source DOCX). Frontend groups derived artefacts under their source.
    source_file_id: int | None = None
    # False for pipeline/convert/edit outputs. Frontend uses this to route
    # converted image files (e.g. PNG from EPS) to a dedicated "Converted"
    # folder instead of the source's category folder.
    is_original: bool = True


class DashboardResponse(BaseModel):
    viewer: Viewer
    stats: DashboardStats
    projects: list[ProjectSummary]


class ProjectsPagination(BaseModel):
    offset: int
    limit: int
    total: int


class ProjectsListResponse(BaseModel):
    projects: list[ProjectSummary]
    pagination: ProjectsPagination


class FileListItem(FileRecord):
    project_code: str | None = None
    project_title: str | None = None
    chapter_number: str | None = None
    chapter_title: str | None = None


class FilesListResponse(BaseModel):
    files: list[FileListItem]
    pagination: ProjectsPagination


class ProjectDetail(ProjectSummary):
    chapters: list[ChapterSummary] = Field(default_factory=list)


class ProjectDetailResponse(BaseModel):
    project: ProjectDetail


class ProjectChaptersResponse(BaseModel):
    project: ProjectSummary
    chapters: list[ChapterSummary]


class ChapterCategoryCounts(BaseModel):
    Art: int = 0
    Manuscript: int = 0
    InDesign: int = 0
    Proof: int = 0
    XML: int = 0
    Miscellaneous: int = 0


class ChapterDetail(BaseModel):
    id: int
    project_id: int
    number: str
    title: str
    has_art: bool
    has_manuscript: bool
    has_indesign: bool
    has_proof: bool
    has_xml: bool
    category_counts: ChapterCategoryCounts


class ChapterDetailResponse(BaseModel):
    project: ProjectSummary
    chapter: ChapterDetail
    active_tab: str
    viewer: Viewer


class ChapterFilesResponse(BaseModel):
    project: ProjectSummary
    chapter: ChapterDetail
    files: list[FileRecord]
    viewer: Viewer


class FinalDeliveryFileItem(BaseModel):
    id: int
    chapter_id: int
    chapter_number: str
    chapter_title: str | None = None
    filename: str
    extension: str
    size_bytes: int | None = None
    uploaded_at: datetime


class FinalDeliveryFilesResponse(BaseModel):
    files: list[FinalDeliveryFileItem]


class NotificationItem(BaseModel):
    id: str
    type: Literal["file_upload"]
    title: str
    description: str
    relative_time: str
    icon: str
    color: str
    file_id: int | None = None
    project_id: int | None = None
    chapter_id: int | None = None


class NotificationsResponse(BaseModel):
    notifications: list[NotificationItem]
    refreshed_at: datetime


class ActivityEntityRef(BaseModel):
    id: int | None = None
    title: str


class ActivityItem(BaseModel):
    id: str
    type: Literal["upload", "version"]
    title: str
    description: str
    project: ActivityEntityRef
    chapter: ActivityEntityRef
    category: str
    timestamp: datetime
    relative_time: str
    icon: str
    color: str


class ActivitiesSummary(BaseModel):
    total: int
    today: int


class ActivitiesResponse(BaseModel):
    summary: ActivitiesSummary
    activities: list[ActivityItem]


class AdminDashboardStats(BaseModel):
    total_users: int
    total_files: int
    total_validations: int
    total_macro: int


class AdminDashboardResponse(BaseModel):
    viewer: Viewer
    stats: AdminDashboardStats


class AdminRole(BaseModel):
    id: int
    name: str
    description: str | None = None


class AdminUserRole(BaseModel):
    id: int
    name: str


class AdminUser(BaseModel):
    id: int
    username: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    is_active: bool
    roles: list[AdminUserRole]
    team: str | None = None
    additional_roles: list[str] = []
    additional_teams: list[str] = []
    customer_access: list[str] = []
    designation: str | None = None
    role: str | None = None
    access_level: str | None = None


class AdminUsersPagination(BaseModel):
    offset: int
    limit: int
    total: int


class AdminUsersResponse(BaseModel):
    users: list[AdminUser]
    roles: list[AdminRole]
    pagination: AdminUsersPagination


class AdminRolesResponse(BaseModel):
    roles: list[AdminRole]


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str | None = None
    designation: str | None = None
    team: str
    additional_roles: list[str] = []
    additional_teams: list[str] = []
    customer_access: list[str] = []
    active_status: bool | None = True


class UserUpdate(BaseModel):
    role: str | None = None
    designation: str | None = None
    team: str | None = None
    additional_roles: list[str] | None = None
    additional_teams: list[str] | None = None
    password: str | None = None
    customer_access: list[str] | None = None
    active_status: bool | None = None


class UserStatusUpdate(BaseModel):
    active_status: bool



class AdminUserResponse(BaseModel):
    user: AdminUser


class AdminCreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    role_id: int
    team_name: str | None = None
    customer_access: list[str] = []


class AdminCreateUserResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: AdminUser
    redirect_to: str | None = None


class AdminUpdateRoleRequest(BaseModel):
    role_id: int
    team_name: str | None = None


class AdminUpdateRoleResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: AdminUser
    previous_role_ids: list[int]
    redirect_to: str | None = None


class AdminUpdateStatusRequest(BaseModel):
    is_active: bool


class AdminStatusUser(BaseModel):
    id: int
    is_active: bool


class AdminUpdateStatusResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: AdminStatusUser
    redirect_to: str | None = None


class AdminEditUserRequest(BaseModel):
    email: str | None = None
    customer_access: list[str] | None = None


class AdminEditUserResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: AdminUser
    redirect_to: str | None = None


class AdminPasswordUpdateRequest(BaseModel):
    new_password: str


class AdminPasswordUser(BaseModel):
    id: int


class AdminPasswordUpdateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    user: AdminPasswordUser
    password_updated: bool
    redirect_to: str | None = None


class AdminDeleteUser(BaseModel):
    user_id: int


class AdminDeleteUserResponse(BaseModel):
    status: Literal["ok"] = "ok"
    deleted: AdminDeleteUser
    redirect_to: str | None = None


class ProjectBootstrapResponse(BaseModel):
    status: Literal["ok"] = "ok"
    project: ProjectSummary
    chapters: list[ChapterSummary]
    ingested_files: list[FileRecord]
    redirect_to: str


class ProjectWorkflowUpdateRequest(BaseModel):
    workflow_name: str | None = None

class ProjectWorkflowUpdateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    project: ProjectSummary


class ProjectDeleteInfo(BaseModel):
    project_id: int
    code: str
    db_cleanup: bool
    filesystem_cleanup: bool


class ProjectDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    deleted: ProjectDeleteInfo
    redirect_to: str | None = None


class ChapterCreateRequest(BaseModel):
    number: str
    title: str


class ChapterCreateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    chapter: ChapterSummary
    redirect_to: str | None = None


class ChapterRenameRequest(BaseModel):
    number: str
    title: str


class ChapterRenameResponse(BaseModel):
    status: Literal["ok"] = "ok"
    chapter: ChapterSummary
    previous_number: str
    redirect_to: str | None = None


class ChapterDeleteInfo(BaseModel):
    project_id: int
    chapter_id: int
    chapter_number: str


class ChapterDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    deleted: ChapterDeleteInfo
    redirect_to: str | None = None


class FileDeleteInfo(BaseModel):
    file_id: int
    filename: str
    category: str
    project_id: int
    chapter_id: int | None = None


class FileDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    deleted: FileDeleteInfo
    redirect_to: str | None = None


class FileCheckoutResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file_id: int
    lock: LockState
    redirect_to: str | None = None


class UploadSkippedItem(BaseModel):
    filename: str
    code: str
    message: str


class UploadResultItem(BaseModel):
    file: FileRecord
    operation: Literal["created", "replaced"]
    archive_path: str | None = None
    archived_version_num: int | None = None


class FileUploadResponse(BaseModel):
    status: Literal["ok"] = "ok"
    uploaded: list[UploadResultItem]
    skipped: list[UploadSkippedItem]
    redirect_to: str | None = None


class GenerateFigurePdfResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file: FileRecord
    figures_included: int


class GenerateFigureAssessmentResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file: FileRecord
    figures_included: int


class VersionRecord(BaseModel):
    id: int
    file_id: int
    version_num: int
    archived_filename: str
    archived_path: str
    uploaded_at: datetime
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    uploaded_by_username: str | None = None


class FileVersionsFile(BaseModel):
    id: int
    filename: str
    current_version: int


class FileVersionsResponse(BaseModel):
    file: FileVersionsFile
    versions: list[VersionRecord]


class ProcessingStartRequest(BaseModel):
    process_type: str
    mode: str = "style"
    options: dict[str, Any] | None = None


class TagSetOption(BaseModel):
    key: str
    label: str


class TagSetListResponse(BaseModel):
    tag_sets: list[TagSetOption]


class ProcessingStartResponse(BaseModel):
    status: Literal["processing"] = "processing"
    message: str
    source_file_id: int
    process_type: str
    mode: str
    source_version: int
    lock: LockState
    status_endpoint: str | None = None
    job_id: int | None = None
    job_status_endpoint: str | None = None


class ProcessingStatusResponse(BaseModel):
    status: Literal["processing", "completed", "failed"]
    source_file_id: int
    process_type: str
    derived_file_id: int | None = None
    derived_filename: str | None = None
    error: str | None = None
    compatibility_status: str
    legacy_status_endpoint: str
    current_step: str | None = None
    progress_pct: int | None = None


class ProcessingJobResponse(BaseModel):
    id: int
    file_id: int
    process_type: str
    status: str
    current_step: str | None = None
    progress_pct: int
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None

    class Config:
        from_attributes = True


class ProcessingJobListItem(BaseModel):
    id: int
    file_id: int | None = None
    process_type: str
    status: str
    current_step: str | None = None
    progress_pct: int
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    filename: str | None = None
    project_code: str | None = None
    chapter_number: str | None = None
    priority: int
    options: dict | None = None
    username: str | None = None
    user_role: str | None = None

    class Config:
        from_attributes = True


class ProcessingJobPriorityUpdate(BaseModel):
    priority: int



class TechnicalIssue(BaseModel):
    key: str
    label: str
    category: str | None = None
    count: int
    found: list[str]
    options: list[str]


class TechnicalScanResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file: FileRecord
    issues: list[TechnicalIssue]
    raw_scan: dict[str, Any]
    onlyoffice_available: bool = False
    collabora_url: str | None = None
    findings: list[dict] | None = None
    inconsistencies: dict[str, Any] | None = None
    spelling_summary: dict[str, Any] | None = None
    ia_report: dict[str, Any] | None = None
    stats: dict[str, Any] | None = None
    active_stylesheet: "StylesheetSummary | None" = None
    # Rule-engine version of the scan (drafts of older versions are discarded by the page)
    engine_version: str | None = None
    # Where the active rules came from: "stylesheet.json" | "database" | None
    stylesheet_source: str | None = None


class TechnicalApplyRequest(BaseModel):
    replacements: dict[str, str] | None = None
    selected_findings: list[dict] | None = None
    highlight_findings: list[dict] | None = None


class TechnicalApplyResponse(BaseModel):
    status: Literal["completed"] = "completed"
    source_file_id: int
    new_file_id: int
    new_file: FileRecord


class StructuredBlock(BaseModel):
    index: int
    type: Literal["paragraph", "table", "footnote", "endnote"]
    style: str
    html: str
    ref_index: int | None = None


class StructuredContentResponse(BaseModel):
    status: Literal["ok"] = "ok"
    filename: str
    blocks: list[StructuredBlock]
    available_styles: list[str]


class StructuringProcessedFile(BaseModel):
    filename: str
    exists: Literal[True] = True


class StructuringReviewEditor(BaseModel):
    mode: Literal["structuring"] = "structuring"
    onlyoffice_available: bool = False
    collabora_url: str | None = None
    wopi_mode: Literal["structuring"] = "structuring"
    save_mode: Literal["wopi_autosave"] = "wopi_autosave"


class StructuringReviewActions(BaseModel):
    save_endpoint: str
    export_href: str
    return_href: str | None = None
    return_mode: Literal["route", "history"]


class StructuringReviewResponse(BaseModel):
    status: Literal["ok"] = "ok"
    viewer: Viewer
    file: FileRecord
    processed_file: StructuringProcessedFile
    editor: StructuringReviewEditor
    actions: StructuringReviewActions
    styles: list[str]
    char_styles: list[str] = []
    client_name: str | None = None
    tag_set: str | None = None


class StructuringSaveRequest(BaseModel):
    changes: dict[str, Any]


class StructuringSaveResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file_id: int
    saved_change_count: int
    target_filename: str


# ─── Editorial Stylesheets ────────────────────────────────────────────────────


class IARow(BaseModel):
    element: str
    subtype: str
    pattern: str


class IATemplateRow(BaseModel):
    element: str
    subtype: str
    pattern: str
    example: str | None = None
    ce_rule_no: int | None = None
    ce_option: int | None = None


class StylesheetSourceFile(BaseModel):
    id: int
    filename: str


class CERuleSetting(BaseModel):
    """One checklist rule's settings in a stylesheet; omitted fields inherit."""
    enabled: bool | None = None
    option: int | str | None = None
    severity: Literal["Critical", "Major", "Minor", "Informational"] | None = None
    custom_template: str | None = None


class StylesheetSummary(BaseModel):
    id: int
    project_id: int
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None
    created_by_id: int | None = None
    selected_ia_rows: list[IARow] = Field(default_factory=list)
    analyzed_file_ids: list[int] = Field(default_factory=list)
    source_files: list[StylesheetSourceFile] = Field(default_factory=list)
    ce_rules: dict[str, CERuleSetting] = Field(default_factory=dict)
    style_profile: dict[str, Any] = Field(default_factory=dict)


class StylesheetCreateRequest(BaseModel):
    name: str
    description: str | None = None
    selected_ia_rows: list[IARow] = Field(default_factory=list)
    analyzed_file_ids: list[int] = Field(default_factory=list)
    ce_rules: dict[str, CERuleSetting] = Field(default_factory=dict)
    style_profile: dict[str, Any] = Field(default_factory=dict)


class StylesheetCreateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    stylesheet: StylesheetSummary


class StylesheetUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    selected_ia_rows: list[IARow] | None = None
    analyzed_file_ids: list[int] | None = None
    ce_rules: dict[str, CERuleSetting] | None = None
    style_profile: dict[str, Any] | None = None


class StylesheetUpdateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    stylesheet: StylesheetSummary


# --- Import edits from the S4C Editorial Style Sheet (.docx) ---
class DocxImportCandidate(BaseModel):
    option: int
    label: str = ""
    preview: str = ""
    score: float | None = None


class DocxImportChange(BaseModel):
    id: str
    section: str                      # rules | words | orgs | abbr | settings
    kind: str                         # changed | enabled | disabled | unresolved | conflict | added | removed | edited
    target: str
    title: str
    before: str | None = None
    after: str | None = None
    detail: str = ""
    default_selected: bool = True
    sno: int | None = None
    option: int | str | None = None
    current: str | None = None
    docx_text: str | None = None
    candidates: list[DocxImportCandidate] = Field(default_factory=list)
    best_option: int | None = None


class DocxImportPreviewResponse(BaseModel):
    source: Literal["upload", "ce_support"]
    upload_token: str | None = None
    filename: str
    format: Literal["s4c", "customer"]
    stylesheet_id: int
    exported_from_id: int | None = None
    base_hash: str | None = None
    current_hash: str | None = None
    stale: bool = False
    snapshot: bool = False
    changes: list[DocxImportChange] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DocxImportApplyRequest(BaseModel):
    source: Literal["upload", "ce_support"]
    upload_token: str | None = None
    filename: str | None = None
    accepted: list[str] = Field(default_factory=list)
    resolutions: dict[str, int | str] = Field(default_factory=dict)


class DocxImportApplyResponse(BaseModel):
    status: Literal["ok"] = "ok"
    stylesheet: StylesheetSummary
    applied: list[str] = Field(default_factory=list)


class DocxImportPendingItem(BaseModel):
    stylesheet_id: int
    stylesheet_name: str
    filename: str
    modified: str
    change_count: int
    sha256: str


class DocxImportPendingResponse(BaseModel):
    items: list[DocxImportPendingItem] = Field(default_factory=list)


class DocxImportDismissRequest(BaseModel):
    filename: str


class StylesheetDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    deleted_id: int


class StylesheetActivateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    activated_id: int
    deactivated_ids: list[int]


class StylesheetsListResponse(BaseModel):
    project_id: int
    stylesheets: list[StylesheetSummary]
    active_stylesheet: StylesheetSummary | None = None


class IATemplateResponse(BaseModel):
    rows: list[IATemplateRow]


class CERule(BaseModel):
    """One rule of the CE checklist catalog (CE_rules_tool_input.xlsx)."""
    sno: int
    name: str
    group: str
    description: str = ""
    options: list[str]
    handling: str
    behaviour: str
    severity: str
    needs: str = ""
    notes: str = ""
    source_point: int | None = None
    detectable: Literal["auto", "flag", "manual"]
    # One entry per option, in the engine's option order: {"label", "preview"}
    forms: list[dict[str, str]] = Field(default_factory=list)
    # Rules 92+ (house-style points) are off until a stylesheet turns them on
    default_enabled: bool = True
    # Projected IA patterns detected by this rule: [{"element", "subtype", "pattern", "option"}]
    ia_patterns: list[dict[str, Any]] = Field(default_factory=list)


class CERulesResponse(BaseModel):
    rules: list[CERule]


# ─── Stylesheet Analysis ──────────────────────────────────────────────────────


class AnalyzeFilesRequest(BaseModel):
    file_ids: list[int]


class TriggeredIARule(BaseModel):
    element: str
    subtype: str
    pattern: str
    count: int
    example_surfaces: list[str] = Field(default_factory=list)
    ce_rule_no: int | None = None
    ce_option: int | None = None


class TriggeredCERuleOption(BaseModel):
    option: int
    label: str
    count: int
    examples: list[str] = Field(default_factory=list)


class TriggeredCERule(BaseModel):
    sno: int
    name: str
    group: str = ""
    dominant_option: int
    conflict: bool = False
    options: list[TriggeredCERuleOption] = Field(default_factory=list)


class AnalyzeFilesForStylesheetResponse(BaseModel):
    analyzed_files: list[dict]
    triggered_rules: list[TriggeredIARule]
    triggered_ce_rules: list[TriggeredCERule] = Field(default_factory=list)
    total_findings: int


# ─── Editorial Style Sheet (.docx) Parser ─────────────────────────────────────

class DocxMatchedRule(BaseModel):
    sno: int = 0
    rule_name: str = ""
    option: int | str = 1
    severity: str = "Major"
    enabled: bool = True
    confidence: float = 0.95
    source_label: str = ""
    source_value: str = ""
    explanation: str = ""
    notes: Optional[str] = ""


class DocxMatchedIARow(BaseModel):
    element: str
    subtype: str
    pattern: str
    confidence: float = 0.95
    source_label: str
    source_value: str


class DocxStylesheetParseResponse(BaseModel):
    metadata: dict[str, str] = Field(default_factory=dict)
    suggested_name: str
    suggested_description: str
    detected_preset_id: str
    matched_ce_rules: dict[str, DocxMatchedRule] = Field(default_factory=dict)
    matched_ia_rows: list[DocxMatchedIARow] = Field(default_factory=list)
    word_list: list[str] = Field(default_factory=list)
    total_specs_scanned: int = 0
    matched_rules_count: int = 0
    # "springer_sectioned" | "lww_3table"
    layout: str = "lww_3table"
    # Lists for list-driven rules (word list replacements, acronyms, registered terms, ...)
    style_profile: dict[str, Any] = Field(default_factory=dict)
    # Sheet rows that map to no rule (stored as reference only)
    unresolved_specs: list[dict[str, Any]] = Field(default_factory=list)


# ─── WYSIWYG Editor XHTML Save ────────────────────────────────────────────────

class XhtmlSaveRequest(BaseModel):
    html_content: str


# ─── Comments ─────────────────────────────────────────────────────────────────

class CommentRecord(BaseModel):
    comment_uuid: str
    text: str
    author_id: int | None
    author_name: str
    created_at: str
    updated_at: str
    resolved: bool


class CommentCreateRequest(BaseModel):
    # UUID generated by the editor; lets us round-trip the same id back into the
    # saved HTML span without negotiating an id with the server.
    comment_uuid: str
    text: str = ""


class CommentUpdateRequest(BaseModel):
    text: str | None = None
    resolved: bool | None = None


class CommentListResponse(BaseModel):
    comments: list[CommentRecord]


class ReferenceValidationReviewResponse(BaseModel):
    status: Literal["ok"] = "ok"
    viewer: Viewer
    file: FileRecord
    content: str
    filename: str
    styles: list[str]
    validation_logs: dict[str, Any]
    save_endpoint: str
    export_href: str
    return_href: str | None = None


class ReferenceValidateOnlyResponse(BaseModel):
    validation_logs: dict[str, Any]
    detected_style: str


class ReferenceSaveResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file_id: int
    target_filename: str


class ReferenceSearchHit(BaseModel):
    source: Literal["pubmed", "crossref"]
    title: str
    authors: str
    year: str
    journal: str
    volume: str
    issue: str
    page: str
    doi: str
    url: str
    formatted: str
    pubmed_id: str | None = None


class ReferenceSearchResponse(BaseModel):
    status: Literal["ok"] = "ok"
    db: Literal["pubmed", "crossref"]
    query: str
    results: list[ReferenceSearchHit]


class ReferenceEditRequest(BaseModel):
    new_text: str
    track_changes: bool = True


class ReferenceEditResponse(BaseModel):
    status: Literal["ok"] = "ok"
    file_id: int
    ref_number: int
    old_text: str
    new_text: str
    changed: bool


class ManualLinkEntry(BaseModel):
    bookmark_name: str
    ref_number: int | None = None
    ref_text: str
    citation_text: str | None = None
    linked_by: str | None = None
    linked_at: str | None = None


class ManualLinkListResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: int
    links: list[ManualLinkEntry]


class ManualLinkUpsertRequest(BaseModel):
    bookmark_name: str
    ref_number: int | None = None
    ref_text: str
    citation_text: str | None = None


class ManualLinkUpsertResponse(BaseModel):
    status: Literal["ok"] = "ok"
    link: ManualLinkEntry


class ManualLinkDeleteResponse(BaseModel):
    status: Literal["ok"] = "ok"
    bookmark_name: str
    deleted: bool


class ProjectUpdateRequest(BaseModel):
    status: str | None = None
    workflow_name: str | None = None
    client_id: int | None = None
    project_manager: str | None = None
    client_project_manager: str | None = None
    priority: str | None = None
    composition: str | None = None
    copyediting_level: str | None = None
    category: str | None = None
    edition: str | None = None
    color: str | None = None
    trim_size: str | None = None
    copyright_year: int | None = None
    estimated_pages: int | None = None
    actual_pages: int | None = None
    due_date: str | None = None
    division_code: str | None = None
    customer_contact: str | None = None
    sales_person: str | None = None
    isbn_no: str | None = None
    billing_location: str | None = None
    billing_type: str | None = None
    project_type: str | None = None
    alt_text: str | None = None
    accessibility: str | None = None
    reason: str | None = None
    skipped_stages: dict[str, list[str]] | None = None
    skipped_stages_history: list[dict[str, Any]] | None = None


class UploadZipChapterEntry(BaseModel):
    chapter_no: int | None = None
    file_name: str
    path: str


class UploadZipFileEntry(BaseModel):
    file_name: str
    path: str


class UploadZipResponse(BaseModel):
    zip_path: str
    extracted_path: str
    total_chapters: int
    chapters: list[UploadZipChapterEntry]
    images: list[UploadZipFileEntry]
    xml: list[UploadZipFileEntry]
    docs: list[UploadZipFileEntry]
    chapters_inserted: int


class FileMappingEntry(BaseModel):
    original_filename: str
    category: str
    chapter_number: str | None = None
    file_type: str

class PreviewZipResponse(BaseModel):
    session_id: str
    files: list[FileMappingEntry]

class FinalizeMappingRequest(BaseModel):
    session_id: str
    mappings: list[FileMappingEntry]

class FinalizeMappingResponse(BaseModel):
    message: str
    created_chapters: int



class ChapterZipSkippedItem(BaseModel):
    filename: str
    reason: str


class ChapterZipUploadResponse(BaseModel):
    created: list[ChapterInfoResponse]
    skipped: list[ChapterZipSkippedItem]


CustodyStatus = Literal["unassigned", "in_progress", "returned_for_review", "qa_approved", "transitioned"]


class WorkspaceItem(BaseModel):
    id: int
    client: str
    project: str
    chapters: str
    stage_name: str
    planned_start_date: datetime | None = None
    planned_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    stage_status: str
    delayed: bool
    delay_days: int | None = None
    remarks: str | None = None
    manuscript_pages: int | None = 0
    ce_pages: int | None = 0
    project_manager_name: str | None = "-"
    chapter_label: str | None = None            # "Chapter 01" for numbered chapters, otherwise the stored name
    client_name: str | None = None              # client company name (client holds the code, e.g. KLUPA02)
    project_manager_display: str | None = None  # PM first name (falls back to username)
    # Added for the workspace redesign (all optional so older clients keep working)
    assignee_name: str | None = None
    workflow: str | None = None
    next_stage: str | None = None
    custody_status: CustodyStatus = "unassigned"
    priority: str = "Normal"
    assigned_by: str | None = None
    assignment_notes: str | None = None
    handback_notes: str | None = None
    handback_at: datetime | None = None
    qa_approved_by: str | None = None
    qa_approved_at: datetime | None = None
    rework_notes: str | None = None
    rework_count: int = 0
    completion_delay_days: int | None = None  # set when completed: days finished after the planned end (0 = on time)
    live: bool = True                  # chapter is in this stage now; False = planned row for a later stage
    project_id: int | None = None      # Project.id / ChapterInfo.id: link to the chapter folder page
    chapter_id: int | None = None
    upcoming_from: str | None = None   # when not live: the stage the chapter is in now


class ChapterTaskPerson(BaseModel):
    username: str
    display_name: str
    open: int = 0
    pages: int = 0


class ChapterTaskResponse(BaseModel):
    """The chapter's task in the stage it is in now, for the workflow bar on the chapter page."""
    chapter_id: int
    stage_name: str | None = None
    item: WorkspaceItem | None = None     # None when the stage has no stages_details row yet
    can_manage: bool = False              # stage owner / lead / Admin: assign, review, move
    is_assignee: bool = False
    can_write: bool = False               # may change the chapter's files: assignee / stage owner or lead / Admin
    owner_name: str | None = None
    people: list[ChapterTaskPerson] = []  # who can be assigned in this stage (roles + Admin), lightest load first


class WorkspaceStats(BaseModel):
    today_assigned: int
    yesterday_assigned: int
    delayed_count: int
    completed_count: int
    kra_meet_rate: float


class UserWorkspaceData(BaseModel):
    stats: WorkspaceStats
    assignments: list[WorkspaceItem]


class TeamMemberWorkspaceData(BaseModel):
    username: str
    role: str | None = None
    email: str | None = None
    display_name: str | None = None
    open_count: int = 0
    open_pages: int = 0
    stats: WorkspaceStats
    assignments: list[WorkspaceItem]


class TeamLeadWorkspaceData(BaseModel):
    stats: WorkspaceStats
    members: list[TeamMemberWorkspaceData]


class StageMetric(BaseModel):
    stage_name: str
    active_count: int
    delayed_count: int
    today_assigned: int
    yesterday_assigned: int
    kra_meet_rate: float


class ManagerWorkspaceData(BaseModel):
    stats: WorkspaceStats
    stages: list[StageMetric]
    members: list[TeamMemberWorkspaceData]


class WorkspaceStageInfo(BaseModel):
    stage_name: str
    owner_username: str | None = None
    owner_name: str | None = None
    group_email: str | None = None
    sla_days: int | None = None
    can_manage: bool = False
    next_stage: str | None = None      # most common next stage across workflows (items carry their own)
    previous_stage: str | None = None


class WorkspacePerson(BaseModel):
    username: str
    display_name: str
    role: str | None = None
    stage_names: list[str] = []
    open_count: int = 0
    open_pages: int = 0
    completed_count: int = 0


class WorkspaceWorkflow(BaseModel):
    """A process (WorkflowMaster.workflow_name) with its stages in order, limited to the viewer's stages."""
    workflow_name: str
    stages: list[str]


class WorkspacePipeline(BaseModel):
    """Everything the stage-owner board, queue, schedule and team tabs need, scoped to the viewer."""
    stages: list[WorkspaceStageInfo]
    items: list[WorkspaceItem]          # open rows in scope + rows completed inside the completed window
    people: list[WorkspacePerson]
    completed_window_days: int
    workflows: list[WorkspaceWorkflow] = []


class WorkspaceDashboardResponse(BaseModel):
    role: str
    viewer: Viewer
    user_workspace: UserWorkspaceData | None = None
    teamlead_workspace: TeamLeadWorkspaceData | None = None
    manager_workspace: ManagerWorkspaceData | None = None
    pipeline: WorkspacePipeline | None = None
    generated_at: datetime | None = None


# ── Workspace task actions (custody lifecycle) ────────────────────────────────

class WorkspaceAssignRequest(BaseModel):
    assignee: str | None = None
    priority: Literal["Normal", "High", "Urgent"] | None = None
    planned_end_date: datetime | None = None
    notes: str | None = Field(default=None, max_length=2000)
    notify: bool = True
    expected_custody_status: CustodyStatus | None = None


class WorkspaceHandbackRequest(BaseModel):
    notes: str = Field(min_length=5, max_length=4000)
    checklist_confirmed: bool
    expected_custody_status: CustodyStatus | None = None


class WorkspaceReviewRequest(BaseModel):
    decision: Literal["approve", "rework"]
    notes: str | None = Field(default=None, max_length=4000)
    expected_custody_status: CustodyStatus | None = None


class WorkspaceMoveNextRequest(BaseModel):
    notify: bool = True
    expected_custody_status: CustodyStatus | None = None


class WorkspaceBulkRequest(BaseModel):
    action: Literal["assign", "approve", "move_next"]
    task_ids: list[int] = Field(min_length=1, max_length=500)
    assignee: str | None = None
    notify: bool = True


class WorkspaceBulkResultItem(BaseModel):
    task_id: int
    status: Literal["ok", "skipped", "conflict", "forbidden", "error"]
    message: str | None = None
    item: WorkspaceItem | None = None


class WorkspaceBulkResponse(BaseModel):
    results: list[WorkspaceBulkResultItem]


class WorkspaceActivityEvent(BaseModel):
    at: datetime | None = None
    actor: str | None = None
    kind: str               # custody | planning | other
    action: str | None = None
    text: str


class WorkspaceActivityResponse(BaseModel):
    task: WorkspaceItem
    events: list[WorkspaceActivityEvent]


class WorkspaceRecipient(BaseModel):
    username: str | None = None
    name: str | None = None
    email: str


class WorkspaceMoveNextPreview(BaseModel):
    task_id: int
    from_stage: str
    next_stage: str | None = None      # None = final stage, the chapter will be marked complete
    next_owner_username: str | None = None
    next_owner_name: str | None = None
    to: list[WorkspaceRecipient]
    cc: list[WorkspaceRecipient]
    subject: str
    late_days: int = 0                 # later planned dates shift by this many days


class WorkspaceScheduleResponse(BaseModel):
    stage_name: str
    date_from: datetime
    date_to: datetime
    items: list[WorkspaceItem]
    truncated: bool = False


class BulkDownloadFileItem(BaseModel):
    subfolder: str | None = None
    file_name: str


class BulkDownloadPayload(BaseModel):
    files: list[BulkDownloadFileItem]


class ProjectBulkDownloadRequest(BaseModel):
    chapter_ids: list[int]
    categories: list[str]


class ChapterFilesSummaryItem(BaseModel):
    chapter_id: int
    number: str
    title: str | None = None
    counts: dict[str, int]


class ProjectBulkFilesSummaryResponse(BaseModel):
    chapters: list[ChapterFilesSummaryItem]


class BulkTransitionItemPreview(BaseModel):
    chapter_id: int
    chapter_number: str
    chapter_num: str | None = None
    chapter_title: str | None = None
    current_stage: str
    next_stage: str | None = None
    workflow_name: str
    is_last_stage: bool = False
    next_stage_due_date: str | None = None

    def model_post_init(self, __context):
        if not self.chapter_num:
            self.chapter_num = self.chapter_number


class BulkTransitionConfigRequest(BaseModel):
    chapter_ids: list[int]


class BulkTransitionConfigResponse(BaseModel):
    has_config: bool = False
    has_email_config: bool = False
    chapters: list[BulkTransitionItemPreview] = Field(default_factory=list)
    preview_items: list[BulkTransitionItemPreview] = Field(default_factory=list)
    custom_message: str | None = None
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    subject: str | None = None
    body: str | None = None
    from_email: str | None = None
    next_stage_due_date: str | None = None

    def model_post_init(self, __context):
        if not self.preview_items and self.chapters:
            self.preview_items = self.chapters
        if not self.chapters and self.preview_items:
            self.chapters = self.preview_items
        if self.has_config and not self.has_email_config:
            self.has_email_config = self.has_config
        if self.has_email_config and not self.has_config:
            self.has_config = self.has_email_config


class BulkTransitionExecuteRequest(BaseModel):
    chapter_ids: list[int]
    stage_name: Optional[str] = None
    send_email: bool = False
    to_emails: list[str] = Field(default_factory=list)
    cc_emails: list[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""
    shipment_notes: Optional[str] = None
    email_to: Optional[str] = None
    email_cc: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None





