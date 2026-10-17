import os
import json
import shutil
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.database import get_db
from app.domains.clients.models import Client
from app.domains.workflow.models import StageMaster, StageTransitionConfig
from app.domains.notifications.email_service import send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/settings/stage-transitions", tags=["Stage Transition Settings"])

CONFIG_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "config", "stage_transition")
)
os.makedirs(CONFIG_DIR, exist_ok=True)

# ── Available Variables & Placeholders ────────────────────────────────────────

AVAILABLE_VARIABLES = [
    {
        "key": "{chapter_name}",
        "label": "Chapter Number",
        "description": "Chapter number or identifier (e.g., 01, FM, BM)",
        "sample": "01",
        "category": "Chapter"
    },
    {
        "key": "{chapter_title}",
        "label": "Chapter Title",
        "description": "Full chapter title from manuscript",
        "sample": "Introduction to Digital Signal Processing",
        "category": "Chapter"
    },
    {
        "key": "{current_stage}",
        "label": "Current Stage",
        "description": "The stage that was just completed",
        "sample": "Manuscript Analysis",
        "category": "Workflow"
    },
    {
        "key": "{next_stage}",
        "label": "Next Stage",
        "description": "The destination stage moving into",
        "sample": "Pre-editing",
        "category": "Workflow"
    },
    {
        "key": "{project_code}",
        "label": "Project Code",
        "description": "The master project or book identifier code",
        "sample": "PRJ-2026-901",
        "category": "Project"
    },
    {
        "key": "{client_name}",
        "label": "Client Name",
        "description": "Name of the publishing client / imprint",
        "sample": "Cambridge University Press",
        "category": "Project"
    },
    {
        "key": "{author_email}",
        "label": "Author Email",
        "description": "Primary author or corresponding researcher email",
        "sample": "lead_author@university.edu",
        "category": "Contacts"
    },
    {
        "key": "{client_email}",
        "label": "Client Contact Email",
        "description": "Primary publisher contact email",
        "sample": "client-desk@publisher.org",
        "category": "Contacts"
    },
    {
        "key": "{languageediting_team_email}",
        "label": "Language Editing Team",
        "description": "Designated Language Editing department email",
        "sample": "languageediting_team@example.com",
        "category": "Teams"
    },
    {
        "key": "{pre_editing_team_email}",
        "label": "Pre-editing Team",
        "description": "Designated Pre-editing department email",
        "sample": "pre_editing_team@example.com",
        "category": "Teams"
    },
    {
        "key": "{next_stage_team_email}",
        "label": "Next Stage Team Email",
        "description": "Dynamic team address computed from next stage name",
        "sample": "pre_editing_team@example.com",
        "category": "Teams"
    },
]


# ── Schemas ───────────────────────────────────────────────────────────────────

class StageEmailConfig(BaseModel):
    enabled: bool = True
    custom_message: Optional[str] = ""
    to: List[str] = Field(default_factory=list)
    cc: List[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""


class AddStagePayload(BaseModel):
    stage_name: str
    add_to_system_master: bool = False
    custom_message: Optional[str] = None
    to: Optional[List[str]] = None
    cc: Optional[List[str]] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    enabled: bool = True


class CustomerTransitionConfigUpdate(BaseModel):
    stages: Dict[str, StageEmailConfig]


class TestEmailRequest(BaseModel):
    to_email: str
    subject: str
    body: str
    client_code: Optional[str] = None
    stage_name: Optional[str] = None


class CustomerSummary(BaseModel):
    client_code: str
    client_name: str
    is_custom: bool
    has_file: bool
    is_in_db: bool = False
    stages_count: int
    last_modified: Optional[str] = None


class StageInfo(BaseModel):
    stage_name: str
    description: Optional[str] = None


class CustomerConfigResponse(BaseModel):
    client_code: str
    client_name: str
    is_custom: bool
    is_in_db: bool = False
    stages: Dict[str, StageEmailConfig]
    all_system_stages: List[StageInfo]


# ── Database & Seed Helpers ───────────────────────────────────────────────────

def _sanitize_code(code: str) -> str:
    cleaned = code.strip()
    if not cleaned or ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=400, detail="Invalid client code identifier")
    return cleaned


def _get_file_path(client_code: str) -> str:
    safe_code = _sanitize_code(client_code)
    return os.path.join(CONFIG_DIR, f"{safe_code}.json")


