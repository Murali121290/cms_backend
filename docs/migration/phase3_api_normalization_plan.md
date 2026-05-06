# Phase 3 API Normalization Plan

Static analysis only. This document defines the stable API contracts required for frontend modernization while preserving backward compatibility with the current SSR pages, redirects, templates, and integration behavior.

Reference documents:
- [phase0_repository_inventory.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration_plan/phase0_repository_inventory.md)
- [phase1_contract_map.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase1_contract_map.md)
- [phase2_service_extraction_plan.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase2_service_extraction_plan.md)

Normalization rules for this phase:
- Current routes remain active until parity is proven.
- New stable contracts should be introduced under `/api/v2` to avoid breaking `/api/v1` callers and SSR templates.
- SSR form-post routes remain valid compatibility endpoints until their corresponding stable JSON contracts are live and fully adopted.
- WOPI callback routes remain backend-owned integration endpoints and are not replaced by frontend-facing APIs.
- Stable contracts should preserve current business semantics before improving shape or naming.

## 1. Existing Endpoint Assessment

Assessment columns:
- `Schema quality`: `high`, `medium`, `low`, or `very low`.
- `Reusable as-is`: whether the endpoint can be consumed directly by a modern frontend without a compatibility wrapper.
- `Needs normalization`: whether a stable frontend-facing contract should be introduced for this capability.
- `Compatibility-only`: whether the current endpoint should remain only as a temporary bridge.

### Auth and session endpoints

| Route path | HTTP method(s) | Current purpose | Current request shape | Current response shape | Schema quality | Inconsistencies | Reusable as-is | Needs normalization | Compatibility-only |
|---|---|---|---|---|---|---|---|---|---|
| `/login` | POST | browser login | form `username`, `password` | `302` to `/dashboard` + `access_token` cookie or SSR error template | low | not JSON; cookie format is implicit; no session payload; no structured field errors | No | Yes | Yes |
| `/logout` | GET | browser logout | none | `302` to `/login` + cookie deletion | medium | no JSON session termination contract | Partial for SSR only | Yes | Yes |
| `/register` | POST | self-registration through SSR | form `username`, `email`, `password`, `confirm_password` | `302` to login or SSR error template | low | first-user admin bootstrap hidden; no structured validation output | No | Yes | Yes |
| `/api/v1/users/` | POST | API user creation | JSON `UserCreate { username, email, password }` | `{ id, username }` | low | no response model; does not assign roles like SSR registration; no auth guard | Partial | Yes | Yes |
| `/api/v1/users/login` | POST | bearer-token login | OAuth2 form `username`, `password` | `{ access_token, token_type }` | medium | no expiry/user payload; separate from browser session | Yes for external/API clients | Yes | No |
| `/api/v1/users/me` | GET | current bearer identity | bearer token | `{ username, email, roles[] }` | medium | flat payload only; no session/auth metadata; browser session not covered | Partial | Yes | No |

### Project, chapter, file, and feed endpoints

| Route path | HTTP method(s) | Current purpose | Current request shape | Current response shape | Schema quality | Inconsistencies | Reusable as-is | Needs normalization | Compatibility-only |
|---|---|---|---|---|---|---|---|---|---|
| `/projects/create_with_files` | POST | create project, chapters, and optional initial files | multipart form `code`, `title`, `client_name?`, `xml_standard`, `chapter_count`, `files[]?` | `302` to `/dashboard` | very low | no schema; hardcoded `team_id=1`; rich side effects hidden behind redirect | No | Yes | Yes |
| `/api/v1/projects/` | POST | thin project create | JSON `ProjectCreate { team_id, code, title, xml_standard }` | ORM project JSON | low | missing `client_name`; not equivalent to SSR create-with-files | Partial | Yes | No |
| `/api/v1/projects/` | GET | list projects | query `skip`, `limit` | ORM project array | medium | no response envelope/pagination metadata; no derived counts | Partial | Yes | No |
| `/api/v1/projects/{project_id}/status` | PUT | update project status | path `project_id`, query/string `status` | ORM project JSON | low | status is not a body schema; no enum; no envelope | No | Yes | No |
| `/api/v1/projects/{project_id}` | DELETE | API delete project rows | path `project_id` | `{ "message": "Project deleted successfully" }` | low | DB cleanup only; does not remove filesystem tree like SSR delete | No | Yes | No |
| `/projects/{project_id}/chapters/create` | POST | create chapter | form `number`, `title` | `302` to project page | low | no JSON contract; creates folders after DB commit | No | Yes | Yes |
| `/projects/{project_id}/chapter/{chapter_id}/rename` | POST | rename chapter | form `number`, `title` | `302` to project page | low | storage rename hidden; no explicit prior/current values | No | Yes | Yes |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | POST | delete chapter | path only | `302` to project page | low | route defined twice; deletes storage and DB | No | Yes | Yes |
| `/projects/{project_id}/chapter/{chapter_id}/download` | GET | download chapter package | path only | ZIP file | medium | no metadata endpoint; temp file lifecycle hidden | Yes for browser download | No for file delivery | No |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | POST | bulk upload into chapter/category with overwrite/version behavior | multipart form `category`, `files[]` | `302` to chapter tab | very low | partial success hidden; lock skip hidden; version/archive semantics implicit | No | Yes | Yes |
| `/api/v1/files/` | POST | thin upload endpoint | multipart `project_id`, `file` | `{ file_id, path }` | low | no chapter/category/version fields; writes to flat upload root | No | Yes | No |
| `/projects/files/{file_id}/download` | GET | download file bytes | path only | file bytes | medium | no JSON metadata route; media type generic | Yes for browser download | No for file delivery | No |
| `/projects/files/{file_id}/delete` | POST | delete file | path only | `302` to originating chapter tab | low | deletes disk + DB; no structured result; swallows disk delete errors | No | Yes | Yes |
| `/projects/{project_id}/delete` | POST | SSR project delete | path only | `302` to `/dashboard?msg=Book+Deleted` | low | removes filesystem + DB, unlike API delete | No | Yes | Yes |
| `/projects/files/{file_id}/checkout` | POST | acquire file lock | path only | `302` to chapter tab | low | idempotence and conflict behavior only encoded in redirect messages | No | Yes | Yes |
| `/projects/files/{file_id}/cancel_checkout` | POST | release file lock | path only | `302` to chapter tab | low | silent no-op when caller is not owner | No | Yes | Yes |
| `/api/notifications` | GET | navbar notification feed | none | array of `{ title, desc, time, icon, color }` | low | no IDs, entity links, types, or pagination | Partial | Yes | No |
| `/activities` | GET | SSR activity page data source | implicit cookie session only | HTML page using route-assembled activity items | low | read model is route-owned, not API-backed | No | Yes | Yes |

