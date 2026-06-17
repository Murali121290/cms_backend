# Release Candidate Checklist

## Passed Automated Checks

- Backend regression suite: `98 passed`
  - Command: `.\.venv\Scripts\python.exe -m pytest -q tests`
- Frontend tests: `9 passed`
  - Command: `npm.cmd run test` in [frontend](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend)
- Frontend typecheck: passed
  - Command: `npm.cmd run typecheck` in [frontend](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend)
- Frontend production build: passed
  - Command: `npm.cmd run build` in [frontend](/C:/Users/harikrishnam/Desktop/cms_backend-codex/frontend)

## Passed Manual Checks

- Release-blocking SSR handoff review completed for the current `/ui` surface.
- Unauthenticated frontend session handoff now targets the backend SSR login origin explicitly.
- Frontend logout handoff now targets the backend SSR login origin explicitly.
- SSR project-creation handoff now targets the backend origin explicitly from the current frontend empty states.
- SSR fallback links reviewed and corrected for the current frontend shell pages:
  - dashboard
  - admin dashboard
  - admin users
  - projects
  - project detail
  - chapter detail
  - technical review
  - login placeholder
- Final frontend sweep confirmed no remaining release-blocking frontend-relative SSR fallback links in the hardened paths above.

## Remaining Known Non-Blocking Issues

- Backend test suite still emits existing deprecation warnings from:
  - FastAPI `on_event`
  - Pydantic V2 migration items
  - UTC datetime helpers
  - Starlette template response signature changes
- Frontend test/build runs still emit existing Vite/Vitest warnings about deprecated React plugin `esbuild` options.
- Live browser/manual smoke is still recommended for:
  - real Collabora launch from backend-provided `collabora_url`
  - real browser download prompts for package/export/archive downloads
  - true two-user lock conflict behavior in separate browser sessions
- WOPI/editor remains intentionally backend-owned and is not embedded in the frontend.

## Recommendation

`ready` for internal release

Basis:
- `/ui` is operational as the primary interface for the migrated flows.
- Backend-owned login remains intact.
- Backend-owned WOPI/editor handoff remains unchanged.
- Current `/api/v2` behavior and SSR fallback routes were preserved.
- Release-blocking SSR origin/handoff defects in the frontend were fixed without expanding architecture or adding new features.
