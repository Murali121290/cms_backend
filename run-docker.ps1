# CMS Backend Docker - Single Command Launcher (PowerShell)
# Usage: .\run-docker.ps1
# For Windows users with PowerShell
# Note: On first run, you may need to run:
#       Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

$ErrorActionPreference = "Stop"

# Check execution policy
if ((Get-ExecutionPolicy) -eq "Restricted") {
    Write-Host "PowerShell execution policy is restricted." -ForegroundColor Yellow
    Write-Host "Run this command first: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor Cyan
    exit 1
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CMS Backend Docker Launcher" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# 1. Check Prerequisites
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow

# Check Docker
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: Docker not found. Install Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Docker installed" -ForegroundColor Green

# Check Docker Compose
if (!(Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: Docker Compose not found" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Docker Compose installed" -ForegroundColor Green

# Check Docker daemon
try {
    docker ps > $null 2>&1
    Write-Host "  OK: Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Docker daemon is not running. Start Docker Desktop." -ForegroundColor Red
    exit 1
}

# 2. Create .env Files
Write-Host "`n[2/5] Setting up environment..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "  Creating root .env file..." -ForegroundColor Cyan

    $envContent = @"
DATABASE_URL=postgresql://cms_user:cms_password@postgres:5432/cms_db
POSTGRES_USER=cms_user
POSTGRES_PASSWORD=cms_password
POSTGRES_DB=cms_db
DEBUG=True
SECRET_KEY=dev-secret-key-please-change-in-production
ENVIRONMENT=development
COLLABORA_URL=http://127.0.0.1:9980
COLLABORA_PUBLIC_URL=http://127.0.0.1:9980
WOPI_BASE_URL=http://host.docker.internal:8000
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
"@

    $envContent | Out-File -FilePath ".env" -Encoding UTF8
    Write-Host "  OK: .env file created" -ForegroundColor Green
} else {
    Write-Host "  OK: .env file already exists" -ForegroundColor Green
}

# Create ai_structuring_backend/.env if needed
if (-not (Test-Path "ai_structuring_backend")) {
    Write-Host "  Creating ai_structuring_backend directory..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path "ai_structuring_backend" -Force | Out-Null
}

if (-not (Test-Path "ai_structuring_backend/.env")) {
    Write-Host "  Creating ai_structuring_backend/.env file..." -ForegroundColor Cyan

    $aiEnvContent = @"
REDIS_URL=redis://redis:6379/0
DATABASE_URL=postgresql://cms_user:cms_password@postgres:5432/cms_db
"@

    $aiEnvContent | Out-File -FilePath "ai_structuring_backend/.env" -Encoding UTF8
    Write-Host "  OK: ai_structuring_backend/.env created" -ForegroundColor Green
} else {
    Write-Host "  OK: ai_structuring_backend/.env already exists" -ForegroundColor Green
}

# Create required directories
Write-Host "  Creating required directories..." -ForegroundColor Cyan
@("outputs", "data", "temp_reports", "frontend") | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}
Write-Host "  OK: Directories created" -ForegroundColor Green

# 3. Build React Frontend
Write-Host "`n[3/5] Building React frontend..." -ForegroundColor Yellow

if (Test-Path "frontend/package.json") {
    Push-Location frontend

    # Temporarily set ErrorActionPreference to Continue so that stderr writes or non-zero exits
    # in native commands don't trigger PowerShell terminating exceptions. We will handle exit codes manually.
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
        $shouldInstall = $true
        if (Test-Path "node_modules") {
            Write-Host "  Found existing node_modules. Attempting direct build..." -ForegroundColor Cyan
            npm run build 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  OK: Frontend built successfully (using existing dependencies)" -ForegroundColor Green
                $shouldInstall = $false
            } else {
                Write-Host "  WARN: Direct build failed. Cleaning node_modules..." -ForegroundColor Yellow
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "node_modules" | Out-Null
                Remove-Item -Force -ErrorAction SilentlyContinue "package-lock.json" | Out-Null
                $shouldInstall = $true
            }
        }

        if ($shouldInstall) {
            Write-Host "  Installing frontend dependencies..." -ForegroundColor Cyan
            npm install 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  ERROR: npm install failed. Check npm logs." -ForegroundColor Red
                exit 1
            }
            Write-Host "  Building production bundle..." -ForegroundColor Cyan
            npm run build 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  ERROR: Frontend build failed. Check frontend errors above." -ForegroundColor Red
                exit 1
            }
            Write-Host "  OK: Frontend built successfully" -ForegroundColor Green
        }
    } finally {
        $ErrorActionPreference = $oldErrorAction
        Pop-Location
    }
} else {
    Write-Host "  SKIP: No frontend/package.json found" -ForegroundColor Yellow
}

# 4. Start Docker Services
Write-Host "`n[4/5] Starting Docker services..." -ForegroundColor Yellow
Write-Host "  This may take 1-2 minutes on first run..." -ForegroundColor Cyan

docker-compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Failed to start services" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Docker services started" -ForegroundColor Green

# Wait for services
Write-Host "  Waiting for services to be ready..." -ForegroundColor Cyan
$attempt = 0
while ($attempt -lt 30) {
    $status = docker-compose ps | Select-String "Up"
    if ($status) {
        Write-Host "  OK: Services are running" -ForegroundColor Green
        break
    }
    $attempt++
    Write-Host "    Waiting... ($attempt/30)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}

# 5. Run Migrations
Write-Host "`n[5/5] Initializing database..." -ForegroundColor Yellow

try {
    docker-compose exec -T backend alembic upgrade head 2>&1 | Out-Null
    Write-Host "  OK: Database migrations completed" -ForegroundColor Green
} catch {
    Write-Host "  INFO: Database migration (may be normal)" -ForegroundColor Yellow
}

# 6. Show Status
Write-Host "`n[6/6] Service Status" -ForegroundColor Yellow
Write-Host ""
docker-compose ps
Write-Host ""

# Success Message
Write-Host "========================================" -ForegroundColor Green
Write-Host "SUCCESS: CMS BACKEND IS RUNNING" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Access the application:" -ForegroundColor Cyan
Write-Host "  Web Interface: http://localhost:8080" -ForegroundColor White
Write-Host "  API Docs:      http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Collabora: http://localhost:9980" -ForegroundColor White
Write-Host ""

Write-Host "Database Connection:" -ForegroundColor Cyan
Write-Host "  Host: localhost:5432" -ForegroundColor White
Write-Host "  User: cms_user" -ForegroundColor White
Write-Host "  Password: cms_password (see .env)" -ForegroundColor White
Write-Host ""

Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  View logs: docker-compose logs -f" -ForegroundColor DarkGray
Write-Host "  Open shell: docker-compose exec backend bash" -ForegroundColor DarkGray
Write-Host "  Stop services: docker-compose stop" -ForegroundColor DarkGray
Write-Host "  Restart: docker-compose restart" -ForegroundColor DarkGray
Write-Host ""

$openBrowser = Read-Host "Open http://localhost:8085 in browser? (y/n)"
if ($openBrowser -eq "y" -or $openBrowser -eq "Y") {
    Start-Process "http://localhost:8085"
    Write-Host "Opening browser..." -ForegroundColor Cyan
}

Write-Host "To view logs: docker-compose logs -f" -ForegroundColor Yellow
Write-Host ""
