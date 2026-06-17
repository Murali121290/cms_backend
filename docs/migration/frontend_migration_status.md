# Frontend Migration Status

## Current `/ui` Routes Implemented

| Route | Current purpose | Notes |
| --- | --- | --- |
| `/ui` | Frontend shell entry | Redirects to `/ui/dashboard` after session bootstrap |
| `/ui/dashboard` | Dashboard summary | Uses `/api/v2/dashboard` |
| `/ui/admin` | Admin dashboard | Uses `/api/v2/admin/dashboard` |
| `/ui/admin/users` | Admin users CRUD shell | Uses `/api/v2/admin/*` contracts already implemented |
| `/ui/projects` | Projects list | Uses `/api/v2/projects` |
| `/ui/projects/:projectId` | Project detail | Uses project detail + chapter list contracts |
| `/ui/projects/:projectId/chapters/:chapterId` | Chapter detail | Read state, upload, file actions, processing entry, review entry |
| `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review` | Technical review shell | Scan + apply |
| `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review` | Structuring review shell | Metadata + save + export |

## `/api/v2` Contracts Actively Consumed By The Frontend

### Session
- `GET /api/v2/session`
- `DELETE /api/v2/session`

Note:
- `POST /api/v2/session/login` exists in the backend but is not used by the frontend. Login remains SSR-owned through `/login`.

### Dashboard, Projects, Chapters, Files
- `GET /api/v2/dashboard`
- `GET /api/v2/projects`
- `GET /api/v2/projects/{project_id}`
- `GET /api/v2/projects/{project_id}/chapters`
- `POST /api/v2/projects/{project_id}/chapters`
- `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files`
- `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/package`
- `GET /api/v2/files/{file_id}/download`
- `POST /api/v2/files/{file_id}/checkout`
- `DELETE /api/v2/files/{file_id}/checkout`
- `DELETE /api/v2/files/{file_id}`

### Notifications
- `GET /api/v2/notifications`

### Processing And Technical Review
- `POST /api/v2/files/{file_id}/processing-jobs`
- `GET /api/v2/files/{file_id}/processing-status`
- `GET /api/v2/files/{file_id}/technical-review`
- `POST /api/v2/files/{file_id}/technical-review/apply`

### Structuring Review
- `GET /api/v2/files/{file_id}/structuring-review`
- `POST /api/v2/files/{file_id}/structuring-review/save`
- `GET /api/v2/files/{file_id}/structuring-review/export`

### Admin
- `GET /api/v2/admin/dashboard`
- `GET /api/v2/admin/users`
- `POST /api/v2/admin/users`
- `PUT /api/v2/admin/users/{user_id}/role`
- `PUT /api/v2/admin/users/{user_id}/status`
- `PATCH /api/v2/admin/users/{user_id}`
- `PUT /api/v2/admin/users/{user_id}/password`
- `DELETE /api/v2/admin/users/{user_id}`

### Implemented Backend Contracts Not Yet Consumed By The Frontend
- `GET /api/v2/admin/roles`
- `GET /api/v2/activities`
- `POST /api/v2/session/login`
- `POST /api/v2/projects/bootstrap`
- `DELETE /api/v2/projects/{project_id}`
- `GET /api/v2/files/{file_id}/versions`
- `GET /api/v2/files/{file_id}/versions/{version_id}/download`

## SSR Pages Still Active

These server-rendered pages still exist and remain live in the backend:

### Auth And Core Navigation
- `login.html`
- `register.html`
- `dashboard.html`
- `projects.html`
- `project_chapters.html`
- `chapter_detail.html`
- `project_create.html`
- `activities.html`

### Admin
- `admin_dashboard.html`
- `admin_users.html`
- `admin_create_user.html`
- `admin_edit_user.html`
- `admin_change_password.html`
- `admin_stats.html`

### Editor / Review Boundary
- `technical_editor_form.html`
- `structuring_review.html`
- `editor.html`
- `error.html`

### Current practical state
- Frontend routes cover dashboard, projects, chapter flows, admin, technical review, and structuring review shell behavior.
- SSR pages remain available as fallback links and as the current source for login and the original editor pages.

