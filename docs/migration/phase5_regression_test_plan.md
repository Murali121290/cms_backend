# Phase 5 Regression Test Plan

Static analysis only. This document defines the minimum regression safety net required before business-logic extraction from route handlers and before frontend migration begins.

Reference documents:
- [phase0_repository_inventory.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration_plan/phase0_repository_inventory.md)
- [phase1_contract_map.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase1_contract_map.md)
- [phase2_service_extraction_plan.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase2_service_extraction_plan.md)
- [phase3_api_normalization_plan.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase3_api_normalization_plan.md)
- [phase4_frontend_migration_contracts.md](C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/migration/phase4_frontend_migration_contracts.md)

Current coverage baseline relevant to CMS refactor risk:

| Area | Current coverage status | Regression value for CMS refactor |
|---|---|---|
| `tests/test_technical_editor.py` | one manual-style test using a hardcoded local Windows path outside the repo | low; not CI-safe; does not exercise FastAPI routes or stable fixtures |
| `ai_structuring_backend/tests/*` | extensive unit/integration coverage of the separate AI processing service | high for AI backend internals, but not a substitute for CMS route, template, file, auth, or WOPI coverage |
| FastAPI CMS route suite | effectively absent | highest gap; this plan prioritizes filling it |

Regression test planning principles for this repo:
- Prefer FastAPI integration tests with temp database state and temp upload roots for CMS route behavior.
- Use contract tests for schema-sensitive JSON and WOPI endpoints.
- Use end-to-end style route-chain tests only where a single route does not reveal the real side effects, such as project bootstrap, upload/versioning, and WOPI save flows.
- Stub or monkeypatch external tools for most CMS processing tests; preserve a smaller number of contract-level tests around route shape and side effects.
- Preserve current behavior exactly, including existing redirects, duplicate-route effective behavior, cookie semantics, and route mismatches between SSR and `/api/v1`.

## 1. Critical Workflow Regression Matrix

