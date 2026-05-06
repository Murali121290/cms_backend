# API v2 Reference

Source of truth for this document:

- [app/routers/api_v2.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/api_v2.py)
- [app/schemas_v2.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/schemas_v2.py)
- supporting services in [app/services](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services)

This document lists the current `/api/v2` surface exactly as implemented. It does not describe planned endpoints, frontend-only abstractions, or WOPI callback routes as frontend APIs.

## Common Contracts

### Auth models

- `public`: no authentication required
- `cookie session`: requires the existing `access_token` cookie used by SSR routes
- `cookie or bearer`: accepts the SSR cookie or an `Authorization: Bearer <jwt>` header

### Common error payload

Most JSON error responses use `ErrorResponse`:

```json
{
  "status": "error",
  "code": "STRING_CODE",
  "message": "Human-readable message",
  "field_errors": null,
  "details": null
}
```

Notes:

- file download endpoints return `ErrorResponse` JSON on failure and binary `FileResponse` on success
- `GET /api/v2/session` never returns `ErrorResponse`; unauthenticated access is a `200` with `authenticated: false`
- read-side responses do not all include a top-level `status` field; that is current behavior

### Shared DTO fragments

- `Viewer`: `id`, `username`, `email`, `roles[]`, `is_active`
- `LockState`: `is_checked_out`, `checked_out_by_id`, `checked_out_by_username`, `checked_out_at`
- `ProjectSummary`: `id`, `code`, `title`, `client_name`, `xml_standard`, `status`, `team_id`, derived `chapter_count`, derived `file_count`
- `ChapterSummary`: `id`, `project_id`, `number`, `title`, derived category flags
- `FileRecord`: `id`, `project_id`, `chapter_id`, `filename`, `file_type`, `category`, `uploaded_at`, `version`, `lock`, `available_actions`

