# Auth SSR Retirement Plan

## Goal

Replace SSR-owned auth pages with frontend-owned auth flows while keeping authentication and session issuance inside the current FastAPI backend.

This plan assumes:

- `/ui` is the primary operational interface
- backend-issued cookie auth remains the browser session mechanism
- backend-owned editor/WOPI boundaries remain unchanged
- no separate auth service is introduced now

## 1. Current SSR Auth Routes And Templates

### Active SSR auth routes

| Route | Method | Current owner | Current behavior |
| --- | --- | --- | --- |
| `/login` | `GET` | [web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) | renders [login.html](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/login.html) |
| `/login` | `POST` | [web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) | validates credentials, sets `access_token` cookie, redirects to `/dashboard`, or re-renders `login.html` with error |
| `/logout` | `GET` | [web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) | clears cookie and redirects to `/login` |
| `/register` | `GET` | [web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) | renders [register.html](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/register.html) |
| `/register` | `POST` | [web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) | creates user, bootstraps roles if needed, assigns first user Admin else Viewer, redirects to `/login?msg=Registration successful! Please login.`, or re-renders `register.html` with error |

### Current SSR auth templates

| Template | Notes |
| --- | --- |
| [login.html](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/login.html) | standalone page, not based on `base_tailwind.html` |
| [register.html](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/register.html) | standalone page, not based on `base_tailwind.html` |

## 2. Existing `/api/v2` Session Contracts Already Available

### `POST /api/v2/session/login`

Source:
- [api_v2.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/api_v2.py)
- [schemas_v2.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/schemas_v2.py)

Current behavior:

- request schema:
  - `username: string`
  - `password: string`
  - `redirect_to: string | null`
- response on success:
  - `status: "ok"`
  - `session.authenticated: true`
  - `session.auth_mode: "cookie"`
  - `session.expires_at`
  - `viewer`
  - `redirect_to`
- side effect:
  - sets `access_token` cookie via backend session service
- error behavior:
  - `401`
  - stable error payload with `code="INVALID_CREDENTIALS"`

### `GET /api/v2/session`

Current behavior:

- source of truth for frontend session bootstrap
- supports both cookie and bearer resolution internally
- frontend currently uses cookie mode
- response when authenticated:
  - `authenticated: true`
  - `viewer`
  - `auth.mode`
  - `auth.expires_at`
- response when not authenticated:
  - `authenticated: false`
  - `viewer: null`
  - `auth.mode: null`

### `DELETE /api/v2/session`

Current behavior:

- clears `access_token` cookie
- returns:
  - `status: "ok"`
  - `redirect_to: "/login"`

### Current frontend consumption state

Already used by frontend:

- `GET /api/v2/session`
- `DELETE /api/v2/session`

Exists but is not yet used by frontend:

- `POST /api/v2/session/login`

## 3. Missing Backend Auth Endpoints

### Missing for frontend auth retirement

The main missing backend contract is:

| Missing endpoint | Why it is needed |
| --- | --- |
| frontend-facing registration endpoint under `/api/v2` | There is currently no `/api/v2` registration contract; registration exists only as SSR `POST /register` |

### Recommended minimal backend addition later

Not for this step, but required before actual SSR auth retirement:

- `POST /api/v2/session/register` or equivalent `/api/v2/auth/register`

It should reuse the existing backend logic in [auth_service.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/domains/auth/auth_service.py), including:

- password confirmation check
- duplicate username/email rejection
- default-role bootstrap
- first-user Admin assignment

### Not missing

The following do not require new backend contracts for auth retirement:

- session bootstrap
- login credential validation
- cookie issuance
- logout
- role visibility for navigation

Those are already available through current backend session contracts and the existing `viewer.roles` model.

## 4. Frontend Routes And Pages Needed

### New frontend routes needed

| Route | Purpose | Backend dependency |
| --- | --- | --- |
| `/ui/login` | frontend-owned login page | `POST /api/v2/session/login` |
| `/ui/register` | frontend-owned registration page | missing `/api/v2` register endpoint |

### Existing frontend route behavior to preserve/update

| Existing area | Current behavior | Planned auth-retirement change |
| --- | --- | --- |
| [SessionGate](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/features/session/SessionGate.tsx) | redirects anonymous users to backend `/login` | redirect to `/ui/login` once frontend login is ready |
| shared logout action | uses `DELETE /api/v2/session`, then backend login redirect hint | redirect to `/ui/login` in frontend after cookie clear |
| [AppLayout](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/components/layout/AppLayout.tsx) | role-aware nav via `viewer.roles` | keep same source of truth |

### Frontend pages/components needed

- `LoginPage`
  - real form, not current SSR handoff placeholder
  - username/password submit
  - loading/error state
  - authenticated-user redirect away from login
- `RegisterPage`
  - username/email/password/confirm password form
  - loading/error/success state
  - success handoff to `/ui/login`
- `AuthLayout` or unauthenticated page shell
  - simple auth-only layout without app navigation
- optional `RequireRole` wrapper
  - for frontend UX only
  - backend remains the real authorization gate

## 5. Cookie And Session Implications

### Cookie behavior that must remain backend-owned

Source:
- [session_service.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/domains/auth/session_service.py)

Current backend behavior:

