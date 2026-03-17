# Phase 4 Frontend Migration Contract Plan

Static analysis only. This document defines the lowest-risk frontend migration path for the current FastAPI CMS using the stabilized backend contracts from Phase 1 through Phase 3. It does not assume a blind rewrite and does not require every module to move into the same frontend model.

Reference documents:
- [phase0_repository_inventory.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration_plan/phase0_repository_inventory.md)
- [phase1_contract_map.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase1_contract_map.md)
- [phase2_service_extraction_plan.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase2_service_extraction_plan.md)
- [phase3_api_normalization_plan.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase3_api_normalization_plan.md)

Frontend migration target legend:
- `keep SSR`: page remains fully backend-rendered for the foreseeable migration window.
- `SSR + JS island`: backend keeps the shell and first paint; isolated interactive regions become API-driven.
- `HTMX`: backend still owns rendered HTML, but partial updates are progressively enhanced through fragment requests.
- `typed frontend module`: page becomes a contract-driven frontend module consuming stable DTOs and JSON endpoints. This remains framework-neutral at the contract level even if React is the likely eventual implementation path under the repo's long-term direction.

Active template scope for this phase:
- Included: active `.html` templates rendered by current routes plus the two shared layouts.
- Excluded from migration source-of-truth status: `.bak` templates and `dashboard_New.html`, because the active routers do not render them.

## 1. Page Migration Map

### Active routed pages and shared layouts