| Workflow name | Entry route/template | Expected outcome | DB side effects | Filesystem side effects | Background execution involved | External integrations involved | What must be asserted in tests |
|---|---|---|---|---|---|---|---|
| Login | `GET /login`, `POST /login`, `login.html` | valid credentials redirect to `/dashboard` and set `access_token` cookie; invalid credentials re-render login with error | none | none | none | JWT token creation, password verification | `302` on success; `Location=/dashboard`; `access_token` cookie exists; invalid login returns `200` with `login.html` body containing `Invalid credentials`; no DB mutations |
| Logout | `GET /logout` from nav/layout | user is redirected to `/login` and browser session cookie is removed | none | none | none | none | `302` to `/login`; `access_token` cookie cleared; route is safe when called with or without an existing cookie |
| Register | `GET /register`, `POST /register`, `register.html` | password mismatch re-renders form; duplicate username/email re-renders form; valid registration redirects to login; first registered user becomes Admin | `User` insert; `Role` bootstrap if missing; `UserRole` insert | none | none | password hashing, JWT-related auth helpers indirectly for later login | password mismatch path leaves DB unchanged; duplicate user leaves DB unchanged; first-user registration creates/bootstraps roles and assigns `Admin`; later registration assigns non-admin default role; success redirects to `/login?msg=Registration+successful...` |
| Dashboard load | `GET /dashboard`, `dashboard.html` | anonymous users redirect to `/login`; authenticated users receive dashboard page with project data and stats | none | none | none | none | anon request gets redirect; authenticated request gets `200` HTML; page contains project cards/data from seeded projects; admin shortcuts appear only for admin roles if applicable |
| Project creation | `GET /projects/create`, `POST /projects/create_with_files`, `project_create.html` | project bootstrap succeeds and redirects to dashboard; initial chapters are created; optional initial uploads are ingested | `Project` insert; multiple `Chapter` inserts; optional `File` inserts | create `data/uploads/{CODE}/{chapter}/{category}` directory tree; optional uploaded files written into inferred chapter/category paths | none | filename inference rules for chapter/category; MIME/category mapping | project row fields persisted exactly; chapter count matches requested count; directories exist for created chapters; uploaded files appear in expected chapter/category; redirect remains `/dashboard`; project code uniqueness behavior preserved |
| Chapter creation | `POST /projects/{project_id}/chapters/create` from `project_chapters.html` | chapter is created and user is redirected back to project page | `Chapter` insert | create chapter folder tree under project upload root | none | none | chapter row created with submitted number/title; category directories created; redirect path remains `/projects/{project_id}?msg=Chapter+Created` or current equivalent |
| File upload and versioning | `POST /projects/{project_id}/chapter/{chapter_id}/upload` from `chapter_detail.html` | new file uploads create file rows; overwrite uploads archive the current file and increment versioning metadata | `File` insert for new file; `FileVersion` insert on overwrite; existing `File.version` increment and `uploaded_at` update | save uploaded bytes; create archive copy in `Archive`; overwrite target file bytes in place; maintain category directory path | none | none | new upload writes expected path and DB row; overwrite creates archive file with expected naming pattern; `FileVersion` row points at archive path; current `File` row keeps identity but version increments; lock is cleared on overwrite if current behavior does so; redirect returns to same chapter tab/category |
| Checkout | `POST /projects/files/{file_id}/checkout` from `chapter_detail.html` | unlocked file becomes locked by current user; same user can re-hit route without conflict; other user receives redirect/error state | update `File.is_checked_out`, `checked_out_by_id`, `checked_out_at` | none | none | none | unlocked file becomes locked to current user; second checkout by same user is idempotent; other user does not take ownership; redirect message content remains compatible |
| Cancel checkout | `POST /projects/files/{file_id}/cancel_checkout` from `chapter_detail.html` | current lock owner releases lock; non-owner leaves lock unchanged | clear `File.is_checked_out`, `checked_out_by_id`, `checked_out_at` only when caller owns lock | none | none | none | owner unlocks successfully; non-owner call leaves lock state unchanged; route still redirects without crashing; current forgiving behavior is preserved |
| Processing start | `POST /api/v1/processing/files/{file_id}/process/{process_type}` from `chapter_detail.html` | route validates auth/role/file existence, locks file, creates backup version, schedules background task, and returns `{"status":"processing"}` | file lock fields set; `FileVersion` insert for backup; source `File.version` increment | source file copied into `Archive`; later result files may be created by background worker | FastAPI `BackgroundTasks` | process engine wrappers; optional AI structuring HTTP offload inside `StructuringEngine`; external OS toolchain for XML and legacy processors | `401/403/404` paths; success JSON shape; background task registered once with expected args; backup file exists; `FileVersion` row created; lock fields set; source version incremented before task runs |
| Processing status polling | `GET /api/v1/processing/files/{file_id}/structuring_status` from `chapter_detail.html` JS | returns `{"status":"processing"}` until a `_Processed` file row exists, then returns `{"status":"completed","new_file_id":...}` | none | none directly | none | none | while no processed row exists, response remains exact processing shape; once processed row exists, `new_file_id` points at newest matching file in same project/chapter; `404` for missing source file preserved |
| Technical editor scan | `GET /files/{file_id}/technical/edit` then `GET /api/v1/processing/files/{file_id}/technical/scan` | page shell renders; scan returns legacy dict keyed by issue name | none | reads source `.docx` only | none | legacy `TechnicalEditor` scanner | shell route redirects anonymous users; scan route enforces technical permission; scan returns JSON dict, not array; scan `404`s when DB row or physical file missing |
| Technical editor apply | `POST /api/v1/processing/files/{file_id}/technical/apply` from `technical_editor_form.html` | selected replacements produce a `_TechEdited` derivative file and DB record | new `File` insert for derivative output | create `_TechEdited.docx` next to source file | none | legacy `TechnicalEditor.process()` | derivative file exists on disk; new `File` row points at derivative; response remains `{"status":"completed","new_file_id":...}`; `500` path preserved when output file generation fails |
| Structuring review load | `GET /api/v1/files/{file_id}/structuring/review`, `structuring_review.html` | anonymous users redirect to login; missing processed file renders `error.html`; processed file renders review shell with Collabora URL | none | reads `_Processed.docx` path | none | Collabora launch URL construction, structuring document utilities | anon redirect preserved; error template is used when processed file missing; success response contains iframe URL and correct processed filename; source file and processed-file resolution rules are unchanged |
| Structuring export | `GET /api/v1/files/{file_id}/structuring/review/export` | processed `.docx` is downloaded | none | reads processed file bytes | none | none beyond browser file delivery | `404` when processed file missing; success returns DOCX media type and expected filename; no DB mutation occurs |
| WOPI edit lifecycle | `GET /files/{file_id}/edit`; `GET /wopi/files/{file_id}`; `GET/POST /wopi/files/{file_id}/contents`; structuring variants under `/wopi/files/{file_id}/structuring*` | editor shell renders; CheckFileInfo exposes expected metadata; GetFile returns current bytes; PutFile writes bytes back to correct original or processed target path | none | original or `_Processed` target file bytes are read and overwritten | none | Collabora/WOPI protocol | editor shell redirects anonymous users; WOPI endpoints remain callable without application auth; CheckFileInfo returns expected keys; GetFile returns exact bytes; PutFile persists bytes; empty-body PutFile returns `200` without truncation; structuring mode targets `_Processed.docx` |
| Admin user management | `GET /admin/users`, `POST /admin/users/create`, `POST /admin/users/{id}/role`, `POST /admin/users/{id}/status`, `POST /admin/users/{id}/edit`, `POST /admin/users/{id}/password`, `POST /admin/users/{id}/delete` | admin-only routes remain protected; user mutations preserve current guard behavior and redirects | `User` insert/update/delete; `UserRole` replace; user active flag toggle; password hash update | none | none | password hashing, role enforcement helpers | non-admin access blocked; create assigns requested role; duplicate username/email handled; last-admin protection blocks demotion; self-lockout protection blocks disabling self; effective password route keeps current minimum-length behavior; self-delete blocked; duplicate route behavior is explicitly captured |
| Project delete | `POST /projects/{project_id}/delete` | project is removed from DB and storage, then user returns to dashboard | delete `Project`, related `Chapter`, `File`, and possibly `FileVersion` rows according to current ORM cascade/service behavior | remove project directory tree from uploads root | none | none | DB rows are removed; filesystem tree is removed; redirect remains `/dashboard?msg=Book+Deleted`; contrast with `/api/v1/projects/{project_id}` is preserved rather than silently unified |
| File delete | `POST /projects/files/{file_id}/delete` | file is removed and user returns to chapter/category context | delete `File` row | remove file bytes if present | none | none | file row deleted; physical file removed when present; route redirects back to owning chapter and preserves current tab/category behavior; missing disk file does not crash if current route swallows that condition |

