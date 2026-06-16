#!/bin/bash
# CMS Backend Docker - Single Command Launcher (Bash)
# Usage: bash run-docker.sh  or  ./run-docker.sh
# For macOS and Linux users

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo -e "\n${CYAN}========================================"
    echo -e "$1"
    echo -e "========================================${NC}\n"
}

print_step() {
    echo -e "${YELLOW}[$1] $2${NC}"
}

print_success() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

print_error() {
    echo -e "${RED}  ✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}  ⚠ $1${NC}"
}

print_info() {
    echo -e "${CYAN}  $1${NC}"
}

# ============================================================================
# 1. Check Prerequisites
# ============================================================================

print_header "CMS Backend Docker Launcher"

print_step "1/5" "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
fi
DOCKER_VERSION=$(docker --version)
print_success "Docker installed: $DOCKER_VERSION"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose not found"
    exit 1
fi
COMPOSE_VERSION=$(docker-compose --version)
print_success "Docker Compose installed: $COMPOSE_VERSION"

# Check if Docker daemon is running
if ! docker ps > /dev/null 2>&1; then
    print_error "Docker daemon is not running. Start Docker Desktop."
    exit 1
fi
print_success "Docker daemon is running"

# ============================================================================
# 2. Create .env Files and Directories
# ============================================================================

print_step "2/5" "Setting up environment..."

if [ ! -f ".env" ]; then
    print_info "Creating .env file..."

    cat > .env << 'EOF'
DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db
POSTGRES_USER=cms_user
POSTGRES_PASSWORD=cms_password
POSTGRES_DB=cms_db
DEBUG=True
SECRET_KEY=dev-secret-key-please-change-in-production
ENVIRONMENT=development
COLLABORA_URL=http://127.0.0.1:9980
COLLABORA_PUBLIC_URL=http://127.0.0.1:9980
WOPI_BASE_URL=http://localhost:8000
REDIS_URL=redis://redis:6379
CMS_RUNTIME_ROOT=/opt/cms_runtime
UPLOAD_FOLDER=/opt/cms_runtime/data/uploads
PANDOC_PATH=/usr/bin/pandoc
LIBREOFFICE_PATH=/usr/bin/libreoffice
LOG_LEVEL=INFO
HOST_DOMAIN=localhost
HOST_PORT=8080

# PPH Remote Processing Integration
PPH_ENABLED=true
PPH_BASE_URL=http://10.1.1.69:8081
PPH_USERNAME=admin
PPH_PASSWORD=admin123
EOF

    print_success ".env file created"
else
    print_success ".env file already exists"
fi

# Create ai_structuring_backend directory and .env
mkdir -p ai_structuring_backend
if [ ! -f "ai_structuring_backend/.env" ]; then
    print_info "Creating ai_structuring_backend/.env file..."
    cat > ai_structuring_backend/.env << 'EOF'
REDIS_URL=redis://redis:6379/0
DATABASE_URL=postgresql://cms_user:cms_password@db:5432/cms_db
EOF
    print_success "ai_structuring_backend/.env created"
else
    print_success "ai_structuring_backend/.env already exists"
fiy

# Create required directories
print_info "Creating required directories..."
mkdir -p outputs data temp_reports frontend
print_success "Directories created"

# ============================================================================
# 3. Start Docker Services
# ============================================================================

print_step "3/5" "Starting Docker services..."
print_info "This may take 1-2 minutes on first run..."

if ! docker-compose up -d; then
    print_error "Failed to start services"
    exit 1
fi
print_success "Docker services started"

# Wait for services to be ready
print_info "Waiting for services to be ready..."
ATTEMPT=0
MAX_ATTEMPTS=30

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if docker-compose ps | grep -q "Up"; then
        if docker-compose ps | grep -q "postgres.*Up" && \
           docker-compose ps | grep -q "redis.*Up" && \
           docker-compose ps | grep -q "backend.*Up"; then
            print_success "All services are running"
            break
        fi
    fi

    ATTEMPT=$((ATTEMPT + 1))
    echo -e "    Waiting... ($ATTEMPT/$MAX_ATTEMPTS)"
    sleep 2
done

if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
    print_warning "Some services may still be starting up"
fi

# ============================================================================
# 4. Run Database Migrations
# ============================================================================

print_step "4/5" "Initializing database..."

if docker-compose exec -T backend alembic upgrade head > /dev/null 2>&1; then
    print_success "Database migrations completed"
else
    print_warning "Database migration message (this may be normal)"
    print_info "You can manually run: docker-compose exec backend alembic upgrade head"
fi

# ============================================================================
# 5. Display Service Information
# ============================================================================

print_step "5/5" "Service Status"

echo -e "\n${CYAN}$(docker-compose ps)${NC}"

# ============================================================================
# Success - Display Access Information
# ============================================================================

print_header "✓ CMS BACKEND IS RUNNING"

echo -e "${CYAN}Web Interface:${NC}"
echo -e "  http://localhost:8000"

echo -e "\n${CYAN}API Documentation:${NC}"
echo -e "  http://localhost:8000/docs (Swagger)"
echo -e "  http://localhost:8000/redoc (ReDoc)"

echo -e "\n${CYAN}Collabora Online:${NC}"
echo -e "  http://localhost:9980"

echo -e "\n${CYAN}Database:${NC}"
echo -e "  Host: localhost:5432"
echo -e "  User: cms_user"
echo -e "  Password: cms_password (from .env)"

echo -e "\n${CYAN}Useful Commands:${NC}"
echo -e "  View logs:              docker-compose logs -f"
echo -e "  Open shell:             docker-compose exec backend bash"
echo -e "  Database shell:         docker-compose exec postgres psql -U cms_user -d cms_db"
echo -e "  Stop services:          docker-compose stop"
echo -e "  Restart services:       docker-compose restart"
echo -e "  Full reset:             docker-compose down -v"

echo -e "\n${CYAN}Documentation:${NC}"
echo -e "  Setup guide:            DOCKER_SETUP.md"
echo -e "  Command reference:      DOCKER_COMMANDS.md"
echo -e "  Production guide:       DOCKER_PRODUCTION.md"

echo -e "\n${CYAN}=======================================${NC}\n"

# Optional: Open browser
read -p "Open http://localhost:8000 in browser? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open &> /dev/null; then
        open "http://localhost:8000"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:8000"
    else
        echo -e "${YELLOW}Please open http://localhost:8000 in your browser${NC}"
    fi
fi

echo -e "${YELLOW}To view logs in real-time:${NC}"
echo -e "  docker-compose logs -f\n"