## Flows Now Fully Usable In The Frontend

These flows are usable through `/ui` without relying on SSR page rendering, as long as the user already has a valid browser session:

- Session bootstrap and logout
- Dashboard read flow
- Notifications in the shared shell
- Projects list
- Project detail
- Chapter create
- Chapter rename
- Chapter delete
- Chapter package download
- Chapter detail read flow
- File download
- File checkout
- File cancel checkout
- File delete
- Chapter upload with overwrite/skipped result display
- Structuring processing start
- Structuring processing compatibility-status polling
- Technical review read + apply
- Structuring review metadata page
- Structuring review save
- Structuring review export
- Admin dashboard
- Admin users list
- Admin create user
- Admin role update
- Admin status toggle
- Admin email edit
- Admin password update
- Admin delete user

## Flows Still Dependent On Backend-Owned Editor / WOPI Behavior

These areas still depend on backend-owned integration behavior and are not frontend-owned editor flows:

- Collabora/WOPI launch behavior from the structuring review metadata contract
- WOPI callback routes in `app/routers/wopi.py`
- Original editor launch flow in the SSR `editor.html` path
- Backend-owned save/export semantics for structuring review
- Backend-owned `collabora_url` generation
- Backend-owned original-vs-structuring WOPI path resolution

Current frontend behavior at the editor boundary:
- The structuring review page shows the backend-provided `collabora_url`.
- The frontend can open that URL, save through the provided save endpoint, and export through the provided export href.
- The frontend does not embed the WOPI editor iframe and does not own editor state.

## Manual QA Checklist For Migrated Routes

### Session shell
- Visit `/ui` with a valid cookie session and confirm redirect to `/ui/dashboard`.
- Visit `/ui` without a valid cookie session and confirm handoff to `/login`.
- Click `Logout` from the frontend shell and confirm redirect to `/login`.

### Dashboard
- Open `/ui/dashboard`.
- Confirm stats render.
- Confirm project cards render.
- Confirm notifications open and show recent upload items or an empty state.

### Projects list
- Open `/ui/projects`.
- Confirm filtering works.
- Confirm clicking a project opens `/ui/projects/:projectId`.

### Project detail
- Open `/ui/projects/:projectId`.
- Confirm project metadata loads.
- Confirm chapters load.
- Create a chapter and verify the list refreshes.
- Rename a chapter and verify the list refreshes.
- Delete a chapter and verify the list refreshes.
- Use the package link and confirm a ZIP download is returned.

### Chapter detail
- Open `/ui/projects/:projectId/chapters/:chapterId`.
- Confirm chapter metadata and category counts load.
- Confirm files render with the active category visually emphasized.
- Download a file and confirm the browser download starts.
- Checkout a file and confirm lock state refreshes.
- Cancel checkout and confirm lock state refreshes.
- Delete a file and confirm the file list refreshes.

### Upload/versioning
- Upload a new file and confirm it appears in the file list.
- Overwrite an existing file and confirm the result block shows `replaced` plus archive metadata.
- Attempt overwrite of a file locked by another user and confirm the result block shows a skipped item.

### Processing
- Start structuring from a chapter file row.
- Confirm the pending status banner appears.
- Confirm polling continues until the current compatibility status changes to `completed`.
- Confirm the derived filename is shown when returned.

### Technical review
- Open `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review`.
- Confirm normalized issues render.
- Confirm replacements are selectable/editable.
- Apply changes and confirm the success state appears.
- Return to chapter detail and confirm the new `_TechEdited` derivative appears through normal reads.

### Structuring review shell
- Open `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review`.
- Confirm source file, processed file, styles, save mode, WOPI mode, and provided editor URL render.
- Save a JSON `changes` object and confirm the save result state appears.
- Click export and confirm the processed DOCX downloads.
- Confirm the `Return` action follows backend-provided `return_mode` and `return_href`.

### Admin dashboard
- Open `/ui/admin` as an admin.
- Confirm stats render.
- Confirm the `Admin` nav tab is visible only for admin viewers.