| Template name | Route(s) | Business purpose | Current render model | Current context dependencies | Current JS/API dependencies | Migration target | Why that target is appropriate | Prerequisites before migration |
|---|---|---|---|---|---|---|---|---|
| `base_tailwind.html` | shared parent for most active pages | primary shell, sidebar, nav, logout link, shared styling | shared SSR layout | `request`, implicit `user` expectations in child templates, active-path checks against `request.url.path` | no current fetch calls in layout; route-based active-nav logic; links to `/dashboard`, `/projects`, `/activities`, `/logout` | keep SSR | it is infrastructure, not a business page; it can host islands or typed modules without itself becoming frontend-owned | stable session bootstrap contract, stable nav permission contract, decision on whether new frontend mounts inside or beside this shell |
| `base.html` | shared parent for legacy holdouts such as `admin_edit_user.html`; legacy backup templates also reference it | legacy shell, top nav, notification dropdown, footer | shared SSR layout | `request`, implicit `user`, navbar expectations | polls `GET /api/notifications`; route-highlighting JS; direct `/logout` navigation | keep SSR | it is already a compatibility shell; replacing it early creates layout churn without business payoff | stable notification feed contract, stable session contract, plan for eventual retirement of remaining `base.html` pages |
| `login.html` | `GET /login`, `POST /login` | browser login | full SSR page with form POST | `request`, optional `error` | standard form POST to `/login`; no JSON | keep SSR | low-value rewrite target; current browser session flow is cookie and redirect based | stable `POST /api/v2/session/login` wrapper, stable `GET /api/v2/session`, explicit decision to preserve browser cookie login |
| `register.html` | `GET /register`, `POST /register` | self-registration | full SSR page with form POST | `request`, optional `error` | standard form POST to `/register`; no JSON | keep SSR | first-user Admin bootstrap and role assignment remain backend-sensitive; SSR keeps that behavior explicit | stable registration contract, explicit decision on whether self-registration remains enabled, parity tests for first-user bootstrap |
| `dashboard.html` | `GET /dashboard` | landing view for project portfolio, summary metrics, quick access to major flows | SSR shell with heavy inline client-side rendering and prototype modal behavior | `request`, `user`, `projects`, `dashboard_stats` | inline JS handles filtering, view switching, client-side table/kanban rendering, modal state, redirects to `/projects/{id}`; no authoritative create/edit/delete API is currently wired | typed frontend module | current page already behaves like a client-rendered view but is fed by implicit SSR data and mock logic; a typed module removes the prototype behavior without breaking the route | `GET /api/v2/session`, `GET /api/v2/dashboard`, `GET /api/v2/projects`, `DashboardPageState` DTO, normalized project delete contract if dashboard will expose delete later |
| `projects.html` | `GET /projects` | focused projects listing and delete entrypoint | SSR page with light JS mutation | `user`, `projects` | inline `fetch()` to `DELETE /api/v1/projects/{project_id}` with reload-on-success; links to `/projects/{id}` | typed frontend module | bounded scope, existing JSON delete dependency, and straightforward list state make this a safe early typed module | `GET /api/v2/projects`, `DELETE /api/v2/projects/{project_id}`, `ProjectsPageState` DTO, normalized delete side effects matching SSR delete semantics |
| `project_create.html` | `GET /projects/create`, `POST /projects/create_with_files` | create project, optionally bootstrap initial uploads | full SSR form page with multipart submission | `user` | multipart POST to `/projects/create_with_files`; no AJAX; hardcoded client and XML option lists in template | SSR + JS island | the flow is high-side-effect and multipart; the lowest-risk path is to keep the page shell/server validation while optionally moving form-state and progress UI into an island later | `POST /api/v2/projects/bootstrap`, stable bootstrap error contract, `ProjectCreatePageState` DTO, normalized project bootstrap semantics and tests for initial file ingestion |
| `project_chapters.html` | `GET /projects/{project_id}`, `GET /projects/{project_id}/chapters`, `POST /projects/{project_id}/chapters/create`, `POST /projects/{project_id}/chapter/{chapter_id}/rename`, `POST /projects/{project_id}/chapter/{chapter_id}/delete` | chapter index, chapter create/rename/delete, chapter package download navigation | SSR page with modal JS and form posts | `request`, `user`, `project`, `chapters` with derived flags such as `has_art`, `has_ms`, `has_ind`, `has_proof`, `has_xml` | inline JS for rename modal; form posts to create/rename/delete chapter routes; download link to `/projects/{project_id}/chapter/{chapter_id}/download`; click-through to chapter detail route | SSR + JS island | the page is interactive, but its state remains list-and-modal oriented rather than app-like; keeping the shell SSR lowers risk while allowing chapter CRUD islands later | `GET /api/v2/projects/{project_id}`, `GET /api/v2/projects/{project_id}/chapters`, `POST /api/v2/projects/{project_id}/chapters`, `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}`, `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}`, `ProjectChaptersPageState` DTO |
| `chapter_detail.html` | `GET /projects/{project_id}/chapter/{chapter_id}` plus related form and AJAX actions | core file-management workspace per chapter | SSR shell with substantial inline JS, many form posts, and polling | `request`, `user`, `project`, `chapter`, `files`, `active_tab`, implicit lock/process permission assumptions | form posts to upload, delete, checkout, cancel checkout; redirects to technical editor; `fetch()` to `POST /api/v1/processing/files/{file_id}/process/{process_type}`, `POST /api/v1/processing/files/{file_id}/process/structuring?mode=...`, `GET /api/v1/processing/files/{file_id}/structuring_status`; redirects to `/api/v1/files/{new_file_id}/structuring/review` | typed frontend module | this is the most state-heavy user page in the CMS; tabs, locks, uploads, process triggers, and polling are already partially frontend-owned, so a typed module is the lowest-risk way to stop layering more logic into Jinja | `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`, `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files`, `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`, `DELETE /api/v2/files/{file_id}`, `POST /api/v2/files/{file_id}/checkout`, `DELETE /api/v2/files/{file_id}/checkout`, `POST /api/v2/files/{file_id}/checkin`, `POST /api/v2/files/{file_id}/processing-jobs`, `GET /api/v2/processing-jobs/{job_id}`, `ChapterDetailPageState` DTO |
| `activities.html` | `GET /activities` | read-only recent activity feed | full SSR page | `request`, `user`, `activities`, `today_count` | no current AJAX; all activity shaping is route-owned | keep SSR | read-only page with no business mutation; little value in moving it before higher-coupling modules | `GET /api/v2/activities` only if later converted to a module or island, `ActivitiesPageState` DTO if shared with frontend shell |
| `admin_dashboard.html` | `GET /admin` | admin summary counts | full SSR page | `user`, `admin_stats` | no AJAX | keep SSR | read-only admin landing page; low leverage as a frontend target | stable session/role bootstrap only |
| `admin_users.html` | `GET /admin/users` plus related role/delete actions | admin user list and inline role/delete management | SSR page with inline forms | `request`, `user`, `current_user`, `users`, `all_roles`, optional `error` | form posts to `/admin/users/{user_id}/role` and `/admin/users/{user_id}/delete`; confirmation dialogs; older backup template also exposes status toggle | SSR + JS island | bounded admin-only surface with strong server-side rules; a JS island can modernize table actions without moving the whole admin shell first | `GET /api/v2/admin/users`, `GET /api/v2/admin/roles`, `PUT /api/v2/admin/users/{user_id}/role`, `DELETE /api/v2/admin/users/{user_id}`, `PUT /api/v2/admin/users/{user_id}/status` if reinstated, `AdminUsersPageState` DTO |
| `admin_create_user.html` | `GET /admin/users/create`, `POST /admin/users/create` | create user as admin | full SSR form page | `user`, `roles`, optional `error` | standard form POST; no AJAX | keep SSR | simple form with clear backend validation and low interaction needs; keeping it SSR avoids building fragment or modal infrastructure too early | `POST /api/v2/admin/users` only if the form later becomes modal or island-driven; `AdminCreateUserPageState` DTO for consistency |
| `admin_edit_user.html` | `GET /admin/users/{user_id}/edit`, `POST /admin/users/{user_id}/edit` | edit user email | full SSR form page on legacy `base.html` shell | `user`, `target`, `roles` | standard form POST; no AJAX | keep SSR | narrow single-purpose page with little interactive value; also currently sits on the legacy layout, so moving it early adds styling and routing churn | `GET /api/v2/admin/users/{user_id}`, `PATCH /api/v2/admin/users/{user_id}`, `AdminEditUserPageState` DTO, eventual layout normalization from `base.html` to `base_tailwind.html` or new frontend shell |
| `admin_change_password.html` | `GET /admin/users/{user_id}/password`, `POST /admin/users/{user_id}/password` | admin password reset/change | full SSR form page | `user`, `target_user` or `target`, optional `error` | standard form POST; no AJAX | keep SSR | duplicate backend route ownership and mixed template context keys make this a poor early frontend target | canonical password route ownership, `PUT /api/v2/admin/users/{user_id}/password`, normalized page-state DTO using one target-user key |
| `admin_stats.html` | `GET /admin/stats` | admin reporting page | full SSR page | `user`, `stats` | no AJAX | keep SSR | read-only reporting page; no user benefit from frontend migration before core workflows | stable session/role bootstrap only |
| `technical_editor_form.html` | `GET /files/{file_id}/technical/edit` | review scan results and apply technical replacements | SSR shell with strong JSON dependence | `file`, `user` | `fetch()` to `GET /api/v1/processing/files/{file_id}/technical/scan` and `POST /api/v1/processing/files/{file_id}/technical/apply`; redirects back to chapter on success | typed frontend module | the page already behaves like a standalone client application with remote data, local selection state, and mutation flows | `GET /api/v2/files/{file_id}/technical-review`, `POST /api/v2/files/{file_id}/technical-review/apply`, `TechnicalEditorPageState` DTO, normalized technical issue schema |
| `structuring_review.html` | `GET /api/v1/files/{file_id}/structuring/review`, export link route, WOPI autosave callbacks behind iframe | review processed manuscript in Collabora and export result | SSR integration shell around iframe | `request`, `user`, `file`, `filename`, `collabora_url` | export link to `/api/v1/files/{file_id}/structuring/review/export`; JS only implements `saveAndExit()` redirect; actual edits auto-save through WOPI PutFile callbacks | SSR + JS island | backend must keep ownership of iframe launch, processed-file resolution, and WOPI lifecycle; only the toolbar and surrounding metadata are reasonable frontend targets | `GET /api/v2/files/{file_id}/structuring-review`, `GET /api/v2/files/{file_id}/structuring-review/editor-launch`, `GET /api/v2/files/{file_id}/structuring-review/export`, `StructuringReviewPageState` DTO, stable WOPI boundary documentation |
| `editor.html` | `GET /files/{file_id}/edit` | edit original file in Collabora | SSR integration shell around iframe | `request`, `user`, `file`, `filename`, `collabora_url` | no business AJAX; actual editing is entirely through WOPI endpoints and Collabora iframe | keep SSR | this is an integration launch wrapper, not an application page; frontend ownership adds little and can break the editor lifecycle | optional `GET /api/v2/files/{file_id}/editor-launch` support endpoint if shell metadata needs to be consumed elsewhere |
| `error.html` | rendered from structuring review error paths | generic user-visible error fallback | full SSR page | `error_message` | no AJAX | keep SSR | generic backend-controlled failure page should remain available regardless of frontend state | none beyond preserving template availability |

