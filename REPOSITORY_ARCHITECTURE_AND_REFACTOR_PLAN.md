# Repository Architecture And Refactoring Plan

Static analysis only. No application code was modified to produce the original analyses. This file consolidates the outputs from the two prior repository-analysis prompts.

## Part 1. Repository Architecture Analysis

### Snapshot

- The repo was analyzed statically. No apps or tests were run during the original report.
- The repo is not yet in the target React migration state from `Agents.md`. There is no `frontend/`, no `package.json`, no `tsconfig.json`, and no `.tsx` source.
- The current system is really two backend applications in one repo:
  - A FastAPI CMS in [app/main.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/main.py)
  - A separate Flask/Celery AI structuring service in [ai_structuring_backend/app/__init__.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/__init__.py)
- Operationally, `docker-compose` stands up Postgres, Redis, the CMS app, a CMS Celery worker, Collabora, the AI structuring API, an AI structuring worker, and Nginx: [docker-compose.yml](C:/Users/harikrishnam/Desktop/cms_backend-codex/docker-compose.yml), [nginx/nginx.conf](C:/Users/harikrishnam/Desktop/cms_backend-codex/nginx/nginx.conf).
- Repo scale is already significant: 66 FastAPI endpoints, 15 Flask queue endpoints, 33 templates, 159 files under `app/processing`, 43 AI processor modules, 82 AI-service tests, and effectively 1 CMS-side test.

### Current Architecture

- The CMS entrypoint creates runtime directories, mounts static assets, enables CORS, and composes one SSR router plus several JSON/API routers and WOPI endpoints: [app/main.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/main.py).
- The CMS data model is classic publishing/CMS hierarchy: roles, users, teams, projects, chapters, files, and file versions: [app/models.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/models.py).
- Authentication is hybrid. API routes use bearer-token dependencies, while the server-rendered UI stores a bearer token in a cookie and reads it back from `access_token`: [app/auth.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/auth.py), [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py).
- The dominant CMS controller is the monolithic SSR router in [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py). It owns login, dashboard, admin, project/chapter/file CRUD, notifications, activities, and editor pages.
- The main CMS workflow is route-coupled, not service-driven:
  - Project creation creates DB records, chapter records, and directory trees, then infers chapter/category from uploaded filenames: [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py)
  - Chapter upload performs in-place version archiving and unlock logic: [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py)
  - File checkout/checkin state is managed directly in the web router: [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py)
- CMS document processing is centralized in [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py). That router locks the file, snapshots a backup/version, runs a specific engine, and registers generated artifacts as new `File` rows.
- The processing engines are adapters over heterogeneous tools:
  - Rule/YAML-based local structuring with optional HTTP offload to the AI service: [app/processing/structuring_engine.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing/structuring_engine.py), [app/services/ai_structuring_client.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services/ai_structuring_client.py)
  - Legacy reference processing: [app/processing/references_engine.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing/references_engine.py), [app/processing/legacy/ReferencesStructing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing/legacy/ReferencesStructing.py)
  - Technical editing/highlighting: [app/processing/technical_engine.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing/technical_engine.py)
  - Word-to-XML conversion through Perl/XSLT/Java: [app/processing/xml_engine.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing/xml_engine.py), [Dockerfile](C:/Users/harikrishnam/Desktop/cms_backend-codex/Dockerfile)
- The CMS structuring review flow uses Collabora/WOPI rather than a client-side editor. Review/export lives in [app/routers/structuring.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/structuring.py); edit and content round-trips live in [app/routers/wopi.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/wopi.py).
- The AI service is a separate queued processing backend. Its public contract is batch/job/status/download oriented rather than page oriented: [ai_structuring_backend/app/routes/api.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/routes/api.py).
- AI queue persistence is isolated into `Batch` and `Job` tables with token usage, timings, outputs, and failure metadata: [ai_structuring_backend/app/models/database.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/models/database.py).
- Queue orchestration is handled by a singleton service that stores uploads/outputs and can run in either in-process threading mode or Celery mode; the default is threading: [ai_structuring_backend/app/services/queue.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/services/queue.py).
- The AI pipeline is the most mature architectural slice in the repo. It performs block extraction, deterministic pre-classification locks, Gemini classification, repair/style enforcement, confidence filtering, reconstruction, structure guard, integrity gates, and review/json/html bundle generation: [ai_structuring_backend/processor/pipeline.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/processor/pipeline.py).
- Gemini access is abstracted behind a retrying/token-tracking wrapper: [ai_structuring_backend/processor/llm_client.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/processor/llm_client.py).

