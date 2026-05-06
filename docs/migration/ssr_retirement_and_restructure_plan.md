# SSR Retirement And Structure Cleanup Plan

## Current State

The repository now runs with `/ui` as the primary operational interface, but the backend still exposes a substantial legacy SSR surface through [app/routers/web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py), [app/routers/structuring.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/structuring.py), and [app/routers/wopi.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/wopi.py). The React app in [frontend/src/app/router.tsx](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/app/router.tsx) now covers dashboard, admin, project, chapter, technical-review, and structuring-review flows.

This plan documents what can be retired, what must remain SSR/backend-owned, and the safest cleanup order.

## 1. Current SSR Routes Still Present In The Backend

### Template-rendering SSR routes

| Router | Method | Path | Current response | Template | Current status |
| --- | --- | --- | --- | --- | --- |
| `web.py` | `GET` | `/` | redirect/home entry | none | Legacy root entry; ownership conflicts with `main.py` root |
| `web.py` | `GET` | `/login` | SSR page | `login.html` | Still active |
| `web.py` | `POST` | `/login` | SSR render/redirect | `login.html` on error | Still active |
| `web.py` | `GET` | `/register` | SSR page | `register.html` | Still active |
| `web.py` | `POST` | `/register` | SSR render/redirect | `register.html` on error | Still active |
| `web.py` | `GET` | `/dashboard` | SSR page | `dashboard.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects` | SSR page | `projects.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects/create` | SSR page | `project_create.html` | Keep only if SSR fallback is desired |
| `web.py` | `GET` | `/admin` | SSR page | `admin_dashboard.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/users/create` | SSR page | `admin_create_user.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/users` | SSR page | `admin_users.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/stats` | SSR page | `admin_stats.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/users/{user_id}/password` | SSR page | `admin_change_password.html` | Frontend-replaced candidate; duplicated path |
| `web.py` | `GET` | `/projects/{project_id}` | SSR page | `project_chapters.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects/{project_id}/chapters` | SSR page | `project_chapters.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects/{project_id}/chapter/{chapter_id}` | SSR page | `chapter_detail.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/activities` | SSR page | `activities.html` | Not yet frontend-replaced |
| `web.py` | `GET` | `/files/{file_id}/technical/edit` | SSR page | `technical_editor_form.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/users/{user_id}/edit` | SSR page | `admin_edit_user.html` | Frontend-replaced candidate |
| `web.py` | `GET` | `/admin/users/{user_id}/password` | SSR page | `admin_change_password.html` | Frontend-replaced candidate; duplicated path |
| `structuring.py` | `GET` | `/api/v1/files/{file_id}/structuring/review` | SSR page | `structuring_review.html` or `error.html` | Frontend-replaced candidate with fallback risk |
| `wopi.py` | `GET` | `/files/{file_id}/edit` | SSR editor launch page | `editor.html` | Must remain backend-owned |

### SSR-coupled mutation/download routes still present

These routes do not render templates directly, but they exist to support legacy forms or backend-owned download/editor flows.

