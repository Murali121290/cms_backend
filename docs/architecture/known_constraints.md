# Known Constraints

Related docs:

- [Router Layer](router_layer.md)
- [Project Bootstrap](project_bootstrap.md)
- [File Workflow](file_workflow.md)
- [Security Model](security_model.md)

This document lists active architectural limitations that are intentionally preserved in the current codebase.

## Preserved Constraints

| Constraint | Where it exists | Current impact |
| --- | --- | --- |
| Duplicate root routes | [`app/main.py`](../../app/main.py), [`app/routers/web.py`](../../app/routers/web.py) | Both `/` routes remain registered; the earlier SSR route is the effective browser-facing root |
| Duplicate admin password routes | [`app/routers/web.py`](../../app/routers/web.py) | First POST handler wins at runtime and bypasses later password-length validation |
| Duplicate admin delete routes | [`app/routers/web.py`](../../app/routers/web.py) | Both remain registered; delete auth is not strengthened |
| Duplicate chapter delete routes | [`app/routers/web.py`](../../app/routers/web.py) | First handler wins in normal routing and returns a different redirect message |
| Mixed auth in one API router | [`app/routers/projects.py`](../../app/routers/projects.py) | create/read/update use bearer auth; delete uses cookie auth |
| No repository layer | all services | services query SQLAlchemy sessions directly |
| SSR still active | [`app/templates/`](../../app/templates), [`app/routers/web.py`](../../app/routers/web.py) | backend remains responsible for HTML, context shape, and JS-driven workflows |
| Notifications and activities are derived, not persisted | [`notification_service.py`](../../app/services/notification_service.py), [`activity_service.py`](../../app/services/activity_service.py) | no dedicated tables or event log |
| Dashboard metrics are partly hardcoded | [`dashboard_service.py`](../../app/services/dashboard_service.py), [`admin_user_service.py`](../../app/services/admin_user_service.py) | some summary cards are placeholders rather than live analytics |
| Technical response shapes are legacy-preserved | [`technical_editor_service.py`](../../app/services/technical_editor_service.py) | scan returns whatever the legacy editor emits |
| WOPI callbacks are unauthenticated | [`app/routers/wopi.py`](../../app/routers/wopi.py) | Collabora integration depends on open callback routes |

## Filesystem Constraints

### Bootstrap path mismatch

Project bootstrap creates folders like:

`Chapter 1 - alpha`

Later chapter services still use:

`{project.code}/{chapter.number}`

Affected code:

- bootstrap: [`project_service.py`](../../app/services/project_service.py)
- later chapter/file services: [`chapter_service.py`](../../app/services/chapter_service.py), [`file_service.py`](../../app/services/file_service.py)

Impact:

- later uploads to a bootstrap-created chapter will target a different directory tree
- chapter rename/delete and chapter ZIP download still operate on `{chapter.number}` paths

### Multiple archival implementations

Version snapshots are created in two different places:

- `version_service.archive_existing_file(...)` for overwrite uploads
- `processing_service.start_process(...)` for processing start

They are similar but not unified.

## Auth and Security Constraints

- Cookie auth has no explicit CSRF protection.
- `access_token` cookie is only marked `httponly`.
- `/admin/users/{user_id}/delete` and `/admin/users/{user_id}/edit` do not consistently enforce `Admin`.
- CORS is configured with `allow_origins=["*"]` and `allow_credentials=True`.

## Data and Schema Constraints

- `schemas.ProjectCreate` has no `client_name`, but SSR bootstrap patches `Project.client_name` after creation.
- `team_service.create_team(...)` expects `Team.description` and `Team.owner_id`, but the `Team` model does not define those columns.
- `File.file_type` is populated differently depending on workflow.
- the flat `/api/v1/files/` compatibility upload does not populate the same fields as SSR chapter uploads.

## Service-Layer Constraints

- Some routes are still partially inline, especially `download_chapter_zip`, `admin_stats`, and several SSR page-render routes in `web.py`.
- `processing_service` still owns both orchestration and derivative registration rather than delegating into smaller services.
- `project_read_service` mutates ORM chapter objects by attaching transient `has_*` attributes.

## Legacy and Integration Constraints

- `TechnicalEngine` and `technical_editor_service` produce different derivative naming conventions:
  - `_TechnicallyEdited.docx`
  - `_TechEdited.ext`
- `wopi_service.build_file_response_payload(...)` intentionally does duplicate DB lookup in original mode to preserve route behavior.
- The AI structuring integration is optional and HTTP-based; local structuring remains the default.
- The repository still contains a CMS Celery worker, but the current CMS processing route uses FastAPI `BackgroundTasks`.

## Unused or Stale Code Paths Present In The Repository

- `project_service.delete_project(...)` still contains a stale reference to `processing_results` and is not the delete path used by current routers.
- `README.md` does not fully reflect the extracted service architecture and should not be treated as the source of truth over the code.
