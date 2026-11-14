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
        "key": "{chapter_table}",
        "label": "Chapter Transition Table",
        "description": "Structured table: Chapter | Stage (Current → Next) | Due Date | Shipment Notes",
        "sample": "{chapter_table}",
        "category": "Layout"
    },
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
        "sample": "Wolters Kluwer Health",
        "category": "Project"
    },
    {
        "key": "{customer_name}",
        "label": "Customer Name",
        "description": "Alias for Client Name / Publishing Imprint",
        "sample": "Wolters Kluwer Health",
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
    {
        "key": "{next_stage_owner_emails}",
        "label": "Next Stage Owner and Group Mail",
        "description": "Dynamic destination combining Next Stage Lead and Team Group Mail ID",
        "sample": "sarah.jenkins@example.com, preediting-team@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{next_stage_owner_email}",
        "label": "Next Stage Owner Email",
        "description": "Designated individual lead email for next stage",
        "sample": "sarah.jenkins@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{next_stage_group_email}",
        "label": "Next Stage Group Mail ID",
        "description": "Shared mailbox / DL for next stage department",
        "sample": "preediting-team@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{stage_owner_emails}",
        "label": "Current Stage Owner and Group Mail",
        "description": "Current Stage Lead and Team Group Mail ID combined",
        "sample": "david.ross@example.com, analysis-team@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{stage_owner_email}",
        "label": "Current Stage Owner Email",
        "description": "Designated individual lead email for completed stage",
        "sample": "david.ross@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{stage_group_email}",
        "label": "Current Stage Group Mail ID",
        "description": "Shared mailbox / DL for completed stage department",
        "sample": "analysis-team@example.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{stage_owner_name}",
        "label": "Current Stage Owner Name",
        "description": "Full name of the completed stage lead",
        "sample": "David Ross",
        "category": "Ownership and Routing"
    },
    {
        "key": "{next_stage_owner_name}",
        "label": "Next Stage Owner Name",
        "description": "Full name of the destination stage lead",
        "sample": "Sarah Jenkins",
        "category": "Ownership and Routing"
    },
    {
        "key": "{project_manager_email}",
        "label": "Project Manager Email",
        "description": "Assigned Project Manager email from project record",
        "sample": "pm.editorial@example.com",
        "category": "Project"
    },
    {
        "key": "{project_manager_name}",
        "label": "Project Manager Name",
        "description": "Assigned Project Manager full display name",
        "sample": "John Smith",
        "category": "Project"
    },
    {
        "key": "{stage_transition}",
        "label": "Stage Transition Flow",
        "description": "Current stage to next stage flow (e.g. Pre-editing → XML)",
        "sample": "Pre-editing → XML",
        "category": "Workflow"
    },
    {
        "key": "{due_date}",
        "label": "Due Date",
        "description": "Chapter target completion or delivery due date",
        "sample": "04-Nov-2026",
        "category": "Chapter"
    },
    {
        "key": "{shipment_notes}",
        "label": "Shipment Notes",
        "description": "Transition shipment remarks or dispatch instructions",
        "sample": "Batch 01 priority ingest",
        "category": "Chapter"
    },
    {
        "key": "{chapter_table}",
        "label": "Chapter Transition Table",
        "description": "Multi-chapter table listing Chapter, Stage (Current → Next), Due Date, and Notes",
        "sample": "| Chapter | Stage | Due Date | Shipment Notes |",
        "category": "Chapter"
    },
    {
        "key": "{project_info_table}",
        "label": "Project Info Table",
        "description": "Project metadata table (Code, Client, Title, Composition, Due Date, Pages, etc.)",
        "sample": "{project_info_table}",
        "category": "Layout"
    },
    {
        "key": "{planning_schedule_table}",
        "label": "Planning Schedule Table",
        "description": "Stages schedule table with Start Date, Due Date, SLA, and Stage Owner",
        "sample": "{planning_schedule_table}",
        "category": "Layout"
    },
    {
        "key": "{workflow_stage_owners}",
        "label": "All Workflow Stage Owners",
        "description": "Comma-separated email addresses of all stage owners in the selected workflow",
        "sample": "le_lead@s4carlisle.com, pre_lead@s4carlisle.com",
        "category": "Ownership and Routing"
    },
    {
        "key": "{project_title}",
        "label": "Project Title",
        "description": "Full title of the project / book",
        "sample": "Digital Consumer Behavior",
        "category": "Project"
    },
    {
        "key": "{workflow_name}",
        "label": "Workflow Name",
        "description": "Name of the workflow template assigned to the project",
        "sample": "WF-01 Fresh Book",
        "category": "Workflow"
    },
    {
        "key": "{composition}",
        "label": "Composition Complexity",
        "description": "Complexity level (Low, Medium, High)",
        "sample": "Medium",
        "category": "Project"
    },
    {
        "key": "{priority}",
        "label": "Project Priority",
        "description": "Priority level (e.g. Normal, High, Urgent)",
        "sample": "Normal",
        "category": "Project"
    },
    {
        "key": "{approval_type}",
        "label": "Approval Type",
        "description": "Approved or Re-approved status label",
        "sample": "Approved",
        "category": "Workflow"
    },
    {
        "key": "{adjustment_reason}",
        "label": "Adjustment Reason",
        "description": "Reason provided when re-approving a project plan",
        "sample": "Author requested revised schedule",
        "category": "Workflow"
    },
]


