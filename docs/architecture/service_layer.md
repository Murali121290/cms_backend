# Service Layer

Related docs:

- [Backend Architecture](backend_architecture.md)
- [Router Layer](router_layer.md)
- [Project Bootstrap](project_bootstrap.md)
- [File Workflow](file_workflow.md)
- [Processing Pipeline](processing_pipeline.md)
- [Structuring Workflow](structuring_workflow.md)
- [WOPI Integration](wopi_integration.md)

## Service Layer Overview

Services live under [`app/services/`](../../app/services). They encapsulate backend workflow logic but still depend directly on SQLAlchemy sessions and model classes. There is no repository abstraction layer yet.

This document covers every current file in `app/services/`. The service directory contains two broad categories:

- extracted domain services that now own CMS workflows
- thinner compatibility/helper services that support bearer APIs or external integrations

## Extracted Domain Services

| Service | Purpose | Main dependencies | Workflows owned |
| --- | --- | --- | --- |
| [`auth_service.py`](../../app/services/auth_service.py) | Browser auth and registration helpers | `models.User`, `models.Role`, JWT/password helpers | browser login, first-user bootstrap, browser registration |
| [`session_service.py`](../../app/services/session_service.py) | SSR cookie/session response helpers | FastAPI `RedirectResponse` | home redirect, login cookie, logout cookie clear, registration redirect, common user context |
| [`notification_service.py`](../../app/services/notification_service.py) | Derived upload notification feed | `models.File`, IST time utility | `/api/notifications` |
| [`activity_service.py`](../../app/services/activity_service.py) | Derived activities feed | `models.File`, `models.FileVersion`, project/chapter lookups | `/activities` |
| [`dashboard_service.py`](../../app/services/dashboard_service.py) | Dashboard read model | `project_service.get_projects` | dashboard list and summary cards |
| [`admin_user_service.py`](../../app/services/admin_user_service.py) | Admin reads and mutations | `models.User`, `models.Role`, `models.UserRole`, password hashing | admin dashboard, user list, create user, role replace, status toggle, edit, password, delete |
| [`project_read_service.py`](../../app/services/project_read_service.py) | Read-side project/chapter page assembly | `models.Project`, `models.Chapter`, `models.File` | projects list, project chapters, chapter detail |
| [`project_service.py`](../../app/services/project_service.py) | Project bootstrap and project-level persistence | `models.Project`, `models.Chapter`, `models.File`, `schemas.ProjectCreate` | create project, bootstrap with files, delete project |
| [`chapter_service.py`](../../app/services/chapter_service.py) | Chapter write-side workflows | `models.Project`, `models.Chapter`, filesystem | create, rename, duplicate delete variants |
| [`file_service.py`](../../app/services/file_service.py) | File upload/download/delete workflows | `models.File`, `models.Project`, `models.Chapter`, filesystem | compatibility flat upload, chapter upload, delete, download |
| [`version_service.py`](../../app/services/version_service.py) | Archive/version snapshot creation | `models.FileVersion`, filesystem | overwrite upload archival |
| [`checkout_service.py`](../../app/services/checkout_service.py) | File lock ownership and release | `models.File`, IST time utility | checkout, cancel checkout, overwrite unlock |
| [`processing_service.py`](../../app/services/processing_service.py) | Processing orchestration | `models.File`, `models.FileVersion`, `database.SessionLocal`, engine classes, filesystem | start process, backup, background task, derivative registration, status polling |
| [`technical_editor_service.py`](../../app/services/technical_editor_service.py) | Technical scan/apply orchestration | `models.File`, filesystem, injected legacy `TechnicalEditor` | technical scan and `_TechEdited` apply workflow |
| [`structuring_review_service.py`](../../app/services/structuring_review_service.py) | Processed-doc review state and save/export | `models.File`, filesystem, structuring utils | review page state, save, export |
| [`wopi_service.py`](../../app/services/wopi_service.py) | WOPI path resolution and byte transport | `models.File`, filesystem, hashing | editor shell state, CheckFileInfo, GetFile, PutFile |

## Compatibility and Helper Services

| Service | Current role | Main dependencies | Workflows owned |
| --- | --- | --- | --- |
| [`user_service.py`](../../app/services/user_service.py) | Thin bearer-API helper used by `users.py` | `models.User`, `models.Role`, `schemas.UserCreate`, password hashing | bearer login support, API user create, optional role assignment helper |
| [`team_service.py`](../../app/services/team_service.py) | Thin bearer-API helper used by `teams.py` | `models.Team`, `schemas.TeamCreate` | team create and team list for `/api/v1/teams` |
| [`ai_structuring_client.py`](../../app/services/ai_structuring_client.py) | External integration helper used by `StructuringEngine` when AI offload is enabled | `requests`, zip extraction, AI structuring settings | submit/poll/download flow for the external AI structuring backend |

## Auth and Session Services

### `auth_service.py`

Responsibilities:

- verify browser username/password against `User.password_hash`
- create browser access tokens using `create_access_token`
- ensure default browser roles exist
- assign `Admin` role to the first registered browser user
- assign `Viewer` role to later browser users

Important preserved behavior:

- Browser registration is separate from bearer API user creation.
- Role seeding happens both here and again at app startup; see [Known Constraints](known_constraints.md).

### `session_service.py`

Responsibilities:

- produce the browser home redirect
- set and clear the `access_token` cookie
- preserve the cookie value prefix `Bearer `
- build small user-context dicts used by templates

Important preserved behavior:

- The cookie is set with `httponly=True`.
- No `secure` or `samesite` attribute is set here.

## Read-Side Services

