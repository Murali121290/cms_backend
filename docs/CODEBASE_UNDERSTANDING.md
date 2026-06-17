# Codebase Understanding — S4 Carlisle Publishing CMS

> Generated: 2026-03-18
> Source: full static read of `cms_backend-codex` repository

---

## 1. Project Structure

```
cms_backend-codex/
├── app/                        FastAPI CMS backend
│   ├── main.py                 App entrypoint, router registration, role seeding
│   ├── auth.py                 Cookie auth dependency
│   ├── database.py             SQLAlchemy session factory
│   ├── models/                 SQLAlchemy ORM models
│   ├── schemas.py              Legacy Pydantic schemas
│   ├── schemas_v2.py           API v2 Pydantic schemas
│   ├── core/
│   │   ├── config.py           Pydantic-settings (Settings class)
│   │   ├── paths.py            Runtime directory config (CMS_RUNTIME_ROOT)
│   │   └── celery_app.py       Celery instance (defined but unused in CMS)
│   ├── domains/                Slice-organized domain routers
│   │   ├── auth/api_v1.py      Legacy /api/v1/users routes
│   │   ├── files/api_v1.py     Legacy /api/v1/files routes
│   │   └── projects/           Legacy /api/v1/projects + teams routes
│   ├── legacy/
│   │   └── web.py              Jinja2 SSR router (still active, all /projects, /admin, etc.)
│   ├── routers/
│   │   ├── api_v2.py           Single-file API v2 router (1867 lines, all React-facing endpoints)
│   │   ├── processing.py       /api/v1/processing endpoints
│   │   ├── structuring.py      /api/v1/files/{id}/structuring/review shell
│   │   └── wopi.py             (imported via app/integrations/wopi/)
│   ├── services/               Domain service layer
│   ├── processing/             Engine adapters (structuring, technical, references, bias, AI, XML)
│   ├── integrations/
│   │   ├── collabora/          Collabora URL builder
│   │   └── wopi/               WOPI callback router (unauthenticated)
│   └── utils/
├── frontend/                   React TypeScript SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx            React DOM root mount
│       ├── index.css           Tailwind v4 @theme design tokens + keyframes
│       ├── vite-env.d.ts
│       ├── app/
│       │   ├── router.tsx      React Router v6 browser router
│       │   └── providers.tsx   QueryClientProvider + RouterProvider + ToastContainer
│       ├── api/                Typed Axios client modules
│       ├── features/           Feature modules (hooks + sub-components)
│       ├── pages/              Page-level components
│       ├── components/
│       │   ├── layout/         AppLayout (sidebar + topbar)
│       │   └── ui/             18 primitive UI components
│       ├── stores/             Zustand stores
│       ├── hooks/              Generic hooks
│       ├── types/              Shared TypeScript types
│       └── utils/              appPaths, cn
├── ai_structuring_backend/     Flask AI structuring microservice (optional)
├── nginx/nginx.conf            Nginx reverse proxy config
├── docker-compose.yml          All services definition
└── tests/                      Backend pytest suite (6 files)
```

**There is no `/ui` path served by the backend.** The React SPA is served at the root `/ui` prefix by the Vite dev server proxy (port 5173) which forwards `/api` to FastAPI on port 8000. In production, nginx at port 8080 forwards everything to `backend:8000`; the React build must be served separately or embedded in a static mount that the nginx config does not currently define.

---

## 2. Frontend

### 2.1 Stack & Tooling

| Concern | Library / Version |
|---|---|
| Runtime | React 18.3.1 |
| Build | Vite 5.4.11 |
| Language | TypeScript 5.7.2 |
| Routing | React Router DOM 6.30.0 |
| Server state | TanStack React Query 5.68.0 |
| Client state | Zustand 5.0.3 |
| HTTP | Axios 1.8.4 |
| CSS | Tailwind CSS v4 via `@tailwindcss/vite` |
| Icons | lucide-react 0.577.0 |
| Forms | react-hook-form 7.71.2 + @hookform/resolvers + Zod 4.3.6 (installed but not yet used in pages — pages use plain `useState` forms) |
| Testing | Vitest 4.1.0 + @testing-library/react 16.3.2 + jsdom |

**Vite dev proxy**: all `/api` requests are forwarded to `http://127.0.0.1:8000` (configurable via `VITE_DEV_PROXY_TARGET`).

**Path aliases**: `@` → `src/`.

**Environment variables used**:
- `VITE_API_BASE_URL` — overrides the API base URL (defaults to `/api/v2`)
- `VITE_DEV_PROXY_TARGET` — overrides the proxy target (defaults to `http://127.0.0.1:8000`)

### 2.2 All Routes

Defined in `src/app/router.tsx`. The SPA root is `/ui` (the `uiPaths.root` constant).

| React Route Path | Component | Auth Required | Notes |
|---|---|---|---|
| `/ui/login` | `LoginPage` | No | Checks session, redirects if already authed |
| `/ui/register` | `RegisterPage` | No | Checks session, redirects if already authed |
| `/ui` | Redirect → `/ui/dashboard` | Yes (SessionGate) | Index redirect |
| `/ui/dashboard` | `DashboardPage` | Yes | Stats + recent projects |
| `/ui/admin` | `AdminDashboardPage` | Yes | Admin-only in practice (no frontend route guard; backend enforces) |
| `/ui/admin/users` | `AdminUsersPage` | Yes | User CRUD |
| `/ui/projects` | `ProjectsPage` | Yes | Paginated project list |
| `/ui/projects/:projectId` | `ProjectDetailPage` | Yes | Chapters + overview tabs |
| `/ui/projects/:projectId/chapters/:chapterId` | `ChapterDetailPage` | Yes | Section sidebar + file table + upload panel |
| `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review` | `TechnicalReviewPage` | Yes | Technical scan + apply |
| `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review` | `StructuringReviewPage` | Yes | Collabora iframe + structuring save |
| `*` | Redirect → `/ui` | — | Catch-all |

**SessionGate** wraps all authenticated routes. It calls `GET /api/v2/session`, shows a loading overlay, then either renders children or redirects to `/ui/login`.

### 2.3 Component Inventory

#### Layout (`src/components/layout/`)

| Component | Description |
|---|---|
| `AppLayout` | Shell: 240px navy sidebar + 56px white topbar + `<Outlet />`. Handles logout via `useLogout`. Reads viewer from `sessionStore`. |
| `Sidebar` | Brand logo (fetched via `getSsrUrl("/static/images/S4c.png")`), primary nav, admin nav (conditional), user card, logout button. |
| `TopBar` | Dynamic breadcrumbs built from `useLocation().pathname` + `NotificationBell` + user display button. |

#### UI Primitives (`src/components/ui/`)