### Processing, technical editor, and structuring endpoints

| Route path | HTTP method(s) | Current purpose | Current request shape | Current response shape | Schema quality | Inconsistencies | Reusable as-is | Needs normalization | Compatibility-only |
|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/processing/files/{file_id}/process/{process_type}` | POST | start processing job | path `file_id`, `process_type`; query `mode`; optional JSON body ignored | `{ message, status:"processing" }` | very low | no job ID; process options implicit; pre-response side effects hidden | No | Yes | No |
| `/api/v1/processing/files/{file_id}/structuring_status` | GET | poll structuring completion | path `file_id` | `{ status:"processing" }` or `{ status:"completed", new_file_id }` | very low | no failure state; no generic job model; completion inferred by filename convention | No | Yes | Yes |
| `/api/v1/processing/files/{file_id}/technical/scan` | GET | scan document for technical issues | path `file_id` | dynamic dict keyed by issue IDs | low | no schema model; dynamic keys; no envelope | Partial | Yes | No |
| `/api/v1/processing/files/{file_id}/technical/apply` | POST | apply technical replacements | path `file_id`, JSON dict of replacements | `{ status:"completed", new_file_id }` | low | no request schema; no output metadata except ID | Partial | Yes | No |
| `/api/v1/files/{file_id}/structuring/review` | GET | review processed file | path `file_id` | SSR HTML shell or `error.html` | low | page-state contract implicit; processed file resolution hidden | No as API | Yes | Yes |
| `/api/v1/files/{file_id}/structuring/save` | POST | explicit structuring save | path `file_id`, JSON body with nested `changes` map | `{ status:"success" }` | low | latent endpoint; request shape implicit; no save metadata | Partial | Yes | No |
| `/api/v1/files/{file_id}/structuring/review/export` | GET | export processed docx | path `file_id` | DOCX file | medium | no metadata companion; depends on processed file naming | Yes for browser download | No for file delivery | No |
| `/files/{file_id}/technical/edit` | GET | render technical editor shell | path `file_id` | SSR HTML shell | low | shell contract implicit; depends on scan/apply APIs | No as API | Yes | Yes |

### Admin and support endpoints

| Route path | HTTP method(s) | Current purpose | Current request shape | Current response shape | Schema quality | Inconsistencies | Reusable as-is | Needs normalization | Compatibility-only |
|---|---|---|---|---|---|---|---|---|---|
| `/admin/users/create` | POST | admin create user | form `username`, `email`, `password`, `role_id` | `302` or SSR error | low | no JSON contract; no structured errors | No | Yes | Yes |
| `/admin/users/{user_id}/role` | POST | replace user role | path `user_id`, form `role_id` | `302` or SSR error page | low | replace-all semantics implicit; last-admin protection only in SSR branch | No | Yes | Yes |
| `/admin/users/{user_id}/status` | POST | toggle active status | path `user_id` | `302` | low | no response body; hidden self-lockout rule | No | Yes | Yes |
| `/admin/users/{user_id}/edit` | POST | update user email | path `user_id`, form data | `302` | low | no explicit schema; only email handled | No | Yes | Yes |
| `/admin/users/{user_id}/password` | POST | change user password | path `user_id`, form `new_password` | `302` or SSR error | low | duplicate route definitions with different validation behavior | No | Yes | Yes |
| `/admin/users/{user_id}/delete` | POST | delete user | path `user_id` | `302` | low | duplicate route definitions; self-delete protection via redirect only | No | Yes | Yes |
| `/api/v1/teams/` | POST | create team | JSON `TeamCreate { name, description? }` | response model claims `TeamCreate` | very low | service writes nonexistent model fields `description` and `owner_id` | No | Yes | Yes |
| `/api/v1/teams/` | GET | list teams | query `skip`, `limit` | ORM team array | low | no envelope/pagination; current UI does not use it | Partial | Yes | Yes |
| `/` | GET | API root message | none | `{ message }` | medium | conflicts with SSR root owner | No | Yes | Yes |

### WOPI and editor integration endpoints

| Route path | HTTP method(s) | Current purpose | Current request shape | Current response shape | Schema quality | Inconsistencies | Reusable as-is | Needs normalization | Compatibility-only |
|---|---|---|---|---|---|---|---|---|---|
| `/files/{file_id}/edit` | GET | editor launch shell | path `file_id` | SSR HTML shell | low | launch metadata only exists inside template context | No as API | Yes | Yes |
| `/wopi/files/{file_id}` | GET | WOPI CheckFileInfo for original file | path `file_id` | WOPI JSON object | medium | no application auth; hardcoded `UserId/UserFriendlyName`; `SupportsLocks=False` | Yes for integration only | No for frontend API | Yes |
| `/wopi/files/{file_id}/contents` | GET | WOPI GetFile original | path `file_id` | DOCX bytes | medium | duplicated file lookup; integration only | Yes for integration only | No for frontend API | Yes |
| `/wopi/files/{file_id}/contents` | POST | WOPI PutFile original | path `file_id`, raw request body | HTTP `200` | medium | direct disk write; no auth; no lock enforcement | Yes for integration only | No for frontend API | Yes |
| `/wopi/files/{file_id}/structuring` | GET | WOPI CheckFileInfo for processed file | path `file_id` | WOPI JSON object | medium | processed-target resolution hidden; no frontend-facing metadata route | Yes for integration only | No for frontend API | Yes |
| `/wopi/files/{file_id}/structuring/contents` | GET | WOPI GetFile processed | path `file_id` | DOCX bytes | medium | integration only | Yes for integration only | No for frontend API | Yes |
| `/wopi/files/{file_id}/structuring/contents` | POST | WOPI PutFile processed | path `file_id`, raw request body | HTTP `200` | medium | direct processed-file disk write; no auth; integration only | Yes for integration only | No for frontend API | Yes |

## 2. Proposed Stable API Surface

Stable API namespace:
- Introduce new frontend-facing contracts under `/api/v2`.
- Keep `/api/v1`, SSR form-post routes, and WOPI callbacks as compatibility routes until explicit cutover conditions are met.

### Common schema fragments

| Schema name | Stable shape |
|---|---|
| `ErrorResponse` | `{ status:"error", code:str, message:str, field_errors?:{ [field:str]:str }, details?:object }` |
| `Viewer` | `{ id:int, username:str, email:str, roles:[str], is_active:bool }` |
| `ProjectSummary` | `{ id:int, code:str, title:str, client_name?:str, xml_standard:str, status:str, team_id:int, chapter_count:int, file_count:int }` |
| `ProjectDetail` | `ProjectSummary` plus `{ chapters:[ChapterSummary] }` |
| `ChapterSummary` | `{ id:int, project_id:int, number:str, title:str, has_art:bool, has_manuscript:bool, has_indesign:bool, has_proof:bool, has_xml:bool }` |
| `ChapterDetail` | `ChapterSummary` plus `{ category_counts:{ Art:int, Manuscript:int, InDesign:int, Proof:int, XML:int, Miscellaneous:int }, files:[FileRecord] }` |
| `FileRecord` | `{ id:int, project_id:int, chapter_id:int, filename:str, file_type:str, category:str, uploaded_at:str, version:int, lock:LockState, available_actions:[str] }` |
| `VersionRecord` | `{ id:int, file_id:int, version_num:int, archived_filename:str, archived_path:str, uploaded_at:str, uploaded_by_id?:int }` |
| `LockState` | `{ is_checked_out:bool, checked_out_by_id?:int, checked_out_by_username?:str, checked_out_at?:str }` |
| `NotificationItem` | `{ id:str, type:"file_upload"|"processing_complete"|"processing_failed", title:str, description:str, relative_time:str, icon:str, color:str, file_id?:int, project_id?:int, chapter_id?:int }` |
| `ActivityItem` | `{ id:str, type:"upload"|"version"|"processing", title:str, description:str, project:{ id?:int, title:str }, chapter:{ id?:int, title:str }, category:str, timestamp:str, relative_time:str, icon:str, color:str }` |
| `ProcessJob` | `{ job_id:str, file_id:int, process_type:str, mode?:str, status:"queued"|"running"|"succeeded"|"failed"|"cancelled", created_at:str, started_at?:str, completed_at?:str, source_version:int, result_files:[FileRecord], error?:{ code:str, message:str } }` |
| `TechnicalIssue` | `{ key:str, label:str, category:str, count:int, found:[str], options:[str] }` |
| `AdminUser` | `{ id:int, username:str, email:str, is_active:bool, roles:[{ id:int, name:str }] }` |

### Auth and session

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/session/login` | canonical frontend login | `{ username:str, password:str, redirect_to?:str }` | `{ status:"ok", session:{ authenticated:true, auth_mode:"cookie", expires_at?:str }, viewer:Viewer, redirect_to:str }` | `ErrorResponse` with `INVALID_CREDENTIALS` | none | wraps `POST /login`; must preserve cookie session semantics | `login.html`, navbar/logout flow, all SSR cookie-auth pages |
| `GET` | `/api/v2/session` | session check / bootstrap current viewer | none | `{ authenticated:bool, viewer?:Viewer, auth:{ mode:"cookie"|"bearer", expires_at?:str } }` | `ErrorResponse` | session cookie or bearer token | supplements `GET /api/v1/users/me`; does not replace it immediately | all future frontend routes; current SSR per-route cookie checks |
| `DELETE` | `/api/v2/session` | canonical logout | none | `{ status:"ok", redirect_to:"/login" }` | `ErrorResponse` | session cookie | wraps `GET /logout`; keep logout link behavior compatible | navbar logout, SSR session end |
| `POST` | `/api/v2/registration` | canonical self-registration if self-signup remains enabled | `{ username:str, email:str, password:str, confirm_password:str }` | `{ status:"ok", user:{ id:int, username:str, email:str }, assigned_role:str, redirect_to:"/login" }` | `ErrorResponse` with `PASSWORD_MISMATCH`, `DUPLICATE_USER` | none | wraps `POST /register`; must preserve first-user admin bootstrap | `register.html` workflow |