## 2. Route-Level Test Inventory

### `app/routers/web.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `POST /login` | SSR mutation | none | `302` to `/dashboard` on success or `200` `login.html` with error | cookie set on success; no DB changes | integration |
| `GET /logout` | SSR redirect | none / cookie optional | `302` to `/login` | cookie cleared | integration |
| `POST /register` | SSR mutation | none | `302` to login on success or `200` `register.html` with error | `User`, `Role`, `UserRole` creation/assignment rules | integration |
| `GET /dashboard` | SSR page | cookie | `200` HTML or `302` to `/login` | none beyond page-state assembly | integration |
| `POST /projects/create_with_files` | SSR mutation | cookie | `302` to `/dashboard` | project/chapter/file rows; upload tree creation; initial file writes | end-to-end |
| `POST /projects/{project_id}/chapters/create` | SSR mutation | cookie | redirect back to project page | chapter row and folder tree creation | integration |
| `POST /projects/{project_id}/chapter/{chapter_id}/rename` | SSR mutation | cookie | redirect back to project page | chapter metadata update; folder rename if chapter number changes | integration |
| `GET /projects/{project_id}/chapter/{chapter_id}/download` | file delivery | cookie | ZIP file response | temporary zip content corresponds to chapter tree | integration |
| `POST /projects/{project_id}/chapter/{chapter_id}/delete` | SSR mutation | cookie | redirect back to project page | chapter DB delete plus folder removal; duplicate route effective behavior | integration |
| `GET /projects/{project_id}/chapter/{chapter_id}` | SSR page | cookie | `200` HTML or redirect to login | chapter/file state rendering, active tab compatibility | integration |
| `POST /projects/{project_id}/chapter/{chapter_id}/upload` | SSR mutation | cookie | redirect back to chapter tab | new file write or overwrite/archive/version behavior | end-to-end |
| `GET /projects/files/{file_id}/download` | file delivery | cookie | file response | bytes correspond to stored file | integration |
| `POST /projects/files/{file_id}/delete` | SSR mutation | cookie | redirect back to chapter context | file row delete and disk delete | integration |
| `POST /projects/{project_id}/delete` | SSR mutation | cookie | redirect to dashboard with message | DB delete plus project tree delete | end-to-end |
| `POST /projects/files/{file_id}/checkout` | SSR mutation | cookie | redirect back to chapter | lock ownership fields and conflict behavior | integration |
| `POST /projects/files/{file_id}/cancel_checkout` | SSR mutation | cookie | redirect back to chapter | unlock only when caller owns lock | integration |
| `GET /api/notifications` | JSON API | cookie | notification array JSON | none; feed shape remains presentation-compatible | contract test |
| `GET /activities` | SSR page | cookie | `200` HTML or redirect to login | none; read-model shaping only | integration |
| `GET /files/{file_id}/technical/edit` | SSR page | cookie | `200` technical editor shell or redirect | none beyond shell context values | integration |
| `POST /admin/users/create` | SSR mutation | cookie + admin | redirect on success or `200` form with error | user row, hashed password, role assignment | integration |
| `POST /admin/users/{user_id}/role` | SSR mutation | cookie + admin | redirect or `200` error page | role replacement, last-admin protection | integration |
| `POST /admin/users/{user_id}/status` | SSR mutation | cookie + admin | redirect | active flag toggle, self-lockout protection | integration |
| `POST /admin/users/{user_id}/edit` | SSR mutation | cookie + admin | redirect | email update only, despite template role context | integration |
| `POST /admin/users/{user_id}/password` | SSR mutation | cookie + admin | redirect or `200` error template | hashed password update; effective minimum-length behavior from duplicate handlers | integration |
| `POST /admin/users/{user_id}/delete` | SSR mutation | cookie + admin | redirect | user delete; self-delete protection; duplicate handler behavior | integration |