### Migration Status And Risks

- What remains unmigrated: essentially the full CMS UI. Projects, chapters, files, admin, activities, technical editing pages, editor pages, and structuring review are still server-rendered Jinja flows.
- Frontend architecture is inconsistent even before React migration. There are two base stacks:
  - Bootstrap/Inter/custom CSS in [app/templates/base.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/base.html)
  - Tailwind CDN/DM Sans in [app/templates/base_tailwind.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/base_tailwind.html)
- Some newer template code is still mock-oriented rather than API-backed. The dashboard template contains placeholder client-side submit/delete behavior instead of real integration: [app/templates/dashboard.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/dashboard.html).
- The biggest CMS maintainability hotspot is the 1214-line `web.py`, which also contains duplicate admin handlers: [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py).
- There is contract drift between models, schemas, and services:
  - `TeamService` writes `description` and `owner_id`, but `Team` does not define those fields: [app/services/team_service.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services/team_service.py), [app/models.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/models.py)
  - `ProjectCreate` lacks `client_name`, but the model and web flow use it: [app/schemas.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/schemas.py), [app/models.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/models.py), [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py)
  - There is stale deletion code referencing `processing_results`, which does not exist elsewhere in the repo: [app/services/project_service.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services/project_service.py)
- Async architecture is split-brain:
  - CMS processing actually runs via FastAPI `BackgroundTasks`, not Celery: [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py)
  - Yet the repo also ships a CMS Celery app/worker: [app/core/celery_app.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/core/celery_app.py), [app/worker.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/worker.py)
  - The AI service defaults to threading unless `QUEUE_MODE=celery`: [ai_structuring_backend/app/services/queue.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/services/queue.py)
- Security and boundary risks are visible:
  - FastAPI enables `allow_origins=["*"]` with credentials: [app/main.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/main.py)
  - Login cookie is only `httponly`; it is not explicitly `secure` or `samesite`: [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py)
  - WOPI data endpoints are not user-authenticated and advertise `SupportsLocks: False`: [app/routers/wopi.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/wopi.py)
- AI support modules still assume an older repo layout under `backend/data/...`, but this repo has no `backend/` directory. That is a concrete path-coupling bug risk for cache/corpus features: [ai_structuring_backend/app/services/prediction_cache.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/services/prediction_cache.py), [ai_structuring_backend/app/services/grounded_retriever.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/services/grounded_retriever.py).
- Testing is very uneven. The AI service has substantial regression coverage; the CMS side effectively has one local-path-dependent test that is not CI-friendly: [tests/test_technical_editor.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/tests/test_technical_editor.py).

The practical conclusion is that the repo already contains a strong backend processing core, especially in `ai_structuring_backend`, but the CMS product layer is still largely route-coupled SSR. The cleanest migration path is to keep FastAPI and the AI service as systems of record, extract stable JSON contracts for project/chapter/file and processing flows, and replace the Jinja surfaces incrementally rather than trying to “React-ify” the current templates in place.

## Part 2. Refactoring Plan

Static analysis only. No code changes.

### Repository