### Dashboard

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/dashboard` | dashboard page-state data | query `include_projects?:bool=true` | `{ viewer:Viewer, stats:{ total_projects:int, on_time_rate:int, on_time_trend:str, avg_days:float, avg_days_trend:str, delayed_count:int, delayed_trend:str }, projects:[ProjectSummary] }` | `ErrorResponse` | session cookie | wraps current `/dashboard` route data; placeholder stats remain stable until backend logic changes intentionally | `dashboard.html` |

### Projects

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/projects` | list projects for dashboard/projects page | query `{ offset?:int=0, limit?:int=100 }` | `{ projects:[ProjectSummary], pagination:{ offset:int, limit:int, total:int } }` | `ErrorResponse` | session cookie | stable replacement for `GET /api/v1/projects/`; keep existing v1 for bearer clients | `dashboard.html`, `projects.html`, `/projects`, `/dashboard` |
| `POST` | `/api/v2/projects` | create bare project record only | `{ team_id:int, code:str, title:str, client_name?:str, xml_standard:str }` | `{ status:"ok", project:ProjectSummary }` | `ErrorResponse` with `DUPLICATE_PROJECT_CODE`, `VALIDATION_ERROR` | session cookie or bearer with `ProjectManager` | preserves thin-create capability of `POST /api/v1/projects/` | API create clients, future admin/project forms |
| `POST` | `/api/v2/projects/bootstrap` | create project with initial chapters and optional initial files | multipart `{ code, title, client_name?, xml_standard, chapter_count:int, files[]? }` | `{ status:"ok", project:ProjectSummary, chapters:[ChapterSummary], ingested_files:[FileRecord], redirect_to:"/dashboard" }` | `ErrorResponse` | session cookie | stable API equivalent of `POST /projects/create_with_files`; keep SSR route until parity | `project_create.html`, project creation workflow |
| `GET` | `/api/v2/projects/{project_id}` | project detail | path `project_id` | `{ project:ProjectDetail }` | `ErrorResponse` with `PROJECT_NOT_FOUND` | session cookie | replaces mixed SSR-only data assembly for `/projects/{project_id}` | `project_chapters.html`, project detail navigation |
| `PATCH` | `/api/v2/projects/{project_id}/status` | update workflow status | `{ status:"RECEIVED"|"PROCESSING"|"XML_GENERATED"|"PUBLISHED"|str }` | `{ status:"ok", project:ProjectSummary }` | `ErrorResponse` | session cookie or bearer with `ProjectManager` | normalize current `PUT /api/v1/projects/{project_id}/status` query-param contract | project workflow state management |
| `DELETE` | `/api/v2/projects/{project_id}` | canonical project delete | none | `{ status:"ok", deleted:{ project_id:int, code:str, db_cleanup:true, filesystem_cleanup:true }, redirect_to?:"/dashboard" }` | `ErrorResponse` with `PROJECT_NOT_FOUND` | session cookie | must preserve SSR delete side effects before deprecating `POST /projects/{project_id}/delete` | `projects.html` delete button, dashboard/project management |

