"""
API router for Ninja Inkflow Language Editing.
Provides endpoints for rule management (CE support JSON sync), job execution, finding reviews, and redlined DOCX export.
"""
import datetime
import hashlib
import json
import logging
import os
import uuid
from typing import Any, Iterable, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie, get_user_full_name
from app.domains.processing.language_edit_models import LanguageEditJob, LanguageEditFinding
from app.domains.processing.service import check_permission
from app.models import User

from app.processing.language_editing import (
    abbreviations,
    abbreviations_metadata,
    basic_grammar,
    custom_dict,
    docx_io,
    engine,
    segmenter,
    spell_check,
)
from app.processing.language_editing.rules import load_rules_from_dict, load_house_style_from_dict
from app.services.language_rule_service import (
    get_available_style_profiles,
    get_project_language_rules,
    get_project_language_rules_history,
    save_project_language_rules,
    add_project_custom_rule,
    delete_project_custom_rule,
)

# Roles permitted to edit (not just view) the per-project rule selection.
RULES_EDIT_ROLES = {
    "admin",
    "projectmanager",
    "project manager",
    "editorial manager",
    "editorialmanager",
    "team lead - language editing",
    "team lead language editing",
    "team leader - language editing",
    "team leader language editing",
    "team lead - editorial",
    "technical editor",
    "technicaleditor",
}

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v2", tags=["Language Editing"])


def _require_language_user(user: Optional[User]) -> User:
    """Require an authenticated user with Language Editing permission.

    Raises 401 if the request has no valid session cookie, 403 if the user's
    roles don't include any member of PROCESS_PERMISSIONS["language"].
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    check_permission(user, "language", logger=logger)
    return user


def _require_rules_editor(user: Optional[User]) -> User:
    """Require Admin or Project Manager to edit the per-project rule selection.

    Language Editors can read rules (via `_require_language_user`) but cannot
    change which rules are active for a project.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user_role_names = {(role.name or "").strip().lower() for role in user.roles}
    if not (user_role_names & RULES_EDIT_ROLES):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only Admin or Project Manager can edit the Rules selection. "
                f"Your roles: {', '.join(sorted(user_role_names)) or 'none'}"
            ),
        )
    return user


# ── Pydantic Request Models ──────────────────────────────────────────────────

class SaveRulesRequest(BaseModel):
    profile_key: Optional[str] = None            # single-style (backward compat)
    profile_keys: Optional[list[str]] = None     # multi-style (new)
    rules: Optional[list[dict[str, Any]]] = None
    variant_to_canonical: Optional[dict[str, str]] = None
    profile_name: Optional[str] = None
    note: Optional[str] = None
    # Workbook-driven dash/hyphen style axis — "all" | "mw_dictionary" |
    # "chicago_ama_apa". Omit to inherit the project's existing value
    # (or the backward-compatible default of "all").
    dash_profile: Optional[str] = None
    # Scope C per-rule overrides. Sparse: ``{rule_id: {enabled?: bool,
    # tool_behaviour?: 'flag' | 'auto_replace'}}``. Applies to BOTH profile
    # rules and workbook rules — the engine merges on top of each rule's
    # file default at analyze time. Omit to inherit the project's existing
    # overrides map.
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None
    # Phase B abbreviations settings. Omit to inherit the project's
    # existing values. ``audience`` is 'general' | 'professional';
    # ``min_uses`` is a positive integer (workbook default 2).
    audience: Optional[str] = None
    min_uses: Optional[int] = None
    # Phase C AB16: scope_reset. When True, first-use rules re-fire at
    # every detectable scope boundary. Phase C ships per-paragraph as a
    # crude approximation; Phase D will add real boundary detection.
    scope_reset: Optional[bool] = None
    # Medical Terminology workbook (M-D): per-project style profile.
    # 'All' | 'US spelling' | 'UK spelling' | 'Possessive' | 'Nonpossessive'.
    # Omit to inherit the project's existing value (default 'All').
    medical_style_profile: Optional[str] = None
    # UK/US Spelling workbook (S-C): per-project document variant for
    # direction-aware regional spelling. 'en-US' | 'en-GB' | 'en-GB-oxendict'.
    # Omit to inherit the project's existing value (default inferred
    # from profile_keys[0]).
    document_variant: Optional[str] = None


class CustomRuleRequest(BaseModel):
    """Scope D: a user-authored regex rule promoted from the editor's
    regex playground into persistent project rules. The service layer
    validates ``pattern``, ``flags``, ``replacement``, ``category``,
    ``severity`` and ``tool_behaviour`` — see
    ``language_rule_service._validate_custom_rule``."""
    pattern: str
    replacement: Optional[str] = None
    flags: Optional[list[str]] = None
    message: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    tool_behaviour: Optional[str] = None
    id: Optional[str] = None


class DecisionRequest(BaseModel):
    status: str  # accepted | edited | rejected
    edited_text: Optional[str] = None
    reviewer: Optional[str] = "editor"


class BatchDecisionItem(BaseModel):
    finding_id: int
    edited_text: Optional[str] = None


class BatchDecideRequest(BaseModel):
    """Bulk decide payload. ``status`` applies to every item; per-item
    ``edited_text`` is only consulted when ``status == 'edited'``. The
    client can mix any subset of a single job's pending findings — the
    endpoint silently skips ones that don't belong to the job rather
    than failing the whole batch (partial-failure semantics)."""
    status: str  # accepted | edited | rejected | highlighted
    reviewer: Optional[str] = "editor"
    decisions: list[BatchDecisionItem]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/language-rules")