| Component | Export | Description |
|---|---|---|
| `Button.tsx` | `Button` | Variants: primary, secondary, ghost, danger. Sizes: sm, md, lg. Props: leftIcon, rightIcon, isLoading. |
| `Badge.tsx` | `Badge` | Variants: default, success, warning, error, info. Sizes: sm, md. |
| `StatusBadge.tsx` | `StatusBadge` | Maps status strings to semantic colors. |
| `Card.tsx` | `Card`, `CardHeader`, `CardContent`, `CardFooter` | Composable card primitives. |
| `PageHeader.tsx` | `PageHeader` | title, subtitle, badge, breadcrumb, primaryAction, secondaryActions. |
| `Modal.tsx` | `Modal` | Portal-based modal. title, description, size (sm/md/lg/xl), isOpen, onClose. |
| `ConfirmDialog.tsx` | `ConfirmDialog` | Wraps Modal with confirm/cancel buttons. |
| `ProgressBar.tsx` | `ProgressBar` | Percentage bar with optional label. |
| `SkeletonLoader.tsx` | `Skeleton`, `SkeletonText`, `SkeletonCard`, `SkeletonTable` | Loading shimmer states. |
| `EmptyState.tsx` | `EmptyState` | icon, title, description, action, size (sm/md/lg). |
| `SearchInput.tsx` | `SearchInput` | Controlled text input with search icon. |
| `Breadcrumb.tsx` | `Breadcrumb` | BreadcrumbItem list renderer. |
| `Toast.tsx` | `Toast`, `ToastContainer` | Floating toast notification. Mounted in `AppProviders`. |
| `useToast.ts` | `useToast` | Hook to imperatively fire toasts. |
| `DataTable.tsx` | `DataTable` | Generic column-based table with sort indicators. |
| `UploadZone.tsx` | `UploadZone` | Drag-and-drop + click-to-select file zone. |
| `ErrorState.tsx` | `ErrorState` | Error display with retry slot. |
| `LoadingState.tsx` | `LoadingState` | Spinner + title + message. compact prop. |

#### Feature Modules (`src/features/`)