# ── Schemas ───────────────────────────────────────────────────────────────────

class StageEmailConfig(BaseModel):
    enabled: bool = True
    stage_owner_username: Optional[str] = None
    stage_owner_first_name: Optional[str] = None
    stage_owner_email: Optional[str] = None
    stage_group_email: Optional[str] = None
    stage_owner_mode: Optional[str] = "both"
    custom_message: Optional[str] = ""
    to: List[str] = Field(default_factory=list)
    cc: List[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""


class AddStagePayload(BaseModel):
    stage_name: str
    add_to_system_master: bool = False
    stage_owner_username: Optional[str] = None
    stage_owner_email: Optional[str] = None
    stage_group_email: Optional[str] = None
    stage_owner_mode: Optional[str] = "both"
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
    from sqlalchemy.orm.attributes import flag_modified
    db_rec = db.query(StageTransitionConfig).filter(StageTransitionConfig.client_code == safe_code).first()
    if db_rec:
        db_rec.stages_config = dict(stages_dict)
        flag_modified(db_rec, "stages_config")
        db_rec.updated_at = datetime.utcnow()
    else:
        db_rec = StageTransitionConfig(
            client_code=safe_code,
            stages_config=dict(stages_dict)
        )
        db.add(db_rec)
    db.commit()
    db.refresh(db_rec)


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
                    db_rec.stages_config = dict(clean_stages)
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(db_rec, "stages_config")
                    db_rec.updated_at = datetime.utcnow()
                else:
                    db_rec = StageTransitionConfig(
                        client_code=code,
                        stages_config=dict(clean_stages)
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

    user_fn_map = {}
    user_email_map = {}
    try:
        from app.domains.auth.models import User
        users_list = db.query(User).all()
        for u in users_list:
            display_first = (u.first_name or "").strip() or (u.last_name or "").strip()
            if display_first and not display_first.isdigit():
                if u.username:
                    user_fn_map[str(u.username).strip()] = display_first
                if u.email:
                    user_fn_map[str(u.email).strip().lower()] = display_first
            if u.email:
                if u.username:
                    user_email_map[str(u.username).strip()] = u.email.strip()
    except Exception as e:
        logger.warning(f"Could not build user map: {e}")

    parsed_stages: Dict[str, StageEmailConfig] = {}
    for stage_name, cfg in stages_data.items():
        if isinstance(cfg, dict):
            u_name = cfg.get("stage_owner_username")
            u_email = cfg.get("stage_owner_email")
            
            resolved_fn = None
            if u_name and str(u_name).strip() in user_fn_map:
                resolved_fn = user_fn_map[str(u_name).strip()]
            elif u_email and str(u_email).strip().lower() in user_fn_map:
                resolved_fn = user_fn_map[str(u_email).strip().lower()]

            stored_fn = cfg.get("stage_owner_first_name")
            if not resolved_fn and stored_fn and not str(stored_fn).strip().isdigit():
                resolved_fn = str(stored_fn).strip()

            resolved_email = (user_email_map.get(str(u_name).strip()) if (u_name and str(u_name).strip() in user_email_map) else u_email)

            from app.routers.api_v2 import _normalize_transition_subject, _normalize_transition_body_template
            stage_subject = _normalize_transition_subject(cfg.get("subject", ""))
            stage_body = _normalize_transition_body_template(cfg.get("body", ""))

            import re
            stage_body = re.sub(r'\+[-+]+\+[\s\S]*?\+[-+]+\+[\s\S]*?\+[-+]+\+', '{chapter_table}', stage_body)
            stage_body = re.sub(r'\|[^\n\r]*\|[\r\n\s]*\+[-+]+\+', '', stage_body)
            if "{chapter_table}" not in stage_body:
                if "Regards," in stage_body:
                    parts = stage_body.split("Regards,")
                    stage_body = parts[0].rstrip() + "\n\n{chapter_table}\n\nRegards," + parts[1]
                else:
                    stage_body = stage_body.rstrip() + "\n\n{chapter_table}"

            parsed_stages[stage_name] = StageEmailConfig(
                enabled=cfg.get("enabled", True),
                stage_owner_username=u_name,
                stage_owner_first_name=resolved_fn,
                stage_owner_email=resolved_email,
                stage_group_email=cfg.get("stage_group_email"),
                stage_owner_mode=cfg.get("stage_owner_mode", "both"),
                custom_message=cfg.get("custom_message", ""),
                to=cfg.get("to") if isinstance(cfg.get("to"), list) else [],
                cc=cfg.get("cc") if isinstance(cfg.get("cc"), list) else [],
                subject=stage_subject,
                body=stage_body
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

    user_fn_map = {}
    user_email_map = {}
    try:
        from app.domains.auth.models import User
        users_list = db.query(User).all()
        for u in users_list:
            display_first = (u.first_name or "").strip() or (u.last_name or "").strip()
            if display_first and not display_first.isdigit():
                if u.username:
                    user_fn_map[str(u.username).strip()] = display_first
                if u.email:
                    user_fn_map[str(u.email).strip().lower()] = display_first
            if u.email:
                if u.username:
                    user_email_map[str(u.username).strip()] = u.email.strip()
    except Exception:
        user_fn_map = {}
        user_email_map = {}

    for stage_name, stage_cfg in payload.stages.items():
        u_name = str(stage_cfg.stage_owner_username).strip() if stage_cfg.stage_owner_username else None

        resolved_fn = stage_cfg.stage_owner_first_name
        if u_name and u_name in user_fn_map:
            resolved_fn = user_fn_map[u_name]
        elif not resolved_fn or str(resolved_fn).strip().isdigit():
            u_ident = stage_cfg.stage_owner_username or stage_cfg.stage_owner_email
            if u_ident and str(u_ident).strip() in user_fn_map:
                resolved_fn = user_fn_map[str(u_ident).strip()]

        resolved_email = stage_cfg.stage_owner_email
        if u_name and u_name in user_email_map:
            resolved_email = user_email_map[u_name]

        from app.routers.api_v2 import _normalize_transition_subject, _normalize_transition_body_template
        normalized_subject = _normalize_transition_subject(stage_cfg.subject or "")
        body_text = _normalize_transition_body_template(stage_cfg.body or "")
        import re
        body_text = re.sub(r'\+[-+]+\+[\s\S]*?\+[-+]+\+[\s\S]*?\+[-+]+\+', '{chapter_table}', body_text)
        body_text = re.sub(r'\|[^\n\r]*\|[\r\n\s]*\+[-+]+\+', '', body_text)
        if "{chapter_table}" not in body_text:
            if "Regards," in body_text:
                parts = body_text.split("Regards,")
                body_text = parts[0].rstrip() + "\n\n{chapter_table}\n\nRegards," + parts[1]
            else:
                body_text = body_text.rstrip() + "\n\n{chapter_table}"

        stages_dict[stage_name] = {
            "enabled": stage_cfg.enabled,
            "stage_owner_username": u_name,
            "stage_owner_first_name": resolved_fn or None,
            "stage_owner_email": resolved_email or None,
            "stage_group_email": stage_cfg.stage_group_email or None,
            "stage_owner_mode": stage_cfg.stage_owner_mode or "both",
            "custom_message": stage_cfg.custom_message or "",
            "to": [t.strip() for t in stage_cfg.to if t and t.strip()],
            "cc": [c.strip() for c in stage_cfg.cc if c and c.strip()],
            "subject": normalized_subject,
            "body": body_text
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
        "stage_owner_username": payload.stage_owner_username or None,
        "stage_owner_first_name": payload.stage_owner_first_name or None,
        "stage_owner_email": payload.stage_owner_email or None,
        "stage_group_email": payload.stage_group_email or None,
        "stage_owner_mode": payload.stage_owner_mode or "both",
        "custom_message": payload.custom_message or "The {current_stage} stage has been completed. The chapter has been moved to the {next_stage} stage.",
        "to": [t.strip() for t in (payload.to or ["{next_stage_owner_emails}"]) if t and t.strip()],
        "cc": [c.strip() for c in (payload.cc or ["{project_manager_email}", "{stage_owner_emails}"]) if c and c.strip()],
        "subject": payload.subject or "{client_name}-- {project_code} - {stage_transition} | Stage Transition Notification",
        "body": payload.body or "Hi,\n\nBelow Files are Completed {current_stage} for your review and processing.\n\nClient Name: {client_name}\n\nProject Name: {project_code}\n\n{chapter_table}\n\nRegards,\nS4C Ninja Inkflow Team\n\nNote : This is an automated mail and please do not reply."
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

    sample_rows = [{
        "chapter": "01",
        "stage": f"{req.stage_name or 'Manuscript Analysis'} → Editorial Assessment",
        "due_date": datetime.now().strftime("%d-%b-%Y"),
        "notes": "—"
    }]
    from app.routers.api_v2 import _prepare_transition_email_content
    plain_body, html_body = _prepare_transition_email_content(
        body_template=rendered_body,
        chapter_rows=sample_rows
    )

    try:
        send_email(
            to_email=req.to_email,
            subject=final_subject,
            text_body=plain_body,
            html_body=html_body
        )
        return {
            "success": True,
            "message": f"Test email sent to {req.to_email}.",
            "rendered_subject": final_subject,
            "rendered_body": plain_body
        }
    except Exception as e:
        logger.error(f"Failed to send test email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")