### Chapters

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/projects/{project_id}/chapters` | list chapters with derived folder flags | none | `{ project:ProjectSummary, chapters:[ChapterSummary] }` | `ErrorResponse` | session cookie | stable replacement for SSR-derived chapter list | `project_chapters.html`, `/projects/{project_id}`, `/projects/{project_id}/chapters` |
| `POST` | `/api/v2/projects/{project_id}/chapters` | create chapter | `{ number:str, title:str }` | `{ status:"ok", chapter:ChapterSummary, redirect_to?:str }` | `ErrorResponse` with `PROJECT_NOT_FOUND`, `DUPLICATE_CHAPTER` | session cookie | wraps `POST /projects/{project_id}/chapters/create` | chapter create modal in `project_chapters.html` |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | chapter detail page-state | query `{ tab?:str }` | `{ project:ProjectSummary, chapter:ChapterDetail, active_tab:str, viewer:Viewer }` | `ErrorResponse` with `CHAPTER_NOT_FOUND` | session cookie | stable replacement for SSR data behind `/projects/{project_id}/chapter/{chapter_id}` | `chapter_detail.html` |
| `PATCH` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | rename chapter | `{ number:str, title:str }` | `{ status:"ok", chapter:ChapterSummary, previous_number:str, redirect_to?:str }` | `ErrorResponse` | session cookie | wraps `POST /projects/{project_id}/chapter/{chapter_id}/rename` | rename modal in `project_chapters.html` |
| `DELETE` | `/api/v2/projects/{project_id}/chapters/{chapter_id}` | canonical chapter delete | none | `{ status:"ok", deleted:{ project_id:int, chapter_id:int, chapter_number:str }, redirect_to?:str }` | `ErrorResponse` | session cookie | must preserve folder deletion + redirect semantics of both duplicate POST routes | chapter delete actions |
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/package` | chapter ZIP download | none | ZIP file response | `ErrorResponse` | session cookie | stable download contract paired with current browser download route | chapter package download |

### Files

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files` | list chapter files grouped by category | query `{ include_versions?:bool=false }` | `{ project:ProjectSummary, chapter:{ id:int, number:str, title:str }, files:[FileRecord] }` | `ErrorResponse` | session cookie | replaces route-owned file lists used in `chapter_detail.html` | chapter detail view |
| `POST` | `/api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` | canonical bulk upload | multipart `{ category:str, files[] }` | `{ status:"ok", uploaded:[FileRecord], skipped:[{ filename:str, code:str, message:str }], redirect_to?:str }` | `ErrorResponse` with per-file details | session cookie | wraps `POST /projects/{project_id}/chapter/{chapter_id}/upload`; must preserve archive/version side effects | upload modal, check-in modal, chapter upload workflow |
| `GET` | `/api/v2/files/{file_id}` | file detail | none | `{ file:FileRecord, project:ProjectSummary, chapter?:{ id:int, number:str, title:str } }` | `ErrorResponse` | session cookie | stable lookup for editor shells and file action menus | chapter detail, technical editor, editor launch |
| `GET` | `/api/v2/files/{file_id}/download` | file download | none | file response | `ErrorResponse` | session cookie | browser-friendly stable alias for current `/projects/files/{file_id}/download` | chapter detail downloads |
| `DELETE` | `/api/v2/files/{file_id}` | canonical file delete | none | `{ status:"ok", deleted:{ file_id:int, filename:str, category:str, project_id:int, chapter_id:int }, redirect_to?:str }` | `ErrorResponse` | session cookie | must preserve disk delete + redirect context of current POST delete route | chapter detail delete |

### Version history

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/files/{file_id}/versions` | list archived versions | query `{ limit?:int=50 }` | `{ file:{ id:int, filename:str, current_version:int }, versions:[VersionRecord] }` | `ErrorResponse` | session cookie | new stable contract; current SSR pages infer version history only indirectly | upload/versioning workflow, future file history UI |
| `GET` | `/api/v2/files/{file_id}/versions/{version_id}/download` | download archived version | none | file response | `ErrorResponse` | session cookie | new stable contract; current archive files are only on disk | version history UI |

### Checkout and check-in

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/files/{file_id}/checkout` | acquire lock | none | `{ status:"ok", file_id:int, lock:LockState, redirect_to?:str }` | `ErrorResponse` with `LOCKED_BY_OTHER` | session cookie | wraps `POST /projects/files/{file_id}/checkout` | chapter detail checkout action |
| `DELETE` | `/api/v2/files/{file_id}/checkout` | cancel checkout / unlock | none | `{ status:"ok", file_id:int, lock:LockState, redirect_to?:str }` | `ErrorResponse` with `NOT_LOCK_OWNER` | session cookie | stable replacement for `POST /projects/files/{file_id}/cancel_checkout` | chapter detail cancel-checkout action |
| `POST` | `/api/v2/files/{file_id}/checkin` | replace a single checked-out file with uploaded content | multipart `{ file }` | `{ status:"ok", file:FileRecord, archived_version:VersionRecord, redirect_to?:str }` | `ErrorResponse` with `NOT_LOCK_OWNER`, `FILE_MISMATCH`, `UPLOAD_FAILED` | session cookie | formalizes the current check-in behavior that is hidden inside chapter upload with same filename | check-in modal in `chapter_detail.html` |

### Activities and notifications

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/activities` | activity feed | query `{ limit?:int=50 }` | `{ summary:{ total:int, today:int }, activities:[ActivityItem] }` | `ErrorResponse` | session cookie | new stable JSON counterpart for SSR `/activities` | `activities.html`, future activity modules |
| `GET` | `/api/v2/notifications` | notification feed | query `{ limit?:int=5 }` | `{ notifications:[NotificationItem], refreshed_at:str }` | `ErrorResponse` | session cookie | stable wrapper for `/api/notifications`; legacy flat array can continue temporarily | `base.html` navbar polling |