## Session

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/session/login` | Authenticate a browser user and set the SSR-compatible cookie | public | `SessionLoginRequest { username, password, redirect_to? }` | `SessionLoginResponse { status:"ok", session:SessionState, viewer:Viewer, redirect_to }` plus `Set-Cookie: access_token=Bearer <jwt>` | `401 INVALID_CREDENTIALS` | `auth_service.authenticate_browser_user`, `session_service.set_access_token_cookie` | `POST /login` | Cookie format matches current browser auth flow. The backend sets a Bearer-prefixed token; quotes may appear at the HTTP cookie serialization layer. |
| `GET` | `/api/v2/session` | Return current session state | cookie or bearer | none | `SessionGetResponse { authenticated, viewer?, auth:{ mode, expires_at } }` | none; unauthenticated is `200` with `authenticated:false` | route-local `_resolve_session` using JWT decode and user lookup | all cookie-based SSR routes | This is the only `/api/v2` endpoint that accepts bearer auth as well as the browser cookie. |
| `DELETE` | `/api/v2/session` | Clear the browser session cookie | public | none | `SessionDeleteResponse { status:"ok", redirect_to:"/login" }` plus cleared cookie header | none | `session_service.clear_access_token_cookie` | `GET /logout` | Preserves the current browser logout contract by returning a redirect hint and clearing the same cookie name. |

## Dashboard, Projects, Chapters, Files Read-Side

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/dashboard` | Dashboard viewer state, summary metrics, and project cards | cookie session | query `include_projects: bool = true` | `DashboardResponse { viewer, stats:DashboardStats, projects:ProjectSummary[] }` | `401 AUTH_REQUIRED` | `dashboard_service.get_dashboard_page_data` | `GET /dashboard` | `include_projects=false` suppresses the projects array but keeps stats. Stats remain the current derived dashboard numbers, not a normalized reporting model. |
| `GET` | `/api/v2/projects` | Paginated project summaries | cookie session | query `offset:int=0`, `limit:int=100` | `ProjectsListResponse { projects, pagination:{ offset, limit, total } }` | `401 AUTH_REQUIRED` | `project_read_service.get_projects_page_data` | `GET /projects` | Uses the current read-side project list and a separate total count query. |
| `GET` | `/api/v2/projects/{project_id}` | Project detail plus chapter summaries | cookie session | path `project_id` | `ProjectDetailResponse { project:ProjectDetail }` | `401 AUTH_REQUIRED`, `404 PROJECT_NOT_FOUND` | `project_read_service.get_project_chapters_page_data` | `GET /projects/{project_id}`, `GET /projects/{project_id}/chapters` | `ProjectDetail.chapters` is derived from current chapter rows and flags, not a separate cached projection. |
| `GET` | `/api/v2/projects/{project_id}/chapters` | Project summary plus chapter list | cookie session | path `project_id` | `ProjectChaptersResponse { project, chapters }` | `401 AUTH_REQUIRED`, `404 PROJECT_NOT_FOUND` | `project_read_service.get_project_chapters_page_data` | `GET /projects/{project_id}`, `GET /projects/{project_id}/chapters` | Mirrors the project chapters SSR page without HTML rendering. |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | Chapter detail state and tab selection | cookie session | path `project_id`, `chapter_id`; query `tab:str="Manuscript"` | `ChapterDetailResponse { project, chapter:ChapterDetail, active_tab, viewer }` | `401 AUTH_REQUIRED`, `404 CHAPTER_NOT_FOUND` | `project_read_service.get_chapter_detail_page_data` | `GET /projects/{project_id}/chapter/{chapter_id}` | `active_tab` is pass-through query state. Category counts are rebuilt from the current file rows. |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files` | File list for a chapter | cookie session | path `project_id`, `chapter_id` | `ChapterFilesResponse { project, chapter, files:FileRecord[], viewer }` | `401 AUTH_REQUIRED`, `404 CHAPTER_NOT_FOUND` | `project_read_service.get_chapter_detail_page_data` plus route-local file query | `GET /projects/{project_id}/chapter/{chapter_id}` | Returns all chapter files. There is no server-side category filter on this endpoint. `available_actions` preserves the current lock-derived action list. |

## Notifications and Activities

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/notifications` | Recent upload notification feed | cookie session | query `limit:int=5` | `NotificationsResponse { notifications:NotificationItem[], refreshed_at }` | `401 AUTH_REQUIRED` | route-local file query plus `notification_service._format_relative_time` | `GET /api/notifications` | Current feed items are upload-only with synthetic IDs of the form `file:{id}:upload`. |
| `GET` | `/api/v2/activities` | Activity feed and summary counts | cookie session | query `limit:int=50` | `ActivitiesResponse { summary:{ total, today }, activities:ActivityItem[] }` | `401 AUTH_REQUIRED` | `activity_service.get_recent_activities` | `GET /activities` | Activity IDs are synthetic `activity:{type}:{index}` values, not database primary keys. The feed still mixes upload and version events. |

