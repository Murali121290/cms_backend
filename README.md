# CMS Backend

A Content Management System for the publishing industry. Manages the full manuscript lifecycle — from raw DOCX upload through structuring, styling, XML tagging, review, and publication.

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  React SPA  │────▶│  Nginx Proxy │────▶│  FastAPI Backend     │
│  (Vite/TS)  │     │   :80/:443   │     │  :8000               │
└─────────────┘     └──────────────┘     └──────┬───────────────┘
                                                 │
                    ┌──────────────┐     ┌───────▼───────────────┐
                    │  PostgreSQL  │◀────│  SQLAlchemy + Alembic │
                    └──────────────┘     └──────┬───────────────┘
                                                 │
                    ┌──────────────┐     ┌───────▼───────────────┐
                    │    Redis     │◀────│  Celery Workers       │
                    └──────────────┘     └───────────────────────┘
                                                 │
              ┌──────────────────────────────────┼───────────────┐
              │                                  │               │
   ┌──────────▼──────┐   ┌──────────────┐  ┌────▼──────────────┐
   │ Collabora Online│   │  OnlyOffice  │  │ AI Structuring    │
   │   :9980         │   │  :8080       │  │ Backend (opt.)    │
   └─────────────────┘   └──────────────┘  └───────────────────┘
```

### Backend
- **Framework:** FastAPI (Python 3.10+), fully async
- **Database:** PostgreSQL (production) / SQLite (development)
- **ORM & Migrations:** SQLAlchemy + Alembic
- **Task Queue:** Celery with Redis broker
- **Auth:** Cookie-based session authentication with hashed passwords

### Frontend
- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **Build output:** `frontend/dist/` served by Nginx

### Document Editing
- **Collabora Online:** LibreOffice-in-browser via WOPI protocol
- **OnlyOffice:** Alternative document server integration

---

## Key Features

- **Hierarchical structure:** Projects → Chapters → Files
- **Role-Based Access Control:** Admin, Project Manager, Editor, Copyeditor, Typesetter, Viewer
- **File versioning:** Checkout/checkin to prevent concurrent edits
- **Processing pipeline:** 11-step DOCX pipeline (cleanup, style validation, conversion, etc.)
- **Math support:** LaTeX ↔ MathML ↔ OMML conversions
- **XML generation:** NLM XML tagging for academic publishing
- **In-browser editing:** Collabora and OnlyOffice integrations
- **AI structuring:** Optional external AI service for manuscript analysis
- **PPH integration:** Pre-press server connectivity

---

## Project Structure

```
cms_backend/
├── app/
│   ├── core/              # Config, database, dependencies
│   ├── domains/           # Business logic by domain
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── files/
│   │   ├── chapters/
│   │   ├── processing/
│   │   ├── workflow/
│   │   ├── clients/
│   │   ├── admin/
│   │   ├── activities/
│   │   ├── review/
│   │   └── notifications/
│   ├── integrations/      # Collabora, OnlyOffice, PPH, AI service, storage
│   ├── models/            # SQLAlchemy models
│   ├── processing/        # Document processing engines
│   │   ├── docx_pipeline/ # 11-step processing pipeline
│   │   ├── structuring_engine.py
│   │   ├── technical_engine.py
│   │   ├── references_engine.py
│   │   ├── docx_to_xhtml.py
│   │   └── xhtml_to_docx.py
│   ├── routers/
│   │   ├── api_v2.py      # Primary REST API
│   │   ├── web.py         # Legacy SSR routes
│   │   └── processing.py
│   └── main.py
├── frontend/              # React 18 SPA
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── ai_structuring_backend/ # Optional AI microservice
├── alembic/               # Database migrations
├── tests/                 # pytest test suite
├── nginx/                 # Reverse proxy config
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── .env.example
```

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL (or use the Docker Compose stack)

### Local Development

**1. Clone and configure environment:**
```bash
git clone <repo_url>
cd cms_backend
cp .env.example .env
# Edit .env with your values
```

**2. Backend:**
```bash
python -m venv .venv
.\.venv\Scripts\Activate    # Windows
source .venv/bin/activate   # Linux/Mac

pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --reload --port 8000
```

**3. Frontend:**
```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
```

**4. Collabora (required for in-browser editing):**
```bash
docker run -t -d -p 9980:9980 \
  -e "aliasgroup1=http://host.docker.internal:8000,http://127.0.0.1:8000,http://localhost:8000" \
  -e "extra_params=--o:ssl.enable=false --o:net.post_allow.host[0]=.*" \
  --name collabora \
  collabora/code