**session/**
- `SessionGate.tsx` — Auth guard wrapper
- `useSessionBootstrap.ts` — Calls `GET /api/v2/session`, syncs to `sessionStore`
- `useLogin.ts` — Mutation: `POST /api/v2/session/login`, updates store + query cache
- `useLogout.ts` — Mutation: `DELETE /api/v2/session`, clears store + cache + navigates to login
- `useRegister.ts` — Mutation: `POST /api/v2/session/register`
- `components/AuthCard.tsx` — Auth form card shell (uses `getSsrUrl` for logo)
- `components/AuthButton.tsx`, `AuthErrorBlock.tsx`, `AuthInput.tsx` — Auth form primitives (defined but not used in pages; pages use raw inputs directly)

**dashboard/**
- `useDashboardQuery.ts` — `GET /api/v2/dashboard`
- `components/DashboardStatsGrid.tsx` — 4-stat card row
- `components/DashboardProjectGrid.tsx` — Project summary grid
- `components/DashboardAdminShortcuts.tsx` — Admin-only shortcuts

**projects/**
- `useProjectsQuery.ts` — `GET /api/v2/projects`
- `useProjectDetailQuery.ts` — `GET /api/v2/projects/:id`
- `useProjectChaptersQuery.ts` — `GET /api/v2/projects/:id/chapters`
- `useChapterDetailQuery.ts` — `GET /api/v2/projects/:pid/chapters/:cid`
- `useChapterFilesQuery.ts` — `GET /api/v2/projects/:pid/chapters/:cid/files`
- `useChapterMutations.ts` — create/rename/delete chapter mutations
- `useChapterFileActions.ts` — download/checkout/cancel-checkout/delete file mutations
- `useChapterUpload.ts` — file upload mutation
- `components/ProjectsTable.tsx` — Projects list table
- `components/ProjectMetadataPanel.tsx` — Project metadata display
- `components/ProjectChaptersTable.tsx` — Chapters table with stage indicators + SSR links for chapter management
- `components/ChapterCreateForm.tsx` — Modal form to create a chapter
- `components/ChapterMetadataPanel.tsx` — Chapter metadata display
- `components/ChapterFilesTable.tsx` — File list per section with action buttons
- `components/ChapterUploadPanel.tsx` — Upload form (category selector + UploadZone)
- `components/ChapterCategorySummary.tsx` — Section card grid + section definitions (CHAPTER_SECTIONS)
- `components/ChapterToolbar.tsx` — View mode toggle + upload trigger

**notifications/**
- `useNotificationsQuery.ts` — `GET /api/v2/notifications` (refetched every render; no polling interval set)
- `components/NotificationBell.tsx` — Bell icon + dropdown in TopBar

**admin/**
- `useAdminDashboardQuery.ts` — `GET /api/v2/admin/dashboard`
- `useAdminUsersQuery.ts` — `GET /api/v2/admin/users`
- `useAdminMutations.ts` — create/update-role/toggle-status/edit/password/delete user mutations
- `components/AdminStatsGrid.tsx` — 4-stat grid
- `components/AdminCreateUserForm.tsx` — Form to create user
- `components/AdminEditUserForm.tsx` — Form to edit email
- `components/AdminPasswordForm.tsx` — Form to change password
- `components/AdminUsersTable.tsx` — Users table with inline role dropdowns

**processing/**
- `useStructuringProcessing.ts` — Start + poll structuring processing. Polls `GET /api/v2/files/:id/processing-status` every 2 s while `status === "processing"`.

**technicalReview/**
- `useTechnicalReviewQuery.ts` — `GET /api/v2/files/:id/technical-review`
- `useTechnicalApply.ts` — `POST /api/v2/files/:id/technical-review/apply`
- `components/TechnicalIssuesForm.tsx` — Issue-by-issue replacement form
- `components/TechnicalReviewFileInfo.tsx` — File metadata panel

**structuringReview/**
- `useStructuringReviewQuery.ts` — `GET /api/v2/files/:id/structuring-review`
- `useStructuringSave.ts` — `POST <save_endpoint>` (URL comes from backend response)
- `components/StructuringReturnAction.tsx` — Return button (either `<a href>` SSR link or `navigate(-1)`)
- `components/StructuringSaveForm.tsx` — JSON textarea for manual structuring changes
- `components/StructuringMetadataPanel.tsx` — Sidebar with file + editor metadata

### 2.4 API Layer

All API calls go through `src/api/client.ts` which creates an Axios instance with:
- `baseURL`: `VITE_API_BASE_URL` env var, or `/api/v2` (relative, proxied in dev)
- `withCredentials: true` (sends cookies)
- `Accept: application/json`

**One exception**: `saveStructuringReview` in `src/api/structuringReview.ts` uses a raw `axios` instance (not `apiClient`) and posts to a dynamic URL returned by the backend (`review.actions.save_endpoint`).

#### Complete endpoint catalogue

| Frontend function | Method | URL | File |
|---|---|---|---|
| `getSession` | GET | `/api/v2/session` | `api/session.ts` |
| `loginSession` | POST | `/api/v2/session/login` | `api/session.ts` |
| `registerSession` | POST | `/api/v2/session/register` | `api/session.ts` |
| `deleteSession` | DELETE | `/api/v2/session` | `api/session.ts` |
| `getDashboard` | GET | `/api/v2/dashboard` | `api/dashboard.ts` |
| `getProjects` | GET | `/api/v2/projects` | `api/projects.ts` |
| `getProjectDetail` | GET | `/api/v2/projects/:id` | `api/projects.ts` |
| `getProjectChapters` | GET | `/api/v2/projects/:id/chapters` | `api/projects.ts` |
| `getChapterDetail` | GET | `/api/v2/projects/:pid/chapters/:cid` | `api/projects.ts` |
| `getChapterFiles` | GET | `/api/v2/projects/:pid/chapters/:cid/files` | `api/projects.ts` |
| `createChapter` | POST | `/api/v2/projects/:id/chapters` | `api/projects.ts` |
| `renameChapter` | PATCH | `/api/v2/projects/:pid/chapters/:cid` | `api/projects.ts` |
| `deleteChapter` | DELETE | `/api/v2/projects/:pid/chapters/:cid` | `api/projects.ts` |
| `getNotifications` | GET | `/api/v2/notifications` | `api/notifications.ts` |
| `downloadFile` | GET | `/api/v2/files/:id/download` | `api/files.ts` |
| `checkoutFile` | POST | `/api/v2/files/:id/checkout` | `api/files.ts` |
| `cancelCheckout` | DELETE | `/api/v2/files/:id/checkout` | `api/files.ts` |
| `deleteFile` | DELETE | `/api/v2/files/:id` | `api/files.ts` |
| `uploadChapterFiles` | POST | `/api/v2/projects/:pid/chapters/:cid/files/upload` | `api/files.ts` |
| `getFileVersions` | GET | `/api/v2/files/:id/versions` | `api/files.ts` |
| `downloadFileVersion` | GET | `/api/v2/files/:id/versions/:vid/download` | `api/files.ts` |
| `startProcessingJob` | POST | `/api/v2/files/:id/processing-jobs` | `api/processing.ts` |
| `getProcessingStatus` | GET | `/api/v2/files/:id/processing-status` | `api/processing.ts` |
| `getTechnicalReview` | GET | `/api/v2/files/:id/technical-review` | `api/technicalReview.ts` |
| `applyTechnicalReview` | POST | `/api/v2/files/:id/technical-review/apply` | `api/technicalReview.ts` |
| `getStructuringReview` | GET | `/api/v2/files/:id/structuring-review` | `api/structuringReview.ts` |
| `saveStructuringReview` | POST | `<dynamic URL from backend>` (always `/api/v2/files/:id/structuring-review/save`) | `api/structuringReview.ts` |
| `getAdminDashboard` | GET | `/api/v2/admin/dashboard` | `api/admin.ts` |
| `getAdminUsers` | GET | `/api/v2/admin/users` | `api/admin.ts` |
| `getAdminRoles` | GET | `/api/v2/admin/roles` | `api/admin.ts` |
| `createAdminUser` | POST | `/api/v2/admin/users` | `api/admin.ts` |
| `updateAdminUserRole` | PUT | `/api/v2/admin/users/:id/role` | `api/admin.ts` |
| `updateAdminUserStatus` | PUT | `/api/v2/admin/users/:id/status` | `api/admin.ts` |
| `editAdminUser` | PATCH | `/api/v2/admin/users/:id` | `api/admin.ts` |
| `updateAdminUserPassword` | PUT | `/api/v2/admin/users/:id/password` | `api/admin.ts` |
| `deleteAdminUser` | DELETE | `/api/v2/admin/users/:id` | `api/admin.ts` |

**Not called from frontend** (backend-only endpoints): `GET /api/v2/activities`, `POST /api/v2/projects/bootstrap`, `DELETE /api/v2/projects/:id`, `GET /api/v2/projects/:pid/chapters/:cid/package`, `GET /api/v2/files/:id/structuring-review/export` (linked via `<a href>` not Axios), `POST /api/v2/session/register` (called through `useRegister`).

### 2.5 State & Data Flow

#### Zustand store: `sessionStore`

Single store in `src/stores/sessionStore.ts`.

| Field | Type | Description |
|---|---|---|
| `status` | `"idle" \| "loading" \| "authenticated" \| "anonymous" \| "error"` | Bootstrap lifecycle |
| `viewer` | `Viewer \| null` | Current user |
| `authMode` | `"cookie" \| "bearer" \| null` | Auth method |
| `expiresAt` | `string \| null` | Token expiry |
| `errorMessage` | `string \| null` | Bootstrap error |
| `handoffStarted` | `boolean` | Prevents re-bootstrap during logout |

**Data flow for session**:
1. `AppProviders` mounts `RouterProvider`
2. Every `/ui/*` route is wrapped in `SessionGate`
3. `SessionGate` calls `useSessionBootstrap` which fires `GET /api/v2/session` (query key `["session"]`)
4. On success: `setAuthenticated(data)` writes viewer to Zustand + sets query cache
5. On anonymous: redirects to `/ui/login`
6. `LoginPage` fires `POST /api/v2/session/login` via `useLogin`; on success updates Zustand + query cache then navigates to dashboard

#### TanStack Query keys (canonical list)

| Key | Data | Where set |
|---|---|---|
| `["session"]` | `SessionGetResponse` | `useSessionBootstrap`, `LoginPage`, `RegisterPage` |
| `["dashboard"]` | `DashboardResponse` | `useDashboardQuery` |
| `["projects", offset, limit]` | `ProjectsListResponse` | `useProjectsQuery` |
| `["project-detail", projectId]` | `ProjectDetailResponse` | `useProjectDetailQuery` |
| `["project-chapters", projectId]` | `ProjectChaptersResponse` | `useProjectChaptersQuery` |
| `["chapter-detail", projectId, chapterId]` | `ChapterDetailResponse` | `useChapterDetailQuery` |
| `["chapter-files", projectId, chapterId]` | `ChapterFilesResponse` | `useChapterFilesQuery` |
| `["notifications", limit]` | `NotificationsResponse` | `useNotificationsQuery` |
| `["admin-dashboard"]` | `AdminDashboardResponse` | `useAdminDashboardQuery` |
| `["admin-users", offset, limit]` | `AdminUsersResponse` | `useAdminUsersQuery` |
| `["technical-review", fileId]` | `TechnicalScanResponse` | `useTechnicalReviewQuery` |
| `["structuring-review", fileId]` | `StructuringReviewResponse` | `useStructuringReviewQuery` |
| `["processing-status", fileId, "structuring"]` | `ProcessingStatusResponse` | `useStructuringProcessing` |

**Global QueryClient options**: `retry: 1`, `refetchOnWindowFocus: false`.

**Cache invalidation on mutations**: File actions (checkout, delete, upload, structuring) invalidate `chapter-detail`, `chapter-files`, `project-detail`, `project-chapters`, `projects`, `dashboard`, `notifications`, `activities`. Admin mutations invalidate `admin-dashboard`, `admin-users`, `session`.

### 2.6 Design System

**Framework**: Tailwind CSS v4 via `@tailwindcss/vite` plugin. No `tailwind.config.js` — all tokens are defined in the `@theme {}` block inside `src/index.css`.

**Fonts**: Inter (body) + Libre Bodoni (serif headings) loaded from Google Fonts in `index.css`.

**Color palette**:
- Navy (`navy-50` … `navy-950`): primary/UI chrome
- Gold (`gold-50` … `gold-900`): accent, CTAs
- Surface (`surface-100` … `surface-500`): warm off-white backgrounds
- Semantic: `success-*`, `warning-*`, `error-*`, `info-*` (100/500/600 each)

**Shadows**: `shadow-subtle`, `shadow-card`, `shadow-hover`, `shadow-strong`, `shadow-modal`

**Radii**: `radius-xs` (3px) through `radius-full` (9999px)

**Z-index scale**: base (0), sticky (10), dropdown (20), modal (30), toast (40)

**Keyframes** (defined in `index.css`): `shimmer` (skeleton loaders), `toast-in`/`toast-out`, `modal-in`/`overlay-in`, `page-fade-in`, `pulse-ring` (processing indicator)

**CSS utility**: `src/utils/cn.ts` — custom lightweight className merger, no clsx/tailwind-merge dependency.

**Page transition**: `.page-enter` class applies `page-fade-in` animation (150ms, ease-out-quart).

### 2.7 Page-by-Page Assessment

#### LoginPage (`/ui/login`)
- Dual-panel layout: navy brand panel (left) + white form (right)
- On mount: checks session via `GET /api/v2/session`; if already authed, redirects to dashboard
- Form: username + password (with show/hide toggle) + "Remember me" checkbox (decorative, no actual effect) + dead "Forgot your password?" link (`href="#"`)
- On success: navigates to `/ui/dashboard` via `useEffect` on `loginMutation.isSuccess`
- Error display: inline banner with `getApiErrorMessage`

#### RegisterPage (`/ui/register`)
- Same dual-panel layout as LoginPage (duplicated `AuthBrandPanel` component defined locally in each file)
- Collects: username, email, password, confirm_password
- On success: navigates to `/ui/login`
- No email verification flow

#### DashboardPage (`/ui/dashboard`)
- Skeleton loading → error card (with SSR dashboard fallback link) → main content
- Main content: greeting + date, DashboardStatsGrid (4 stats from API), optional admin shortcuts, QuickActions (3 buttons: 2 SSR links to create project, 1 React link to projects list), recent projects grid
- "New Project" and "Upload Manuscript" quick actions both point to `getSsrUrl(ssrPaths.projectCreate)` — they go to the SSR form, breaking SPA flow

#### ProjectsPage (`/ui/projects`)
- Client-side search + status filter over projects loaded from `GET /api/v2/projects`
- "New Project" action goes to `getSsrUrl(ssrPaths.projectCreate)` — SSR handoff
- Each row has two nearly-identical ExternalLink icons: one is a `<Link to={uiPaths.projectDetail(...)}>` (React), the other is `<a href={getSsrUrl(ssrPaths.projectDetail(...))}>` (SSR). Both render the same icon (ExternalLink) with no visible label difference — ambiguous UX

#### ProjectDetailPage (`/ui/projects/:projectId`)
- Two tabs: "Chapters" and "Overview"
- "Open in Editor" button uses `uiPaths.projectEditor` which resolves to the same path as `uiPaths.projectDetail` — the button goes to the same React page (self-link, no actual editor)
- No project creation/edit UI; links out to SSR for that
- Empty chapters state links to SSR project detail

#### ChapterDetailPage (`/ui/projects/:projectId/chapters/:chapterId`)
- Full-height split layout: 208px left sidebar (section nav) + scrollable main
- Section state driven by `?section=` URL param (supports deep-linking)
- Overview: `ChapterSectionCards` (6 category cards with counts)
- Section view: `ChapterFilesTable` with per-file action buttons
- Upload panel inline above content area
- Structuring processing status shown as `StatusBanner`s
- SSR fallback link in sidebar footer: `getSsrUrl(ssrPaths.chapterDetail(...))`
- No chapter creation/rename/delete UI exposed here (those mutations exist in `useChapterMutations` but no modal trigger in this page)

#### AdminDashboardPage (`/ui/admin`)
- 4-stat grid + two quick-link cards: "User Management" (React link) + "SSR Admin Panel" (external link via `getSsrUrl`)
- No frontend role guard — relies on backend 403

#### AdminUsersPage (`/ui/admin/users`)
- Full user CRUD via modals: Create, Edit (email), Password change, Delete
- Inline role dropdown + status toggle in table rows
- Client-side search filter (username/email)
- All mutations immediately invalidate and refetch users + admin dashboard

#### TechnicalReviewPage (`/ui/.../technical-review`)
- Loads technical scan via `GET /api/v2/files/:id/technical-review`
- Issues rendered in `TechnicalIssuesForm` — select replacement for each detected pattern
- "Apply All" posts to `POST /api/v2/files/:id/technical-review/apply`
- On success: shows new filename/ID inline. No automatic navigation or re-scan

#### StructuringReviewPage (`/ui/.../structuring-review`)
- Loads review metadata via `GET /api/v2/files/:id/structuring-review`
- Embeds Collabora editor in `<iframe src={review.editor.collabora_url}>` (autosave via WOPI)
- Manual save via JSON textarea → `POST /api/v2/files/:id/structuring-review/save`
- Export button: `<a href={review.actions.export_href}>` → `GET /api/v2/files/:id/structuring-review/export` (browser download)
- `StructuringReturnAction` may use `<a href={actions.return_href}>` pointing to SSR `/projects/{pid}/chapter/{cid}?tab=Manuscript` — SSR handoff

---

## 3. Backend API Reference

### 3.1 All Endpoints

**Router registration order** (from `app/main.py`):
1. `web.router` — SSR routes (no prefix, Jinja2, cookies)
2. `api_v2.router` — `/api/v2`
3. `users.router` — `/api/v1/users`
4. `teams.router` — `/api/v1/teams`
5. `projects.router` — `/api/v1/projects`
6. `files.router` — `/api/v1/files`
7. `processing.router` — `/api/v1/processing`
8. `structuring.router` — `/api/v1`
9. `wopi.router` — no prefix (WOPI callbacks)

#### API v2 endpoints (all at `/api/v2/`)

| Method | Path | Handler | Auth | Notes |
|---|---|---|---|---|
| POST | `/session/login` | `api_v2_session_login` | None | Sets httponly cookie |
| POST | `/session/register` | `api_v2_session_register` | None | No email verify |
| GET | `/session` | `api_v2_get_session` | None | Reads cookie or Bearer |
| DELETE | `/session` | `api_v2_delete_session` | None | Clears cookie |
| GET | `/dashboard` | `api_v2_dashboard` | Cookie | `include_projects` query param |
| GET | `/projects` | `api_v2_projects` | Cookie | `offset`, `limit` |
| GET | `/projects/{project_id}` | `api_v2_project_detail` | Cookie | |
| GET | `/projects/{project_id}/chapters` | `api_v2_project_chapters` | Cookie | |
| GET | `/projects/{project_id}/chapters/{chapter_id}` | `api_v2_chapter_detail` | Cookie | `tab` param (unused in React) |
| GET | `/projects/{project_id}/chapters/{chapter_id}/files` | `api_v2_chapter_files` | Cookie | |
| POST | `/projects/bootstrap` | `api_v2_project_bootstrap` | Cookie | Multipart form; not used by React |
| DELETE | `/projects/{project_id}` | `api_v2_delete_project` | Cookie | Not called by React |
| POST | `/projects/{project_id}/chapters` | `api_v2_create_chapter` | Cookie | |
| PATCH | `/projects/{project_id}/chapters/{chapter_id}` | `api_v2_rename_chapter` | Cookie | |
| DELETE | `/projects/{project_id}/chapters/{chapter_id}` | `api_v2_delete_chapter` | Cookie | |
| GET | `/projects/{project_id}/chapters/{chapter_id}/package` | `api_v2_download_chapter_package` | Cookie | ZIP download |
| GET | `/notifications` | `api_v2_notifications` | Cookie | `limit` param |
| GET | `/activities` | `api_v2_activities` | Cookie | Not called by React currently |
| GET | `/files/{file_id}/download` | `api_v2_download_file` | Cookie | `FileResponse` |
| DELETE | `/files/{file_id}` | `api_v2_delete_file` | Cookie | |
| POST | `/files/{file_id}/checkout` | `api_v2_checkout_file` | Cookie | |
| DELETE | `/files/{file_id}/checkout` | `api_v2_cancel_checkout` | Cookie | |
| POST | `/projects/{pid}/chapters/{cid}/files/upload` | `api_v2_upload_chapter_files` | Cookie | Multipart |
| GET | `/files/{file_id}/versions` | `api_v2_file_versions` | Cookie | `limit` param |
| GET | `/files/{file_id}/versions/{version_id}/download` | `api_v2_download_file_version` | Cookie | `FileResponse` |
| POST | `/files/{file_id}/processing-jobs` | `api_v2_start_processing` | Cookie | Runs in BackgroundTask |
| GET | `/files/{file_id}/processing-status` | `api_v2_processing_status` | Cookie | Only `process_type=structuring` supported |
| GET | `/files/{file_id}/technical-review` | `api_v2_technical_scan` | Cookie | Requires technical permission |
| POST | `/files/{file_id}/technical-review/apply` | `api_v2_technical_apply` | Cookie | Creates new file version |
| GET | `/files/{file_id}/structuring-review` | `api_v2_structuring_review` | Cookie | Returns Collabora URL |
| POST | `/files/{file_id}/structuring-review/save` | `api_v2_structuring_save` | Cookie | |
| GET | `/files/{file_id}/structuring-review/export` | `api_v2_structuring_export` | Cookie | DOCX download |
| GET | `/admin/dashboard` | `api_v2_admin_dashboard` | Cookie + Admin role | |
| GET | `/admin/users` | `api_v2_admin_users` | Cookie + Admin role | |
| GET | `/admin/roles` | `api_v2_admin_roles` | Cookie + Admin role | |
| POST | `/admin/users` | `api_v2_admin_create_user` | Cookie + Admin role | |
| PUT | `/admin/users/{user_id}/role` | `api_v2_admin_update_user_role` | Cookie + Admin role | Last-admin protection |
| PUT | `/admin/users/{user_id}/status` | `api_v2_admin_update_user_status` | Cookie + Admin role | Self-lockout protection |
| PATCH | `/admin/users/{user_id}` | `api_v2_admin_edit_user` | Cookie only (no admin check) | Bug: any logged-in user can edit emails |
| PUT | `/admin/users/{user_id}/password` | `api_v2_admin_change_password` | Cookie + Admin role | |
| DELETE | `/admin/users/{user_id}` | `api_v2_admin_delete_user` | Cookie only (no admin check) | Bug: any logged-in user can delete users |

### 3.2 Auth Mechanism

The API v2 router uses a hybrid auth resolver (`_resolve_session`):

1. **Cookie** (primary): Reads `access_token` cookie, decodes JWT, looks up user in DB.
2. **Bearer header** (fallback): Reads `Authorization: Bearer <token>`, decodes JWT, looks up user.

The cookie is set by `session_service.set_access_token_cookie` on login. It is:
- `httponly: True`
- **Not** `secure` (no HTTPS-only enforcement)
- **No** `samesite` attribute set

**CORS**: `allow_origins=["*"]` with `allow_credentials=True` — this combination is rejected by browsers per spec (wildcard origin with credentials). In practice this works only because the Vite dev proxy and nginx make requests same-origin.

**Token lifetime**: 30 minutes (`ACCESS_TOKEN_EXPIRE_MINUTES` in config). No refresh token mechanism.

**Session bootstrap** (`GET /api/v2/session`): No auth required — returns `authenticated: false` if no valid cookie, no 401.

### 3.3 Data Models

Hierarchy: `Team → Users, Projects` | `User ↔ Roles (UserRole join)` | `Project → Chapters → Files → FileVersions`

**Key model fields**:
- `Project`: id, code, title, client_name (nullable), xml_standard, status, team_id
- `Chapter`: id, project_id, number (string), title, has_art/has_ms/has_ind/has_proof/has_xml (derived from files at read time in api_v2)
- `File`: id, project_id, chapter_id, filename, file_type, category (Art/Manuscript/InDesign/Proof/XML/Miscellaneous), uploaded_at, version, path, is_checked_out, checked_out_by_id, checked_out_at
- `FileVersion`: id, file_id, version_num, path, uploaded_at, uploaded_by_id
- `User`: id, username, email, hashed_password, is_active, roles (many-to-many)
- `Role`: id, name, description — seeded on startup: Viewer, Editor, ProjectManager, Admin, Tagger, CopyEditor, GraphicDesigner, Typesetter, QCPerson, PPD, PermissionsManager

**File actions** returned in `available_actions`:
- Standard: `["download", "delete", "edit", "technical_edit"]` (always)
- Conditional: `"cancel_checkout"` (if checked out by viewer), `"checkout"` (if not checked out)
- Note: `"structuring_review"` is used in frontend but is NOT in the backend's `_STANDARD_FILE_ACTIONS` list — it never appears in `available_actions`. The `ChapterFilesTable` checks for it but will never render the button.

### 3.4 File Upload

**Endpoint**: `POST /api/v2/projects/{pid}/chapters/{cid}/files/upload`
**Content-Type**: `multipart/form-data`
**Fields**: `category` (string, required), `files` (multiple UploadFile)

Files are stored at `{UPLOAD_DIR}/{project.code}/{chapter.number}/{category}/` on disk. If a file with the same name already exists, the old version is archived and the version counter is incremented.

**Config**: `CMS_RUNTIME_ROOT` (from `app/core/paths.py`) controls where uploads are stored. Docker maps `/opt/cms_runtime/data/uploads`.

**Max upload size**: 200MB (set in nginx: `client_max_body_size 200M`).

### 3.5 Collabora/WOPI

**Collabora** (LibreOffice Online) runs as a separate Docker container (`collabora/code`, port 9980).

**Flow**:
1. Frontend calls `GET /api/v2/files/:id/structuring-review`
2. Backend calls `structuring_review_service.build_review_page_state` which builds a Collabora launch URL (via `COLLABORA_PUBLIC_URL` + WOPI token)
3. Frontend embeds the URL in `<iframe src={collabora_url}>`
4. Collabora contacts backend via WOPI callbacks (unauthenticated WOPI router)

**WOPI endpoints** (all unauthenticated, at `/wopi/files/...`):
- `GET /wopi/files/{file_id}` — file info
- `GET /wopi/files/{file_id}/contents` — file download by Collabora
- `POST /wopi/files/{file_id}/contents` — file save by Collabora (autosave)

**WOPI base URL**: `WOPI_BASE_URL` env config. In docker-compose, Collabora's `aliasgroup1/2` allow backend:8000 and 10.1.1.18:8080.

**Known limitation**: If `collabora_url` is null (Collabora offline), the StructuringReviewPage shows a fallback EmptyState with export + return links.

### 3.6 Polling Endpoints

**Structuring status polling**:
- Frontend hook: `useStructuringProcessing` in `src/features/processing/useStructuringProcessing.ts`
- Endpoint: `GET /api/v2/files/:id/processing-status?process_type=structuring`
- Interval: 2000ms while `status === "processing"`, stops when `status === "completed"`
- Implemented via TanStack Query `refetchInterval` with a function returning `2000 | false`
- On completion: invalidates 8 query keys and clears active file state

**No other polling** endpoints in the frontend.

---

## 4. Infrastructure & Config

### Docker Compose Services

| Service | Image | Port | Notes |
|---|---|---|---|
| `db` | postgres:15 | internal | Persistent volume `postgres_data` |
| `redis` | redis:7-alpine | 6379 | Used by Celery (defined but Celery unused in CMS) |
| `backend` | local Dockerfile | internal 8000 | FastAPI app |
| `celery_worker` | local Dockerfile | — | Celery worker; configured but processing uses FastAPI BackgroundTasks, not Celery |
| `collabora` | collabora/code | 9980 | LibreOffice Online |
| `ai_structuring` | local Flask app | internal 5000 | Optional AI structuring microservice |
| `ai_structuring_worker` | same | — | Celery worker for AI structuring |
| `nginx` | nginx:alpine | 8080 (HTTP), 8443 (HTTPS) | Reverse proxy |

### Nginx Config (`nginx/nginx.conf`)

- `client_max_body_size 200M`
- `/hosting/`, `/browser/`, `/coolws/`, `/cool/` → Collabora upstream (with WebSocket upgrade for `/coolws/` and `/cool/`)
- `/` → backend:8000 (all other traffic)
- **No static file serving for the React build** — the `/ui` path and React SPA assets have no dedicated nginx rule. The React build output would need to be either served by nginx from a static directory or embedded in the FastAPI app via `StaticFiles`.

### Config (`app/core/config.py`)

| Setting | Default | Notes |
|---|---|---|
| `SECRET_KEY` | `"changeme_in_production_secret_key_12345"` | Must be changed in production |
| `DATABASE_URL` | postgresql://user:password@localhost/cms_db | Override via env |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 30 | No refresh tokens |
| `AI_STRUCTURING_BASE_URL` | `""` | Empty = AI structuring disabled |
| `COLLABORA_PUBLIC_URL` | (from integrations/collabora/config.py) | External Collabora URL |

---

## 5. Known Issues & Bugs

### Critical Security Issues

1. **`PATCH /api/v2/admin/users/{user_id}` missing admin role check** — any authenticated user can edit any other user's email address. The `api_v2_admin_edit_user` handler checks for a valid cookie but does not call `_has_admin_role`. Same issue exists for `DELETE /api/v2/admin/users/{user_id}` — any authenticated user can delete any user account.

2. **`SECRET_KEY` default is a known string** — `"changeme_in_production_secret_key_12345"` is committed to source control. If `.env` is not configured, any JWT signed with this key is trivially forgeable.

3. **CORS misconfiguration** — `allow_origins=["*"]` + `allow_credentials=True` is rejected by browsers and does not actually work. It may succeed in practice only due to nginx proxying making all requests same-origin.

4. **Cookie lacks `secure` and `samesite`** — the auth cookie is transmitted over plain HTTP, making it vulnerable to interception.

### Functional Bugs

5. **`"structuring_review"` never appears in `available_actions`** — the backend's `_STANDARD_FILE_ACTIONS` list is `["download", "delete", "edit", "technical_edit"]` and only adds `"checkout"` or `"cancel_checkout"` conditionally. The string `"structuring_review"` is never added. The `ChapterFilesTable` checks `file.available_actions.includes("structuring_review")` to render the structuring review button — this condition is always false. Users can never access the structuring review from the file table.

6. **"Open in Editor" button is a self-link** — `ProjectDetailPage` renders `<Link to={uiPaths.projectEditor(id)}>` which resolves to `uiPaths.projectDetail(id)` — the same page. No actual editor is opened.

7. **"Forgot your password?" link goes nowhere** — `LoginPage` renders `<a href="#">` for the forgot password action. No password reset flow exists.

8. **"Remember me" checkbox is decorative** — `LoginPage` renders a remember-me checkbox but never reads its value. The token lifetime is always 30 minutes regardless.

9. **Both ExternalLink icons in ProjectsPage look identical** — two action buttons in the projects table both use `<ExternalLink>` icon and both have screen-reader-only text "View {title}" and "Open {title} in editor". They are visually indistinguishable, one links to React route, one to SSR.

10. **No project creation in React UI** — the `POST /api/v2/projects/bootstrap` endpoint exists in backend but is not called from the frontend. All project creation requires navigating to the SSR form via `getSsrUrl(ssrPaths.projectCreate)`.

11. **No chapter management UI in ChapterDetailPage** — `useChapterMutations` hook exists with create/rename/delete capabilities, but `ChapterDetailPage` does not expose any chapter management UI. The mutations are available in `ProjectDetailPage` / `ProjectChaptersTable` only.

12. **Dashboard stats partially hardcoded** — `dashboard_service.get_dashboard_page_data` returns `on_time_rate`, `on_time_trend`, `avg_days`, `avg_days_trend`, `delayed_count`, `delayed_trend` that may be hardcoded or computed from incomplete data.

### Missing Error Boundaries

13. **No React error boundary anywhere in the component tree** — `AppProviders`, `AppLayout`, and all page components lack `<ErrorBoundary>` wrappers. An uncaught JavaScript exception in any component will crash the entire SPA with a blank white page.

### Missing Features vs Backend Capability

14. **`GET /api/v2/activities` is never called** — the endpoint exists and returns a rich activity feed, but no frontend component queries it.

15. **File version history UI not wired up** — `getFileVersions` and `downloadFileVersion` exist in `api/files.ts` but no page or feature component calls them.

16. **Chapter package download not implemented** — `GET /api/v2/projects/:pid/chapters/:cid/package` exists but is not linked from the frontend.

---

## 6. Navigation Audit

### React Router `<Link>` calls (SPA navigation, stays in React)

| Source file | Destination | Context |
|---|---|---|
| `LoginPage.tsx:262` | `uiPaths.register` (`/ui/register`) | "Register" link |
| `RegisterPage.tsx:309` | `uiPaths.login` (`/ui/login`) | "Sign in" link |
| `DashboardPage.tsx:105` | `uiPaths.projects` (`/ui/projects`) | "View All Projects" quick action |
| `DashboardPage.tsx:175` | `uiPaths.projects` (`/ui/projects`) | "View all" link |
| `ProjectsPage.tsx:136` | `uiPaths.projectDetail(project.id)` | Project title/code cell |
| `ProjectsPage.tsx:163` | `uiPaths.projectDetail(project.id)` | ExternalLink action button |
| `ProjectDetailPage.tsx:36` | `uiPaths.projects` | "Back to projects" on invalid id |
| `ProjectDetailPage.tsx:77` | `uiPaths.projects` | "Back to projects" on error |
| `ProjectDetailPage.tsx:92` | `uiPaths.projects` | "Back to projects" on no data |
| `ProjectDetailPage.tsx:121` | `uiPaths.projects` | Breadcrumb "Projects" link |
| `ProjectDetailPage.tsx:135` | `uiPaths.projectEditor(id)` | "Open in Editor" (resolves to same `/ui/projects/:id`) |
| `ChapterDetailPage.tsx:269` | `uiPaths.projects` | "Back to projects" on invalid ids |
| `ChapterDetailPage.tsx:301` | `uiPaths.projectDetail(pid)` | "Back to project" |
| `ChapterDetailPage.tsx:408` | `uiPaths.projects` | Breadcrumb "Projects" |
| `ChapterDetailPage.tsx:412` | `uiPaths.projectDetail(project.id)` | Breadcrumb project name |
| `AdminDashboardPage.tsx:71` | `uiPaths.adminUsers` | "Users" button |
| `AdminDashboardPage.tsx:95` | `uiPaths.adminUsers` | "Manage Users" button |
| `AdminUsersPage.tsx:64` | `uiPaths.adminDashboard` | "Back to Admin" on error |
| `TechnicalReviewPage.tsx:80` | `uiPaths.projects` | "Back to Projects" on invalid |
| `TechnicalReviewPage.tsx:124` | `uiPaths.chapterDetail(pid, cid)` | "Back to Chapter" on error |
| `TechnicalReviewPage.tsx:141` | `uiPaths.chapterDetail(pid, cid)` | "Back to Chapter" on no data |
| `TechnicalReviewPage.tsx:163` | `uiPaths.projects` | Breadcrumb "Projects" |
| `TechnicalReviewPage.tsx:167` | `uiPaths.chapterDetail(pid, cid)` | Breadcrumb "Chapter" |
| `StructuringReviewPage.tsx:51` | `uiPaths.projects` | "Back to Projects" on invalid |
| `StructuringReviewPage.tsx:86` | `uiPaths.chapterDetail(pid, cid)` | "Back to Chapter" on error |
| `StructuringReviewPage.tsx:103` | `uiPaths.chapterDetail(pid, cid)` | "Back to Chapter" on no data |
| `ChapterFilesTable.tsx:241` | `uiPaths.structuringReview(pid, cid, fid)` | Structuring review button (never shown — see Issue #5) |
| `ChapterFilesTable.tsx:251` | `uiPaths.technicalReview(pid, cid, fid)` | Technical review button |
| `ProjectChaptersTable.tsx` | `uiPaths.chapterDetail(pid, cid)` | Chapter row links |

### `navigate()` calls (programmatic SPA navigation)

| Source file | Destination | Context |
|---|---|---|
| `useLogin.ts` (via `LoginPage`) | `uiPaths.dashboard` via `useEffect` | After successful login |
| `useLogout.ts` | `uiPaths.login` | After successful logout |
| `RegisterPage.tsx` | `uiPaths.login` via `useEffect` | After successful registration |
| `SessionGate.tsx` | `uiPaths.login` (via `<Navigate>`) | Unauthenticated access |
| `LoginPage.tsx` | `uiPaths.dashboard` (via `<Navigate>`) | Already authenticated |
| `RegisterPage.tsx` | `uiPaths.dashboard` (via `<Navigate>`) | Already authenticated |
| `TechnicalReviewPage.tsx` | `navigate(-1)` | "Back" button |
| `StructuringReviewPage.tsx` | `navigate(-1)` | Back arrow button |

### `getSsrUrl()` calls — SSR handoffs that leave the React SPA

Every `getSsrUrl()` call produces an absolute URL to the legacy FastAPI server, causing a full page navigation out of the React SPA. The user must return via browser back button.

| Source file | SSR Path | Context | Breaks SPA? |
|---|---|---|---|
| `AppLayout.tsx:159` | `/static/images/S4c.png` | Logo `<img src>` — not navigation | No |
| `SessionGate.tsx:32` | `/dashboard` (SSR) | "Open SSR dashboard" in error state | Yes |
| `DashboardPage.tsx:67` | `/dashboard` (SSR) | "Open SSR dashboard" fallback button | Yes |
| `DashboardPage.tsx:89` | `/projects/create` (SSR) | "New Project" quick action | Yes |
| `DashboardPage.tsx:98` | `/projects/create` (SSR) | "Upload Manuscript" quick action | Yes |
| `DashboardPage.tsx:192` | `/projects/create` (SSR) | Empty state "Create first project" | Yes |
| `ProjectsPage.tsx:41` | `/projects/create` (SSR) | "New Project" page header action | Yes |
| `ProjectsPage.tsx:94` | `/projects/create` (SSR) | Empty state "New Project" | Yes |
| `ProjectsPage.tsx:172` | `/projects/:id` (SSR) | Duplicate ExternalLink in action column | Yes |
| `ProjectDetailPage.tsx:172` | `/projects/:id` (SSR) | "Add chapters in CMS" empty state | Yes |
| `ChapterDetailPage.tsx:396` | `/projects/:pid/chapter/:cid` (SSR) | "Open fallback CMS view" sidebar link | Yes |
| `AdminDashboardPage.tsx:52` | `/admin` (SSR) | Error state "Open SSR admin dashboard" | Yes |
| `AdminDashboardPage.tsx:115` | `/admin` (SSR) | "Open SSR Admin" quick link card (opens in new tab) | Yes (new tab) |
| `ChapterFilesTable.tsx:230` | `/files/:id/edit` (SSR) | "Edit in CMS" file action | Yes |
| `ProjectChaptersTable.tsx:174` | `/projects/:id` (SSR) | Chapter count footer link | Yes |
| `ProjectChaptersTable.tsx:182` | `/projects/:id` (SSR) | Another project link | Yes |
| `ProjectChaptersTable.tsx:304` | `/projects/:id` (SSR) | Yet another SSR project link | Yes |
| `StructuringReturnAction.tsx:20` | `return_href` from backend (SSR path like `/projects/:pid/chapter/:cid`) | "Return" button when structuring review done | Yes |

### `<a href>` tags in export/download (not navigation)

| Source file | URL | Context |
|---|---|---|
| `StructuringReviewPage.tsx:167` | `review.actions.export_href` (`/api/v2/files/:id/structuring-review/export`) | Download button — browser download |

---

## 7. Recommendations for UI/UX Work

Listed by priority. Each item is concrete and actionable.

### P0 — Security fixes (do immediately before any public deployment)

**R1: Add admin role check to `PATCH /api/v2/admin/users/{user_id}` and `DELETE /api/v2/admin/users/{user_id}`**
File: `app/routers/api_v2.py` lines ~1766 and ~1836.
Add `if not _has_admin_role(viewer): return _error_response(403, ...)` to both handlers.

**R2: Change `SECRET_KEY` in all environments**
The committed default `changeme_in_production_secret_key_12345` must never be used in production. Add a `.env.example` and remove the default from `config.py`.

**R3: Add `secure=True` and `samesite="lax"` to the auth cookie**
File: `app/services/session_service.py` (wherever `set_access_token_cookie` is defined). Prevents cookie theft over plain HTTP and CSRF.

### P1 — Fix broken core UX (blocking user workflows)

**R4: Add `"structuring_review"` to `available_actions` in `_serialize_file_record`**
File: `app/routers/api_v2.py` around line 196.
Currently no file ever returns `structuring_review` in its actions, so the structuring review button in `ChapterFilesTable` is permanently hidden. Add logic: if the file has a processed structuring output, append `"structuring_review"` to actions.

**R5: Fix the "Open in Editor" self-link on ProjectDetailPage**
File: `frontend/src/pages/ProjectDetailPage.tsx` line 135.
`uiPaths.projectEditor` is an alias for `uiPaths.projectDetail`. Either implement a dedicated editor route or remove the button. If the SSR editor is the intent, use `getSsrUrl(ssrPaths.projectDetail(id))` and be explicit about the SSR handoff.

**R6: Remove duplicate ExternalLink icons from ProjectsPage**
File: `frontend/src/pages/ProjectsPage.tsx` around line 162.
The two identical ExternalLink icons (one React route, one SSR) confuse users. Either remove the SSR one or distinguish them visually (different icon, label "Open SSR", tooltip).

### P2 — Add missing error boundaries

**R7: Wrap the app in an `<ErrorBoundary>` at the `AppProviders` level**
A single uncaught render error currently crashes the entire SPA silently. Add a top-level error boundary that shows a user-friendly fallback page with a "Reload" button and optional link to the SSR dashboard.

Minimal implementation: create `src/components/ErrorBoundary.tsx` as a class component with `componentDidCatch`, wrap `RouterProvider` in `providers.tsx`.

### P3 — Implement project creation in React

**R8: Build a "Create Project" modal or page that calls `POST /api/v2/projects/bootstrap`**
The backend endpoint already exists. The SSR handoff for project creation (`/projects/create`) is the largest and most frequent forced SPA exit. Replace the three "New Project" buttons in `DashboardPage` and `ProjectsPage` with a React modal form.

Fields required: `code`, `title`, `client_name` (optional), `xml_standard`, `chapter_count`, optional file uploads.

### P4 — Fix "Forgot password" and "Remember me"

**R9: Remove or implement the "Forgot your password?" link**
File: `frontend/src/pages/LoginPage.tsx` line 235.
Currently `href="#"` — either remove it or implement a password reset flow.

**R10: Remove the "Remember me" checkbox or implement it**
File: `frontend/src/pages/LoginPage.tsx` line 226.
The checkbox is never read. Remove it to avoid misleading users, or implement extended token lifetime when checked (requires backend changes to `ACCESS_TOKEN_EXPIRE_MINUTES`).

### P5 — Wire up existing backend capabilities

**R11: Add activity feed to DashboardPage**
`GET /api/v2/activities` returns a rich activity log. Wire it into the dashboard as a "Recent Activity" section. The API client and types already handle the response (add `api/activities.ts` and a feature hook).

**R12: Add file version history UI in ChapterFilesTable**
`getFileVersions` and `downloadFileVersion` exist in `api/files.ts`. Add a "Version history" panel in the file detail view showing past versions with download links.

**R13: Add chapter package download button**
`GET /api/v2/projects/:pid/chapters/:cid/package` returns a ZIP of all chapter files. Add a download button to `ChapterDetailPage` toolbar.

### P6 — Code quality improvements

**R14: Deduplicate `AuthBrandPanel` component**
`LoginPage.tsx` and `RegisterPage.tsx` each define an identical local `AuthBrandPanel` function. Extract it to `src/features/session/components/AuthBrandPanel.tsx`.

**R15: Use the existing `AuthCard`, `AuthButton`, `AuthInput`, `AuthErrorBlock` components**
These components exist in `src/features/session/components/` but are never used in the actual pages (pages use raw inputs and inline styles instead). Refactor `LoginPage` and `RegisterPage` to use them for consistency.

**R16: Replace `useState` forms with `react-hook-form` + Zod**
`react-hook-form` and `zod` are installed as production dependencies but are not used in any page. All forms use raw `useState`. Migrate at minimum `LoginPage`, `RegisterPage`, and admin forms to use the installed form library for validation.

**R17: Extract `QuickActions` from `DashboardPage` to a feature component**
`DashboardPage.tsx` defines `QuickActions` as a local function component. Move it to `src/features/dashboard/components/DashboardQuickActions.tsx` for testability and reuse.

**R18: Standardize query invalidation logic**
Four separate hooks (`useChapterFileActions`, `useChapterUpload`, `useStructuringProcessing`, `useTechnicalApply`) each implement identical `refreshReadState` functions that invalidate the same 7-8 query keys. Extract this into a shared utility: `src/features/projects/useProjectCacheInvalidation.ts`.

**R19: Fix nginx config to serve React build**
The nginx config has no rule to serve the React SPA's static files. Add a `location /ui/` block that serves the `frontend/dist` directory with `try_files $uri /ui/index.html` for client-side routing support.

**R20: Define a frontend-side admin guard**
`AdminDashboardPage` and `AdminUsersPage` rely solely on the backend 403 to block non-admins. Add a React route guard that checks `viewer.roles.includes("Admin")` in the router and redirects to `/ui/dashboard` — this avoids a round-trip error page for non-admin users who navigate to admin routes.
