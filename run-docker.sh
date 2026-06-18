#!/usr/bin/env bash
# CMS Backend Docker - Single Command Launcher (Linux/macOS)
# Usage: bash run-docker.sh
#        chmod +x run-docker.sh && ./run-docker.sh

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; GRAY='\033[0;90m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
err()  { echo -e "  ${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }
info() { echo -e "  ${CYAN}→${RESET} $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $*"; }
step() { echo -e "\n${YELLOW}[$1] $2${RESET}"; }

echo -e "\n${CYAN}========================================"
echo -e "  CMS Backend Docker Launcher"
echo -e "========================================${RESET}\n"

# ─── Detect docker compose command ───────────────────────────────────────────
# Prefer plugin v2 ("docker compose") over legacy standalone v1 ("docker-compose")
if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
elif command -v docker-compose &>/dev/null; then
    DC="docker-compose"
else
    DC=""
fi

# ─── 1. Prerequisites ─────────────────────────────────────────────────────────
step "1/5" "Checking prerequisites..."

command -v docker &>/dev/null \
    || err "Docker not found. Install: https://docs.docker.com/engine/install/"
ok "Docker $(docker --version | head -1)"

[ -n "$DC" ] \
    || err "Docker Compose not found. Install plugin: sudo apt install docker-compose-plugin"
ok "Compose: $DC"

docker ps &>/dev/null \
    || err "Docker daemon is not running — try: sudo systemctl start docker"
ok "Docker daemon is running"

# ─── 2. Environment setup ─────────────────────────────────────────────────────
step "2/5" "Setting up environment..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        info "Creating .env from .env.example..."
        cp .env.example .env
        ok ".env created — review and set real secrets before first use"
    else
        info "Creating .env with production defaults..."
        cat > .env <<'ENVEOF'
# ─── PostgreSQL ───────────────────────────────────────────────────────────────
POSTGRES_USER=cms_user
POSTGRES_PASSWORD=cms_password
POSTGRES_DB=cms_db

DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db
SECRET_KEY=dev-secret-key-please-change-in-production
ENVIRONMENT=production
DEBUG=False
LOG_LEVEL=INFO

# ─── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ─── Server ───────────────────────────────────────────────────────────────────
HOST_DOMAIN=10.1.1.18
HOST_PORT=8085

# ─── Runtime paths ────────────────────────────────────────────────────────────
CMS_RUNTIME_ROOT=/opt/cms_runtime
UPLOAD_FOLDER=/opt/cms_runtime/data/uploads
PANDOC_PATH=/usr/bin/pandoc
LIBREOFFICE_PATH=/usr/bin/libreoffice

# ─── OnlyOffice ───────────────────────────────────────────────────────────────
ONLYOFFICE_PUBLIC_URL=http://10.1.1.18:8083
ONLYOFFICE_INTERNAL_URL=http://onlyoffice:80
ONLYOFFICE_JWT_SECRET=change_me_generate_with_openssl_rand_hex_32
ONLYOFFICE_JWT_ENABLED=true

# ─── Collabora ────────────────────────────────────────────────────────────────
COLLABORA_URL=http://collabora:9980
COLLABORA_PUBLIC_URL=http://10.1.1.18:8085
WOPI_BASE_URL=http://backend:8000

# ─── PPH ──────────────────────────────────────────────────────────────────────
PPH_ENABLED=true
PPH_BASE_URL=https://10.1.1.69
PPH_USERNAME=admin
PPH_PASSWORD=admin123
PPH_MAX_WAIT_SECONDS=1800

REF_SOURCE_STYLE=Auto
REF_TARGET_STYLE=APA
ENVEOF
        warn ".env created — update SECRET_KEY and ONLYOFFICE_JWT_SECRET before use"
        warn "Generate secrets with: openssl rand -hex 32"
    fi
else
    ok ".env already exists"
fi

# ai_structuring_backend/.env
mkdir -p ai_structuring_backend
if [ ! -f "ai_structuring_backend/.env" ]; then
    if [ -f "ai_structuring_backend/.env.example" ]; then
        info "Creating ai_structuring_backend/.env from example..."
        cp ai_structuring_backend/.env.example ai_structuring_backend/.env
        ok "ai_structuring_backend/.env created"
    else
        info "Creating ai_structuring_backend/.env with minimal defaults..."
        cat > ai_structuring_backend/.env <<'AIENVEOF'
REDIS_URL=redis://redis:6379/0
DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db
AIENVEOF
        ok "ai_structuring_backend/.env created"
    fi
else
    ok "ai_structuring_backend/.env already exists"
fi

# Runtime directories
info "Creating runtime directories..."
mkdir -p outputs data temp_reports frontend
ok "Directories ready"

# ─── 3. React frontend ────────────────────────────────────────────────────────
step "3/5" "Building React frontend..."

if [ -f "frontend/package.json" ]; then
    pushd frontend > /dev/null

    if [ -d "node_modules" ]; then
        info "Found existing node_modules — attempting direct build..."
        if npm run build > /dev/null 2>&1; then
            ok "Frontend built (using cached dependencies)"
        else
            warn "Direct build failed — cleaning and retrying..."
            rm -rf node_modules package-lock.json
            npm install > /dev/null 2>&1 || err "npm install failed — run 'cd frontend && npm install' to see errors"
            npm run build > /dev/null 2>&1  || err "Frontend build failed — run 'cd frontend && npm run build' to see errors"
            ok "Frontend built successfully"
        fi
    else
        info "Installing frontend dependencies..."
        npm install > /dev/null 2>&1 || err "npm install failed — run 'cd frontend && npm install' to see errors"
        info "Building production bundle..."
        npm run build > /dev/null 2>&1 || err "Frontend build failed — run 'cd frontend && npm run build' to see errors"
        ok "Frontend built successfully"
    fi

    popd > /dev/null
else
    warn "No frontend/package.json found — skipping frontend build"
fi

# ─── 4. Docker services ───────────────────────────────────────────────────────
step "4/5" "Starting Docker services..."
info "This may take 1-2 minutes on first run (pulling images, building)..."

$DC up -d --build || err "Failed to start Docker services — run '$DC logs' to diagnose"
ok "Docker services started"

info "Waiting for services to be healthy..."
attempt=0
while [ $attempt -lt 30 ]; do
    if $DC ps | grep -qE "Up|running|healthy"; then
        ok "Services are up"
        break
    fi
    attempt=$((attempt + 1))
    echo -e "    ${GRAY}Waiting... ($attempt/30)${RESET}"
    sleep 2
done
if [ $attempt -ge 30 ]; then
    warn "Some services may still be starting — check with: $DC ps"
fi

# ─── 5. Database migrations ───────────────────────────────────────────────────
step "5/5" "Initialising database..."

# Give the backend a moment to finish startup before running migrations
sleep 3

if $DC exec -T backend alembic upgrade head 2>/dev/null; then
    ok "Database migrations completed"
else
    warn "Migration step returned non-zero — may already be up to date"
    info "Run manually if needed: $DC exec backend alembic upgrade head"
fi

# ─── Status & summary ─────────────────────────────────────────────────────────
echo ""
$DC ps
echo ""

# Read actual values from .env
HOST_DOMAIN=$(grep -m1 '^HOST_DOMAIN=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "10.1.1.18")
HOST_PORT=$(grep -m1 '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo "8085")

echo -e "${GREEN}========================================"
echo -e "  SUCCESS: CMS BACKEND IS RUNNING"
echo -e "========================================${RESET}\n"

echo -e "${CYAN}Access the application:${RESET}"
echo -e "  Web Interface : http://${HOST_DOMAIN}:${HOST_PORT}"
echo -e "  API Docs      : http://${HOST_DOMAIN}:${HOST_PORT}/api/docs"
echo -e "  OnlyOffice    : http://${HOST_DOMAIN}:8083"
echo -e "  Collabora     : http://${HOST_DOMAIN}:9980"
echo ""

echo -e "${CYAN}Database (from host):${RESET}"
echo -e "  Host     : 127.0.0.1:5433"
echo -e "  User     : $(grep -m1 '^POSTGRES_USER=' .env | cut -d= -f2)"
echo -e "  DB       : $(grep -m1 '^POSTGRES_DB=' .env | cut -d= -f2)"
echo ""

echo -e "${CYAN}Useful commands:${RESET}"
echo -e "  ${GRAY}Stream logs       : $DC logs -f${RESET}"
echo -e "  ${GRAY}Backend shell     : $DC exec backend bash${RESET}"
echo -e "  ${GRAY}DB shell          : $DC exec db psql -U cms_user -d cms_db${RESET}"
echo -e "  ${GRAY}Stop services     : $DC stop${RESET}"
echo -e "  ${GRAY}Restart           : $DC restart${RESET}"
echo -e "  ${GRAY}Rebuild & restart : $DC up -d --build${RESET}"
echo -e "  ${GRAY}Full reset        : $DC down -v${RESET}"
echo ""

# Open browser on Linux
if command -v xdg-open &>/dev/null; then
    read -rp "Open http://${HOST_DOMAIN}:${HOST_PORT} in browser? (y/n) " open_browser || true
    if [[ "${open_browser,,}" == "y" ]]; then
        xdg-open "http://${HOST_DOMAIN}:${HOST_PORT}" &
        info "Opening browser..."
    fi
fi

echo -e "${YELLOW}To stream logs: $DC logs -f${RESET}\n"