- The repo is two backend applications plus infra: a FastAPI CMS in [app](C:/Users/harikrishnam/Desktop/cms_backend-codex/app) and a separate Flask AI structuring service in [ai_structuring_backend](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend), composed with Postgres, Redis, Collabora, Celery workers, and Nginx in [docker-compose.yml](C:/Users/harikrishnam/Desktop/cms_backend-codex/docker-compose.yml).
- There is no dedicated frontend yet: no `frontend/`, no `package.json`, no `tsconfig.json`. The entire user UI is still template-driven from [app/templates](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates).
- HTML rendering routes live mainly in [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py), with additional HTML/editor flows in [app/routers/structuring.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/structuring.py) and [app/routers/wopi.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/wopi.py).
- JSON/API routes live in [app/routers/users.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/users.py), [app/routers/teams.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/teams.py), [app/routers/projects.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/projects.py), [app/routers/files.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/files.py), [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py), plus the AI queue API in [ai_structuring_backend/app/routes/api.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/routes/api.py). The CMS has 66 FastAPI endpoints; the AI service adds 15 Flask endpoints.
- Business logic is heavily embedded in routes. The largest examples are project creation, chapter creation, file classification, storage path construction, version archiving, checkout/check-in, notifications, activities, and admin workflows in [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py), plus process dispatch and file-lock/version behavior in [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py).
- There is no formal plugin architecture. Extensibility is currently hardcoded via `process_type` branching in [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py), engine wrappers in [app/processing](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing), external AI calls in [app/services/ai_structuring_client.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services/ai_structuring_client.py), and editor integration via WOPI/Collabora.
- Authentication is hybrid: bearer-token API auth in [app/auth.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/auth.py) and a bearer token stored in the `access_token` cookie for web routes via [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py). That split should be preserved initially, then normalized behind a single session/auth service.
- Background jobs are inconsistent today. The CMS uses FastAPI `BackgroundTasks` in [app/routers/processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py), but the repo also contains a CMS Celery worker in [app/core/celery_app.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/core/celery_app.py). The AI service has its own queue model in [ai_structuring_backend/app/services/queue.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/app/services/queue.py), defaulting to threading and optionally Celery.
- File upload and processing pipelines are split between thin APIs and real SSR workflows. The real upload/versioning path is in [app/routers/web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py); the generic `/api/v1/files` endpoint in [app/routers/files.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/files.py) does not cover the full behavior.
- Template dependencies are high. Templates depend on injected DB objects, user roles, URL conventions, and direct `fetch()` calls to backend endpoints. [dashboard.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/dashboard.html), [chapter_detail.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/chapter_detail.html), [technical_editor_form.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/technical_editor_form.html), and [base.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/base.html) are the main coupling points.

### Pages And Workflows

- Auth: login, register, logout.
- Core CMS: dashboard, projects list, create project, project chapters, chapter detail, activities.
- Admin: admin dashboard, users list, create user, edit user, change password, stats.
- File workflows: create project with files, create chapter, upload chapter files, download/delete file, checkout/cancel checkout.
- Processing workflows: launch document processing, run multiple reference checks, polling for structuring, technical scan/apply, export processed document.
- Editor workflows: generic Collabora editor, structuring review page, WOPI file fetch/save.

### Module Inventory

| Module | Current state | Complexity | Refactor goal | Recommended frontend approach |
|---|---|---:|---|---|
| Auth/session | Split between API JWT and cookie-bearer web flow | Medium | Unified auth/session service and explicit session API | Keep server-rendered first; later a thin hybrid login/session layer |
| Admin/users | Mostly SSR CRUD in `web.py` | Medium | Move admin logic to service + JSON API | Small React/Vue module or server-rendered + islands |
| Dashboard/projects list | SSR pages with injected JS and some mock client logic | High | Stable project/query APIs and typed view models | React/Vue module |
| Project create + chapters/files | Heavy route-coupled logic, filesystem side effects | Very High | Extract project, chapter, storage, versioning services | React/Vue module after APIs exist |
| Chapter detail + file actions | State-heavy page with processing triggers and polling | Very High | Explicit file-action and workflow APIs | React/Vue module |
| Technical editor | Dynamic JSON-driven UI already | High | Keep scan/apply APIs, move rendering to component app | React/Vue module |
| Structuring review + WOPI | Tight backend/editor coupling | Very High | Isolate review service and editor gateway | Hybrid shell; keep backend-owned editor wrapper |
| Processing engines | Hardcoded dispatch over legacy tools | Very High | Processor registry + unified job model | Backend-first, thin UI only |
| AI structuring service | Separate and comparatively mature | High | Keep separate, tighten contracts, avoid UI rewrite | No major UI work; admin/monitoring only |

### Dependency Map