### Non-routed template artifacts

| Template name | Current status | Migration handling |
|---|---|---|
| `dashboard_New.html` | present in repo but not rendered by active routers | do not treat as active UI contract; ignore for frontend cutover planning unless a route begins using it |
| `*.bak` templates | backup variants of older layouts/pages | exclude from active migration scope; keep only as historical reference during parity investigation |

## 2. Frontend Boundary Map

| Module | Current backend dependencies | API prerequisites | Page-state DTO prerequisites | Migration complexity | Coupling risk | Recommended timing |
|---|---|---|---|---|---|---|
| Auth/session UI | `/login`, `/logout`, `/register`, `get_current_user_from_cookie`, `create_access_token`, cookie redirects, role bootstrap during registration | `POST /api/v2/session/login`, `GET /api/v2/session`, `DELETE /api/v2/session`, optional `POST /api/v2/registration` | `LoginPageState`, `RegisterPageState`, shared `Viewer` bootstrap DTO | Medium | High because every page depends on auth bootstrap semantics | Stage 1 as a bridge contract; pages stay SSR initially |
| Dashboard | `/dashboard`, `project_service.get_projects`, route-owned stats, `dashboard.html` prototype JS | `GET /api/v2/dashboard`, `GET /api/v2/projects`, `GET /api/v2/session` | `DashboardPageState`, `ProjectSummary` | High | Medium because business logic is mostly read-model shaping, not heavy mutation | Stage 4 after session and project list contracts are stable |
| Project list | `/projects`, `GET /api/v1/projects/`, `DELETE /api/v1/projects/{id}`, project route links | `GET /api/v2/projects`, `DELETE /api/v2/projects/{project_id}`, `GET /api/v2/session` | `ProjectsPageState`, `ProjectSummary` | Medium | Medium because delete semantics currently diverge between SSR and API routes | Stage 3 after delete contract normalization |
| Admin users | `/admin/users`, `/admin/users/create`, `/admin/users/{id}/role`, `/admin/users/{id}/delete`, duplicate password/delete routes, admin role checks | `GET /api/v2/admin/users`, `GET /api/v2/admin/roles`, `POST /api/v2/admin/users`, `PUT /api/v2/admin/users/{id}/role`, `PUT /api/v2/admin/users/{id}/status`, `PUT /api/v2/admin/users/{id}/password`, `DELETE /api/v2/admin/users/{id}` | `AdminUsersPageState`, `AdminCreateUserPageState`, `AdminEditUserPageState`, `AdminChangePasswordPageState` | High | High because last-admin and self-delete/self-lockout rules must remain exact | Stage 5 after auth/session and admin route duplication are stabilized |
| Project creation | `/projects/create`, `POST /projects/create_with_files`, project bootstrap logic in `web.py`, storage tree creation, chapter auto-generation, optional initial file ingestion | `POST /api/v2/projects/bootstrap`, `POST /api/v2/projects`, `GET /api/v2/session` | `ProjectCreatePageState`, `ProjectSummary`, `ChapterSummary`, ingest result DTOs | High | Very High because the current route hides many side effects behind redirect-only SSR | Stage 6 after project bootstrap contract and service extraction are stable |
| Chapter detail | `/projects/{project_id}/chapter/{chapter_id}`, file queries, lock state, tab state, file-action forms, process permissions, redirect messages | `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`, `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files`, `DELETE /api/v2/files/{id}`, `POST /api/v2/files/{id}/checkout`, `DELETE /api/v2/files/{id}/checkout`, `POST /api/v2/files/{id}/processing-jobs`, `GET /api/v2/processing-jobs/{job_id}` | `ChapterDetailPageState`, `ChapterDetail`, `FileRecord`, `ProcessPermissionDTO`, `LockState` | Very High | Very High because this page is the operational center of the CMS | Stage 8, after project/chapter/file contracts are proven elsewhere |
| Uploads/versioning | chapter upload route, hidden check-in behavior inside upload flow, `FileVersion` archive writes, overwrite semantics, file lock interactions | `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`, `POST /api/v2/files/{file_id}/checkin`, `GET /api/v2/files/{file_id}/versions`, `GET /api/v2/files/{file_id}/versions/{version_id}/download` | `FileRecord`, `VersionRecord`, upload result DTOs | Very High | Very High because user trust depends on exact archive/version behavior | Stage 9, only after chapter detail read model is stable |
| Activities/notifications | `/activities`, `/api/notifications`, route-owned activity shaping, legacy `base.html` notification polling | `GET /api/v2/activities`, `GET /api/v2/notifications`, `GET /api/v2/session` | `ActivitiesPageState`, `ActivityItem`, `NotificationItem` | Low to Medium | Low for notifications, Medium for activities because the read model is route-owned | Stage 2 for notifications, Stage 3 for optional activities island |
| Technical editor | `/files/{file_id}/technical/edit`, technical scan/apply APIs, role-based processing permissions, file redirect back to chapter | `GET /api/v2/files/{file_id}/technical-review`, `POST /api/v2/files/{file_id}/technical-review/apply`, `GET /api/v2/session` | `TechnicalEditorPageState`, `TechnicalIssue`, `FileRecord` | High | Medium because the workflow is isolated even though the data shape is dynamic | Stage 10 after file and processing contracts are stable |
| Structuring review | `/api/v1/files/{file_id}/structuring/review`, `/api/v1/files/{file_id}/structuring/review/export`, `/api/v1/files/{file_id}/structuring/save`, processed-file resolution, Collabora URL generation | `GET /api/v2/files/{file_id}/structuring-review`, `POST /api/v2/files/{file_id}/structuring-review/save`, `GET /api/v2/files/{file_id}/structuring-review/export`, `GET /api/v2/files/{file_id}/structuring-review/editor-launch` | `StructuringReviewPageState`, processed-file metadata DTO | Very High | Very High because backend/integration ownership dominates the workflow | Stage 11 after processing and WOPI boundaries are already stable |
| WOPI/editor wrapper support | `/files/{file_id}/edit`, `/wopi/files/{file_id}`, `/wopi/files/{file_id}/contents`, structuring WOPI variants, Collabora URL construction | optional `GET /api/v2/files/{file_id}/editor-launch` only; WOPI callback routes stay unchanged | `EditorPageState` if shell metadata is normalized | Very High for full rewrite, Low for support-only metadata | Very High because these are protocol endpoints rather than normal UI routes | Deferred to final stage; keep backend-owned during early and mid migration |