### `app/routers/projects.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `GET /api/v1/projects/` | JSON API | bearer | project list JSON | pagination args still accepted; ORM serialization shape | contract test |
| `POST /api/v1/projects/` | JSON API | bearer + `ProjectManager` role | created project JSON | creates only thin project row, not bootstrap side effects | integration |
| `PUT /api/v1/projects/{project_id}/status` | JSON API | bearer + `ProjectManager` role | updated project JSON | status field mutation only | contract test |
| `DELETE /api/v1/projects/{project_id}` | JSON API compatibility route | cookie in current implementation | `{message: ...}` JSON | DB cleanup only; no filesystem cleanup | integration |

### `app/routers/files.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `POST /api/v1/files/` | JSON API | bearer | `{file_id, path}` JSON | flat upload file write; file record creation without chapter/category/version semantics | integration |

### `app/routers/processing.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `POST /api/v1/processing/files/{file_id}/process/{process_type}` | JSON API | cookie + role via `PROCESS_PERMISSIONS` | `{"message":..., "status":"processing"}` | auth/role gating; file lock; backup version insert; archive copy; background task scheduling | integration |
| `GET /api/v1/processing/files/{file_id}/structuring_status` | JSON API polling | cookie | `{"status":"processing"}` or `{"status":"completed","new_file_id":...}` | no writes; filename convention lookup | contract test |
| `GET /api/v1/processing/files/{file_id}/technical/scan` | JSON API | cookie + technical permission | legacy dict JSON | no writes; scanner called with correct file path; 404/500 behavior | contract test |
| `POST /api/v1/processing/files/{file_id}/technical/apply` | JSON API | cookie + technical permission | `{"status":"completed","new_file_id":...}` | derivative file creation and new `File` row | integration |

### `app/routers/structuring.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `GET /api/v1/files/{file_id}/structuring/review` | SSR shell | cookie | review HTML, error HTML, or redirect | processed-file path resolution; template context correctness | integration |
| `POST /api/v1/files/{file_id}/structuring/save` | JSON API | cookie | `{"status":"success"}` or error | processed docx modified in place | integration |
| `GET /api/v1/files/{file_id}/structuring/review/export` | file delivery | cookie | processed docx file response | correct file target and filename | integration |

### `app/routers/wopi.py`

