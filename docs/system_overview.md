# System Overview

This repository currently contains two backend applications:

- The primary CMS backend in [`app/`](../app), implemented with FastAPI, Jinja2 templates, SQLAlchemy, and a service-oriented backend layer.
- A separate AI structuring backend in [`ai_structuring_backend/`](../ai_structuring_backend), implemented with Flask plus a queue service, used as an optional external processing dependency.

The CMS backend is no longer purely route-centric. Most high-risk workflow logic now lives in service modules under [`app/services/`](../app/services), while routers increasingly act as thin HTTP adapters. That said, the codebase is still a hybrid:

- Server-rendered HTML pages remain active under [`app/routers/web.py`](../app/routers/web.py).
- Versioned JSON APIs remain active under `/api/v1/...`.
- Collabora/WOPI integration remains backend-owned.
- Filesystem-backed document storage remains part of the core domain model.

## Architectural Pattern

The current CMS uses a layered backend structure:

1. `app/main.py` wires the application, middleware, startup role seeding, and router registration.
2. Routers translate HTTP requests into service calls or direct template responses.
3. Services own business workflows such as authentication, project bootstrap, file versioning, processing orchestration, structuring review, and WOPI integration.
4. SQLAlchemy models in [`app/models.py`](../app/models.py) represent persistent state.
5. Processing engines in [`app/processing/`](../app/processing) wrap legacy and external tooling.
6. Runtime state spans both the database and the filesystem under `CMS_RUNTIME_ROOT`.

## Backend Boundaries

- Router layer: see [Router Layer](architecture/router_layer.md)
- Service layer: see [Service Layer](architecture/service_layer.md)
- Data model: see [Data Model](architecture/data_model.md)
- File workflows: see [File Workflow](architecture/file_workflow.md)
- Processing orchestration: see [Processing Pipeline](architecture/processing_pipeline.md)
- Structuring review: see [Structuring Workflow](architecture/structuring_workflow.md)
- WOPI/Collabora: see [WOPI Integration](architecture/wopi_integration.md)
- Security and auth: see [Security Model](architecture/security_model.md)
- Tests and regression safety net: see [Testing Strategy](architecture/testing_strategy.md)
- Preserved limitations: see [Known Constraints](architecture/known_constraints.md)

## Persistence Model

The CMS persists state in two places:

- Relational database via SQLAlchemy models: users, roles, teams, projects, chapters, files, and file versions.
- Filesystem storage rooted at `CMS_RUNTIME_ROOT/data/uploads`, with service-specific directory conventions.

Not all logical concepts have their own tables. Notifications and activities are derived read models built from `File` and `FileVersion` rows rather than dedicated entities.

## Testing Approach

The repository includes a regression suite under [`tests/`](../tests) that uses:

- isolated SQLite databases
- temporary upload roots
- generated DOCX fixtures
- stubbed engine classes and monkeypatched external integrations

The suite protects the current behavior of auth, SSR flows, project bootstrap, file workflows, processing, structuring review, WOPI, and compatibility APIs. See [Testing Strategy](architecture/testing_strategy.md) for the exact suite map.
