from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel

class StatusPayload(BaseModel):
    active_status: bool

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.workflow import crud
from app.domains.workflow.models import StageDetail, StageMaster
from app.domains.workflow.schemas import (
    RolesMasterCreate, RolesMasterResponse, RolesMasterUpdate,
    StageMasterCreate, StageMasterResponse, StageMasterUpdate,
    ProcessingActionDefinition, ProcessingActionsMappingUpdate,
    StageDetailCreate, StageDetailResponse, StageDetailUpdate, BulkPlannedCreate,
    WorkflowCreate, WorkflowStageResponse, WorkflowUpdate,
    ChapterInfoCreate, ChapterInfoResponse, ChapterInfoUpdate
)

AVAILABLE_PROCESSING_ACTIONS = [
    {
        "key": "structuring",
        "label": "Structuring",
        "description": "Generate structured document tags, styling, and XML markers",
        "icon": "Layers"
    },
    {
        "key": "structuringQa",
        "label": "Run QA Report",
        "description": "Run automated style and structuring QA report",
        "icon": "ShieldCheck"
    },
    {
        "key": "referenceValidation",
        "label": "Reference Validation",
        "description": "Validate citations and references against CrossRef and PubMed APIs",
        "icon": "BookCheck"
    },
    {
        "key": "referenceReview",
        "label": "Reference Review",
        "description": "Review and edit bibliography references in the Reference Editor",
        "icon": "BookCheck"
    },
    {
        "key": "styleValidation",
        "label": "Style Validation & Match",
        "description": "Validate and match manuscript styling against publisher templates",
        "icon": "ShieldCheck"
    },
    {
        "key": "artValidation",
        "label": "Art Validation",
        "description": "Inspect and validate embedded figures, resolution, and color profiles",
        "icon": "Image"
    },
    {
        "key": "languageEdit",
        "label": "Language Edit",
        "description": "Linguistic copyediting for grammar, syntax, and phrasing",
        "icon": "Languages"
    },
    {
        "key": "technicalEdit",
        "label": "Technical Edit",
        "description": "Review mathematical notation, equations, and technical nomenclature",
        "icon": "Wrench"
    },
    {
        "key": "unifiedReview",
        "label": "Review Studio",
        "description": "Unified interactive editor with track changes, comments, and side-by-side view",
        "icon": "Layout"
    },
    {
        "key": "manuscriptAnalysis",
        "label": "Manuscript Analysis",
        "description": "Automated analysis of manuscript content, structural integrity, and word count",
        "icon": "FileOutput"
    },
    {
        "key": "permissionsCheck",
        "label": "Permissions Check",
        "description": "Audit and track third-party copyright, figures, and citation permissions",
        "icon": "ShieldCheck"
    },
    {
        "key": "aiCreditExtraction",
        "label": "AI Credit Extraction",
        "description": "Extract contributor credits, affiliations, and funding sources using AI",
        "icon": "Sparkles"
    },
    {
        "key": "biasScan",
        "label": "Bias Scan",
        "description": "Scan text for cultural, gender, accessibility, or inclusivity bias",
        "icon": "ScanLine"
    },
    {
        "key": "wordToXml",
        "label": "Word to XML",
        "description": "Convert Word DOCX manuscript directly into JATS or BITS XML",
        "icon": "FileCode"
    },
    {
        "key": "wordToIndesign",
        "label": "Word to InDesign",
        "description": "Typeset Word document into Adobe InDesign INDD/IDML layout",
        "icon": "Layers"
    },
    {
        "key": "xmlToIndesign",
        "label": "Generate InDesign (XML to INDD)",
        "description": "Flow structured XML content into an InDesign template layout",
        "icon": "Layers"
    },
    {
        "key": "indesignToXml",
        "label": "InDesign to XML",
        "description": "Extract structured XML from an InDesign document",
        "icon": "FileCode"
    },
    {
        "key": "viewProof",
        "label": "View Proof",
        "description": "Inspect and view rendered page proof PDF",
        "icon": "Eye"
    }
]

router = APIRouter(prefix="/api/v1", tags=["Workflow"])


# ── RolesMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/roles-master", response_model=RolesMasterResponse, status_code=status.HTTP_201_CREATED)
def create_role(data: RolesMasterCreate, db: Session = Depends(get_db)):
    return crud.create_role(db, data)