```

### Production (Docker Compose)

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, SECRET_KEY, REDIS_URL, domain settings

cd frontend && npm ci && npm run build && cd ..

mkdir -p data/uploads outputs temp_reports

docker compose up -d
docker compose exec backend alembic upgrade head
```

This starts: PostgreSQL, Redis, FastAPI backend, Celery worker, Collabora, OnlyOffice, Nginx.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis broker URL | `redis://localhost:6379` |
| `SECRET_KEY` | Session signing key | — |
| `HOST_DOMAIN` | Public domain name | `localhost` |
| `HOST_PORT` | Public port | `8000` |
| `COLLABORA_URL` | Collabora container URL | `http://127.0.0.1:9980` |
| `WOPI_BASE_URL` | URL Collabora uses to reach the backend | `http://host.docker.internal:8000` |
| `ONLYOFFICE_PUBLIC_URL` | OnlyOffice public endpoint | — |
| `ONLYOFFICE_INTERNAL_URL` | OnlyOffice internal endpoint | — |
| `ONLYOFFICE_JWT_SECRET` | OnlyOffice JWT secret | — |
| `PPH_BASE_URL` | Pre-press server base URL | — |
| `PPH_USERNAME` / `PPH_PASSWORD` | Pre-press server credentials | — |
| `AI_STRUCTURING_BASE_URL` | AI service URL (optional) | — |
| `AI_STRUCTURING_API_KEY` | AI service key (optional) | — |

See `.env.example` for the full list.

---

## API

FastAPI auto-generates interactive docs when the server is running:
- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

### API Versions

| Prefix | Description |
|---|---|
| `/api/v2` | Primary REST API (auth, projects, files, processing, admin) |
| `/api/v1` | Legacy API (users, projects, files, workflow) |

### Key Endpoints (v2)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v2/session/login` | Authenticate |
| `GET` | `/api/v2/dashboard` | User dashboard |
| `GET` | `/api/v2/projects` | List projects |
| `POST` | `/api/v2/files/upload` | Upload files |
| `POST` | `/api/v2/processing/start` | Start processing pipeline |
| `GET` | `/api/v2/admin/users` | Admin: manage users |

---

## Testing

Tests use **pytest** with an in-memory SQLite database.

```bash
pytest tests/                                      # all tests
pytest tests/test_api_v2_contracts.py -v           # single file
pytest tests/ -k "workflow" -v                     # filter by name
```

Key test files:
- `test_api_v2_contracts.py` — API contract tests
- `test_project_and_file_workflows.py` — end-to-end workflows
- `test_structuring_and_wopi.py` — document processing + WOPI
- `test_auth_regression.py` — authentication edge cases

---

## Database Migrations

Migrations are managed with Alembic.

```bash
# Apply all pending migrations
alembic upgrade head

# Create a new migration after changing models
alembic revision --autogenerate -m "description"

# Downgrade one step
alembic downgrade -1
```

> In development, `Base.metadata.create_all()` in `main.py` will also auto-create tables, but Alembic is preferred for tracking schema changes.

---

## Processing Pipeline

The DOCX pipeline runs through 11 steps managed by Celery workers:

1. Pre-processing cleanup
2. Style validation
3. Structuring analysis
4. Technical content extraction (math, formulas)
5. Reference parsing
6. DOCX → XHTML conversion
7. XML tagging (NLM)
8. Asset processing (figures, tables)
9. Review package generation
10. XHTML → DOCX round-trip
11. Output packaging

Customize structuring rules in `app/processing/structuring_lib/rules.yaml`.

---

## Troubleshooting

**Collabora "Refused to connect"**
- Verify the container is running: `docker ps`
- Check `COLLABORA_URL` matches the container port
- Ensure `--o:ssl.enable=false` is set for HTTP-only local dev

**File upload errors**
- Check write permissions on `data/uploads/`
- Confirm the file extension is in the allowed list

**Database locked (SQLite in dev)**
- SQLite struggles with concurrent requests. Use PostgreSQL for any load beyond single-user dev.

**Celery tasks not running**
- Verify Redis is reachable at `REDIS_URL`
- Check Celery worker logs: `docker compose logs celery`
