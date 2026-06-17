# Testing And Release

This repository currently uses backend regression tests plus frontend route/component tests.

Related docs:
- [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)
- [KNOWN_BOUNDARIES_AND_TECH_DEBT.md](./KNOWN_BOUNDARIES_AND_TECH_DEBT.md)

## Backend Test Suite

Backend tests live in `tests/`.

Current key files:
- `test_auth_regression.py`
- `test_admin_and_api_compat.py`
- `test_project_and_file_workflows.py`
- `test_processing_and_technical.py`
- `test_structuring_and_wopi.py`
- `test_api_v2_contracts.py`
- `test_api_v2_admin_contracts.py`
- `test_api_v2_project_file_mutations.py`
- `test_api_v2_upload_versioning_contracts.py`
- `test_api_v2_processing_contracts.py`
- `test_api_v2_structuring_contracts.py`

Coverage focus:
- auth/session
- project bootstrap
- chapter/file workflows
- upload/versioning
- lock lifecycle
- processing and technical review
- structuring review
- WOPI boundary
- `/api/v1` compatibility
- `/api/v2` contracts

## Frontend Test Suite

Frontend tests live under `frontend/src/**/*.test.tsx`.

Current coverage includes:
- session gate handoff
- login page
- register page
- logout behavior
- dashboard error state
- projects error state
- chapter detail conflict/skipped upload rendering
- technical review error rendering
- structuring review error rendering
- admin mutation error rendering

## Current Validation State

Most recent validated state for the current codebase:

| Check | Result |
| --- | --- |
| backend regression suite | `102 passed` |
| frontend tests | `16 passed` |
| frontend typecheck | passed |
| frontend build | passed |

## Commands

### Backend
```powershell
.\.venv\Scripts\python.exe -m pytest -q tests
```

### Frontend
```powershell
cd frontend
npm.cmd run test
npm.cmd run typecheck
npm.cmd run build
```

## Manual-Only Checks Still Required

These are still important before or during internal release:
- real Collabora launch using backend-provided `collabora_url`
- real browser download prompts for package/file/export/version downloads
- true two-user lock conflict in separate browser sessions
- end-to-end structuring start -> review -> save -> export flow against a live environment

## Internal Release Guidance

Current recommendation:
- `/ui` is the primary interface
- auth/session still stays backend-owned
- WOPI/editor remains backend-owned
- SSR auth stays available as rollback fallback during the stable release cycle

## Release Boundary

Ready for internal release when:
- backend tests are green
- frontend tests are green
- frontend typecheck/build are green
- manual-only checks above are acceptable for the intended release scope

Do not treat this repository as ready for frontend-owned editor behavior. Stop at backend-owned WOPI handoff.
