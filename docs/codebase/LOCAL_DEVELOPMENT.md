# Local Development

This section documents the current working local setup for this repository.

Related docs:
- [OVERVIEW.md](./OVERVIEW.md)
- [TESTING_AND_RELEASE.md](./TESTING_AND_RELEASE.md)

## Current Local Topology

### Backend
- FastAPI app served by Uvicorn on `http://127.0.0.1:8000`

### Frontend
- Vite dev server on `http://127.0.0.1:5173`
- frontend proxies `/api/*` to the backend by default

### Database
- PostgreSQL in Docker
- host port: `5433`
- backend connection string: `postgresql://cms_user:cms_pass@localhost:5433/cms_db`

## Environment

Current root `.env` is expected to include at least:

```env
DATABASE_URL=postgresql://cms_user:cms_pass@localhost:5433/cms_db
SECRET_KEY=local-dev-secret
```

The backend reads `.env` through `app/core/config.py`.

## Start PostgreSQL On `localhost:5433`

The checked-in `docker-compose.yml` is geared toward the full containerized stack and does not currently publish the database port for direct local Uvicorn use.

For the current local workflow, start PostgreSQL with host mapping `5433:5432`, for example:

```powershell
docker run --name cms-postgres `
  -e POSTGRES_USER=cms_user `
  -e POSTGRES_PASSWORD=cms_pass `
  -e POSTGRES_DB=cms_db `
  -p 5433:5432 `
  -d postgres:15
```

If the container already exists:

```powershell
docker start cms-postgres
```

## Run The Backend

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Notes:
- runtime directories default under `/opt/cms_runtime` unless `CMS_RUNTIME_ROOT` is overridden
- local development may need a writable runtime root if `/opt/cms_runtime` is not suitable on the current machine

## Run The Frontend

From `frontend/`:

```powershell
npm.cmd install
npm.cmd run dev
```

Current Vite behavior:
- port `5173`
- `/api` proxy target defaults to `http://127.0.0.1:8000`
- can be overridden with `VITE_DEV_PROXY_TARGET`

Optional frontend env overrides:

```env
VITE_DEV_PROXY_TARGET=http://127.0.0.1:8000
VITE_API_BASE_URL=/api/v2
```

## Local Auth Notes

- `/ui/login` and `/ui/register` are the primary local auth entry points
- backend still issues and clears the cookie
- SSR `/login`, `/register`, and `/logout` remain available for rollback and debugging

## Full-Stack Compose Note

`docker-compose.yml` still defines the wider deployment/integration stack:
- backend
- redis
- celery worker
- collabora
- ai_structuring service and worker
- nginx

That file is useful for integration-style environments, but the current local day-to-day developer path is:
1. Postgres container on `localhost:5433`
2. backend via Uvicorn
3. frontend via Vite