| Router | Method | Path | Current role | Current status |
| --- | --- | --- | --- | --- |
| `web.py` | `GET` | `/logout` | SSR auth/logout handoff | Keep |
| `web.py` | `POST` | `/admin/users/create` | Legacy admin form mutation | Frontend-replaced candidate |
| `web.py` | `POST` | `/admin/users/{user_id}/role` | Legacy admin form mutation | Frontend-replaced candidate |
| `web.py` | `POST` | `/admin/users/{user_id}/delete` | Legacy admin form mutation | Frontend-replaced candidate; duplicated path |
| `web.py` | `POST` | `/admin/users/{user_id}/status` | Legacy admin form mutation | Frontend-replaced candidate |
| `web.py` | `POST` | `/admin/users/{user_id}/password` | Legacy admin form mutation | Frontend-replaced candidate; duplicated path |
| `web.py` | `POST` | `/admin/users/{user_id}/edit` | Legacy admin form mutation | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/create_with_files` | SSR project bootstrap mutation | Keep only if SSR project-create fallback is retained |
| `web.py` | `POST` | `/projects/{project_id}/chapters/create` | Legacy chapter mutation | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/{project_id}/chapter/{chapter_id}/rename` | Legacy chapter mutation | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects/{project_id}/chapter/{chapter_id}/download` | Legacy chapter package download | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/{project_id}/chapter/{chapter_id}/delete` | Legacy chapter mutation | Frontend-replaced candidate; duplicated path |
| `web.py` | `POST` | `/projects/{project_id}/chapter/{chapter_id}/upload` | Legacy upload/versioning mutation | Frontend-replaced candidate |
| `web.py` | `GET` | `/projects/files/{file_id}/download` | Legacy file download | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/files/{file_id}/delete` | Legacy file delete | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/{project_id}/delete` | Legacy project delete | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/files/{file_id}/checkout` | Legacy checkout | Frontend-replaced candidate |
| `web.py` | `POST` | `/projects/files/{file_id}/cancel_checkout` | Legacy cancel-checkout | Frontend-replaced candidate |
| `structuring.py` | `POST` | `/api/v1/files/{file_id}/structuring/save` | Legacy structuring save | Frontend-replaced candidate after `/ui` cutover |
| `structuring.py` | `GET` | `/api/v1/files/{file_id}/structuring/review/export` | Legacy structuring export | Frontend-replaced candidate after `/ui` cutover |
| `wopi.py` | `GET` | `/wopi/files/{file_id}` | WOPI `CheckFileInfo` | Must remain backend-owned |
| `wopi.py` | `GET` | `/wopi/files/{file_id}/contents` | WOPI `GetFile` original | Must remain backend-owned |
| `wopi.py` | `POST` | `/wopi/files/{file_id}/contents` | WOPI `PutFile` original | Must remain backend-owned |
| `wopi.py` | `GET` | `/wopi/files/{file_id}/structuring` | WOPI `CheckFileInfo` structuring | Must remain backend-owned |
| `wopi.py` | `GET` | `/wopi/files/{file_id}/structuring/contents` | WOPI `GetFile` structuring | Must remain backend-owned |
| `wopi.py` | `POST` | `/wopi/files/{file_id}/structuring/contents` | WOPI `PutFile` structuring | Must remain backend-owned |

### Active SSR templates currently present

| Template | Current role | Notes |
| --- | --- | --- |
| `login.html` | Auth login page | Standalone page, not `base_tailwind`-based |
| `register.html` | Auth register page | Standalone page, not `base_tailwind`-based |
| `dashboard.html` | Legacy dashboard | Frontend-replaced |
| `projects.html` | Legacy projects list | Frontend-replaced |
| `project_create.html` | Legacy project bootstrap | Keep only as fallback if desired |
| `project_chapters.html` | Legacy project detail + chapter list | Frontend-replaced |
| `chapter_detail.html` | Legacy chapter/file workflow page | Frontend-replaced |
| `activities.html` | Legacy activities page | Not yet frontend-replaced |
| `admin_dashboard.html` | Legacy admin dashboard | Frontend-replaced |
| `admin_users.html` | Legacy admin users page | Frontend-replaced |
| `admin_create_user.html` | Legacy admin create page | Frontend-replaced |
| `admin_edit_user.html` | Legacy admin edit page | Frontend-replaced; only active template still extending `base.html` |
| `admin_change_password.html` | Legacy admin password page | Frontend-replaced |
| `admin_stats.html` | Legacy admin stats page | Frontend-replaced |
| `technical_editor_form.html` | Legacy technical review page | Frontend-replaced |
| `structuring_review.html` | Legacy structuring review shell | Frontend-replaced with caution |
| `editor.html` | Backend-owned editor/WOPI launch wrapper | Must remain |
| `error.html` | Backend-owned review/editor error fallback | Must remain |
| `base_tailwind.html` | Shared SSR layout | Still required by retained SSR pages |
| `base.html` | Older SSR layout | Still required while `admin_edit_user.html` remains |

### Non-runtime template artifacts present

The following files are present and appear to be legacy artifacts, not primary runtime templates:

- `activities.html.bak`
- `admin_change_password.html.bak`
- `admin_create_user.html.bak`
- `admin_dashboard.html.bak`
- `admin_stats.html.bak`
- `admin_users.html.bak`
- `chapter_detail.html.bak`
- `dashboard.html.bak`
- `login.html.bak`
- `project_chapters.html.bak`
- `register.html.bak`
- `structuring_review.html.bak`
- `dashboard_New.html`

## 2. SSR Routes/Templates Still Required

### Required for login/register

| Route | Template | Why it must stay |
| --- | --- | --- |
| `GET /login` | `login.html` | Frontend session bootstrap explicitly hands off unauthenticated users to backend SSR login |
| `POST /login` | `login.html` on error | Current browser login submission remains backend-owned |
| `GET /logout` | none | Current browser logout handoff remains backend-owned |
| `GET /register` | `register.html` | No frontend register flow exists |
| `POST /register` | `register.html` on error | Current registration flow remains backend-owned |

### Required for editor/WOPI launch

| Route | Template/response | Why it must stay |
| --- | --- | --- |
| `GET /files/{file_id}/edit` | `editor.html` | This is the backend-owned original editor launch wrapper |
| `GET/POST /wopi/files/...` | WOPI responses | These are integration endpoints, not frontend pages |
| `GET/POST /wopi/files/.../structuring...` | WOPI responses | These own structuring file path resolution and editor persistence |

### Required for backend-owned fallback/error handling

| Route or template | Why it must stay |
| --- | --- |
| `error.html` | Current backend-owned fallback for missing processed files and review errors |
| `GET /api/v1/files/{file_id}/structuring/review` | Legacy backend fallback review shell while `/ui` review remains new |
| `base_tailwind.html` | Still required by retained SSR pages such as `project_create.html`, `editor.html`, `error.html`, and any retained auth-adjacent fallback pages |

### Still active but not yet frontend-replaced

These are not part of the keep-only-SSR boundary, but they are also not safe removal candidates yet:

| Route | Template | Why it cannot be removed yet |
| --- | --- | --- |
| `GET /activities` | `activities.html` | No `/ui/activities` route currently exists even though `/api/v2/activities` exists |
| `GET /projects/create` | `project_create.html` | Frontend still uses backend SSR project-creation fallback links |
| `POST /projects/create_with_files` | none | Required if the SSR project-creation fallback remains |

## 3. SSR Routes/Templates Now Replaced By The React Frontend

### Replaced page routes

| Legacy SSR route | Legacy template | Current `/ui` replacement | Candidate status |
| --- | --- | --- | --- |
| `GET /dashboard` | `dashboard.html` | `/ui/dashboard` | Candidate for removal |
| `GET /projects` | `projects.html` | `/ui/projects` | Candidate for removal |
| `GET /projects/{project_id}` | `project_chapters.html` | `/ui/projects/:projectId` | Candidate for removal |
| `GET /projects/{project_id}/chapters` | `project_chapters.html` | `/ui/projects/:projectId` | Candidate for removal |
| `GET /projects/{project_id}/chapter/{chapter_id}` | `chapter_detail.html` | `/ui/projects/:projectId/chapters/:chapterId` | Candidate for removal |
| `GET /admin` | `admin_dashboard.html` | `/ui/admin` | Candidate for removal |
| `GET /admin/users` | `admin_users.html` | `/ui/admin/users` | Candidate for removal |
| `GET /admin/users/create` | `admin_create_user.html` | `/ui/admin/users` | Candidate for removal |
| `GET /admin/users/{user_id}/edit` | `admin_edit_user.html` | `/ui/admin/users` | Candidate for removal |
| `GET /admin/users/{user_id}/password` | `admin_change_password.html` | `/ui/admin/users` | Candidate for removal |
| `GET /admin/stats` | `admin_stats.html` | `/ui/admin` | Candidate for removal |
| `GET /files/{file_id}/technical/edit` | `technical_editor_form.html` | `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review` | Candidate for removal |
| `GET /api/v1/files/{file_id}/structuring/review` | `structuring_review.html` | `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review` | Candidate for removal after fallback decision |

### Replaced form/download/mutation routes

| Legacy SSR route | Current `/ui` or `/api/v2` replacement | Candidate status |
| --- | --- | --- |
| `POST /admin/users/create` | `/api/v2/admin/users` | Candidate for removal |
| `POST /admin/users/{user_id}/role` | `PUT /api/v2/admin/users/{user_id}/role` | Candidate for removal |
| `POST /admin/users/{user_id}/status` | `PUT /api/v2/admin/users/{user_id}/status` | Candidate for removal |
| `POST /admin/users/{user_id}/edit` | `PATCH /api/v2/admin/users/{user_id}` | Candidate for removal |
| `POST /admin/users/{user_id}/password` | `PUT /api/v2/admin/users/{user_id}/password` | Candidate for removal |
| `POST /admin/users/{user_id}/delete` | `DELETE /api/v2/admin/users/{user_id}` | Candidate for removal |
| `POST /projects/{project_id}/chapters/create` | `POST /api/v2/projects/{project_id}/chapters` | Candidate for removal |
| `POST /projects/{project_id}/chapter/{chapter_id}/rename` | `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}` | Candidate for removal |
| `POST /projects/{project_id}/chapter/{chapter_id}/delete` | `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}` | Candidate for removal |
| `GET /projects/{project_id}/chapter/{chapter_id}/download` | `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/package` | Candidate for removal |
| `POST /projects/{project_id}/chapter/{chapter_id}/upload` | `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload` | Candidate for removal |
| `GET /projects/files/{file_id}/download` | `GET /api/v2/files/{file_id}/download` | Candidate for removal |
| `POST /projects/files/{file_id}/delete` | `DELETE /api/v2/files/{file_id}` | Candidate for removal |
| `POST /projects/files/{file_id}/checkout` | `POST /api/v2/files/{file_id}/checkout` | Candidate for removal |
| `POST /projects/files/{file_id}/cancel_checkout` | `DELETE /api/v2/files/{file_id}/checkout` | Candidate for removal |
| `POST /projects/{project_id}/delete` | `DELETE /api/v2/projects/{project_id}` | Candidate for removal |
| `POST /api/v1/files/{file_id}/structuring/save` | `POST /api/v2/files/{file_id}/structuring-review/save` | Candidate for removal after `/ui` cutover is final |
| `GET /api/v1/files/{file_id}/structuring/review/export` | `GET /api/v2/files/{file_id}/structuring-review/export` | Candidate for removal after `/ui` cutover is final |

## 4. Route-By-Route Dependency And Risk Notes Before Removal

| Route or route group | Current dependency/risk note |
| --- | --- |
| `/` | [app/main.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/main.py) also defines `@app.get("/")`; root ownership is ambiguous and should be made explicit before any cleanup |
| `/login`, `/logout`, `/register` | Still required because frontend auth remains SSR-owned |
| `/dashboard` | Still referenced by frontend SSR fallback links in [appPaths.ts](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/utils/appPaths.ts); remove only after fallback links are pruned or repointed |
| `/projects` | Still referenced by frontend SSR fallback links in [appPaths.ts](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/utils/appPaths.ts) |
| `/projects/create` | Still used by frontend fallback action from dashboard/projects empty states; there is no `/ui/projects/create` flow yet |
| `/projects/{project_id}` and `/projects/{project_id}/chapters` | Still referenced by frontend fallback links and still serve the same template; safe removal requires pruning both aliases together |
| `/projects/{project_id}/chapter/{chapter_id}` | Still referenced by frontend fallback links and by retained legacy templates |
| `/projects/{project_id}/chapter/{chapter_id}/upload` | Removal is safe only after confirming `/ui` upload/versioning is the only supported entry and no retained SSR page posts to it |
| `/projects/files/{file_id}/download` | Legacy deep links may still exist in retained templates and user bookmarks |
| `/projects/files/{file_id}/checkout` and `/cancel_checkout` | Removal requires explicit regression around lock lifecycle from `/ui` only |
| `/activities` | Not frontend-replaced; removal would drop currently available functionality |
| `/admin`, `/admin/users` | Still referenced by frontend SSR fallback links; remove only after fallback links are pruned |
| `/admin/users/create`, `/edit`, `/password` | Legacy templates still active; `admin_edit_user.html` is the last active template extending `base.html`, so removing these pages is the prerequisite for removing `base.html` |
| `/admin/users/{user_id}/password` | Duplicated GET and POST registrations exist in `web.py`; cleanup must verify effective runtime owner before removal |
| `/admin/users/{user_id}/delete` | Duplicated POST registrations exist in `web.py`; cleanup must preserve whichever handler currently wins at runtime until the route is retired |
| `/projects/{project_id}/chapter/{chapter_id}/delete` | Duplicated POST registrations exist in `web.py`; cleanup must preserve current effective behavior until the route is retired |
| `/files/{file_id}/technical/edit` | Replaced by `/ui`, but legacy `chapter_detail.html` still links to it |
| `/api/v1/files/{file_id}/structuring/review` | Legacy `chapter_detail.html` contains JS that redirects to this route after structuring processing; remove only after legacy chapter detail is retired |
| `/files/{file_id}/edit` | Must remain because this is still the backend-owned original editor launch wrapper |
| `/wopi/files/...` | Must remain because these are integration endpoints, not frontend page routes |
| `error.html` | Must remain until all backend-owned review/editor fallback paths are retired or reimplemented |

## 5. Proposed Backend Folder Restructuring

This is a cleanup proposal only. It does not change ownership boundaries.

### Current backend structure pressure points

- [app/routers/web.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) still mixes:
  - retained auth SSR routes
  - optional fallback SSR routes
  - legacy admin/project/chapter/file pages that are now frontend-replaced
- [app/templates](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates) contains:
  - active retained templates
  - frontend-replaced templates
  - backup artifacts

### Proposed backend restructuring target

| Current location | Proposed direction | Purpose |
| --- | --- | --- |
| `app/routers/web.py` | split into `app/routers/legacy_auth.py`, `app/routers/legacy_fallback.py`, `app/routers/legacy_ui.py` | Separate retained SSR auth/fallback routes from retirement-candidate legacy UI routes |
| `app/routers/structuring.py` | move under `app/routers/legacy_review.py` or `app/routers/legacy/structuring.py` | Make its legacy-fallback status explicit |
| `app/routers/wopi.py` | move under `app/routers/integrations/wopi.py` | Keep WOPI clearly marked as backend-owned integration surface |
| `app/templates` | group into `auth/`, `legacy/`, `editor/`, `shared/`, `artifacts/` | Separate retained templates from retirement candidates and `.bak` artifacts |

### Template grouping target

| Proposed folder | Existing files that fit there |
| --- | --- |
| `app/templates/auth/` | `login.html`, `register.html` |
| `app/templates/editor/` | `editor.html`, `error.html` |
| `app/templates/legacy/` | `dashboard.html`, `projects.html`, `project_chapters.html`, `chapter_detail.html`, `admin_*.html`, `technical_editor_form.html`, `structuring_review.html`, `activities.html`, `project_create.html` |
| `app/templates/shared/` | `base_tailwind.html`, `base.html` |
| `app/templates/artifacts/` | all `.bak` files and `dashboard_New.html` |

## 6. Proposed Frontend Folder Restructuring

The frontend is already feature-oriented. The cleanup objective is to make the remaining backend-owned boundaries explicit and remove obsolete SSR fallback references after retirement.

### Current frontend structure that should stay

- `src/features/session`
- `src/features/admin`
- `src/features/projects`
- `src/features/notifications`
- `src/features/processing`
- `src/features/technicalReview`
- `src/features/structuringReview`
- `src/pages`
- `src/api`
- `src/types`

### Proposed cleanup target

| Current area | Proposed direction | Reason |
| --- | --- | --- |
| `src/utils/appPaths.ts` | keep `uiPaths`, reduce `ssrPaths` to only retained backend-owned paths | Today it still contains fallback links for dashboard/projects/admin/chapter detail routes that are planned removal candidates |
| `src/pages/*` | remove fallback links to retired SSR pages route-by-route | Prevent the frontend from depending on removed legacy pages |
| `src/features/structuringReview` | optionally add a small `editorHandoff` or `integrationHandoff` submodule later | Keep backend-owned `collabora_url` launch semantics explicit without embedding the editor |

### Final SSR path set after cleanup

If cleanup stops at WOPI handoff only, the frontend should need SSR paths only for:

- `/login`
- `/logout`
- `/register` if retained
- `/projects/create` only if the SSR project-creation fallback is retained
- `/files/{file_id}/edit`

All other current `ssrPaths` entries are removal candidates once legacy fallback links are removed.

## 7. Safe Removal Order

1. Remove or isolate template artifacts first.
   - Move `.bak` files and `dashboard_New.html` out of the runtime template directory after verifying they are not referenced.

2. Prune frontend fallback links to frontend-replaced SSR pages.
   - Remove dependencies on SSR dashboard, projects, project detail, chapter detail, admin dashboard, and admin users fallback URLs from [appPaths.ts](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/utils/appPaths.ts) and the pages that consume them.

3. Retire frontend-replaced admin SSR pages and their paired POST handlers.
   - `admin_dashboard.html`
   - `admin_users.html`
   - `admin_create_user.html`
   - `admin_edit_user.html`
   - `admin_change_password.html`
   - `admin_stats.html`
   - paired `/admin/...` POST handlers

4. Retire frontend-replaced dashboard/projects/chapter SSR pages and their paired handlers.
   - `dashboard.html`
   - `projects.html`
   - `project_chapters.html`
   - `chapter_detail.html`
   - paired chapter/file/project POST routes and package/download legacy routes

5. Retire `technical_editor_form.html` and `/files/{file_id}/technical/edit`.
   - Do this only after confirming all operational technical-review entry points are through `/ui`.

6. Decide whether to keep or replace SSR project creation.
   - If keeping fallback: retain `/projects/create`, `project_create.html`, and `POST /projects/create_with_files`.
   - If replacing: add a frontend project-create flow first, then retire the SSR route/template pair.

7. Decide whether to keep or replace SSR activities.
   - `GET /api/v2/activities` already exists, but there is no `/ui/activities` page yet.
   - Do not remove `activities.html` or `/activities` before that gap is closed.

8. Retire the legacy structuring review SSR shell last among frontend-replaced flows.
   - Remove `structuring_review.html` and `/api/v1/files/{file_id}/structuring/review*` only after:
     - legacy `chapter_detail.html` is gone
     - all review entry points use `/ui`
     - save/export parity is verified through `/api/v2`

9. Keep the backend-owned boundary.
   - retain `login.html`
   - retain `register.html` while registration stays SSR-owned
   - retain `project_create.html` only if fallback is desired
   - retain `editor.html`
   - retain `error.html`
   - retain all `/wopi/...` routes

10. Resolve the root route explicitly after cleanup.
   - Choose a single owner for `/` after the legacy route surface is reduced.
   - If `/ui` is primary, final root ownership should be explicit and tested.

## 8. Required Regression And Manual Checks After Cleanup

### Automated regression checks

- Run backend regression suite:
  - `python -m pytest -q tests`
- Run frontend checks:
  - `npm.cmd run test`
  - `npm.cmd run typecheck`
  - `npm.cmd run build`

### Route retirement checks

For each removed SSR route/template pair:

- confirm there is no remaining reference in:
  - `frontend/src/utils/appPaths.ts`
  - `frontend/src/pages`
  - retained backend templates
  - backend redirect helpers
- confirm the corresponding `/api/v2` flow is already covered by automated tests
- confirm deep-link navigation still works through `/ui`

### Manual checks after each cleanup wave

| Area | Required manual check |
| --- | --- |
| Auth | Visit `/ui` unauthenticated and confirm handoff to backend `/login`; verify logout still lands on backend auth page |
| Register | If retained, verify `/register` still renders and submits correctly |
| Project creation fallback | If retained, verify `/projects/create` and `POST /projects/create_with_files` still work end-to-end |
| Dashboard/projects | Confirm no frontend page still links to backend `/dashboard` or `/projects` |
| Project/chapter detail | Confirm no frontend page still links to backend `/projects/{id}` or `/projects/{id}/chapter/{id}` |
| Admin | Confirm no frontend page still links to backend `/admin` or `/admin/users` if those routes are retired |
| Upload/versioning | Confirm overwrite, version archive creation, and skip-on-foreign-lock behavior still work through `/ui` only |
| Technical review | Confirm technical review remains reachable from `/ui` and `_TechEdited` derivatives still appear |
| Structuring review | Confirm `/ui` review metadata, save, and export still work after any legacy route retirement |
| Editor/WOPI | Confirm `/files/{file_id}/edit` still opens the backend-owned editor wrapper and that WOPI callbacks still function |
| Root path | Confirm `/` lands on the intended owner after cleanup and does not depend on duplicate definitions |

## Recommended Cleanup Boundary

If `/ui` is the primary operational interface and WOPI/editor remains backend-owned, the safest end state is:

- keep SSR only for:
  - login/logout/register
  - optional project-creation fallback
  - editor/WOPI launch wrappers and callbacks
  - backend-owned error/fallback pages
- retire SSR for:
  - dashboard
  - projects
  - project detail/chapter list
  - chapter detail/file workflows
  - admin pages
  - technical review page
  - legacy structuring review shell
- defer retirement for:
  - activities, until a `/ui` replacement exists

That boundary matches the current repository state and preserves the backend-owned editor integration line.
