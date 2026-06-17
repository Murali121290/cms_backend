# Backend

The backend remains the system of record. It owns database writes, file storage, versioning, processing, session issuance, and all editor/WOPI behavior.

Related docs:
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)
- [PROJECT_AND_FILE_WORKFLOWS.md](./PROJECT_AND_FILE_WORKFLOWS.md)

## Entry Point

`app/main.py` creates the FastAPI application and mounts:

| Router | Purpose |
| --- | --- |
| `app.legacy.web` -> `app.routers.web` | retained SSR UI and fallback routes |
| `app.routers.api_v2` | frontend-facing API |
| `app.domains.auth.api_v1` | `/api/v1/users` |
| `app.domains.projects.teams_api_v1` | `/api/v1/teams` |
| `app.domains.projects.api_v1` | `/api/v1/projects` |
| `app.domains.files.api_v1` | `/api/v1/files` |
| `app.routers.processing` | `/api/v1/processing` |
| `app.routers.structuring` | legacy structuring SSR/save/export surface |
| `app.integrations.wopi.router` | WOPI/editor routes |

## Current Router Responsibilities

### `app/routers/api_v2.py`
Primary frontend contract surface. It now includes:
- session login/register/get/delete
- dashboard/projects/chapters/files read contracts
- notifications and activities
- project/chapter/file mutations
- upload/versioning
- processing and technical review
- structuring review
- admin read and mutation contracts

### `app/routers/web.py`
Retained SSR and fallback surface:
- SSR auth routes
- SSR dashboard/projects/admin pages
- SSR project creation fallback
- legacy chapter/file mutations and downloads
- `/api/notifications`
- `/activities`
- legacy technical editor page

### `app/routers/processing.py`
Legacy `/api/v1/processing` surface:
- process start
- structuring status
- technical scan
- technical apply

### `app/routers/structuring.py`
Legacy backend-owned structuring review shell and save/export endpoints.

### `app/integrations/wopi/router.py`
Backend-owned editor and WOPI boundary:
- original editor launch
- original CheckFileInfo/GetFile/PutFile
- structuring CheckFileInfo/GetFile/PutFile

## Service/Domain Ownership

### Auth
- `app/domains/auth/auth_service.py`
- `app/domains/auth/session_service.py`
- `app/domains/auth/security.py`
- `app/domains/auth/permissions.py`

### Project and chapter flows
- `app/domains/projects/service.py`
- `app/domains/projects/read_service.py`
- `app/domains/projects/dashboard_service.py`
- `app/domains/chapters/service.py`

### Files and versioning
- `app/services/file_service.py` remains the canonical old-path module
- `app/domains/files/checkout_service.py`
- `app/domains/files/version_service.py`

### Processing and review
- `app/domains/processing/service.py`
- `app/domains/processing/technical_editor_service.py`
- `app/domains/review/service.py`

### Admin, activities, notifications
- `app/domains/admin/service.py`
- `app/domains/activities/service.py`
- `app/domains/notifications/service.py`

### Integrations
- `app/integrations/wopi/service.py`
- `app/integrations/collabora/config.py`
- `app/integrations/storage/paths.py`
- `app/integrations/ai_structuring/client.py`

## Persistence Model

### Database
- SQLAlchemy ORM models are exposed through `app.models`
- configuration is read from `.env` through `app/core/config.py`
- `app/database.py` and `app/core/database.py` both remain because compatibility imports are still retained

### File storage
- runtime root defaults to `/opt/cms_runtime`
- uploads live under `/opt/cms_runtime/data/uploads` unless overridden
- archive/version files are stored on disk and tracked in `FileVersion`

See [PROJECT_AND_FILE_WORKFLOWS.md](./PROJECT_AND_FILE_WORKFLOWS.md).

## Retained Compatibility Wrappers

These wrappers still exist by design:

| Old path | Current owner |
| --- | --- |
| `app/auth.py` | `app/domains/auth/security.py` |
| `app/database.py` | `app/core/database.py` |
| `app/rbac.py` | `app/domains/auth/permissions.py` |
| `app/services/*.py` | domain/integration service modules |
| `app/routers/users.py` | `app/domains/auth/api_v1.py` |
| `app/routers/projects.py` | `app/domains/projects/api_v1.py` |
| `app/routers/files.py` | `app/domains/files/api_v1.py` |
| `app/routers/wopi.py` | `app/integrations/wopi/router.py` |

These remain because tests and some runtime imports still target the old paths.

## Retained SSR Surface

Backend SSR is no longer primary, but these areas are still intentionally live:
- `/login`, `/register`, `/logout`
- `/projects/create` fallback
- `/activities`
- `editor.html`
- `error.html`

See [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md) and [WOPI_AND_EDITOR_BOUNDARY.md](./WOPI_AND_EDITOR_BOUNDARY.md).