| Route path | Route type | Auth requirement | Expected response | Side effects to validate | Recommended test type |
|---|---|---|---|---|---|
| `GET /files/{file_id}/edit` | SSR shell | cookie | editor HTML or redirect | Collabora URL generation and shell context | integration |
| `GET /wopi/files/{file_id}` | WOPI integration JSON | none in current code | WOPI CheckFileInfo JSON | metadata keys, version hash derivation, original-path targeting | contract test |
| `GET /wopi/files/{file_id}/contents` | WOPI file delivery | none in current code | file bytes response | exact original file bytes returned | contract test |
| `POST /wopi/files/{file_id}/contents` | WOPI write callback | none in current code | HTTP `200` | body written to original file path; empty body leaves file unchanged | end-to-end |
| `GET /wopi/files/{file_id}/structuring` | WOPI integration JSON | none in current code | WOPI CheckFileInfo JSON for processed target | `_Processed.docx` targeting and metadata shape | contract test |
| `GET /wopi/files/{file_id}/structuring/contents` | WOPI file delivery | none in current code | processed file bytes | exact processed file bytes returned | contract test |
| `POST /wopi/files/{file_id}/structuring/contents` | WOPI write callback | none in current code | HTTP `200` | body written to processed file path; empty body leaves file unchanged | end-to-end |

## 3. Service Extraction Test Requirements

| Service/module | Tests required before extraction | Tests required after extraction | Regression risks covered |
|---|---|---|---|
| `session_service` | anonymous vs authenticated access tests for `/dashboard`, `/projects`, `/activities`, `/admin`, `/files/{file_id}/technical/edit`, `/api/v1/files/{file_id}/structuring/review`, `/files/{file_id}/edit`; logout cookie-clear test | unit tests for cookie parsing and viewer DTO assembly; integration tests proving routes still redirect/render identically after service injection | broken auth gates on SSR routes; incorrect redirect ownership; missing `user`/viewer context in templates |
| `auth_service` | valid/invalid login tests; register password mismatch; duplicate registration; first-user Admin bootstrap; admin password change effective behavior | unit tests for password hashing, password verification, token creation; integration tests for login/register/admin-password routes delegating to service | cookie semantics drift; first-user bootstrap regression; duplicate route behavior changes; password validation mismatch |
| `project_service` | `/dashboard` and `/projects` read tests; `/api/v1/projects/` GET/POST tests; `/projects/create_with_files` bootstrap test; `/projects/{project_id}/delete` and `/api/v1/projects/{project_id}` divergence tests | unit tests for project listing, status change, thin create, bootstrap orchestration boundaries; integration tests keeping route outputs identical | project bootstrap losing side effects; API vs SSR delete mismatch disappearing accidentally; dashboard/project list drift |
| `chapter_service` | chapter create/rename/delete route tests; project chapter page render test; chapter package download test | unit tests for chapter create/rename/delete and folder-path derivation; integration tests proving redirect and download behavior unchanged | chapter folder tree mismatch; rename losing storage move; duplicate delete route behavior drift |
| `file_service` | file download/delete tests; thin `/api/v1/files/` upload test; chapter detail render test with seeded files | unit tests for file lookup, category/path resolution, download metadata, delete semantics; integration tests for route wrappers | file path resolution regressions; wrong category or filename mapping; broken download/delete redirects |
| `version_service` | upload overwrite/versioning test; processing start backup test; version history seed assertions via DB | unit tests for archive naming, `FileVersion` insert payload, version increment behavior; integration tests preserving overwrite side effects | archive file naming changes; lost version history; current-row identity replacement bugs |
| `checkout_service` | checkout success/idempotence/conflict tests; cancel-checkout owner/non-owner tests; upload overwrite unlocking test; processing-start lock behavior test | unit tests for acquire/release decision logic; integration tests for redirect/HTTP behavior on routes | lock ownership bugs; stale locks; non-owner unlocks; refactor breaking upload and processing assumptions |
| `notification_service` | `/api/notifications` feed test against seeded recent files; layout compatibility expectation | unit tests for relative-time formatting and notification shaping; contract tests for feed shape stability | notification items losing required fields used by legacy nav; ordering regressions |
| `activity_service` | `/activities` page render test with seeded `File` and `FileVersion` rows | unit tests for upload/version event shaping, sorting, and today-count calculation; integration tests for page render parity | activity ordering drift; wrong event labeling or counts; missing related project/chapter metadata |
| `processing_service` | process-start tests for auth/role/404 cases and success side effects; structuring-status tests for processing vs completed; at least one per critical process family (`structuring`, `technical`, `permissions`, `word_to_xml`) with engines stubbed | unit tests for permission matrix, backup orchestration, result-file registration, unlock-on-success/unlock-on-error behavior; integration tests for current response schema and side effects | background task scheduling drift; loss of backup creation; wrong permission enforcement; output registration regressions |
| `technical_editor_service` | scan and apply route tests; technical editor shell render test; current manual `test_technical_editor.py` should not be treated as sufficient | unit tests for scan payload normalization and apply result mapping; integration tests for legacy dict scan shape and `_TechEdited` derivative creation | change from dict to array too early; lost derivative file registration; output path naming changes |
| `structuring_review_service` | review shell success/missing-processed tests; export test; save test against processed doc fixture | unit tests for processed-path resolution, export target selection, save payload handling; integration tests preserving HTML shell context and JSON/file responses | fallback-to-error behavior changes; wrong processed file target; export/download mismatch |
| `wopi_service` | editor launch shell test; CheckFileInfo/GetFile/PutFile tests for original and structuring modes | unit tests for `_get_target_path`, hash/version token generation, empty-body save behavior; contract tests for WOPI JSON shape; end-to-end tests for byte roundtrip | editor breakage; wrong original vs processed targeting; accidental auth changes on WOPI callbacks; byte truncation |
| `admin_user_service` | admin access-control tests; create user; role update; last-admin protection; status self-lockout protection; edit email; password change; self-delete protection; duplicate route effective behavior | unit tests for admin guards and mutation rules; integration tests proving current redirects/messages and template fallbacks remain unchanged | silent behavior change in duplicated handlers; loss of last-admin protection; self-delete or self-lockout bugs |