### Processing

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `POST` | `/api/v2/files/{file_id}/processing-jobs` | canonical processing start | `{ process_type:"permissions"|"ppd"|"technical"|"macro_processing"|"reference_validation"|"reference_number_validation"|"reference_apa_chicago_validation"|"reference_report_only"|"reference_structuring"|"structuring"|"bias_scan"|"credit_extractor_ai"|"word_to_xml", mode?:str, options?:object }` | `{ status:"accepted", job:ProcessJob }` | `ErrorResponse` with `PERMISSION_DENIED`, `FILE_NOT_FOUND`, `PROCESS_NOT_SUPPORTED` | session cookie | wraps `POST /api/v1/processing/files/{file_id}/process/{process_type}`; must preserve immediate-start semantics | `chapter_detail.html` process actions |
| `GET` | `/api/v2/processing-jobs/{job_id}` | job status lookup | none | `{ job:ProcessJob }` | `ErrorResponse` | session cookie | new stable status contract; current system has no job ID and must emulate until persistence exists | future frontend polling |
| `GET` | `/api/v2/files/{file_id}/processing-jobs` | list jobs/results for one file | query `{ latest?:bool=false, process_type?:str }` | `{ jobs:[ProcessJob] }` | `ErrorResponse` | session cookie | additive contract; current compatibility polling is structuring-only | chapter detail, processing history |

### Technical editor

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/files/{file_id}/technical-review` | get technical scan payload and shell metadata | none | `{ file:FileRecord, issues:[TechnicalIssue], actions:{ apply_endpoint:str, return_href:str } }` | `ErrorResponse` | session cookie with technical-processing role | stable replacement for separate shell + scan endpoint pairing | `technical_editor_form.html`, `/files/{file_id}/technical/edit` |
| `POST` | `/api/v2/files/{file_id}/technical-review/apply` | apply selected technical replacements | `{ replacements:{ [issue_key:str]:str } }` | `{ status:"ok", source_file_id:int, new_file:FileRecord, redirect_to?:str }` | `ErrorResponse` | session cookie with technical-processing role | wraps current `/technical/apply`; preserve `new_file_id` in compatibility adapter if needed | technical apply workflow |

### Structuring review

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/files/{file_id}/structuring-review` | fetch review metadata and processed-file state | none | `{ file:FileRecord, processed_file:{ filename:str, exists:bool }, editor:{ mode:"structuring", collabora_url?:str }, actions:{ export_href:str, save_href?:str, return_href:str } }` | `ErrorResponse` with `PROCESSED_FILE_MISSING` | session cookie | JSON companion for current SSR shell route | `structuring_review.html`, post-processing redirect flow |
| `POST` | `/api/v2/files/{file_id}/structuring-review/save` | explicit structuring save | `{ changes:{ [node_id:str]:str } }` | `{ status:"ok", file_id:int, saved_change_count:int, target_filename:str }` | `ErrorResponse` | session cookie | wraps existing `/api/v1/files/{file_id}/structuring/save` | latent explicit-save workflow |
| `GET` | `/api/v2/files/{file_id}/structuring-review/export` | export processed file | none | file response | `ErrorResponse` | session cookie | stable alias for current export route | export button in `structuring_review.html` |
| `GET` | `/api/v2/files/{file_id}/structuring-review/editor-launch` | return Collabora launch metadata for processed file | none | `{ file_id:int, mode:"structuring", collabora_url:str, wopi_mode:"structuring" }` | `ErrorResponse` | session cookie | support endpoint only; does not replace WOPI callback routes | structuring review shell |

### Admin users

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/admin/users` | admin user list | query `{ limit?:int=100, offset?:int=0 }` | `{ users:[AdminUser], roles:[{ id:int, name:str }], pagination:{ offset:int, limit:int, total:int } }` | `ErrorResponse` | session cookie with `Admin` role | JSON counterpart to SSR `/admin/users` | `admin_users.html` |
| `POST` | `/api/v2/admin/users` | create admin-managed user | `{ username:str, email:str, password:str, role_id:int }` | `{ status:"ok", user:AdminUser, redirect_to?:str }` | `ErrorResponse` with `DUPLICATE_USER`, `ROLE_NOT_FOUND` | session cookie with `Admin` role | wraps `/admin/users/create` | admin create user form |
| `GET` | `/api/v2/admin/roles` | list roles | none | `{ roles:[{ id:int, name:str, description?:str }] }` | `ErrorResponse` | session cookie with `Admin` role | new stable contract; current roles are only implicit in SSR pages | admin user create/edit/role forms |
| `GET` | `/api/v2/admin/users/{user_id}` | get user detail | none | `{ user:AdminUser }` | `ErrorResponse` | session cookie with `Admin` role | supports edit/password/detail forms | admin edit and password pages |
| `PATCH` | `/api/v2/admin/users/{user_id}` | update user fields | `{ email?:str }` | `{ status:"ok", user:AdminUser, redirect_to?:str }` | `ErrorResponse` | session cookie with `Admin` role | mirrors current narrow email-only edit behavior | `/admin/users/{user_id}/edit` |
| `PUT` | `/api/v2/admin/users/{user_id}/role` | replace current role set with one selected role | `{ role_id:int }` | `{ status:"ok", user:AdminUser, previous_role_ids:[int], redirect_to?:str }` | `ErrorResponse` with `LAST_ADMIN_PROTECTED` | session cookie with `Admin` role | preserve current replace-all single-role semantics | `/admin/users/{user_id}/role` form |
| `PUT` | `/api/v2/admin/users/{user_id}/status` | set active status | `{ is_active:bool }` | `{ status:"ok", user:{ id:int, is_active:bool }, redirect_to?:str }` | `ErrorResponse` with `SELF_LOCKOUT_BLOCKED` | session cookie with `Admin` role | stable replacement for toggle-only POST route | hidden admin status workflow |
| `PUT` | `/api/v2/admin/users/{user_id}/password` | change password | `{ new_password:str }` | `{ status:"ok", user:{ id:int }, password_updated:true, redirect_to?:str }` | `ErrorResponse` with `PASSWORD_TOO_SHORT` | session cookie with `Admin` role | preserve current minimum-length validation from effective route behavior | admin change password page |
| `DELETE` | `/api/v2/admin/users/{user_id}` | delete user | none | `{ status:"ok", deleted:{ user_id:int }, redirect_to?:str }` | `ErrorResponse` with `SELF_DELETE_BLOCKED` | session cookie with `Admin` role | wraps duplicate `/admin/users/{user_id}/delete` handlers | admin delete action |

### WOPI-related support endpoints

| Method | Path | Purpose | Request schema | Response schema | Error schema | Auth requirements | Compatibility notes | Source route/template/workflow currently depending on it |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/api/v2/files/{file_id}/editor-launch` | return launch metadata for original or processed edit shells | query `{ mode?:"original"|"structuring"="original" }` | `{ file_id:int, mode:"original"|"structuring", collabora_url:str, wopi_path:str }` | `ErrorResponse` | session cookie | support API only; current `/files/{file_id}/edit` and structuring shell remain SSR wrappers | `editor.html`, `structuring_review.html` |

