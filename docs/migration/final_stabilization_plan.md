# Final Stabilization Plan

This document defines the final hardening pass for the current migrated frontend and `/api/v2` backend contract surface before any WOPI/editor migration work begins.

Source of truth for this plan:
- current frontend routes in [frontend/src/app/router.tsx](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/app/router.tsx)
- current `/api/v2` contracts in [app/routers/api_v2.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/api_v2.py)
- current service behavior under [app/services](/C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services)
- current frontend contract consumers under [frontend/src/api](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend/src/api)
- current regression and contract tests under [tests](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests)

This is a stabilization plan only. It does not propose new APIs, does not redesign the editor boundary, and does not plan full WOPI embedding.

## 1. Manual QA Matrix For Migrated `/ui` Routes

### `/ui`
| Area | Validation |
|---|---|
| Session bootstrap | Confirm the app requests `GET /api/v2/session` on first load. |
| Auth handoff | When unauthenticated, confirm redirect or handoff to `/login` matches current frontend behavior. |
| Shell load | Confirm the authenticated layout renders without console errors. |
| Navigation | Confirm navigation links resolve to `/ui/dashboard`, `/ui/projects`, and admin links only when the current session exposes the `Admin` role. |

### `/ui/dashboard`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/dashboard` succeeds and renders dashboard counters/cards. |
| Notifications shell | Confirm notifications load in the shared shell without blocking dashboard render. |
| Loading state | Confirm a visible loading state appears while dashboard data is in flight. |
| Error state | Force a failing dashboard request and confirm the page shows a functional error state instead of crashing. |
| Empty-tolerant render | Confirm the page still renders if dashboard lists are empty or zero-valued. |

### `/ui/projects`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/projects` renders the current project list. |
| Empty state | Confirm the page shows a usable empty state when no projects exist. |
| Error state | Force a failing projects request and confirm a non-crashing error state. |
| Navigation | Confirm project rows navigate to `/ui/projects/:projectId`. |

### `/ui/projects/:projectId`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/projects/{project_id}` and `GET /api/v2/projects/{project_id}/chapters` both succeed and render project metadata and chapters. |
| Breadcrumb context | Confirm project identity remains visible when navigating deeper. |
| Chapter create | Confirm create uses the existing `/api/v2` contract, shows success/error state, and refreshes the chapter list. |
| Chapter rename | Confirm inline rename preserves current backend behavior and refreshes data after success. |
| Chapter delete | Confirm delete uses current contract, updates list state, and surfaces backend errors. |
| Package link | Confirm the chapter package download uses the existing backend endpoint and returns a valid file. |

### `/ui/projects/:projectId/chapters/:chapterId`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/projects/{project_id}/chapters/{chapter_id}` and `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files` render chapter metadata and the file list. |
| Active tab/read state | Confirm the page derives its view only from API data and does not depend on SSR tab query state. |
| Empty file state | Confirm a usable empty state when the chapter has no files. |
| Download action | Confirm file download uses `GET /api/v2/files/{file_id}/download` and returns the expected file. |
| Checkout action | Confirm checkout success updates the chapter view after refetch. |
| Cancel checkout | Confirm cancel checkout success or current backend no-op behavior is surfaced without UI breakage. |
| File delete | Confirm delete removes the file from the refetched list. |
| Upload action | Confirm uploads use the category-aware `/api/v2` upload contract and refresh the file list. |
| Upload results | Confirm uploaded, replaced, archived, and skipped results render clearly. |
| Processing actions | Confirm processing triggers can be started from the page and that current status messaging remains coherent. |
| Technical entry | Confirm technical-review navigation works only for supported files. |
| Structuring entry | Confirm structuring-review navigation works only when relevant metadata is available. |

### `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/technical-review`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/files/{file_id}/technical-review` renders the normalized issues list and raw scan context where exposed. |
| Empty review state | Confirm a usable state when the scan yields no issues. |
| Error state | Confirm unsupported files or backend failures render a visible error state. |
| Apply action | Confirm `POST /api/v2/files/{file_id}/technical-review/apply` succeeds, surfaces success, and causes the new `_TechEdited` derivative to appear through refetched reads. |
| Back navigation | Confirm returning to chapter context remains intact after apply or cancel. |