## 4. Contract Test Requirements

| Contract area | Endpoints / workflows under contract | Contract tests required | What must remain backward-compatible |
|---|---|---|---|
| Auth/session | `POST /login`, `GET /logout`, `POST /register`, `POST /api/v1/users/login`, `GET /api/v1/users/me` | success/failure login contract; cookie presence/absence; bearer token JSON shape; `/me` response keys; logout cookie deletion; registration duplicate/password-mismatch behavior | `access_token` cookie name and redirect behavior for SSR; `{access_token, token_type}` JSON for bearer login; `{username,email,roles}` shape for `/me` |
| Uploads/versioning | `POST /projects/{project_id}/chapter/{chapter_id}/upload`, `POST /api/v1/files/` | new-upload contract; overwrite/upload contract; archive naming/path contract; version increment contract; category/path contract; thin API upload contract kept distinct | SSR upload must keep overwrite/archive/version semantics and redirect behavior; thin API upload must stay thin and not silently gain bootstrap side effects |
| Delete behavior | `POST /projects/{project_id}/delete`, `DELETE /api/v1/projects/{project_id}`, `POST /projects/{project_id}/chapter/{chapter_id}/delete`, `POST /projects/files/{file_id}/delete`, `POST /admin/users/{user_id}/delete` | explicit tests for SSR vs API project delete divergence; chapter/file delete redirect contracts; admin self-delete guard; missing-resource behavior | project SSR delete must continue removing filesystem; `/api/v1` delete must remain DB-only until intentionally normalized; admin duplicate delete behavior must remain captured |
| Processing start/status | `POST /api/v1/processing/files/{file_id}/process/{process_type}`, `GET /api/v1/processing/files/{file_id}/structuring_status` | start response shape; permission matrix; backup/version side effects; background task dispatch; status `processing` and `completed/new_file_id` shapes; missing-file and locked-by-other error shapes | current `"status":"processing"` start contract; no job ID required yet; status endpoint must not invent new states before API normalization |
| Polling schemas | chapter-detail JS polling for structuring status; any future bridge around AI structuring offload inside `StructuringEngine` | polling tests ensuring unchanged interval consumer shape; no additional required keys; completed payload carries `new_file_id`; processing payload carries only `status` today | current template JS must continue to work without adaptation during backend extraction |
| Admin routes | admin create/role/status/edit/password/delete SSR routes | create-user success/error contract; last-admin protection; self-lockout protection; password effective validation; duplicate password/delete route behavior capture | current redirects, inline error rendering, and route paths must remain active until admin APIs replace them |
| Structuring review | `GET /api/v1/files/{file_id}/structuring/review`, `POST /api/v1/files/{file_id}/structuring/save`, `GET /api/v1/files/{file_id}/structuring/review/export` | review shell context contract; missing-processed fallback contract; save success JSON contract; export filename/media-type contract | current review shell must remain SSR; export remains file delivery; save remains `{status:"success"}` unless compatibility wrapper is added |
| WOPI support endpoints | `GET /files/{file_id}/edit`, `GET /wopi/files/{file_id}`, `GET/POST /wopi/files/{file_id}/contents`, structuring WOPI variants | CheckFileInfo key contract; original vs structuring target-path contract; GetFile byte equality; PutFile write contract; empty-body no-op contract; unauthenticated callback contract | WOPI endpoints must remain backend-owned and protocol-compatible; application auth must not be added accidentally to callback routes |