## 3. Compatibility Endpoint Map

Migration disposition values:
- `remain unchanged`
- `wrap`
- `split into SSR + JSON`
- `deprecate later`

| Current endpoint | Current consumers | Migration disposition | Stable target contract | Conditions required before deprecation |
|---|---|---|---|---|
| `POST /login` | `login.html`, browser session flow | wrap | `POST /api/v2/session/login` | stable session login must set same cookie semantics and all SSR pages must accept new session bootstrap |
| `GET /logout` | navbar/logout links | wrap | `DELETE /api/v2/session` | UI must switch to new logout API or shell bridge while redirect behavior stays intact |
| `POST /register` | `register.html` | wrap | `POST /api/v2/registration` | first-user admin bootstrap and duplicate-user handling must be parity-tested |
| `POST /api/v1/users/` | external/API callers | remain unchanged | `POST /api/v2/admin/users` or future user-create contract | keep until no non-SSR clients depend on v1 payload shape |
| `POST /api/v1/users/login` | API clients, OAuth2 dependency | remain unchanged | `POST /api/v2/session/login` for browser, keep v1 for bearer | keep while bearer auth remains supported |
| `GET /api/v1/users/me` | API clients | remain unchanged | `GET /api/v2/session` | keep until all browser/bootstrap consumers use v2 and external clients are accounted for |
| `POST /projects/create_with_files` | `project_create.html` | wrap | `POST /api/v2/projects/bootstrap` | v2 bootstrap must preserve file classification, chapter creation, and redirect-worthy result payload |
| `POST /api/v1/projects/` | current API clients | remain unchanged | `POST /api/v2/projects` | keep while thin-create clients remain |
| `GET /api/v1/projects/` | possible API clients | wrap | `GET /api/v2/projects` | v2 pagination and project summary contract live and adopted |
| `PUT /api/v1/projects/{project_id}/status` | API/admin workflows | wrap | `PATCH /api/v2/projects/{project_id}/status` | stable body schema and enum contract live |
| `DELETE /api/v1/projects/{project_id}` | `projects.html` JS delete | wrap | `DELETE /api/v2/projects/{project_id}` | v2 delete must match SSR side effects before deprecating v1 |
| `POST /projects/{project_id}/chapters/create` | `project_chapters.html` modal | wrap | `POST /api/v2/projects/{project_id}/chapters` | v2 create must preserve folder creation |
| `POST /projects/{project_id}/chapter/{chapter_id}/rename` | `project_chapters.html` rename modal | wrap | `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}` | v2 rename must preserve directory rename |
| `POST /projects/{project_id}/chapter/{chapter_id}/delete` | `project_chapters.html` delete forms | wrap | `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}` | duplicate route behavior resolved and folder deletion parity verified |
| `GET /projects/{project_id}/chapter/{chapter_id}/download` | project chapter download UI | remain unchanged | `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/package` | browser download path can stay indefinitely if linked from stable JSON metadata |
| `POST /projects/{project_id}/chapter/{chapter_id}/upload` | upload modal and check-in modal | wrap | `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` | v2 upload must preserve overwrite/version/archive semantics and partial skip behavior |
| `POST /api/v1/files/` | thin upload API callers | remain unchanged | `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` for UI | keep only for compatibility/integration callers |
| `GET /projects/files/{file_id}/download` | chapter detail download links | remain unchanged | `GET /api/v2/files/{file_id}/download` | browser file endpoint may remain even after v2 metadata exists |
| `POST /projects/files/{file_id}/delete` | chapter detail delete actions | wrap | `DELETE /api/v2/files/{file_id}` | v2 delete must preserve redirect context information for legacy pages |
| `POST /projects/{project_id}/delete` | legacy project delete forms | wrap | `DELETE /api/v2/projects/{project_id}` | v2 delete must preserve filesystem cleanup and redirect metadata |
| `POST /projects/files/{file_id}/checkout` | chapter detail actions | wrap | `POST /api/v2/files/{file_id}/checkout` | lock conflict and idempotence semantics parity |
| `POST /projects/files/{file_id}/cancel_checkout` | chapter detail actions | wrap | `DELETE /api/v2/files/{file_id}/checkout` | unlock ownership semantics parity |
| `GET /api/notifications` | `base.html` polling | wrap | `GET /api/v2/notifications` | navbar must accept new typed payload before legacy flat array can retire |
| `POST /api/v1/processing/files/{file_id}/process/{process_type}` | `chapter_detail.html` process menus | wrap | `POST /api/v2/files/{file_id}/processing-jobs` | stable job model and compatibility mapper available |
| `GET /api/v1/processing/files/{file_id}/structuring_status` | `chapter_detail.html` structuring polling | wrap | `GET /api/v2/processing-jobs/{job_id}` | stable job IDs or compatibility-derived job mapping available |
| `GET /api/v1/processing/files/{file_id}/technical/scan` | `technical_editor_form.html` | wrap | `GET /api/v2/files/{file_id}/technical-review` | v2 issue schema adopted |
| `POST /api/v1/processing/files/{file_id}/technical/apply` | `technical_editor_form.html` | wrap | `POST /api/v2/files/{file_id}/technical-review/apply` | v2 apply response adopted |
| `GET /api/v1/files/{file_id}/structuring/review` | processing redirect target, `structuring_review.html` | split into SSR + JSON | `GET /api/v2/files/{file_id}/structuring-review` plus existing SSR shell | shell may remain; deprecate only after a non-SSR review shell exists |
| `POST /api/v1/files/{file_id}/structuring/save` | latent explicit-save path | wrap | `POST /api/v2/files/{file_id}/structuring-review/save` | confirm whether explicit save remains needed alongside WOPI autosave |
| `GET /api/v1/files/{file_id}/structuring/review/export` | export button in review page | remain unchanged | `GET /api/v2/files/{file_id}/structuring-review/export` | browser download endpoint may remain even after v2 metadata exists |
| `POST /admin/users/create` | `admin_create_user.html` | wrap | `POST /api/v2/admin/users` | v2 create contract and field-level errors live |
| `POST /admin/users/{user_id}/role` | `admin_users.html` | wrap | `PUT /api/v2/admin/users/{user_id}/role` | last-admin protection parity |
| `POST /admin/users/{user_id}/status` | hidden admin action | wrap | `PUT /api/v2/admin/users/{user_id}/status` | explicit `is_active` contract and self-lockout parity |
| `POST /admin/users/{user_id}/edit` | `admin_edit_user.html` | wrap | `PATCH /api/v2/admin/users/{user_id}` | narrow email-only behavior preserved |
| `POST /admin/users/{user_id}/password` | `admin_change_password.html` | wrap | `PUT /api/v2/admin/users/{user_id}/password` | effective minimum-length validation parity and duplicate-route resolution |
| `POST /admin/users/{user_id}/delete` | `admin_users.html` | wrap | `DELETE /api/v2/admin/users/{user_id}` | self-delete protection parity |
| `/api/v1/teams/` GET/POST | no active UI, possible API callers | remain unchanged | no new stable frontend dependency until team model drift is resolved | deprecate only after team contract and persistence mismatch is fixed |
| `GET /files/{file_id}/edit` | editor shell launch | split into SSR + JSON | `GET /api/v2/files/{file_id}/editor-launch` plus existing SSR shell | shell may remain indefinitely as backend integration wrapper |
| `/wopi/files/*` endpoints | Collabora only | remain unchanged | no frontend replacement; integration-only | do not deprecate until editor integration strategy changes completely |