### `/ui/projects/:projectId/chapters/:chapterId/files/:fileId/structuring-review`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/files/{file_id}/structuring-review` renders processed-file metadata and provided editor launch data. |
| Save action | Confirm `POST /api/v2/files/{file_id}/structuring-review/save` persists current changes and returns the current backend success payload. |
| Export action | Confirm the provided export link returns the processed DOCX. |
| Return target | Confirm the frontend follows the backend-provided `return_mode` and `return_href` exactly. |
| Editor launch handoff | Confirm the “Open provided editor URL” handoff uses the backend-provided `collabora_url` and does not attempt to embed WOPI/editor behavior in the frontend. |
| Missing processed file | Confirm current backend error responses surface cleanly when the processed file is absent. |

### `/ui/admin`
| Area | Validation |
|---|---|
| Access gating | Confirm the route is only reachable from the frontend navigation when session role data includes `Admin`. |
| Data load | Confirm `GET /api/v2/admin/dashboard` renders current admin stats. |
| Error state | Confirm backend failures surface without crashing the app. |

### `/ui/admin/users`
| Area | Validation |
|---|---|
| Data load | Confirm `GET /api/v2/admin/users` and role metadata load successfully. |
| Create user | Confirm current backend create-user behavior, including duplicate-user failures, is surfaced accurately. |
| Update role | Confirm current backend role update behavior and last-admin protection errors are surfaced. |
| Toggle status | Confirm current backend status toggle behavior, including self-lockout protection, is surfaced accurately. |
| Edit user | Confirm current backend edit behavior is preserved exactly. |
| Update password | Confirm current backend password-update behavior is surfaced exactly, including current validation quirks. |
| Delete user | Confirm current backend delete behavior, including self-delete or last-admin protections where applicable, is surfaced accurately. |
| Mutation refresh | Confirm all successful mutations refresh the visible user list and stats as expected. |

## 2. Lock Lifecycle Validation Checklist

Validate the current lock lifecycle against both backend behavior and frontend-visible outcomes.

### Baseline lock states
- Confirm a newly uploaded file appears as unlocked in chapter detail.
- Confirm a file checked out by the current user shows the current-user lock state and exposes cancel checkout.
- Confirm a file locked by another user does not expose the same checkout affordances and surfaces the backend conflict correctly.

### Checkout flow
- Confirm `POST /api/v2/files/{file_id}/checkout` succeeds for an unlocked file.
- Confirm same-user repeated checkout does not break frontend state and remains compatible with current backend behavior.
- Confirm foreign-lock checkout returns the current conflict contract and the UI preserves the locked state after refetch.

### Cancel checkout flow
- Confirm `DELETE /api/v2/files/{file_id}/checkout` unlocks when invoked by the lock owner.
- Confirm non-owner cancel checkout preserves the current backend no-op/forgiving behavior and the UI does not falsely show an unlock.

### Upload overwrite lock behavior
- Confirm same-user overwrite upload resets the file lock exactly as the current backend does.
- Confirm overwrite by another user against a foreign-locked file is skipped, not partially mutated, and the skipped result is shown in the UI.

### Processing lock behavior
- Confirm processing start still locks files as part of current orchestration.
- Confirm processing success unlocks the file and registers the derivative output as currently implemented.
- Confirm processing failure unlocks the file and preserves current error behavior.

### Technical apply lock-adjacent behavior
- Confirm technical apply creates a derivative file without corrupting the visible lock state for the original file.

## 3. API Error-Handling Validation Checklist For Major Flows

### Session bootstrap
- `GET /api/v2/session`
- Validate unauthenticated behavior used by the frontend handoff to `/login`.
- Validate malformed or expired cookie handling does not crash the shell.

### Dashboard and projects read-side
- `GET /api/v2/dashboard`
- `GET /api/v2/projects`
- `GET /api/v2/projects/{project_id}`
- `GET /api/v2/projects/{project_id}/chapters`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `GET /api/v2/projects/{project_id}/chapters/{chapter_id}/files`
- Validate loading, empty, not-found, and generic server-error UI states.

### Chapter mutation flows
- `POST /api/v2/projects/{project_id}/chapters`
- `PATCH /api/v2/projects/{project_id}/chapters/{chapter_id}`
- `DELETE /api/v2/projects/{project_id}/chapters/{chapter_id}`
- Validate inline form errors, conflict/not-found cases, and post-error state recovery.

### File actions
- `POST /api/v2/files/{file_id}/checkout`
- `DELETE /api/v2/files/{file_id}/checkout`
- `DELETE /api/v2/files/{file_id}`
- Validate lock conflict, not-found, and permission errors display clearly and leave refetched state consistent.

### Upload/versioning
- `POST /api/v2/projects/{project_id}/chapters/{chapter_id}/files/upload`
- Validate mixed success payload handling:
  - created uploads
  - overwrites with archive metadata
  - skipped locked files
  - request-level validation failures