## Admin

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/admin/dashboard` | Admin metrics summary | cookie session + Admin role | none | `AdminDashboardResponse { viewer, stats }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED` | `admin_user_service.get_admin_dashboard_stats` | `GET /admin` | Preserves the current admin-only guard used by the SSR dashboard. |
| `GET` | `/api/v2/admin/users` | Admin users list plus available roles | cookie session + Admin role | query `offset:int=0`, `limit:int=100` | `AdminUsersResponse { users:AdminUser[], roles:AdminRole[], pagination }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED` | `admin_user_service.get_admin_users_page_data` | `GET /admin/users` | Mirrors the admin users SSR page data. Pagination is route-local slicing over the current full list. |
| `GET` | `/api/v2/admin/roles` | Available roles for admin UI forms | cookie session + Admin role | none | `AdminRolesResponse { roles:AdminRole[] }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED` | `admin_user_service.get_available_roles` | `GET /admin/users`, `GET /admin/users/create` | Read-only helper endpoint for future admin forms. |
| `POST` | `/api/v2/admin/users` | Create a user and assign one role | cookie session + Admin role | `AdminCreateUserRequest { username, email, password, role_id }` | `AdminCreateUserResponse { status:"ok", user:AdminUser, redirect_to }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED`, `400 DUPLICATE_USER` | `admin_user_service.create_admin_user` | `POST /admin/users/create` | Preserves single-role assignment behavior used by the current SSR form. |
| `PUT` | `/api/v2/admin/users/{user_id}/role` | Replace the target user’s role set with one role | cookie session + Admin role | path `user_id`; `AdminUpdateRoleRequest { role_id }` | `AdminUpdateRoleResponse { status:"ok", user, previous_role_ids, redirect_to }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED`, `404 INVALID_USER_OR_ROLE`, `409 LAST_ADMIN_PROTECTED` | `admin_user_service.replace_user_role` | `POST /admin/users/{user_id}/role` | Preserves last-admin protection and the current replace-all role semantics. |
| `PUT` | `/api/v2/admin/users/{user_id}/status` | Set target user active/inactive state | cookie session + Admin role | path `user_id`; `AdminUpdateStatusRequest { is_active }` | `AdminUpdateStatusResponse { status:"ok", user:{ id, is_active }, redirect_to }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED`, `404 USER_NOT_FOUND`, `409 SELF_LOCKOUT_BLOCKED` | `admin_user_service.toggle_user_status` | `POST /admin/users/{user_id}/status` | Preserves self-lockout protection. The route only calls the service if the requested state differs from the current state. |
| `PATCH` | `/api/v2/admin/users/{user_id}` | Update user email | cookie session only | path `user_id`; `AdminEditUserRequest { email? }` | `AdminEditUserResponse { status:"ok", user, redirect_to }` | `401 AUTH_REQUIRED`, `404 USER_NOT_FOUND` | `admin_user_service.update_user_email` | `POST /admin/users/{user_id}/edit` | Intentionally preserves the current SSR auth gap: there is no admin-role check here. |
| `PUT` | `/api/v2/admin/users/{user_id}/password` | Change password using the current effective admin password handler | cookie session + Admin role | path `user_id`; `AdminPasswordUpdateRequest { new_password }` | `AdminPasswordUpdateResponse { status:"ok", user:{ id }, password_updated:true, redirect_to }` | `401 AUTH_REQUIRED`, `403 ADMIN_REQUIRED`, `404 USER_NOT_FOUND` | `admin_user_service.change_password_first_handler` | `POST /admin/users/{user_id}/password` | Preserves the currently effective first-registered handler semantics, including the current no-min-length behavior. |
| `DELETE` | `/api/v2/admin/users/{user_id}` | Delete a user | cookie session only | path `user_id` | `AdminDeleteUserResponse { status:"ok", deleted:{ user_id }, redirect_to }` | `401 AUTH_REQUIRED`, `404 USER_NOT_FOUND`, `409 SELF_DELETE_BLOCKED` | `admin_user_service.delete_user` | `POST /admin/users/{user_id}/delete` | Intentionally preserves the current SSR auth gap: there is no admin-role check here. Self-delete protection is preserved. |

## Project, Chapter, and File Mutations

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/projects/bootstrap` | Create a project with initial chapters, directories, and files | cookie session | `multipart/form-data`: `code`, `title`, `client_name?`, `xml_standard`, `chapter_count`, `files[]?` | `ProjectBootstrapResponse { status:"ok", project, chapters, ingested_files, redirect_to }` | `401 AUTH_REQUIRED`, `400 PROJECT_BOOTSTRAP_VALIDATION_ERROR` | `project_service.create_project_with_initial_files` | `POST /projects/create_with_files` | Preserves current bootstrap rules: chapter count must equal file count, duplicate derived stems are rejected, bootstrap is one-file-per-chapter, and folders are `Chapter <index> - <stem>`. |
| `DELETE` | `/api/v2/projects/{project_id}` | Delete project rows and project filesystem tree | cookie session | path `project_id` | `ProjectDeleteResponse { status:"ok", deleted:{ project_id, code, db_cleanup:true, filesystem_cleanup:true }, redirect_to }` | `401 AUTH_REQUIRED`, `404 PROJECT_NOT_FOUND` | `project_service.delete_project_with_filesystem` | `POST /projects/{project_id}/delete` | Preserves the SSR delete side effects, including filesystem cleanup. |
| `POST` | `/api/v2/projects/{project_id}/chapters` | Create one chapter | cookie session | path `project_id`; `ChapterCreateRequest { number, title }` | `ChapterCreateResponse { status:"ok", chapter, redirect_to }` | `401 AUTH_REQUIRED`, `404 PROJECT_NOT_FOUND` | `chapter_service.create_chapter` | `POST /projects/{project_id}/chapters/create` | Uses the current chapter service and current folder bootstrapping rules. |
| `PATCH` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | Rename a chapter and its folder when applicable | cookie session | path `project_id`, `chapter_id`; `ChapterRenameRequest { number, title }` | `ChapterRenameResponse { status:"ok", chapter, previous_number, redirect_to }` | `401 AUTH_REQUIRED`, `404 CHAPTER_OR_PROJECT_NOT_FOUND` | `chapter_service.rename_chapter` | `POST /projects/{project_id}/chapter/{chapter_id}/rename` | Preserves current folder rename behavior. |
| `DELETE` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | Delete a chapter using the primary delete path | cookie session | path `project_id`, `chapter_id` | `ChapterDeleteResponse { status:"ok", deleted:{ project_id, chapter_id, chapter_number }, redirect_to }` | `401 AUTH_REQUIRED`, `404 CHAPTER_OR_PROJECT_NOT_FOUND` | `chapter_service.delete_chapter_primary` | `POST /projects/{project_id}/chapter/{chapter_id}/delete` | The duplicate SSR chapter-delete handlers still exist in `web.py`. `/api/v2` intentionally exposes only the primary behavior. |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/package` | Download a ZIP of the chapter directory tree | cookie session | path `project_id`, `chapter_id` | binary ZIP file | `401 AUTH_REQUIRED`, `404 CHAPTER_OR_PROJECT_NOT_FOUND`, `404 CHAPTER_DIRECTORY_NOT_FOUND` | none; route-local ZIP packaging | `GET /projects/{project_id}/chapter/{chapter_id}/download` | This is a backend file-delivery contract, not a browser-rendered API response. |
| `GET` | `/api/v2/files/{file_id}/download` | Download the current file bytes | cookie session | path `file_id` | binary file response | `401 AUTH_REQUIRED`, `404 FILE_NOT_FOUND` | `file_service.get_file_for_download` | `GET /projects/files/{file_id}/download` | Returns `application/octet-stream` on success. |
| `DELETE` | `/api/v2/files/{file_id}` | Delete a file row and attempt disk deletion | cookie session | path `file_id` | `FileDeleteResponse { status:"ok", deleted:{ file_id, filename, category, project_id, chapter_id }, redirect_to }` | `401 AUTH_REQUIRED`, `404 FILE_NOT_FOUND` | `file_service.delete_file_and_capture_context` | `POST /projects/files/{file_id}/delete` | Preserves current redirect context and forgiving disk-delete behavior. |
| `POST` | `/api/v2/files/{file_id}/checkout` | Acquire file checkout lock | cookie session | path `file_id` | `FileCheckoutResponse { status:"ok", file_id, lock, redirect_to }` | `401 AUTH_REQUIRED`, `404 FILE_NOT_FOUND`, `409 LOCKED_BY_OTHER` with `details.checked_out_by_id` | `checkout_service.checkout_file` | `POST /projects/files/{file_id}/checkout` | Preserves same-user idempotence and foreign-lock rejection. |
| `DELETE` | `/api/v2/files/{file_id}/checkout` | Cancel checkout lock | cookie session | path `file_id` | `FileCheckoutResponse { status:"ok", file_id, lock, redirect_to }` | `401 AUTH_REQUIRED`, `404 FILE_NOT_FOUND` | `checkout_service.cancel_checkout` | `POST /projects/files/{file_id}/cancel_checkout` | Preserves current forgiving non-owner no-op behavior: the route still returns success even if no unlock occurred. |

## Upload and Versioning

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` | Upload or replace files in a chapter category | cookie session | `multipart/form-data`: path `project_id`, `chapter_id`; form `category`; file list `files[]` | `FileUploadResponse { status:"ok", uploaded:UploadResultItem[], skipped:UploadSkippedItem[], redirect_to }` | `401 AUTH_REQUIRED`, `404 PROJECT_OR_CHAPTER_NOT_FOUND` | `file_service.upload_chapter_files` | `POST /projects/{project_id}/chapter/{chapter_id}/upload` | Preserves current upload path placement, overwrite/archive/version behavior, partial-success skip behavior for foreign-locked files, and overwrite lock reset behavior. |
| `GET` | `/api/v2/files/{file_id}/versions` | Read version history for a file | cookie session | path `file_id`; query `limit:int=50` | `FileVersionsResponse { file:{ id, filename, current_version }, versions:VersionRecord[] }` | `401 AUTH_REQUIRED`, `404 FILE_NOT_FOUND` | `version_service.get_versions_for_file` | current chapter detail and file workflows implicitly depend on these rows, but there is no dedicated SSR version-history page | Stable frontend-only read model over current `FileVersion` rows. |
| `GET` | `/api/v2/files/{file_id}/versions/{version_id}/download` | Download an archived version file | cookie session | path `file_id`, `version_id` | binary archived file response | `401 AUTH_REQUIRED`, `404 VERSION_NOT_FOUND` | `version_service.get_version_for_download`, `version_service.get_archived_filename` | none | Returns the current archive filename convention from `version_service`. |

