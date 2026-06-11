from app.core.paths import ensure_runtime_dirs
ensure_runtime_dirs()

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.domains.auth import api_v1 as users
from app.domains.files import api_v1 as files
from app.domains.projects import api_v1 as projects
from app.domains.clients import api_v1 as clients
from app.domains.workflow import api_v1 as workflow
from app.legacy import web as legacy_web
from app.routers import web as routers_web
from app.routers import api_v2
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title=settings.PROJECT_NAME)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# UI Router (Root) - Legacy SSR pages
app.include_router(legacy_web.router, tags=["Web UI"])

# API Routers
app.include_router(api_v2.router, prefix="/api/v2", tags=["API v2"])
app.include_router(users.router, prefix=f"{settings.API_V1_STR}/users", tags=["Users"])
app.include_router(projects.router, prefix=f"{settings.API_V1_STR}/projects", tags=["Projects"])
app.include_router(files.router, prefix=f"{settings.API_V1_STR}/files", tags=["Files"])
# Processing Router
from app.routers import processing
app.include_router(processing.router, prefix=f"{settings.API_V1_STR}/processing", tags=["Processing"])
# Structuring (Book Styler) Router
from app.routers import structuring
app.include_router(structuring.router, prefix=f"{settings.API_V1_STR}", tags=["Structuring"])
# WOPI Router (LibreOffice Online / Collabora)
from app.integrations.wopi import router as wopi
app.include_router(wopi.router, tags=["WOPI"])

# Workflow & Clients Routers (WMS Integration)
app.include_router(clients.router, tags=["Clients"])
app.include_router(workflow.router, tags=["Workflow"])

@app.get("/")
def read_root():
    return {"message": "Welcome to the Publishing CMS API"}

@app.on_event("startup")
def init_data():
    import os
    env = os.getenv("ENVIRONMENT", "development").lower()
    if env in ("production", "staging") and settings.SECRET_KEY in (
        "changeme_in_production_secret_key_12345",
        "dev-secret-key-please-change-in-production"
    ):
        raise ValueError("SECRET_KEY must be changed from the default value in production/staging environments!")

    from app.database import SessionLocal
    from app.domains.workflow.models import RolesMaster
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # Use advisory lock on PostgreSQL to serialize initialization across concurrent workers
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(424242);"))
            
        # Define all required roles in RolesMaster
        roles = [
            {"role_name": "admin", "team": "Admin Team", "description": "Full system access — all modules and settings"},
            {"role_name": "viewer", "team": "General", "description": "Read-only access across all permitted modules"},
            {"role_name": "manager", "team": "General", "description": "General management access"},
            {"role_name": "copyeditor", "team": "Copyediting Team", "description": "Language and style editing of manuscript content"}
        ]
        
        for r_data in roles:
            role = db.query(RolesMaster).filter(
                RolesMaster.role_name == r_data["role_name"],
                RolesMaster.team == r_data["team"]
            ).first()
            if not role:
                new_role = RolesMaster(
                    role_name=r_data["role_name"],
                    team=r_data["team"],
                    description=r_data["description"]
                )
                db.add(new_role)
                try:
                    db.commit()
                except Exception:
                    db.rollback()
    finally:
        db.close()