### Processing/status
- `POST /api/v2/files/{file_id}/processing-jobs`
- `GET /api/v2/files/{file_id}/processing-status`
- Validate unsupported process types, permission failures, in-flight polling, and terminal error states.

### Technical review
- `GET /api/v2/files/{file_id}/technical-review`
- `POST /api/v2/files/{file_id}/technical-review/apply`
- Validate unsupported-file and backend failure states, plus apply failures after an otherwise successful scan.

### Structuring review
- `GET /api/v2/files/{file_id}/structuring-review`
- `POST /api/v2/files/{file_id}/structuring-review/save`
- `GET /api/v2/files/{file_id}/structuring-review/export`
- Validate missing processed-file handling, save failures, and export failures without breaking the frontend route.

### Admin flows
- `GET /api/v2/admin/dashboard`
- `GET /api/v2/admin/users`
- `POST /api/v2/admin/users`
- `PUT /api/v2/admin/users/{user_id}/role`
- `PUT /api/v2/admin/users/{user_id}/status`
- `PATCH /api/v2/admin/users/{user_id}`
- `PUT /api/v2/admin/users/{user_id}/password`
- `DELETE /api/v2/admin/users/{user_id}`
- Validate current backend quirks remain visible and the frontend does not mask backend error payloads with generic failures.

## 4. Version-History Validation Checklist

The frontend does not yet expose a dedicated version-history UI. This checklist still applies because versioning is already part of the stabilized contract surface and is a prerequisite for safe editor handoff.

### Backend contract validation
- Confirm `GET /api/v2/files/{file_id}/versions` returns the current stable list shape for files with overwrite history.
- Confirm a file without prior versions returns the current empty-list behavior.
- Confirm version ordering matches current backend behavior.

### Download validation
- Confirm `GET /api/v2/files/{file_id}/versions/{version_id}/download` returns the expected archived file bytes.
- Confirm content type and download filename remain compatible with current browser download behavior.
- Confirm not-found version IDs return the current backend error contract.

### Archive integrity validation
- After overwrite upload, confirm:
  - archive file exists on disk
  - `File.version` increments
  - `FileVersion` row is present
  - version-history list includes the new archive entry
  - archive download returns the exact archived content

### Lock/version interaction
- Confirm same-user overwrite clears the active checkout state exactly as current backend behavior dictates.
- Confirm foreign-lock overwrite skip does not create archive files or version rows.

## 5. Regression Checks To Rerun Before Release

### Backend regression suite
Run the current backend regression and contract suites before any release candidate:

1. [test_auth_regression.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_auth_regression.py)
2. [test_admin_and_api_compat.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_admin_and_api_compat.py)
3. [test_project_and_file_workflows.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_project_and_file_workflows.py)
4. [test_processing_and_technical.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_processing_and_technical.py)
5. [test_structuring_and_wopi.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_structuring_and_wopi.py)
6. [test_api_v2_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_contracts.py)
7. [test_api_v2_admin_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_admin_contracts.py)
8. [test_api_v2_project_file_mutations.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_project_file_mutations.py)
9. [test_api_v2_upload_versioning_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_upload_versioning_contracts.py)
10. [test_api_v2_processing_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_processing_contracts.py)
11. [test_api_v2_structuring_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_structuring_contracts.py)

### Frontend build gates
Run:

1. `npm.cmd run typecheck` in [frontend](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend)
2. `npm.cmd run build` in [frontend](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend)

### Manual regression spot checks
Before release, manually re-run:

1. authenticated session bootstrap
2. project list to project detail navigation
3. chapter detail file actions
4. upload overwrite with archive result
5. lock conflict on checkout
6. structuring processing start and status refresh
7. technical review apply
8. structuring review save and export
9. admin user create/update/delete
10. fallback to legacy `/login`

## 6. Go/No-Go Criteria For Stopping At WOPI Handoff Only

Recommendation remains: stop at WOPI/editor handoff only.

Proceed with that boundary only if all of the following are true:

### Go criteria
- All migrated `/ui` routes pass the manual QA matrix above.
- Backend regression and `/api/v2` contract tests pass cleanly.
- Frontend typecheck and production build pass cleanly.
- Lock conflict and upload overwrite behaviors are manually validated in the frontend.
- Structuring review save/export are validated end to end without embedding the editor.
- The frontend uses backend-provided `collabora_url`, `return_href`, and related structuring metadata without attempting to own WOPI lifecycle semantics.
- No unresolved backend contract ambiguity remains for currently consumed `/api/v2` endpoints.

