# Domain Structure Refactor Plan

## Goal

Reorganize the backend into clearer ownership boundaries without changing runtime behavior, `/api/v2` contracts, retained SSR behavior, or backend-owned WOPI/editor semantics.

## Refactor Rules

- Keep runtime behavior unchanged.
- Keep all existing public routes unchanged.
- Keep `/api/v2` payloads unchanged.
- Keep backend-owned login/register and editor/WOPI boundaries intact.
- Move code in compatibility-safe waves.
- Leave thin compatibility modules at old import paths while internal ownership shifts.

## Current Structure

Current top-level backend modules:

- `app/auth.py`
- `app/database.py`
- `app/models.py`
- `app/rbac.py`
- `app/schemas.py`
- `app/schemas_v2.py`
- `app/worker.py`
- `app/routers/*.py`
- `app/services/*.py`
- `app/processing/*`
- `app/templates/*`

## Target Structure

- `app/core`
- `app/domains/auth`
- `app/domains/admin`
- `app/domains/projects`
- `app/domains/chapters`
- `app/domains/files`
- `app/domains/processing`
- `app/domains/review`
- `app/domains/activities`
- `app/domains/notifications`
- `app/integrations/wopi`
- `app/integrations/collabora`
- `app/integrations/storage`
- `app/integrations/ai_structuring`
- `app/models`
- `app/templates`
- `app/legacy`

## Concrete Move Map

### Core and shared modules

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/database.py` | `app/core/database.py` | Old `app/database.py` remains as compatibility wrapper |
| `app/worker.py` | `app/core/worker.py` | Old `app/worker.py` remains as compatibility wrapper |
| `app/models.py` | `app/models/__init__.py` | Convert ORM layer into package; old file path cannot coexist, so imports move to package name `app.models` |

### Auth domain

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/auth.py` | `app/domains/auth/security.py` | Old `app/auth.py` remains as compatibility wrapper |
| `app/rbac.py` | `app/domains/auth/permissions.py` | Old `app/rbac.py` remains as compatibility wrapper |
| `app/services/auth_service.py` | `app/domains/auth/auth_service.py` | Old service path remains as wrapper |
| `app/services/session_service.py` | `app/domains/auth/session_service.py` | Old service path remains as wrapper |
| `app/services/user_service.py` | `app/domains/auth/user_service.py` | Thin helper service; keep behavior unchanged |
| `app/routers/users.py` | `app/domains/auth/api_v1.py` | Old router path remains as wrapper |

### Admin domain

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/admin_user_service.py` | `app/domains/admin/service.py` | Owns read + mutation service behavior |
| `app/services/team_service.py` | `app/domains/admin/team_service.py` | Keep current thin/legacy behavior intact |

### Projects and chapters domains

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/dashboard_service.py` | `app/domains/projects/dashboard_service.py` | Dashboard is project/read aggregation |
| `app/services/project_service.py` | `app/domains/projects/service.py` | Project bootstrap/delete ownership |
| `app/services/project_read_service.py` | `app/domains/projects/read_service.py` | Project list/detail/chapter read aggregation |
| `app/services/chapter_service.py` | `app/domains/chapters/service.py` | Chapter create/rename/delete behavior |
| `app/routers/projects.py` | `app/domains/projects/api_v1.py` | Old router path remains as wrapper |
| `app/routers/teams.py` | `app/domains/projects/teams_api_v1.py` | Keep `/api/v1/teams` behavior intact |

### Files domain

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/file_service.py` | `app/domains/files/service.py` | File upload/delete/download behavior |
| `app/services/version_service.py` | `app/domains/files/version_service.py` | Version/archive behavior |
| `app/services/checkout_service.py` | `app/domains/files/checkout_service.py` | Lock semantics |
| `app/routers/files.py` | `app/domains/files/api_v1.py` | Old router path remains as wrapper |

### Processing and review domains

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/processing_service.py` | `app/domains/processing/service.py` | Processing orchestration |
| `app/services/technical_editor_service.py` | `app/domains/processing/technical_editor_service.py` | Technical scan/apply orchestration |
| `app/routers/processing.py` | `app/domains/processing/api_v1.py` | Old router path remains as wrapper |
| `app/services/structuring_review_service.py` | `app/domains/review/service.py` | Structuring review metadata/save/export |
| `app/routers/structuring.py` | `app/domains/review/router.py` | Old router path remains as wrapper |

### Activities and notifications domains

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/activity_service.py` | `app/domains/activities/service.py` | Read-side aggregation only |
| `app/services/notification_service.py` | `app/domains/notifications/service.py` | Read-side aggregation only |

### Integrations

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/services/wopi_service.py` | `app/integrations/wopi/service.py` | WOPI logic remains backend-owned |
| `app/routers/wopi.py` | `app/integrations/wopi/router.py` | Old router path remains as wrapper |
| Collabora constants in `app/routers/structuring.py` | `app/integrations/collabora/config.py` | Centralize launch/base URL ownership without changing values |
| `app/services/ai_structuring_client.py` | `app/integrations/ai_structuring/client.py` | External AI client remains thin integration |
| Upload path alias in `app/services/file_service.py` | `app/integrations/storage/paths.py` | Re-export runtime upload root from existing `app.core.paths` |

### Legacy area

| Current file | Target file | Notes |
| --- | --- | --- |
| `app/routers/web.py` | `app/legacy/web.py` | Retained SSR auth/fallback/editor-adjacent routes stay intact |
| `app/processing/legacy/*` | stay in place for now | Not moved in this refactor wave; already marked legacy by path |

### Compatibility aggregators kept in place

These paths will remain as wrappers or import re-exports during the restructure:

- `app/auth.py`
- `app/database.py`
- `app/rbac.py`
- `app/worker.py`
- `app/services/*.py`
- `app/routers/*.py`

This preserves:

- test imports
- current runtime imports
- monkeypatch targets in the regression suite
- existing external module references

## Execution Waves

### Wave 1: foundational packages

- Create domain/integration package directories.
- Move core/shared modules:
  - `database.py`
  - `worker.py`
  - `auth.py`
  - `rbac.py`
- Convert ORM models into `app/models/__init__.py`.
- Add compatibility wrappers at old paths.

Validation:

- backend regression suite
- frontend typecheck/build

### Wave 2: service-layer move

- Move service modules into domain/integration packages.
- Update internal imports to use new domain paths where safe.
- Keep old `app/services/*.py` files as re-export wrappers.

Validation:

- backend regression suite
- frontend typecheck/build

### Wave 3: router move

- Move routers into domain, integration, and legacy packages.
- Update `app/main.py` to import the new owning modules.
- Keep old `app/routers/*.py` modules as wrappers.

Validation:

- backend regression suite
- frontend typecheck/build

### Wave 4: integration and import cleanup

- Move AI/WOPI/Collabora/storage ownership into `app/integrations/*`.
- Replace remaining direct imports of moved modules with their new owning paths where safe.
- Preserve wrapper modules until after release stabilization.

Validation:

- backend regression suite
- frontend tests
- frontend typecheck/build

## Explicit Non-Goals

- No route-path changes
- No contract normalization
- No business-logic redesign
- No WOPI/editor behavior changes
- No removal of retained SSR auth/editor boundaries
- No schema redesign

## Success Criteria

- Current tests remain green.
- `/api/v2` behavior is unchanged.
- SSR login/register and editor/WOPI flows are unchanged.
- Backend ownership is clearer from directory layout.
- Old import paths still resolve during the transition.
