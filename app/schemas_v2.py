from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


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
    roles: list[str]
    is_active: bool


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
    status: str
    chapter_count: int
    file_count: int
    workflow_name: str | None = None
    # WMS project fields
    division_code: str | None = None
    customer_contact: str | None = None
    category: str | None = None
    composition: str | None = None
    project_manager: str | None = None
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
    due_date: str | None = None
    file_details: dict | None = None
    created_at: str | None = None
    updated_at: str | None = None


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
    is_active: bool
    roles: list[AdminUserRole]
    team: str | None = None
    customer_access: list[str] = []


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
    role: str
    team: str
    customer_access: list[str] = []
    active_status: bool | None = True


class UserUpdate(BaseModel):
    role: str | None = None
    team: str | None = None
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


class VersionRecord(BaseModel):
    id: int
    file_id: int
    version_num: int
    archived_filename: str
    archived_path: str
    uploaded_at: datetime
    uploaded_by_id: int | None = None


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


class ProcessingStartResponse(BaseModel):
    status: Literal["processing"] = "processing"
    message: str
    source_file_id: int
    process_type: str
    mode: str
    source_version: int
    lock: LockState
    status_endpoint: str | None = None


class ProcessingStatusResponse(BaseModel):
    status: Literal["processing", "completed"]
    source_file_id: int
    process_type: str
    derived_file_id: int | None = None
    derived_filename: str | None = None
    compatibility_status: str
    legacy_status_endpoint: str


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


class StylesheetSummary(BaseModel):
    id: int
    project_id: int
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime
    created_by_id: int | None = None
    selected_ia_rows: list[IARow] = Field(default_factory=list)
    analyzed_file_ids: list[int] = Field(default_factory=list)


class StylesheetCreateRequest(BaseModel):
    name: str
    description: str | None = None
    selected_ia_rows: list[IARow] = Field(default_factory=list)
    analyzed_file_ids: list[int] = Field(default_factory=list)


class StylesheetCreateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    stylesheet: StylesheetSummary


class StylesheetUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    selected_ia_rows: list[IARow] | None = None
    analyzed_file_ids: list[int] | None = None


class StylesheetUpdateResponse(BaseModel):
    status: Literal["ok"] = "ok"
    stylesheet: StylesheetSummary


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


# ─── Stylesheet Analysis ──────────────────────────────────────────────────────


class AnalyzeFilesRequest(BaseModel):
    file_ids: list[int]


class TriggeredIARule(BaseModel):
    element: str
    subtype: str
    pattern: str
    count: int
    example_surfaces: list[str] = Field(default_factory=list)


class AnalyzeFilesForStylesheetResponse(BaseModel):
    analyzed_files: list[dict]
    triggered_rules: list[TriggeredIARule]
    total_findings: int


# ─── WYSIWYG Editor XHTML Save ────────────────────────────────────────────────

class XhtmlSaveRequest(BaseModel):
    html_content: str


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


class ProjectUpdateRequest(BaseModel):
    status: str | None = None
    workflow_name: str | None = None
    client_id: int | None = None
    project_manager: str | None = None
    priority: str | None = None
    composition: str | None = None
    category: str | None = None
    edition: str | None = None
    color: str | None = None
    trim_size: str | None = None
    copyright_year: int | None = None
    actual_pages: int | None = None
    due_date: str | None = None
    division_code: str | None = None
    customer_contact: str | None = None
    sales_person: str | None = None
    isbn_no: str | None = None
    billing_location: str | None = None


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


