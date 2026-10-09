"""
Service for managing project-level Language Editing rules.

Source of truth (team decision):
    data/uploads/{project_code}/CE support/Style sheet template/{project_code}_language_rules.json

Each project has its own CE Support chapter (auto-created on first save) and
its own JSON file. The Language Editor reads the per-project JSON via
``get_project_language_rules`` and the engine applies only the enabled rules.
"""
import json
import logging
import os
from typing import Any, Optional
from sqlalchemy.orm import Session
from app.core.paths import UPLOADS_DIR

logger = logging.getLogger(__name__)

PROFILES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "processing", "language_editing", "config", "profiles"
)


# ─── Base profile helpers (bundled JSON, read-only reference) ─────────────────

def get_available_style_profiles() -> dict[str, dict[str, Any]]:
    """Load all base style profiles from config/profiles/*.json (bundled defaults)."""
    profiles: dict[str, dict[str, Any]] = {}
    if os.path.exists(PROFILES_DIR):
        for fname in os.listdir(PROFILES_DIR):
            if fname.endswith(".json"):
                key = fname[:-5]
                fpath = os.path.join(PROFILES_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        profiles[key] = json.load(f)
                except Exception as exc:
                    logger.warning("Failed to load style profile %s: %s", fname, exc)
    return profiles


def get_project_language_rules_dir(project_code: str, client_name: str = "unknown") -> str:
    path = os.path.join(str(UPLOADS_DIR), client_name, project_code, "CE support", "Style sheet template")
    os.makedirs(path, exist_ok=True)
    return path


def get_project_language_rules_path(project_code: str) -> str:
    return os.path.join(
        get_project_language_rules_dir(project_code),
        f"{project_code}_language_rules.json",
    )


# ─── Save (disk-first) + CE Support auto-create + file registration + audit ───

def build_rules_union(
    profile_keys: list[str],
    available_profiles: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Return the union of rules + dictionary across the given style profiles.

    Rules are deduplicated by ``id`` — the first profile in ``profile_keys``
    that defines a given rule wins (so order the list by priority). Dictionary
    entries are merged with later profiles overwriting earlier ones for the
    same source word.
    """
    if available_profiles is None:
        available_profiles = get_available_style_profiles()

    if not profile_keys:
        profile_keys = ["uk"]

    merged_rules: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    merged_dict: dict[str, str] = {}

    for key in profile_keys:
        profile = available_profiles.get(key) or {}
        for rule in profile.get("rules", []) or []:
            rid = rule.get("id")
            if not rid or rid in seen_ids:
                continue
            seen_ids.add(rid)
            merged_rules.append(dict(rule))
        merged_dict.update(profile.get("variant_to_canonical", {}) or {})

    return {"rules": merged_rules, "variant_to_canonical": merged_dict}


def save_project_language_rules(
    db: Session,
    *,
    project_id: int,
    profile_key: Optional[str] = None,       # back-compat single-style
    profile_keys: Optional[list[str]] = None,  # multi-style
    rules: Optional[list[dict[str, Any]]] = None,
    variant_to_canonical: Optional[dict[str, str]] = None,
    profile_name: Optional[str] = None,
    changed_by_id: Optional[int] = None,
    note: Optional[str] = None,
    uploaded_by_id: Optional[int] = None
) -> dict[str, Any]:
    """Write the per-project rules selection to the project's CE Support folder.

    Side effects:
      1. Ensures the project has a CE Support chapter (auto-creates if missing).
      2. Writes {project_code}_language_rules.json to the Style sheet template dir.
      3. Registers / updates a `files` row so the JSON appears in the UI's file browser.
      4. Inserts an audit row in project_language_rules_history when ``changed_by_id`` is given.
    """
    from app import models
    from app.domains.projects.models import Project
    from app.domains.processing.language_edit_models import ProjectLanguageRulesHistory

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        raise ValueError(f"Project ID {project_id} not found or missing project code.")

    # Reconcile single vs multi-style arguments.
    if profile_keys:
        pkeys = list(profile_keys)
    elif profile_key:
        pkeys = [profile_key]
    else:
        pkeys = ["uk"]
    primary_key = pkeys[0]

    available_profiles = get_available_style_profiles()
    primary_profile = available_profiles.get(primary_key, available_profiles.get("uk", {}))

    # If the caller didn't supply rules/dict, derive the union from the selected styles.
    if rules is None or variant_to_canonical is None:
        union = build_rules_union(pkeys, available_profiles)
        if rules is None:
            rules = union["rules"]
        if variant_to_canonical is None:
            variant_to_canonical = union["variant_to_canonical"]

    final_name = profile_name or primary_profile.get(
        "name", f"{'+'.join(k.upper() for k in pkeys)} Language Editing Rules"
    )

    rule_data = {
        "project_id": project.id,
        "project_code": project.project_code,
        "profile_key": primary_key,           # back-compat: first style
        "profile_keys": pkeys,                # multi-style (source of truth)
        "name": final_name,
        "description": primary_profile.get("description", ""),
        "variant_to_canonical": variant_to_canonical,
        "rules": rules,
    }

    file_path = get_project_language_rules_path(project.project_code)
    filename = os.path.basename(file_path)

    # Capture previous disk state for the audit row before overwriting.
    previous_rules: Optional[dict[str, Any]] = None
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                previous_rules = json.load(f)
        except Exception as exc:
            logger.warning("Could not read previous rules JSON at %s: %s", file_path, exc)
    ce_template_dir = get_project_language_rules_dir(project.project_code, project.client_name or "unknown")
    filename = f"{project.project_code}_language_rules.json"
    file_path = os.path.join(ce_template_dir, filename)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(rule_data, f, indent=2, ensure_ascii=False)
    logger.info("Saved language rules JSON for project %s at %s", project.project_code, file_path)

    # Ensure CE Support chapter + file row so the JSON shows up in the UI.
    ce_chapter = _ensure_ce_support_chapter(db, project)
    db_file = (
        db.query(models.File)
        .filter(
            models.File.project_id == project.id,
            models.File.chapter_id == ce_chapter.id,
            models.File.filename == filename,
        )
        .first()
    )
    if not db_file:
        db.add(models.File(
            filename=filename,
            file_type=".json",
            path=file_path,
            project_id=project.id,
            chapter_id=ce_chapter.id,
            category="Style sheet template",
            is_original=True,
        ))
        logger.info("Registered language rules JSON for project %s under chapter %s",
                    project.project_code, ce_chapter.id)
    else:
        db_file.path = file_path
        db_file.category = "Style sheet template"

    # Audit trail (keeps the history drawer working).
    if changed_by_id is not None:
        enabled_ids = [r.get("id") for r in rules if r.get("enabled", True) and r.get("id")]
        disabled_ids = [r.get("id") for r in rules if not r.get("enabled", True) and r.get("id")]
        db.add(ProjectLanguageRulesHistory(
            project_id=project.id,
            changed_by_id=changed_by_id,
            profile_key=primary_key,
            enabled_rule_ids=enabled_ids,
            disabled_rule_ids=disabled_ids,
            previous_rules=previous_rules,
            new_rules=rule_data,
            note=note,
        ))

    return rule_data


def _ensure_ce_support_chapter(db: Session, project):
    """Return the CE support chapter for a project, creating it if missing."""
    from app import models

    ce_chapter = (
        db.query(models.ChapterInfo)
        .filter(
            models.ChapterInfo.project == project.project_code,
            models.ChapterInfo.chapters.ilike("ce support"),
        )
        .first()
    )
    if ce_chapter:
        return ce_chapter

    sibling = (
        db.query(models.ChapterInfo)
        .filter(models.ChapterInfo.project == project.project_code)
        .order_by(models.ChapterInfo.id)
        .first()
    )
    ce_chapter = models.ChapterInfo(
        client=sibling.client if sibling else "",
        project=project.project_code,
        chapters="CE support",
        chapter_title="CE Support",
        stage_name="Job Initiation",
        status="In-progress",
        workflow=sibling.workflow if sibling else "WF-01 Fresh Book",
        published_status="Draft",
        priority="Normal",
    )
    db.add(ce_chapter)
    db.flush()
    logger.info("Auto-created CE support chapter %s for project %s",
                ce_chapter.id, project.project_code)
    return ce_chapter


# ─── Read (disk-first with profile fallback) ──────────────────────────────────

def get_project_language_rules(db: Session, *, project_id: int) -> dict[str, Any]:
    """Return per-project rules from the project's CE Support JSON.

    Fallback: when a project has no saved JSON yet, return the UK base profile
    with everything enabled, tagged with the project's identity so new projects
    behave sensibly on first analyze.
    """
    from app.domains.projects.models import Project

    project = db.query(Project).filter(Project.id == project_id).first()

    if project and project.project_code:
        file_path = get_project_language_rules_path(project.project_code)
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # Back-compat: fill in profile_keys if an older JSON only has profile_key
                if "profile_keys" not in data:
                    data["profile_keys"] = [data.get("profile_key", "uk")]
                return data
            except Exception as exc:
                logger.warning("Error reading language rules JSON at %s: %s", file_path, exc)
    ce_template_dir = get_project_language_rules_dir(project.project_code, project.client_name or "unknown")
    filename = f"{project.project_code}_language_rules.json"
    file_path = os.path.join(ce_template_dir, filename)

    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Error reading language rules JSON at %s: %s", file_path, exc)

    profiles = get_available_style_profiles()
    default_data = dict(profiles.get("uk", {}))
    if project:
        default_data["project_id"] = project.id
        default_data["project_code"] = project.project_code
    default_data["profile_key"] = "uk"
    default_data["profile_keys"] = ["uk"]
    return default_data


# ─── Audit history (unchanged — DB-backed) ────────────────────────────────────

def get_project_language_rules_history(
    db: Session, *, project_id: int, limit: int = 50
) -> list[dict[str, Any]]:
    """Return newest-first audit entries for a project's rule changes."""
    from app.domains.processing.language_edit_models import ProjectLanguageRulesHistory
    from app.models import User

    rows = (
        db.query(ProjectLanguageRulesHistory)
        .filter(ProjectLanguageRulesHistory.project_id == project_id)
        .order_by(ProjectLanguageRulesHistory.changed_at.desc())
        .limit(limit)
        .all()
    )

    user_ids = {r.changed_by_id for r in rows if r.changed_by_id is not None}
    users = {
        u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    out = []
    for r in rows:
        u = users.get(r.changed_by_id)
        out.append({
            "id": r.id,
            "changed_at": r.changed_at.isoformat() if r.changed_at else None,
            "changed_by_id": r.changed_by_id,
            "changed_by_username": u.username if u else None,
            "profile_key": r.profile_key,
            "enabled_rule_ids": r.enabled_rule_ids or [],
            "disabled_rule_ids": r.disabled_rule_ids or [],
            "enabled_count": len(r.enabled_rule_ids or []),
            "disabled_count": len(r.disabled_rule_ids or []),
            "note": r.note,
        })
    return out
