# Auth SSR Deprecation Status

## Status
Frontend auth is now the primary entry path for the CMS UI. SSR auth remains retained as rollback fallback only.

## 1. Current Primary Auth Entry Points

### Frontend routes
- `GET /ui/login`
  - Owned by `frontend/src/pages/LoginPage.tsx`
  - Mounted in `frontend/src/app/router.tsx`
  - Uses `POST /api/v2/session/login`
  - Redirects authenticated users to `/ui/dashboard`
- `GET /ui/register`
  - Owned by `frontend/src/pages/RegisterPage.tsx`
  - Mounted in `frontend/src/app/router.tsx`
  - Uses `POST /api/v2/session/register`
  - Redirects authenticated users to `/ui/dashboard`
  - Redirects successful registration to `/ui/login`

### Protected route behavior
- Protected `/ui` routes are guarded by `frontend/src/features/session/SessionGate.tsx`
- Session bootstrap uses `GET /api/v2/session`
- Anonymous users are redirected to `/ui/login`

### Frontend logout behavior
- Logout is frontend-owned for `/ui` flows through `frontend/src/features/session/useLogout.ts`
- Uses `DELETE /api/v2/session`
- Clears Zustand session state
- Clears TanStack Query cache
- Navigates to `/ui/login`

## 2. SSR Auth Routes Still Retained As Fallback

These routes are still active in `app/routers/web.py` and must remain available for rollback until removal criteria are met.

| Route | Method | Current behavior | Template / response |
| --- | --- | --- | --- |
| `/login` | `GET` | Renders legacy login page | `app/templates/login.html` |
| `/login` | `POST` | Authenticates user, sets cookie, redirects to `/dashboard` | redirect |
| `/logout` | `GET` | Clears cookie, redirects to `/login` | redirect |
| `/register` | `GET` | Renders legacy registration page | `app/templates/register.html` |
| `/register` | `POST` | Registers user, preserves first-user Admin bootstrap and later Viewer assignment, redirects to `/login?msg=Registration successful! Please login.` | redirect / template error render |

These routes remain rollback-capable because backend auth/session logic is still owned by:
- `app/domains/auth/auth_service.py`
- `app/domains/auth/session_service.py`

## 3. Confirmation Of Frontend Dependency Removal

Frontend runtime auth flow no longer depends on SSR `/login`, `/register`, or `/logout` as the primary path.

Confirmed current usage:
- `frontend/src/app/router.tsx` mounts `/ui/login` and `/ui/register`
- `frontend/src/features/session/SessionGate.tsx` redirects anonymous users to `/ui/login`
- `frontend/src/features/session/useLogout.ts` navigates to `/ui/login`
- `frontend/src/pages/LoginPage.tsx` links to `/ui/register`
- `frontend/src/pages/RegisterPage.tsx` links back to `/ui/login`

Confirmed non-usage:
- No current frontend runtime module uses `ssrPaths.login`
- No current frontend runtime module uses `ssrPaths.logout`
- No current frontend runtime auth link hands users off to backend `/login`, `/register`, or `/logout`

Remaining backend-owned auth dependency:
- Cookie issuance and cookie clearing still happen only in the backend through `/api/v2/session/login` and `/api/v2/session`

## 4. Rollback Instructions

If the frontend auth flow becomes unstable during the release window:

1. Direct users to backend SSR auth routes:
   - `/login`
   - `/register`
   - `/logout`
2. Keep `/api/v2/session`, `/api/v2/session/login`, `/api/v2/session/register`, and `/api/v2/session` delete unchanged.
3. Preserve the existing cookie contract; do not change cookie names or token format during rollback.
4. If necessary, temporarily communicate backend auth URLs to internal users while `/ui` auth issues are triaged.
5. Do not remove `login.html` or `register.html` during the rollback window.

Operational rollback note:
- Because SSR auth routes are still live in `app/routers/web.py`, rollback requires no backend redeploy-level feature rewrite. It is an entry-point change, not an auth-system change.

## 5. Removal Criteria After One Stable Internal Release Cycle

SSR auth routes should not be removed until all of the following are true for one full internal release cycle:

1. `/ui/login` and `/ui/register` complete manual QA successfully in the deployed environment.
2. Backend regression remains green, including auth regression and `/api/v2` session contract coverage.
3. Frontend tests, typecheck, and production build remain green.
4. No open internal-release defects require fallback to SSR auth.
5. Internal users are no longer being directed to `/login` or `/register` as the default path.
6. Logout from `/ui` is verified to clear session state and land on `/ui/login` consistently.
7. First-user bootstrap, duplicate-user rejection, password-confirmation rejection, and authenticated-user redirect behavior are verified on the frontend path.
8. Support and release docs point to `/ui/login` and `/ui/register`, not SSR auth URLs.
9. Manual rollback drill confirms SSR auth still works before final removal decision.

## Removal Readiness Outcome

Current state:
- frontend auth is primary
- SSR auth is fallback-only
- backend auth/session logic remains the system of record

Not ready for code removal yet:
- SSR `/login`
- SSR `/register`
- SSR `/logout`
- `app/templates/login.html`
- `app/templates/register.html`

These should remain until one stable internal release cycle completes with no fallback requirement.
