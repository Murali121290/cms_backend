# Router Layer

Related docs:

- [Backend Architecture](backend_architecture.md)
- [Service Layer](service_layer.md)
- [Security Model](security_model.md)
- [Known Constraints](known_constraints.md)

## Router Layer Overview

Routers live under [`app/routers/`](../../app/routers). They expose three broad interface types:

- SSR routes that render Jinja templates from [`app/templates/`](../../app/templates)
- JSON/file endpoints under `/api/v1/...`
- WOPI integration endpoints used by Collabora

## Router Summary

| Router | Primary responsibility | Auth model | Response modes |
| --- | --- | --- | --- |
| [`web.py`](../../app/routers/web.py) | Browser-facing SSR pages, cookie-backed actions, notifications, activities | Cookie auth for most routes | HTML, redirects, JSON, file |
| [`users.py`](../../app/routers/users.py) | Bearer-compatible user API | Bearer auth or anonymous login/create | JSON |
| [`teams.py`](../../app/routers/teams.py) | Team API | Bearer auth | JSON |
| [`projects.py`](../../app/routers/projects.py) | Compatibility project API | Mixed bearer and cookie auth | JSON |
| [`files.py`](../../app/routers/files.py) | Compatibility flat upload API | Bearer auth | JSON |
| [`processing.py`](../../app/routers/processing.py) | Processing start, status, technical scan/apply | Cookie auth | JSON |
| [`structuring.py`](../../app/routers/structuring.py) | Structuring review, save, export | Cookie auth | HTML, JSON, file |
| [`wopi.py`](../../app/routers/wopi.py) | Editor shell and WOPI callbacks | Mixed: editor shell requires cookie auth, callbacks do not | HTML, JSON, file, empty `200` |

## `app/routers/web.py`

`web.py` is still the main SSR router. It now delegates many workflows to services, but it still contains some inline read-side and page-rendering logic.

### Auth and landing routes

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/` | `GET` | Browser home redirect | Cookie auth optional | Redirect | `session_service.get_home_redirect_response` |
| `/login` | `GET` | Render login page | None | `login.html` | Template only |
| `/login` | `POST` | Browser login submit | None | Redirect or `login.html` | `auth_service.authenticate_browser_user`, `session_service.build_login_redirect_response` |
| `/logout` | `GET` | Clear cookie and redirect | None | Redirect | `session_service.build_logout_response` |
| `/register` | `GET` | Render register page | None | `register.html` | Template only |
| `/register` | `POST` | Browser registration submit | None | Redirect or `register.html` | `auth_service.register_browser_user`, `session_service.build_registration_success_response` |

### Main SSR read pages

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `GET` | Dashboard | Cookie auth | `dashboard.html` | `dashboard_service.get_dashboard_page_data` |
| `/projects` | `GET` | Projects list | Cookie auth | `projects.html` | `project_read_service.get_projects_page_data` |
| `/projects/create` | `GET` | Render create project page | Cookie auth | `project_create.html` | Inline user context |
| `/projects/{project_id}` | `GET` | Project chapters page alias | Cookie auth | `project_chapters.html` | `project_read_service.get_project_chapters_page_data` |
| `/projects/{project_id}/chapters` | `GET` | Project chapters page | Cookie auth | `project_chapters.html` | Same handler as alias |
| `/projects/{project_id}/chapter/{chapter_id}` | `GET` | Chapter detail | Cookie auth | `chapter_detail.html` | `project_read_service.get_chapter_detail_page_data` |
| `/activities` | `GET` | Recent activity feed | Cookie auth | `activities.html` | `activity_service.get_recent_activities` |
| `/files/{file_id}/technical/edit` | `GET` | Technical editor page shell | Cookie auth | `technical_editor_form.html` | Inline file lookup |

### Project and chapter mutations

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/projects/create_with_files` | `POST` | Project bootstrap with initial files | Cookie auth | Redirect or `project_create.html` | `project_service.create_project_with_initial_files` |
| `/projects/{project_id}/chapters/create` | `POST` | Create chapter | Cookie auth | Redirect | `chapter_service.create_chapter` |
| `/projects/{project_id}/chapter/{chapter_id}/rename` | `POST` | Rename chapter | Cookie auth | Redirect | `chapter_service.rename_chapter` |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | `POST` | Primary delete route | Cookie auth | Redirect | `chapter_service.delete_chapter_primary` |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | `POST` | Secondary duplicate delete route | Cookie auth | Redirect | `chapter_service.delete_chapter_secondary` |
| `/projects/{project_id}/delete` | `POST` | Delete project and project directory | Cookie auth | Redirect | `project_service.delete_project_with_filesystem` |
| `/projects/{project_id}/chapter/{chapter_id}/download` | `GET` | Download chapter ZIP | Cookie auth | File | Inline ZIP creation |

