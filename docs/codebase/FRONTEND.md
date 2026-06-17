# Frontend

The frontend is a React + TypeScript application under `frontend/`. It is now the primary UX surface for the CMS.

Related docs:
- [OVERVIEW.md](./OVERVIEW.md)
- [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md)
- [API_V2_REFERENCE.md](./API_V2_REFERENCE.md)

## Stack

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Axios
- Zustand
- minimal CSS in `src/index.css`

## Route Surface

### Auth
- `/ui/login`
- `/ui/register`

### Main app
- `/ui`
- `/ui/dashboard`
- `/ui/projects`
- `/ui/projects/:projectId`
- `/ui/projects/:projectId/chapters/:chapterId`

### Review/admin
- `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review`
- `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review`
- `/ui/admin`
- `/ui/admin/users`

## Current Folder Layout

| Path | Purpose |
| --- | --- |
| `src/app` | router and providers |
| `src/api` | typed `/api/v2` calls |
| `src/features` | feature modules |
| `src/pages` | route pages |
| `src/stores` | session store |
| `src/types` | API contracts |
| `src/test` | frontend test helpers and fixtures |

## State Ownership

### TanStack Query
Used for server state:
- session bootstrap queries
- dashboard
- projects and project detail
- chapter detail and file lists
- notifications
- admin reads
- technical review
- structuring review metadata

### Zustand
Used only for lightweight session/bootstrap state:
- authenticated/anonymous/error state
- current viewer snapshot
- handoff guard flag

## Current `/ui` Ownership

Fully frontend-owned UX now includes:
- auth entry routes
- dashboard
- projects list
- project detail
- chapter detail
- chapter mutations
- file actions
- upload/versioning result rendering
- processing entry/status messaging
- technical review page
- structuring review shell
- admin dashboard and admin users

## What The Frontend Does Not Own

The frontend deliberately does not own:
- session cookie issuance
- token parsing
- WOPI callbacks
- Collabora URL generation
- backend editor lifecycle
- file storage rules
- processing engine behavior

## SSR Fallback Status

SSR is no longer the primary UX path for auth or core CMS flows, but some backend links remain intentionally available:
- login/register/logout fallback
- project-create fallback
- activities page
- editor launch wrappers

The frontend should not be extended by reintroducing SSR dependencies for normal `/ui` flows.

## Current Auth Status

### Primary
- `/ui/login`
- `/ui/register`

### Fallback-only
- `/login`
- `/register`
- `/logout`

See [AUTH_AND_SESSION.md](./AUTH_AND_SESSION.md).
