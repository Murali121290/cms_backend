# Phase 0 Repository Inventory

Static analysis only. This document inventories the current FastAPI CMS repository state for migration planning. No application code was modified and no refactor work was performed.

## 1. Route Inventory

Route types:
- `SSR page`: primarily renders HTML or redirects to HTML routes.
- `JSON API`: primarily returns JSON or file bytes.
- `Mixed`: route may render HTML on error and redirect/JSON on success, or mixes SSR control with data side effects.

Migration targets:
- `keep SSR`
- `hybrid`
- `typed frontend module`
- `API-only`

### app/routers/web.py

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | GET | `home` | SSR page | cookie via `get_current_user_from_cookie` | request | redirect | none | `get_current_user_from_cookie` | `User` | none | none | none | app entry navigation | keep SSR | Duplicates `app.main` root path; this handler is the current runtime owner because `web.router` is included before `app.main.read_root`. |
| `/login` | GET | `login_page` | SSR page | none | request | HTML | `login.html` | `TemplateResponse` | none | none | none | none | `login.html` | keep SSR | Low interactivity page; tied to cookie auth. |
| `/login` | POST | `login_submit` | Mixed | none | form `username,password` | redirect or HTML with error | `login.html` on error | `verify_password`, `create_access_token` | `User` | writes `access_token` cookie | none | none | `login.html` form | keep SSR | Creates bearer token but stores it in cookie for web. |
| `/logout` | GET | `logout` | SSR page | none required | none | redirect | none | `delete_cookie` | none | deletes `access_token` cookie | none | none | nav links / base layouts | keep SSR | Simple session termination route. |
| `/register` | GET | `register_page` | SSR page | none | request | HTML | `register.html` | `TemplateResponse` | none | none | none | none | `register.html` | keep SSR | Registration page. |
| `/register` | POST | `register_submit` | Mixed | none | form `username,email,password,confirm_password` | redirect or HTML with error | `register.html` on error | `hash_password` | `User, Role` | none | none | none | `register.html` form | keep SSR | Seeds roles if absent; first user becomes Admin. |
| `/dashboard` | GET | `dashboard` | SSR page | cookie | request | HTML | `dashboard.html` | `project_service.get_projects` | `Project, User` | none | none | none | `dashboard.html`, `base_tailwind.html` | hybrid | Template already injects backend data into JS and contains mock client flows. |
| `/projects` | GET | `projects_list` | SSR page | cookie | request | HTML | `projects.html` | `project_service.get_projects` | `Project, User` | none | none | none | `projects.html` | typed frontend module | List page already calls JSON delete API via fetch. |
| `/projects/create` | GET | `create_project_page` | SSR page | cookie | request | HTML | `project_create.html` | none | `User` | none | none | none | `project_create.html` | hybrid | Form-only page; low interactivity beyond file picker preview. |
| `/admin` | GET | `admin_dashboard` | SSR page | cookie + inline Admin check | request | HTML or redirect | `admin_dashboard.html` | none | `User, File` | none | none | none | admin nav in base layouts | keep SSR | Admin summary page; simple candidate to defer. |
| `/admin/users/create` | GET | `admin_create_user_page` | SSR page | cookie + Admin check | request | HTML or redirect | `admin_create_user.html` | none | `Role, User` | none | none | none | `admin_create_user.html` | hybrid | Pure form page. |
| `/admin/users/create` | POST | `admin_create_user_submit` | Mixed | cookie + Admin check | form `username,email,password,role_id` | redirect or HTML with error | `admin_create_user.html` on error | `hash_password` | `User, Role` | none | none | none | `admin_create_user.html` form | hybrid | Writes directly to DB; no dedicated admin service. |
| `/admin/users` | GET | `admin_users` | SSR page | cookie + Admin check | request | HTML | `admin_users.html` | none | `User, Role` | none | none | none | `admin_users.html` | typed frontend module | Central user-management page with multiple form actions. |
| `/admin/users/{user_id}/role` | POST | `update_user_role` | Mixed | cookie + Admin check | path `user_id`, form `role_id` | redirect or attempted HTML error render | `admin_users.html` intended on last-admin failure | none | `User, Role, UserRole` | none | none | none | `admin_users.html` role form | typed frontend module | Replaces all roles with one selected role; last-Admin guard currently references undefined `request` and is likely to 500 instead of cleanly re-rendering. |
| `/admin/users/{user_id}/delete` | POST | `admin_delete_user` (first) | Mixed | cookie | path `user_id` | redirect | none | none | `User` | none | none | none | `admin_users.html` delete form | typed frontend module | Current runtime owner for this duplicate path because it is registered first; no Admin-role check is enforced here. |
| `/admin/users/{user_id}/status` | POST | `toggle_user_status` | Mixed | cookie + Admin check | path `user_id` | redirect | none | none | `User` | none | none | none | no active template form found in current `admin_users.html` | typed frontend module | Appears orphaned from active template. |
| `/admin/stats` | GET | `admin_stats` | SSR page | cookie + Admin check | request | HTML | `admin_stats.html` | none | `User, Project, Chapter, File, Role, UserRole` | none | none | none | admin nav | keep SSR | Read-only reporting page. |
| `/admin/users/{user_id}/password` | GET | `admin_change_password_page` (first) | SSR page | cookie + Admin check | path `user_id` | HTML or redirect | `admin_change_password.html` | none | `User` | none | none | none | `admin_change_password.html` | hybrid | Current runtime owner for this duplicate path; passes `target_user`, which matches the active template contract. |
| `/admin/users/{user_id}/password` | POST | `admin_change_password_submit` | Mixed | cookie + Admin check | path `user_id`, form `new_password` | redirect | none | `hash_password` | `User` | none | none | none | `admin_change_password.html` form | hybrid | Current runtime owner for this duplicate path; first POST version has no password-length validation and no success query message. |
| `/projects/create_with_files` | POST | `create_project_with_files` | Mixed | cookie | form `code,title,client_name,xml_standard,chapter_count`, multi-file upload | redirect | none | `project_service.create_project`, regex chapter inference | `Project, Chapter, File` | creates project/chapter/category directories, writes uploaded files under `UPLOAD_DIR/{code}/{chapter}/{category}` | none | none | `project_create.html` form | typed frontend module | High-risk workflow: project creation, chapter generation, file classification, filename parsing. |
| `/projects/{project_id}` and `/projects/{project_id}/chapters` | GET | `project_chapters` | SSR page | cookie | path `project_id` | HTML | `project_chapters.html` | none | `Project, Chapter, File` | reads chapter/file structure implicitly | none | none | `projects.html` links, chapter nav | typed frontend module | Computes derived chapter flags in route. |
| `/projects/{project_id}/chapters/create` | POST | `create_chapter` | Mixed | cookie | path `project_id`, form `number,title` | redirect | none | none | `Project, Chapter` | creates chapter directories and category subfolders | none | none | `project_chapters.html` form | typed frontend module | Writes DB and storage in one route. |
| `/projects/{project_id}/chapter/{chapter_id}/rename` | POST | `rename_chapter` | Mixed | cookie | path `project_id,chapter_id`, form `number,title` | redirect | none | none | `Project, Chapter` | renames chapter directory if number changes | none | none | `project_chapters.html` rename modal/form | typed frontend module | Storage path rename coupled to DB update. |
| `/projects/{project_id}/chapter/{chapter_id}/download` | GET | `download_chapter_zip` | JSON API / file | cookie | path `project_id,chapter_id` | `FileResponse` zip | none | `zipfile`, `tempfile` | `Project, Chapter` | reads chapter directory, builds temp zip | none | none | chapter page action buttons | API-only | Runtime temp zip generation; cleanup not explicit. |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | POST | `delete_chapter` (first) | Mixed | cookie | path `project_id,chapter_id` | redirect | none | `shutil.rmtree` | `Project, Chapter` | deletes chapter directory tree | none | none | `project_chapters.html` delete form | typed frontend module | Current runtime owner for this duplicate path because it is registered first; returns `msg=Chapter+Deleted+Successfully`. |
| `/projects/{project_id}/chapter/{chapter_id}` | GET | `chapter_detail` | SSR page | cookie | path `project_id,chapter_id`, query `tab` | HTML | `chapter_detail.html` | none | `Project, Chapter, File, User` | none | none | none | `chapter_detail.html` | typed frontend module | Most coupled page in UI; launches many downstream flows. |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | POST | `upload_chapter_files` | Mixed | cookie | path `project_id,chapter_id`, form `category`, multi-file upload | redirect | none | `now_ist_naive`, `shutil.copy2` | `Project, Chapter, File, FileVersion` | writes files, archive copies to `Archive/`, updates versioning and checkout fields | none | none | upload forms in `chapter_detail.html` | typed frontend module | High-risk workflow: overwrite/version/archive semantics. |
| `/projects/files/{file_id}/download` | GET | `download_file` | JSON API / file | cookie | path `file_id` | `FileResponse` | none | none | `File` | reads file path from disk | none | none | chapter detail file actions | API-only | Straight file-download endpoint. |
| `/projects/files/{file_id}/delete` | POST | `delete_file` | Mixed | cookie | path `file_id` | redirect | none | `os.remove` | `File` | deletes physical file | none | none | delete forms in `chapter_detail.html` | typed frontend module | Deletes DB row and disk file; version history untouched. |
| `/projects/{project_id}/delete` | POST | `delete_project` | Mixed | cookie | path `project_id` | redirect | none | `shutil.rmtree` | `Project` | deletes project directory tree | none | none | backup template had form; API delete also exists | typed frontend module | Direct DB delete; chapter/file cascade depends on ORM/db constraints. |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | POST | `delete_chapter` (second) | Mixed | cookie | path `project_id,chapter_id` | redirect | none | `shutil.rmtree` | `Project, Chapter` | deletes chapter path | none | none | `project_chapters.html` delete form | typed frontend module | Shadowed by the earlier duplicate under current registration order; if activated, it would change the redirect message contract to `Chapter+Deleted`. |
| `/projects/files/{file_id}/checkout` | POST | `checkout_file` | Mixed | cookie | path `file_id` | redirect | none | `now_ist_naive` | `File, User` | none | none | none | checkout forms in `chapter_detail.html` | typed frontend module | Lock semantics must be preserved exactly. |
| `/projects/files/{file_id}/cancel_checkout` | POST | `cancel_checkout` | Mixed | cookie | path `file_id` | redirect | none | none | `File, User` | none | none | none | cancel-checkout forms in `chapter_detail.html` | typed frontend module | Only releasing own lock is allowed. |
| `/api/notifications` | GET | `get_notifications_data` | JSON API | cookie | none | JSON array | none | `now_ist_naive` | `File` | none | none | none | `base.html` notification polling | API-only | Lightweight derived feed from recent files only. |
| `/activities` | GET | `activities_page` | SSR page | cookie | request | HTML | `activities.html` | `now_ist_naive` | `File, FileVersion, Project, Chapter` | none | none | none | activities nav / dashboard links | hybrid | Read-only page but builds derived activity feed in-route. |
| `/files/{file_id}/technical/edit` | GET | `technical_editor_page` | SSR page | cookie | path `file_id` | HTML | `technical_editor_form.html` | none | `File` | none | none | none | chapter detail process actions | typed frontend module | UI is already API-driven after initial page load. |
| `/admin/users/{user_id}/edit` | GET | `admin_edit_user_page` | SSR page | cookie | path `user_id` | HTML | `admin_edit_user.html` | none | `User, Role` | none | none | none | `admin_users.html` edit link | hybrid | Uses `base.html`, unlike most active admin pages using Tailwind base; route is authenticated-only and does not enforce Admin role. |
| `/admin/users/{user_id}/edit` | POST | `admin_edit_user` | Mixed | cookie | path `user_id`, form body via `request.form()` | redirect | none | none | `User` | none | none | none | `admin_edit_user.html` form | hybrid | Only updates email in current implementation; route is authenticated-only and does not enforce Admin role. |
| `/admin/users/{user_id}/password` | GET | `admin_change_password_page` (second) | SSR page | cookie | path `user_id` | HTML | `admin_change_password.html` | none | `User` | none | none | none | `admin_users.html` password link | hybrid | Shadowed by the earlier GET duplicate; if reached, it would pass `target` instead of `target_user` and skip the explicit Admin check. |
| `/admin/users/{user_id}/password` | POST | `admin_change_password` (second) | Mixed | cookie | path `user_id`, form via `request.form()` | redirect or HTML with error | `admin_change_password.html` on validation error | `hash_password` | `User` | none | none | none | `admin_change_password.html` form | hybrid | Shadowed by the earlier POST duplicate; adds min-length validation and success query message, but that behavior is currently not reachable. |
| `/admin/users/{user_id}/delete` | POST | `admin_delete_user` (second) | Mixed | cookie | path `user_id` | redirect | none | none | `User` | none | none | none | `admin_users.html` delete form | hybrid | Shadowed by the earlier POST duplicate; behavior is nearly identical, but it is not the current runtime owner. |