def _read_json_file(file_path: str) -> dict:
    if not os.path.exists(file_path):
        return {}
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading JSON from {file_path}: {e}")
        return {}


def _get_raw_config_for_client(db: Session, safe_code: str) -> tuple[Dict[str, Any], bool, bool]:
    """
    Returns (stages_data, is_custom, is_in_db).
    1. Checks PostgreSQL first.
    2. If not found in DB, falls back to disk JSON files as seed.
    """
    # 1. Check DB for client
    try:
        db_rec = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == safe_code).first()
        if db_rec and db_rec.stages_config:
            clean = {k: v for k, v in db_rec.stages_config.items() if not k.startswith("_")}
            return clean, (safe_code != "default"), True
    except Exception as e:
        logger.warning(f"Error querying StageTransitionConfig for {safe_code}: {e}")

    # 2. Check disk for custom file (seed / legacy)
    if safe_code != "default":
        custom_path = _get_file_path(safe_code)
        if os.path.exists(custom_path):
            raw = _read_json_file(custom_path)
            if raw:
                clean = {k: v for k, v in raw.items() if not k.startswith("_")}
                return clean, True, False

    # 3. Fallback to default in DB
    if safe_code != "default":
        try:
            db_default = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == "default").first()
            if db_default and db_default.stages_config:
                clean = {k: v for k, v in db_default.stages_config.items() if not k.startswith("_")}
                return clean, False, True
        except Exception:
            pass

    # 4. Fallback to default.json on disk
    default_path = _get_file_path("default")
    default_raw = _read_json_file(default_path)
    clean = {k: v for k, v in default_raw.items() if not k.startswith("_")}
    return clean, False, False


def _save_raw_config_to_db(db: Session, safe_code: str, stages_dict: Dict[str, Any]):
    """Save or update transition configuration directly in PostgreSQL."""
    db_rec = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == safe_code).first()
    if db_rec:
        db_rec.stages_config = stages_dict
        db_rec.updated_at = datetime.utcnow()
    else:
        db_rec = StageTransitionConfig(
            client_code=safe_code,
            stages_config=stages_dict
        )
        db.add(db_rec)
    db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/variables", response_model=List[dict])
def get_template_variables():
    """Return all available template placeholders and documentation."""
    return AVAILABLE_VARIABLES


@router.post("/sync-all-to-db")
def sync_all_json_to_db(db: Session = Depends(get_db)):
    """
    Read all JSON files from app/config/stage_transition/*.json and save them directly into
    the PostgreSQL stage_transition_configs table.
    """
    if not os.path.exists(CONFIG_DIR):
        raise HTTPException(status_code=404, detail="Config directory not found.")

    synced_clients = []
    for fname in sorted(os.listdir(CONFIG_DIR)):
        if fname.endswith(".json") and not fname.endswith(".bak") and not fname.endswith(".tmp"):
            code = fname[:-5]
            fpath = os.path.join(CONFIG_DIR, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
                clean_stages = {k: v for k, v in raw_data.items() if not k.startswith("_")}

                db_rec = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == code).first()
                if db_rec:
                    db_rec.stages_config = clean_stages
                    db_rec.updated_at = datetime.utcnow()
                else:
                    db_rec = StageTransitionConfig(
                        client_code=code,
                        stages_config=clean_stages
                    )
                    db.add(db_rec)
                synced_clients.append(code)
            except Exception as e:
                logger.error(f"Error syncing {fname} to DB: {e}")

    db.commit()
    return {
        "success": True,
        "message": f"Successfully synced {len(synced_clients)} customer configurations into PostgreSQL database.",
        "synced_clients": synced_clients
    }


