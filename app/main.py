from app.core.paths import ensure_runtime_dirs
ensure_runtime_dirs()

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.domains.auth import api_v1 as users
from app.domains.files import api_v1 as files
from app.domains.projects import api_v1 as projects
from app.domains.projects import teams_api_v1 as teams
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
app.include_router(teams.router, prefix=f"{settings.API_V1_STR}/teams", tags=["Teams"])
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
    from app import models
    db = SessionLocal()
    try:
        # Define all required roles
        roles = [
            {"name": "Viewer", "description": "Read-only access"},
            {"name": "Editor", "description": "General editing access"},
            {"name": "ProjectManager", "description": "Can manage projects"},
            {"name": "Admin", "description": "Full access"},
            {"name": "Tagger", "description": "Responsible for XML/content tagging"},
            {"name": "CopyEditor", "description": "Reviews and edits manuscripts"},
            {"name": "GraphicDesigner", "description": "Manages art and visual assets"},
            {"name": "Typesetter", "description": "Formats layout for publication"},
            {"name": "QCPerson", "description": "Quality control assurance"},
            {"name": "PPD", "description": "Pre-press and production"},
            {"name": "PermissionsManager", "description": "Manages rights and permissions"}
        ]
        
        for r_data in roles:
            role = db.query(models.Role).filter(models.Role.name == r_data["name"]).first()
            if not role:
                new_role = models.Role(name=r_data["name"], description=r_data["description"])
                db.add(new_role)
        
        db.commit()
    finally:
        db.close()