### app/routers/projects.py

Prefix: `/api/v1/projects`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/projects/` | POST | `create_project` | JSON API | bearer + `require_role("ProjectManager")` | JSON body `ProjectCreate` | JSON project | none | `project_service.create_project` | `Project` | none | none | none | no active template direct use observed | API-only | Thin API route; does not replicate SSR project-creation workflow. |
| `/api/v1/projects/` | GET | `read_projects` | JSON API | bearer `get_current_user` | query `skip,limit` | JSON list | none | `project_service.get_projects` | `Project` | none | none | none | potential frontend data source; not used by dashboard/projects SSR pages today | API-only | Good contract candidate once expanded. |
| `/api/v1/projects/{project_id}/status` | PUT | `update_project_status` | JSON API | bearer + `require_role("ProjectManager")` | path `project_id`, query/body `status` | JSON project or 404 | none | `project_service.update_project_status` | `Project` | none | none | none | no active template direct use observed | API-only | Query-vs-body contract should be clarified later. |
| `/api/v1/projects/{project_id}` | DELETE | `delete_project` | JSON API | cookie `get_current_user_from_cookie` | path `project_id` | JSON message | none | `project_service.delete_project_v2` | `Project, Chapter, File, FileVersion` | no direct disk delete in service | none | none | `projects.html` fetch delete | API-only | Deletes DB rows but does not remove project folder; behavior differs from SSR delete route. |

### app/routers/files.py

Prefix: `/api/v1/files`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/files/` | POST | `upload_file` | JSON API | bearer `get_current_user` | query/body `project_id`, multipart file | JSON `{file_id,path}` | none | `file_service.create_file_record` | `File` | writes file to flat uploads dir | none | none | no active template direct use observed | API-only | Simplified upload path; does not implement chapter/category/version/archive logic. |

### app/routers/processing.py

Prefix: `/api/v1/processing`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/processing/files/{file_id}/process/{process_type}` | POST | `run_file_process` | JSON API | cookie `get_current_user_from_cookie` + role map in `check_permission` | path `file_id,process_type`, query `mode`, optional JSON body | JSON `{message,status}` | none | `check_permission`, `background_processing_task`, `now_ist_naive` | `File, FileVersion, Project, Chapter, User` | creates archive backup, increments version, locks file | FastAPI `BackgroundTasks` | processing engines, AI client, legacy tools | `chapter_detail.html` process buttons and modal JS | API-only | Core orchestration route; highest-risk API in CMS. |
| `/api/v1/processing/files/{file_id}/structuring_status` | GET | `check_structuring_status` | JSON API | cookie | path `file_id` | JSON `{status,new_file_id?}` | none | none | `File` | no write; infers status from DB/file naming convention | none | none | `chapter_detail.html` polling JS | API-only | Status is inferred by presence of `_Processed` file record, not persisted job state. |
| `/api/v1/processing/files/{file_id}/technical/scan` | GET | `scan_technical_errors` | JSON API | cookie + technical permission | path `file_id` | JSON scan result map | none | `TechnicalEditor.scan`, `check_permission` | `File` | reads source docx | none | none | `technical_editor_form.html` initial load | API-only | Pure read/analysis endpoint. |
| `/api/v1/processing/files/{file_id}/technical/apply` | POST | `apply_technical_edits` | JSON API | cookie + technical permission | path `file_id`, JSON replacements map | JSON `{status,new_file_id}` | none | `TechnicalEditor.process`, `check_permission` | `File` | writes `_TechEdited` file beside original | none | none | `technical_editor_form.html` submit | API-only | Creates a new `File` record rather than mutating original. |

### app/routers/structuring.py

Prefix: `/api/v1`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/files/{file_id}/structuring/review` | GET | `review_structuring` | SSR page | cookie | path `file_id` | HTML or error page | `structuring_review.html` or `error.html` | `extract_document_structure`, `get_rules_loader` | `File` | reads processed file path, checks existence | none | Collabora / WOPI URL construction | redirect target from `chapter_detail.html` polling | hybrid | Review shell for processed doc; real editing happens through Collabora/WOPI. |
| `/api/v1/files/{file_id}/structuring/save` | POST | `save_structuring_changes` | JSON API | cookie | path `file_id`, JSON body `{changes:{...}}` | JSON success or error | none | `update_document_structure` | `File` | mutates processed docx in place | none | none | no active template use observed in current `structuring_review.html`; legacy backup used it | API-only | Endpoint exists but current active review page relies on WOPI autosave instead. |
| `/api/v1/files/{file_id}/structuring/review/export` | GET | `export_structuring` | JSON API / file | cookie | path `file_id` | processed DOCX `FileResponse` | none | none | `File` | reads processed docx | none | none | export button in `structuring_review.html` | API-only | File-export endpoint for processed version. |

### app/routers/wopi.py

No prefix.

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/files/{file_id}/edit` | GET | `edit_file_page` | SSR page | cookie | path `file_id` | HTML | `editor.html` | `_get_target_path` | `File` | reads file path for metadata only | none | Collabora editor iframe | file action links | keep SSR | Thin wrapper around Collabora launch URL. |
| `/wopi/files/{file_id}` | GET | `wopi_check_file_info` | JSON API | none | path `file_id` | JSON metadata | none | `_get_target_path` | `File` | reads file stats and file hash | none | Collabora WOPI `CheckFileInfo` | Collabora only | API-only | No user auth; editor trust boundary is integration-level. |
| `/wopi/files/{file_id}/contents` | GET | `wopi_get_file` | JSON API / file | none | path `file_id` | DOCX bytes | none | `_get_target_path` | `File` | reads file bytes from disk | none | Collabora WOPI `GetFile` | Collabora only | API-only | Duplicate DB query in function body. |
| `/wopi/files/{file_id}/contents` | POST | `wopi_put_file` | JSON API | none | path `file_id`, raw request body | empty 200 or error | none | `_get_target_path` | `File` | overwrites original file bytes | none | Collabora WOPI `PutFile` | Collabora only | API-only | Critical editor save path. |
| `/wopi/files/{file_id}/structuring` | GET | `wopi_check_file_info_structuring` | JSON API | none | path `file_id` | JSON metadata | none | `_get_target_path(mode="structuring")` | `File` | reads processed file stats/hash | none | Collabora WOPI | Collabora structuring review | API-only | Same as normal WOPI but against `_Processed` file. |
| `/wopi/files/{file_id}/structuring/contents` | GET | `wopi_get_file_structuring` | JSON API / file | none | path `file_id` | DOCX bytes | none | `_get_target_path(mode="structuring")` | `File` | reads processed file bytes | none | Collabora WOPI | Collabora structuring review | API-only | File-serving route for processed version. |
| `/wopi/files/{file_id}/structuring/contents` | POST | `wopi_put_file_structuring` | JSON API | none | path `file_id`, raw request body | empty 200 or error | none | `_get_target_path(mode="structuring")` | `File` | overwrites processed file bytes | none | Collabora WOPI | Collabora structuring review | API-only | Critical processed-file save path. |

### Other routers

#### app/routers/users.py

Prefix: `/api/v1/users`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/users/` | POST | `create_user` | JSON API | none | JSON `UserCreate` | JSON `{id,username}` | none | `user_service.get_user_by_username`, `user_service.create_user` | `User` | none | none | none | no active template use observed | API-only | API registration path is separate from SSR register flow. |
| `/api/v1/users/login` | POST | `login` | JSON API | none | OAuth2 form body | JSON bearer token | none | `user_service.get_user_by_username`, `verify_password`, `create_access_token` | `User` | none | none | none | no active template use observed | API-only | Token API for non-SSR clients. |
| `/api/v1/users/me` | GET | `read_users_me` | JSON API | bearer `get_current_user` | none | JSON current user payload | none | `get_current_user` | `User, Role` | none | none | none | no active template use observed | API-only | Good frontend bootstrap endpoint. |

