# Post-Refactor Stability Report

## Recommendation

`ready` for internal release

Basis:

- The backend domain/integration refactor preserved current runtime behavior.
- The backend regression suite is green.
- The migrated frontend test, typecheck, and production build checks are green.
- No release-blocking defects were found during the post-refactor validation pass.
- WOPI/editor ownership remains backend-owned and unchanged.

## Validation Scope Executed

### Automated checks executed

| Check | Command | Result |
| --- | --- | --- |
| Backend regression suite | `.\.venv\Scripts\python.exe -m pytest -q tests` | `98 passed` |
| Frontend unit/component smoke | `npm.cmd run test` in `frontend/` | `9 passed`, `7` test files |
| Frontend typecheck | `npm.cmd run typecheck` in `frontend/` | passed |
| Frontend production build | `npm.cmd run build` in `frontend/` | passed |

### Current runtime behavior verified by the automated suite

#### Backend flows still passing

- login, logout, register
- admin bootstrap behavior
- dashboard read flow
- projects list and project detail read flow
- chapter detail read flow
- project bootstrap
- chapter create, rename, delete
- file upload and overwrite/versioning
- archive creation and `FileVersion` behavior
- checkout and cancel-checkout lock behavior
- file delete and download
- processing start/status orchestration
- technical scan/apply orchestration
- structuring review load/save/export
- WOPI original and structuring callbacks
- `/api/v1` compatibility routes
- `/api/v2` read, mutation, upload/versioning, processing, technical-review, and structuring-review contracts

#### Frontend `/ui` surface still passing

- session handoff behavior
- dashboard error-state rendering
- projects error-state rendering
- chapter detail lock-conflict and skipped-upload rendering
- technical review error-state rendering
- structuring review error-state rendering
- admin mutation error rendering

## Compatibility Wrappers Intentionally Retained

These wrappers are still intentional and should not be removed in this release-hardening phase.

### Top-level compatibility wrappers

| Wrapper path | Current owner |
| --- | --- |
| `app/auth.py` | `app/domains/auth/security.py` |
| `app/core/database.py` | `app/database.py` |
| `app/rbac.py` | `app/domains/auth/permissions.py` |
| `app/worker.py` | `app/core/worker.py` |

### Service compatibility wrappers

| Wrapper path | Current owner |
| --- | --- |
| `app/services/activity_service.py` | `app/domains/activities/service.py` |
| `app/services/admin_user_service.py` | `app/domains/admin/service.py` |
| `app/services/ai_structuring_client.py` | `app/integrations/ai_structuring/client.py` |
| `app/services/auth_service.py` | `app/domains/auth/auth_service.py` |
| `app/services/chapter_service.py` | `app/domains/chapters/service.py` |
| `app/services/checkout_service.py` | `app/domains/files/checkout_service.py` |
| `app/services/dashboard_service.py` | `app/domains/projects/dashboard_service.py` |
| `app/services/notification_service.py` | `app/domains/notifications/service.py` |
| `app/services/processing_service.py` | `app/domains/processing/service.py` |
| `app/services/project_read_service.py` | `app/domains/projects/read_service.py` |
| `app/services/project_service.py` | `app/domains/projects/service.py` |
| `app/services/session_service.py` | `app/domains/auth/session_service.py` |
| `app/services/structuring_review_service.py` | `app/domains/review/service.py` |
| `app/services/team_service.py` | `app/domains/projects/team_service.py` |
| `app/services/technical_editor_service.py` | `app/domains/processing/technical_editor_service.py` |
| `app/services/user_service.py` | `app/domains/auth/user_service.py` |
| `app/services/version_service.py` | `app/domains/files/version_service.py` |
| `app/services/wopi_service.py` | `app/integrations/wopi/service.py` |

### Router compatibility wrappers

| Wrapper path | Current owner |
| --- | --- |
| `app/routers/users.py` | `app/domains/auth/api_v1.py` |
| `app/routers/teams.py` | `app/domains/projects/teams_api_v1.py` |
| `app/routers/projects.py` | `app/domains/projects/api_v1.py` |
| `app/routers/files.py` | `app/domains/files/api_v1.py` |
| `app/routers/wopi.py` | `app/integrations/wopi/router.py` |

### Domain and legacy façade wrappers retained for structure clarity

| Wrapper path | Canonical module still used at runtime |
| --- | --- |
| `app/legacy/web.py` | `app/routers/web.py` |
| `app/domains/processing/api_v1.py` | `app/routers/processing.py` |
| `app/domains/review/router.py` | `app/routers/structuring.py` |
| `app/domains/files/service.py` | `app/services/file_service.py` |

### Canonical old-path modules intentionally preserved

These are still the primary patch/runtime points and were not moved out completely in this stabilization step:

- `app/database.py`
- `app/services/file_service.py`
- `app/routers/api_v2.py`
- `app/routers/processing.py`
- `app/routers/structuring.py`
- `app/routers/web.py`

Reason:

- the regression suite and runtime monkeypatch/override behavior still depend on these import locations
- removing or inverting them now would increase release risk without improving user-visible behavior

## Manual Smoke-Test Results

## Browser/manual checks executed in this step

No new browser-driven manual smoke session was executed in this CLI-only stabilization pass.

## Most recent carried-forward manual status

The most recent manual smoke baseline remains the release-hardening result recorded in [release_candidate_checklist.md](/C:/Users/harikrishnam/Desktop/cms_backend-codex/docs/release_candidate_checklist.md):

- passed:
  - SSR login handoff origin
  - SSR logout handoff origin
  - SSR project-create handoff origin
  - frontend fallback-link review for the hardened `/ui` shell
- still recommended manual-only follow-up:
  - real Collabora launch
  - real browser downloads
  - true two-user lock-conflict validation

Because the domain/integration refactor was structure-only and the full automated suite remained green, no new manual smoke regressions were discovered in this step.

## Release-Blocking Defects

No release-blocking defects were found.

## Remaining Manual-Only Checks

These are still recommended before or immediately after internal rollout, but they are not new blockers introduced by the refactor.

| Area | Status | Notes |
| --- | --- | --- |
| Real Collabora launch from backend-provided `collabora_url` | manual-only pending | Backend-owned editor boundary remains unchanged |
| Real browser download prompts for file/package/export/version downloads | manual-only pending | Automated suite validates endpoint behavior, not browser UX |
| True two-user checkout conflict in separate browser sessions | manual-only pending | Automated coverage exists for lock conflict semantics, but not live multi-browser interaction |
| Cross-origin editor/window behavior from `/ui` review shell | manual-only pending | Relevant only to the existing backend-owned WOPI handoff |

## Non-Blocking Warnings Still Present

- Backend deprecation warnings remain in:
  - FastAPI `on_event`
  - Pydantic v2 migration items
  - `datetime.utcnow()` and `utcfromtimestamp()`
  - Starlette templating signature warnings
- Frontend Vite/Vitest still warns about deprecated React plugin `esbuild` options

These warnings predate the release-hardening decision and did not block the post-refactor validation pass.

## Final Release Decision

`ready`

Reason:

- the new backend domain/integration structure is stable under the current test surface
- the migrated `/ui` frontend still builds and passes its current automated checks
- retained compatibility wrappers are intentional and functioning
- `/api/v2` behavior is unchanged
- SSR auth and backend-owned WOPI/editor boundaries are unchanged
