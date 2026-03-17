# Architecture

This codebase is organized as a thin-router, service-oriented FastAPI backend plus a React frontend that consumes `/api/v2`.

Related docs:
- [BACKEND.md](./BACKEND.md)
- [FRONTEND.md](./FRONTEND.md)
- [WOPI_AND_EDITOR_BOUNDARY.md](./WOPI_AND_EDITOR_BOUNDARY.md)

## High-Level Request Flow

### `/ui` flow
1. Browser loads the Vite-built React app.
2. `SessionGate` bootstraps via `GET /api/v2/session`.
3. If authenticated, the frontend stays inside `/ui`.
4. Pages and feature hooks call `/api/v2` only.
5. For structuring review, the frontend uses backend-provided editor handoff metadata instead of owning editor state.

### SSR fallback flow
1. Browser accesses retained backend routes such as `/login`, `/register`, or `/projects/create`.
2. `app/routers/web.py` renders Jinja templates or redirects.
3. Business logic still delegates into backend services, not directly into templates.

### Editor/WOPI flow
1. Backend builds Collabora launch URLs.
2. Browser opens backend-provided editor launch wrapper or provided editor URL.
3. `/wopi/...` callbacks read/write file bytes through backend-owned services.

## Backend Structure

### `app/core`
Shared infrastructure:
- config
- database/session access
- runtime paths
- celery wiring

### `app/domains`
Domain ownership by responsibility:

| Domain | Current contents |
| --- | --- |
| `auth` | session helpers, auth services, security, permissions, `/api/v1/users` |
| `admin` | admin read/mutation service |
| `projects` | dashboard aggregation, project reads, project writes, teams `/api/v1` |
| `chapters` | chapter create/rename/delete |
| `files` | `/api/v1/files`, file workflow service, checkout service, version service |
| `processing` | processing orchestration and technical editor orchestration |
| `review` | structuring review service plus legacy router wrapper |
| `activities` | activity feed aggregation |
| `notifications` | notification feed aggregation |

### `app/integrations`
External boundaries:

| Integration | Current purpose |
| --- | --- |
| `wopi` | WOPI routes and byte/path behavior |
| `collabora` | launch/base URL config |
| `storage` | runtime path helpers |
| `ai_structuring` | optional external AI structuring client |

### `app/legacy`
- `app/legacy/web.py` marks retained SSR ownership explicitly
- runtime still uses `app/routers/web.py` as the canonical old-path module

## Frontend Structure

The frontend is feature-oriented:

| Area | Current role |
| --- | --- |
| `src/app` | router and providers |
| `src/api` | typed Axios functions for `/api/v2` |
| `src/features` | session, admin, projects, notifications, processing, technicalReview, structuringReview |
| `src/pages` | route-level pages |
| `src/stores` | Zustand session bootstrap state |
| `src/types` | API request/response types |

## Compatibility Wrappers

The refactor introduced clearer domain/integration ownership without removing old import surfaces yet.

### Why wrappers still exist
- current tests still patch old import locations
- route modules still import some legacy paths directly
- safe release stabilization was prioritized over deep import retirement

### Current wrapper categories

| Wrapper surface | Examples |
| --- | --- |
| top-level module wrappers | `app/auth.py`, `app/database.py`, `app/rbac.py`, `app/worker.py` |
| service wrappers | `app/services/auth_service.py`, `app/services/project_service.py`, `app/services/wopi_service.py` |
| router wrappers | `app/routers/users.py`, `app/routers/projects.py`, `app/routers/files.py`, `app/routers/wopi.py` |

The old-path modules remain intentionally stable. Do not remove them without a dedicated cleanup wave.

## Current Ownership Model

### Frontend-owned
- route composition under `/ui`
- view state, navigation, loading/error states
- calling `/api/v2` and rendering results

### Backend-owned
- all persistence and business rules
- all `/api/v2` request handling
- auth/session issuance and cookie clearing
- file storage and versioning
- processing orchestration
- WOPI/editor boundary

### Shared contract boundary
- `/api/v2`
- TypeScript contracts in `frontend/src/types/api.ts`
- Pydantic models in `app/schemas_v2.py`

## What Is Deliberately Not Done Yet

- full SSR removal
- full wrapper removal
- frontend-owned editor iframe embedding
- durable processing job model redesign
- auth service extraction into a separate system

See [KNOWN_BOUNDARIES_AND_TECH_DEBT.md](./KNOWN_BOUNDARIES_AND_TECH_DEBT.md).