#### app/routers/teams.py

Prefix: `/api/v1/teams`

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/v1/teams/` | POST | `create_team` | JSON API | bearer `get_current_user` | JSON `TeamCreate` | JSON team payload | none | `team_service.create_team` | `Team` | none | none | none | no active template use observed | API-only | Service/model drift exists: service writes nonexistent `description` and `owner_id`. |
| `/api/v1/teams/` | GET | `read_teams` | JSON API | bearer `get_current_user` | query `skip,limit` | JSON team list | none | `team_service.get_teams` | `Team` | none | none | none | no active template use observed | API-only | Currently unused by SSR UI. |

#### app/main.py

| Path | Method | Function | Type | Auth | Inputs | Response | Template | Services / helpers | Models touched | FS / storage | BG / queue | External | Templates / JS depending on it | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | GET | `read_root` | JSON API | none | none | JSON welcome message | none | none | none | none | none | none | none observed | API-only | Duplicates `/` from `web.py`; shadowed at runtime because `web.home` is registered first. |

### Mutation Response Addendum

Interpretation note:
- For duplicate paths, effective runtime owner is inferred from current FastAPI / Starlette registration order: the first registered matching route is the active handler.
- Query-string message consumers currently verified in templates are:
  - `login.html` for `?msg=...`
  - `admin_users.html` via success/error toast script
  - `chapter_detail.html` via inline alert banner
- Query-string messages are currently produced but not rendered by `dashboard.html` and `project_chapters.html`.

#### app/routers/web.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/login` | POST | `login_submit` | `302` to `/dashboard`; sets `access_token=Bearer <jwt>` cookie | `200` re-renders `login.html` with `error="Invalid credentials"` or caught exception text | `/dashboard` | `login.html` | none |
| `/logout` | GET | `logout` | `302` to `/login`; deletes `access_token` cookie | no explicit failure branch | `/login` | none | none |
| `/register` | POST | `register_submit` | `302` to `/login?msg=Registration successful! Please login.` | `200` re-renders `register.html` on password mismatch, duplicate user/email, or caught exception | `/login?msg=Registration successful! Please login.` | `register.html` | success message is rendered by `login.html` |
| `/admin/users/create` | POST | `admin_create_user_submit` | `302` to `/admin/users` after creating user and attaching selected role | unauthenticated/non-admin: `302` to `/dashboard`; duplicate username/email or exception: `200` re-renders with `error` | `/admin/users` or `/dashboard` | `admin_create_user.html` | none |
| `/admin/users/{user_id}/role` | POST | `update_user_role` | `302` to `/admin/users?msg=Role+Updated`; replaces all existing roles with one new role | unauthenticated: `/login`; non-admin: `/dashboard`; invalid user/role: `302` to `/admin/users?msg=Invalid+user+or+role`; last-admin guard attempts to re-render but references undefined `request`, so current behavior is likely `500` instead of clean error HTML | `/admin/users?msg=Role+Updated`, `/admin/users?msg=Invalid+user+or+role`, `/login`, `/dashboard` | intended `admin_users.html` on last-admin failure, but current code path is likely broken | `admin_users.html` shows success toast for `msg`; `error` toast only appears if render succeeds |
| `/admin/users/{user_id}/delete` | POST | first `admin_delete_user` | `302` to `/admin/users?msg=User+deleted` | unauthenticated: `/login`; missing target: `/admin/users?msg=User+not+found`; self-delete blocked: `/admin/users?msg=Cannot+delete+yourself` | `/admin/users?...` or `/login` | none | `admin_users.html` shows toast from `msg` |
| `/admin/users/{user_id}/status` | POST | `toggle_user_status` | `302` to `/admin/users`; target toggled unless target is current user | unauthenticated: `/login`; non-admin: `/dashboard`; self-toggle is a silent no-op followed by redirect | `/admin/users`, `/login`, `/dashboard` | none | none |
| `/admin/users/{user_id}/password` | POST | first `admin_change_password_submit` | `302` to `/admin/users`; password is always replaced if target exists | unauthenticated/non-admin: `/dashboard`; missing target silently still redirects `/admin/users`; no length validation in active owner | `/admin/users` or `/dashboard` | none | none |
| `/projects/create_with_files` | POST | `create_project_with_files` | `302` to `/dashboard` after project/chapter/file bootstrap | unauthenticated: `/login`; validation errors become FastAPI `422`; DB/FS problems propagate as uncaught `500` | `/dashboard` or `/login` | none | none |
| `/projects/{project_id}/chapters/create` | POST | `create_chapter` | `302` to `/projects/{project_id}?msg=Chapter+Created+Successfully` after DB row and directories are created | unauthenticated: `/login`; missing project: `404`; DB/FS errors uncaught | `/projects/{project_id}?msg=Chapter+Created+Successfully` or `/login` | none | `project_chapters.html` does not currently render `msg` |
| `/projects/{project_id}/chapter/{chapter_id}/rename` | POST | `rename_chapter` | `302` to `/projects/{project_id}?msg=Chapter+Renamed+Successfully` after DB update and optional directory rename | unauthenticated: `/login`; missing chapter/project: `404`; `os.rename` failures uncaught | `/projects/{project_id}?msg=Chapter+Renamed+Successfully` or `/login` | none | `project_chapters.html` does not currently render `msg` |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | POST | first `delete_chapter` | `302` to `/projects/{project_id}?msg=Chapter+Deleted+Successfully` after directory removal and DB delete | unauthenticated: `/login`; missing chapter/project: `404`; `rmtree` issues uncaught | `/projects/{project_id}?msg=Chapter+Deleted+Successfully` or `/login` | none | `project_chapters.html` does not currently render `msg` |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | POST | `upload_chapter_files` | `302` to `/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=Files+Uploaded+Successfully`; writes new files or archives+overwrites existing ones | unauthenticated: `/login`; missing project/chapter: `404`; files locked by another user are silently skipped; FS/DB failures uncaught | `/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=Files+Uploaded+Successfully` or `/login` | none | `chapter_detail.html` renders `msg` inline; silent skip means success redirect can mask partial failure |
| `/projects/files/{file_id}/delete` | POST | `delete_file` | `302` back to chapter detail with `?tab={category}&msg=File+Deleted`; removes disk file if present and DB row | unauthenticated: `/login`; missing file: `404`; disk delete exceptions are swallowed and logged to stdout before DB delete continues | `/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=File+Deleted` or `/login` | none | `chapter_detail.html` renders `msg` inline |
| `/projects/{project_id}/delete` | POST | `delete_project` | `302` to `/dashboard?msg=Book+Deleted`; removes project folder and deletes project row | unauthenticated: `/login`; missing project: `404`; `rmtree` failures ignored by `ignore_errors=True` | `/dashboard?msg=Book+Deleted` or `/login` | none | `dashboard.html` does not currently render `msg` |
| `/projects/files/{file_id}/checkout` | POST | `checkout_file` | `302` back to chapter detail with `?tab={category}&msg=File+Checked+Out`; sets lock fields | unauthenticated: `/login`; missing file: `404`; if locked by another user, redirects with `msg=File+Locked+By+Other` and leaves lock unchanged | `/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=File+Checked+Out` or `...File+Locked+By+Other` or `/login` | none | `chapter_detail.html` renders `msg` inline |
| `/projects/files/{file_id}/cancel_checkout` | POST | `cancel_checkout` | `302` back to chapter detail with `?tab={category}&msg=Checkout+Cancelled`; only clears lock if current user owns it | unauthenticated: `/login`; missing file: `404`; wrong-user cancel is silent no-op plus success redirect | `/projects/{project_id}/chapter/{chapter_id}?tab={category}&msg=Checkout+Cancelled` or `/login` | none | `chapter_detail.html` renders `msg` inline |
| `/admin/users/{user_id}/edit` | POST | `admin_edit_user` | `302` to `/admin/users?msg=User+updated`; only email field is updated | unauthenticated: `/login`; missing target: `404`; route does not enforce Admin role | `/admin/users?msg=User+updated` or `/login` | none | `admin_users.html` shows success toast from `msg` |
| `/admin/users/{user_id}/password` | POST | second `admin_change_password` (shadowed) | if reached, `302` to `/admin/users?msg=Password+changed` after password update | if reached, unauthenticated: `/login`; missing target: `404`; short password: `200` re-renders with `error="Password must be at least 6 characters"` | `/admin/users?msg=Password+changed` or `/login` | `admin_change_password.html` | shadowed behavior differs from active route and is currently not reachable |
| `/admin/users/{user_id}/delete` | POST | second `admin_delete_user` (shadowed) | if reached, `302` to `/admin/users?msg=User+deleted` | if reached, same failure redirects as active owner | `/admin/users?...` or `/login` | none | shadowed; behavior is effectively identical to active owner |

