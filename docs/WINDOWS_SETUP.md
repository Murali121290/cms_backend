# CMS Backend - Windows Setup Guide

Complete guide to setting up and running the S4Carlisle CMS Backend project on Windows.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start (Docker)](#quick-start-docker)
4. [Local Development Setup](#local-development-setup)
5. [Individual Service Setup](#individual-service-setup)
6. [Configuration](#configuration)
7. [Troubleshooting](#troubleshooting)

---

## Project Overview

This is a multi-service Content Management System (CMS) with the following components:

| Service | Technology | Port | Purpose |
|---------|-----------|------|---------|
| **Backend** | FastAPI (Python) | 8000 | Main API & web server |
| **Frontend** | React + Vite (Node.js) | 5173 | User interface |
| **AI Structuring** | Flask (Python) | 5000 | Document structuring engine |
| **Database** | PostgreSQL | 5433* | Data storage |
| **Cache/Queue** | Redis | 6379 | Caching & task queue (Celery) |
| **Editor** | Collabora Online | 9980 | In-browser document editing |
| **Reverse Proxy** | Nginx | 8080/8443 | Traffic routing |

*Port 5433 is used to avoid conflicts with local PostgreSQL installations.

---

## Prerequisites

### Required Software

Install these on your Windows machine:

1. **Python 3.10+**
   - Download from [python.org](https://www.python.org/downloads/)
   - ✅ Check "Add Python to PATH" during installation
   - Verify: Open PowerShell and run `python --version`

2. **Node.js 18+**
   - Download from [nodejs.org](https://nodejs.org/)
   - Includes npm (Node Package Manager)
   - Verify: `node --version` and `npm --version`

3. **Git**
   - Download from [git-scm.com](https://git-scm.com/download/win)
   - Verify: `git --version`

4. **Docker Desktop** (for containerized services)
   - Download from [docker.com](https://www.docker.com/products/docker-desktop)
   - Enable WSL 2 backend
   - Verify: `docker --version` and `docker run hello-world`

5. **PostgreSQL** (optional for local development)
   - Download from [postgresql.org](https://www.postgresql.org/download/windows/)
   - OR use Docker container (recommended)

### Recommended Tools

- **Visual Studio Code** - Code editor
- **DBeaver** - Database GUI client
- **Postman** - API testing tool
- **Windows Terminal** - Better terminal experience

---

## Quick Start (Docker)

### Fastest way to run everything

1. **Clone & navigate to project:**
   ```powershell
   cd C:\Users\YourUsername\PycharmProjects\cms_backend
   ```

2. **Copy environment files:**
   ```powershell
   Copy-Item .env.example .env
   Copy-Item ai_structuring_backend\.env.example ai_structuring_backend\.env
   ```

3. **Edit .env with your values:**
   ```powershell
   notepad .env
   ```
   Key values to update:
   - `POSTGRES_PASSWORD` - Strong password
   - `SECRET_KEY` - Generate with: `python -c "import secrets; print(secrets.token_hex(32))"`
   - `HOST_DOMAIN` - Your Windows IP (e.g., `localhost` or `192.168.1.100`)

4. **Build frontend (required before running):**
   ```powershell
   cd frontend
   npm ci
   npm run build
   cd ..
   ```

5. **Start all services:**
   ```powershell
   docker compose up -d
   ```

6. **Access the application:**
   - UI: `http://localhost:8080/ui/`
   - API Docs: `http://localhost:8080/api/docs`

7. **View logs:**
   ```powershell
   docker compose logs -f backend
   docker compose logs -f frontend
   docker compose logs -f ai_structuring
   ```

8. **Stop services:**
   ```powershell
   docker compose down
   ```

### Database Migrations (First Time Only)

```powershell
docker compose exec backend alembic upgrade head
```

---

## Local Development Setup

### Full setup for developing without Docker

Useful when you need to debug or modify code frequently.

### 1. Backend Setup

#### 1.1 Create Virtual Environment
```powershell
# Navigate to project
cd C:\Users\YourUsername\PycharmProjects\cms_backend

# Create virtual environment
python -m venv .venv

# Activate it
.\.venv\Scripts\Activate

# You should see (.venv) in your prompt
```

#### 1.2 Install Dependencies
```powershell
# Upgrade pip
python -m pip install --upgrade pip

# Install requirements
pip install -r requirements.txt
```

#### 1.3 Database Setup

**Option A: Docker PostgreSQL (Recommended)**
```powershell
docker run -d `
  --name cms_db `
  -e POSTGRES_USER=cms_user `
  -e POSTGRES_PASSWORD=cms_password `
  -e POSTGRES_DB=cms_db `
  -p 5433:5432 `
  postgres:15
```

**Option B: Local PostgreSQL Installation**
- Install from [postgresql.org](https://www.postgresql.org/download/windows/)
- Create database:
  ```powershell
  # In PostgreSQL console or pgAdmin
  CREATE DATABASE cms_db;
  CREATE USER cms_user WITH PASSWORD 'cms_password';
  GRANT ALL PRIVILEGES ON DATABASE cms_db TO cms_user;
  ```

#### 1.4 Environment Setup
```powershell
# Copy example env file
Copy-Item .env.example .env

# Edit .env
notepad .env
```

**Set these for local development:**
```env
DATABASE_URL=postgresql://cms_user:cms_password@127.0.0.1:5433/cms_db
REDIS_URL=redis://127.0.0.1:6379/0
SECRET_KEY=your-secret-key-here-min-32-chars
```

#### 1.5 Run Migrations
```powershell
# From project root
alembic upgrade head
```

#### 1.6 Start Backend Server
```powershell
# Terminal 1 - Backend (with hot reload)
python -m uvicorn app.main:app --reload --port 8000

# Or production mode
gunicorn -w 4 -b 0.0.0.0:8000 app.main:app
```

Access backend at: `http://127.0.0.1:8000`

---

### 2. Frontend Setup

#### 2.1 Install Dependencies
```powershell
cd frontend
npm ci  # Clean install from package-lock.json
```

#### 2.2 Development Server
```powershell
# Terminal 2 - Frontend dev server (with hot reload)
npm run dev

# Runs on http://127.0.0.1:5173
```

#### 2.3 Build for Production
```powershell
npm run build

# Creates optimized build in frontend/dist/
```

---

### 3. Redis Setup

#### 3.1 Docker Redis (Recommended)
```powershell
docker run -d `
  --name cms_redis `
  -p 6379:6379 `
  redis:7-alpine
```

#### 3.2 Local Redis (Windows)
- Download from [microsoftarchive/redis](https://github.com/microsoftarchive/redis/releases)
- Or use WSL2 with Linux Redis:
  ```powershell
  wsl
  sudo apt-get update && sudo apt-get install redis-server
  redis-server
  ```

---

### 4. Celery Worker Setup

#### 4.1 Start Worker
```powershell
# Terminal 3 - Celery worker
celery -A app.core.celery_app worker --loglevel=info

# For Windows (with eventlet)
pip install eventlet
celery -A app.core.celery_app worker --pool=solo --loglevel=info
```

---

### 5. AI Structuring Service

#### 5.1 Navigate to AI Structuring
```powershell
cd ai_structuring_backend
```

#### 5.2 Create Virtual Environment
```powershell
python -m venv .venv
.\.venv\Scripts\Activate
```

#### 5.3 Install Dependencies
```powershell
pip install -r requirements.txt
```

#### 5.4 Environment Setup
```powershell
Copy-Item .env.example .env
notepad .env
```

#### 5.5 Run Service
```powershell
# Terminal 4 - AI Structuring Service
python app.py

# Or with Gunicorn (production)
gunicorn -w 2 -b 0.0.0.0:5000 app:app
```

Access at: `http://127.0.0.1:5000`

---

### 6. Collabora Online Setup

#### 6.1 Run Docker Container
```powershell
docker run -t -d `
  -p 9980:9980 `
  -e "aliasgroup1=http://host.docker.internal:8000,http://127.0.0.1:8000,http://localhost:8000" `
  -e "extra_params=--o:ssl.enable=false --o:net.post_allow.host[0]=.*" `
  --name collabora `
  collabora/code
```

Access at: `https://127.0.0.1:9980`

**Note:** Self-signed certificate warning is normal. Click "Advanced" → "Proceed anyway"

---

## Individual Service Setup

### Running Services Individually

#### Backend Only
```powershell
.\.venv\Scripts\Activate
python -m uvicorn app.main:app --reload --port 8000
```

#### Frontend Only
```powershell
cd frontend
npm run dev
```

#### Redis Only
```powershell
docker run -p 6379:6379 redis:7-alpine
```

#### PostgreSQL Only
```powershell
docker run -p 5433:5432 `
  -e POSTGRES_USER=cms_user `
  -e POSTGRES_PASSWORD=cms_password `
  -e POSTGRES_DB=cms_db `
  postgres:15
```

#### Collabora Only
```powershell
docker run -p 9980:9980 `
  -e "extra_params=--o:ssl.enable=false" `
  collabora/code
```

---

## Configuration

### Environment Variables

All configuration is managed via `.env` file. Key variables:

**Database:**
```env
DATABASE_URL=postgresql://cms_user:password@localhost:5433/cms_db
POSTGRES_USER=cms_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=cms_db
```

**Application:**
```env
SECRET_KEY=your-secret-key-min-32-chars
DEBUG=false
LOG_LEVEL=info
```

**Redis & Celery:**
```env
REDIS_URL=redis://127.0.0.1:6379/0
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
```

**Server:**
```env
HOST_DOMAIN=localhost
HOST_PORT=8080
COLLABORA_URL=http://127.0.0.1:9980
```

**AI Services:**
```env
AI_STRUCTURING_BASE_URL=http://127.0.0.1:5000
AI_STRUCTURING_API_KEY=
PPH_ENABLED=false
```

---

## Troubleshooting

### Port Already in Use

**Problem:** "Address already in use" error

**Solution:**
```powershell
# Find process using port
netstat -ano | findstr :8000

# Kill process (replace PID with actual number)
taskkill /PID <PID> /F

# Or use a different port
python -m uvicorn app.main:app --reload --port 8001
```

### Database Connection Failed

**Problem:** `psycopg2.OperationalError: could not connect to server`

**Solution:**
```powershell
# Check if PostgreSQL is running
docker ps | findstr postgres

# Restart database
docker restart cms_db

# Verify connection
psql -h 127.0.0.1 -p 5433 -U cms_user -d cms_db
```

### Redis Connection Error

**Problem:** `ConnectionError: Error 111 connecting to 127.0.0.1:6379`

**Solution:**
```powershell
# Check if Redis is running
docker ps | findstr redis

# Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Test connection
redis-cli ping
```

### Frontend Won't Build

**Problem:** `npm run build` fails

**Solution:**
```powershell
# Clean and reinstall
cd frontend
rm -r node_modules package-lock.json
npm ci
npm run build

# Check for TypeScript errors
npm run typecheck
```

### Collabora "Refused to Connect"

**Problem:** Collabora editor doesn't load in browser

**Solution:**
```powershell
# Verify Collabora is running
docker ps | findstr collabora

# Check logs
docker logs collabora

# Restart with correct aliases
docker restart collabora

# Try accessing directly
Start-Process "https://127.0.0.1:9980"
```

### Migration Errors

**Problem:** `alembic upgrade head` fails

**Solution:**
```powershell
# Check current migration version
alembic current

# Check migration history
alembic history

# Downgrade and retry
alembic downgrade -1
alembic upgrade head
```

### Module Not Found Errors

**Problem:** `ModuleNotFoundError: No module named 'app'`

**Solution:**
```powershell
# Ensure you're in project root
cd C:\Users\YourUsername\PycharmProjects\cms_backend

# Verify virtual environment is active
.\.venv\Scripts\Activate

# Reinstall requirements
pip install -r requirements.txt
```

### Celery Worker Not Processing Tasks

**Problem:** Tasks stuck in queue

**Solution:**
```powershell
# Check Celery worker is running
celery -A app.core.celery_app inspect active

# Clear queue
celery -A app.core.celery_app purge

# Restart worker
# Kill current worker and restart
celery -A app.core.celery_app worker --loglevel=info --pool=solo
```

---

## Development Workflow

### Common Tasks

#### Create New Database Migration
```powershell
# From project root
alembic revision --autogenerate -m "Description of change"
alembic upgrade head
```

#### Install New Package
```powershell
# Activate virtual environment
.\.venv\Scripts\Activate

# Install package
pip install package_name

# Add to requirements.txt
pip freeze > requirements.txt
```

#### Run Tests
```powershell
# Backend tests
pytest tests/

# Frontend tests
cd frontend
npm run test
```

#### View Database
```powershell
# Connect to PostgreSQL
psql -h 127.0.0.1 -p 5433 -U cms_user -d cms_db

# Or use Docker
docker exec -it cms_db psql -U cms_user -d cms_db
```

#### Check Service Health
```powershell
# Backend health
curl http://127.0.0.1:8000/health

# Frontend health
curl http://127.0.0.1:5173

# AI Structuring health
curl http://127.0.0.1:5000/health

# Redis health
redis-cli ping
```

---

## Production Deployment

For production deployment, refer to the main README.md and consider:

1. Use PostgreSQL (not SQLite)
2. Use managed Redis service
3. Configure HTTPS/SSL
4. Use strong SECRET_KEY
5. Set DEBUG=false
6. Use production WSGI server (gunicorn)
7. Configure log aggregation
8. Set up monitoring and alerts

---

## Quick Reference

### Start Everything (Docker)
```powershell
docker compose up -d
```

### Start Everything (Local Development)
```powershell
# Terminal 1: Backend
.\.venv\Scripts\Activate
python -m uvicorn app.main:app --reload

# Terminal 2: Frontend
cd frontend && npm run dev

# Terminal 3: Celery Worker
celery -A app.core.celery_app worker --pool=solo

# Terminal 4: Redis
docker run -p 6379:6379 redis:7-alpine

# Terminal 5: PostgreSQL
docker run -p 5433:5432 -e POSTGRES_USER=cms_user -e POSTGRES_PASSWORD=cms_password postgres:15

# Terminal 6: Collabora
docker run -p 9980:9980 -e "extra_params=--o:ssl.enable=false" collabora/code

# Terminal 7: AI Structuring
cd ai_structuring_backend && .\.venv\Scripts\Activate && python app.py
```

### Useful Commands

```powershell
# View all running containers
docker ps

# View all images
docker images

# View logs
docker compose logs -f backend

# Stop all containers
docker compose down

# Remove all containers and volumes
docker compose down -v

# Rebuild containers
docker compose build

# Database console
psql -h 127.0.0.1 -p 5433 -U cms_user -d cms_db

# Redis console
redis-cli

# Test API
curl http://127.0.0.1:8000/api/docs
```

---

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section above
2. Review logs: `docker compose logs service_name`
3. Check environment variables: Verify `.env` file is correctly configured
4. Review original README.md for architecture details

---

## Additional Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Documentation](https://docs.docker.com/)
- [Celery Documentation](https://docs.celeryproject.io/)
- [Collabora Online Documentation](https://sdk.collaboraonline.com/)

---

**Last Updated:** May 2026
**Platform:** Windows 11 Pro / Windows 10+
**Python Version:** 3.10+
**Node.js Version:** 18+