### `dashboard_service.py`

- Returns the current project list plus a partially hardcoded `dashboard_stats` payload.
- Only `total_projects` is derived from live data.

### `project_read_service.py`

- Builds the projects page list.
- Builds project chapters page state.
- Adds transient boolean attributes to ORM chapter instances:
  - `has_art`
  - `has_ms`
  - `has_ind`
  - `has_proof`
  - `has_xml`
- Builds chapter detail page state with `project`, `chapter`, and `files`.

### `notification_service.py` and `activity_service.py`

- Build read models rather than loading dedicated tables.
- Notifications are the latest `File` uploads.
- Activities merge `File` uploads and `FileVersion` records, then sort by timestamp.

## Admin Service

### `admin_user_service.py`

Responsibilities:

- Admin dashboard counters used by `/admin`
- User list and role list used by `/admin/users`
- Create user with one selected role
- Replace the target user’s entire role list with one new role
- Prevent removal of the last remaining `Admin` assignment
- Prevent self-disable in status toggling
- Update user email
- Preserve both password flows:
  - first handler: no length validation
  - second handler: minimum six-character validation
- Prevent self-delete

This service preserves route-level quirks rather than normalizing them.

## Bearer API Helper Services

### `user_service.py`

This is a thin helper for the bearer-oriented user API in [`app/routers/users.py`](../../app/routers/users.py).

Responsibilities:

- look up users by username
- create a `User` row from `schemas.UserCreate`
- hash the incoming password before persistence
- append a named role to a user through `assign_role(...)`

Current usage:

- `get_user_by_username(...)` is used by the user API login and create flows
- `create_user(...)` is used by `POST /api/v1/users/`
- `assign_role(...)` exists in the service file but is not currently wired by a router

### `team_service.py`

This is a thin helper for the bearer-oriented team API in [`app/routers/teams.py`](../../app/routers/teams.py).

Responsibilities:

- check for existing team name collisions
- create a team from `schemas.TeamCreate`
- list teams with offset/limit pagination

Current implementation detail:

- `create_team(...)` attempts to write `description` and `owner_id` fields even though the current `Team` model does not define those columns. That mismatch is preserved in the repository state and documented here rather than corrected.

## Project and Chapter Services

### `project_service.py`

Responsibilities:

- simple API project creation via `schemas.ProjectCreate`
- project bootstrap with initial file upload plan
- `client_name` post-create patching
- SSR delete with filesystem cleanup
- API delete without filesystem cleanup

The bootstrap path is documented in detail in [Project Bootstrap](project_bootstrap.md).

### `chapter_service.py`

Responsibilities:

- create chapter row and create category directories under `{upload_dir}/{project.code}/{number}`
- rename chapter row and rename the chapter directory if the chapter number changes
- preserve two chapter delete variants with different redirect semantics

## File, Version, and Lock Services

### `file_service.py`

Responsibilities:

- compatibility flat upload endpoint used by `/api/v1/files/`
- chapter-category uploads
- overwrite handling with version snapshots
- download lookup
- delete plus redirect-context capture

### `version_service.py`

Responsibilities:

- create `Archive/`
- copy the prior file into `{name}_v{old_version}.{ext}`
- add the matching `FileVersion` row

### `checkout_service.py`

Responsibilities:

- determine whether a file is locked by another user
- apply checkout state
- cancel checkout if the actor owns the lock
- clear lock flags after overwrite uploads

Note that `reset_checkout_after_overwrite` clears `is_checked_out` and `checked_out_by_id`, but not `checked_out_at`.

## Processing and Technical Services

### `processing_service.py`

Responsibilities:

- process permission map
- process start validation
- file lock handling for processing
- processing backup/version creation
- background engine dispatch
- generated-file registration as new `File` rows
- unlock on success and failure
- structuring status polling

This service is documented in [Processing Pipeline](processing_pipeline.md).

### `technical_editor_service.py`

Responsibilities:

- scan the live document with the legacy `TechnicalEditor.scan`
- apply replacements with `TechnicalEditor.process`
- create a `_TechEdited` derivative record

This service is separate from the background `process/technical` route, which uses `TechnicalEngine` and produces `_TechnicallyEdited.docx`.

## External Integration Helper Service

### `ai_structuring_client.py`

This file is not a router-facing service in the same sense as the extracted CMS workflow services. It is an HTTP client helper used by [`app/processing/structuring_engine.py`](../../app/processing/structuring_engine.py) when `AI_STRUCTURING_BASE_URL` is configured.

Responsibilities:

- hold AI structuring connection settings in `AIStructuringSettings`
- submit a batch to the external AI backend
- poll batch status until terminal completion
- download the output ZIP bundle
- extract the first processed DOCX from the ZIP

Current integration boundary:

- expected external endpoints:
  - `POST /api/queue/batch`
  - `GET /api/queue/batch/{batch_id}`
  - `GET /api/download/{batch_id}/zip`
- local structuring remains the default path when the AI base URL is not configured or the offload fails
- the helper is used by `StructuringEngine`, not by FastAPI routers directly

## Structuring and WOPI Services

### `structuring_review_service.py`

Responsibilities:

- resolve the processed target file from an original or processed input record
- verify the processed file exists
- build the review shell state including the Collabora launch URL
- save review changes in place to the processed document
- export the processed document

### `wopi_service.py`

Responsibilities:

- resolve original vs structuring target path
- build editor shell state for `/files/{id}/edit`
- build `CheckFileInfo` JSON payloads
- build `GetFile` payloads
- write bytes from `PutFile`

The integration details are documented in [WOPI Integration](wopi_integration.md).
