"""
Service for managing project-level Language Editing rules & style profiles.
Saves and syncs language editing rule JSON files in the project's 'CE support' folder
and registers them in the DB files table (mirroring stylesheet_service.py).
"""
import json
import logging
import os
import re
from typing import Any, Optional
from sqlalchemy.orm import Session
from app.core.paths import UPLOADS_DIR

logger = logging.getLogger(__name__)

PROFILES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "processing", "language_editing", "config", "profiles"
)


def get_available_style_profiles() -> dict[str, dict[str, Any]]:
    """Load all base style profiles from config/profiles/*.json."""
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


def get_project_language_rules_dir(project_code: str) -> str:
    path = os.path.join(str(UPLOADS_DIR), project_code, "CE support", "Style sheet template")
    os.makedirs(path, exist_ok=True)
    return path


def save_project_language_rules(
    db: Session,
    *,
    project_id: int,
    profile_key: str = "uk",
    rules: Optional[list[dict[str, Any]]] = None,
    variant_to_canonical: Optional[dict[str, str]] = None,
    profile_name: Optional[str] = None
) -> dict[str, Any]:
    """
    Saves/syncs the language editing rules JSON to the project's 'CE support/Style sheet template'
    directory as '{project_code}_language_rules.json' and registers in models.File.
    """
    from app import models
    from app.domains.projects.models import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        raise ValueError(f"Project ID {project_id} not found or missing project code.")

    available_profiles = get_available_style_profiles()
    base_profile = available_profiles.get(profile_key, available_profiles.get("uk", {}))

    final_rules = rules if rules is not None else base_profile.get("rules", [])
    final_style = variant_to_canonical if variant_to_canonical is not None else base_profile.get("variant_to_canonical", {})

    rule_data = {
        "project_id": project.id,
        "project_code": project.project_code,
        "profile_key": profile_key,
        "name": profile_name or base_profile.get("name", f"{profile_key.upper()} Language Editing Rules"),
        "description": base_profile.get("description", ""),
        "variant_to_canonical": final_style,
        "rules": final_rules,
    }

    ce_template_dir = get_project_language_rules_dir(project.project_code)
    filename = f"{project.project_code}_language_rules.json"
    file_path = os.path.join(ce_template_dir, filename)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(rule_data, f, indent=2, ensure_ascii=False)

    logger.info("Saved language rules to disk for project %s at %s", project.project_code, file_path)

    # Register in models.File under 'CE support' chapter
    ce_chapter = (
        db.query(models.ChapterInfo)
        .filter(
            models.ChapterInfo.project == project.project_code,
            models.ChapterInfo.chapters.ilike("ce support"),
        )
        .first()
    )
    if ce_chapter:
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
            db_file = models.File(
                filename=filename,
                file_type=".json",
                path=file_path,
                project_id=project.id,
                chapter_id=ce_chapter.id,
                category="Style sheet template",
                is_original=True,
            )
            db.add(db_file)
            db.commit()
            logger.info("Registered language rules JSON in DB files table with ID %s", db_file.id)
        else:
            db_file.path = file_path
            db_file.category = "Style sheet template"
            db.commit()

    return rule_data


def get_project_language_rules(db: Session, *, project_id: int) -> dict[str, Any]:
    """Reads active project language rules JSON from project's CE support directory."""
    from app.domains.projects.models import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        # Fallback to default UK profile
        profiles = get_available_style_profiles()
        return profiles.get("uk", {})

    ce_template_dir = get_project_language_rules_dir(project.project_code)
    filename = f"{project.project_code}_language_rules.json"
    file_path = os.path.join(ce_template_dir, filename)

    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Error reading language rules JSON at %s: %s", file_path, exc)

    # Fall back to default UK profile
    profiles = get_available_style_profiles()
    default_data = profiles.get("uk", {})
    default_data["project_id"] = project.id
    default_data["project_code"] = project.project_code
    default_data["profile_key"] = "uk"
    return default_data
