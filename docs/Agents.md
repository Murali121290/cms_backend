# AGENTS.md

## Mission

Refactor `cms_backend` from server-rendered HTML pages and route-coupled UI into a maintainable React-based frontend without reducing or breaking existing functionality.

Preserve business behavior first. Modernize structure second. Prefer incremental migration over big-bang rewrites.

## Target architecture

- Keep FastAPI as the backend system of record.
- Move UI to React.
- Prefer TypeScript for all new frontend code.
- Expose backend functionality through explicit HTTP/JSON APIs.
- Reduce template-driven rendering and route-level HTML coupling over time.
- Maintain backward compatibility until replacement flows are verified.

## Core rules

- Do not remove or degrade any existing feature without replacing it.
- Do not mix new React UI logic into legacy server-rendered templates unless required for a temporary bridge.
- Keep business logic in backend services, not in frontend components.
- Keep frontend components presentational where possible; move stateful workflows into hooks, services, or feature modules.
- Prefer small, reversible changes.
- Avoid large cross-cutting rewrites in a single patch.
- Preserve authentication, authorization, validation, auditability, and file-processing flows exactly unless explicitly refactored.

## Migration strategy

- First map all current HTML pages, routes, forms, plugins, background jobs, and file-processing workflows.
- Then define API contracts for each existing user flow before replacing UI.
- Migrate feature-by-feature, not page-by-page where shared workflows exist.
- Add a React shell and route segmentation for migrated areas.
- Keep legacy pages operational until the React replacement is tested and accepted.
- For temporary coexistence, use a strangler pattern: legacy routes remain, new UI mounts on isolated paths.

## Frontend standards

- Use React with TypeScript for new UI modules.
- Prefer feature-based folder structure over type-based sprawl.
- Use strict typing for API contracts, form models, and state.
- Centralize API access in a dedicated client layer.
- Use reusable layout, form, table, modal, and status components.
- Handle loading, empty, error, and success states explicitly.
- Do not hardcode backend URLs, secrets, or environment-specific values.

## Backend standards

- Keep FastAPI routers thin.
- Move domain logic into services.
- Keep schemas explicit with Pydantic models.
- Separate HTML response concerns from API concerns.
- Add versioned API routes for React-facing functionality where appropriate.
- Ensure existing plugins and integrations remain operational during migration.

## Quality gates

Before completing any task:

- Run lint.
- Run type checks.
- Run affected tests.
- Verify no existing route or workflow is broken.
- For migrated flows, verify parity against legacy behavior.

## Refactor expectations

When changing a feature:

1. Identify current user flow.
2. Identify backend dependencies and side effects.
3. Preserve payload shape or introduce explicit contract changes.
4. Add or update tests.
5. Keep patch scope limited to the feature being migrated.

## Testing expectations

- Add unit tests for extracted logic.
- Add integration tests for FastAPI endpoints touched.
- Add UI/component tests for new React behavior where practical.
- Prefer regression coverage for critical CMS workflows: auth, upload, processing, review, export, routing, and plugin-triggered actions.

## File and module organization

Preferred direction:

- `backend/` or existing FastAPI app remains backend-only
- `frontend/` contains React + TypeScript app
- shared contracts should be explicit and minimal
- avoid duplicating validation rules across backend and frontend without reason

## Review guidelines

Reject changes that:

- silently remove current functionality
- move domain logic into UI components
- introduce untyped frontend API handling
- couple React components directly to legacy template assumptions
- skip regression validation for existing workflows
- mix unrelated cleanup with feature migration

## Delivery style

For each task, provide:

- what changed
- what legacy behavior was preserved
- what remains unmigrated
- risks or parity gaps, if any