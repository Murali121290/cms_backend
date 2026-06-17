# Security Model

Related docs:

- [Router Layer](router_layer.md)
- [File Workflow](file_workflow.md)
- [WOPI Integration](wopi_integration.md)
- [Known Constraints](known_constraints.md)

## Authentication Modes

The backend currently supports two primary auth modes plus several mixed compatibility paths.

| Mode | Main code | Used by |
| --- | --- | --- |
| Cookie-backed browser auth | [`app/auth.py`](../../app/auth.py), [`app/services/session_service.py`](../../app/services/session_service.py) | SSR pages, processing routes, structuring routes, editor shell, notifications, activities |
| Bearer token auth | [`app/auth.py`](../../app/auth.py) | `/api/v1/users/*`, most `/api/v1/projects/*`, `/api/v1/files/`, `/api/v1/teams/*` |
| Mixed compatibility | router-specific | `/api/v1/projects/{project_id}` delete uses cookie auth inside an otherwise bearer-oriented router |

## Cookie Authentication

Browser login:

1. `POST /login`
2. `auth_service.authenticate_browser_user(...)`
3. `session_service.build_login_redirect_response(...)`
4. `access_token` cookie is set to:

`Bearer <jwt>`

The cookie is set with:

- `httponly=True`

It is not explicitly set with:

- `secure=True`
- `samesite=...`

Logout deletes the same cookie and redirects to `/login`.

## Bearer Authentication

Bearer auth uses `OAuth2PasswordBearer` and `get_current_user` in [`app/auth.py`](../../app/auth.py).

The bearer login route is:

- `POST /api/v1/users/login`

It returns:

```json
{"access_token": "<jwt>", "token_type": "bearer"}
```

## Role Enforcement

### Generic RBAC helper

[`app/rbac.py`](../../app/rbac.py) exposes `require_role(role_name)`, which checks the current bearer-authenticated user's role list and raises `403` when missing.

It is used by:

- `POST /api/v1/projects/`
- `PUT /api/v1/projects/{project_id}/status`

### SSR role checks

Many SSR routes perform explicit inline role checks such as:

- `"Admin" not in [r.name for r in user.roles]`

These checks are not fully centralized.

## Processing Permissions

Processing routes use `processing_service.check_permission(...)`, which maps process types to allowed roles. See [Processing Pipeline](processing_pipeline.md) for the exact permission matrix.

## File Lock Ownership Rules

File lock ownership is enforced by [`checkout_service.py`](../../app/services/checkout_service.py).

Rules:

- A user may check out an unlocked file.
- A user may re-check out a file they already own.
- A different user attempting checkout receives redirect feedback that the file is locked by another user.
- Cancel checkout only unlocks when the actor owns the lock.
- Overwrite upload clears lock flags if the actor is allowed to overwrite.
- Processing locks the file to the triggering user before scheduling background work.

## Authorization Gaps Preserved In Current Code

Current route behavior is not uniform:

- `/admin/users/{user_id}/delete` only checks that a cookie-authenticated user exists; it does not enforce `Admin`.
- `/admin/users/{user_id}/edit` likewise only checks for an authenticated user.
- Duplicate password handlers exist, but the first registered one keeps the effective runtime behavior.

These are preserved compatibility behaviors and are not normalized yet.

## CORS

`app.main` configures:

- `allow_origins=["*"]`
- `allow_credentials=True`
- `allow_methods=["*"]`
- `allow_headers=["*"]`

This is the active runtime configuration and is documented here, not endorsed as a future design.

## CSRF

There is no dedicated CSRF token or middleware in the current codebase.

SSR form posts rely on:

- cookie authentication
- route-level auth checks

No CSRF token is rendered or validated by the routes documented here.

## WOPI Security Boundary

The WOPI callback routes are intentionally unauthenticated:

- `/wopi/files/{file_id}`
- `/wopi/files/{file_id}/contents`
- `/wopi/files/{file_id}/structuring`
- `/wopi/files/{file_id}/structuring/contents`

The browser-facing editor shell route `/files/{file_id}/edit` still requires cookie auth.

## Role Bootstrap

Roles are created in two places:

- application startup in [`app/main.py`](../../app/main.py)
- browser registration bootstrap in [`app/services/auth_service.py`](../../app/services/auth_service.py)

The first registered browser user is assigned `Admin`. Later browser users are assigned `Viewer`.