- Browser -> Jinja templates -> [web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) / [structuring.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/structuring.py) / [wopi.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/wopi.py) -> SQLAlchemy models + filesystem.
- Template JS -> `/api/v1/projects`, `/api/v1/processing`, `/api/notifications`, technical scan/apply, structuring status.
- Processing router -> engine adapters in [app/processing](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/processing) -> legacy Python/Perl/LibreOffice/Java tools or AI client.
- FastAPI structuring client -> AI queue API -> queue service -> pipeline in [ai_structuring_backend/processor/pipeline.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/ai_structuring_backend/processor/pipeline.py).
- WOPI/Collabora -> backend file endpoints -> filesystem.

### Target Architecture

- API layer: keep current `/api/v1` for compatibility, add a frontend-facing `/api/v2` with explicit contracts for auth, projects, chapters, files, activities, notifications, processing, and review.
- Service layer: extract domain services for auth/session, admin, projects, chapters, files, versioning, activities, notifications, processing orchestration, and structuring review.
- Frontend layer: keep legacy templates under existing routes; introduce new UI under `/ui` or `/app` as a strangler layer. Do not mix substantial new app logic into legacy templates except small temporary bridges.

### Refactoring Phases

1. Freeze behavior and document route/workflow contracts. Add regression coverage around auth, project creation, uploads, file versioning, processing launch, structuring review, and export.
2. Extract services from [web.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/web.py) and [processing.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/routers/processing.py) without changing routes.
3. Normalize schemas and contracts. Fix current drift between [app/models.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/models.py), [app/schemas.py](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/schemas.py), and [app/services](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/services).
4. Formalize the processing architecture. Replace `if/elif process_type` dispatch with a processor registry and choose one job model per service.
5. Introduce the new frontend shell on isolated paths. Legacy pages remain default until parity is proven.
6. Migrate low-risk modules first, then high-interaction modules, and leave WOPI/Collabora-backed flows for last.
7. Retire templates only after route-by-route parity, not as a bulk rewrite.

### Migration Plan

- Keep all existing URLs and pages working during migration.
- Add new APIs before changing UI behavior.
- Mount new UI on separate routes first, then switch navigation module by module.
- Preserve current auth semantics until the new frontend can use the same session model safely.
- Keep processing, storage, and editor integrations backend-owned throughout the migration.
- Use feature flags or route-level cutovers, not global rewrites.

### Risk Analysis

- Highest risk is file/versioning behavior: upload overwrite rules, archive copies, version rows, and checkout semantics are business-critical.
- Processing is operationally fragile because it depends on legacy tools and OS-level dependencies in [Dockerfile](C:/Users/harikrishnam/Desktop/cms_backend-codex/Dockerfile).
- WOPI/Collabora flows are tightly coupled to URL shape, file paths, and save semantics.
- Auth/session changes can break both API clients and SSR pages if bearer/cookie behavior changes too early.
- Contract drift already exists in team/project services and schemas; fix that before frontend work expands the surface.
- The UI stack is inconsistent today: [base.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/base.html) and [base_tailwind.html](C:/Users/harikrishnam/Desktop/cms_backend-codex/app/templates/base_tailwind.html) use different foundations.
- CMS test coverage is weak compared with the AI service, so migration risk is currently under-instrumented.

### Recommended Frontend Strategy By Module

- Auth pages: keep server-rendered initially; they are low-complexity and coupled to current cookie auth.
- Admin and dashboard modules: migrate first to a small component-based frontend module; React or Vue both fit.
- Project/chapter/file workflows: use a richer component frontend because these flows are stateful and API-driven once extracted.
- Technical editor: move to a component frontend early; it already behaves like a JSON-driven app.
- Structuring review: use a hybrid approach. Keep backend rendering the editor shell and file access, but move review controls/status UI to a modern frontend layer.
- WOPI editor launch pages: keep server-rendered wrappers; they are integration gateways, not business UIs.
- AI structuring backend: keep backend-only. Add monitoring/admin views later only if operationally needed.

### Suggested Implementation Order

1. Contract cleanup and regression tests.
2. Auth/session service extraction.
3. Admin/users and stats.
4. Dashboard and project list.
5. Project creation.
6. Chapter detail, uploads, file actions, notifications, and activities.
7. Technical editor.
8. Processing UI orchestration.
9. Structuring review.
10. WOPI/editor wrapper cleanup last.

The lowest-risk path is a hybrid strangler migration: stabilize the backend contracts first, extract services second, introduce new UI on separate routes third, and only then replace legacy pages module by module.