@router.get("/roles-master", response_model=List[RolesMasterResponse])
def list_roles(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_roles(db, skip=skip, limit=limit)


@router.get("/roles-master/{role_id}", response_model=RolesMasterResponse)
def get_role(role_id: int, db: Session = Depends(get_db)):
    role = crud.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.put("/roles-master/{role_id}", response_model=RolesMasterResponse)
def update_role(role_id: int, data: RolesMasterUpdate, db: Session = Depends(get_db)):
    updated = crud.update_role(db, role_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Role not found")
    return updated


@router.delete("/roles-master/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    if not crud.delete_role(db, role_id):
        raise HTTPException(status_code=404, detail="Role not found")


# ── StageMaster Endpoints ─────────────────────────────────────────────────────

@router.post("/stages", response_model=StageMasterResponse, status_code=status.HTTP_201_CREATED)
def create_stage(data: StageMasterCreate, db: Session = Depends(get_db)):
    return crud.create_stage(db, data)


@router.get("/stages", response_model=List[StageMasterResponse])
def list_stages(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stages(db, skip=skip, limit=limit)


@router.get("/stages/processing-actions/definitions", response_model=List[ProcessingActionDefinition])
def get_processing_action_definitions():
    return AVAILABLE_PROCESSING_ACTIONS


@router.get("/stages/processing-actions/mapping")
def get_processing_actions_mapping(db: Session = Depends(get_db)):
    from sqlalchemy import select
    stages = list(db.execute(select(StageMaster).order_by(StageMaster.id)).scalars().all())
    mapping: dict[str, list[str]] = {a["key"]: [] for a in AVAILABLE_PROCESSING_ACTIONS}
    for stage in stages:
        for action in (stage.processing_actions or []):
            if action in mapping:
                mapping[action].append(stage.stage_name)
            else:
                mapping[action] = [stage.stage_name]
    return {
        "definitions": AVAILABLE_PROCESSING_ACTIONS,
        "mapping": mapping,
        "stages": [{"id": s.id, "stage_name": s.stage_name, "active_status": s.active_status, "processing_actions": s.processing_actions} for s in stages]
    }


@router.put("/stages/processing-actions/mapping")
def update_processing_actions_mapping(data: ProcessingActionsMappingUpdate, db: Session = Depends(get_db)):
    from sqlalchemy import select
    stages = list(db.execute(select(StageMaster)).scalars().all())
    
    # Invert mapping: for each stage name, compute list of action keys
    stage_actions_map: dict[str, list[str]] = {s.stage_name.lower(): [] for s in stages}
    for action_key, stage_names in data.mapping.items():
        for sname in stage_names:
            low = sname.strip().lower()
            if low in stage_actions_map:
                if action_key not in stage_actions_map[low]:
                    stage_actions_map[low].append(action_key)
            else:
                for real_stage in stages:
                    if real_stage.stage_name.lower() == low:
                        if action_key not in stage_actions_map[real_stage.stage_name.lower()]:
                            stage_actions_map[real_stage.stage_name.lower()].append(action_key)

    for stage in stages:
        stage.processing_actions = stage_actions_map.get(stage.stage_name.lower(), [])

    db.commit()
    for s in stages:
        db.refresh(s)

    mapping: dict[str, list[str]] = {a["key"]: [] for a in AVAILABLE_PROCESSING_ACTIONS}
    for stage in stages:
        for action in (stage.processing_actions or []):
            if action in mapping:
                mapping[action].append(stage.stage_name)
            else:
                mapping[action] = [stage.stage_name]

    return {
        "success": True,
        "message": "Processing actions mapping updated successfully",
        "definitions": AVAILABLE_PROCESSING_ACTIONS,
        "mapping": mapping,
        "stages": [{"id": s.id, "stage_name": s.stage_name, "active_status": s.active_status, "processing_actions": s.processing_actions} for s in stages]
    }


def resolve_stage(db: Session, identifier: str):
    from sqlalchemy import select
    if identifier.isdigit():
        return db.execute(select(StageMaster).where(StageMaster.id == int(identifier))).scalars().first()
    else:
        return db.execute(select(StageMaster).where(StageMaster.stage_name == identifier)).scalars().first()


@router.get("/stages/{stage_id_or_name}", response_model=StageMasterResponse)
def get_stage(stage_id_or_name: str, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    return stage


@router.put("/stages/{stage_id_or_name}", response_model=StageMasterResponse)
def update_stage(stage_id_or_name: str, data: StageMasterUpdate, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    updated = crud.update_stage(db, stage.id, data)
    return updated


@router.delete("/stages/{stage_id_or_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(stage_id_or_name: str, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage or not crud.delete_stage(db, stage.id):
        raise HTTPException(status_code=404, detail="Stage not found")


@router.patch("/stages/{stage_id_or_name}/status", response_model=StageMasterResponse)
def set_stage_status(stage_id_or_name: str, payload: StatusPayload, db: Session = Depends(get_db)):
    stage = resolve_stage(db, stage_id_or_name)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found")
    stage.active_status = payload.active_status
    db.commit()
    db.refresh(stage)
    return stage


# ── StageDetail Endpoints ─────────────────────────────────────────────────────

@router.post("/stage-details", response_model=StageDetailResponse, status_code=status.HTTP_201_CREATED)
def create_stage_detail(data: StageDetailCreate, db: Session = Depends(get_db)):
    return crud.create_stage_detail(db, data)


@router.get("/stage-details", response_model=List[StageDetailResponse])
def list_stage_details(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_stage_details(db, skip=skip, limit=limit)


@router.get("/stage-details/{detail_id}", response_model=StageDetailResponse)
def get_stage_detail(detail_id: int, db: Session = Depends(get_db)):
    detail = crud.get_stage_detail(db, detail_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Stage detail not found")
    return detail


@router.put("/stage-details/{detail_id}", response_model=StageDetailResponse)
def update_stage_detail(detail_id: int, data: StageDetailUpdate, db: Session = Depends(get_db)):
    updated = crud.update_stage_detail(db, detail_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Stage detail not found")
    return updated


@router.delete("/stage-details/{detail_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage_detail(detail_id: int, db: Session = Depends(get_db)):
    if not crud.delete_stage_detail(db, detail_id):
        raise HTTPException(status_code=404, detail="Stage detail not found")


from app.domains.auth.security import get_current_user_from_cookie
from app.domains.auth.models import User


def _send_planning_approved_email(
    project_code: str,
    workflow_name: Optional[str],
    approval_type: str,
    reason: Optional[str] = None,
    operator: Optional[str] = None
):
    """
    Sends email notification when project planning is approved or re-approved.
    - Recipient (TO): Each stage owner in the selected workflow (from stage config,
      StageMaster.owner_designation, or stage TO list).
    - CC: Project Manager, customer contact, and changing user.
    - Template: Reads from 'Planning Approved' in client's stage transition config (or 'default').
    - Body: Includes formatted Project Information table and Planning Schedule table.
    """
    import logging
    import html
    from app.database import SessionLocal
    from app.domains.projects.models import Project
    from app.domains.clients.models import Client
    from app.domains.workflow.models import StageDetail, StageMaster, WorkflowMaster
    from app.domains.workflow.transition_settings_api import _get_raw_config_for_client
    from app.domains.auth.models import User
    from app.domains.notifications.email_service import send_email

    logger = logging.getLogger(__name__)

    db = SessionLocal()
    try:
        from sqlalchemy import or_
        project = db.query(Project).filter(
            or_(Project.project_code == project_code, Project.code == project_code)
        ).first()
        if not project:
            logger.warning(f"[_send_planning_approved_email] Project '{project_code}' not found.")
            return

        client_div = project.division_code or "default"
        client_obj = None
        if project.client_id:
            client_obj = db.query(Client).filter(Client.id == project.client_id).first()

        client_name = project.client_name or (client_obj.company if client_obj else client_div)
        wf_name = workflow_name or project.workflow_name or ""

        # Fetch client's transition configuration
        cfg, _, _ = _get_raw_config_for_client(db, client_div)

        # Check 'Planning Approved' stage configuration
        planning_cfg = cfg.get("Planning Approved") or {}
        if planning_cfg.get("enabled") is False:
            logger.info(f"[_send_planning_approved_email] 'Planning Approved' notification is disabled for {client_div}.")
            return

        # 1. Resolve workflow stages
        wf_stages = []
        if wf_name:
            wf_stages = db.query(WorkflowMaster).filter(
                WorkflowMaster.workflow_name == wf_name
            ).order_by(WorkflowMaster.id.asc()).all()

        # 2. Collect stage owner emails for TO (ONLY stage owner per stage)
        stage_owners_to = []
        for w in wf_stages:
            st = w.stage_name
            st_cfg = cfg.get(st, {})
            stage_owner_found = None

            # A. Explicit stage owner email configured on this stage
            if st_cfg.get("stage_owner_email") and "@" in st_cfg["stage_owner_email"]:
                stage_owner_found = st_cfg["stage_owner_email"].strip()
            # B. Stage owner username configured on this stage
            elif st_cfg.get("stage_owner_username"):
                u = db.query(User).filter(User.username == st_cfg["stage_owner_username"].strip()).first()
                if u and u.email and "@" in u.email:
                    stage_owner_found = u.email.strip()

            # C. StageMaster owner_designation mapping
            if not stage_owner_found:
                desig_u = resolve_stage_owner_by_designation(
                    db, st, project_code=project.project_code, client_identifier=client_div
                )
                if desig_u and desig_u.email and "@" in desig_u.email:
                    stage_owner_found = desig_u.email.strip()

            if stage_owner_found:
                stage_owners_to.append(stage_owner_found)

        # If configured TO in Planning Approved template has explicit emails
        configured_to = planning_cfg.get("to") or ["{workflow_stage_owners}"]
        resolved_to_list = []
        for item in configured_to:
            if item == "{workflow_stage_owners}":
                resolved_to_list.extend(stage_owners_to)
            elif item and "@" in item and "{" not in item:
                resolved_to_list.append(item.strip())

        # Deduplicate while preserving order
        seen_to = set()
        final_to = []
        for em in resolved_to_list:
            em_lower = em.lower()
            if em_lower not in seen_to:
                seen_to.add(em_lower)
                final_to.append(em)

        # 3. Resolve CC emails (CC is Project Manager)
        final_cc = []
        seen_cc = set(seen_to)

        pm_email = None
        pm_ident = project.project_manager
        if not pm_ident:
            # Check if any stage_detail has project_manager_name
            sd_with_pm = db.query(StageDetail).filter(
                StageDetail.project == project.project_code,
                StageDetail.project_manager_name.isnot(None)
            ).first()
            if sd_with_pm:
                pm_ident = sd_with_pm.project_manager_name

        pm_name = None
        if pm_ident:
            pm_u = db.query(User).filter(
                or_(User.username == pm_ident, User.email == pm_ident)
            ).first()
            if pm_u:
                if pm_u.email:
                    pm_email = pm_u.email.strip()
                full_name = f"{pm_u.first_name or ''} {pm_u.last_name or ''}".strip()
                if full_name:
                    pm_name = full_name
        if not pm_name:
            pm_name = pm_ident

        configured_cc = planning_cfg.get("cc") or ["{project_manager_email}"]
        for item in configured_cc:
            if item == "{project_manager_email}" and pm_email:
                if pm_email.lower() not in seen_cc:
                    seen_cc.add(pm_email.lower())
                    final_cc.append(pm_email)
            elif item and "@" in item and "{" not in item:
                if item.lower() not in seen_cc:
                    seen_cc.add(item.lower())
                    final_cc.append(item.strip())

        # Always ensure Project Manager is added in CC if not already present
        if pm_email and pm_email.lower() not in seen_cc:
            seen_cc.add(pm_email.lower())
            final_cc.append(pm_email)

        # 4. Fetch planning schedule details
        sds = db.query(StageDetail).filter(
            StageDetail.project == project.project_code
        ).order_by(StageDetail.chapters.asc(), StageDetail.planned_start_date.asc(), StageDetail.id.asc()).all()

        # Format helpers
        def _fmt_date(dt, default: Optional[str] = None):
            if not dt:
                return default
            if hasattr(dt, "strftime"):
                return dt.strftime("%d %b %Y")
            return str(dt)

        def _fmt_composition(comp: Optional[str]) -> Optional[str]:
            if not comp:
                return None
            comp_clean = str(comp).strip()
            comp_map = {
                "low": "Level 1",
                "medium": "Level 2",
                "high": "Level 3",
                "level 1": "Level 1",
                "level 2": "Level 2",
                "level 3": "Level 3",
            }
            return comp_map.get(comp_clean.lower(), comp_clean)

        # Build Project Info HTML & Text tables
        proj_fields_raw = [
            ("project_title", "Project Title", project.project_title),
            ("category", "Category", project.category),
            ("priority", "Priority", project.priority),
            ("copyediting_level", "Copyediting Level", project.copyediting_level),
            ("composition", "Composition", _fmt_composition(project.composition)),
            ("due_date", "Due Date", _fmt_date(project.due_date, default=None)),
            ("project_manager", "Project Manager", pm_name or project.project_manager),
            ("edition", "Edition", project.edition),
            ("color", "Color", project.color),
            ("trim_size", "Trim Size", project.trim_size),
            ("copyright_year", "Copyright Year", project.copyright_year),
            ("manuscript_pages", "Manuscript Pages", project.manuscript_pages),
            ("estimated_pages", "Estimated Pages", project.estimated_pages),
            ("chapter_count", "Chapter Count", project.chapter_count),
            ("isbn_no", "ISBN No", project.isbn_no),
            ("billing_type", "Billing Type", project.billing_type),
            ("alt_text", "Alt Text", project.alt_text),
            ("accessibility", "Accessibility", project.accessibility),
            ("project_type", "Project Type", project.project_type),
        ]
        if reason:
            proj_fields_raw.append(("adjustment_reason", "Adjustment Reason", reason))

        # Filter out empty/None/blank data so only populated fields are sent
        proj_fields = []
        for key, label, val in proj_fields_raw:
            if val is not None and str(val).strip() != "" and str(val).strip() != "—":
                proj_fields.append((key, label, str(val).strip()))

        # Project Info HTML Table
        proj_html_rows = "".join(
            f"""<tr>
                <td style="padding: 7px 12px; font-weight: 600; color: #4b5563; background-color: #f9fafb; border: 1px solid #e5e7eb; width: 30%; font-size: 13px;">{html.escape(label)}</td>
                <td style="padding: 7px 12px; color: #111827; border: 1px solid #e5e7eb; font-size: 13px;">{html.escape(val)}</td>
            </tr>"""
            for _, label, val in proj_fields
        )
        proj_info_html = f"""<table style="width: 100%; border-collapse: collapse; margin: 12px 0 20px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">{proj_html_rows}</table>"""

        # Project Info Plain Text
        proj_info_text = "\n".join(f"{label:22}: {val}" for _, label, val in proj_fields)

        # Build Stage Schedule HTML & Text tables partitioned into:
        # 1. Manuscripts
        # 2. Art Tracks
        # 3. Design
        from collections import defaultdict

        def _get_track_name(ch_label: str) -> str:
            lower = (ch_label or "").strip().lower()
            if lower == "design":
                return "Design"
            elif "art" in lower:
                return "Art Tracks"
            else:
                return "Manuscripts"

        # Detect stages whose due date was changed in the most recent adjustment (for highlighting)
        most_recent_ts = None
        for s in sds:
            if s.history:
                for h in s.history:
                    ca = h.get("changed_at")
                    if ca and (not most_recent_ts or ca > most_recent_ts):
                        most_recent_ts = ca

        changed_due_stages_by_track = defaultdict(set)
        if approval_type == "Re-approved" and most_recent_ts:
            for s in sds:
                if s.history:
                    last_h = s.history[-1]
                    if last_h.get("changed_at") == most_recent_ts:
                        b_due = (last_h.get("before") or {}).get("planned_end_date")
                        a_due = (last_h.get("after") or {}).get("planned_end_date")
                        b_str = b_due.split("T")[0] if b_due else None
                        a_str = a_due.split("T")[0] if a_due else None
                        if b_str != a_str:
                            trk = _get_track_name(s.chapters)
                            changed_due_stages_by_track[trk].add(s.stage_name)

        track_data = defaultdict(lambda: defaultdict(list))
        for s in sds:
            trk = _get_track_name(s.chapters)
            track_data[trk][s.stage_name].append(s)

        # Standard display order for tracks
        track_display_order = ["Manuscripts", "Art Tracks", "Design"]
        available_tracks = [t for t in track_display_order if t in track_data]
        for t in track_data.keys():
            if t not in available_tracks:
                available_tracks.append(t)

        sched_html_blocks = []
        sched_text_blocks = []

        for trk_name in available_tracks:
            stages_map = track_data[trk_name]
            if not stages_map:
                continue

            # Stage ordering
            stage_order = [w.stage_name for w in wf_stages if w.stage_name in stages_map]
            for st in stages_map.keys():
                if st not in stage_order:
                    stage_order.append(st)

            trk_html_rows = []
            trk_text_rows = []
            changed_in_track = changed_due_stages_by_track.get(trk_name, set())

            for st_name in stage_order:
                rows = stages_map.get(st_name, [])
                if not rows:
                    continue

                starts = [r.planned_start_date for r in rows if r.planned_start_date]
                dues = [r.planned_end_date for r in rows if r.planned_end_date]
                min_start = min(starts) if starts else None
                max_due = max(dues) if dues else None

                start_str = _fmt_date(min_start, default="—")
                due_str = _fmt_date(max_due, default="—")

                is_due_changed = st_name in changed_in_track
                if is_due_changed:
                    # Highlight changed due date with amber/yellow badge & bold emphasis
                    due_cell_html = f"""<td style="padding: 8px 12px; border: 1px solid #fcd34d; font-size: 13px; color: #92400e; font-weight: 700; background-color: #fef3c7;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">
                            <span>{html.escape(due_str)}</span>
                            <span style="font-size: 10px; background-color: #f59e0b; color: #ffffff; padding: 1px 6px; border-radius: 9999px; font-weight: 800; text-transform: uppercase;">Updated</span>
                        </span>
                    </td>"""
                    due_cell_text = f"{due_str} (UPDATED)"
                    row_bg = ' style="background-color: #fffbeb;"'
                else:
                    due_cell_html = f"""<td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 13px; color: #111827; font-weight: 600;">{html.escape(due_str)}</td>"""
                    due_cell_text = due_str
                    row_bg = ""

                trk_html_rows.append(f"""<tr{row_bg}>
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 13px; color: #111827; font-weight: 600;">{html.escape(st_name)}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151;">{html.escape(start_str)}</td>
                    {due_cell_html}
                </tr>""")
                trk_text_rows.append(f"  {st_name:25} | Start: {start_str:11} | Due: {due_cell_text}")

            # Badge color / icon per track
            track_colors = {
                "Manuscripts": "#2563eb",
                "Art Tracks": "#059669",
                "Design": "#d97706"
            }
            trk_color = track_colors.get(trk_name, "#4f46e5")

            block_html = f"""
            <div style="margin-top: 18px; margin-bottom: 22px;">
                <div style="font-size: 14px; font-weight: 700; color: {trk_color}; margin-bottom: 8px; border-bottom: 1.5px solid {trk_color}; padding-bottom: 4px;">
                    {html.escape(trk_name)}
                </div>
                <table style="width: 100%; border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <thead>
                        <tr style="background-color: #f9fafb;">
                            <th style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #4b5563; text-align: left;">Stage Name</th>
                            <th style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #4b5563; text-align: left;">Start Date</th>
                            <th style="padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #4b5563; text-align: left;">Due Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {"".join(trk_html_rows) if trk_html_rows else '<tr><td colspan="3" style="padding: 12px; text-align: center; color: #6b7280; font-size: 13px;">No schedule items.</td></tr>'}
                    </tbody>
                </table>
            </div>
            """
            sched_html_blocks.append(block_html)

            sched_text_blocks.append(f"[{trk_name}]\n" + ("\n".join(trk_text_rows) if trk_text_rows else "  No schedule items."))

        sched_table_html = "".join(sched_html_blocks) if sched_html_blocks else "<p style='color: #6b7280;'>No schedule items found.</p>"
        sched_table_text = "\n\n".join(sched_text_blocks) if sched_text_blocks else "No schedule items found."

        # Template placeholders substitution
        if approval_type == "Re-approved":
            default_subject = "{client_name} - {project_code} : {project_title} - Project Planning Re-approved"
            planning_status_label = "Project Planning Re-approved"
        else:
            default_subject = "New title - {client_name} - {project_code} : {project_title} - Project launch"
            planning_status_label = "Project launch"

        raw_subject = planning_cfg.get("subject")
        if not raw_subject or raw_subject.strip() in (
            "{client_name} - {project_code} - Project Planning {approval_type}",
            "{client_name} - {project_code} : {project_title} - {planning_status_label}",
            "New title - {client_name} - {project_code} : {project_title} - {planning_status_label}",
        ):
            raw_subject = default_subject

        raw_body = planning_cfg.get("body") or (
            "Hi Team,\n\n"
            "The project planning for {project_code} has been {approval_type}.\n\n"
            "Project Information:\n{project_info_table}\n\n"
            "Planning Schedule:\n{planning_schedule_table}\n\n"
            "Regards,\n"
            "S4C Ninja Inkflow Team\n\n"
            "Note : This is an automated mail and please do not reply."
        )

        replacements = {
            "{client_name}": client_name or "",
            "{customer_name}": client_name or "",
            "{project_code}": project.project_code or "",
            "{project_title}": project.project_title or "",
            "{workflow_name}": wf_name or "",
            "{composition}": _fmt_composition(project.composition) or "Level 2",
            "{priority}": project.priority or "Normal",
            "{approval_type}": approval_type,
            "{planning_status_label}": planning_status_label,
            "{adjustment_reason}": reason or "—",
            "{project_manager_email}": pm_email or "",
            "{project_manager_name}": project.project_manager or "Project Manager",
            "{workflow_stage_owners}": ", ".join(final_to) if final_to else "",
            "{chapter_table}": "",
        }

        subj = raw_subject
        for k, v in replacements.items():
            subj = subj.replace(k, str(v))

        # Plain body
        body_text = raw_body
        for k, v in replacements.items():
            body_text = body_text.replace(k, str(v))
        body_text = body_text.replace("{project_info_table}", proj_info_text)
        body_text = body_text.replace("{planning_schedule_table}", sched_table_text)

        # HTML body
        body_html_content = html.escape(raw_body).replace("\n", "<br>")
        for k, v in replacements.items():
            body_html_content = body_html_content.replace(k, html.escape(str(v)))
        body_html_content = body_html_content.replace("&lt;br&gt;", "<br>")
        body_html_content = body_html_content.replace("{project_info_table}", proj_info_html)
        body_html_content = body_html_content.replace("{planning_schedule_table}", sched_table_html)

        html_body = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; line-height: 1.5; }}
            </style>
        </head>
        <body style="margin: 0; padding: 20px; background-color: #f9fafb;">
            <div style="max-width: 800px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
                    <h2 style="margin: 0; color: #111827; font-size: 18px;">Project Planning {html.escape(approval_type)}</h2>
                    <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 13px;">Project Code: <strong>{html.escape(project.project_code or '')}</strong> | Client: <strong>{html.escape(client_name)}</strong></p>
                </div>
                <div>{body_html_content}</div>
                <div style="margin-top: 28px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center;">
                    This is an automated notification from S4C Ninja Inkflow CMS. Please do not reply directly to this email.
                </div>
            </div>
        </body>
        </html>
        """

        if not final_to:
            logger.warning(f"[_send_planning_approved_email] No recipients resolved for project {project_code}. Skipping email dispatch.")
            return

        to_str = ", ".join(final_to)
        logger.info(f"[_send_planning_approved_email] Dispatching to: {to_str}, cc: {final_cc}, subject: {subj}")
        send_email(
            to_email=to_str,
            subject=subj,
            text_body=body_text,
            html_body=html_body,
            cc_emails=final_cc if final_cc else None
        )
    except Exception as e:
        logger.error(f"[_send_planning_approved_email] Failed to dispatch planning approval email: {e}", exc_info=True)
    finally:
        db.close()


@router.post("/stage-details/plan", response_model=List[StageDetailResponse])
def create_planning_rows(
    payload: BulkPlannedCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    from sqlalchemy import select, or_
    from sqlalchemy.orm.attributes import flag_modified
    from datetime import datetime, timezone
    from app.domains.projects.models import Project

    def _format_user_full_name(u) -> Optional[str]:
        if not u:
            return None
        fn = (getattr(u, "first_name", None) or "").strip()
        ln = (getattr(u, "last_name", None) or "").strip()
        if fn and ln:
            if fn.endswith(f" {ln}") or fn.endswith(ln):
                return fn
            return f"{fn} {ln}"
        return fn or ln or getattr(u, "username", None)

    operator = None
    if payload.changed_by:
        matched = db.query(User).filter(
            or_(
                User.username == payload.changed_by,
                User.email == payload.changed_by,
            )
        ).first()
        if matched:
            operator = _format_user_full_name(matched)
        else:
            operator = payload.changed_by

    if not operator and current_user:
        operator = _format_user_full_name(current_user)

    if not operator and payload.project_manager_name:
        matched_pm = db.query(User).filter(
            or_(
                User.username == payload.project_manager_name,
                User.email == payload.project_manager_name,
            )
        ).first()
        if matched_pm:
            operator = _format_user_full_name(matched_pm)
        else:
            operator = payload.project_manager_name

    if not operator:
        operator = "System"

    # Validate against project due date
    project = db.query(Project).filter(
        or_(Project.project_code == payload.project, Project.code == payload.project)
    ).first()

    if project and project.due_date:
        due_str = str(project.due_date)
        for item in payload.items:
            if item.planned_end_date:
                end_str = str(item.planned_end_date).split("T")[0]
                if end_str > due_str:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Planned date {end_str} for {item.chapters} - {item.stage_name} cannot be above the project due date {due_str}.",
                    )

    details = []
    for item in payload.items:
        existing = db.execute(
            select(StageDetail).where(
                StageDetail.project == payload.project,
                StageDetail.chapters == item.chapters,
                StageDetail.stage_name == item.stage_name,
            )
        ).scalars().first()

        if existing:
            if existing.stage_status == "Completed":
                details.append(existing)
                continue

            old_start = existing.planned_start_date.isoformat() if existing.planned_start_date else None
            old_due = existing.planned_end_date.isoformat() if existing.planned_end_date else None
            old_sla = existing.sla

            new_start = item.planned_start_date.isoformat() if item.planned_start_date else None
            new_due = item.planned_end_date.isoformat() if item.planned_end_date else None
            new_sla = item.sla

            # Check if dates or SLA actually changed
            dates_changed = (
                (old_start and new_start and old_start.split("T")[0] != new_start.split("T")[0]) or
                (bool(old_start) != bool(new_start)) or
                (old_due and new_due and old_due.split("T")[0] != new_due.split("T")[0]) or
                (bool(old_due) != bool(new_due)) or
                (old_sla != new_sla)
            )

            if dates_changed:
                history_list = list(existing.history or [])
                history_entry = {
                    "reason": payload.reason or "Planning adjustment",
                    "changed_at": datetime.now(timezone.utc).isoformat(),
                    "changed_by": operator,
                    "before": {
                        "planned_start_date": old_start,
                        "planned_end_date": old_due,
                        "sla": old_sla,
                    },
                    "after": {
                        "planned_start_date": new_start,
                        "planned_end_date": new_due,
                        "sla": new_sla,
                    }
                }
                history_list.append(history_entry)
                existing.history = history_list
                flag_modified(existing, "history")

            existing.workflow = item.workflow if item.workflow else payload.workflow
            existing.complexity_level = payload.complexity_level
            existing.project_manager_name = payload.project_manager_name
            existing.planned_start_date = item.planned_start_date
            existing.planned_end_date = item.planned_end_date
            existing.sla = item.sla
            details.append(existing)
        else:
            db_detail = StageDetail(
                client=payload.client,
                project=payload.project,
                workflow=item.workflow if item.workflow else payload.workflow,
                complexity_level=payload.complexity_level,
                project_manager_name=payload.project_manager_name,
                chapters=item.chapters,
                stage_name=item.stage_name,
                planned_start_date=item.planned_start_date,
                planned_end_date=item.planned_end_date,
                sla=item.sla,
                stage_status="In-progress",
            )
            db.add(db_detail)
            details.append(db_detail)
    db.commit()
    for d in details:
        db.refresh(d)

    # Trigger planning approval / re-approval email notification
    approval_type = "Re-approved" if (payload.reason or any(d.history for d in details)) else "Approved"
    background_tasks.add_task(
        _send_planning_approved_email,
        project_code=payload.project,
        workflow_name=payload.workflow,
        approval_type=approval_type,
        reason=payload.reason,
        operator=operator
    )

    return details


@router.get("/stage-details/project/{project}", response_model=List[StageDetailResponse])
def get_stage_details_by_project(project: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    return list(db.execute(select(StageDetail).where(StageDetail.project == project)).scalars().all())


@router.get("/stage-details/project/{project}/chapter/{chapters}", response_model=List[StageDetailResponse])
def get_stage_details_by_chapter(project: str, chapters: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    return list(db.execute(select(StageDetail).where(StageDetail.project == project, StageDetail.chapters == chapters)).scalars().all())


class AssignPayload(BaseModel):
    assignee_name: Optional[str]
    dt: Optional[str] = None


@router.post("/stage-details/project/{project}/chapter/{chapters}/stage/{stage_name}/assign", response_model=Optional[StageDetailResponse])
def assign_stage(project: str, chapters: str, stage_name: str, payload: AssignPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    db_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == stage_name
        )
    ).scalars().first()
    
    if not db_detail:
        db_detail = StageDetail(
            client=project,
            project=project,
            chapters=chapters,
            stage_name=stage_name,
            workflow="Workflow1",
        )
        db.add(db_detail)
    
    db_detail.assignee_name = payload.assignee_name
    if not db_detail.actual_start_date and not db_detail.actual_end_date:
        if payload.dt:
            try:
                dt_val = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
                if dt_val.tzinfo is not None:
                    dt_val = dt_val.replace(tzinfo=None)
                db_detail.actual_start_date = dt_val
            except ValueError:
                db_detail.actual_start_date = datetime.now(timezone.utc)
        else:
            db_detail.actual_start_date = datetime.now(timezone.utc)
        
    db.commit()
    db.refresh(db_detail)
    return db_detail


class AssignmentTarget(BaseModel):
    project: str
    chapters: str
    stage_name: str


class BulkAssignPayload(BaseModel):
    assignee_name: Optional[str]
    targets: List[AssignmentTarget]
    dt: Optional[str] = None


@router.post("/stage-details/bulk-assign", response_model=List[StageDetailResponse])
def bulk_assign_stages(payload: BulkAssignPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    
    updated_details = []
    
    assign_time = datetime.now(timezone.utc)
    if payload.dt:
        try:
            assign_time = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
            if assign_time.tzinfo is not None:
                assign_time = assign_time.replace(tzinfo=None)
        except ValueError:
            pass
            
    for target in payload.targets:
        db_detail = db.execute(
            select(StageDetail)
            .where(
                StageDetail.project == target.project,
                StageDetail.chapters == target.chapters,
                StageDetail.stage_name == target.stage_name
            )
        ).scalars().first()
        
        if not db_detail:
            db_detail = StageDetail(
                client=target.project,
                project=target.project,
                chapters=target.chapters,
                stage_name=target.stage_name,
                workflow="Workflow1",
            )
            db.add(db_detail)
            
        db_detail.assignee_name = payload.assignee_name
        if not db_detail.actual_start_date and not db_detail.actual_end_date:
            db_detail.actual_start_date = assign_time
        updated_details.append(db_detail)
        
    db.commit()
    for d in updated_details:
        db.refresh(d)
        
    return updated_details


def resolve_stage_owner_by_designation(
    db: Session,
    stage_name: str,
    project_code: Optional[str] = None,
    client_identifier: Optional[str] = None
):
    """
    Finds the active user configured as the owner for the given stage name based on StageMaster.owner_designation.
    1. Looks up StageMaster.owner_designation for stage_name.
    2. If no owner_designation is configured, returns None.
    3. Searches active users where User.designation or User.role matches owner_designation.
    4. If multiple users match, prioritizes:
       a. User whose customer_access includes client_identifier or project_code.
       b. User who is in the project's assigned team (if project_code provided).
       c. First active user matching designation.
    5. Returns User model or None.
    """
    if not stage_name:
        return None
    from app.domains.workflow.models import StageMaster
    from app.domains.auth.models import User
    from sqlalchemy import select, func, or_
    import json

    stage_rec = db.execute(
        select(StageMaster).where(StageMaster.stage_name == stage_name)
    ).scalars().first()

    if not stage_rec or not stage_rec.owner_designation:
        return None

    target_desig = stage_rec.owner_designation.strip()
    if not target_desig:
        return None

    # Query active users matching designation or role
    users = db.execute(
        select(User).where(
            User.active_status == True,
            or_(
                func.lower(func.trim(User.designation)) == target_desig.lower(),
                func.lower(func.trim(User.role)) == target_desig.lower()
            )
        )
    ).scalars().all()

    if not users:
        desig_norm = target_desig.lower().replace("-", " ").replace("_", " ").strip()
        all_active = db.execute(select(User).where(User.active_status == True)).scalars().all()
        for u in all_active:
            u_d = (u.designation or "").lower().replace("-", " ").replace("_", " ").strip()
            u_r = (u.role or "").lower().replace("-", " ").replace("_", " ").strip()
            if u_d == desig_norm or u_r == desig_norm:
                users.append(u)
                continue
            if u.additional_roles and isinstance(u.additional_roles, list):
                if any(desig_norm == str(ar).lower().replace("-", " ").replace("_", " ").strip() for ar in u.additional_roles):
                    users.append(u)

    if not users:
        return None

    if len(users) == 1:
        return users[0]

    # Prioritize user with customer_access matching client_identifier or project_code
    if client_identifier or project_code:
        for u in users:
            acc = u.customer_access or []
            if isinstance(acc, str):
                try:
                    acc = json.loads(acc)
                except Exception:
                    acc = [acc]
            if isinstance(acc, list):
                if client_identifier and client_identifier in acc:
                    return u
                if project_code and project_code in acc:
                    return u

    # Prioritize user associated with project team if available
    if project_code:
        from app.domains.projects.models import Project
        proj = db.execute(select(Project).where(Project.project_code == project_code)).scalars().first()
        if proj and proj.team:
            for u in users:
                if u.team and u.team.lower() == proj.team.lower():
                    return u

    return users[0]


class TransitionPayload(BaseModel):
    from_stage: str
    to_stage: str
    dt: Optional[str] = None


@router.post("/stage-details/project/{project}/chapter/{chapters}/stage-transition", response_model=Optional[StageDetailResponse])
def stage_transition(project: str, chapters: str, payload: TransitionPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import datetime
    
    from_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == payload.from_stage
        )
    ).scalars().first()
    
    transition_time = datetime.now(timezone.utc)
    if payload.dt:
        try:
            transition_time = datetime.fromisoformat(payload.dt.replace("Z", "+00:00"))
            if transition_time.tzinfo is not None:
                transition_time = transition_time.replace(tzinfo=None)
        except ValueError:
            pass
            
    if from_detail:
        from_detail.stage_status = "Completed"
        from_detail.actual_end_date = transition_time
        if from_detail.actual_start_date:
            t_naive = transition_time.replace(tzinfo=None) if transition_time.tzinfo is not None else transition_time
            s_naive = from_detail.actual_start_date.replace(tzinfo=None) if from_detail.actual_start_date.tzinfo is not None else from_detail.actual_start_date
            delta = t_naive - s_naive
            from_detail.total_time_taken = delta.total_seconds() / 3600.0
        
        # Calculate completion delay
        if from_detail.planned_end_date and transition_time.date() > from_detail.planned_end_date.date():
            from_detail.delayed = True
            from_detail.delay_days = (transition_time.date() - from_detail.planned_end_date.date()).days
        else:
            from_detail.delayed = False
            from_detail.delay_days = 0

        # Cascade delay propagation (shifting subsequent stages)
        if from_detail.delay_days and from_detail.delay_days > 0:
            from app.domains.workflow.models import WorkflowMaster
            wf_stages = db.execute(
                select(WorkflowMaster)
                .where(WorkflowMaster.workflow_name == from_detail.workflow)
            ).scalars().all()
            
            stage_by_name = {s.stage_name: s for s in wf_stages}
            subsequent_stages = []
            visited = set()
            curr = stage_by_name.get(payload.to_stage)
            while curr and curr.stage_name not in visited:
                subsequent_stages.append(curr.stage_name)
                visited.add(curr.stage_name)
                curr = stage_by_name.get(curr.next_stage) if curr.next_stage else None
                
            if subsequent_stages:
                from datetime import timedelta
                shift_delta = timedelta(days=from_detail.delay_days)
                subsequent_details = db.execute(
                    select(StageDetail)
                    .where(
                        StageDetail.project == project,
                        StageDetail.chapters == chapters,
                        StageDetail.stage_name.in_(subsequent_stages)
                    )
                ).scalars().all()
                for sd in subsequent_details:
                    if sd.planned_start_date:
                        sd.planned_start_date += shift_delta
                    if sd.planned_end_date:
                        sd.planned_end_date += shift_delta

        # Sync ChapterInfo delayed_stages
        from app.domains.workflow.models import ChapterInfo
        import json
        chapter_info = db.execute(
            select(ChapterInfo)
            .where(
                ChapterInfo.project == project,
                ChapterInfo.chapters == chapters
            )
        ).scalars().first()
        if chapter_info:
            current_delays = {}
            if chapter_info.delayed_stages:
                try:
                    current_delays = json.loads(chapter_info.delayed_stages)
                    if not isinstance(current_delays, dict):
                        current_delays = {}
                except Exception:
                    current_delays = {}
            if from_detail.delayed:
                current_delays[from_detail.stage_name] = from_detail.delay_days
            else:
                current_delays.pop(from_detail.stage_name, None)
            chapter_info.delayed_stages = json.dumps(current_delays)

    
    to_detail = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == payload.to_stage
        )
    ).scalars().first()
    
    if not to_detail:
        to_detail = StageDetail(
            client=from_detail.client if from_detail else project,
            project=project,
            chapters=chapters,
            stage_name=payload.to_stage,
            workflow=from_detail.workflow if from_detail else "Workflow1",
        )
        db.add(to_detail)
    
    from app.domains.workflow.models import WorkflowMaster
    wf_name = to_detail.workflow
    wf_stage = db.execute(
        select(WorkflowMaster)
        .where(
            WorkflowMaster.workflow_name == wf_name,
            WorkflowMaster.stage_name == payload.to_stage
        )
    ).scalars().first()

    if wf_stage and not wf_stage.next_stage:
        to_detail.stage_status = "Completed"
        to_detail.actual_end_date = transition_time
    else:
        to_detail.stage_status = "In-progress"
        to_detail.actual_end_date = None

    # Auto-assign stage owner based on StageMaster.owner_designation
    client_ident = from_detail.client if from_detail else None
    owner_user = resolve_stage_owner_by_designation(
        db, payload.to_stage, project_code=project, client_identifier=client_ident
    )
    if owner_user:
        to_detail.assignee_name = owner_user.username
        from app.domains.workflow.models import ChapterInfo
        ch_info = db.execute(
            select(ChapterInfo).where(
                ChapterInfo.project == project,
                ChapterInfo.chapters == chapters
            )
        ).scalars().first()
        if ch_info:
            ch_info.current_assignee_name = owner_user.username

    to_detail.actual_start_date = transition_time
    
    db.commit()
    db.refresh(to_detail)
    return to_detail


class ShiftDatesPayload(BaseModel):
    chapters: str
    stage_names: List[str]
    days: int


@router.post("/stage-details/project/{project}/shift-planned-dates")
def shift_planned_dates(project: str, payload: ShiftDatesPayload, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from datetime import timedelta
    details = db.execute(
        select(StageDetail)
        .where(
            StageDetail.project == project,
            StageDetail.chapters == payload.chapters,
            StageDetail.stage_name.in_(payload.stage_names)
        )
    ).scalars().all()
    
    for d in details:
        if d.planned_start_date:
            d.planned_start_date += timedelta(days=payload.days)
        if d.planned_end_date:
            d.planned_end_date += timedelta(days=payload.days)
            
    db.commit()
    return {"ok": True}


# ── WorkflowMaster Endpoints ──────────────────────────────────────────────────

@router.post("/workflows", response_model=List[WorkflowStageResponse], status_code=status.HTTP_201_CREATED)
def create_workflow(data: WorkflowCreate, db: Session = Depends(get_db)):
    return crud.create_workflow(db, data)


@router.get("/workflows", response_model=List[str])
def list_workflows(db: Session = Depends(get_db)):
    workflows = crud.get_all_workflows(db)
    seen = set()
    names = []
    for wf in workflows:
        if wf.workflow_name not in seen:
            seen.add(wf.workflow_name)
            names.append(wf.workflow_name)
    return names


@router.get("/workflows/all", response_model=List[WorkflowStageResponse])
def list_all_workflow_stages(db: Session = Depends(get_db)):
    return crud.get_all_workflows(db)


@router.get("/workflows/{workflow_name}", response_model=List[WorkflowStageResponse])
def get_workflow(workflow_name: str, db: Session = Depends(get_db)):
    workflows = crud.get_workflow_by_name(db, workflow_name)
    if not workflows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflows


@router.put("/workflows/{workflow_name}", response_model=List[WorkflowStageResponse])
def update_workflow(workflow_name: str, data: WorkflowUpdate, db: Session = Depends(get_db)):
    existing = crud.get_workflow_by_name(db, workflow_name)
    if not existing:
        raise HTTPException(status_code=404, detail="Workflow not found")
    crud.delete_workflow(db, workflow_name)
    new_data = WorkflowCreate(
        workflow_name=data.workflow_name or workflow_name,
        description=data.description,
        active_status=data.active_status if data.active_status is not None else True,
        stages=data.stages
    )
    return crud.create_workflow(db, new_data)


@router.delete("/workflows/{workflow_name}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(workflow_name: str, db: Session = Depends(get_db)):
    if not crud.delete_workflow(db, workflow_name):
        raise HTTPException(status_code=404, detail="Workflow not found")


@router.get("/workflows/{workflow_name}/next/{stage_name}", response_model=dict)
def get_next_stage(workflow_name: str, stage_name: str, db: Session = Depends(get_db)):
    stages = crud.get_workflow_by_name(db, workflow_name)
    if not stages:
        raise HTTPException(status_code=404, detail="Workflow not found")
    stage = next((s for s in stages if s.stage_name == stage_name), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found in workflow")
    return {"next_stage": stage.next_stage}


@router.get("/workflows/{workflow_name}/previous/{stage_name}", response_model=dict)
def get_previous_stage(workflow_name: str, stage_name: str, db: Session = Depends(get_db)):
    stages = crud.get_workflow_by_name(db, workflow_name)
    if not stages:
        raise HTTPException(status_code=404, detail="Workflow not found")
    stage = next((s for s in stages if s.stage_name == stage_name), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Stage not found in workflow")
    return {"previous_stage": stage.previous_stage}


# ── ChapterInfo Endpoints ─────────────────────────────────────────────────────

@router.post("/chapter-infos", response_model=ChapterInfoResponse, status_code=status.HTTP_201_CREATED)
def create_chapter_info(data: ChapterInfoCreate, db: Session = Depends(get_db)):
    return crud.create_chapter_info(db, data)


@router.get("/chapter-infos", response_model=List[ChapterInfoResponse])
def list_chapter_infos(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    return crud.get_chapter_infos(db, skip=skip, limit=limit)


@router.get("/chapter-infos/{chapter_id}", response_model=ChapterInfoResponse)
def get_chapter_info(chapter_id: int, db: Session = Depends(get_db)):
    chapter = crud.get_chapter_info(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter info not found")
    return chapter


@router.put("/chapter-infos/{chapter_id}", response_model=ChapterInfoResponse)
def update_chapter_info(chapter_id: int, data: ChapterInfoUpdate, db: Session = Depends(get_db)):
    updated = crud.update_chapter_info(db, chapter_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Chapter info not found")
    return updated


@router.delete("/chapter-infos/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chapter_info(chapter_id: int, db: Session = Depends(get_db)):
    if not crud.delete_chapter_info(db, chapter_id):
        raise HTTPException(status_code=404, detail="Chapter info not found")


@router.get("/users-lookup")
def list_users_lookup(db: Session = Depends(get_db)):
    from app.domains.auth.models import User
    users = db.query(User).all()
    results = []
    for u in users:
        fn = (u.first_name or "").strip()
        ln = (u.last_name or "").strip()
        full_name = fn
        if fn and ln:
            if fn.lower().endswith(ln.lower()):
                full_name = fn
            else:
                full_name = f"{fn} {ln}"
        elif not full_name:
            full_name = ln or u.username
        results.append({
            "id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "full_name": full_name,
            "role": u.role,
        })
    return results