## 4. Polling and Status Contract Map

Long-running workflows in the CMS are all processing-related. The stable frontend contract should introduce an explicit job model, while current structuring-only polling remains active as a compatibility path.

| Workflow | Start endpoint | Status endpoint | Status response schema | Terminal states | Error states | Retry behavior | Frontend implications |
|---|---|---|---|---|---|---|---|
| Canonical processing job | `POST /api/v2/files/{file_id}/processing-jobs` | `GET /api/v2/processing-jobs/{job_id}` | `{ job:ProcessJob }` | `succeeded`, `failed`, `cancelled` | `failed`, transport errors, `not_found` | safe to retry `GET`; `POST` should not be retried blindly without idempotency support | frontend can show job cards, disable conflicting actions while `queued/running`, and route to result files on success |
| Compatibility structuring flow | `POST /api/v1/processing/files/{file_id}/process/structuring?mode=...` | `GET /api/v1/processing/files/{file_id}/structuring_status` | `{ status:"processing" }` or `{ status:"completed", new_file_id:int }` | `completed` | implicit only; current contract does not expose `failed` | safe to poll `GET`; no defined retry semantics on `POST` | legacy `chapter_detail.html` must continue polling until frontend moves to job IDs |
| Compatibility reference/other process starts | `POST /api/v1/processing/files/{file_id}/process/{process_type}` | none today | start only: `{ message, status:"processing" }` | none observable through API today | only immediate start errors | frontend cannot know completion except by manual refresh or derived output discovery | stable v2 job model is required before modern frontend can treat these as first-class long-running actions |

Stable status schema details:
- `queued`: accepted but not started
- `running`: actively executing
- `succeeded`: completed, `result_files` populated
- `failed`: terminal failure, `error` populated
- `cancelled`: terminal cancellation, only valid once cancellation support exists

Frontend implications that must be respected:
- Current SSR pages assume the source file is locked immediately when processing starts.
- Current processing does not expose progress percentage; frontend should model status as discrete states, not percentages.
- Current compatibility routes do not expose cancellation; frontend should not show a cancel action until the backend has durable job state and actual cancellation support.

## 5. Delete and Mutating Action Normalization

