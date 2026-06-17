# Frontend Step 1 Plan

Static planning only. This document defines the first frontend module to build against the current `/api/v2` surface. It does not change backend behavior and does not assume any frontend code exists yet.

Source of truth:

- [api_v2_reference.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/architecture/api_v2_reference.md)
- [api_v2.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/api_v2.py)
- [schemas_v2.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/schemas_v2.py)

Step-1 scope only:

- session bootstrap
- dashboard
- projects list
- notifications

Out of scope for this step:

- admin mutations
- chapter detail
- upload/versioning
- processing
- structuring review
- WOPI/editor

## 1. Frontend Routes and Pages

Recommended route strategy for step 1:

- keep existing SSR routes unchanged
- introduce the first frontend module on isolated routes under `/ui`
- do not replace `/dashboard` or `/projects` yet

### Proposed frontend route map

| Frontend route | Purpose | Backend API source | SSR equivalent kept active | Notes |
|---|---|---|---|---|
| `/ui` | lightweight entry route that resolves session and redirects to the frontend dashboard or SSR login | `GET /api/v2/session` | `/` and `/dashboard` | Use this as the frontend shell entry point; do not change current root ownership in step 1. |
| `/ui/dashboard` | frontend dashboard page | `GET /api/v2/session`, `GET /api/v2/dashboard?include_projects=true`, `GET /api/v2/notifications?limit=5` | `GET /dashboard` | Dashboard is the first primary frontend page. |
| `/ui/projects` | frontend project list page | `GET /api/v2/session`, `GET /api/v2/projects`, `GET /api/v2/notifications?limit=5` | `GET /projects` | Keep this read-only in step 1. Do not move project delete here yet. |
| shared shell notification panel | navbar/topbar notification dropdown inside the `/ui/*` shell | `GET /api/v2/notifications?limit=5` | SSR notification dropdown via `GET /api/notifications` | No standalone notifications page is needed in step 1. |

### Route behavior rules

- If `GET /api/v2/session` returns `authenticated: false`, redirect the browser to `/login`.
- Do not replace the current SSR login page in step 1.
- Do not mount the first frontend module on `/dashboard` or `/projects` yet.
- Keep SSR navigation links available and correct while `/ui/*` is evaluated.

## 2. API Endpoints Used

Step-1 must use only the existing `/api/v2` contracts listed below.

### Session bootstrap

| Method | Path | Use in step 1 | Current contract notes |
|---|---|---|---|
| `GET` | `/api/v2/session` | app bootstrap on every `/ui/*` route | Returns `200` for both authenticated and unauthenticated states. Accepts cookie or bearer, but step 1 should use the browser cookie model. |
| `DELETE` | `/api/v2/session` | frontend logout action from the `/ui` shell | Clears the same cookie used by SSR and returns `redirect_to: "/login"`. |

Step-1 should not use `POST /api/v2/session/login` for the initial rollout because the current login page remains SSR-owned.

### Dashboard

| Method | Path | Use in step 1 | Current contract notes |
|---|---|---|---|
| `GET` | `/api/v2/dashboard` | primary dashboard data source | Returns `viewer`, `stats`, and `projects`. `include_projects=false` exists but is not needed for step 1. |

### Projects list

| Method | Path | Use in step 1 | Current contract notes |
|---|---|---|---|
| `GET` | `/api/v2/projects?offset=0&limit=100` | project list page data source | Returns `projects[]` plus `pagination`. Step 1 should treat this as read-only. |

### Notifications

| Method | Path | Use in step 1 | Current contract notes |
|---|---|---|---|
| `GET` | `/api/v2/notifications?limit=5` | notification bell/dropdown inside the `/ui` shell | Returns upload-only items with synthetic IDs of the form `file:{id}:upload`. |

## 3. State Models

Step-1 should keep frontend state close to the backend DTOs and avoid creating parallel domain models unless required by rendering.

### Session bootstrap state

Derived from `SessionGetResponse`.

