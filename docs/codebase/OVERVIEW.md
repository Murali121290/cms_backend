# Codebase Overview

This repository is a FastAPI CMS backend plus a React frontend. The current steady-state ownership model is:

- frontend owns `/ui` user experience
- backend owns `/api/v2` contracts and business logic
- backend owns authentication and session cookie issuance
- backend owns WOPI/Collabora launch and callback behavior

Start here, then read:
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [BACKEND.md](./BACKEND.md)
- [FRONTEND.md](./FRONTEND.md)
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)

## Current Runtime Surfaces

### Primary user interface
- `/ui/login`
- `/ui/register`
- `/ui/dashboard`
- `/ui/projects`
- `/ui/projects/:projectId`
- `/ui/projects/:projectId/chapters/:chapterId`
- admin, technical-review, and structuring-review routes under `/ui`

### Backend API surfaces
- `/api/v2/*` is the frontend-facing contract surface
- `/api/v1/*` remains as compatibility API surface
- legacy SSR routes in `app/routers/web.py` remain live where still needed

### Retained SSR fallback surface
- `/login`
- `/register`
- `/logout`
- `/projects/create` and `POST /projects/create_with_files` as the remaining SSR project-create fallback
- `editor.html` and all `/wopi/...` routes
- `error.html`
- `/activities` until a `/ui/activities` replacement exists

## Repository Shape

### Backend
- `app/core` shared runtime concerns
- `app/domains` service/domain ownership
- `app/integrations` external system boundaries
- `app/legacy` retained SSR ownership markers
- `app/models` ORM package
- `app/routers` canonical route modules and compatibility entrypoints
- `app/services` compatibility wrappers that still re-export moved services
- `app/templates` retained SSR and editor templates

### Frontend
- `frontend/src/app` router and providers
- `frontend/src/api` typed `/api/v2` client layer
- `frontend/src/features` feature modules
- `frontend/src/pages` route pages
- `frontend/src/stores` lightweight Zustand session state
- `frontend/src/types` TypeScript API contracts

### Tests
- `tests/` backend regression and contract suite
- `frontend/src/**/*.test.tsx` frontend route and feature tests

## Current Release Position

The codebase is currently prepared for internal release with:

- `/ui` as the primary operational interface
- backend-owned login/register/logout still present as rollback fallback
- backend-owned WOPI/editor handoff unchanged
- backend regression, frontend tests, frontend typecheck, and frontend build currently green

See:
- [TESTING_AND_RELEASE.md](./TESTING_AND_RELEASE.md)
- [KNOWN_BOUNDARIES_AND_TECH_DEBT.md](./KNOWN_BOUNDARIES_AND_TECH_DEBT.md)