def get_project_rules(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Fetch current project language rules from CE support along with available base profiles.

    Scope C: the response also carries the 875 Hyphenation workbook rules
    normalised into the unified LanguageRule wire shape with the project's
    per-rule overrides merged on top, plus a cheap summary tuple for the
    Rules Picker header stats.
    """
    _require_language_user(current_user)
    active_rules = get_project_language_rules(db, project_id=project_id)
    available_profiles = get_available_style_profiles()

    from app.processing.language_editing import workbook_rules_surface as _ws
    overrides = active_rules.get("rule_overrides") or {}
    try:
        hyphen_rules = _ws.list_hyphenation_rules(overrides)
        hyphen_summary = _ws.hyphenation_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface hyphenation workbook rules: %s", exc)
        hyphen_rules = []
        hyphen_summary = {"total": 0, "enabled": 0, "flag": 0, "auto_replace": 0}
    try:
        abbr_rules = _ws.list_abbreviation_rules(overrides)
        abbr_summary = _ws.abbreviation_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface abbreviations workbook rules: %s", exc)
        abbr_rules = []
        abbr_summary = {"total": 0, "enabled": 0, "flag": 0, "auto_replace": 0}
    try:
        medical_rules = _ws.list_medical_terms_rules(overrides)
        medical_summary = _ws.medical_terms_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface medical terms workbook rules: %s", exc)
        medical_rules = []
        medical_summary = {"total": 0, "enabled": 0, "flag": 0, "auto_replace": 0}
    try:
        uk_us_rules = _ws.list_uk_us_spelling_rules(overrides)
        uk_us_summary = _ws.uk_us_spelling_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface uk_us spelling workbook rules: %s", exc)
        uk_us_rules = []
        uk_us_summary = {"total": 0, "enabled": 0, "flag": 0, "auto_replace": 0}
    try:
        lww_ne_rules = _ws.list_lww_ne_rules(overrides)
        lww_ne_summary = _ws.lww_ne_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface LWW-NE workbook rules: %s", exc)
        lww_ne_rules = []
        lww_ne_summary = {"total": 0, "enabled": 0, "flag": 0, "auto_replace": 0}
    try:
        basic_grammar_rules = _ws.list_basic_grammar_rules(overrides)
        basic_grammar_summary = _ws.basic_grammar_rule_summary(overrides)
    except Exception as exc:
        logger.warning("Failed to surface Basic Grammar workbook rules: %s", exc)
        basic_grammar_rules = []
        basic_grammar_summary = {"total": 0, "enabled": 0, "reused": 0, "disabled": 0,
                                 "manual_review": 0, "flag": 0, "auto_replace": 0}

    # Scope D: user-authored custom regex rules. Each entry is normalised
    # by the service at save time; here we only apply the per-rule
    # override map on top so the Rules Picker renders the same wire shape
    # as workbook rules (enabled flag + tool_behaviour + override badge).
    custom_rules: list[dict[str, Any]] = []
    for raw in (active_rules.get("custom_rules") or []):
        if not isinstance(raw, dict):
            continue
        rule = dict(raw)
        rule.setdefault("source_of", "custom")
        rule.setdefault("origin", "custom")
        o = overrides.get(rule.get("id") or "")
        if isinstance(o, dict):
            if "enabled" in o:
                rule["enabled"] = bool(o["enabled"])
            if o.get("tool_behaviour") in ("flag", "auto_replace"):
                rule["tool_behaviour"] = o["tool_behaviour"]
            rule["is_overridden"] = True
            rule["override"] = {k: v for k, v in o.items() if k in ("enabled", "tool_behaviour")}
        custom_rules.append(rule)
    custom_summary = {
        "total": len(custom_rules),
        "enabled": sum(1 for r in custom_rules if r.get("enabled", True)),
        "flag": sum(1 for r in custom_rules if (r.get("tool_behaviour") or "flag") == "flag"),
        "auto_replace": sum(1 for r in custom_rules if r.get("tool_behaviour") == "auto_replace"),
    }

    return {
        "active_rules": active_rules,
        "available_profiles": available_profiles,
        "workbook_rules": {
            "hyphenation": hyphen_rules,
            "abbreviations": abbr_rules,
            "medical_terms": medical_rules,
            "uk_us_spelling": uk_us_rules,
            "lww_ne": lww_ne_rules,
            "basic_grammar": basic_grammar_rules,
            "custom": custom_rules,
        },
        "workbook_summary": {
            "hyphenation": hyphen_summary,
            "abbreviations": abbr_summary,
            "medical_terms": medical_summary,
            "uk_us_spelling": uk_us_summary,
            "lww_ne": lww_ne_summary,
            "basic_grammar": basic_grammar_summary,
            "custom": custom_summary,
        },
    }


@router.post("/projects/{project_id}/language-rules")
def update_project_rules(
    project_id: int,
    body: SaveRulesRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
    user=Depends(get_current_user_from_cookie)
):
    """Save/update project language rules, syncing JSON to project's CE support folder.

    Only Admin or Project Manager may change the selection. An audit row is
    written to `project_language_rules_history` capturing the full previous
    and new rule sets plus a summary of which rule IDs were enabled/disabled.
    """
    _require_rules_editor(current_user)
    # Reconcile single vs multi-style payloads (frontend may send either).
    pkeys = body.profile_keys
    if not pkeys:
        pkeys = [body.profile_key] if body.profile_key else ["uk"]
    try:
        # If the client omits dash_profile / rule_overrides, honour whatever
        # the project already had on disk — "no change" semantics for a
        # partial save.
        existing = None
        dash_profile = body.dash_profile
        if dash_profile is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            dash_profile = existing.get("dash_profile")
        rule_overrides = body.rule_overrides
        if rule_overrides is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            rule_overrides = existing.get("rule_overrides") or {}
        audience = body.audience
        if audience is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            audience = existing.get("audience")
        min_uses = body.min_uses
        if min_uses is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            min_uses = existing.get("min_uses")
        scope_reset = body.scope_reset
        if scope_reset is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            scope_reset = existing.get("scope_reset")
        medical_style_profile = body.medical_style_profile
        if medical_style_profile is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            medical_style_profile = existing.get("medical_style_profile")
        document_variant = body.document_variant
        if document_variant is None:
            existing = existing or get_project_language_rules(db, project_id=project_id)
            document_variant = existing.get("document_variant")
        # Scope D: the main save endpoint never clobbers custom_rules — a
        # style-profile switch or override toggle should preserve the
        # project's authored rules. Dedicated POST/DELETE endpoints handle
        # mutations to that list.
        existing = existing or get_project_language_rules(db, project_id=project_id)
        preserved_custom = existing.get("custom_rules") or []
        updated = save_project_language_rules(
            db,
            project_id=project_id,
            profile_keys=pkeys,
            rules=body.rules,
            variant_to_canonical=body.variant_to_canonical,
            profile_name=body.profile_name,
            changed_by_id=current_user.id,
            note=body.note,
            dash_profile=dash_profile,
            rule_overrides=rule_overrides,
            audience=audience,
            min_uses=min_uses,
            scope_reset=scope_reset,
            custom_rules=preserved_custom,
            medical_style_profile=medical_style_profile,
            document_variant=document_variant,
        )
        db.commit()
        return {"ok": True, "rules": updated}
    except ValueError as err:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(err))
    except Exception as exc:
        db.rollback()
        logger.error("Failed to update language rules: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/projects/{project_id}/language-rules/custom")
def add_custom_rule(
    project_id: int,
    body: CustomRuleRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Scope D: persist a user-authored regex rule.

    Admin / Project Manager only (same gate as rule-selection edits).
    Returns the stored rule dict including the generated id. On a
    validation failure (bad regex, duplicate id, unknown category),
    responds 400 with the service's user-facing error message.
    """
    _require_rules_editor(current_user)
    try:
        new_rule = add_project_custom_rule(
            db,
            project_id=project_id,
            draft=body.model_dump(exclude_none=True),
            created_by_id=current_user.id,
        )
        db.commit()
        return {"ok": True, "rule": new_rule}
    except ValueError as err:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as exc:
        db.rollback()
        logger.error("Failed to add custom language rule: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/projects/{project_id}/language-rules/custom/{rule_id}")
def remove_custom_rule(
    project_id: int,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Scope D: delete a user-authored regex rule by id."""
    _require_rules_editor(current_user)
    try:
        removed = delete_project_custom_rule(
            db, project_id=project_id, rule_id=rule_id,
            changed_by_id=current_user.id,
        )
        if not removed:
            raise HTTPException(status_code=404, detail=f"Custom rule {rule_id!r} not found")
        db.commit()
        return {"ok": True, "removed": rule_id}
    except HTTPException:
        db.rollback()
        raise
    except ValueError as err:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete custom language rule: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/projects/{project_id}/language-rules/history")
def get_project_rules_history(
    project_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Return newest-first audit entries for a project's rule changes."""
    _require_language_user(current_user)
    return {
        "project_id": project_id,
        "history": get_project_language_rules_history(db, project_id=project_id, limit=limit),
    }


@router.get("/projects/{project_id}/language-rules/export")
def export_project_rules_json(
    project_id: int,
    download: bool = False,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Serialise the project's rule selection to JSON.

    Default is inline (``application/json``) for the View-JSON modal. Pass
    ``?download=true`` to return an attachment the browser saves as
    ``{project_code}_language_rules.json``.
    """
    import json as _json
    from fastapi.responses import Response

    _require_language_user(current_user)
    cfg = get_project_language_rules(db, project_id=project_id)
    code = cfg.get("project_code") or f"project-{project_id}"
    body = _json.dumps(cfg, indent=2, ensure_ascii=False)
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{code}_language_rules.json"'
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/projects/{project_id}/language-rules/export.xlsx")
def export_project_rules_xlsx(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Download the project's rule selection as an Excel workbook.

    Mirrors the per-project JSON config (same source — the CE Support JSON on
    disk). The workbook has one sheet "Language Rules" with columns:
    Rule ID, Message/Description, Category, Severity, Type, Enabled,
    Pattern, Replacement. Enabled rules are highlighted; disabled rules are
    greyed out so the editor can scan the active set at a glance.
    """
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    _require_language_user(current_user)
    cfg = get_project_language_rules(db, project_id=project_id)
    code = cfg.get("project_code") or f"project-{project_id}"
    rules = cfg.get("rules") or []
    enabled_count = sum(1 for r in rules if r.get("enabled", True))

    wb = Workbook()
    ws = wb.active
    ws.title = "Language Rules"

    # ── Metadata header rows ──────────────────────────────────────────────
    thin = Side(border_style="thin", color="DDDDDD")
    border = Border(top=thin, bottom=thin, left=thin, right=thin)
    brand_fill = PatternFill("solid", fgColor="312E81")  # indigo-900
    header_fill = PatternFill("solid", fgColor="EEF2FF")
    enabled_fill = PatternFill("solid", fgColor="ECFDF5")  # emerald-50
    disabled_fill = PatternFill("solid", fgColor="F8FAFC")  # slate-50
    sev_fills = {
        "error":      PatternFill("solid", fgColor="FEE2E2"),  # rose-100
        "warning":    PatternFill("solid", fgColor="FEF3C7"),  # amber-100
        "suggestion": PatternFill("solid", fgColor="DBEAFE"),  # sky-100
    }

    ws["A1"] = "Language Editing Rules"
    ws["A1"].font = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    ws["A1"].fill = brand_fill
    ws.merge_cells("A1:H1")
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 32

    meta_rows = [
        ("Project",            code),
        ("Profile",            (cfg.get("profile_key") or "uk").upper()),
        ("Profile name",       cfg.get("name") or ""),
        ("Total rules",        str(len(rules))),
        ("Enabled rules",      f"{enabled_count} / {len(rules)}"),
        ("Variants in dict",   str(len(cfg.get("variant_to_canonical") or {}))),
    ]
    for i, (k, v) in enumerate(meta_rows, start=2):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True, color="475569")
        ws.cell(row=i, column=2, value=v).font = Font(color="0F172A")

    # ── Rules table ───────────────────────────────────────────────────────
    header_row_idx = len(meta_rows) + 3  # one blank gap
    headers = ["Rule ID", "Message / Description", "Category", "Severity", "Type", "Enabled", "Pattern", "Replacement"]
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=header_row_idx, column=col, value=h)
        c.font = Font(bold=True, color="312E81")
        c.fill = header_fill
        c.alignment = Alignment(vertical="center")
        c.border = border

    for i, r in enumerate(rules, start=header_row_idx + 1):
        enabled = r.get("enabled", True)
        row_fill = enabled_fill if enabled else disabled_fill
        sev = (r.get("severity") or "").lower()
        values = [
            r.get("id", ""),
            r.get("message", ""),
            (r.get("category") or "").title(),
            sev.title(),
            r.get("type", ""),
            "YES" if enabled else "no",
            r.get("pattern", "") or "",
            "" if r.get("replacement") is None else str(r.get("replacement")),
        ]
        for col, val in enumerate(values, start=1):
            c = ws.cell(row=i, column=col, value=val)
            c.fill = row_fill
            c.border = border
            c.alignment = Alignment(vertical="center", wrap_text=col == 2)
            if col == 1:
                c.font = Font(name="Consolas", bold=True, color="0F172A" if enabled else "94A3B8")
            elif col == 4 and sev in sev_fills:
                c.fill = sev_fills[sev]
                c.font = Font(bold=True, color="0F172A" if enabled else "94A3B8")
            elif col == 6:
                c.font = Font(bold=True, color="059669" if enabled else "94A3B8")
                c.alignment = Alignment(horizontal="center", vertical="center")
            elif col in (7, 8):
                c.font = Font(name="Consolas", color="334155" if enabled else "94A3B8")
            else:
                c.font = Font(color="0F172A" if enabled else "94A3B8")

    # Column widths
    widths = [14, 50, 14, 14, 10, 10, 36, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Freeze header
    ws.freeze_panes = ws.cell(row=header_row_idx + 1, column=1)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    headers = {"Content-Disposition": f'attachment; filename="{code}_language_rules.xlsx"'}
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.get("/files/{file_id}/language-edit/info")
def get_language_edit_file_info(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Lightweight metadata lookup for the Language Editor header.

    Returns the real uploaded filename + project/chapter identifiers so the
    editor header can render immediately on mount, without waiting for the
    (slow) analyze pass to finish. Separate from `analyze` so switching
    between documents never leaves a stale title on screen.
    """
    _require_language_user(current_user)
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail=f"File ID {file_id} not found.")
    return {
        "file_id": file_record.id,
        "file_name": file_record.filename or "",
        "project_id": file_record.project_id,
        "chapter_id": file_record.chapter_id,
    }


# ─── Analysis cache helpers ──────────────────────────────────────────
#
# A completed ``LanguageEditJob`` is keyed by
# ``(file_id, content_hash, rules_hash)``. A repeat analyze request on
# the same file + configuration short-circuits to the existing job
# instead of rerunning the engine. The UNIQUE constraint on the triple
# also makes the insert race-safe: concurrent callers that both miss
# converge via IntegrityError onto the first writer's job_id.

_FILE_HASH_CHUNK = 1 << 20  # 1 MiB — bounded memory for large DOCX files.


def _sha256_of_file(path: str) -> str:
    """sha256 of the file bytes on disk. ~20ms for a 10 MB DOCX —
    negligible compared to a full engine pass."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(_FILE_HASH_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _sha256_of_rules_input(
    project_rules_cfg: dict,
    assigned_term_list_ids: Iterable[int],
) -> str:
    """Canonical sha256 over every analysis-affecting configuration
    input. Any change to any field — including CACHE_VERSION — produces
    a different hash and forces a fresh analyze on the next request."""
    canonical = {
        "cache_version": engine.CACHE_VERSION,
        "profile_key": project_rules_cfg.get("profile_key"),
        "profile_keys": sorted(project_rules_cfg.get("profile_keys") or []),
        "dash_profile": project_rules_cfg.get("dash_profile"),
        "audience": project_rules_cfg.get("audience"),
        "min_uses": project_rules_cfg.get("min_uses"),
        "scope_reset": project_rules_cfg.get("scope_reset"),
        "medical_style_profile": project_rules_cfg.get("medical_style_profile"),
        "document_variant": project_rules_cfg.get("document_variant"),
        "rules": project_rules_cfg.get("rules") or [],
        "custom_rules": project_rules_cfg.get("custom_rules") or [],
        "rule_overrides": project_rules_cfg.get("rule_overrides") or {},
        "variant_to_canonical": project_rules_cfg.get("variant_to_canonical") or {},
        "term_list_ids": sorted(int(tid) for tid in assigned_term_list_ids),
    }
    blob = json.dumps(canonical, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _acquire_file_analysis_lock(db: Session, file_id: int) -> None:
    """Postgres: serialise concurrent analyzes on the same file via a
    transaction-scoped advisory lock. SQLite: no-op (tests + dev); the
    UNIQUE constraint on (file_id, content_hash, rules_hash) still
    protects against duplicate singleton rows via IntegrityError."""
    dialect = db.bind.dialect.name if db.bind is not None else ""
    if dialect != "postgresql":
        return
    # ``pg_advisory_xact_lock`` releases automatically at COMMIT /
    # ROLLBACK, so there's no manual cleanup. 64-bit int keyspace;
    # we hash a stable string so two different file_ids can't collide.
    key = int(hashlib.sha256(f"language_edit:{file_id}".encode()).hexdigest()[:15], 16)
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})


def _cached_job_response(
    db: Session,
    job: LanguageEditJob,
    file_record,
    compiled_term_lists,
    spell_checker,
) -> dict:
    """Shape the analyze response from a cached job row without
    re-running the engine. Mirrors the keys returned by the fresh-
    analyze path so clients can treat both responses identically. The
    added ``cached: true`` flag is additive — existing clients ignore
    unknown keys."""
    counts = (
        db.query(LanguageEditFinding.source, func.count())
        .filter(LanguageEditFinding.job_id == job.job_id)
        .group_by(LanguageEditFinding.source)
        .all()
    )
    by_source = {src or "rule": cnt for src, cnt in counts}
    return {
        "ok": True,
        "cached": True,
        "job_id": job.job_id,
        "total_findings": job.total_findings or sum(by_source.values()),
        "rule_findings": by_source.get("rule", 0),
        "term_matches": by_source.get("term", 0),
        "typo_matches": by_source.get("typo", 0),
        "spell_check_available": spell_checker is not None,
        "term_lists_applied": [
            {"id": cl.list_id, "name": cl.list_name} for cl in compiled_term_lists
        ],
        "file_name": file_record.filename,
    }


@router.post("/files/{file_id}/language-edit/analyze")
def start_language_edit_analysis(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Triggers rule engine analysis on target manuscript file using active CE support language rules."""
    _require_language_user(current_user)
    file_record = db.query(models.File).filter(models.File.id == file_id).first()
    if not file_record:
        raise HTTPException(status_code=404, detail=f"File ID {file_id} not found.")

    if not file_record.path or not os.path.exists(file_record.path):
        raise HTTPException(status_code=400, detail="Target file does not exist on disk.")

    if not file_record.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Language Editing is only supported for .docx files.")

    # Load project language rules from CE support
    project_rules_cfg = get_project_language_rules(db, project_id=file_record.project_id)
    # Scope D: user-authored regex rules sit alongside profile rules.
    # They were validated at save-time so re-compilation here is a cheap
    # repeat check. If one of them was corrupted on disk, drop that single
    # entry rather than failing the whole analyze pass.
    all_rule_dicts = list(project_rules_cfg.get("rules", []))
    for cr in (project_rules_cfg.get("custom_rules") or []):
        if isinstance(cr, dict):
            all_rule_dicts.append(cr)
    rules = load_rules_from_dict(all_rule_dicts)
    dictionary = load_house_style_from_dict(project_rules_cfg.get("variant_to_canonical", {}))

    # Compile the project's assigned term lists once (separate concern from rules).
    from app.processing.language_editing.term_matcher import build_matcher_for_project, find_term_matches
    compiled_term_lists = build_matcher_for_project(db, project_id=file_record.project_id)

    # LWW-NE workbook (Phase 2) — detect whether this project is tagged
    # as an "NE" project per decision Q2a. The term-list assignment is
    # the sole signal: if the project has the LWW_NE term list assigned,
    # the workbook's NE-tagged rows fire. Name-based lookup (with fallback
    # to historical id=11) makes this robust across environments. No new
    # DB schema is required — reuses existing project_term_lists table.
    from app.processing.language_editing import lww_ne as _lww_ne
    try:
        from app.domains.term_lists.models import ProjectTermList
        _assigned_term_list_ids = {
            pt.term_list_id for pt in
            db.query(ProjectTermList)
              .filter(ProjectTermList.project_id == file_record.project_id)
              .all()
        }
        _lww_ne_id = _lww_ne.get_lww_ne_term_list_id(db)
        is_lww_ne_project = _lww_ne_id in _assigned_term_list_ids
    except Exception:
        logger.exception(
            "Failed to resolve LWW-NE project status for project_id=%s; "
            "defaulting to False (NE-tagged workbook rows will not fire)",
            file_record.project_id,
        )
        is_lww_ne_project = False
    project_profile_keys = project_rules_cfg.get("profile_keys") or []

    # Build the spell-check whitelist once per analyze run. Terms, house-style
    # canonical pairs, and UK/US pair words are all considered correct — so
    # pyspellchecker won't flag them as typos.
    try:
        from app.processing.manuscript_core.data.uk_us_pairs import UK_US_PAIRS  # type: ignore
    except Exception:
        UK_US_PAIRS = []  # type: ignore
    term_vocab: list[str] = []
    for cl in compiled_term_lists:
        # CompiledTermList.term_lookup is {lowercased_term: term_id}.
        lookup = getattr(cl, "term_lookup", None)
        if isinstance(lookup, dict):
            term_vocab.extend(lookup.keys())
    # Client-supplied custom dictionaries (medical / pharmaceutical / etc.)
    # loaded from app/processing/language_editing/config/dictionaries/ plus
    # anything listed in $CMS_LANGEDIT_CUSTOM_DICTS. Cached per-process.
    custom_dict_words = custom_dict.load_all_custom_dicts()
    # Medical Terminology workbook preferred spellings (1055 entries) feed
    # the spell-check whitelist so correct medical terms never surface as
    # typos. Applied globally — the workbook is enabled for every project.
    from app.processing.language_editing import medical_terms as _medical_terms
    try:
        medical_whitelist = _medical_terms.preferred_terms()
    except Exception as exc:
        logger.warning("Failed to load medical terms whitelist: %s", exc)
        medical_whitelist = frozenset()

    # UK/US Spelling workbook: feed pyspellchecker whitelist with the
    # project's preferred spellings for the active document_variant,
    # plus the 552 Common_Spellings (always-valid words like advertise /
    # advise / comprise) and the Protected_Terms phrases (WHO / ISO /
    # NIH …). Direction-aware — a UK project gets 'colour', 'organise'
    # etc; a US project gets 'color', 'organize'.
    from app.processing.language_editing import uk_us_spelling as _uk_us
    document_variant = project_rules_cfg.get("document_variant") or "en-GB"
    try:
        uk_us_whitelist = _uk_us.preferred_terms_for(document_variant)
        uk_us_common = _uk_us._common_spellings_lc()
        uk_us_protected = _uk_us.protected_phrases()
    except Exception as exc:
        logger.warning("Failed to load uk_us_spelling whitelist: %s", exc)
        uk_us_whitelist = frozenset()
        uk_us_common = frozenset()
        uk_us_protected = []
    spell_whitelist = spell_check.build_whitelist(
        variant_to_canonical=project_rules_cfg.get("variant_to_canonical", {}),
        uk_us_pairs=UK_US_PAIRS,
        term_vocabulary=term_vocab,
        extras=(
            list(custom_dict_words)
            + list(medical_whitelist)
            + list(uk_us_whitelist)
            + list(uk_us_common)
            + uk_us_protected
        ),
    )
    # Also feed custom dict words into pyspellchecker's known-word frequency
    # table so morphological variants (plurals, -ed forms) of a dic entry
    # resolve via spell_check._morph_variants without needing every form in
    # the dic.
    spell_checker = spell_check.get_spell_checker(
        custom_words=custom_dict_words,
    )  # None if pyspellchecker missing

    # ─── Cache lookup ────────────────────────────────────────────────
    # Compute the (file, config) cache key and short-circuit to the
    # existing job if a matching one is already persisted. All setup
    # above is cheap; the expensive work (DOCX read + classify + the
    # engine loop below + bulk insert of findings) is what we skip.
    #
    # Postgres: serialise concurrent analyzes on the same file via an
    # advisory lock so the second caller waits for the first to commit
    # and then hits the cache. SQLite: no-op; the UNIQUE constraint on
    # (file_id, content_hash, rules_hash) still prevents duplicate rows
    # via IntegrityError.
    try:
        content_hash = _sha256_of_file(file_record.path)
    except OSError as exc:
        logger.error("Failed to hash DOCX for cache lookup: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to read target DOCX file.")
    rules_hash = _sha256_of_rules_input(project_rules_cfg, _assigned_term_list_ids)

    _acquire_file_analysis_lock(db, file_record.id)

    cached = (
        db.query(LanguageEditJob)
        .filter(
            LanguageEditJob.file_id == file_record.id,
            LanguageEditJob.content_hash == content_hash,
            LanguageEditJob.rules_hash == rules_hash,
            LanguageEditJob.status.in_(("in_review", "completed")),
        )
        .order_by(LanguageEditJob.created_at.desc())
        .first()
    )
    if cached is not None:
        return _cached_job_response(
            db, cached, file_record, compiled_term_lists, spell_checker,
        )

    # Read paragraphs from DOCX
    try:
        doc_obj, paragraphs = docx_io.read_paragraphs(file_record.path)
    except Exception as exc:
        logger.error("Failed to read DOCX at %s: %s", file_record.path, exc)
        raise HTTPException(status_code=500, detail="Failed to read target DOCX file.")

    # Phase D: paragraph-role metadata for the abbreviations module.
    # ``classify_paragraphs`` walks every paragraph in the raw doc
    # (headings + body + tables + figures + abstract) so AB11 / AB12 /
    # AB15 / AB16 can branch on role. Legacy rule families ignore the
    # map; AB01-AB10 still fire using the filtered body ``paragraphs``.
    try:
        para_roles = docx_io.classify_paragraphs(doc_obj)
    except Exception as exc:
        logger.warning("Failed to classify paragraphs for Phase D: %s", exc)
        para_roles = {}

    job_uuid = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S_") + str(uuid.uuid4())[:8]
    job = LanguageEditJob(
        job_id=job_uuid,
        file_id=file_record.id,
        project_id=file_record.project_id,
        status="in_review",
        total_findings=0,
        content_hash=content_hash,
        rules_hash=rules_hash,
    )
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent analyze finished between our cache-miss check and
        # our insert. Roll back, refetch the winner, and return its
        # cached response — both callers now share the same job_id.
        db.rollback()
        winner = (
            db.query(LanguageEditJob)
            .filter(
                LanguageEditJob.file_id == file_record.id,
                LanguageEditJob.content_hash == content_hash,
                LanguageEditJob.rules_hash == rules_hash,
            )
            .order_by(LanguageEditJob.created_at.desc())
            .first()
        )
        if winner is None:
            # Extraordinarily unlikely — unique-constraint error with no
            # row. Fall through and raise so the client retries.
            raise HTTPException(status_code=500, detail="Analyze race resolution failed.")
        return _cached_job_response(
            db, winner, file_record, compiled_term_lists, spell_checker,
        )

    total_findings_count = 0
    term_match_count = 0
    typo_count = 0
    findings_to_insert = []

    # Only word-level rule categories can dedupe a typo. A sentence-level
    # finding spans many words and legitimately coexists with a typo inside
    # it (different issues: sentence rewrite vs word spelling). Hyphenation
    # (workbook rules) is word-level and belongs in this set so a hyphen
    # fix on "age related" doesn't also surface as a typo on "related".
    _TYPO_DEDUP_CATEGORIES = {"spelling", "grammar", "compounds", "bias", "hyphenation", "medical_terms"}

    # Resolved dash profile. Workbook default is "all"; the service layer
    # has already backfilled this on load so legacy projects behave sanely.
    from app.processing.language_editing import hyphen_dash as _hyphen_dash
    dash_profile = project_rules_cfg.get("dash_profile") or "all"
    # Scope C: per-rule overrides apply to both profile rules (enable flag)
    # and workbook rules (enable + tool_behaviour). None → engine sees {}.
    rule_overrides = project_rules_cfg.get("rule_overrides") or {}
    # Phase B abbreviations settings — defaults applied here so project
    # configs without the fields keep working. Phase E adds the Rules
    # Picker UI; the fields are already round-trippable via the sidecar.
    audience = project_rules_cfg.get("audience") or "general"
    min_uses_raw = project_rules_cfg.get("min_uses")
    try:
        min_uses = int(min_uses_raw) if min_uses_raw is not None else 2
    except (TypeError, ValueError):
        min_uses = 2
    scope_reset = bool(project_rules_cfg.get("scope_reset") or False)
    # Medical Terminology workbook: style profile gates the ~313 subprofile
    # rules (US spelling, Possessive, Nonpossessive). ``All``-tagged rules
    # always fire. Default ``All`` keeps subprofile rules silent until the
    # project opts in via the Rules Picker.
    medical_style_profile = project_rules_cfg.get("medical_style_profile") or "All"
    # Re-use the document_variant resolved above for the spell-check
    # whitelist — it drives direction-aware uk_us_spelling finding emission.

    # Pre-compute the document-scope abbreviation state ONCE per analyze
    # request (or ONCE per paragraph when scope_reset is True — crude
    # Phase-C fallback until Phase D ships real boundary detection).
    # The per-paragraph loop below threads it into every engine.analyze
    # call so the abbreviations module can emit AB01 / AB02 / AB03 /
    # AB04 / AB05 / AB06 / AB07 / AB10 findings with full cross-paragraph
    # awareness.
    from app.processing.language_editing import abbreviations as _ab

    # Phase D: include heading / caption / table / figure paragraphs in
    # the state build so AB11 / AB12 / AB15 can see occurrences there.
    # ``paragraphs`` from read_paragraphs filters them out for the
    # existing rule families; we add them back via para_roles.text for
    # the abbreviation state only. The engine's per-paragraph analyze
    # loop still iterates only ``paragraphs`` — rules anchored to
    # heading/table paragraphs fire via Phase D's role-aware emitters
    # when the router passes those paragraphs separately below.
    #
    # References MUST be filtered out of the state build. The
    # per-paragraph gate below already blocks finding emission on
    # them, but the document-scope AB state (AB01 / AB02 / AB04 / AB05
    # / AB10) would otherwise count abbreviations inside reference
    # entries toward first-use / article-agreement tracking — the
    # exact pollution that leaks AB10 "aan" findings into body
    # paragraphs. ``read_paragraphs`` already drops entries carrying
    # REF-* styles and entries inside ``<ref-open>``/``<ref-close>``;
    # the filter here is a belt-and-braces catch for conventions it
    # can't detect (plain ``References`` heading followed by
    # Normal-styled entries — see ``classify_paragraphs``).
    def _roles_mark_as_reference(roles: dict) -> bool:
        return bool(roles.get("in_references") or roles.get("role") == "reference")

    body_para_set = {pi for pi, _ in paragraphs}
    enriched_paragraphs = [
        (pi, txt) for pi, txt in paragraphs
        if not _roles_mark_as_reference((para_roles or {}).get(pi) or {})
    ]
    for pi, roles in (para_roles or {}).items():
        if pi in body_para_set:
            continue
        if _roles_mark_as_reference(roles):
            continue
        if roles.get("role") in ("heading", "title", "caption") or roles.get("in_table") or roles.get("in_figure") or roles.get("in_abstract"):
            txt = (roles.get("text") or "").strip()
            if txt:
                enriched_paragraphs.append((pi, roles.get("text") or ""))
    enriched_paragraphs.sort(key=lambda t: t[0])

    def _build_state_for(paras):
        try:
            return _ab.build_document_state(
                paras, audience=audience, min_uses=min_uses,
                rule_overrides=rule_overrides, para_roles=para_roles,
            )
        except Exception as exc:
            logger.warning("Failed to build abbreviations document state: %s", exc)
            return {}

    if scope_reset:
        # Phase D: when chapter_boundary metadata is available, split by
        # chapter boundaries rather than per paragraph. Each chapter
        # gets its own document state; first-use rules re-fire at each
        # chapter's first mention. Falls back to per-paragraph when no
        # boundaries are detected (short documents).
        chapter_bounds = sorted(
            pi for pi, r in (para_roles or {}).items() if r.get("chapter_boundary")
        )
        abbr_state_by_para: dict[int, dict] = {}
        if chapter_bounds:
            # Build a chapter → [(para_idx, text), …] grouping.
            scopes: list[list[tuple[int, str]]] = [[]]
            cur_boundary_iter = iter(chapter_bounds)
            next_bound = next(cur_boundary_iter, None)
            for pi, pt in enriched_paragraphs:
                while next_bound is not None and pi >= next_bound:
                    scopes.append([])
                    next_bound = next(cur_boundary_iter, None)
                scopes[-1].append((pi, pt))
            for scope in scopes:
                if not scope:
                    continue
                scope_state = _build_state_for(scope)
                for pi, _ in scope:
                    abbr_state_by_para[pi] = scope_state
        else:
            # No chapter boundaries detected → fall back to per-paragraph.
            for pi, pt in enriched_paragraphs:
                abbr_state_by_para[pi] = _build_state_for([(pi, pt)])
        abbr_state = None
    else:
        abbr_state_by_para = None
        abbr_state = _build_state_for(enriched_paragraphs)

    # Basic Grammar workbook (420 rules): document-scope detectors
    # GK-001/002/003 need counters over the whole manuscript (``-ise``
    # vs ``-ize`` majority, straight vs curly quote majority, serial
    # comma mix) so the per-paragraph analyzer can flag the minority
    # side. One pre-pass per analyze job keeps the per-paragraph call
    # path O(1) for this workbook.
    #
    # Critical: the state must be built from body paragraphs ONLY.
    # ``enriched_paragraphs`` (used by the abbreviation module) adds
    # heading / caption / table / figure / abstract paragraphs back in
    # for AB11 / AB12 / AB15 — feeding those to basic_grammar would
    # count ``-ise`` / ``-ize`` and quote-style usage inside excluded
    # regions and pollute document-wide consistency decisions. We
    # therefore filter against the same exclusion predicate the per-
    # paragraph analyze loop uses below.
    def _basic_grammar_input_paragraphs() -> list[tuple[int, str]]:
        """Body-only paragraph list for the doc-scope detectors.

        Mirrors the router's main-loop exclusion predicate exactly
        (see ``_EXCLUDED_ROLES`` / ``_EXCLUDED_REGION_FLAGS`` below).
        A drift would let GK-002 count quote characters that live
        inside a table / extract / references region, polluting the
        majority / minority decision."""
        out: list[tuple[int, str]] = []
        for pi, txt in paragraphs:
            roles = (para_roles or {}).get(pi) or {}
            if roles.get("role") in (
                "heading", "title", "reference", "caption", "extract",
            ):
                continue
            if any(roles.get(flag) for flag in (
                "in_table", "in_figure", "in_abstract", "in_epigraph",
                "in_src", "in_extract", "in_references",
            )):
                continue
            out.append((pi, txt))
        return out

    try:
        from app.processing.language_editing import basic_grammar as _basic_grammar

        def _strip_quoted_runs(txt: str) -> str:
            """Replace every ``"..."`` / ``“...”`` / ``«...»`` with
            space of equal length so GK-002's quote-character counter
            does not count content INSIDE quoted passages. Preserves
            paragraph length (offsets stay valid) while blanking the
            chars that would otherwise feed the majority/minority
            vote for the whole document."""
            spans = engine.build_quoted_text_spans(txt)
            if not spans:
                return txt
            chars = list(txt)
            for s, e in spans:
                for i in range(s, min(e, len(chars))):
                    chars[i] = " "
            return "".join(chars)

        body_for_state = [
            (pi, _strip_quoted_runs(t)) for pi, t in _basic_grammar_input_paragraphs()
        ]
        basic_grammar_state = _basic_grammar.build_document_state(body_for_state)
    except Exception:
        logger.exception(
            "Failed to build basic_grammar document state; doc-scope rules "
            "(GK-001/002/003) will stay silent for this analyze",
        )
        basic_grammar_state = {}

    # Paragraph-level exclusion: six document regions must bypass ALL
    # language-editing analysis — ``ref`` / ``epigraph`` / ``heading`` /
    # ``src`` / ``table`` / ``extract`` from the user's spec, plus
    # ``figure`` / ``abstract`` that were already in scope. Two of the
    # six user-named tags (``ref``, ``heading``) are also partially
    # dropped at extraction time by ``docx_io.read_paragraphs``; the
    # remaining four (``table``, ``epigraph``, ``src``, ``extract``)
    # carry through as body paragraphs with a role flag and are
    # skipped here. ``references`` is a new region tag for bibliography
    # sections typeset in Normal paragraphs with only a
    # ``<references>…</references>`` wrapper (common in non-templated
    # manuscripts).
    #
    # Centralising the gate in the single analyze loop covers every
    # rule family (grammar, spelling, abbreviations, medical_terms,
    # hyphenation, lww_ne, workbook rules, custom rules, spell_check,
    # term_matcher) in one place — no per-rule changes needed.
    _EXCLUDED_ROLES = {"heading", "title", "reference", "caption", "extract"}
    _EXCLUDED_REGION_FLAGS = (
        "in_table", "in_figure", "in_abstract", "in_epigraph", "in_src",
        "in_extract", "in_references",
    )

    def _is_excluded_paragraph(idx: int) -> bool:
        roles = (para_roles or {}).get(idx) or {}
        if roles.get("role") in _EXCLUDED_ROLES:
            return True
        return any(roles.get(flag) for flag in _EXCLUDED_REGION_FLAGS)

    for para_idx, text in paragraphs:
        if _is_excluded_paragraph(para_idx):
            # Paragraph lives inside an excluded region (table, figure,
            # abstract, epigraph, src block) or carries an excluded role
            # (heading, title, reference, caption). Skip all finding
            # emission — original text and tag structure stay intact
            # because we never write back to it.
            continue
        sents = segmenter.sentences(text)
        # Compute protected spans ONCE per paragraph and feed to both
        # analyze() and spell_check so a protected shape (COVID-19, DOI,
        # ISBN, gene symbol, …) is excluded from every detector in lock-step.
        try:
            protected_spans = _hyphen_dash.build_protected_spans(
                text, dash_profile=dash_profile,
            )
        except Exception:
            protected_spans = []
        # Additionally mask every ``"..."`` / ``“...”`` / ``«...»`` run
        # so Language Editing findings do not fire inside quoted text
        # (per spec: "exclude text inside double quotation marks").
        # Merged into the same protected_spans list — every downstream
        # consumer (engine, hyphen_dash, spell_check, term_matcher,
        # basic_grammar) already honours this list.
        try:
            quoted_spans = engine.build_quoted_text_spans(text)
            if quoted_spans:
                merged = sorted(list(protected_spans) + quoted_spans)
                dedup: list[tuple[int, int]] = []
                for s, e in merged:
                    if dedup and s <= dedup[-1][1]:
                        dedup[-1] = (dedup[-1][0], max(dedup[-1][1], e))
                    else:
                        dedup.append((s, e))
                protected_spans = dedup
        except Exception:
            logger.exception(
                "Failed to compute quoted-text spans for para %s; "
                "quoted text will NOT be excluded for this paragraph",
                para_idx,
            )
        found = engine.analyze(
            text, rules, dictionary, sents,
            dash_profile=dash_profile,
            protected_spans=protected_spans,
            rule_overrides=rule_overrides,
            para_idx=para_idx,
            abbr_state=(
                abbr_state_by_para.get(para_idx, {}) if abbr_state_by_para is not None else abbr_state
            ),
            audience=audience,
            min_uses=min_uses,
            para_roles=para_roles,
            medical_style_profile=medical_style_profile,
            document_variant=document_variant,
            project_profile_keys=project_profile_keys,
            is_lww_ne_project=is_lww_ne_project,
            basic_grammar_state=basic_grammar_state,
        )
        # Build exact-span dedup set: only (start, end) pairs from word-level
        # rules — so a Sentence finding covering a whole clause doesn't
        # suppress real typos inside it.
        rule_spans: list[tuple[int, int]] = []
        for fd in found:
            total_findings_count += 1
            if fd.category in _TYPO_DEDUP_CATEGORIES:
                rule_spans.append((fd.start, fd.end))
            finding_row = LanguageEditFinding(
                job_id=job_uuid,
                file_id=file_record.id,
                para_index=para_idx,
                start_offset=fd.start,
                end_offset=fd.end,
                rule_id=fd.rule_id,
                category=fd.category,
                severity=fd.severity,
                original_text=fd.original,
                suggestion=fd.suggestion,
                message=fd.message,
                autofixable=fd.autofixable,
                status="pending",
                source="rule",
                alt_suggestions=list(getattr(fd, "alt_suggestions", []) or []) or None,
            )
            findings_to_insert.append(finding_row)

        # Typo scan (pyspellchecker). Skipped automatically if the lib isn't
        # importable. Category = "typo" so it's a distinct chip in the UI,
        # never conflated with the existing "spelling" (house-style) findings.
        for ty in spell_check.spell_check_paragraph(
            text, spell_checker,
            whitelist=spell_whitelist,
            exclude_spans=rule_spans,
            protected_spans=protected_spans,
        ):
            # Defensive: pyspellchecker can occasionally propose the same
            # surface back (dictionary misconfiguration, custom whitelist
            # loop). Identity suggestions have nothing for the reviewer
            # to accept — drop them at the source, mirroring the engine
            # filter so the two sources behave uniformly.
            if engine.is_identity_suggestion(ty.original, ty.suggestion):
                logger.debug(
                    "dropping identity typo finding rule_id=%s surface=%r suggestion=%r",
                    ty.rule_id, ty.original, ty.suggestion,
                )
                continue
            total_findings_count += 1
            typo_count += 1
            findings_to_insert.append(LanguageEditFinding(
                job_id=job_uuid,
                file_id=file_record.id,
                para_index=para_idx,
                start_offset=ty.start,
                end_offset=ty.end,
                rule_id=ty.rule_id,
                category="typo",
                severity=ty.severity,
                original_text=ty.original,
                suggestion=ty.suggestion,
                message=ty.message,
                autofixable=False,
                status="pending",
                source="typo",
            ))

        # Term-list highlights (separate category, no suggestion, view-only).
        # find_term_matches already dedupes overlapping spans across lists —
        # one finding per span, attribution via message.
        #
        # Decision D1 (LWW-NE Phase 2): when the workbook has already
        # emitted an actionable finding covering the same span in this
        # paragraph, suppress the view-only DB term highlight for that
        # occurrence. This avoids double-highlighting the same word with
        # a "Term" chip AND a "Spelling" chip. Term highlights for text
        # NOT covered by a workbook finding continue to fire so existing
        # customer-specific term lists remain visible.
        lww_ne_spans_in_para = {
            (fd.start, fd.end) for fd in found
            if fd.rule_id and fd.rule_id.startswith("LWW-NE-")
        }
        for tm in find_term_matches(text, compiled_term_lists):
            # D1 suppression: skip DB term highlight if a workbook LWW-NE
            # finding covers the exact same (start, end) span.
            if (tm["start"], tm["end"]) in lww_ne_spans_in_para:
                continue
            # Also skip when the term match falls inside a protected
            # span (URL, DOI, gene symbol, OR a ``"..."`` / ``“...”``
            # quoted passage). term_matcher doesn't honour
            # protected_spans natively, so we filter here.
            if any(tm["start"] < pe and tm["end"] > ps for ps, pe in protected_spans):
                continue
            # Term-matcher highlights are advisory by category: no
            # replacement proposed, the finding IS the list-membership
            # signal. The GET /findings serializer surfaces advisory=True
            # for category='term' so the frontend hides Accept/Edit and
            # the diff view (reviewer still has Highlight / Ignore).
            term_match_count += 1
            total_findings_count += 1
            if tm.get("also_in_list_names"):
                also = ", ".join(tm["also_in_list_names"])
                msg = f"Term from list: {tm['term_list_name']} (also in: {also})"
            else:
                msg = f"Term from list: {tm['term_list_name']}"
            findings_to_insert.append(LanguageEditFinding(
                job_id=job_uuid,
                file_id=file_record.id,
                para_index=para_idx,
                start_offset=tm["start"],
                end_offset=tm["end"],
                rule_id=f"term:{tm['term_list_id']}" + (f":{tm['term_id']}" if tm['term_id'] else ""),
                category="term",
                severity="info",
                original_text=tm["matched_text"],
                suggestion=tm["matched_text"],  # view-only, no replacement proposed
                message=msg,
                autofixable=False,
                status="pending",
                source="term",
                term_list_id=tm["term_list_id"],
            ))

    if findings_to_insert:
        db.bulk_save_objects(findings_to_insert)

    job.total_findings = total_findings_count
    db.commit()

    return {
        "ok": True,
        "cached": False,
        "job_id": job_uuid,
        "total_findings": total_findings_count,
        "rule_findings": total_findings_count - term_match_count - typo_count,
        "term_matches": term_match_count,
        "typo_matches": typo_count,
        "spell_check_available": spell_checker is not None,
        "term_lists_applied": [{"id": cl.list_id, "name": cl.list_name} for cl in compiled_term_lists],
        "file_name": file_record.filename,
    }


def _resolve_file_path(stored_path: str) -> Optional[str]:
    """Resolve a File row's ``path`` into something readable by the
    current process.

    Legacy DB rows carry absolute HOST paths of the form
    ``/Users/kavuthamapriya/cms_backend/runtime/data/uploads/...``
    because the analyze endpoint ran when the backend was configured
    with a host-side ``CMS_RUNTIME_ROOT``. After the switch to the
    containerised layout those paths don't exist inside the
    container — we have to remap them to the mounted locations.

    Resolution order (first match wins):

      1. The stored path exists as-is.
      2. ``{CMS_RUNTIME_ROOT}/...`` where ``CMS_RUNTIME_ROOT`` is the
         current env value (``/opt/cms_runtime`` in-container by
         default). We strip whatever host prefix the stored path
         carries up to the ``runtime/`` segment and prepend the
         current root.
      3. ``/app/data/runtime/data/uploads/<basename>`` — covers the
         ``./data:/app/data`` mount case where legacy uploads got
         stashed under a flat directory.

    Returns ``None`` when no candidate is accessible. Callers must
    handle this — the feature that depends on the file (first-def
    map, re-analysis) then degrades gracefully instead of raising.
    """
    if not stored_path:
        return None
    if os.path.exists(stored_path):
        return stored_path

    # Trim any leading host prefix up to the first ``runtime/`` or
    # ``uploads/`` segment and probe common container roots.
    norm = stored_path.replace("\\", "/")
    candidates: list[str] = []
    runtime_root = os.getenv("CMS_RUNTIME_ROOT", "/opt/cms_runtime")

    idx = norm.find("/runtime/")
    if idx >= 0:
        rel = norm[idx + len("/runtime/"):]
        # ``/opt/legacy_uploads`` is the docker-compose bind of
        # ``./runtime`` — covers the common case of a DB row created
        # when the backend ran outside the container.
        candidates.append(os.path.join("/opt/legacy_uploads", rel))
        candidates.append(os.path.join(runtime_root, rel))
        candidates.append(os.path.join("/app/data/runtime", rel))

    idx2 = norm.find("/data/uploads/")
    if idx2 >= 0:
        rel = norm[idx2 + len("/data/uploads/"):]
        candidates.append(os.path.join("/opt/legacy_uploads/data/uploads", rel))
        candidates.append(os.path.join(runtime_root, "data", "uploads", rel))
        candidates.append(os.path.join("/opt/cms_runtime/data/uploads", rel))
        candidates.append(os.path.join("/app/data/runtime/data/uploads", rel))
        # Flat-dir fallback for the legacy layout.
        candidates.append(os.path.join("/app/data/runtime/data/uploads", os.path.basename(rel)))

    for cand in candidates:
        if os.path.exists(cand):
            return cand
    return None


def _build_first_definition_map(job: LanguageEditJob, db: Session) -> dict[str, dict]:
    """Per-abbreviation first-definition lookup, computed once per
    GET/decide response so the serializer can attach a reference
    occurrence to AB04 (repeated definition) findings.

    Honors the engine's existing scope rules — the state build is
    exactly the one ``build_document_state`` uses, so document regions
    the router excludes (references, extract, abstract, src, etc.)
    stay excluded here too. Returns an empty map when the DOCX can't
    be read; the serializer then just omits the reference field.

    Returned shape per abbreviation:

        {
          "para_index":    int,   # 0-based paragraph index
          "start_offset":  int,
          "end_offset":    int,
          "text":          str,   # exact surface in the document
          "kind":          str,   # e.g. "exp_paren_abbr"
        }
    """
    file_record = db.query(models.File).filter(models.File.id == job.file_id).first()
    if not file_record:
        return {}
    resolved = _resolve_file_path(file_record.path or "")
    if not resolved:
        logger.warning(
            "first-def map: DOCX unreachable from container (DB path=%r)",
            file_record.path,
        )
        return {}
    try:
        doc_obj, paragraphs = docx_io.read_paragraphs(resolved)
    except Exception as exc:
        logger.warning("first-def map: read_paragraphs failed: %s", exc)
        return {}
    try:
        para_roles = docx_io.classify_paragraphs(doc_obj)
    except Exception:
        para_roles = {}
    try:
        state = abbreviations.build_document_state(
            paragraphs, audience="general", min_uses=2, para_roles=para_roles,
        )
    except Exception as exc:
        logger.warning("first-def map: state build failed: %s", exc)
        return {}
    out: dict[str, dict] = {}
    for abbr, s in state.items():
        if not s.definitions:
            continue
        pi, start, end, surface, kind = s.definitions[0]
        out[abbr] = {
            "para_index": int(pi),
            "start_offset": int(start),
            "end_offset": int(end),
            "text": surface,
            "kind": kind,
        }
    return out


@router.get("/language-edit/jobs/{job_id}/findings")
def get_job_findings(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Returns findings and statistics for a given Language Edit job."""
    _require_language_user(current_user)
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    findings = (
        db.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job_id)
        .order_by(LanguageEditFinding.para_index, LanguageEditFinding.start_offset)
        .all()
    )

    first_def_map = _build_first_definition_map(job, db)

    return {
        "job": {
            "job_id": job.job_id,
            "file_id": job.file_id,
            "project_id": job.project_id,
            "status": job.status,
            "total_findings": job.total_findings,
            "accepted_count": job.accepted_count,
            "edited_count": job.edited_count,
            "rejected_count": job.rejected_count,
        },
        "findings": [_serialize_finding_row(f, first_def_map) for f in findings],
    }


def _serialize_finding_row(
    f: LanguageEditFinding, first_def_map: Optional[dict[str, dict]] = None,
) -> dict:
    """Row-shape helper for the GET /findings serializer AND the
    decide endpoint's refreshed-findings bundle. Keeps the two paths
    emitting IDENTICAL shape so the frontend has a single model for
    a finding whether it arrives via list or decision response."""
    return {
        "id": f.id,
        "para_index": f.para_index,
        "start_offset": f.start_offset,
        "end_offset": f.end_offset,
        "rule_id": f.rule_id,
        "category": f.category,
        "severity": f.severity,
        "original_text": f.original_text,
        "suggestion": f.suggestion,
        "alt_suggestions": f.alt_suggestions or [],
        "message": f.message,
        "autofixable": f.autofixable,
        "status": f.status,
        "edited_text": f.edited_text,
        "reviewer": f.reviewer,
        "source": getattr(f, "source", "rule"),
        "term_list_id": getattr(f, "term_list_id", None),
        **abbreviations_metadata.enrich_finding(
            f.rule_id,
            f.original_text,
            f.suggestion,
            f.alt_suggestions or [],
        ),
        **abbreviations_metadata.grouping_fields_for(
            f.rule_id,
            f.original_text,
            f.suggestion,
        ),
        "advisory": engine.is_advisory_finding(f.rule_id, f.category),
        "source_badge": (
            "LWW-NE"
            if isinstance(f.rule_id, str) and f.rule_id.startswith("LWW-NE-")
            else None
        ),
        "subcategory": basic_grammar.subcategory_for(f.rule_id),
        "decided_at": (
            f.decided_at.replace(tzinfo=datetime.timezone.utc).isoformat()
            if f.decided_at and f.decided_at.tzinfo is None
            else (f.decided_at.isoformat() if f.decided_at else None)
        ),
        "first_definition": _first_definition_for(f, first_def_map),
    }


def _first_definition_for(
    f: LanguageEditFinding, first_def_map: Optional[dict[str, dict]],
) -> Optional[dict]:
    """Return the first-in-document definition reference the frontend
    should display at the top of an AB04 (repeated definition) card,
    or ``None`` for every other case.

    Scope: AB04 only. Other AB rules either represent the first use
    themselves (AB01) or don't warrant a reference row by spec.
    When no map was built (missing file, I/O error) or the finding's
    abbreviation couldn't be extracted, returns ``None`` — the UI
    then falls back to showing the group's own earliest item.

    Also returns ``None`` when the computed first definition's span
    exactly equals the finding's own span: that means THIS AB04
    finding IS the first definition (shouldn't happen under the
    current engine, but the guard keeps the serializer robust in
    case the state and the finding fall out of sync)."""
    if not first_def_map:
        return None
    if f.rule_id != "AB04":
        return None
    abbr = abbreviations_metadata.extract_abbreviation(
        f.rule_id, f.original_text or "", f.suggestion or "",
    )
    if not abbr:
        return None
    info = first_def_map.get(abbr)
    if not info:
        return None
    if (
        info.get("para_index") == f.para_index
        and info.get("start_offset") == f.start_offset
        and info.get("end_offset") == f.end_offset
    ):
        return None
    return {
        "para_index": info["para_index"],
        "start_offset": info["start_offset"],
        "end_offset": info["end_offset"],
        "text": info["text"],
    }


def _apply_patches_to_text(text: str, patches: list[tuple[int, int, str]]) -> str:
    """Apply (start, end, replacement) patches to ``text`` right-to-
    left so earlier offsets stay valid as we go. Patches whose spans
    fall outside ``text`` are skipped — defensive since the DOCX
    file on disk never changes between analyze and re-analyze, but a
    future edit elsewhere could invalidate offsets."""
    out = text
    for start, end, replacement in sorted(patches, key=lambda p: p[0], reverse=True):
        if 0 <= start <= end <= len(out):
            out = out[:start] + (replacement or "") + out[end:]
    return out


def _reanalyze_abbreviations_for_job(
    job: LanguageEditJob, db: Session
) -> Optional[list[LanguageEditFinding]]:
    """Rebuild the AB finding set for ``job`` after an Accept/Edit.

    Why: the review workflow lets a reviewer accept a first-use AB01
    (``intensive care unit`` → ``intensive care unit (ICU)``) and
    expects the panel to reflect the post-edit state — notably that
    subsequent AB01 findings on the same paragraph pattern are gone
    and that AB02 "repeated expansion" or other downstream AB rules
    are recomputed against the patched text. Running this on the
    live DOCX would overwrite the user's file; instead we apply
    accepted/edited AB patches to an in-memory virtual paragraph
    buffer and re-run the AB analyzer against that buffer.

    Guarantees:
      * Only AB01-AB17 findings are rewritten. DN01-32, LWW-NE,
        grammar, spelling, hyphenation, medical terms, term-matcher,
        and typo rows stay untouched.
      * Only PENDING AB findings are deleted. Decided rows (accepted,
        edited, rejected, highlighted) survive so the reviewer's
        decision history isn't wiped.
      * Prior Reject / Highlight decisions survive re-analysis — if
        a re-analysis would re-emit the same (para_index, rule_id,
        original_text) as an already-decided rejected/highlighted
        row, the new finding is suppressed. This prevents an ignored
        finding from silently coming back.
      * New pending AB findings are inserted with virtual-text
        offsets (post-patch). The frontend's WysiwygEditor already
        applied each accepted replacement via ``replaceOccurrence()``,
        so its content IS the virtual text and the highlights
        line up.

    Returns the full list of findings for the job after rewrite, or
    ``None`` when the re-analysis can't run (missing file, I/O
    error) — in which case the caller falls back to leaving the
    pending set alone and the reviewer can trigger a full
    re-analysis via a new POST /analyze if they want the refresh.
    """
    file_record = db.query(models.File).filter(models.File.id == job.file_id).first()
    if not file_record or not file_record.path:
        return None
    resolved_path = _resolve_file_path(file_record.path)
    if not resolved_path:
        logger.warning(
            "reanalyze_ab: DOCX unreachable from container (DB path=%r)",
            file_record.path,
        )
        return None

    all_findings = (
        db.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .all()
    )

    def _is_ab(f: LanguageEditFinding) -> bool:
        return bool(f.rule_id) and f.rule_id.startswith("AB")

    ab_accepted_or_edited = [
        f for f in all_findings if _is_ab(f) and f.status in ("accepted", "edited")
    ]
    ab_rejected_or_highlighted = [
        f for f in all_findings if _is_ab(f) and f.status in ("rejected", "highlighted")
    ]

    # Build patch map keyed by paragraph. ``edited`` findings use the
    # reviewer's custom text; ``accepted`` findings use the rule's
    # suggestion. Both become (start, end, replacement) tuples.
    patches_by_para: dict[int, list[tuple[int, int, str]]] = {}
    for f in ab_accepted_or_edited:
        replacement = (
            f.edited_text if (f.status == "edited" and f.edited_text is not None)
            else (f.suggestion or "")
        )
        patches_by_para.setdefault(f.para_index, []).append(
            (f.start_offset, f.end_offset, replacement)
        )

    try:
        doc_obj, paragraphs = docx_io.read_paragraphs(resolved_path)
    except Exception as exc:
        logger.warning("reanalyze_ab: failed to read DOCX at %s: %s", resolved_path, exc)
        return None
    try:
        para_roles = docx_io.classify_paragraphs(doc_obj)
    except Exception as exc:
        logger.warning("reanalyze_ab: classify failed: %s", exc)
        para_roles = {}

    _EXCLUDED_ROLES = {"heading", "title", "reference", "caption", "extract"}
    _EXCLUDED_REGION_FLAGS = (
        "in_table", "in_figure", "in_abstract", "in_epigraph", "in_src",
        "in_extract", "in_references",
    )

    def _is_excluded(pi: int) -> bool:
        roles = (para_roles or {}).get(pi) or {}
        if roles.get("role") in _EXCLUDED_ROLES:
            return True
        return any(roles.get(flag) for flag in _EXCLUDED_REGION_FLAGS)

    # Build virtual paragraphs (original + patches) once.
    virtual_paragraphs: list[tuple[int, str]] = [
        (pi, _apply_patches_to_text(text, patches_by_para.get(pi, [])))
        for pi, text in paragraphs
    ]

    # Rebuild the AB document state over the virtual text so AB10
    # article-agreement, AB01/02 first-use tracking, and AB04/05
    # single-use counters reflect the post-edit document. Use
    # safe defaults — project-config-driven audience / min_uses
    # drifted could change results slightly, but the Accept/Edit
    # refresh is primarily a "did this accept remove the following
    # findings" check; exact min_uses alignment isn't load-bearing.
    try:
        abbr_state = abbreviations.build_document_state(
            virtual_paragraphs, audience="general", min_uses=2,
            para_roles=para_roles,
        )
    except Exception as exc:
        logger.warning("reanalyze_ab: failed to build doc state: %s", exc)
        abbr_state = {}

    # Suppression index: (para_index, rule_id, original_text) of the
    # reviewer's past Reject / Highlight decisions. Re-analysis must
    # not resurrect a finding the reviewer explicitly ignored.
    suppressed_keys: set[tuple[int, str, str]] = {
        (f.para_index, f.rule_id, f.original_text)
        for f in ab_rejected_or_highlighted
    }

    # Produce the fresh pending-AB set from the virtual document.
    # Each entry is a tuple describing what SHOULD be in the DB after
    # the diff; we intentionally don't construct ORM rows yet because
    # most will match existing rows and we want to KEEP their ids.
    fresh: list[tuple[int, int, int, str, str, str, str, str, str, bool, list]] = []
    seen: set[tuple[int, int, int, str, str]] = set()
    for pi, v_text in virtual_paragraphs:
        if _is_excluded(pi):
            continue
        if not v_text:
            continue
        try:
            found = abbreviations.analyze_abbreviations(
                v_text, para_idx=pi,
                document_state=abbr_state, para_roles=para_roles,
            )
        except Exception as exc:
            logger.warning("reanalyze_ab: analyze failed at para %s: %s", pi, exc)
            continue
        for fd in found:
            if not fd.rule_id or not fd.rule_id.startswith("AB"):
                continue
            if (pi, fd.rule_id, fd.original) in suppressed_keys:
                continue
            dedup_key = (pi, fd.start, fd.end, fd.rule_id, fd.original)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            fresh.append((
                pi, fd.start, fd.end, fd.rule_id, fd.original,
                fd.suggestion or "", fd.message or "", fd.category, fd.severity,
                bool(fd.autofixable),
                list(getattr(fd, "alt_suggestions", []) or []),
            ))

    # Diff against currently-pending AB rows. The identity key is
    # (para_index, start_offset, end_offset, rule_id, original_text)
    # — the same five fields used for intra-run dedupe above. Matching
    # on these preserves the DB row and its id when a finding is
    # re-emitted unchanged, so the frontend's existing card id stays
    # valid across a re-analysis.
    #
    # This fix matters: the previous implementation deleted every
    # pending AB row on every Accept/Edit and bulk-inserted fresh
    # ones with new auto-increment ids. The result was that the
    # UI's event handlers, which close over ``f.id`` at render time,
    # pointed at ids that no longer existed — subsequent clicks on
    # OTHER cards resolved to ``POST /findings/{stale_id}/decide``
    # and the handler returned 404 ("Finding ID not found"), surfaced
    # to the reviewer as "Failed to save decision".
    existing_pending = (
        db.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id.like("AB%"),
        )
        .all()
    )
    existing_by_key: dict[tuple[int, int, int, str, str], LanguageEditFinding] = {}
    for row in existing_pending:
        key = (
            row.para_index, row.start_offset, row.end_offset,
            row.rule_id, row.original_text,
        )
        # If a duplicate ever snuck in previously, keep the first and
        # mark the rest for deletion (collision below).
        if key not in existing_by_key:
            existing_by_key[key] = row

    fresh_keys = {(f[0], f[1], f[2], f[3], f[4]) for f in fresh}

    # 1) Delete pending rows no longer produced by the analyzer.
    stale_ids = [
        row.id for key, row in existing_by_key.items()
        if key not in fresh_keys
    ]
    # Also delete duplicate pending rows (rows whose key matches an
    # earlier one we kept) so the set is truly keyed.
    seen_for_dup: set[tuple[int, int, int, str, str]] = set()
    for row in existing_pending:
        key = (row.para_index, row.start_offset, row.end_offset, row.rule_id, row.original_text)
        if key in seen_for_dup:
            stale_ids.append(row.id)
        else:
            seen_for_dup.add(key)
    if stale_ids:
        # Fetch the ORM rows first and delete each via ORM-level
        # ``db.delete(row)``. This works uniformly across backends /
        # sessions and sidesteps ``bulk .delete()`` edge cases where
        # stale instances in the session get re-inserted on commit.
        for row in (
            db.query(LanguageEditFinding)
            .filter(LanguageEditFinding.id.in_(stale_ids))
            .all()
        ):
            db.delete(row)

    # 2) Insert only brand-new rows (not matched by any existing row).
    #    Unchanged findings keep their original id → UI cards keep
    #    working across re-analyses.
    new_rows: list[LanguageEditFinding] = []
    for (pi, s, e, rid, orig, sug, msg, cat, sev, autofix, alts) in fresh:
        if (pi, s, e, rid, orig) in existing_by_key:
            # Matched. Optionally refresh mutable workbook fields so
            # a workbook update post-analyze is reflected without an
            # id change.
            row = existing_by_key[(pi, s, e, rid, orig)]
            if row.suggestion != sug:
                row.suggestion = sug
            if row.message != msg:
                row.message = msg
            if row.severity != sev:
                row.severity = sev
            if bool(row.autofixable) != autofix:
                row.autofixable = autofix
            desired_alts = list(alts) or None
            if (row.alt_suggestions or None) != desired_alts:
                row.alt_suggestions = desired_alts
            continue
        new_rows.append(LanguageEditFinding(
            job_id=job.job_id,
            file_id=job.file_id,
            para_index=pi,
            start_offset=s,
            end_offset=e,
            rule_id=rid,
            category=cat,
            severity=sev,
            original_text=orig,
            suggestion=sug,
            message=msg,
            autofixable=autofix,
            status="pending",
            source="rule",
            alt_suggestions=list(alts) or None,
        ))
    if new_rows:
        db.bulk_save_objects(new_rows)

    # Flush pending deletes / inserts so the COUNT below reflects the
    # actual post-rewrite row set rather than the pre-flush snapshot.
    db.flush()
    # Keep job.total_findings consistent with the new row count.
    job.total_findings = (
        db.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    db.commit()

    return (
        db.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .order_by(LanguageEditFinding.para_index, LanguageEditFinding.start_offset)
        .all()
    )


@router.post("/language-edit/findings/{finding_id}/decide")
def decide_finding(
    finding_id: int,
    body: DecisionRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Updates editor decision (accepted, edited, rejected, highlighted) for a finding."""
    _require_language_user(current_user)
    finding = db.query(LanguageEditFinding).filter(LanguageEditFinding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail=f"Finding ID {finding_id} not found.")

    if body.status not in ("accepted", "edited", "rejected", "highlighted"):
        raise HTTPException(status_code=400, detail="Invalid status. Must be accepted, edited, rejected, or highlighted.")

    old_status = finding.status
    finding.status = body.status
    finding.edited_text = body.edited_text if body.status == "edited" else None
    finding.reviewer = (get_user_full_name(current_user) if current_user else None) or body.reviewer or "editor"
    finding.decided_at = datetime.datetime.now(datetime.timezone.utc)

    # Update counters on parent job
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == finding.job_id).first()
    if job:
        # Decrement old counter if replacing decision
        if old_status == "accepted":
            job.accepted_count = max(0, job.accepted_count - 1)
        elif old_status == "edited":
            job.edited_count = max(0, job.edited_count - 1)
        elif old_status == "rejected":
            job.rejected_count = max(0, job.rejected_count - 1)

        # Increment new counter
        if body.status == "accepted":
            job.accepted_count += 1
        elif body.status == "edited":
            job.edited_count += 1
        elif body.status == "rejected":
            job.rejected_count += 1

    db.commit()

    # AB Accept / Edit triggers an in-place re-analysis so grouped
    # occurrences reflect the post-edit document (requirement:
    # subsequent-use findings must update after the first-use
    # expansion is accepted). We only re-run AB rules — DN rules
    # and every other category stay as-is per scope. Re-analysis
    # replaces pending AB rows, preserves decided rows, suppresses
    # re-emission on previously rejected/highlighted spans, and
    # dedups within the new row set. See ``_reanalyze_abbreviations_for_job``.
    refreshed_rows: Optional[list[LanguageEditFinding]] = None
    if (
        job is not None
        and finding.rule_id
        and finding.rule_id.startswith("AB")
        and finding.status in ("accepted", "edited")
    ):
        try:
            refreshed_rows = _reanalyze_abbreviations_for_job(job, db)
        except Exception as exc:
            logger.exception("AB re-analysis after decide failed: %s", exc)
            refreshed_rows = None

    # Phase 5 — return a small re-analyze bundle so the frontend can
    # refresh counters + authoritative finding state without an extra
    # GET /findings round-trip after every decision. Additive: legacy
    # callers that only read ``ok`` / ``status`` keep working. When
    # re-analysis ran, the full refreshed findings list rides along
    # under ``findings`` so the grouped UI can replace its local
    # state without a second fetch (prevents stale cards and
    # duplicate occurrences).
    response: dict = {
        "ok": True,
        "finding_id": finding.id,
        "status": finding.status,
        "finding": {
            "id": finding.id,
            "status": finding.status,
            "edited_text": finding.edited_text,
            "reviewer": finding.reviewer,
            "decided_at": (
                finding.decided_at.replace(tzinfo=datetime.timezone.utc).isoformat()
                if finding.decided_at and finding.decided_at.tzinfo is None
                else (finding.decided_at.isoformat() if finding.decided_at else None)
            ),
            **abbreviations_metadata.enrich_finding(
                finding.rule_id,
                finding.original_text,
                finding.suggestion,
                finding.alt_suggestions or [],
            ),
        },
        "job": {
            "job_id": job.job_id,
            "total_findings": job.total_findings,
            "accepted_count": job.accepted_count,
            "edited_count": job.edited_count,
            "rejected_count": job.rejected_count,
        } if job else None,
    }
    if refreshed_rows is not None:
        # After AB Accept/Edit the definition map may have shifted;
        # rebuild once so the reference row attached to any AB04
        # finding in the refreshed bundle stays accurate.
        first_def_map = _build_first_definition_map(job, db) if job else {}
        response["findings"] = [
            _serialize_finding_row(f, first_def_map) for f in refreshed_rows
        ]
        response["reanalyzed"] = True
    return response


@router.post("/language-edit/jobs/{job_id}/batch-decide")
def batch_decide_findings(
    job_id: str,
    body: BatchDecideRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Apply the same decision to a list of findings in one
    transaction.

    * Only processes findings that both belong to ``job_id`` and are
      still pending. Items that don't exist, belong to a different
      job, or are already decided are reported in ``failed`` with a
      short reason; the rest still commit. The reviewer sees a
      partial-success toast and the UI can leave the failed cards
      pending for retry.
    * If any processed finding is an AB rule AND the decision is
      ``accepted`` / ``edited``, the server-side abbreviations
      re-analysis runs exactly ONCE at the end (instead of per
      finding). Non-AB categories never trigger it.
    * Job counters are recomputed once from the final row set so
      they can't drift under partial failures.

    The response mirrors ``decide_finding`` on structure (``ok``,
    ``job``, optional ``findings`` + ``reanalyzed`` when the
    re-analysis ran) so the frontend can reuse its refresh logic.
    """
    _require_language_user(current_user)
    if body.status not in ("accepted", "edited", "rejected", "highlighted"):
        raise HTTPException(
            status_code=400,
            detail="Invalid status. Must be accepted, edited, rejected, or highlighted.",
        )
    if not body.decisions:
        raise HTTPException(status_code=400, detail="decisions must be non-empty.")

    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    reviewer = (
        (get_user_full_name(current_user) if current_user else None)
        or body.reviewer
        or "editor"
    )
    decided_at = datetime.datetime.now(datetime.timezone.utc)

    # Map every requested finding id to its ORM row via a single IN
    # query so the batch is O(1) round trips regardless of size.
    ids = [d.finding_id for d in body.decisions]
    edited_lookup: dict[int, Optional[str]] = {
        d.finding_id: d.edited_text for d in body.decisions
    }
    rows_by_id = {
        r.id: r for r in (
            db.query(LanguageEditFinding)
            .filter(LanguageEditFinding.id.in_(ids))
            .all()
        )
    }

    processed: list[int] = []
    failed: list[dict] = []
    any_ab_resolved = False

    for d in body.decisions:
        fid = d.finding_id
        row = rows_by_id.get(fid)
        if row is None:
            failed.append({"finding_id": fid, "reason": "not_found"})
            continue
        if row.job_id != job_id:
            failed.append({"finding_id": fid, "reason": "wrong_job"})
            continue
        # Spec: bulk actions apply only to pending findings. An
        # already-decided row is skipped — it reports as ``failed`` so
        # the UI can surface it, but no silent re-decision happens.
        # Highlighted is "not yet resolved" and therefore eligible
        # (highlight alone doesn't count as resolved).
        if row.status in ("accepted", "edited", "rejected"):
            failed.append({"finding_id": fid, "reason": "already_resolved"})
            continue
        row.status = body.status
        row.edited_text = edited_lookup.get(fid) if body.status == "edited" else None
        row.reviewer = reviewer
        row.decided_at = decided_at
        processed.append(fid)
        if (
            body.status in ("accepted", "edited")
            and row.rule_id
            and row.rule_id.startswith("AB")
        ):
            any_ab_resolved = True

    # Commit the per-row status updates BEFORE running the AB
    # re-analysis so the helper sees the fresh decisions when it
    # reads existing findings.
    db.commit()

    # Re-analysis runs AT MOST once per batch, even when many AB
    # findings were accepted together. The helper is diff-based so
    # unchanged pending AB rows retain their ids.
    refreshed_rows: Optional[list[LanguageEditFinding]] = None
    if any_ab_resolved:
        try:
            refreshed_rows = _reanalyze_abbreviations_for_job(job, db)
        except Exception as exc:
            logger.exception("AB batch re-analysis failed: %s", exc)
            refreshed_rows = None

    # Recompute job counters authoritatively from the committed row
    # set — cheaper and more trustworthy than tracking deltas across
    # an unknown number of status transitions.
    from sqlalchemy import func as _sql_func
    status_counts = dict(
        db.query(LanguageEditFinding.status, _sql_func.count())
        .filter(LanguageEditFinding.job_id == job_id)
        .group_by(LanguageEditFinding.status)
        .all()
    )
    job.accepted_count = int(status_counts.get("accepted", 0))
    job.edited_count = int(status_counts.get("edited", 0))
    job.rejected_count = int(status_counts.get("rejected", 0))
    job.total_findings = int(sum(status_counts.values()))
    db.commit()

    response: dict = {
        "ok": True,
        "job_id": job_id,
        "processed": processed,
        "failed": failed,
        "job": {
            "job_id": job.job_id,
            "total_findings": job.total_findings,
            "accepted_count": job.accepted_count,
            "edited_count": job.edited_count,
            "rejected_count": job.rejected_count,
        },
    }
    if refreshed_rows is not None:
        # After AB Accept/Edit the definition map may have shifted;
        # rebuild once so the reference row attached to any AB04
        # finding in the refreshed bundle stays accurate.
        first_def_map = _build_first_definition_map(job, db) if job else {}
        response["findings"] = [
            _serialize_finding_row(f, first_def_map) for f in refreshed_rows
        ]
        response["reanalyzed"] = True
    return response


@router.post("/language-edit/jobs/{job_id}/export")
def export_redlined_docx(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Exports redlined DOCX with Word Tracked Changes and XML highlights, saving it in the same location as a new version."""
    _require_language_user(current_user)
    job = db.query(LanguageEditJob).filter(LanguageEditJob.job_id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    file_record = db.query(models.File).filter(models.File.id == job.file_id).first()
    if not file_record or not os.path.exists(file_record.path):
        raise HTTPException(status_code=404, detail="Source DOCX file not found.")

    active_findings = (
        db.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job_id,
            LanguageEditFinding.status.in_(["accepted", "edited", "highlighted"])
        )
        .order_by(LanguageEditFinding.para_index, LanguageEditFinding.start_offset.desc())
        .all()
    )

    doc, _ = docx_io.read_paragraphs(file_record.path)

    # Apply right-to-left within each paragraph so offsets remain valid
    for f in active_findings:
        if 0 <= f.para_index < len(doc.paragraphs):
            para = doc.paragraphs[f.para_index]
            if f.status == "highlighted":
                color = "cyan" if f.category == "spelling" else "magenta" if f.category == "sentence" else "yellow"
                docx_io.apply_highlight_change(para, start=f.start_offset, end=f.end_offset, color=color)
            else:
                target_text = f.edited_text if f.status == "edited" and f.edited_text else f.suggestion
                docx_io.apply_tracked_change(
                    para,
                    start=f.start_offset,
                    end=f.end_offset,
                    new_text=target_text,
                    author="LangQA"
                )

    # 1. Archive previous file version in Archive/ folder before overwriting
    from app.domains.files import version_service
    base_path = os.path.dirname(file_record.path)
    try:
        version_service.archive_existing_file(
            db,
            existing_file=file_record,
            base_path=base_path,
            uploaded_by_id=None,
            reason="Language Edit review completed"
        )
    except Exception as err:
        logger.warning(f"Failed to archive previous file version: {err}")

    # 2. Save redlined DOCX to the exact same location as the new file version
    doc.save(file_record.path)

    # 3. Increment file record version and update timestamp
    file_record.version = (file_record.version or 1) + 1
    file_record.updated_at = datetime.datetime.now(datetime.timezone.utc)

    # Save export copy for download response
    out_dir = os.path.join(base_path, "jobs")
    os.makedirs(out_dir, exist_ok=True)
    filename_stem = os.path.splitext(file_record.filename)[0]
    out_path = os.path.join(out_dir, f"{filename_stem}_redline.docx")
    doc.save(out_path)

    job.status = "completed"
    db.commit()

    headers = {
        "X-File-Id": str(file_record.id),
        "X-File-Version": str(file_record.version),
        "Access-Control-Expose-Headers": "X-File-Id, X-File-Version"
    }

    return FileResponse(
        out_path,
        filename=f"{filename_stem}_redline.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers
    )



@router.get("/medical/umls-search")
def search_medical_term_umls(
    term: str,
    api_key: Optional[str] = None,
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """
    Search medical and pharmaceutical terms using NLM UMLS Terminology Services API.
    Returns matched concepts, canonical names, and CUIs.
    """
    _require_language_user(current_user)
    if not term or not term.strip():
        raise HTTPException(status_code=400, detail="Query term parameter is required.")

    from app.services.umls_service import validate_medical_term
    result = validate_medical_term(term, api_key=api_key)
    return {"ok": True, "data": result}