### No-go criteria
- Lock conflict behavior is not clearly surfaced to users in the current frontend.
- Upload skip/overwrite results are ambiguous or misleading.
- Structuring review save/export cannot be validated without directly embedding the editor.
- Current `/api/v2` error states are not consistently handled across migrated routes.
- Manual QA still depends on falling back into SSR editor pages for basic data confirmation outside the explicit handoff boundary.
- There is pressure to introduce frontend-owned editor state, polling, or save semantics beyond the current backend-provided metadata.

If any no-go condition remains, stop the migration at backend-owned editor handoff and do not start iframe embedding or frontend-owned WOPI behavior.

## 7. Missing Automated Tests Needed Before Release

These are the highest-value missing automated tests based on the current repository state.

### A. Lock conflict flow coverage gaps

Current backend API tests already cover core contract behavior, especially in [test_api_v2_project_file_mutations.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_project_file_mutations.py). What is missing is frontend-visible coverage.

Add automated tests for:

1. frontend chapter detail renders a clear conflict message when checkout returns the current `409` lock conflict contract
2. frontend chapter detail preserves row state after a failed checkout conflict and a refetch
3. frontend cancel-checkout UI reflects current backend owner-only vs non-owner no-op behavior
4. frontend upload result rendering distinguishes `skipped` foreign-lock outcomes from true failures

These are test gaps, not backend feature gaps.

### B. Version-history download flow coverage gaps

Current backend contract tests cover version listing and archive download in [test_api_v2_upload_versioning_contracts.py](/C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_api_v2_upload_versioning_contracts.py). Missing coverage:

1. direct backend negative-path test for invalid `version_id` download if not already asserted explicitly enough for current status/body expectations
2. browser-level or frontend integration coverage for any future version-history UI before it is exposed
3. additional regression asserting archive bytes remain correct after multiple successive overwrites

Because the frontend does not currently expose version-history browsing, no immediate UI test exists here. That is acceptable only if version-history remains backend-only for now.

### C. Frontend-visible API error state coverage gaps

The current frontend has typecheck/build coverage but no automated UI/component suite for visible error states.

Add automated tests for:

1. session bootstrap unauthenticated handoff to `/login`
2. dashboard API failure state
3. projects list API failure state
4. project detail API failure state
5. chapter detail API failure state
6. upload mutation request failure state
7. checkout conflict error rendering
8. technical review fetch failure state
9. technical apply failure state
10. structuring review missing processed-file error state
11. admin create/update/delete mutation error rendering

Preferred level:
- component/integration tests around route pages and feature components
- optional browser-level smoke tests for the highest-risk routes if a UI test harness is introduced

## 8. Recommended Stabilization Sequence

1. Re-run the full backend regression and `/api/v2` contract suites.
2. Re-run frontend `typecheck` and production `build`.
3. Execute the manual QA matrix for all migrated `/ui` routes.
4. Execute the lock lifecycle checklist with at least one two-user conflict scenario.
5. Execute the upload overwrite and version-history validation checklist.
6. Validate structuring review save/export and backend-owned editor handoff behavior.
7. Add the missing automated tests for frontend-visible error states and lock conflict rendering before any editor-boundary expansion.
8. Re-evaluate go/no-go criteria and stop at WOPI handoff only unless every hardening item above is satisfied.

## 9. Manual-Only Checks That Still Cannot Be Fully Automated

These checks remain manual because they depend on live browser behavior, real download handling, or external editor infrastructure that is intentionally still backend-owned.

### Live Collabora / WOPI handoff
- Open the backend-provided `collabora_url` from the structuring review frontend route against a real Collabora deployment.
- Confirm cookies, redirects, and cross-origin launch behavior work in the target browser.
- Confirm the frontend does not need to own iframe state, save lifecycle, or WOPI callback behavior.

### Real browser download handling
- Confirm browser download prompts and filenames for:
  - chapter package ZIP
  - file download
  - structuring export
  - archived version download
- Confirm the browser receives the correct filenames and does not silently block the download flow.

### Multi-user conflict validation
- Run a true two-user checkout conflict with two independent authenticated browser sessions.
- Confirm the second user sees the expected conflict state and the first user retains lock ownership.
- Confirm non-owner cancel checkout preserves the current backend no-op behavior in live UI use.

### End-to-end processing and editor-adjacent verification
- Start structuring from the frontend, wait for completion, open structuring review, save changes, and export the processed file.
- Confirm the backend-owned return target and editor handoff semantics remain intact through the full flow.

### Environment-specific filesystem validation
- Confirm archive files, processed outputs, and derivative documents are created correctly in the deployed filesystem layout, not just the isolated test environment.
