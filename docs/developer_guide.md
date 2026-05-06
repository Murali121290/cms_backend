# Developer Guide

This guide is for working on the current backend architecture without changing its behavior accidentally.

Related docs:

- [System Overview](system_overview.md)
- [Backend Architecture](architecture/backend_architecture.md)
- [Router Layer](architecture/router_layer.md)
- [Service Layer](architecture/service_layer.md)
- [Known Constraints](architecture/known_constraints.md)

## Local Run Modes

FastAPI app:

```powershell
python -m uvicorn app.main:app --reload --port 8000
```

Containerized stack:

```powershell
docker compose up --build
```

The compose stack also starts Postgres, Redis, Collabora, the optional CMS Celery worker, the AI structuring backend, the AI worker, and Nginx.

## Runtime Directories

Runtime paths come from [`app/core/paths.py`](../app/core/paths.py):

- `CMS_RUNTIME_ROOT`
- `CMS_RUNTIME_ROOT/data/uploads`
- `CMS_RUNTIME_ROOT/ref_cache.json`

Tests override `CMS_RUNTIME_ROOT` to a temporary directory. Do not hardcode local upload paths in new backend logic.

## Where To Change Code

- HTTP routing and SSR page entrypoints: [`app/routers/`](../app/routers)
- Workflow logic: [`app/services/`](../app/services)
- Persistence model: [`app/models.py`](../app/models.py)
- Processing engines and legacy adapters: [`app/processing/`](../app/processing)
- Templates still in production use: [`app/templates/`](../app/templates)
- Regression suite: [`tests/`](../tests)

Current convention is service-first for business logic. Routers should stay small and delegate when a service already exists.

## Regression Suite

Run the full backend suite:

```powershell
python -m pytest -q tests -rA
```

The suite is organized by behavior:

- `test_auth_regression.py`
- `test_admin_and_api_compat.py`
- `test_project_and_file_workflows.py`
- `test_processing_and_technical.py`
- `test_read_side_pages.py`
- `test_structuring_and_wopi.py`

Use [Testing Strategy](architecture/testing_strategy.md) to see what each file protects before touching a workflow.

## Working Safely

Before changing any backend feature:

1. Identify the owning router and service.
2. Check whether the workflow also depends on filesystem layout, WOPI, or background processing.
3. Check the matching regression tests.
4. Review [Known Constraints](architecture/known_constraints.md) for preserved quirks such as duplicate routes, mixed auth, or legacy response shapes.

## Notes On Current Architecture

- The codebase is service-oriented, but not repository-based. Services still query SQLAlchemy sessions directly.
- HTML rendering is still active and backed by Jinja templates.
- Some SSR routes are still partially inline and not fully extracted.
- Mixed cookie and bearer authentication remains intentional for compatibility.
