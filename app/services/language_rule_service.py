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
import re
import uuid
from typing import Any, Optional
from datetime import timezone
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


# Workbook-driven dash/hyphen rules ship their own style axis
# (`all` | `mw_dictionary` | `chicago_ama_apa`) that is orthogonal to the
# existing UK/US/AMA profile_keys. Projects without an explicit choice
# behave as if they picked ``all`` — the workbook's own default — so the
# feature switches on silently for legacy data.
DEFAULT_DASH_PROFILE = "all"
VALID_DASH_PROFILES = ("all", "mw_dictionary", "chicago_ama_apa")

# Phase B abbreviations settings persisted in the project sidecar JSON.
# No DB column — the service treats these as opaque fields on the config
# dict (Phase E will decide if a column is warranted). Validation is
# minimal: audience ∈ {general, professional}; min_uses is a positive int.
DEFAULT_AUDIENCE = "general"
VALID_AUDIENCES = ("general", "professional")
DEFAULT_MIN_USES = 2


def _validate_audience(raw: Any) -> str:
    if raw is None:
        return DEFAULT_AUDIENCE
    s = str(raw).strip().lower()
    if s not in VALID_AUDIENCES:
        raise ValueError(
            f"Invalid audience {raw!r}; expected one of {VALID_AUDIENCES}"
        )
    return s


def _validate_min_uses(raw: Any) -> int:
    if raw is None:
        return DEFAULT_MIN_USES
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ValueError(f"min_uses must be an integer; got {raw!r}")
    if n < 1:
        raise ValueError(f"min_uses must be ≥ 1; got {n}")
    return n


# Phase C AB16: when True, first-use rules re-fire at every detectable
# scope boundary (new chapter, abstract-body transition, …). Phase C
# ships the field + a crude per-paragraph fallback; Phase D will add
# proper boundary detection once paragraph-style metadata is available.
DEFAULT_SCOPE_RESET = False

# Medical Terminology workbook (M-D): style profile gates the subprofile
# rules (US spelling, Possessive, Nonpossessive). ``All`` always fires;
# the other three only fire when the project opts in. Default ``All``
# keeps subprofile rules silent for legacy projects.
DEFAULT_MEDICAL_STYLE_PROFILE = "All"
VALID_MEDICAL_STYLE_PROFILES = ("All", "US spelling", "UK spelling", "Possessive", "Nonpossessive")


def _validate_medical_style_profile(raw: Any) -> str:
    if raw is None:
        return DEFAULT_MEDICAL_STYLE_PROFILE
    s = str(raw).strip()
    if s not in VALID_MEDICAL_STYLE_PROFILES:
        raise ValueError(
            f"Invalid medical_style_profile {raw!r}; "
            f"expected one of {VALID_MEDICAL_STYLE_PROFILES}"
        )
    return s


def _validate_scope_reset(raw: Any) -> bool:
    if raw is None:
        return DEFAULT_SCOPE_RESET
    if isinstance(raw, bool):
        return raw
    s = str(raw).strip().lower()
    if s in ("true", "yes", "1"):
        return True
    if s in ("false", "no", "0", ""):
        return False
    raise ValueError(f"scope_reset must be a boolean; got {raw!r}")


# ─── Scope D: custom (user-authored) regex rules ──────────────────────────────
#
# Reviewers can promote an ad-hoc regex from the editor's Find bar into a
# persistent, reusable rule. The persisted rule lives in the project
# sidecar JSON under ``custom_rules`` (new field, backward-compatible —
# older sidecars with no key are read as empty) and participates in the
# analysis pipeline through the same code path as profile rules.
#
# A custom rule is stored as the same dict shape ``load_rules_from_dict``
# consumes (id, category, type='regex', pattern, replacement, flags,
# message, severity, enabled, tool_behaviour). The service enforces:
#   * pattern compiles (Python ``re``)
#   * flags are a subset of {"IGNORECASE", "MULTILINE", "DOTALL"}
#   * replacement, if present, compiles against the pattern (so bogus
#     ``\99`` backrefs are caught before save, not at analyze time)
#   * category is one of the known Rules Picker categories (plus the
#     dedicated "custom" bucket where new rules land by default)
#   * severity ∈ {error, warning, suggestion}
#   * tool_behaviour ∈ {flag, auto_replace}