## Processing and Technical Review

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/files/{file_id}/processing-jobs` | Start a processing workflow and schedule the background task | cookie session | path `file_id`; `ProcessingStartRequest { process_type, mode="style", options? }` | `ProcessingStartResponse { status:"processing", message, source_file_id, process_type, mode, source_version, lock, status_endpoint? }` | `401 AUTH_REQUIRED`, `403 PERMISSION_DENIED`, `404 FILE_NOT_FOUND`, `400 FILE_LOCKED`, otherwise `PROCESSING_START_FAILED` | `processing_service.start_process` and `_api_v2_background_processing_task` | chapter detail page JS, `/api/v1/processing/files/{file_id}/process` compatibility flow | Preserves current backup/version side effects, file locking, and background task scheduling. `options` is accepted by the schema but not used by the route. |
| `GET` | `/api/v2/files/{file_id}/processing-status` | Poll current processing state | cookie session | path `file_id`; query `process_type="structuring"` | `ProcessingStatusResponse { status, source_file_id, process_type, derived_file_id?, derived_filename?, compatibility_status, legacy_status_endpoint }` | `401 AUTH_REQUIRED`, `400 STATUS_UNSUPPORTED`, `404 FILE_NOT_FOUND`, otherwise `PROCESSING_STATUS_FAILED` | `processing_service.get_structuring_status` | `/api/v1/processing/files/{file_id}/structuring_status` | Only `process_type=structuring` is currently supported. No durable job model exists yet. |
| `GET` | `/api/v2/files/{file_id}/technical-review` | Run the legacy technical scan and normalize the result | cookie session | path `file_id` | `TechnicalScanResponse { status:"ok", file, issues:TechnicalIssue[], raw_scan }` | `401 AUTH_REQUIRED`, `403 PERMISSION_DENIED`, `404 FILE_NOT_FOUND`, otherwise `TECHNICAL_SCAN_FAILED` | `processing_service.check_permission`, `technical_editor_service.scan_errors` | `GET /files/{file_id}/technical/edit` | Preserves the legacy scan dict in `raw_scan` while also exposing normalized `issues`. |
| `POST` | `/api/v2/files/{file_id}/technical-review/apply` | Apply technical replacements and create a derivative file | cookie session | path `file_id`; `TechnicalApplyRequest { replacements:{ [key]: replacement } }` | `TechnicalApplyResponse { status:"completed", source_file_id, new_file_id, new_file }` | `401 AUTH_REQUIRED`, `403 PERMISSION_DENIED`, `404 FILE_NOT_FOUND`, otherwise `TECHNICAL_APPLY_FAILED` | `processing_service.check_permission`, `technical_editor_service.apply_edits` | `GET /files/{file_id}/technical/edit` and current technical JS flow | Preserves `_TechEdited` derivative naming and new `File` row creation. |

## Structuring Review

| Method | Path | Purpose | Auth | Request schema | Response schema | Error behavior | Backing service(s) | Related SSR route(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/files/{file_id}/structuring-review` | Return structuring review metadata and shell support data | cookie session | path `file_id` | `StructuringReviewResponse { status:"ok", viewer, file, processed_file:{ filename, exists:true }, editor:{ mode:"structuring", collabora_url, wopi_mode:"structuring", save_mode:"wopi_autosave" }, actions:{ save_endpoint, export_href, return_href?, return_mode }, styles[] }` | `401 AUTH_REQUIRED`, `404 PROCESSED_FILE_MISSING`, `404 FILE_NOT_FOUND`, `500 STRUCTURING_REVIEW_FAILED` | `structuring_review_service.build_review_page_state` | `GET /api/v1/files/{file_id}/structuring/review` | Preserves current processed-file resolution and current Collabora/WOPI launch semantics. When the processed file is missing, `/api/v2` returns JSON while the SSR route still renders `error.html`. |
| `POST` | `/api/v2/files/{file_id}/structuring-review/save` | Explicitly save structuring changes into the processed document | cookie session | path `file_id`; `StructuringSaveRequest { changes:{ [node_id]: style_value } }` | `StructuringSaveResponse { status:"ok", file_id, saved_change_count, target_filename }` | `401 AUTH_REQUIRED`, `404 PROCESSED_FILE_MISSING`, `404 FILE_NOT_FOUND`, otherwise `STRUCTURING_SAVE_FAILED` | `structuring_review_service.resolve_processed_target`, `structuring_review_service.save_changes` | `POST /api/v1/files/{file_id}/structuring/save` | The current review shell still relies on WOPI autosave. This explicit save endpoint exists as a stable JSON companion contract. |
| `GET` | `/api/v2/files/{file_id}/structuring-review/export` | Download the processed structuring output | cookie session | path `file_id` | binary DOCX file response | `401 AUTH_REQUIRED`, `404 PROCESSED_FILE_MISSING`, `404 FILE_NOT_FOUND`, otherwise `STRUCTURING_EXPORT_FAILED` | `structuring_review_service.get_export_payload` | `GET /api/v1/files/{file_id}/structuring/review/export` | Preserves current processed-document export behavior exactly. |