#### app/routers/projects.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/api/v1/projects/` | POST | `create_project` | `200` JSON project payload from `project_service.create_project` | bearer auth/role failures: `401/403`; body validation: `422`; DB issues uncaught | none | none | none |
| `/api/v1/projects/{project_id}/status` | PUT | `update_project_status` | `200` JSON project payload with updated status | bearer auth/role failures: `401/403`; missing project: `404 {"detail":"Project not found"}`; body/query validation: `422` | none | none | none |
| `/api/v1/projects/{project_id}` | DELETE | `delete_project` | `200 {"message":"Project deleted successfully"}` after DB-only delete path | missing project: `404`; route depends on cookie extraction but never rejects `user=None`, so anonymous callers can currently reach service deletion; service/DB failures uncaught | none | none | none |

#### app/routers/files.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/api/v1/files/` | POST | `upload_file` | `200 {"file_id":..., "path":...}` | bearer auth failure: `401`; multipart/body validation: `422`; no explicit project existence validation before DB write | none | none | none |

#### app/routers/processing.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/api/v1/processing/files/{file_id}/process/{process_type}` | POST | `run_file_process` | `200 {"message": "... started in background ...", "status":"processing"}` after lock + backup + version increment + background dispatch | unauthenticated `401`; permission `403`; missing file or missing disk path `404`; locked by another user `400`; unsupported process type eventually fails in background after initial success response | none | none | none |
| `/api/v1/processing/files/{file_id}/technical/apply` | POST | `apply_technical_edits` | `200 {"status":"completed","new_file_id":...}` after writing `_TechEdited` file and new `File` row | unauthenticated `401`; permission `403`; missing file `404`; processing or output-generation failures `500 {"detail":...}` | none | none | none |

#### app/routers/structuring.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/api/v1/files/{file_id}/structuring/save` | POST | `save_structuring_changes` | `200 {"status":"success"}` after in-place write to processed DOCX | unauthenticated `401`; missing original/processed file `404`; save failure `500 {"detail":"Failed to save changes: ..."}` | none | none | none |

#### app/routers/wopi.py mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/wopi/files/{file_id}/contents` | POST | `wopi_put_file` | `200` empty body; overwrites original file when request body is non-empty; empty body is a no-op `200` | missing file/file path `404`; write failure `500 {"detail":...}` | none | none | none |
| `/wopi/files/{file_id}/structuring/contents` | POST | `wopi_put_file_structuring` | `200` empty body; overwrites `_Processed` file when request body is non-empty; empty body is a no-op `200` | missing file/file path `404`; write failure `500 {"detail":...}` | none | none | none |

#### other mutation routes

| Route | Method | Runtime owner | Success response behavior | Failure response behavior | Redirect target | Error render target | Query-string message behavior |
|---|---|---|---|---|---|---|---|
| `/api/v1/users/` | POST | `create_user` | `200 {"id":..., "username":...}` | duplicate username `400 {"detail":"Username already registered"}`; duplicate email / DB issues are uncaught | none | none | none |
| `/api/v1/users/login` | POST | `login` | `200 {"access_token":..., "token_type":"bearer"}` | invalid credentials `401 {"detail":"Incorrect username or password"}` with `WWW-Authenticate: Bearer` | none | none | none |
| `/api/v1/teams/` | POST | `create_team` | intended `200` team payload | duplicate team name `400`; current service/model drift (`description`, `owner_id`) means non-duplicate creates may raise uncaught `500` | none | none | none |

### Duplicate Route Path Addendum

Runtime-owner note:
- The active owner below is the first registered matching route under current code order. This is the route a regression suite should pin unless the duplicate is intentionally removed.

| Duplicate path | Method(s) | Registration order | Effective runtime owner | Shadowed handler | Behavior difference between duplicates | Migration risk caused by duplication |
|---|---|---|---|---|---|---|
| `/` | GET | `web.home` registered via `include_router(web.router)` before `app.main.read_root` | `web.home` | `app.main.read_root` | `web.home` redirects to `/dashboard` or `/login`; `read_root` returns JSON welcome payload | Very high: changing route order flips browser entry behavior and API/tooling expectations |
| `/admin/users/{user_id}/password` | GET | first `admin_change_password_page` at `web.py:432`, then second at `web.py:1232` | first `admin_change_password_page` | second `admin_change_password_page` | first enforces Admin and passes `target_user`; second only requires authentication and passes `target`, which does not match active template expectations | Very high: removal/reordering can silently weaken auth and break template rendering |
| `/admin/users/{user_id}/password` | POST | first `admin_change_password_submit` at `web.py:452`, then second `admin_change_password` at `web.py:1250` | first `admin_change_password_submit` | second `admin_change_password` | first always redirects `/admin/users` and accepts any password length; second validates min length, can render HTML error, and redirects with `?msg=Password+changed` | Very high: user-visible success/failure behavior changes if order changes |
| `/admin/users/{user_id}/delete` | POST | first `admin_delete_user` at `web.py:359`, then second at `web.py:1276` | first `admin_delete_user` | second `admin_delete_user` | behavior is currently functionally equivalent: same self-delete guard and same redirect messages | Medium: duplication hides intent and complicates extraction even though current outcomes match |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | POST | first `delete_chapter` at `web.py:733`, then second at `web.py:973` | first `delete_chapter` | second `delete_chapter` | first requires both `project` and `chapter` and redirects with `msg=Chapter+Deleted+Successfully`; second only checks `chapter` and redirects with `msg=Chapter+Deleted` | High: redirect-message contract and missing-project behavior drift if route order changes |

## 2. Template Inventory

Notes:
- No `{% include %}` partials were found in active runtime templates.
- `base.html` and `base_tailwind.html` are both active parent layouts.
- `.bak` files are dormant backup artifacts in the templates folder and are not rendered by active routes.

### Active runtime templates

| Template | Routes that render it | Parent layout | Includes | Context variables expected | Forms present / action URLs | Embedded JS / fetch usage | Backend dependencies | Role / permission assumptions | Coupling risks | Migration target | Migration notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `activities.html` | `/activities` | `base_tailwind.html` | none | `activities`, `today_count`, `user`, `request` | none | none observed | depends on route-built activity feed from `File` and `FileVersion` | base layout assumes `user`; page itself read-only | derived reporting logic lives in route, not service | hybrid | Could stay SSR longer; data contract should move to API later. |
| `admin_change_password.html` | `/admin/users/{id}/password` | `base_tailwind.html` | none | `target_user` or `target` depending on which duplicate route renders it, `user`, optional `error` | POST `/admin/users/{{ target_user.id }}/password` in active template | none observed | direct admin password-change routes | active runtime owner is admin-only; shadowed duplicate is authenticated-only | template context contract is inconsistent because duplicate routes pass different keys | hybrid | Needs context normalization before UI migration. |
| `admin_create_user.html` | `/admin/users/create` GET and POST error path | `base_tailwind.html` | none | `roles`, `user`, optional `error` | POST `/admin/users/create` | none observed | direct DB-backed admin create user route | admin-only by route | form posts to route with DB writes; no service boundary | hybrid | Low UI complexity. |
| `admin_dashboard.html` | `/admin` | `base_tailwind.html` | none | `admin_stats`, `user` | none | none observed | counts from `User` and `File` | admin-only by route and base nav | simple read-only page; low coupling | keep SSR | Candidate to defer. |
| `admin_edit_user.html` | `/admin/users/{id}/edit` | `base.html` | none | `target`, `user`, `roles` | POST `/admin/users/{{ target.id }}/edit` | none observed | direct DB update route | linked only from admin UI, but actual route guard is authenticated-only | only active admin page still on legacy Bootstrap base | hybrid | Visual stack mismatch with other admin pages and auth enforcement is weaker than the UI implies. |
| `admin_stats.html` | `/admin/stats` | `base_tailwind.html` | none | `stats`, `user` | none | none observed | route computes counts and role breakdown | admin-only by route | read-only but coupled to route-computed aggregate structure | keep SSR | Can remain SSR until later. |
| `admin_users.html` | `/admin/users` and error re-render from role change route | `base_tailwind.html` | none | `users`, `all_roles`, `user`, `request`, optional `error`, `current_user` | POST `/admin/users/{id}/role`, POST `/admin/users/{id}/delete` | inline toast display of query msg / error; no fetch | depends on `User`, `Role`, duplicate password/edit/delete routes | assumes current user and role list; admin links gated by route | central admin hub with many hardcoded route URLs | typed frontend module | Good early typed module candidate after auth/session. |
| `base.html` | parent for legacy templates, notably `admin_edit_user.html` and older backups | none | none | `user`, `request`, `url_for`, optional `error` | none directly | notification polling via `fetch('/api/notifications')`; `setInterval` every minute | `/api/notifications`, static assets, logout/admin links | checks `'Admin' in user.roles` | global nav and notification behavior coupled to backend URLs and cookie auth | hybrid | Shared layout behavior should move to shell/header service. |
| `base_tailwind.html` | parent for most active pages | none | none | `user`, `request` | none directly | no data fetch observed in layout itself | hardcoded nav links and role-dependent admin section | checks `user.roles` for admin nav | route URLs and role assumptions are embedded in layout | hybrid | Future shell/layout candidate. |
| `chapter_detail.html` | `/projects/{project_id}/chapter/{chapter_id}` | `base_tailwind.html` | none | `project`, `chapter`, `files`, `active_tab`, `user`, `request` | file delete/checkout/cancel forms, upload forms for category tabs | extensive JS: process triggers, sequential checks, structuring modal, `fetch` to `/api/v1/processing/...`, polling to `structuring_status`, redirects to structuring review | depends on `File`, `Project`, `Chapter`, processing routes, checkout routes, upload routes | many processing controls gated by role checks in template | highest UI-backend coupling in repo; combines navigation, storage actions, process orchestration, locks | typed frontend module | Must be decomposed by workflows, not by pure page rewrite. |
| `dashboard.html` | `/dashboard` | `base_tailwind.html` | none | `projects`, `dashboard_stats`, `user`, `request` | no real backend form; modal uses JS-only mock submit | injected project array in JS; mock create/delete; route-based navigation | depends on route-supplied projects and stats only | admin shortcut section shown only for admin users | template is partly prototype and not fully wired to backend | hybrid | Likely replaced rather than incrementally enhanced. |
| `dashboard_New.html` | no active route | none | none | none meaningful | JS-only mock form | dormant prototype JS | none active | hardcoded admin copy | not routed, unclear source of truth | keep SSR | Treat as dormant artifact, not runtime template. |
| `editor.html` | `/files/{file_id}/edit` | `base_tailwind.html` | none | `file`, `filename`, `collabora_url`, `user` | none | no fetch; iframe wrapper only | depends on WOPI and Collabora URL generation | route protects access; template has no extra role logic | thin wrapper but tightly bound to editor integration | keep SSR | Good candidate to remain backend-owned shell. |
| `error.html` | error path from structuring review | `base_tailwind.html` | none | `error_message`, `user` optional | none | none | structuring review fallback | none | generic error display; low coupling | keep SSR | Can remain as shared fallback. |
| `login.html` | `/login` GET and POST error path | none | none | `request`, optional `error` | POST `/login` | none | login route, cookie auth | none | tightly coupled to current cookie-session flow | keep SSR | Good to keep server-rendered at least initially. |
| `projects.html` | `/projects` | `base_tailwind.html` | none | `projects`, `user` | no forms; delete uses JS button | `fetch('/api/v1/projects/${projectId}', { method: 'DELETE' })` | depends on projects SSR route plus API delete route | delete button shown only for admin users | mixes SSR list rendering with API mutation | typed frontend module | Strong candidate for first data-grid style migration. |
| `project_chapters.html` | `/projects/{project_id}` and `/projects/{project_id}/chapters` | `base_tailwind.html` | none | `project`, `chapters`, `user`, `request`; template also references `current_date` | POST chapter delete, POST chapter create, dynamic rename form action | mostly local UI JS and navigation; no fetch observed | depends on chapter CRUD routes and derived chapter flags | delete / create flows assume user can manage project though template has minimal gating | route computes aggregate folder-status flags consumed directly by template | typed frontend module | Needs explicit chapter DTO for frontend migration. |
| `project_create.html` | `/projects/create` | `base_tailwind.html` | none | `user` | POST `/projects/create_with_files`, multipart | local JS only for selected-file list | depends on full SSR project-create workflow | none in template; auth enforced by route | hardcoded client dropdown and upload semantics tied to route behavior | hybrid | Form can remain SSR until typed create API is ready. |
| `register.html` | `/register` GET and POST error path | none | none | `request`, optional `error` | POST `/register` | none | registration route and first-user bootstrap behavior | none | coupled to role bootstrap and direct DB write path | keep SSR | Can stay SSR during Phase 0/1. |
| `structuring_review.html` | `/api/v1/files/{file_id}/structuring/review` | `base_tailwind.html` | none | `file`, `filename`, `collabora_url`, `request`, `user` | no form | only `saveAndExit()` redirect; no active fetch save | depends on export route and WOPI autosave | route/auth guarded; no template role logic | shell behavior is simple but route and WOPI path conventions are critical | hybrid | Keep as backend shell even after modern frontend arrives. |
| `technical_editor_form.html` | `/files/{file_id}/technical/edit` | `base_tailwind.html` | none | `file`, `user` | logical form `#techEditForm` submitted via JS only | fetch scan/apply endpoints, builds full UI dynamically from JSON | depends on technical scan/apply APIs and file/chapter redirect path | permissions enforced by API, not template | already behaves like a mini frontend app | typed frontend module | Excellent early typed-module candidate. |