@router.get("", response_model=List[CustomerSummary])
@router.get("/customers", response_model=List[CustomerSummary])
def list_transition_customers(db: Session = Depends(get_db)):
    """
    List all customers from PostgreSQL and disk configs.
    Includes default template and indicators for whether customer has custom overrides.
    """
    # 1. Fetch DB clients
    db_clients = []
    try:
        db_clients = db.query(Client).order_by(Client.company.asc()).all()
    except Exception as e:
        logger.warning(f"Could not fetch DB clients: {e}")

    client_map = {}
    for c in db_clients:
        code = (c.division or "").strip()
        name = (c.company or c.name_company or code).strip()
        if code:
            client_map[code] = name

    # 2. Inspect DB configs
    db_configs: Dict[str, dict] = {}
    try:
        all_db_cfgs = db.query(StageTransitionConfig).all()
        for cfg in all_db_cfgs:
            mtime_str = cfg.updated_at.strftime("%Y-%m-%d %H:%M") if cfg.updated_at else None
            stg_cnt = len([k for k in cfg.stages_config.keys() if not k.startswith("_")]) if cfg.stages_config else 0
            db_configs[cfg.client_code] = {"mtime": mtime_str, "stages_count": stg_cnt}
    except Exception as e:
        logger.warning(f"Could not fetch StageTransitionConfig from DB: {e}")

    # 3. Inspect disk configs (seed / fallback files)
    disk_files = {}
    if os.path.exists(CONFIG_DIR):
        for fname in os.listdir(CONFIG_DIR):
            if fname.endswith(".json") and not fname.endswith(".bak") and not fname.endswith(".tmp"):
                code = fname[:-5]
                fpath = os.path.join(CONFIG_DIR, fname)
                mtime = os.path.getmtime(fpath)
                mtime_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        cfg_data = json.load(f)
                    stages_cnt = len([k for k in cfg_data.keys() if not k.startswith("_")])
                except Exception:
                    stages_cnt = 0
                disk_files[code] = {"mtime": mtime_str, "stages_count": stages_cnt}

    default_info = db_configs.get("default") or disk_files.get("default", {"mtime": None, "stages_count": 0})

    results: List[CustomerSummary] = []

    # Always put "default" at index 0
    results.append(
        CustomerSummary(
            client_code="default",
            client_name="Default Template (Global Fallback)",
            is_custom=False,
            has_file=True,
            is_in_db="default" in db_configs,
            stages_count=default_info["stages_count"],
            last_modified=default_info["mtime"]
        )
    )

    seen_codes = {"default"}

    # Add DB clients
    for code, name in sorted(client_map.items(), key=lambda x: x[1].lower()):
        seen_codes.add(code)
        has_custom = (code in db_configs) or (code in disk_files)
        is_in_db = code in db_configs
        if code in db_configs:
            stages_cnt = db_configs[code]["stages_count"]
            mtime = db_configs[code]["mtime"]
        elif code in disk_files:
            stages_cnt = disk_files[code]["stages_count"]
            mtime = disk_files[code]["mtime"]
        else:
            stages_cnt = default_info["stages_count"]
            mtime = None

        results.append(
            CustomerSummary(
                client_code=code,
                client_name=name,
                is_custom=has_custom,
                has_file=has_custom,
                is_in_db=is_in_db,
                stages_count=stages_cnt,
                last_modified=mtime
            )
        )

    # Add disk/db codes not matching any DB client (historical / custom codes)
    all_extra = set(disk_files.keys()).union(set(db_configs.keys()))
    for code in sorted(all_extra, key=lambda x: x.lower()):
        if code not in seen_codes:
            info = db_configs.get(code) or disk_files.get(code, {"stages_count": 0, "mtime": None})
            results.append(
                CustomerSummary(
                    client_code=code,
                    client_name=f"{code} (Custom)",
                    is_custom=True,
                    has_file=True,
                    is_in_db=code in db_configs,
                    stages_count=info["stages_count"],
                    last_modified=info["mtime"]
                )
            )

    return results