VALID_CUSTOM_CATEGORIES = (
    "custom", "grammar", "spelling", "sentence", "compounds",
    "inclusive", "hyphenation", "abbreviations", "other",
)
VALID_CUSTOM_SEVERITIES = ("error", "warning", "suggestion")
VALID_CUSTOM_FLAGS = ("IGNORECASE", "MULTILINE", "DOTALL")
VALID_CUSTOM_TOOL_BEHAVIOURS = ("flag", "auto_replace")

# Hard upper bound on compiled-pattern complexity. The pattern itself is
# the user's input, so we reject obviously-degenerate shapes before
# hitting the engine. Backtracking-safe patterns are not something we can
# detect perfectly without executing; a length ceiling is a crude but
# honest guard.
_MAX_CUSTOM_PATTERN_LENGTH = 500
_MAX_CUSTOM_REPLACEMENT_LENGTH = 500


def _slugify_rule_id(seed: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", seed.strip().lower()).strip("-")
    return s[:40] if s else "rule"


def _validate_custom_rule(raw: Any, *, existing_ids: Optional[set[str]] = None) -> dict[str, Any]:
    """Validate a single custom rule dict and return a normalised copy.

    Raises ``ValueError`` with a user-facing message on any violation.
    """
    if not isinstance(raw, dict):
        raise ValueError("Custom rule must be an object")

    pattern = raw.get("pattern")
    if not isinstance(pattern, str) or not pattern.strip():
        raise ValueError("Custom rule requires a non-empty 'pattern'")
    if len(pattern) > _MAX_CUSTOM_PATTERN_LENGTH:
        raise ValueError(
            f"Pattern too long ({len(pattern)} chars; max {_MAX_CUSTOM_PATTERN_LENGTH})"
        )

    raw_flags = raw.get("flags") or []
    if isinstance(raw_flags, str):
        raw_flags = [raw_flags]
    if not isinstance(raw_flags, list):
        raise ValueError("flags must be a list of strings")
    norm_flags: list[str] = []
    bitflags = 0
    for f in raw_flags:
        if not isinstance(f, str):
            continue
        up = f.upper()
        if up not in VALID_CUSTOM_FLAGS:
            raise ValueError(
                f"Unsupported flag {f!r}; allowed: {', '.join(VALID_CUSTOM_FLAGS)}"
            )
        if up not in norm_flags:
            norm_flags.append(up)
            bitflags |= getattr(re, up)

    try:
        compiled = re.compile(pattern, bitflags)
    except re.error as exc:
        raise ValueError(f"Invalid regex: {exc}") from exc

    replacement = raw.get("replacement")
    if replacement is not None:
        if not isinstance(replacement, str):
            raise ValueError("replacement must be a string")
        if len(replacement) > _MAX_CUSTOM_REPLACEMENT_LENGTH:
            raise ValueError(
                f"Replacement too long ({len(replacement)} chars; "
                f"max {_MAX_CUSTOM_REPLACEMENT_LENGTH})"
            )
        # Validate backrefs against the compiled pattern. A ValueError
        # here points to a bad \1 / \99 reference the engine would
        # otherwise raise at analyze time.
        try:
            compiled.sub(replacement, "")
        except (re.error, IndexError) as exc:
            raise ValueError(f"Invalid replacement: {exc}") from exc

    category = str(raw.get("category") or "custom").strip().lower()
    if category not in VALID_CUSTOM_CATEGORIES:
        raise ValueError(
            f"Unknown category {category!r}; allowed: {', '.join(VALID_CUSTOM_CATEGORIES)}"
        )

    severity = str(raw.get("severity") or "warning").strip().lower()
    if severity not in VALID_CUSTOM_SEVERITIES:
        raise ValueError(
            f"Unknown severity {severity!r}; allowed: {', '.join(VALID_CUSTOM_SEVERITIES)}"
        )

    tool_behaviour = raw.get("tool_behaviour") or "flag"
    if tool_behaviour not in VALID_CUSTOM_TOOL_BEHAVIOURS:
        raise ValueError(
            f"Unknown tool_behaviour {tool_behaviour!r}; "
            f"allowed: {', '.join(VALID_CUSTOM_TOOL_BEHAVIOURS)}"
        )

    message = str(raw.get("message") or "").strip() or "Custom regex rule"
    if len(message) > 200:
        message = message[:200]

    rule_id = str(raw.get("id") or "").strip()
    if not rule_id:
        slug = _slugify_rule_id(message)
        rule_id = f"CUST-{slug}-{uuid.uuid4().hex[:6]}"
    # Prefix every custom rule id so engine / overrides can't collide
    # with profile or workbook rules. Idempotent — don't double-prefix
    # when the caller already supplied a CUST- id.
    if not rule_id.startswith("CUST-"):
        rule_id = f"CUST-{rule_id}"
    if existing_ids and rule_id in existing_ids:
        rule_id = f"{rule_id}-{uuid.uuid4().hex[:4]}"

    enabled = raw.get("enabled")
    enabled = True if enabled is None else bool(enabled)

    created_by = raw.get("created_by")
    if created_by is not None and not isinstance(created_by, (int, str)):
        created_by = None
    created_at = raw.get("created_at")
    if created_at is not None and not isinstance(created_at, str):
        created_at = None

    return {
        "id": rule_id,
        "category": category,
        "type": "regex",
        "pattern": pattern,
        "replacement": replacement,
        "flags": norm_flags,
        "message": message,
        "severity": severity,
        "enabled": enabled,
        "tool_behaviour": tool_behaviour,
        "origin": "custom",
        "created_by": created_by,
        "created_at": created_at,
    }


def _validate_custom_rules(raw: Any) -> list[dict[str, Any]]:
    """Validate a list of custom rules. Rejects duplicate IDs."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("custom_rules must be a list")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, entry in enumerate(raw):
        try:
            cleaned = _validate_custom_rule(entry, existing_ids=seen)
        except ValueError as exc:
            raise ValueError(f"custom_rules[{i}]: {exc}") from exc
        seen.add(cleaned["id"])
        out.append(cleaned)
    return out


def add_project_custom_rule(
    db: Session, *, project_id: int, draft: dict[str, Any],
    created_by_id: Optional[int] = None,
) -> dict[str, Any]:
    """Append a new custom rule to the project sidecar. Returns the stored rule."""
    import datetime as _dt

    cfg = get_project_language_rules(db, project_id=project_id)
    existing = cfg.get("custom_rules") or []
    seen_ids = {r.get("id") for r in existing if isinstance(r, dict)}

    draft = dict(draft)
    draft.setdefault("created_at", _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z")
    if created_by_id is not None:
        draft.setdefault("created_by", created_by_id)
    new_rule = _validate_custom_rule(draft, existing_ids=seen_ids)
    merged = existing + [new_rule]

    save_project_language_rules(
        db,
        project_id=project_id,
        profile_keys=cfg.get("profile_keys"),
        rules=cfg.get("rules"),
        variant_to_canonical=cfg.get("variant_to_canonical"),
        changed_by_id=created_by_id,
        note=f"Added custom rule {new_rule['id']}",
        dash_profile=cfg.get("dash_profile"),
        rule_overrides=cfg.get("rule_overrides"),
        audience=cfg.get("audience"),
        min_uses=cfg.get("min_uses"),
        scope_reset=cfg.get("scope_reset"),
        custom_rules=merged,
    )
    return new_rule


def delete_project_custom_rule(
    db: Session, *, project_id: int, rule_id: str,
    changed_by_id: Optional[int] = None,
) -> bool:
    """Remove a custom rule by id. Returns True if a rule was removed."""
    cfg = get_project_language_rules(db, project_id=project_id)
    existing = cfg.get("custom_rules") or []
    remaining = [r for r in existing if isinstance(r, dict) and r.get("id") != rule_id]
    if len(remaining) == len(existing):
        return False

    # Also drop any dangling override entry for the deleted rule so the
    # sidecar doesn't accumulate stale references.
    overrides = dict(cfg.get("rule_overrides") or {})
    overrides.pop(rule_id, None)

    save_project_language_rules(
        db,
        project_id=project_id,
        profile_keys=cfg.get("profile_keys"),
        rules=cfg.get("rules"),
        variant_to_canonical=cfg.get("variant_to_canonical"),
        changed_by_id=changed_by_id,
        note=f"Deleted custom rule {rule_id}",
        dash_profile=cfg.get("dash_profile"),
        rule_overrides=overrides,
        audience=cfg.get("audience"),
        min_uses=cfg.get("min_uses"),
        scope_reset=cfg.get("scope_reset"),
        custom_rules=remaining,
    )
    return True


def _validate_rule_overrides(raw: Any) -> dict[str, dict[str, Any]]:
    """Validate and normalise the per-rule override map.

    Accepts None / {} / dict. Each entry must be a dict with optional
    ``enabled`` (bool) and ``tool_behaviour`` ('flag' | 'auto_replace').
    Unknown keys are stripped so a rogue client can't smuggle fields
    through the sidecar JSON.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError(f"rule_overrides must be a dict; got {type(raw).__name__}")
    cleaned: dict[str, dict[str, Any]] = {}
    for rid, override in raw.items():
        if not isinstance(rid, str) or not rid:
            continue
        if not isinstance(override, dict):
            continue
        entry: dict[str, Any] = {}
        if "enabled" in override:
            entry["enabled"] = bool(override["enabled"])
        tb = override.get("tool_behaviour")
        if tb in ("flag", "auto_replace"):
            entry["tool_behaviour"] = tb
        if entry:
            cleaned[rid] = entry
    return cleaned


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
    dash_profile: Optional[str] = None,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
    audience: Optional[str] = None,
    min_uses: Optional[int] = None,
    scope_reset: Optional[bool] = None,
    custom_rules: Optional[list[dict[str, Any]]] = None,
    medical_style_profile: Optional[str] = None,
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

    if dash_profile is None:
        dash_profile = DEFAULT_DASH_PROFILE
    elif dash_profile not in VALID_DASH_PROFILES:
        raise ValueError(
            f"Invalid dash_profile {dash_profile!r}; expected one of {VALID_DASH_PROFILES}"
        )

    rule_data = {
        "project_id": project.id,
        "project_code": project.project_code,
        "profile_key": primary_key,           # back-compat: first style
        "profile_keys": pkeys,                # multi-style (source of truth)
        "dash_profile": dash_profile,         # workbook-driven axis
        "name": final_name,
        "description": primary_profile.get("description", ""),
        "variant_to_canonical": variant_to_canonical,
        "rules": rules,
        # Scope C per-rule overrides keyed by rule id. Sparse — only
        # entries that diverge from the rule's default are stored.
        "rule_overrides": _validate_rule_overrides(rule_overrides),
        # Phase B abbreviations settings.
        "audience": _validate_audience(audience),
        "min_uses": _validate_min_uses(min_uses),
        # Phase C AB16: scope_reset. Field persists; the engine honours it
        # with a crude per-paragraph fallback until Phase D ships
        # paragraph-style metadata.
        "scope_reset": _validate_scope_reset(scope_reset),
        # Scope D: user-authored regex rules. Empty on first save for a
        # project; the regex playground in the Language Editor appends
        # here through ``add_project_custom_rule``.
        "custom_rules": _validate_custom_rules(custom_rules),
        # Medical Terminology workbook (M-D): style profile setting.
        # Defaults to 'All'; subprofile rules fire only when a project
        # opts in via the Rules Picker.
        "medical_style_profile": _validate_medical_style_profile(medical_style_profile),
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
                # Workbook dash profile — older JSONs predate the field; apply
                # the backward-compatible default so downstream readers can
                # trust the key is present and valid.
                if data.get("dash_profile") not in VALID_DASH_PROFILES:
                    data["dash_profile"] = DEFAULT_DASH_PROFILE
                # Scope C: older sidecars predate rule_overrides. Normalise
                # to {} so engine / router consumers never have to None-check.
                data["rule_overrides"] = _validate_rule_overrides(
                    data.get("rule_overrides")
                )
                # Phase B: default abbreviations settings for legacy configs.
                try:
                    data["audience"] = _validate_audience(data.get("audience"))
                except ValueError:
                    data["audience"] = DEFAULT_AUDIENCE
                try:
                    data["min_uses"] = _validate_min_uses(data.get("min_uses"))
                except ValueError:
                    data["min_uses"] = DEFAULT_MIN_USES
                try:
                    data["scope_reset"] = _validate_scope_reset(data.get("scope_reset"))
                except ValueError:
                    data["scope_reset"] = DEFAULT_SCOPE_RESET
                # Scope D: tolerate legacy sidecars without the field; drop
                # any entry that no longer validates (silent rather than
                # failing the entire read — a corrupt custom rule shouldn't
                # take down the Language Editor for the whole project).
                raw_custom = data.get("custom_rules")
                if raw_custom:
                    valid: list[dict[str, Any]] = []
                    for i, entry in enumerate(raw_custom):
                        try:
                            valid.append(_validate_custom_rule(entry))
                        except Exception as exc:
                            logger.warning(
                                "Dropping invalid custom_rules[%d] in %s: %s",
                                i, file_path, exc,
                            )
                    data["custom_rules"] = valid
                else:
                    data["custom_rules"] = []
                # Medical Terminology workbook (M-D): default + validate.
                try:
                    data["medical_style_profile"] = _validate_medical_style_profile(
                        data.get("medical_style_profile")
                    )
                except ValueError:
                    data["medical_style_profile"] = DEFAULT_MEDICAL_STYLE_PROFILE
                return data
            except Exception as exc:
                logger.warning("Error reading language rules JSON at %s: %s", file_path, exc)

    profiles = get_available_style_profiles()
    default_data = dict(profiles.get("uk", {}))
    if project:
        default_data["project_id"] = project.id
        default_data["project_code"] = project.project_code
    default_data["profile_key"] = "uk"
    default_data["profile_keys"] = ["uk"]
    default_data["dash_profile"] = DEFAULT_DASH_PROFILE
    default_data["rule_overrides"] = {}
    default_data["audience"] = DEFAULT_AUDIENCE
    default_data["min_uses"] = DEFAULT_MIN_USES
    default_data["scope_reset"] = DEFAULT_SCOPE_RESET
    default_data["custom_rules"] = []
    default_data["medical_style_profile"] = DEFAULT_MEDICAL_STYLE_PROFILE
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
        fn = (getattr(u, "first_name", None) or "").strip() if u else ""
        ln = (getattr(u, "last_name", None) or "").strip() if u else ""
        if fn and ln:
            full_name = fn if (fn.endswith(f" {ln}") or fn.endswith(ln)) else f"{fn} {ln}"
        else:
            full_name = fn or ln or (u.username if u else None)

        dt_val = r.changed_at
        if dt_val and dt_val.tzinfo is None:
            dt_val = dt_val.replace(tzinfo=timezone.utc)

        out.append({
            "id": r.id,
            "changed_at": dt_val.isoformat() if dt_val else None,
            "changed_by_id": r.changed_by_id,
            "changed_by_username": full_name or (u.username if u else None),
            "profile_key": r.profile_key,
            "enabled_rule_ids": r.enabled_rule_ids or [],
            "disabled_rule_ids": r.disabled_rule_ids or [],
            "enabled_count": len(r.enabled_rule_ids or []),
            "disabled_count": len(r.disabled_rule_ids or []),
            "note": r.note,
        })
    return out