| State field | Source | Notes |
|---|---|---|
| `status` | frontend-only | one of `loading`, `authenticated`, `anonymous`, `error` |
| `authenticated` | `session.authenticated` | direct pass-through |
| `viewer` | `session.viewer` | use backend DTO unchanged |
| `authMode` | `session.auth.mode` | should be `"cookie"` in normal browser use |
| `expiresAt` | `session.auth.expires_at` | nullable |

Recommended usage:

- bootstrap once at the shell level
- expose viewer identity to both dashboard and projects pages
- do not duplicate role parsing in page components

### Dashboard page state

Derived from `DashboardResponse`.

| State field | Source | Notes |
|---|---|---|
| `viewer` | `dashboard.viewer` | same viewer DTO shape as session bootstrap |
| `stats` | `dashboard.stats` | use as-is for metric cards |
| `projects` | `dashboard.projects` | use as-is for compact project cards/list |
| `notifications` | `NotificationsResponse.notifications` | shell-level state injected into dashboard shell |

Recommended view model splits:

- `DashboardMetricsViewModel`
- `DashboardProjectCardViewModel`

These should be thin projections of the API response, not new business contracts.

### Projects list state

Derived from `ProjectsListResponse`.

| State field | Source | Notes |
|---|---|---|
| `projects` | `projects.projects` | use `ProjectSummary` directly |
| `pagination` | `projects.pagination` | offset/limit/total from the API |
| `viewer` | session bootstrap | do not refetch viewer from a separate endpoint |
| `notifications` | shell notification state | shared shell concern |

Recommended local UI state:

- `searchTerm`
- `sortKey`
- `sortDirection`

These are frontend-only presentation states and should not be pushed into backend contracts in step 1.

### Notification state

Derived from `NotificationsResponse`.

| State field | Source | Notes |
|---|---|---|
| `notifications` | `notifications.notifications` | current payload contains upload-only items |
| `refreshedAt` | `notifications.refreshed_at` | use for polling freshness or tooltip text |
| `status` | frontend-only | one of `idle`, `loading`, `refreshing`, `error` |

Recommended polling behavior:

- initial fetch on shell load after session bootstrap succeeds
- lightweight periodic refresh only inside `/ui/*`
- do not alter SSR notification polling in step 1

## 4. Loading, Error, and Empty States

### Session bootstrap

| Situation | Required UI behavior | Backend behavior to preserve |
|---|---|---|
| loading | full-page shell loader or splash state | no SSR route changes |
| authenticated | continue to route content | use existing cookie session unchanged |
| anonymous | redirect to `/login` | keep SSR login page as the entry point |
| bootstrap error | show retry state and a fallback link to `/dashboard` or reload | do not clear cookie or alter auth logic automatically |

### Dashboard

| Situation | Required UI behavior | Notes |
|---|---|---|
| loading | skeleton metrics + skeleton project list/cards | use shell viewer state if already available |
| error | inline error panel with retry | provide fallback link to SSR `/dashboard` |
| empty projects | empty-state card with “No projects yet” messaging | link can target existing SSR `/projects/create` |
| partial notifications failure | keep dashboard visible, mark notifications as unavailable | notifications must not block dashboard rendering |

### Projects list

| Situation | Required UI behavior | Notes |
|---|---|---|
| loading | table/list skeleton | |
| error | inline error with retry and fallback link to SSR `/projects` | |
| empty | empty-state panel with no-projects message | optional link to SSR `/projects/create` |
| pagination edge | disable next/previous controls appropriately | use API `pagination.total` as the source of truth |

### Notifications

| Situation | Required UI behavior | Notes |
|---|---|---|
| loading | subtle bell spinner or dropdown placeholder | do not block the whole shell |
| error | non-blocking error state inside the dropdown | keep the rest of the page usable |
| empty | “No recent uploads” | current API only returns upload notifications |
| refresh in progress | keep prior items visible while refreshing | avoid dropdown flicker |

## 5. SSR Coexistence Strategy

Step-1 coexistence rule: new frontend routes are additive, not substitutive.

### Keep these SSR routes unchanged

- `/login`
- `/logout`
- `/dashboard`
- `/projects`
- `/api/notifications`

### Coexistence model