## 3. State Ownership Map

| Module | Server-rendered state that should remain backend-owned | State that should move to API-driven frontend ownership | Transient UI state | Polling or async state | File-action state | Integration-owned state |
|---|---|---|---|---|---|---|
| Auth/session UI | cookie issuance/deletion, redirect decisions for `/`, `/login`, `/logout`, role bootstrap on registration, SSR error rendering fallback | session bootstrap DTO, explicit login/logout result payloads, viewer identity consumed by new frontend routes | field dirtiness, submit loading, inline validation presentation | optional session refresh/bootstrap on app load | none | none |
| Dashboard | initial shell, sidebar/nav, default route ownership, any server fallback rendering | dashboard metrics, project list, filterable/sortable dashboard cards, project summary refresh | selected view, search term, modal visibility, client-side sort | optional background refresh of dashboard metrics if introduced later | none | none |
| Project list | initial auth guard and shell route | project collection, delete mutation result, empty/loading/error states | delete-confirm modal state, search/filter text, optimistic removal markers | list refresh after deletion | none | none |
| Admin users | admin access guard, fallback form routes, last-admin protection and self-guards enforced on backend | user list, roles list, create/update/delete/status/password mutation responses | inline confirm dialogs, selected role dropdown state, form errors, success toasts | optional table refresh after mutation | none | none |
| Project creation | initial page shell, hard validation, actual bootstrap transaction, redirect semantics on success/failure | form option loading if later externalized, bootstrap result payload, field-level error contract, upload progress UI | selected files, chapter count edits, client/XML selections, submit/abort state | multipart submit progress, bootstrap completion state | initial file staging before submit | none |
| Project chapters | initial project/chapter shell, chapter permission guards, chapter package download route | chapter list refresh, create/rename/delete mutation results, derived chapter flags, form validation messages | open/close modal state, draft rename fields, optimistic row updates | mutation pending state and list refetch | chapter package download remains backend-owned | none |
| Chapter detail | shell route, canonical breadcrumb values, permission gates, download URLs, initial fallback rendering | active file lists, category counts, lock state, flash messages, process permissions, mutation results, chapter tab metadata | active tab, selected files/processes, modal visibility, local form errors, optimistic row state | processing job polling, upload progress, refresh-after-mutation behavior | upload, delete, checkout, cancel checkout, check-in, processing launch | redirect into structuring review/editor routes remains backend-owned |
| Uploads/versioning | version numbering, archive copy creation, filesystem paths, overwrite decision logic, hidden unlock behavior on replacement | upload result payloads, skipped-file reasons, version history listing, check-in result payloads | drag/drop or picker state, staged file list, conflict presentation | upload progress, version-history refresh after replace/check-in | upload, check-in, version download entry points | none |
| Activities/notifications | nav shell placement, activity derivation logic until API exists, relative-time fallback formatting | notification feed items, activity feed items, empty/error/loading states, pagination/filter state if later added | dropdown open state, filter toggles, unread/highlight markers if introduced | navbar notification polling, optional activity auto-refresh | none | none |
| Technical editor | shell route, permission guard, source file metadata, return route | issue list, replacement options, apply result, success/error envelope | selected replacement choices, dirty form state, collapsed/expanded issue groups | scan loading, apply submit state, optional retry state | generated edited-file redirect and result metadata | none |
| Structuring review | processed-file lookup, iframe shell, Collabora URL, export route, fallback error page | review metadata, save result metadata if explicit save remains, toolbar status labels, return-route metadata | save-and-exit button state, export busy state, shell-level error banners | optional processed-file readiness state before opening page, not the actual editing itself | export action only; actual document save stays backend/integration owned | Collabora iframe session, WOPI callback lifecycle, file writes through `PutFile` |
| WOPI/editor wrapper support | all WOPI CheckFileInfo/GetFile/PutFile behavior, editor launch shell, file-byte persistence | optional launch metadata support endpoint only | minimal shell labels or iframe loading state if ever surfaced | iframe load spinner only | none beyond backend-delivered file bytes | all editor save state, file stream lifecycle, reverse-proxy/WOPI protocol concerns |

