# Known Boundaries And Tech Debt

This document lists intentionally retained boundaries, wrappers, and cleanup debt that still exist in the current codebase.

Related docs:
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)
- [WOPI_AND_EDITOR_BOUNDARY.md](./WOPI_AND_EDITOR_BOUNDARY.md)

## Retained Compatibility Wrappers

These wrappers are still intentional and should not be removed casually.

### Top-level wrappers
- `app/auth.py`
- `app/database.py`
- `app/rbac.py`
- `app/worker.py`

### Service wrappers
- `app/services/activity_service.py`
- `app/services/admin_user_service.py`
- `app/services/ai_structuring_client.py`
- `app/services/auth_service.py`
- `app/services/chapter_service.py`
- `app/services/checkout_service.py`
- `app/services/dashboard_service.py`
- `app/services/notification_service.py`
- `app/services/processing_service.py`
- `app/services/project_read_service.py`
- `app/services/project_service.py`
- `app/services/session_service.py`
- `app/services/structuring_review_service.py`
- `app/services/team_service.py`
- `app/services/technical_editor_service.py`
- `app/services/user_service.py`
- `app/services/version_service.py`
- `app/services/wopi_service.py`

### Router wrappers
- `app/routers/users.py`
- `app/routers/teams.py`
- `app/routers/projects.py`
- `app/routers/files.py`
- `app/routers/wopi.py`

## Canonical Old-Path Modules Still Preserved

These remain the practical patch/runtime points and were not fully retired:
- `app/database.py`
- `app/services/file_service.py`
- `app/routers/api_v2.py`
- `app/routers/processing.py`
- `app/routers/structuring.py`
- `app/routers/web.py`

Reason:
- tests and monkeypatch targets still depend on them
- deep import retirement was deferred to avoid release risk

## Retained SSR Surface

Still intentionally retained:
- `/login`
- `/register`
- `/logout`
- `/projects/create`
- `/activities`
- `editor.html`
- `error.html`

These are not all equivalent:
- auth routes are fallback-only
- project create is fallback-only
- activities is still the only UI for that flow
- editor and WOPI are not fallback; they are the current integration boundary

## Duplicate Legacy Routes

Legacy SSR/web routing still contains duplicate definitions that were intentionally preserved to avoid changing runtime ownership mid-migration.

Known areas:
- chapter delete handler duplication
- admin password handler duplication
- admin delete handler duplication

Do not normalize these without a dedicated cleanup phase and regression confirmation.

## Processing Boundary Limits

- no durable job model is exposed to the frontend
- processing status remains compatibility-oriented
- frontend starts processing and polls current status, but does not own job state semantics

## Version History UI Gap

- backend version-history contracts exist
- frontend does not yet expose a dedicated version-history browser

This is a product/UI gap, not a missing backend capability.

## Activities UI Gap

- `GET /api/v2/activities` exists
- `/activities` SSR page still exists
- there is no `/ui/activities` page yet

This is why `activities.html` is still retained.

## Editor Boundary Limits

- frontend review shell exists
- frontend does not embed or own the WOPI editor
- backend still owns:
  - `collabora_url`
  - WOPI routing
  - original vs processed target resolution
  - byte writeback

This is intentional.

## Warning Debt

Current non-blocking warning areas still present in the codebase:
- FastAPI `on_event` deprecation
- Pydantic v2 migration warnings
- `datetime.utcnow()` and `utcfromtimestamp()` deprecations
- Starlette `TemplateResponse` signature warning
- Vite/Vitest warning about deprecated React plugin `esbuild` options

These are not release blockers for the current internal scope, but they remain cleanup candidates.

## Manual-Only Checks Still Required

Current manual-only checks that are still not fully automated:
- live Collabora/WOPI launch
- real browser download behavior
- true two-user lock conflict
- live filesystem verification for archive/processed outputs

## Current Safe Cleanup Boundary

Safe to keep as-is for now:
- backend-owned auth/session logic
- backend-owned WOPI/editor boundary
- compatibility wrappers
- SSR fallback auth routes

Not safe to remove without another dedicated cleanup wave:
- compatibility wrappers
- retained auth SSR routes
- WOPI routes
- `editor.html`
- `error.html`