- cookie name: `access_token`
- cookie value format: `Bearer <jwt>`
- browser-visible surrounding quotes may appear as cookie serialization artifacts
- cookie is `httponly`
- frontend must not parse the token directly

### Frontend implication

The frontend should continue to treat `GET /api/v2/session` as the only source of truth for:

- authenticated vs anonymous state
- current viewer identity
- roles
- auth mode
- session expiry

### Logout implication

Frontend logout should remain:

1. call `DELETE /api/v2/session`
2. clear local session state
3. navigate to frontend login route after retirement

### Protected-route implication

Protected `/ui` routes should continue using session bootstrap plus redirect behavior.

Current behavior:

- anonymous viewer -> backend `/login`

Target behavior after retirement:

- anonymous viewer -> `/ui/login`

### Editor/WOPI implication

No change:

- backend-owned editor launch wrappers remain separate from frontend auth pages
- backend-issued browser cookie remains the session primitive
- no separate identity provider or token broker is introduced

## 6. Migration Order

### Phase A: frontend login using existing backend session contract

1. Implement real `/ui/login`.
2. Submit credentials to `POST /api/v2/session/login`.
3. Preserve backend cookie issuance exactly.
4. After success, navigate into `/ui/dashboard` or requested target.
5. Update `SessionGate` to redirect anonymous users to `/ui/login` instead of backend `/login`.

### Phase B: frontend logout completion

1. Keep using `DELETE /api/v2/session`.
2. Change frontend post-logout destination from backend login to `/ui/login`.
3. Preserve backend cookie-clearing behavior unchanged.

### Phase C: backend register contract addition

1. Add a frontend-facing `/api/v2` register endpoint that reuses current backend registration logic.
2. Preserve first-user Admin bootstrap behavior exactly.
3. Preserve current duplicate-user and password-mismatch behavior semantics.

### Phase D: frontend register page

1. Implement `/ui/register`.
2. Use the new `/api/v2` register contract.
3. On success, hand off to `/ui/login` with success message.

### Phase E: tighten protected-route UX

1. Keep `GET /api/v2/session` as the bootstrap source of truth.
2. Add route-level frontend guards for:
   - authenticated-only pages
   - admin-only UX surfaces
3. Keep backend authorization unchanged as the real enforcement layer.

### Phase F: retire SSR auth pages

Only after frontend login/register/logout parity is verified:

- stop routing primary auth traffic to `/login`
- stop routing primary auth traffic to `/register`
- keep temporary SSR fallback during rollout if needed

## 7. Rollback Plan

### Immediate rollback path

Because backend auth logic stays in place, rollback is simple:

- revert frontend auth routes to hand off to backend `/login`
- leave backend session issuance untouched
- leave SSR login/register templates and routes active

### Safe rollback points

| Migration point | Rollback method |
| --- | --- |
| frontend login rollout | switch `SessionGate` redirect back to backend `/login` |
| frontend logout rollout | navigate to backend `/login` after `DELETE /api/v2/session` |
| frontend register rollout | restore links/buttons to backend `/register` |
| protected-route changes | fall back to current backend-login handoff behavior |

### Why rollback risk is low

- auth token issuance stays in the backend
- cookie behavior stays in the backend
- existing SSR routes can remain operational during the transition
- WOPI/editor boundaries are unaffected

## 8. Reasons To Keep Auth Inside The Backend Now

### 1. The backend already owns the real auth logic

Current backend logic already handles:

- password verification
- token creation
- cookie issuance
- logout cookie clearing
- first-user role bootstrap
- default role assignment

Splitting that out now would add architectural risk without improving release readiness.

### 2. The frontend does not need direct token ownership

The current browser model is cookie-based.

The frontend already works correctly with:

- `POST /api/v2/session/login`
- `GET /api/v2/session`
- `DELETE /api/v2/session`

That is enough to retire SSR auth pages without introducing a separate auth subsystem.

### 3. Backend-owned editor/WOPI flows already depend on the same browser session model

Keeping auth in the current backend avoids introducing new cross-origin or cross-service session complexity around:

- editor launch wrappers
- WOPI callback assumptions
- backend-owned file access

### 4. Internal-release risk is lower

Replacing SSR auth pages is already a visible change.

Changing auth architecture at the same time would combine:

- UI migration risk
- session model risk
- editor boundary risk

That is unnecessary for the current goal.

## Proposed End State For Auth Retirement

### Frontend-owned

- `/ui/login`
- `/ui/register`
- protected-route redirects
- role-aware navigation and auth UX

### Backend-owned

- credential verification
- registration logic
- JWT creation
- `access_token` cookie issuance and clearing
- session bootstrap response
- authorization decisions
- editor/WOPI boundary behavior

## Final Recommendation

Use the current backend as the auth system of record and retire SSR auth in this order:

1. frontend login on existing `/api/v2/session/login`
2. frontend logout on existing `DELETE /api/v2/session`
3. add one backend `/api/v2` register contract
4. frontend register
5. switch protected-route handoff from backend `/login` to `/ui/login`
6. keep SSR auth pages as rollback fallback until parity is confirmed

That is the lowest-risk path to retire SSR auth without changing backend session ownership or touching the WOPI/editor boundary.