## 4. Frontend Delivery Order

| Stage | Module name | Why it belongs in that stage | Dependencies on earlier contract work | Rollback considerations |
|---|---|---|---|---|
| 1 | Session bootstrap and shared layout bridge | every modernized page needs a stable viewer/session bootstrap, but the visible login/register pages can remain SSR | Phase 1 auth/session DTOs, Phase 2 auth/session service extraction, Phase 3 `/api/v2/session*` contracts | keep `/login`, `/logout`, `/register`, and SSR guards untouched; if the bridge fails, pages still render server-side |
| 2 | Notifications first, activities second | notifications are low-risk and already partially client-consumed; activities are read-only and can remain SSR even if an API is added | stable `NotificationItem` and `ActivityItem` contracts, `/api/v2/notifications`, `/api/v2/activities` | legacy `base.html` can keep polling `/api/notifications`; the new frontend feed can be removed without route changes |
| 3 | Project list | bounded surface, existing fetch-based delete behavior, clear user value, and no multipart complexity | normalized project delete contract, `/api/v2/projects`, `/api/v2/projects/{id}`, `ProjectsPageState` DTO | keep `/projects` SSR rendering as fallback and continue accepting current `DELETE /api/v1/projects/{id}` while parity is verified |
| 4 | Dashboard | shares data domain with project list and benefits from stable session/project summary contracts | Stage 1 and Stage 3 complete, `/api/v2/dashboard`, `/api/v2/projects`, `DashboardPageState` DTO | retain `/dashboard` SSR shell until dashboard module reproduces current navigation and summary metrics |
| 5 | Admin user table and bounded admin mutations | admin-only surface limits blast radius; role/delete flows can move incrementally behind a table island or module | admin route duplication understood, `/api/v2/admin/*` contracts stable, admin DTOs normalized | keep admin create/edit/password pages SSR and let `/admin/users` fall back to current form posts if the new table is disabled |
| 6 | Project creation | once project and session contracts are stable, the create flow can modernize carefully around the existing backend bootstrap transaction | `/api/v2/projects/bootstrap`, bootstrap error schema, `ProjectCreatePageState` DTO, service extraction for project bootstrap | leave `/projects/create` SSR page and `POST /projects/create_with_files` active; frontend path can simply route back to server form if needed |
| 7 | Project chapters | chapter list and modal operations are easier once project create and project detail contracts already exist | `/api/v2/projects/{id}`, `/api/v2/projects/{id}/chapters`, chapter create/rename/delete contracts, chapter DTOs | keep chapter create/rename/delete forms active on the SSR page until the island or module is stable |
| 8 | Chapter detail read surface | the route is central and high-value, but first move only the read model and presentation state before the highest-risk mutations | stable chapter detail DTO, files list DTO, session bootstrap, process permission contract | keep the current SSR page route and progressively disable only the module, not the backend route |
| 9 | Uploads/versioning and checkout/check-in | these are mutation-heavy and should only move after the chapter detail read model is already trusted | canonical upload/version/history/check-in/checkout contracts, file/version services extracted, regression tests for overwrite/archive semantics | preserve the existing upload and checkout form posts as the compatibility path until file-archive parity is proven |
| 10 | Processing trigger and job/status UI | process launch and polling should move only after file mutation and chapter detail ownership are stable | `/api/v2/files/{id}/processing-jobs`, `/api/v2/processing-jobs/{job_id}`, normalized process permissions, explicit status schema | keep current `/api/v1/processing/...` calls working and preserve redirect/polling fallback in the SSR page |
| 11 | Technical editor | isolated but still depends on normalized file and processing contracts; high leverage once those exist | `/api/v2/files/{id}/technical-review`, `TechnicalIssue` schema, chapter return-route contract | existing `/files/{id}/technical/edit` shell can remain and continue calling legacy endpoints until the typed module reaches parity |
| 12 | Structuring review shell enhancements | the page should modernize only around the edges; backend still owns editor launch and autosave | `/api/v2/files/{id}/structuring-review`, editor-launch metadata, stable export contract, documented WOPI boundaries | keep the current SSR shell and Collabora iframe route active; disable the surrounding toolbar enhancements first if issues arise |
| 13 | WOPI/original editor wrapper support | least benefit and highest integration sensitivity; only do support-level frontend work, not ownership transfer | stable backend-owned WOPI service boundary, optional editor-launch support endpoint | keep `/files/{id}/edit` and all `/wopi/files/*` routes fully backend-owned regardless of frontend rollback elsewhere |