| Area | Step-1 strategy |
|---|---|
| auth entry | keep `/login` SSR-owned; the frontend shell only consumes session state after login succeeds |
| dashboard | expose new frontend page at `/ui/dashboard`; keep `/dashboard` as the stable fallback |
| projects list | expose new frontend page at `/ui/projects`; keep `/projects` as the stable fallback |
| notifications | frontend shell uses `/api/v2/notifications`; legacy SSR pages continue using `/api/notifications` |
| layout | build a frontend-only shell for `/ui/*`; do not inject large new frontend logic into current Jinja templates |

### Navigation strategy

- Step 1 should not replace global SSR navigation.
- Add a bounded way to access `/ui/dashboard` and `/ui/projects` without removing current links.
- Keep direct SSR routes usable at all times.

## 6. Rollback Strategy

Rollback must be route-level, not system-wide.

### Rollback rules

- if `/ui/dashboard` fails, users can still use `/dashboard`
- if `/ui/projects` fails, users can still use `/projects`
- if the `/ui` shell fails to bootstrap session, redirect to `/login` and keep SSR entry unchanged
- do not repurpose or delete any SSR template or route in step 1

### Operational rollback plan

| Failure area | Rollback action |
|---|---|
| frontend shell bootstrap | remove or disable `/ui/*` route exposure and return users to SSR links |
| dashboard rendering bug | route users back to `/dashboard` |
| projects list rendering bug | route users back to `/projects` |
| notifications UI bug | disable frontend polling and keep SSR notification behavior unchanged |

### Contract rollback safety

- no backend contract changes are required for rollback
- no SSR route changes are required for rollback
- no `/api/v1` route should be introduced into step 1 as a hidden fallback

## 7. Recommended Component Structure

This structure is intentionally limited to the step-1 scope and uses the existing `/api/v2` contracts.

### Recommended module layout

```text
frontend/
  src/
    app/
      routes/
        ui-root
        ui-dashboard
        ui-projects
      shell/
        ui-shell
        route-guard
    features/
      session/
        api
        hooks
        models
      dashboard/
        api
        hooks
        models
        components
      projects/
        api
        hooks
        models
        components
      notifications/
        api
        hooks
        models
        components
    components/
      layout/
      feedback/
      navigation/
```

### Recommended feature responsibilities

| Feature | Responsibilities |
|---|---|
| `session` | bootstrap `GET /api/v2/session`, expose viewer state, handle frontend logout via `DELETE /api/v2/session`, perform route guarding for `/ui/*` |
| `dashboard` | fetch and render `GET /api/v2/dashboard`, map dashboard stats to cards, render compact project summaries |
| `projects` | fetch and render `GET /api/v2/projects`, own search/sort/pagination presentation state |
| `notifications` | fetch and refresh `GET /api/v2/notifications`, render bell and dropdown list |

### Recommended shared components

| Component | Purpose |
|---|---|
| `UiShell` | authenticated shell for `/ui/*`, owns header/nav/notification slot |
| `SessionGate` | blocks page render until session bootstrap resolves |
| `PageHeader` | shared page title/subtitle layout |
| `StatsGrid` | dashboard stats presentation |
| `ProjectList` | reusable project list/table/card renderer |
| `NotificationBell` | shell notification trigger and dropdown |
| `LoadingState` | shared loading view |
| `ErrorState` | shared retry/fallback view |
| `EmptyState` | shared empty-data view |

### Component boundary rules for step 1

- page components should not implement auth logic directly
- API calls should be feature-owned, not scattered through UI components
- notifications belong to the shell, not duplicated inside each page
- dashboard and projects list should share `ProjectSummary` rendering primitives where possible
- do not add component dependencies on chapter detail, admin, upload, processing, or editor concerns in step 1

## Recommended Step-1 Outcome

At the end of step 1, the repository should have a first frontend module that:

- boots from `GET /api/v2/session`
- renders a frontend dashboard at `/ui/dashboard`
- renders a frontend projects list at `/ui/projects`
- shows notifications in the shared `/ui` shell
- coexists safely with `/dashboard`, `/projects`, `/login`, `/logout`, and `/api/notifications`
- can be removed cleanly without backend changes if parity or stability is not acceptable
