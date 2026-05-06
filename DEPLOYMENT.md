# S4Carlisle CMS — On-Premise Deployment Guide

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|-----------------|-------|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose plugin | v2 | `docker compose version` |
| Node.js | 20 LTS | Only needed to build the frontend |
| npm | 10+ | Bundled with Node 20 |
| Git | any | To clone/pull the repository |
| Free disk | 10 GB+ | For images, uploads, backups |

The server must be reachable at a fixed IP or hostname (e.g. `10.1.1.18`).
Open ports: **8080** (HTTP, configurable via `HOST_PORT` in `.env`).

---

## First-Time Setup

### 1. Clone the repository

```bash
git clone <repo_url> /opt/cms
cd /opt/cms
```

### 2. Create environment files

```bash
cp .env.example .env
cp ai_structuring_backend/.env.example ai_structuring_backend/.env
cp frontend/.env.example frontend/.env   # only needed for local dev; skip for pure Docker
```

Edit `.env` — the minimum required changes:

```bash
# Set the server's public IP or hostname (shown in browser address bar)
HOST_DOMAIN=10.1.1.18        # change to your actual IP or hostname
HOST_PORT=8080               # change if you want a different HTTP port

# Generate and set a strong secret key
SECRET_KEY=$(openssl rand -hex 32)

# Set a strong database password
POSTGRES_PASSWORD=your_strong_password_here

# DATABASE_URL must match POSTGRES_PASSWORD above
DATABASE_URL=postgresql://cms_user:your_strong_password_here@db:5432/cms_db
```

Edit `ai_structuring_backend/.env` — set your AI API key if using the AI structuring service:

```bash
SECRET_KEY=$(openssl rand -hex 32)   # different from the main app key
GEMINI_API_KEY=your_gemini_api_key   # or ANTHROPIC_API_KEY / OPENAI_API_KEY
DATABASE_URL=postgresql://cms_user:your_strong_password_here@db:5432/cms_db
```

### 3. Create host directories

These directories must exist before Docker can mount them:

```bash
mkdir -p /opt/cms_runtime/data/uploads
mkdir -p /opt/cms/outputs
mkdir -p /opt/cms/data
mkdir -p /opt/cms/temp_reports
```

### 4. Build the React frontend

The nginx container serves the pre-built frontend from `frontend/dist/`.
Build it on the server before starting Docker:

```bash
cd /opt/cms/frontend
npm ci --prefer-offline
npm run build
cd /opt/cms
```

> **Why not build inside Docker?**
> The current architecture mounts the built `frontend/dist/` as a read-only volume into
> the nginx container. This avoids running a Node build inside Docker on every deploy.
> A `frontend/Dockerfile` is provided if you prefer a fully containerised build.

### 5. Pull and build Docker images

```bash
docker compose build --pull
```

### 6. Start all services

```bash
docker compose up -d
```

Check that all containers are running:

```bash
docker compose ps
```

Expected output — all services should show `Up` (or `healthy` for db/redis):

```
cms_db                  Up (healthy)
cms_redis               Up (healthy)
cms_backend             Up
cms_celery_worker       Up
cms_collabora           Up
cms_ai_structuring      Up (healthy)
cms_ai_structuring_worker Up
cms_nginx               Up
```

### 7. Run database migrations

On first start, and after every code update that includes model changes:

```bash
docker compose exec backend alembic upgrade head
```

### 8. Create the first admin user

The application seeds roles automatically on startup. To create the first admin user,
use the FastAPI interactive docs or run a one-liner inside the backend container:

```bash
# Option A — use the interactive API docs (after the stack is running)
# Browse to: http://<HOST_DOMAIN>:<HOST_PORT>/docs
# Use POST /api/v1/users/ to create a user, then assign the Admin role via
# POST /api/v1/users/{user_id}/roles

# Option B — run a Python script inside the container
docker compose exec backend python - <<'EOF'
from app.database import SessionLocal
from app import models
from app.domains.auth.service import hash_password

db = SessionLocal()
user = models.User(
    username="admin@example.com",
    email="admin@example.com",
    hashed_password=hash_password("change_me_on_first_login"),
    is_active=True,
)
db.add(user)
db.flush()

admin_role = db.query(models.Role).filter(models.Role.name == "Admin").first()
if admin_role:
    db.add(models.UserRole(user_id=user.id, role_id=admin_role.id))

db.commit()
print(f"Admin user created: {user.email}")
db.close()
EOF
```

The app will be available at: `http://<HOST_DOMAIN>:<HOST_PORT>/ui/login`

---

## Update Procedure

```bash
cd /opt/cms

# 1. Pull latest code
git pull

# 2. Rebuild frontend
cd frontend && npm ci --prefer-offline && npm run build && cd ..

# 3. Rebuild backend images (only if Python dependencies or Dockerfile changed)
docker compose build --pull backend celery_worker

# 4. Restart services with zero-downtime rolling restart
docker compose up -d --no-deps backend celery_worker nginx

# 5. Run any new migrations
docker compose exec backend alembic upgrade head
```