## 5. Deferred and Backend-Owned Areas

### Pages that should remain SSR

| Page/template | Reason for deferral |
|---|---|
| `login.html` | cookie session semantics and redirect-based auth still define the rest of the app |
| `register.html` | first-user Admin bootstrap and duplicate-user handling are backend-sensitive |
| `admin_dashboard.html` | read-only, low leverage, no user workflow pressure |
| `admin_create_user.html` | simple form with strong backend validation and little UI complexity |
| `admin_edit_user.html` | narrow mutation surface and currently on the legacy `base.html` shell |
| `admin_change_password.html` | duplicate route ownership must stabilize first |
| `admin_stats.html` | read-only reporting page |
| `activities.html` | read-only page that can remain server-rendered even if an API is added |
| `error.html` | generic backend fallback page should always exist independently of frontend state |
| `project_create.html` | should stay SSR until the bootstrap transaction and multipart error contract are fully normalized |

### Integration pages that should remain backend-owned

| Page/template or route surface | Reason it should remain backend-owned |
|---|---|
| `editor.html` | it is an iframe launch shell for Collabora rather than an app page |
| `structuring_review.html` shell | it wraps backend-owned processed-file resolution, Collabora launch, export, and WOPI autosave |
| `GET /projects/{project_id}/chapter/{chapter_id}/download` | browser file delivery and temp zip generation belong on the backend |
| `GET /projects/files/{file_id}/download` | direct file delivery endpoint |
| `GET /api/v1/files/{file_id}/structuring/review/export` and future v2 export alias | file export is backend-owned even if toolbar UI changes |
| `GET /wopi/files/{file_id}` | WOPI CheckFileInfo contract for Collabora |
| `GET /wopi/files/{file_id}/contents` | WOPI GetFile byte delivery |
| `POST /wopi/files/{file_id}/contents` | WOPI PutFile callback persists bytes to disk |
| `GET /wopi/files/{file_id}/structuring` | WOPI CheckFileInfo for processed document |
| `GET/POST /wopi/files/{file_id}/structuring/contents` | processed-file WOPI byte lifecycle |

