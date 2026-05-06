# Backend Architecture

Related docs:

- [System Overview](../system_overview.md)
- [Router Layer](router_layer.md)
- [Service Layer](service_layer.md)
- [Data Model](data_model.md)
- [Known Constraints](known_constraints.md)

## Current Architectural Pattern

The CMS backend is a layered FastAPI application with active server-side rendering and a service-oriented workflow layer.

It is not a pure API backend and it is not a full repository-pattern implementation. The current code has these layers:

| Layer | Main code | Role |
| --- | --- | --- |
| Application bootstrap | [`app/main.py`](../../app/main.py) | FastAPI app creation, static mount, CORS, startup role seeding, router registration |
| Router layer | [`app/routers/`](../../app/routers) | HTTP routing, auth boundaries, redirects, template rendering, JSON/file responses |
| Service layer | [`app/services/`](../../app/services) | Business workflows, orchestration, path resolution, state transitions |
| Persistence layer | [`app/models.py`](../../app/models.py), [`app/database.py`](../../app/database.py) | SQLAlchemy entities and session lifecycle |
| Processing layer | [`app/processing/`](../../app/processing) | Legacy tool wrappers, document processing engines, AI/offline integrations |
| Presentation layer | [`app/templates/`](../../app/templates) | Active SSR pages and browser-driven workflows |

## Separation Of Concerns In Practice

### Router layer

Routers now handle:

- request parsing
- dependency injection
- auth checks
- template rendering
- response shaping

In the extracted areas, routers delegate mutation and orchestration to services rather than performing the workflow inline.

### Service layer

Services now own:

- browser auth/session flows
- admin write-side mutations
- project bootstrap
- chapter mutation workflows
- file upload, archive, delete, download, and checkout workflows
- processing orchestration and structuring polling
- technical editor scan/apply orchestration
- structuring review state, save, and export
- WOPI target path, metadata, byte read/write behavior

### Remaining inline areas

The architecture is service-oriented, but not every route is fully extracted yet. Inline behavior still exists in parts of [`app/routers/web.py`](../../app/routers/web.py), especially:

- `download_chapter_zip`
- `admin_stats`
- some SSR page-preparation routes such as `admin_create_user_page`

These routes are still part of the current architecture and are documented as-is.

## Request And Data Flow

### SSR flow

`Browser -> FastAPI SSR route -> cookie auth dependency -> service or direct query -> Jinja template`

### JSON/API flow

`Client -> FastAPI JSON route -> bearer or cookie auth dependency -> service -> JSON response`

### Processing flow

`SSR/JS trigger -> processing router -> processing_service -> BackgroundTasks -> engine wrapper -> filesystem outputs -> File rows`

### WOPI flow

`SSR shell route -> wopi_service launch URL -> Collabora callbacks -> WOPI endpoints -> direct filesystem reads/writes`

## Persistence Model

The CMS stores state in both the database and the filesystem.

### Database

SQLAlchemy models cover:

- roles
- teams
- users
- user-role joins
- projects
- chapters
- files
- file versions

There is no separate `Activity` or `Notification` table. Those read models are assembled from `File` and `FileVersion`.

### Filesystem

Runtime storage is rooted at `CMS_RUNTIME_ROOT` from [`app/core/paths.py`](../../app/core/paths.py). The main live directory is:

- `CMS_RUNTIME_ROOT/data/uploads`

Workflow services use the filesystem directly for:

- project bootstrap directory creation
- chapter directory creation and rename
- file upload and overwrite
- archive/version snapshots
- processing outputs
- WOPI byte serving and save callbacks

## Integration Boundaries

| Integration | Boundary in code | Notes |
| --- | --- | --- |
| Postgres or SQLite | SQLAlchemy session in `app.database` | Tests run on SQLite; compose uses Postgres |
| Collabora Online | [`app/routers/wopi.py`](../../app/routers/wopi.py), [`app/services/wopi_service.py`](../../app/services/wopi_service.py) | WOPI callbacks are intentionally backend-owned |
| AI structuring backend | [`app/services/ai_structuring_client.py`](../../app/services/ai_structuring_client.py) | Optional external service used only when `AI_STRUCTURING_BASE_URL` is configured |
| Redis/Celery | [`app/core/celery_app.py`](../../app/core/celery_app.py), `docker-compose.yml` | Present in repo, but main CMS processing route currently uses FastAPI `BackgroundTasks` |
| Legacy document tooling | [`app/processing/`](../../app/processing) and `Dockerfile` | Includes Perl, Java, LibreOffice, and older Python-based processors |
| Nginx reverse proxy | [`nginx/nginx.conf`](../../nginx/nginx.conf) | Proxies backend and Collabora paths |

## Architecture Characteristics That Matter

- Service extraction reduced route-coupled mutation logic, but did not redesign contracts.
- The backend still supports both SSR and JSON routes side by side.
- Auth remains mixed: cookie-based browser auth and bearer-token API auth both remain active.
- Processing and WOPI workflows remain filesystem-centric.
- Regression tests protect behavior first; see [Testing Strategy](testing_strategy.md).