### File workflows

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | `POST` | Upload files into chapter category | Cookie auth | Redirect | `file_service.upload_chapter_files` |
| `/projects/files/{file_id}/download` | `GET` | Download file bytes | Cookie auth | File | `file_service.get_file_for_download` |
| `/projects/files/{file_id}/delete` | `POST` | Delete file row and disk file | Cookie auth | Redirect | `file_service.delete_file_and_capture_context` |
| `/projects/files/{file_id}/checkout` | `POST` | Lock file for current user | Cookie auth | Redirect | `checkout_service.checkout_file` |
| `/projects/files/{file_id}/cancel_checkout` | `POST` | Unlock if owned by current user | Cookie auth | Redirect | `checkout_service.cancel_checkout` |

### Notifications and admin

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/notifications` | `GET` | Recent upload notification feed | Cookie auth optional | JSON list | `notification_service.get_recent_upload_notifications` |
| `/admin` | `GET` | Admin dashboard | Cookie auth with `Admin` role | `admin_dashboard.html` | `admin_user_service.get_admin_dashboard_stats` |
| `/admin/users` | `GET` | Admin users page | Cookie auth with `Admin` role | `admin_users.html` | `admin_user_service.get_admin_users_page_data` |
| `/admin/users/create` | `GET` | Create-user page | Cookie auth with `Admin` role | `admin_create_user.html` | Inline role query |
| `/admin/users/create` | `POST` | Create user | Cookie auth with `Admin` role | Redirect or `admin_create_user.html` | `admin_user_service.create_admin_user` |
| `/admin/users/{user_id}/role` | `POST` | Replace role | Cookie auth with `Admin` role | Redirect or `admin_users.html` | `admin_user_service.replace_user_role` |
| `/admin/users/{user_id}/status` | `POST` | Toggle user active flag | Cookie auth with `Admin` role | Redirect | `admin_user_service.toggle_user_status` |
| `/admin/stats` | `GET` | Admin stats page | Cookie auth with `Admin` role | `admin_stats.html` | Inline DB aggregation |
| `/admin/users/{user_id}/edit` | `GET` | Edit-user page | Cookie auth only | `admin_edit_user.html` | Inline target and roles query |
| `/admin/users/{user_id}/edit` | `POST` | Update user email | Cookie auth only | Redirect | `admin_user_service.update_user_email` |
| `/admin/users/{user_id}/password` | `GET` | First password page handler | Cookie auth with `Admin` role | `admin_change_password.html` | Inline target query |
| `/admin/users/{user_id}/password` | `POST` | First password submit handler | Cookie auth with `Admin` role | Redirect | `admin_user_service.change_password_first_handler` |
| `/admin/users/{user_id}/password` | `GET` | Second duplicate password page handler | Cookie auth only | `admin_change_password.html` | Inline target query |
| `/admin/users/{user_id}/password` | `POST` | Second duplicate password submit handler | Cookie auth only | Redirect or template | `admin_user_service.change_password_validated_handler` |
| `/admin/users/{user_id}/delete` | `POST` | First delete handler | Cookie auth only | Redirect | `admin_user_service.delete_user` |
| `/admin/users/{user_id}/delete` | `POST` | Second duplicate delete handler | Cookie auth only | Redirect | `admin_user_service.delete_user` |

### Duplicate route behavior preserved in `web.py`

| Path | Runtime owner | Shadowed handler(s) | Current effect |
| --- | --- | --- | --- |
| `/projects/{project_id}/chapter/{chapter_id}/delete` `POST` | First `delete_chapter` definition | Second `delete_chapter` definition | First handler returns `?msg=Chapter+Deleted+Successfully`; second remains registered but shadowed in normal routing |
| `/admin/users/{user_id}/password` `GET` | First `admin_change_password_page` | Second `admin_change_password_page` | First handler keeps Admin role check |
| `/admin/users/{user_id}/password` `POST` | First `admin_change_password_submit` | Second `admin_change_password` | First handler wins and bypasses later password-length validation |
| `/admin/users/{user_id}/delete` `POST` | First `admin_delete_user` | Second `admin_delete_user` | Both use same service; neither adds an Admin-role guard |

## `app/routers/users.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/users/` | `POST` | Create user API | None | JSON | `user_service.create_user` |
| `/api/v1/users/login` | `POST` | Bearer login | None | JSON | Inline user lookup plus JWT issuance |
| `/api/v1/users/me` | `GET` | Current bearer user | Bearer auth | JSON | `get_current_user` dependency |

## `app/routers/teams.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/teams/` | `POST` | Create team | Bearer auth | JSON | `team_service.create_team` |
| `/api/v1/teams/` | `GET` | List teams | Bearer auth | JSON | `team_service.get_teams` |

## `app/routers/projects.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/projects/` | `POST` | Create project | Bearer auth plus `ProjectManager` role | JSON | `project_service.create_project` |
| `/api/v1/projects/` | `GET` | List projects | Bearer auth | JSON | `project_service.get_projects` |
| `/api/v1/projects/{project_id}/status` | `PUT` | Update project status | Bearer auth plus `ProjectManager` role | JSON | `project_service.update_project_status` |
| `/api/v1/projects/{project_id}` | `DELETE` | Delete project DB rows only | Cookie auth | JSON | `project_service.delete_project_v2` |

Note the auth split inside this router: create/read/update use bearer auth, while delete uses cookie auth.

## `app/routers/files.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/files/` | `POST` | Compatibility flat upload endpoint | Bearer auth | JSON | `file_service.create_file_record` |

This endpoint bypasses chapter/category workflows and writes directly into the upload root.

## `app/routers/processing.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/processing/files/{file_id}/process/{process_type}` | `POST` | Start processing workflow | Cookie auth | JSON | `processing_service.start_process` |
| `/api/v1/processing/files/{file_id}/structuring_status` | `GET` | Poll for structuring completion | Cookie auth | JSON | `processing_service.get_structuring_status` |
| `/api/v1/processing/files/{file_id}/technical/scan` | `GET` | Technical scan | Cookie auth | JSON | `technical_editor_service.scan_errors` |
| `/api/v1/processing/files/{file_id}/technical/apply` | `POST` | Technical apply | Cookie auth | JSON | `technical_editor_service.apply_edits` |

The router keeps process permission checks and passes engine classes into the service to preserve current test monkeypatch behavior.

## `app/routers/structuring.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/api/v1/files/{file_id}/structuring/review` | `GET` | Render structuring review shell | Cookie auth | `structuring_review.html` or `error.html` | `structuring_review_service.build_review_page_state` |
| `/api/v1/files/{file_id}/structuring/save` | `POST` | Save structuring changes | Cookie auth | JSON | `structuring_review_service.save_changes` |
| `/api/v1/files/{file_id}/structuring/review/export` | `GET` | Export processed DOCX | Cookie auth | File | `structuring_review_service.get_export_payload` |

## `app/routers/wopi.py`

| Path | Methods | Purpose | Auth | Response | Delegation |
| --- | --- | --- | --- | --- | --- |
| `/files/{file_id}/edit` | `GET` | Render Collabora editor shell for original file | Cookie auth | `editor.html` | `wopi_service.build_editor_page_state` |
| `/wopi/files/{file_id}` | `GET` | Original CheckFileInfo | No auth | JSON | `wopi_service.build_check_file_info_payload` |
| `/wopi/files/{file_id}/contents` | `GET` | Original GetFile | No auth | File | `wopi_service.build_file_response_payload` |
| `/wopi/files/{file_id}/contents` | `POST` | Original PutFile | No auth | Empty `200` or error | `wopi_service.write_file_bytes` |
| `/wopi/files/{file_id}/structuring` | `GET` | Structuring CheckFileInfo | No auth | JSON | `wopi_service.build_check_file_info_payload` |
| `/wopi/files/{file_id}/structuring/contents` | `GET` | Structuring GetFile | No auth | File | `wopi_service.build_file_response_payload` |
| `/wopi/files/{file_id}/structuring/contents` | `POST` | Structuring PutFile | No auth | Empty `200` or error | `wopi_service.write_file_bytes` |

## Root Route Duplication

There are two `/` route declarations:

- [`app/routers/web.py`](../../app/routers/web.py): browser home redirect
- [`app/main.py`](../../app/main.py): JSON welcome payload

`web.router` is included before `app.get("/")` is declared in `main.py`, so the SSR redirect route is registered earlier and is the effective browser-facing root in normal route order. The JSON root route remains in code and should be treated as shadowed behavior.
