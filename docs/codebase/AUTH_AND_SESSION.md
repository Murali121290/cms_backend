# Auth And Session

Authentication remains backend-owned. The frontend now owns the auth pages and route handoffs, but not session issuance.

Related docs:
- [FRONTEND.md](./FRONTEND.md)
- [API_V2_REFERENCE.md](./API_V2_REFERENCE.md)
- [KNOWN_BOUNDARIES_AND_TECH_DEBT.md](./KNOWN_BOUNDARIES_AND_TECH_DEBT.md)

## Current Primary Auth Entry Points

### Frontend-owned
- `/ui/login`
- `/ui/register`

Current behavior:
- unauthenticated protected `/ui` routes redirect to `/ui/login`
- authenticated users are redirected away from `/ui/login` and `/ui/register`
- frontend logout lands on `/ui/login`

## SSR Auth Routes Retained As Fallback

The following backend routes remain live in `app/routers/web.py`:

| Route | Method | Current role |
| --- | --- | --- |
| `/login` | `GET` | SSR fallback login page |
| `/login` | `POST` | SSR fallback login submit |
| `/register` | `GET` | SSR fallback registration page |
| `/register` | `POST` | SSR fallback register submit |
| `/logout` | `GET` | SSR fallback logout |

These are fallback-only. They are still kept for rollback and should not be removed until after a stable release cycle.

## Backend Session Contracts

### `POST /api/v2/session/login`
- validates credentials
- sets `access_token` cookie
- returns viewer and redirect hint

### `POST /api/v2/session/register`
- reuses existing backend registration logic
- preserves:
  - password confirmation validation
  - duplicate username/email rejection
  - first-user Admin bootstrap
  - default Viewer assignment afterward
- does not auto-login

### `GET /api/v2/session`
- source of truth for frontend session bootstrap
- returns authenticated/anonymous plus viewer and auth mode

### `DELETE /api/v2/session`
- clears the cookie
- frontend then clears local state and navigates to `/ui/login`

## Cookie Model

Cookie behavior is still owned by backend session helpers in `app/domains/auth/session_service.py`.

Current contract:
- cookie name: `access_token`
- value format: `Bearer <jwt>`
- browser-visible quotes may appear as cookie serialization artifacts
- frontend does not read or store the token
- frontend trusts `GET /api/v2/session`, not cookie parsing

## Registration Semantics

Backend registration behavior remains unchanged:
- password and confirm-password must match
- duplicate username or email is rejected
- first registered user receives `Admin`
- later users receive `Viewer`
- SSR register still redirects to backend `/login?msg=...`
- `/api/v2/session/register` returns JSON and leaves the user anonymous

## Protected Route Behavior

Current frontend route guard:
1. query `GET /api/v2/session`
2. if authenticated, render `/ui`
3. if anonymous, redirect to `/ui/login`
4. if query fails, show frontend error state with SSR dashboard fallback link for recovery

## Current Ownership Boundary

### Frontend-owned
- login form UX
- register form UX
- anonymous handoff routing
- logout UX

### Backend-owned
- password verification
- role bootstrap
- JWT creation
- cookie issuance and clearing
- authorization enforcement
- session bootstrap payload
- editor/WOPI access boundary

## Current Status

- frontend auth cutover is complete for normal `/ui` flows
- SSR auth remains fallback-only
- no separate auth service exists and none is needed for the current architecture