| Action | Canonical route | Request contract | Response contract | Side effects | Backward compatibility needs |
|---|---|---|---|---|---|
| Project delete | `DELETE /api/v2/projects/{project_id}` | none | `{ status:"ok", deleted:{ project_id:int, code:str, db_cleanup:true, filesystem_cleanup:true }, redirect_to?:"/dashboard" }` | deletes dependent chapter/file/version rows and project directory tree | keep `POST /projects/{project_id}/delete` and `DELETE /api/v1/projects/{project_id}` until both legacy UI and JS callers migrate |
| Chapter delete | `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}` | none | `{ status:"ok", deleted:{ project_id:int, chapter_id:int, chapter_number:str }, redirect_to?:str }` | deletes chapter row and chapter directory tree | keep both legacy duplicate POST delete routes until de-duplication is verified |
| File delete | `DELETE /api/v2/files/{file_id}` | none | `{ status:"ok", deleted:{ file_id:int, filename:str, category:str, project_id:int, chapter_id:int }, redirect_to?:str }` | deletes file bytes if present and file row | keep `POST /projects/files/{file_id}/delete` until chapter detail UI consumes v2 |
| Cancel checkout | `DELETE /api/v2/files/{file_id}/checkout` | none | `{ status:"ok", file_id:int, lock:LockState, redirect_to?:str }` | clears lock only when caller owns it | keep `POST /projects/files/{file_id}/cancel_checkout` until legacy forms are replaced |
| Processing cancellation | not exposed in active stable surface until backend supports cancelable jobs | n/a | n/a | none in current CMS; no cancellation semantics exist | do not expose a fake cancel route; current frontend should model cancellation as unavailable |
| Admin create user | `POST /api/v2/admin/users` | `{ username:str, email:str, password:str, role_id:int }` | `{ status:"ok", user:AdminUser, redirect_to?:str }` | creates user row, role assignment, password hash | keep `/admin/users/create` POST until admin UI uses v2 |
| Admin update role | `PUT /api/v2/admin/users/{user_id}/role` | `{ role_id:int }` | `{ status:"ok", user:AdminUser, previous_role_ids:[int], redirect_to?:str }` | replaces role set; enforces last-admin protection | keep `/admin/users/{user_id}/role` POST until v2 admin role UI lands |
| Admin update status | `PUT /api/v2/admin/users/{user_id}/status` | `{ is_active:bool }` | `{ status:"ok", user:{ id:int, is_active:bool }, redirect_to?:str }` | toggles active state; blocks self-lockout | keep `/admin/users/{user_id}/status` POST while hidden compatibility behavior remains |
| Admin change password | `PUT /api/v2/admin/users/{user_id}/password` | `{ new_password:str }` | `{ status:"ok", user:{ id:int }, password_updated:true, redirect_to?:str }` | updates password hash; enforces current minimum-length rule | keep duplicate legacy POST routes until effective validation parity is proven |
| Admin delete user | `DELETE /api/v2/admin/users/{user_id}` | none | `{ status:"ok", deleted:{ user_id:int }, redirect_to?:str }` | deletes user; blocks self-delete | keep legacy POST delete route until admin table actions move to v2 |

## 6. Deliverable Closure

### Top 15 endpoints needing normalization first

1. `POST /login`
2. `POST /projects/create_with_files`
3. `POST /projects/{project_id}/chapter/{chapter_id}/upload`
4. `DELETE /api/v1/projects/{project_id}`
5. `POST /projects/{project_id}/delete`
6. `POST /projects/files/{file_id}/checkout`
7. `POST /projects/files/{file_id}/cancel_checkout`
8. `POST /projects/files/{file_id}/delete`
9. `POST /api/v1/processing/files/{file_id}/process/{process_type}`
10. `GET /api/v1/processing/files/{file_id}/structuring_status`
11. `GET /api/v1/processing/files/{file_id}/technical/scan`
12. `POST /api/v1/processing/files/{file_id}/technical/apply`
13. `GET /api/v1/files/{file_id}/structuring/review`
14. `POST /api/v1/files/{file_id}/structuring/save`
15. `GET /api/notifications`

### Top 10 compatibility endpoints to keep temporarily

1. `POST /login`
2. `GET /logout`
3. `POST /register`
4. `POST /projects/create_with_files`
5. `POST /projects/{project_id}/chapter/{chapter_id}/upload`
6. `POST /projects/files/{file_id}/checkout`
7. `POST /projects/files/{file_id}/cancel_checkout`
8. `POST /api/v1/processing/files/{file_id}/process/{process_type}`
9. `GET /api/v1/processing/files/{file_id}/structuring_status`
10. `GET /api/v1/files/{file_id}/structuring/review`

### Top 10 new stable endpoints required before frontend work

1. `GET /api/v2/session`
2. `POST /api/v2/session/login`
3. `GET /api/v2/dashboard`
4. `POST /api/v2/projects/bootstrap`
5. `GET /api/v2/projects`
6. `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`
7. `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`
8. `GET /api/v2/files/{file_id}/versions`
9. `POST /api/v2/files/{file_id}/processing-jobs`
10. `GET /api/v2/processing-jobs/{job_id}`

### Top 10 schema inconsistencies found

1. Browser auth is cookie-based and redirect-driven, while API auth is bearer-token based and JSON-driven.
2. `schemas.ProjectCreate` omits `client_name`, but SSR project creation and `Project` model both use it.
3. `POST /api/v1/projects/` creates only a project row, while `POST /projects/create_with_files` creates project + chapters + files + folders.
4. `DELETE /api/v1/projects/{project_id}` omits filesystem cleanup, but `POST /projects/{project_id}/delete` performs it.
5. `POST /api/v1/files/` returns only `{ file_id, path }`, not the file metadata required by current chapter workflows.
6. `GET /api/v1/processing/files/{file_id}/technical/scan` returns a dynamic dict with no schema or envelope.
7. `POST /api/v1/processing/files/{file_id}/process/{process_type}` has no job ID and ignores most JSON body data.
8. `GET /api/notifications` returns display-only items with no IDs, types, or entity links.
9. `POST /api/v1/teams/` declares `TeamCreate` as a response model even though the service writes nonexistent `Team` fields.
10. Duplicate `/admin/users/{user_id}/password` and `/admin/users/{user_id}/delete` routes make the effective mutation contract ambiguous.

### Recommended API normalization order as a numbered list

1. Normalize auth/session first by introducing `/api/v2/session` while preserving `POST /login`, `GET /logout`, and `POST /api/v1/users/login`.
2. Normalize delete semantics next so project, chapter, and file deletion have one canonical contract with explicit filesystem side effects.
3. Normalize project bootstrap creation so the current create-with-files workflow has a stable JSON equivalent.
4. Normalize chapter upload/versioning before any file-management frontend work.
5. Normalize checkout/check-in semantics so lock state is explicit and reusable.
6. Normalize dashboard, projects, chapters, and file read models into stable `/api/v2` page-state data.
7. Normalize notifications and activities into typed feed contracts.
8. Introduce a stable processing job contract with explicit job IDs and status states.
9. Normalize technical editor scan/apply contracts.
10. Normalize structuring review metadata, explicit save, and export contracts.
11. Normalize admin user APIs after auth/session and mutation semantics are stable.
12. Leave WOPI callback routes unchanged, and only add frontend-facing support metadata endpoints around them.