### Routes that should not be frontend-owned during early migration

| Route | Reason for deferral |
|---|---|
| `GET /` | root ownership is still split between redirect semantics and API root concerns |
| `POST /login` and `GET /logout` | browser session lifecycle must remain stable while compatibility bridges are added |
| `POST /register` | backend bootstrap behavior should not be hidden behind a new client flow too early |
| `POST /projects/create_with_files` | project bootstrap side effects are too dense to replace before the stable bootstrap contract is proven |
| `POST /projects/{project_id}/chapter/{chapter_id}/upload` | overwrite/archive/version behavior must be normalized before client ownership |
| `POST /projects/files/{file_id}/checkout` and `POST /projects/files/{file_id}/cancel_checkout` | lock semantics still need one canonical contract |
| `POST /api/v1/processing/files/{file_id}/process/{process_type}` | start/status normalization must come before frontend ownership of process orchestration |
| `GET /files/{file_id}/edit` | editor launch shell is backend-owned integration infrastructure |
| `GET/POST /wopi/files/*` | Collabora protocol endpoints must not become frontend-owned |
| `GET /api/v1/files/{file_id}/structuring/review` | keep as SSR shell even when surrounding navigation modernizes |

### Why HTMX is not the primary early path in this repo

- The normalized contracts in Phase 3 are JSON-first and already needed by the most stateful pages.
- The highest-value migrations in this CMS are `dashboard.html`, `projects.html`, `chapter_detail.html`, and `technical_editor_form.html`, all of which already depend on client-side state or JSON calls.
- HTMX remains a valid optional pattern for future admin-form refinements, but it is not required for the lowest-risk migration order defined here.