### Admin users
- Open `/ui/admin/users` as an admin.
- Create a user.
- Update a user role.
- Toggle user status.
- Edit a user email.
- Update a password.
- Delete a different user.
- Attempt self-delete and confirm the current backend conflict response is surfaced.

## Contract Validation Checklist For `/api/v2`

### Session and auth
- `GET /api/v2/session` still returns `authenticated`, `viewer`, and `auth`.
- Cookie-based browser auth remains the frontend bootstrap source of truth.
- `DELETE /api/v2/session` still clears the access-token cookie and returns a redirect hint.

### Read models
- Dashboard returns `viewer`, `stats`, and `projects`.
- Project detail returns `project`.
- Project chapters returns `project` plus `chapters`.
- Chapter detail returns `project`, `chapter`, `active_tab`, and `viewer`.
- Chapter files returns `project`, `chapter`, `files`, and `viewer`.
- File records still include `lock` and `available_actions`.

### Chapter mutations
- Create returns `status`, `chapter`, and `redirect_to`.
- Rename returns `status`, `chapter`, `previous_number`, and `redirect_to`.
- Delete returns `status`, `deleted`, and `redirect_to`.
- Package endpoint continues returning a ZIP response without contract change.

### File workflows
- Upload returns `uploaded`, `skipped`, and `redirect_to`.
- Overwrite returns `operation: replaced`, `archive_path`, and `archived_version_num`.
- Checkout and cancel-checkout still return the current lock contract.
- Delete still returns the current `deleted` shape and redirect hint.

### Processing
- Processing start still returns `status: processing` and no durable job id.
- Processing status still supports only the current structuring compatibility flow.
- `legacy_status_endpoint` remains present.

### Technical review
- Technical scan still returns both normalized `issues` and `raw_scan`.
- Technical apply still returns `new_file_id` and `new_file`.

### Structuring review
- Review metadata still returns `processed_file`, `editor`, `actions`, and `styles`.
- Save still expects `{ "changes": { ... } }`.
- Export still remains a download endpoint, not JSON.
- `return_href` and `return_mode` remain backend-provided and authoritative.

### Admin
- Admin dashboard and users list keep their current response shapes.
- Admin mutation responses still return `redirect_to` hints.
- Current backend quirks remain preserved:
  - edit-user auth gap
  - delete-user auth gap
  - password update without minimum-length validation

## Stabilization Tasks Before Any WOPI / Editor Frontend Work

These are the hardening tasks that should be completed before any attempt to move the editor boundary further into the frontend:

1. Exercise the current structuring review page against a real Collabora deployment and verify the backend-provided `collabora_url` opens correctly from `/ui`.
2. Validate that `return_href`, `return_mode`, save, and export work correctly after editor usage from the frontend route.
3. Add browser-level QA around cross-origin behavior for the provided editor URL, including cookies, redirects, and popup/window handling.
4. Confirm that the backend-owned WOPI callbacks remain stable while the frontend is only launching or linking to editor URLs.
5. Decide whether frontend responsibility stops at review-shell launch/navigation or extends to embedded iframe hosting.
6. Preserve backend ownership of WOPI tokenization, path resolution, and byte read/write callbacks regardless of the final UI choice.

## Recommendation For The Final Migration Step

### Recommended option
`WOPI/editor handoff only`

### Why this is the lowest-risk next step
- The repository already exposes a backend-generated `collabora_url` through `/api/v2/files/{file_id}/structuring-review`.
- WOPI callbacks and file targeting are still backend-owned and stable.
- The frontend already has a working metadata/save/export shell.
- Full iframe embedding would add browser, cross-origin, and lifecycle complexity without changing the backend system of record.

### Not recommended yet
- `full WOPI embedding`

Reason:
- The current frontend does not own editor state.
- The current backend still owns WOPI routing, byte persistence, and editor launch semantics.
- Full embedding should only be considered after the hardening checklist above is complete.

### Alternative if stability is the only priority
- `stop here and keep editor SSR/backend-owned`

This remains a valid endpoint if the project wants a stable React operational shell while keeping all editor behavior behind backend-owned routes and launch URLs.