### Contract assertions that need explicit fixture strategy

| Contract group | Fixture strategy required |
|---|---|
| Auth/session | seeded users and roles; cookie client and bearer client variants |
| Uploads/versioning | temp upload root, temp docx fixtures, seeded project/chapter/file rows |
| Delete behavior | isolated per-test filesystem tree plus DB fixtures to assert divergence safely |
| Processing start/status | stub processing engines and `BackgroundTasks.add_task`; temp source files and archive directory |
| Structuring review | temp processed and unprocessed `.docx` fixtures with corresponding `File` rows |
| WOPI | byte fixtures for original and `_Processed` docx files; direct file-content comparison before and after `PutFile` |

## 5. Test Prioritization

### Must-have before refactor

| Priority | Test area | Why it is mandatory before route/service extraction |
|---|---|---|
| Must-have | login/logout/register | auth breakage blocks all SSR and frontend migration work |
| Must-have | project bootstrap create-with-files | most side-effect-heavy CMS flow; impossible to refactor safely without coverage |
| Must-have | chapter create/rename/delete | chapter storage paths and routing depend on exact current behavior |
| Must-have | upload/versioning overwrite path | highest data-loss risk in the CMS |
| Must-have | checkout/cancel-checkout | lock semantics gate uploads, processing, and editing |
| Must-have | process start and structuring-status | route logic extraction from `processing.py` will otherwise be unsafe |
| Must-have | technical editor apply | currently the only existing CMS test area, but not through supported routes |
| Must-have | structuring review load and export | backend-owned editor/review shell must survive refactor unchanged |
| Must-have | WOPI original and structuring PutFile roundtrip | highest integration-risk boundary in the repo |
| Must-have | admin create/role/password/delete/status guards | duplicate routes and last-admin/self-protection rules are easy to regress |
| Must-have | project delete SSR vs `/api/v1` delete divergence | normalization work depends on explicitly preserving or changing this difference intentionally |
| Must-have | file delete | chapter detail UI depends on exact redirect and disk-delete behavior |

### Should-have before frontend migration

| Priority | Test area | Why it should exist before frontend cutover |
|---|---|---|
| Should-have | dashboard page render | new frontend shell will need parity against current landing state |
| Should-have | projects list page and `/api/v1/projects/` list contract | early frontend modules will depend on project summary behavior |
| Should-have | chapter detail page render | frontend migration target with the highest page-state complexity |
| Should-have | technical editor scan contract | frontend module will depend on legacy dict response until normalized |
| Should-have | notifications feed contract | layout-level JS or frontend shell will consume this early |
| Should-have | activities page read model | low-risk migration candidate; useful parity anchor for feed DTOs |
| Should-have | admin user list page render | likely early hybrid migration surface inside admin |
| Should-have | thin `/api/v1/files/` upload compatibility | protects external/API clients while SSR upload remains canonical |
| Should-have | `/api/v1/projects/{project_id}/status` contract | avoids accidental request-shape changes during API normalization |
| Should-have | WOPI CheckFileInfo JSON schema | future frontend changes must not disturb editor integration metadata |

### Can defer until later

| Priority | Test area | Why it can wait |
|---|---|---|
| Can defer | `GET /projects/{project_id}/chapter/{chapter_id}/download` ZIP content deep validation | useful, but less urgent than upload/delete/version safety |
| Can defer | advanced AI offload fallback inside `StructuringEngine` when `AI_STRUCTURING_BASE_URL` is set | important later, but CMS refactor risk is mostly on route shape and local fallback orchestration |
| Can defer | performance/regression timings for large uploads or processing | correctness is the immediate refactor blocker |
| Can defer | snapshot-style HTML assertions for visual layout | business parity matters more than markup snapshots in early phases |
| Can defer | teams API tests | current frontend does not actively depend on teams and the API already has model drift |
| Can defer | exhaustive notification relative-time formatting permutations | feed existence and field presence matter more initially |
| Can defer | every individual processing engine path | minimum safety net can stub most engines and focus on orchestration contract first |
| Can defer | browser-automation coverage of Collabora iframe UI | backend WOPI roundtrip tests are the critical integration safety net first |

