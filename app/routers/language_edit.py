"""
API router for Ninja Inkflow Language Editing.
Provides endpoints for rule management (CE support JSON sync), job execution, finding reviews, and redlined DOCX export.
"""
import datetime
import logging
import os
import uuid
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie, get_user_full_name
from app.domains.processing.language_edit_models import LanguageEditJob, LanguageEditFinding
from app.domains.processing.service import check_permission
from app.models import User

from app.processing.language_editing import custom_dict, docx_io, engine, segmenter, spell_check
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
RULES_EDIT_ROLES = {"admin", "projectmanager", "project manager"}

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
            "custom": custom_rules,
        },
        "workbook_summary": {
            "hyphenation": hyphen_summary,
            "abbreviations": abbr_summary,
            "medical_terms": medical_summary,
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
    spell_whitelist = spell_check.build_whitelist(
        variant_to_canonical=project_rules_cfg.get("variant_to_canonical", {}),
        uk_us_pairs=UK_US_PAIRS,
        term_vocabulary=term_vocab,
        extras=list(custom_dict_words) + list(medical_whitelist),
    )
    # Also feed custom dict words into pyspellchecker's known-word frequency
    # table so morphological variants (plurals, -ed forms) of a dic entry
    # resolve via spell_check._morph_variants without needing every form in
    # the dic.
    spell_checker = spell_check.get_spell_checker(
        custom_words=custom_dict_words,
    )  # None if pyspellchecker missing

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
    )
    db.add(job)
    db.commit()

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
    body_para_set = {pi for pi, _ in paragraphs}
    enriched_paragraphs = list(paragraphs)
    for pi, roles in (para_roles or {}).items():
        if pi in body_para_set:
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

    for para_idx, text in paragraphs:
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
        for tm in find_term_matches(text, compiled_term_lists):
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
        "job_id": job_uuid,
        "total_findings": total_findings_count,
        "rule_findings": total_findings_count - term_match_count - typo_count,
        "term_matches": term_match_count,
        "typo_matches": typo_count,
        "spell_check_available": spell_checker is not None,
        "term_lists_applied": [{"id": cl.list_id, "name": cl.list_name} for cl in compiled_term_lists],
        "file_name": file_record.filename,
    }


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
        "findings": [
            {
                "id": f.id,
                "para_index": f.para_index,
                "start_offset": f.start_offset,
                "end_offset": f.end_offset,
                "rule_id": f.rule_id,
                "category": f.category,
                "severity": f.severity,
                "original_text": f.original_text,
                "suggestion": f.suggestion,
                # Workbook rules can offer 2–3 replacements; the Phase-3 UI
                # dropdown reads this list. Empty / null for rows that have
                # no alternates — identical shape to the pre-workbook behaviour.
                "alt_suggestions": f.alt_suggestions or [],
                "message": f.message,
                "autofixable": f.autofixable,
                "status": f.status,
                "edited_text": f.edited_text,
                "reviewer": f.reviewer,
                "decided_at": f.decided_at.isoformat() if f.decided_at else None,
                "source": getattr(f, "source", "rule"),
                "term_list_id": getattr(f, "term_list_id", None),
                "decided_at": (f.decided_at.replace(tzinfo=datetime.timezone.utc).isoformat() if f.decided_at.tzinfo is None else f.decided_at.isoformat()) if f.decided_at else None,
            }
            for f in findings
        ]
    }


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
    return {"ok": True, "finding_id": finding.id, "status": finding.status}


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