@router.get("/{client_code}", response_model=CustomerConfigResponse)
def get_customer_transition_config(client_code: str, db: Session = Depends(get_db)):
    """
    Get stage transition notification settings for a specific client (or 'default').
    Reads from PostgreSQL first; if not found, falls back to disk seed.
    """
    safe_code = _sanitize_code(client_code)

    # Get system stages
    all_stages: List[StageInfo] = []
    try:
        system_stages = (
            db.query(StageMaster)
            .filter(StageMaster.active_status == True)
            .order_by(StageMaster.id.asc())
            .all()
        )
        all_stages = [
            StageInfo(stage_name=s.stage_name, description=s.description)
            for s in system_stages
        ]
    except Exception as e:
        logger.warning(f"Could not fetch StageMaster from DB: {e}")

    # Fallback to stages from disk default if DB stages unavailable
    if not all_stages:
        default_path = _get_file_path("default")
        default_data = _read_json_file(default_path)
        all_stages = [
            StageInfo(stage_name=k)
            for k in default_data.keys()
            if not k.startswith("_")
        ]

    # Resolve customer name
    client_name = "Default Template"
    if safe_code != "default":
        try:
            client_obj = db.query(Client).filter(Client.division == safe_code).first()
            if client_obj:
                client_name = client_obj.company or client_obj.name_company or safe_code
            else:
                client_name = safe_code
        except Exception:
            client_name = safe_code

    stages_data, is_custom, is_in_db = _get_raw_config_for_client(db, safe_code)

    parsed_stages: Dict[str, StageEmailConfig] = {}
    for stage_name, cfg in stages_data.items():
        if isinstance(cfg, dict):
            parsed_stages[stage_name] = StageEmailConfig(
                enabled=cfg.get("enabled", True),
                custom_message=cfg.get("custom_message", ""),
                to=cfg.get("to") if isinstance(cfg.get("to"), list) else [],
                cc=cfg.get("cc") if isinstance(cfg.get("cc"), list) else [],
                subject=cfg.get("subject", ""),
                body=cfg.get("body", "")
            )

    return CustomerConfigResponse(
        client_code=safe_code,
        client_name=client_name,
        is_custom=is_custom,
        is_in_db=is_in_db,
        stages=parsed_stages,
        all_system_stages=all_stages
    )


@router.put("/{client_code}")
def save_customer_transition_config(
    client_code: str,
    payload: CustomerTransitionConfigUpdate,
    db: Session = Depends(get_db)
):
    """
    Save or update notification settings for a customer or the default template.
    Persists directly into PostgreSQL (stage_transition_configs table).
    """
    safe_code = _sanitize_code(client_code)
    stages_dict: Dict[str, Any] = {}

    for stage_name, stage_cfg in payload.stages.items():
        stages_dict[stage_name] = {
            "enabled": stage_cfg.enabled,
            "custom_message": stage_cfg.custom_message or "",
            "to": [t.strip() for t in stage_cfg.to if t and t.strip()],
            "cc": [c.strip() for c in stage_cfg.cc if c and c.strip()],
            "subject": stage_cfg.subject or "",
            "body": stage_cfg.body or ""
        }

    _save_raw_config_to_db(db, safe_code, stages_dict)

    return {
        "success": True,
        "message": f"Settings for '{safe_code}' saved successfully in database.",
        "client_code": safe_code,
        "is_custom": safe_code != "default"
    }


@router.post("/{client_code}/stages")
def add_stage_to_config(
    client_code: str,
    payload: AddStagePayload,
    db: Session = Depends(get_db)
):
    """
    Add a new stage template to a customer's configuration or default template.
    Optionally registers the stage in StageMaster if requested.
    Persists into PostgreSQL.
    """
    safe_code = _sanitize_code(client_code)
    stage_name = payload.stage_name.strip()
    if not stage_name:
        raise HTTPException(status_code=400, detail="Stage name cannot be empty.")

    # 1. Optionally register in StageMaster table
    if payload.add_to_system_master:
        try:
            existing_sm = db.query(StageMaster).filter(StageMaster.stage_name == stage_name).first()
            if not existing_sm:
                new_sm = StageMaster(
                    stage_name=stage_name,
                    description=f"Workflow stage for {stage_name}",
                    roles=[],
                    processing_actions=[],
                    active_status=True
                )
                db.add(new_sm)
                db.commit()
                logger.info(f"Registered new stage in StageMaster: {stage_name}")
        except Exception as e:
            logger.warning(f"Could not register {stage_name} in StageMaster: {e}")
            db.rollback()

    # 2. Load existing config (from DB or seed fallback)
    existing, _, _ = _get_raw_config_for_client(db, safe_code)

    default_template = {
        "enabled": payload.enabled,
        "custom_message": payload.custom_message or "The {current_stage} stage has been completed. The chapter has been moved to the {next_stage} stage.",
        "to": [t.strip() for t in (payload.to or ["{next_stage_team_email}"]) if t and t.strip()],
        "cc": [c.strip() for c in (payload.cc or []) if c and c.strip()],
        "subject": payload.subject or "[{client_name}] {project_code} - Chapter {chapter_name} | {current_stage} → {next_stage} | Stage Transition Notification",
        "body": payload.body or "Hi Team,\n\nThe {current_stage} stage has been completed for Chapter {chapter_name}.\n\nThe chapter has been moved to the {next_stage} stage and is now ready for processing.\n\nRegards,\n{current_stage} Team\n\nNote : This is an automated mail and please do not reply."
    }

    existing[stage_name] = default_template
    _save_raw_config_to_db(db, safe_code, existing)

    return {
        "success": True,
        "message": f"Stage '{stage_name}' added to {safe_code} transition settings.",
        "stage_name": stage_name,
        "stage_config": default_template
    }