### JS-heavy template endpoint dependency lists

#### `base.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/api/notifications` | GET | `DOMContentLoaded`, then `setInterval(updateNotifications, 60000)` | JSON array of notification objects: `{title, desc, time, icon, color}` |

#### `chapter_detail.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/projects/files/{file_id}/download` | GET | download links in file cards/lists | binary file response |
| `/projects/files/{file_id}/delete` | POST | delete forms in file cards/lists | `302` back to chapter detail with `?tab={category}&msg=File+Deleted` |
| `/files/{file_id}/edit` | GET | original-editor links | HTML `editor.html` shell |
| `/files/{file_id}/technical/edit` | GET | technical-editor links | HTML `technical_editor_form.html` |
| `/projects/files/{file_id}/checkout` | POST | checkout forms | `302` back to chapter detail with `msg=File+Checked+Out` or `msg=File+Locked+By+Other` |
| `/projects/files/{file_id}/cancel_checkout` | POST | cancel-checkout forms | `302` back to chapter detail with `msg=Checkout+Cancelled` |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | POST | upload forms in category tabs | `302` back to chapter detail with `?tab={category}&msg=Files+Uploaded+Successfully` |
| `/api/v1/processing/files/{file_id}/process/{process_type}` | POST | `runProcess()`, `runReferenceCheckSequence()`, `runAllProcesses()`, `runStructuring()` | success JSON `{message, status:"processing"}`; error JSON usually `{detail}` |
| `/api/v1/processing/files/{file_id}/structuring_status` | GET | `pollStructuringStatus()` every 2 seconds after structuring start | JSON `{status:"processing"}` or `{status:"completed", new_file_id}` |
| `/api/v1/files/{new_file_id}/structuring/review` | GET | redirect after successful structuring polling | HTML `structuring_review.html` shell or `error.html` |

#### `dashboard.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/projects/{project_id}` | GET | clicking project title/card from SSR-injected `projects` array | HTML `project_chapters.html` |
| none (live AJAX) | n/a | mock modal submit/delete handlers | current JS uses no backend fetch; UI shows informational toasts only |

#### `project_chapters.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/projects/{project.id}/chapter/{chapter.id}` | GET | row/card navigation click | HTML `chapter_detail.html` |
| `/projects/{project.id}/chapter/{chapter.id}/download` | GET | chapter download action | ZIP file response |
| `/projects/{project.id}/chapter/{chapter.id}/delete` | POST | delete forms | `302` to `/projects/{project.id}?msg=...` |
| `/projects/{project.id}/chapters/create` | POST | create chapter form | `302` to `/projects/{project.id}?msg=Chapter+Created+Successfully` |
| `/projects/{project.id}/chapter/{id}/rename` | POST | rename modal submit; JS rewrites `form.action` | `302` to `/projects/{project.id}?msg=Chapter+Renamed+Successfully` |

#### `projects.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/projects/{project_id}` | GET | clicking project card | HTML `project_chapters.html` |
| `/projects/create` | GET | "New Project" and empty-state link | HTML `project_create.html` |
| `/api/v1/projects/{project_id}` | DELETE | `deleteProject(event, projectId, projectTitle)` | success JSON `{"message":"Project deleted successfully"}`; failure JSON usually `{"detail":...}` |

#### `structuring_review.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/api/v1/files/{file_id}/structuring/review/export` | GET | Export button | processed DOCX file response |
| `/projects/{file.project_id}/chapter/{file.chapter_id}?tab=Manuscript` | GET | `saveAndExit()` navigation | HTML `chapter_detail.html` |
| `/wopi/files/{file_id}/structuring` | GET | Collabora iframe bootstrap via `collabora_url` | WOPI metadata JSON |
| `/wopi/files/{file_id}/structuring/contents` | GET / POST | Collabora document load/autosave | DOCX bytes on GET; empty `200` on successful POST |

#### `technical_editor_form.html`

| Endpoint | Method | Trigger | Expected response shape |
|---|---|---|---|
| `/api/v1/processing/files/{file_id}/technical/scan` | GET | `DOMContentLoaded` -> `fetchScanResults()` | JSON object keyed by issue id; each value typically includes `label`, `count`, `found`, `options`, optional `category` |
| `/api/v1/processing/files/{file_id}/technical/apply` | POST | `submitEdits()` after user chooses replacements | success JSON `{status:"completed", new_file_id}`; error JSON usually `{detail}` |
| `/projects/{file.project_id}/chapter/{file.chapter_id}` | GET | Cancel link and post-apply redirect | HTML `chapter_detail.html` |

### Dormant / backup templates in `app/templates`

These files are present in the repository but are not rendered by active route inventory.