---

## Backup Procedure

### Database backup

```bash
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR=/var/backups/cms

mkdir -p $BACKUP_DIR

# Dump from the running container
docker compose exec -T db pg_dump \
    -U ${POSTGRES_USER:-cms_user} \
    ${POSTGRES_DB:-cms_db} \
    > "$BACKUP_DIR/db_$TIMESTAMP.sql"

echo "Database backed up to $BACKUP_DIR/db_$TIMESTAMP.sql"
```

### Uploads backup

```bash
tar -czf "$BACKUP_DIR/uploads_$TIMESTAMP.tar.gz" \
    /opt/cms_runtime/data/uploads

echo "Uploads backed up to $BACKUP_DIR/uploads_$TIMESTAMP.tar.gz"
```

### Retention (keep last 7 days)

```bash
find $BACKUP_DIR -type f -name "db_*.sql"            -mtime +7 -delete
find $BACKUP_DIR -type f -name "uploads_*.tar.gz"    -mtime +7 -delete
```

Add both blocks to `/etc/cron.daily/cms-backup` and `chmod +x` it.

The existing `deploy/backup.sh` script in the repository contains a similar
template adapted for a bare-metal install.

### Restore database

```bash
docker compose exec -T db psql \
    -U ${POSTGRES_USER:-cms_user} \
    ${POSTGRES_DB:-cms_db} \
    < /var/backups/cms/db_20260101_030000.sql
```

---

## Common Troubleshooting

### Frontend shows a blank page or 404 on page refresh

- Confirm `frontend/dist/` exists and contains `index.html`.
  If not: `cd frontend && npm run build && cd ..` then `docker compose restart nginx`.
- Verify the build was done in production mode: `frontend/dist/index.html` should
  reference assets starting with `/ui/assets/`, not `/assets/`.
  If assets start with `/assets/`, the build was run without the production mode flag.
  The `npm run build` script sets `NODE_ENV=production` automatically; no extra flag needed.

### Backend reports "could not connect to database"

- Check the `DATABASE_URL` in `.env` uses service name `db`, not `localhost`.
  Correct: `postgresql://cms_user:pass@db:5432/cms_db`
  Wrong:   `postgresql://cms_user:pass@localhost:5432/cms_db`
- Check the DB container is healthy: `docker compose ps db`

### Collabora editor shows "Refused to connect" or blank iframe

- Confirm `HOST_DOMAIN` in `.env` matches the IP/hostname your browser is using.
- Restart Collabora after any `.env` change: `docker compose restart collabora`
- Check Collabora logs: `docker compose logs collabora`

### Processing jobs stuck or not completing

- Check the Celery worker is running: `docker compose ps celery_worker`
- Check worker logs: `docker compose logs celery_worker`
- Verify Redis is healthy: `docker compose exec redis redis-cli ping` → should print `PONG`

### "Permission denied" on uploads directory

```bash
# The backend container runs as root by default; the host path must be writable.
sudo chmod 777 /opt/cms_runtime/data/uploads
# Or, better: chown to the Docker user (usually uid 0 in the container)
```

### View all logs

```bash
docker compose logs -f                    # all services
docker compose logs -f backend            # FastAPI only
docker compose logs -f nginx              # nginx only
docker compose logs -f ai_structuring     # AI service only
```

### Restart a single service

```bash
docker compose restart backend
docker compose restart nginx
```

### Full stack restart

```bash
docker compose down && docker compose up -d
```

---

## Service Port Reference

| Service | Internal port | Exposed to host |
|---------|--------------|-----------------|
| nginx (HTTP) | 80 | `HOST_PORT` (default 8080) |
| nginx (HTTPS) | 443 | 8443 |
| FastAPI backend | 8000 | internal only |
| PostgreSQL | 5432 | internal only |
| Redis | 6379 | internal only |
| Collabora | 9980 | 9980 |
| AI Structuring | 5000 | internal only |

Redis and the backend are not exposed to the host network. Only nginx, Collabora,
and the HTTPS port need to be reachable from outside the Docker network.

---

## Directory Layout (on the host)

```
/opt/cms/                      ← git repository root
├── .env                       ← secrets (not in git)
├── docker-compose.yml
├── Dockerfile                 ← backend image
├── nginx/nginx.conf
├── frontend/
│   ├── Dockerfile             ← frontend image (CI/standalone use)
│   ├── dist/                  ← built React app (run npm run build first)
│   └── src/
├── ai_structuring_backend/
│   ├── .env                   ← AI service secrets (not in git)
│   └── Dockerfile
├── app/                       ← FastAPI source
├── alembic/                   ← database migrations
├── deploy/                    ← systemd units, backup scripts, ACL setup
├── outputs/                   ← processing output files
├── data/                      ← app data files
└── temp_reports/              ← temporary processing reports

/opt/cms_runtime/data/uploads/ ← uploaded files (persisted outside repo)
/var/backups/cms/              ← database and upload backups
```