@router.delete("/{client_code}/stages/{stage_name}")
def delete_stage_from_config(
    client_code: str,
    stage_name: str,
    disable_only: bool = False,
    db: Session = Depends(get_db)
):
    """
    Remove or disable an email notification configuration for a specific stage.
    Persists directly into PostgreSQL.
    """
    safe_code = _sanitize_code(client_code)
    existing, _, _ = _get_raw_config_for_client(db, safe_code)

    if stage_name not in existing:
        raise HTTPException(
            status_code=404,
            detail=f"Stage '{stage_name}' was not found in '{safe_code}' configuration."
        )

    if disable_only:
        if isinstance(existing[stage_name], dict):
            existing[stage_name]["enabled"] = False
        message = f"Email notifications for stage '{stage_name}' have been disabled."
    else:
        del existing[stage_name]
        message = f"Stage '{stage_name}' was removed from '{safe_code}' configuration."

    _save_raw_config_to_db(db, safe_code, existing)

    return {
        "success": True,
        "message": message,
        "stage_name": stage_name,
        "disabled": disable_only
    }


@router.post("/{client_code}/initialize")
def initialize_from_default(client_code: str, db: Session = Depends(get_db)):
    """
    Explicitly clone the default template to create a customer-specific override in PostgreSQL.
    """
    safe_code = _sanitize_code(client_code)
    if safe_code == "default":
        raise HTTPException(status_code=400, detail="Cannot initialize default from default.")

    default_stages, _, _ = _get_raw_config_for_client(db, "default")
    _save_raw_config_to_db(db, safe_code, default_stages)

    return {
        "success": True,
        "message": f"Initialized custom configuration for '{safe_code}' from default template in database.",
        "client_code": safe_code
    }


@router.delete("/{client_code}")
def delete_customer_config(client_code: str, db: Session = Depends(get_db)):
    """
    Delete a customer-specific custom configuration from PostgreSQL.
    The customer will seamlessly revert to using the default template.
    """
    safe_code = _sanitize_code(client_code)
    if safe_code == "default":
        raise HTTPException(status_code=400, detail="Cannot delete the default template.")

    deleted = False

    # 1. Delete from DB
    try:
        db_rec = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == safe_code).first()
        if db_rec:
            db.delete(db_rec)
            db.commit()
            deleted = True
    except Exception as e:
        logger.error(f"Error deleting config from DB for {safe_code}: {e}")
        db.rollback()

    # 2. Check disk file and archive if exists
    file_path = _get_file_path(safe_code)
    bak_path = f"{file_path}.bak"
    if os.path.exists(file_path):
        try:
            shutil.copy2(file_path, bak_path)
            os.remove(file_path)
            deleted = True
        except Exception as e:
            logger.error(f"Error removing disk file {file_path}: {e}")

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"No custom configuration found for '{safe_code}'."
        )

    return {
        "success": True,
        "message": f"Custom configuration for '{safe_code}' removed. System will now use default template.",
        "client_code": safe_code
    }


@router.post("/send-test")
def send_test_notification(req: TestEmailRequest):
    """
    Send a test email using the currently configured subject and body templates.
    """
    if not req.to_email or "@" not in req.to_email:
        raise HTTPException(status_code=400, detail="A valid recipient email address is required.")

    sample_mapping = {var["key"]: var["sample"] for var in AVAILABLE_VARIABLES}
    rendered_subject = req.subject
    rendered_body = req.body

    for placeholder, sample_val in sample_mapping.items():
        rendered_subject = rendered_subject.replace(placeholder, sample_val)
        rendered_body = rendered_body.replace(placeholder, sample_val)

    final_subject = f"[TEST] {rendered_subject}" if not rendered_subject.startswith("[TEST]") else rendered_subject

    try:
        send_email(
            to_email=req.to_email,
            subject=final_subject,
            text_body=rendered_body
        )
        return {
            "success": True,
            "message": f"Test email sent to {req.to_email}.",
            "rendered_subject": final_subject,
            "rendered_body": rendered_body
        }
    except Exception as e:
        logger.error(f"Failed to send test email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")