| Template | Active counterpart / status | Current routes rendering it | Parent layout | Notes | Migration target |
|---|---|---|---|---|---|
| `activities.html.bak` | legacy backup of `activities.html` | none observed | `base.html` | archival legacy Bootstrap version | keep SSR |
| `admin_change_password.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `admin_create_user.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `admin_dashboard.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `admin_stats.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `admin_users.html.bak` | legacy backup of active template | none observed | `base.html` | contains status form no longer present in active template | keep SSR |
| `chapter_detail.html.bak` | legacy backup of active template | none observed | `base.html` | older Bootstrap variant of highest-coupling page | keep SSR |
| `dashboard.html.bak` | legacy backup of `dashboard.html` | none observed | none explicit | old prototype/mock behavior | keep SSR |
| `login.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `project_chapters.html.bak` | legacy backup of active template | none observed | `base.html` | older chapter management UI | keep SSR |
| `register.html.bak` | legacy backup of active template | none observed | `base.html` | archival | keep SSR |
| `structuring_review.html.bak` | backup of review UI | none observed | none explicit | older version appears to have direct save fetch logic | keep SSR |

## 3. Workflow Inventory

### Login

- Entry route/template: `GET /login` -> `login.html`.
- User actions: enter username/password and submit.
- Backend route sequence: `GET /login` -> `POST /login` -> redirect `/dashboard` on success or re-render `login.html` on failure.
- Database writes: none on successful login; DB read from `User`.
- Filesystem writes: none.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect + `access_token` cookie, or inline error.
- Failure points: invalid password, missing user, unexpected exception.
- Migration sensitivity: high because cookie session semantics are reused across nearly all SSR routes.

### Logout

- Entry route/template: any page linking to `GET /logout`.
- User actions: click logout.
- Backend route sequence: `GET /logout` -> delete cookie -> redirect `/login`.
- Database writes: none.
- Filesystem writes: none.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect to login.
- Failure points: minimal.
- Migration sensitivity: medium; must preserve cookie cleanup and redirect behavior.

### Register

- Entry route/template: `GET /register` -> `register.html`.
- User actions: fill username/email/password/confirm and submit.
- Backend route sequence: `GET /register` -> `POST /register`.
- Database writes: creates `User`; may create full default role set if roles do not exist; assigns first user to Admin else Viewer.
- Filesystem writes: none.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect to login with success query message or re-render with error.
- Failure points: password mismatch, duplicate username/email, role bootstrap issues.
- Migration sensitivity: high because of hidden bootstrap side effect on first user.

### Dashboard / Projects

- Entry route/template: `GET /dashboard` -> `dashboard.html`; `GET /projects` -> `projects.html`.
- User actions: navigate, inspect stats, open project, delete project from projects list.
- Backend route sequence: `GET /dashboard`, `GET /projects`, optional JS `DELETE /api/v1/projects/{id}`.
- Database writes: delete API removes `Project`, `Chapter`, `File`, `FileVersion` records.
- Filesystem writes: none for API delete route; SSR project delete route removes project folder but is not used by active projects page.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: HTML list pages; JSON delete result.
- Failure points: mismatch between API delete behavior and SSR delete behavior, stale dashboard mock actions.
- Migration sensitivity: medium-high due contract drift and dual delete paths.

### Project creation

- Entry route/template: `GET /projects/create` -> `project_create.html`.
- User actions: fill project metadata, choose chapter count, upload optional initial files, submit.
- Backend route sequence: `POST /projects/create_with_files`.
- Database writes: creates `Project`, multiple `Chapter` rows, optional `File` rows.
- Filesystem writes: creates `UPLOAD_DIR/{code}`, chapter/category folders, writes uploaded files.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect to `/dashboard`.
- Failure points: schema drift around `client_name`, filename-to-chapter inference mistakes, partial writes if upload loop fails.
- Migration sensitivity: very high because project creation bundles entity creation and storage layout initialization.

### Chapter creation

- Entry route/template: chapter creation form in `project_chapters.html`.
- User actions: submit new chapter number/title.
- Backend route sequence: `POST /projects/{project_id}/chapters/create`.
- Database writes: inserts `Chapter`.
- Filesystem writes: creates chapter folder and category subfolders.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect back to project chapter list with query message.
- Failure points: duplicate chapter numbers, DB/storage drift if directory creation fails after DB commit.
- Migration sensitivity: high because route owns both DB and filesystem structure.

### File upload and versioning

- Entry route/template: upload modals/forms in `chapter_detail.html`.
- User actions: choose category, select one or more files, submit.
- Backend route sequence: `POST /projects/{project_id}/chapter/{chapter_id}/upload`.
- Database writes: inserts new `File` rows or `FileVersion` rows and updates existing `File.version`, lock fields, timestamps.
- Filesystem writes: writes new files, copies replaced file into `Archive/`, overwrites existing file path in-place.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect back to chapter tab with success message.
- Failure points: lock conflicts, skipped files when locked by another user, archive copy failures, inconsistent DB/file version state.
- Migration sensitivity: very high; this is one of the most fragile workflows in the repo.

#### Concrete overwrite versioning examples

| Scenario | Original file path | Archive file path | Current file version before -> after | `FileVersion` rows before -> after | Lock state before -> after |
|---|---|---|---|---|---|
| Overwrite succeeds on same file path | `UPLOAD_DIR/BOOK100/01/Manuscript/chapter01.docx` | `UPLOAD_DIR/BOOK100/01/Manuscript/Archive/chapter01_v3.docx` | `3 -> 4` | no row for version `3` -> new row `{file_id=<same>, version_num=3, path=.../Archive/chapter01_v3.docx, uploaded_by_id=<current user>}` | `locked by current user` or `unlocked` -> forcibly `unlocked` (`is_checked_out=False`, `checked_out_by_id=None`) |
| Overwrite attempt while locked by another user | same original path | none written | unchanged | unchanged | `locked by other user` -> unchanged; route silently skips file and still ends with success redirect if loop completes |

Expanded example for the successful overwrite case:
- Before request:
  - `File.path = UPLOAD_DIR/BOOK100/01/Manuscript/chapter01.docx`
  - `File.version = 3`
  - `File.is_checked_out = True` and `checked_out_by_id = current user` or `False/None`
  - `FileVersion` rows exist only for older versions such as `1` and `2`
- Filesystem side effects during overwrite:
  - current bytes at `.../chapter01.docx` are copied to `.../Archive/chapter01_v3.docx`
  - uploaded bytes overwrite `.../chapter01.docx` in place
- After request:
  - `File.version = 4`
  - new `FileVersion(version_num=3, path=.../Archive/chapter01_v3.docx)` exists
  - `File.uploaded_at` is refreshed
  - `File.is_checked_out = False`
  - `File.checked_out_by_id = None`

### Checkout / lock / cancel checkout

- Entry route/template: checkout/cancel buttons in `chapter_detail.html`.
- User actions: lock file for editing or release own lock.
- Backend route sequence: `POST /projects/files/{file_id}/checkout` or `POST /projects/files/{file_id}/cancel_checkout`.
- Database writes: updates `File.is_checked_out`, `checked_out_by_id`, `checked_out_at`.
- Filesystem writes: none.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirect to chapter page with status message.
- Failure points: concurrent lock race, stale locks, redirect-based status only.
- Migration sensitivity: very high because processing and upload flows assume this state.

### File Lock State Model

| State / transition outcome | Persisted fields | Entry conditions | Exit conditions / next transitions | Current user-visible behavior |
|---|---|---|---|---|
| `unlocked` | `is_checked_out=False`, `checked_out_by_id=None`, `checked_out_at` often `None` | fresh file upload, post-cancel-checkout, post-overwrite upload, post-processing unlock | checkout by any user; overwrite by uploader; processing trigger locks it | checkout button available; no lock warning |
| `locked by current user` | `is_checked_out=True`, `checked_out_by_id=<current user id>`, `checked_out_at=<timestamp>` | `POST /projects/files/{file_id}/checkout` by current user; `POST /api/v1/processing/files/{file_id}/process/{process_type}` when file was previously unlocked | cancel checkout by same user; overwrite upload on same file; background processing completion/failure | file appears checked out but same user can continue processing or overwrite |
| `locked by other user` | `is_checked_out=True`, `checked_out_by_id=<different user id>`, `checked_out_at=<timestamp>` | another user checked out file first or processing route locked it for that user | current owner cancels checkout; background processing completion/failure if lock came from processing | checkout route redirects with `msg=File+Locked+By+Other`; upload overwrite silently skips this file |
| `unlocked by overwrite upload` | route forcibly resets lock fields after overwrite | existing file is overwritten in `upload_chapter_files` and lock either belonged to current user or file was previously unlocked | can be checked out again immediately after redirect | user sees success redirect with `msg=Files+Uploaded+Successfully`; no explicit lock-release message |
| `unlocked by processing success` | background task sets `is_checked_out=False`, `checked_out_by_id=None`, `checked_out_at=None` before commit | any successful background processing path after generated files are registered | next checkout / processing cycle | user only sees it indirectly after page reload or successful structuring redirect |
| `unlocked by processing failure` | background task `except` block clears `is_checked_out` and `checked_out_by_id` before commit | engine throws during `background_processing_task` | next checkout / processing cycle | no dedicated error state route; unlock is silent and must be inferred from refreshed page state/logs |

### Processing trigger

- Entry route/template: process action menus in `chapter_detail.html`.
- User actions: choose process type or run grouped checks.
- Backend route sequence: JS `POST /api/v1/processing/files/{file_id}/process/{process_type}`.
- Database writes: lock file, create `FileVersion` backup row, increment `File.version`, create new `File` rows for generated artifacts.
- Filesystem writes: archive backup copy, generated output files.
- Background tasks: FastAPI `BackgroundTasks` -> `background_processing_task`.
- External integrations: processing engines, AI structuring client, legacy tools, style injection helper.
- Outputs returned to user: JSON `{status:"processing"}`.
- Failure points: permission mismatch, missing file, backup failure, engine failure, unlock on error only.
- Migration sensitivity: extremely high; this is the central orchestration workflow.

### Processing status polling

- Entry route/template: structuring mode in `chapter_detail.html`.
- User actions: after triggering structuring, page polls until completion.
- Backend route sequence: repeated `GET /api/v1/processing/files/{file_id}/structuring_status`.
- Database writes: none.
- Filesystem writes: none.
- Background tasks: none directly; depends on prior background process.
- External integrations: none directly.
- Outputs returned to user: JSON `processing` or `completed` with `new_file_id`.
- Failure points: status is inferred from naming convention and presence of DB row, not a persisted job table.
- Migration sensitivity: high because current UX depends on polling by convention.

### Technical editor

- Entry route/template: `GET /files/{file_id}/technical/edit` -> `technical_editor_form.html`.
- User actions: page auto-scans file, user selects replacements, clicks apply.
- Backend route sequence: `GET /files/{id}/technical/edit` -> JS `GET /api/v1/processing/files/{id}/technical/scan` -> JS `POST /api/v1/processing/files/{id}/technical/apply`.
- Database writes: create new `File` row for `_TechEdited` output.
- Filesystem writes: writes `_TechEdited` file.
- Background tasks: none.
- External integrations: `TechnicalEditor` document-processing logic.
- Outputs returned to user: dynamic form UI, then JSON completion and redirect back to chapter.
- Failure points: scan failure, apply failure, output file generation failure.
- Migration sensitivity: high but well-bounded; good candidate for early typed frontend extraction.

### Structuring review

- Entry route/template: redirect from chapter detail polling to `GET /api/v1/files/{file_id}/structuring/review`.
- User actions: open processed document, edit in Collabora, export, save and exit.
- Backend route sequence: review page -> iframe points to WOPI endpoints -> optional export route.
- Database writes: none from review page itself.
- Filesystem writes: review route reads processed path; WOPI save endpoints overwrite processed file bytes.
- Background tasks: none.
- External integrations: Collabora Online, WOPI.
- Outputs returned to user: HTML shell page, exported DOCX on request.
- Failure points: missing `_Processed` file, Collabora unavailable, WOPI path/config mismatch.
- Migration sensitivity: extremely high because editor integration is URL- and file-path-sensitive.

### WOPI / Collabora editing

- Entry route/template: `GET /files/{file_id}/edit` or structuring review page.
- User actions: edit document in Collabora iframe.
- Backend route sequence: editor page -> `GET /wopi/files/{id}` -> `GET /wopi/files/{id}/contents` -> repeated `POST /wopi/files/{id}/contents`; structuring variant uses `/structuring` endpoints.
- Database writes: none.
- Filesystem writes: raw overwrite of original or `_Processed` file bytes.
- Background tasks: none.
- External integrations: Collabora Online, reverse proxy, WOPI spec.
- Outputs returned to user: live editor experience, autosaved file.
- Failure points: no auth on WOPI endpoints, file not found, proxy/Collabora config drift.
- Migration sensitivity: extremely high; should remain backend-owned until late.

### Admin user management

- Entry route/template: `/admin/users`, `/admin/users/create`, `/admin/users/{id}/edit`, `/admin/users/{id}/password`.
- User actions: create users, change roles, edit email, change password, delete users.
- Backend route sequence: multiple GET/POST SSR routes under `/admin/users/*`.
- Database writes: creates `User`, updates roles/status/email/password, deletes users.
- Filesystem writes: none.
- Background tasks: none.
- External integrations: none.
- Outputs returned to user: redirects or template re-renders with errors.
- Failure points: duplicate password/delete route definitions, last Admin protection only on role change route, inconsistent template context names.
- Migration sensitivity: medium-high; multiple flows but lower storage risk than chapter/file workflows.

## 4. Auth and Session Map

- Cookie-based authentication flows:
  - `POST /login` creates JWT via `create_access_token()` and stores it in `access_token` cookie prefixed with `Bearer`.
  - `get_current_user_from_cookie()` reads the cookie, strips `Bearer ` if present, decodes JWT, and loads `User`.
  - Almost all SSR routes in `web.py`, `processing.py`, `structuring.py`, and `wopi.py` use cookie auth.
- Bearer-token authentication flows:
  - `OAuth2PasswordBearer(tokenUrl="/api/v1/users/login")` is defined in `app/auth.py`.
  - `/api/v1/users/login` returns bearer token JSON.
  - `/api/v1/users/me`, `/api/v1/teams/*`, `/api/v1/files/`, `GET /api/v1/projects/`, and project role-guard APIs use bearer auth.
- Mixed authentication flows:
  - Project delete API uses cookie auth while create/list/status APIs use bearer auth.
  - Structuring review is served under `/api/v1/...` but authenticated with cookie and renders HTML.
  - `projects.html` calls cookie-authenticated API delete; `dashboard.html` is SSR but mock-oriented.
- Token creation and storage:
  - Token created only in `create_access_token`.
  - Web flow stores token in cookie; API flow returns token in JSON.
  - No refresh token flow was found.
- Token usage across routers:
  - `web.py`, `processing.py`, `structuring.py`, `wopi.py`: cookie.
  - `users.py`, `teams.py`, `files.py`, parts of `projects.py`: bearer.
- CORS configuration:
  - FastAPI app uses `allow_origins=["*"]`, `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`.
  - This is permissive and unusual with credentialed requests.
- CSRF protections:
  - No CSRF tokens or origin checks were found in SSR form routes.
  - Forms rely entirely on cookie auth and route guards.
- Role / permission enforcement points:
  - Inline string checks in `web.py` for Admin access.
  - `require_role()` in `rbac.py` for some API routes.
  - `PROCESS_PERMISSIONS` map + `check_permission()` in `processing.py`.
  - Template-side gating also hides or shows actions based on `user.roles`.
- Auth enforcement gaps discovered during refinement:
  - `DELETE /api/v1/projects/{project_id}` depends on `get_current_user_from_cookie` but does not reject `user=None`, so anonymous callers can currently reach the delete service.
  - `/admin/users/{id}/edit` GET/POST and `/admin/users/{id}/delete` POST are linked from admin UI but only enforce a truthy cookie user, not Admin role membership.
  - WOPI `CheckFileInfo`, `GetFile`, and `PutFile` endpoints are unauthenticated by route design.
  - Shadowed second password-change routes are weaker on auth than the active first password-change routes; route-order drift would change enforcement.
- Implications for frontend migration:
  - Session model must be normalized before broad frontend rollout.
  - Any new frontend must handle both SSR cookie expectations and bearer-auth APIs or consolidate them behind a compatible session API.
  - CSRF absence matters if the new frontend continues cookie-authenticated mutation requests.

## 5. Background Execution Map

- FastAPI `BackgroundTasks` usage:
  - Only the CMS processing trigger route uses `BackgroundTasks`.
  - `run_file_process()` dispatches `background_processing_task()` and returns immediately with JSON `status=processing`.
- Celery usage in CMS:
  - `app/core/celery_app.py` defines a Celery app and `app/worker.py` defines `process_document`.
  - No active FastAPI route dispatches to this worker in the CMS processing path.
  - Current CMS runtime model is therefore split between defined Celery infrastructure and actual BackgroundTasks execution.
- `ai_structuring_backend` queue usage:
  - Separate Flask service with `Batch` and `Job` persistence.
  - `QueueService` can run in `threading` or `celery` mode.
  - This is distinct from CMS BackgroundTasks and is used via `app/services/ai_structuring_client.py`.
- Job status tracking:
  - CMS processing does not persist job rows. Structuring status is inferred by existence of a processed `File` record with naming convention.
  - AI structuring backend persists queue/job states, output paths, token usage, timings, and failures in database tables.
- Polling endpoints:
  - CMS: `/api/v1/processing/files/{file_id}/structuring_status`.
  - AI service: multiple queue status endpoints under `/api/queue/*` in Flask service.
- Retry or failure handling:
  - CMS processing unlocks files on failure and logs exceptions; no retry mechanism.
  - AI structuring backend supports job/batch retry endpoints and structured failure reporting.
- Persistence of job states:
  - CMS: no durable job table for local processing.
  - AI service: durable `Batch` and `Job` persistence.

## 6. Dependency and Integration Map

- DB models by router / workflow:
  - `web.py`: `User`, `Role`, `UserRole`, `Project`, `Chapter`, `File`, `FileVersion`.
  - `projects.py`: `Project`, plus `Chapter`, `File`, `FileVersion` through delete service.
  - `files.py`: `File`.
  - `processing.py`: `File`, `FileVersion`, `Project`, `Chapter`, `User`.
  - `structuring.py`: `File`.
  - `wopi.py`: `File`.
  - `users.py`: `User`, `Role`.
  - `teams.py`: `Team`.
- Filesystem path usage:
  - Runtime root from `CMS_RUNTIME_ROOT`, default `/opt/cms_runtime`.
  - Upload root `UPLOAD_DIR = /opt/cms_runtime/data/uploads`.
  - Project creation writes `/{project_code}/{chapter_number}/{category}/filename`.
  - Chapter creation precreates category folders.
  - Versioning writes archive copies to `Archive/`.
  - Processing backup also writes to `Archive/`.
  - Structuring review/WOPI derive `_Processed.docx` beside source document.
  - Technical editor writes `_TechEdited.docx` beside source document.
- Versioning / archive behavior:
  - Upload overwrite path archives current file to `Archive/{name}_v{N}.{ext}`, creates `FileVersion`, overwrites current path, increments `File.version`, releases lock.
  - Processing trigger separately creates an archive backup and `FileVersion` before running engine.
- Processing engine wrappers:
  - `PermissionsEngine`
  - `PPDEngine`
  - `TechnicalEngine`
  - `ReferencesEngine`
  - `StructuringEngine`
  - `BiasEngine`
  - `AIExtractorEngine`
  - `XMLEngine`
- Processing type output map:

| Processing type | Engine / path | Output filename convention | Creates new `File` row(s)? | Mutates original in place? | Expected chapter / category placement | Polled / reviewed / exported / direct-download behavior |
|---|---|---|---|---|---|---|
| `language` | no engine branch in `background_processing_task` | none; background task falls into unsupported-process error | no generated output rows | no intended mutation beyond pre-run backup/version bump | n/a | not polled; not reviewed; user gets initial `"processing"` JSON even though background task later fails |
| `technical` | `TechnicalEngine.process_document()` | `{base}_TechnicallyEdited.docx` | yes, one new `File` row if output exists | no | same chapter and same `category` as source file; output written beside source document | direct download / open from chapter page after reload |
| `macro_processing` | `ReferencesEngine` with structuring + numeric + APA flags all enabled | may emit `{base}_fixed.docx`, `{base_or_base_fixed}_Val.docx`, `{base_or_base_fixed_or_val}_NY.docx`, `{original_base}_ReferenceReport.txt` | yes, one `File` row per generated path returned | no deliberate in-place source mutation | same chapter and same `category` as source file; outputs written beside source file | direct download only; no poll/review/export route |
| `reference_validation` | same `ReferencesEngine` flags as `macro_processing` | same as `macro_processing` | yes | no | same chapter/category as source | direct download only |
| `reference_number_validation` | `ReferencesEngine` numeric validation only | `{base}_Val.docx` when issues/citations exist, plus `{original_base}_ReferenceReport.txt` | yes | no | same chapter/category as source | direct download only |
| `reference_apa_chicago_validation` | `ReferencesEngine` APA validation only | `{base}_NY.docx` plus `{original_base}_ReferenceReport.txt` | yes | no | same chapter/category as source | direct download only |
| `reference_report_only` | `ReferencesEngine` with `report_only=True` | always `{original_base}_ReferenceReport.txt`; may also emit `{base}_Val.docx` from numeric-validation stage | yes for every returned artifact | no | same chapter/category as source | direct download only |
| `reference_structuring` | `ReferencesEngine` structuring only | `{base}_fixed.docx`; legacy structuring may also return a log file | yes | no | same chapter/category as source | direct download only |
| `structuring` | `StructuringEngine.process_document()` | `{base}_Processed.docx` | yes, one new `File` row | no, engine writes processed sibling file | same chapter/category as source; processed file sits beside original | explicitly polled via `structuring_status`, reviewed in `structuring_review`, exportable via `/structuring/review/export`, then edited further through WOPI autosave |
| `bias_scan` | `BiasEngine.process_document()` | highlighted DOCX in `bias_output/{original_filename}`, `bias_output/{base}_BiasReport.xlsx`, `{base}_BiasScan.zip` | yes, one row per generated artifact | no | registered back into the same chapter/category as source, even though some artifacts are under `bias_output/` subfolder | direct download only |
| `permissions` | `PermissionsEngine.process_document()` | `{base}_PermissionsLog.xlsx` | yes | no | same chapter/category as source | direct download only |
| `credit_extractor_ai` | `AIExtractorEngine.process_document()` | `{base}_AIPermissionsLog.xlsx` | yes | no | same chapter/category as source | direct download only |
| `ppd` | `PPDEngine.process_document()` | `{base}_MSS_Anaylsis_Dashboard.html` and corresponding `.xls` export | yes, for generated HTML/XLS artifacts | yes; tag-removal step modifies the source DOCX in place before dashboard generation | same chapter/category as source; dashboard artifacts written beside source file | direct download only |
| `word_to_xml` | `XMLEngine.process_document()` | `html/{base}.xml` under the source folder | yes, one new `File` row for XML output | no explicit source mutation in engine wrapper | same chapter/category as source in DB; physical output lives under `html/` subfolder | direct download only |

  Separate technical-editor flow note:
  - `POST /api/v1/processing/files/{file_id}/technical/apply` is not a `process_type` branch of `background_processing_task`.
  - It writes `{base}_TechEdited.docx` and a new `File` row synchronously, which is a different filename convention from background `process/technical` (`_TechnicallyEdited.docx`).
- AI structuring service calls:
  - `StructuringEngine` can call `AIStructuringClient`, which submits a batch to the Flask queue API, polls status, downloads zip output, and extracts processed docx.
- WOPI / Collabora integration points:
  - `edit_file_page()` and `review_structuring()` build iframe URLs to Collabora `cool.html`.
  - WOPI endpoints under `/wopi/files/...` serve metadata and file bytes.
  - Structuring review uses separate WOPI mode for `_Processed` file.
- External tool dependencies:
  - Dockerfile installs LibreOffice Writer, Java, Perl, CPAN modules, libxml/xslt tooling, and build dependencies.
  - These are required by bias scan, reference tooling, and Word-to-XML pipeline.
- Reverse proxy dependencies:
  - Nginx proxies normal CMS traffic to FastAPI and `/hosting`, `/browser`, `/coolws`, `/cool` to Collabora.
  - Collabora configuration depends on `WOPI_BASE_URL`, `COLLABORA_URL`, `COLLABORA_PUBLIC_URL`, and Docker host alias configuration.

## 7. Risk Register

| Route / workflow | Why risky | Behaviors that must be preserved | Hidden side effects | Extract first | Must not change early | Recommended migration target | Tests required before touching |
|---|---|---|---|---|---|---|---|
| `create_project_with_files` | Bundles project/chapter/file creation and storage layout | project row, chapters, chapter numbering, category inference, redirect behavior | default `team_id=1`, filename regex chapter assignment, `client_name` post-update | project aggregate service, storage layout helper | chapter/file path conventions | typed frontend module | integration test for project create with files across categories |
| `upload_chapter_files` | Versioning and overwrite semantics are business-critical | lock checks, archive naming, `FileVersion` row, version increment, auto check-in | silently skips files locked by another user | file storage service, versioning service, lock service | archive naming and overwrite path | typed frontend module | upload new file, overwrite unlocked file, overwrite locked file, archive copy assertions |
| `run_file_process` | Central processing orchestrator with many engines | permission map, lock behavior, backup, generated file registration, unlock on completion/failure | version increment happens before background work; backup failures are logged but not blocking | processing orchestration service, job abstraction | engine wrappers and output registration rules | API-only | per-process integration tests and failure-path tests |
| `check_structuring_status` | UX depends on inferred status with no durable job state | completed vs processing behavior, redirect to new file id | status is inferred by naming convention only | processing status service | `_Processed` naming convention until replacement exists | API-only | polling tests around absent/present processed file rows |
| `checkout_file` / `cancel_checkout` | Locks are reused by upload and processing | self-lock, other-user rejection, redirect messages | no stale-lock cleanup | lock service | file lock fields and redirect targets | typed frontend module | concurrent lock behavior tests |
| `technical editor workflow` | Dynamic UI and file creation side effects | scan data shape, apply creates new file record, redirect to chapter | output filename convention `_TechEdited` | technical editing service, typed scan/apply schemas | `TechnicalEditor` logic | typed frontend module | scan/apply tests on representative DOCX files |
| `structuring review` | Thin shell around processed file and editor integration | processed-file resolution, export, save-and-exit redirects | current active page does not call save API; autosave relies on WOPI | review service, WOPI URL builder | `_Processed` file location and WOPI endpoints | hybrid | review page smoke test plus export path test |
| `WOPI PutFile` routes | Raw editor save path | successful overwrite of original/processed docx | no user auth, no lock enforcement in WOPI route | WOPI gateway wrapper | WOPI URL schema and byte-write behavior | API-only | end-to-end edit/save smoke test with Collabora test harness or byte-level contract tests |
| `admin role change` | Security-critical | last Admin cannot be removed, role replacement semantics | replaces all roles with one selected role | admin user service | last-admin guard | typed frontend module | tests for last-admin protection and role replacement |
| `projects delete paths` | Two delete implementations differ | user-visible delete behavior, DB cleanup, folder cleanup | API delete leaves project folder behind; SSR delete removes folder | deletion service | current delete endpoints until unified | API-only / typed frontend module | tests for DB cleanup and filesystem cleanup parity |
| `duplicate admin password routes` | Two handlers declare the same GET and POST paths with different auth and validation logic | whichever handler currently owns runtime order, plus active template context contract (`target_user`) | first POST accepts short passwords; shadowed second POST would reject them and emit different redirect/query-msg behavior | password service boundary and route contract tests | current registration order and template field names | hybrid | tests for active GET/POST runtime owner, redirect target, and short-password behavior |
| `duplicate chapter delete routes` | Same path declared twice with different redirect message and slightly different existence checks | current redirect message `Chapter Deleted Successfully`, directory removal, DB delete | second duplicate would change visible message to `Chapter Deleted` and relax project existence check if activated | chapter deletion helper and route-order regression tests | current delete path and redirect message contract | typed frontend module | tests for active runtime owner and exact redirect `msg` |
| `root route duplication` | Browser entrypoint and API welcome route share `/` | current browser redirect behavior from `web.home` | changing registration order exposes JSON API root to browsers instead of login/dashboard redirect | app bootstrap / shell routing tests | current include order (`web.router` before `app.main.read_root`) | keep SSR | tests for `/` redirect behavior with and without cookie |

## 8. Inventory Summary

### Top 15 most critical routes

1. `POST /projects/create_with_files`
2. `POST /projects/{project_id}/chapter/{chapter_id}/upload`
3. `POST /api/v1/processing/files/{file_id}/process/{process_type}`
4. `GET /api/v1/processing/files/{file_id}/structuring_status`
5. `POST /projects/files/{file_id}/checkout`
6. `POST /projects/files/{file_id}/cancel_checkout`
7. `GET /projects/{project_id}/chapter/{chapter_id}`
8. `GET /api/v1/files/{file_id}/structuring/review`
9. `POST /wopi/files/{file_id}/contents`
10. `POST /wopi/files/{file_id}/structuring/contents`
11. `GET /files/{file_id}/technical/edit`
12. `POST /api/v1/processing/files/{file_id}/technical/apply`
13. `DELETE /api/v1/projects/{project_id}`
14. `POST /admin/users/{user_id}/role`
15. `POST /login`

### Top 10 most coupled templates

1. `chapter_detail.html`
2. `technical_editor_form.html`
3. `projects.html`
4. `dashboard.html`
5. `project_chapters.html`
6. `admin_users.html`
7. `structuring_review.html`
8. `base.html`
9. `base_tailwind.html`
10. `project_create.html`

### Top 10 highest-risk workflows

1. Project creation
2. File upload and versioning
3. Processing trigger
4. Processing status polling
5. Checkout / lock / cancel checkout
6. Structuring review
7. WOPI / Collabora editing
8. Technical editor
9. Project deletion
10. Admin role management

### Top 10 service-layer extraction candidates

1. Auth / session service
2. Admin user management service
3. Project aggregate service
4. Chapter management service
5. File storage service
6. File versioning / archive service
7. File lock service
8. Processing orchestration service
9. Technical editing service facade
10. Structuring review / WOPI gateway service

### Open unknowns discovered during analysis

- Whether API delete or SSR delete is considered the authoritative project-deletion behavior.
- Whether the shadowed validated password-change handler is intended to replace the current runtime owner, despite its incompatible `target` template context.
- Whether `toggle_user_status` is intentionally orphaned from the active `admin_users.html`.
- Whether `dashboard.html` is intended to be production UI or a partially wired prototype.
- Whether dormant templates such as `dashboard_New.html` are still relevant or safe to remove later.
- Whether CMS processing should remain `BackgroundTasks`-based or move to durable job persistence.
- How WOPI endpoints are secured in deployment, since route-level auth is absent.
- Whether archive/version semantics are relied on by downstream operational processes outside the app.
- Whether anonymous callers are intentionally allowed to reach `DELETE /api/v1/projects/{project_id}` because the cookie dependency result is unused.
- Whether authenticated non-admin users are intentionally allowed to hit `/admin/users/{id}/edit` and `/admin/users/{id}/delete` because those routes only check for a truthy cookie user.