## Frontend Readiness Snapshot

### Workflows that are fully frontend-ready on `/api/v2`

- session login, session check, session logout
- dashboard read-side
- project list, project detail, chapter list, chapter detail, file list
- notifications feed
- activities feed
- admin dashboard, admin users list, admin roles
- admin create user, role update, status update, email update, password update, delete
- project bootstrap
- project delete
- chapter create, rename, delete
- file delete and file download
- checkout and cancel checkout
- chapter upload
- version history read and archive download
- processing start
- processing status for structuring
- technical scan and technical apply

### Workflows that still depend on SSR shells

- original document editing still launches through `GET /files/{file_id}/edit`
- structuring review editing still launches through `GET /api/v1/files/{file_id}/structuring/review`
- technical review still has an SSR shell at `GET /files/{file_id}/technical/edit`, even though scan/apply APIs exist
- registration remains SSR-only; there is no `/api/v2` registration endpoint

### Workflows that remain backend-owned integrations

- all WOPI callback routes under `/wopi/files/*`
- Collabora launch URL construction and iframe hosting
- processing engine execution, output registration, and background task scheduling
- filesystem writes for uploads, archives, processed outputs, and WOPI saves
- ZIP and binary file delivery endpoints

### Areas that must not be frontend-owned yet

- WOPI callback handling and processed/original target-path resolution
- the SSR editor shells that wrap Collabora/WOPI
- background processing orchestration internals
- archive naming/path conventions and version-file storage behavior
- structuring review autosave semantics, which still rely on WOPI PutFile rather than a frontend-owned editor state model

## Compatibility Notes

- `/api/v2` is additive. Existing SSR routes remain operational.
- `/api/v1` compatibility routes remain operational and are not documented here as the primary frontend contract.
- Several `/api/v2` endpoints intentionally preserve current quirks from SSR behavior:
  - admin email edit does not require an admin role
  - admin delete does not require an admin role
  - admin password update preserves the first-registered handler behavior
  - cancel checkout preserves current owner-only unlock with a success-shaped no-op for non-owners
  - processing status supports only structuring
  - structuring review save exists as JSON, but the current shell still autosaves via WOPI