## 6. Deliverable Closure

### Top 10 easiest frontend migration wins

1. Notification feed consumption against a normalized `/api/v2/notifications` contract while keeping the current layout shell.
2. Project list replacement on `/projects` using normalized project list and delete contracts.
3. Dashboard read model replacement once project list and session bootstrap are stable.
4. Admin user list table enhancement with API-backed role/delete actions while leaving create/edit/password pages SSR.
5. Activities read model API introduction without changing the route or full-page SSR ownership.
6. Project chapters modal enhancement for create/rename/delete while keeping the page SSR.
7. Technical editor shell replacement once the scan/apply schema is normalized.
8. Session bootstrap for frontend modules without changing login/register pages.
9. Shared typed notification/activity DTO use across new modules and legacy layouts.
10. Structuring review toolbar metadata enhancement without touching WOPI callbacks.

### Top 10 pages that should remain SSR longest

1. `editor.html`
2. `structuring_review.html` shell
3. `login.html`
4. `register.html`
5. `project_create.html`
6. `admin_change_password.html`
7. `admin_edit_user.html`
8. `admin_dashboard.html`
9. `admin_stats.html`
10. `error.html`

### Top 10 blockers before frontend work can begin

1. No single session bootstrap contract currently covers both cookie and bearer identity.
2. Project delete behavior is inconsistent between SSR and `/api/v1` delete paths.
3. File upload/versioning semantics are hidden in SSR route logic rather than explicit contracts.
4. Processing start/status contracts still lack a canonical job/status model.
5. Admin password and delete routes are duplicated and therefore contract-ambiguous.
6. Root route ownership is split between redirect and API-root behavior.
7. Checkout/cancel-checkout semantics are still redirect-message driven rather than canonical.
8. Project creation exists as both thin API create and full SSR bootstrap, with different side effects.
9. WOPI/editor boundaries are integration-sensitive and must remain clearly backend-owned.
10. The active UI still spans both `base_tailwind.html` and `base.html`, so layout ownership is not fully normalized.

### Recommended frontend migration order

1. Session bootstrap and shared layout bridge.
2. Notifications, then optional activities API support.
3. Project list.
4. Dashboard.
5. Admin user table and bounded admin mutations.
6. Project creation.
7. Project chapters.
8. Chapter detail read surface.
9. Uploads/versioning and checkout/check-in.
10. Processing trigger and status UI.
11. Technical editor.
12. Structuring review shell enhancements.
13. WOPI/original editor wrapper support last, and backend-owned only.