## 6. Deliverable Closure

### Top 20 tests to implement first

1. `test_login_valid_sets_access_token_cookie_and_redirects_dashboard`
2. `test_login_invalid_renders_login_with_error_and_no_cookie`
3. `test_logout_clears_cookie_and_redirects_login`
4. `test_register_first_user_bootstraps_roles_and_assigns_admin`
5. `test_register_duplicate_user_renders_error_without_new_rows`
6. `test_project_create_with_files_creates_project_chapters_directories_and_initial_file_rows`
7. `test_chapter_create_creates_row_and_category_directories`
8. `test_upload_new_file_creates_file_row_and_writes_expected_path`
9. `test_upload_existing_file_creates_archive_fileversion_and_increments_version`
10. `test_checkout_locks_file_for_current_user`
11. `test_checkout_rejects_lock_when_file_owned_by_other_user`
12. `test_cancel_checkout_only_unlocks_owner_lock`
13. `test_processing_start_creates_backup_version_locks_file_and_schedules_background_task`
14. `test_structuring_status_returns_processing_until_processed_file_row_exists`
15. `test_technical_scan_requires_permission_and_returns_legacy_dict_shape`
16. `test_technical_apply_creates_techedited_derivative_and_db_row`
17. `test_structuring_review_renders_error_template_when_processed_file_missing`
18. `test_structuring_export_downloads_processed_docx_with_expected_filename`
19. `test_wopi_original_putfile_persists_bytes_and_empty_body_is_noop`
20. `test_admin_role_change_blocks_demoting_last_admin`

### Top 10 workflows with insufficient current coverage

1. Project creation bootstrap with initial files
2. Upload overwrite/versioning
3. Checkout and cancel-checkout ownership rules
4. Processing start and backup/version side effects
5. Structuring status polling
6. Structuring review shell and export
7. WOPI original edit lifecycle
8. WOPI structuring edit lifecycle
9. Admin user management including duplicate password/delete routes
10. Project delete SSR vs `/api/v1` delete divergence

### Top 10 contract tests needed before API normalization

1. Browser login cookie contract for `POST /login`
2. Bearer login JSON contract for `POST /api/v1/users/login`
3. Current-user payload contract for `GET /api/v1/users/me`
4. Upload overwrite/archive/version contract for `POST /projects/{project_id}/chapter/{chapter_id}/upload`
5. Thin upload compatibility contract for `POST /api/v1/files/`
6. Project delete divergence contract between `POST /projects/{project_id}/delete` and `DELETE /api/v1/projects/{project_id}`
7. Processing start response and side-effect contract for `POST /api/v1/processing/files/{file_id}/process/{process_type}`
8. Structuring status polling schema contract for `GET /api/v1/processing/files/{file_id}/structuring_status`
9. Structuring review shell and export contract for `/api/v1/files/{file_id}/structuring/review*`
10. WOPI CheckFileInfo/GetFile/PutFile contract for original and structuring modes

### Recommended regression test implementation order

1. Build reusable CMS fixtures: seeded roles/users, temp upload root, temp docx files, authenticated cookie client, bearer client.
2. Implement auth/session integration tests for login, logout, registration, and admin bootstrap.
3. Add project bootstrap and chapter lifecycle integration tests.
4. Add upload/versioning and file delete tests against temp filesystem fixtures.
5. Add checkout and cancel-checkout ownership tests.
6. Add processing start and structuring-status tests with processing engines stubbed.
7. Add technical editor scan/apply tests through the FastAPI routes.
8. Add structuring review load/save/export tests with processed and missing-processed fixtures.
9. Add WOPI original and structuring contract tests, then byte-roundtrip end-to-end tests.
10. Add admin user-management mutation tests, explicitly capturing duplicate route effective behavior.
11. Add compatibility tests for `/api/v1/projects/*`, `/api/v1/files/`, and `/api/notifications`.
12. Add lower-priority dashboard, activities, and chapter/package-download parity tests.
