import json
import logging
import os
import re
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app import models, schemas_v2
from app.core.paths import UPLOADS_DIR
from app.domains.projects.models import ProjectStylesheet

logger = logging.getLogger(__name__)


def _as_utc(value: datetime | None) -> datetime | None:
    """Naive datetimes in the DB come from `datetime.utcnow()`. Attach UTC
    tzinfo so JSON serialization includes the offset and browsers parse them
    as UTC (not as local time)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _deserialize_ia_rows(raw: str) -> list[schemas_v2.IARow]:
    try:
        data = json.loads(raw or "[]")
        return [schemas_v2.IARow(**row) for row in data]
    except Exception:
        return []


def _deserialize_file_ids(raw: str | None) -> list[int]:
    try:
        return json.loads(raw or "[]")
    except Exception:
        return []


def _deserialize_dict(raw: str | None) -> dict:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _clean_ce_rules(ce_rules: dict | None) -> dict:
    """Keep only known checklist rules and valid values (see ce_rules.validate_ce_rules)."""
    from app.processing.manuscript_core.rules.ce_rules import validate_ce_rules

    raw = {
        str(k): (v.model_dump(exclude_none=True) if hasattr(v, "model_dump") else v)
        for k, v in (ce_rules or {}).items()
    }
    return validate_ce_rules(raw)


def stylesheet_ce_rules(ss: ProjectStylesheet | None) -> dict:
    return _deserialize_dict(getattr(ss, "ce_rules", None)) if ss else {}


def _serialize_stylesheet(
    ss: ProjectStylesheet,
    db: Session | None = None,
) -> schemas_v2.StylesheetSummary:
    file_ids = _deserialize_file_ids(ss.analyzed_file_ids)
    source_files: list[schemas_v2.StylesheetSourceFile] = []
    if db is not None and file_ids:
        # Preserve the order in `analyzed_file_ids` so the UI shows the same
        # sequence the user picked during analysis.
        rows = (
            db.query(models.File.id, models.File.filename)
            .filter(models.File.id.in_(file_ids))
            .all()
        )
        by_id = {row.id: row.filename for row in rows}
        source_files = [
            schemas_v2.StylesheetSourceFile(id=fid, filename=by_id[fid])
            for fid in file_ids
            if fid in by_id
        ]

    return schemas_v2.StylesheetSummary(
        id=ss.id,
        project_id=ss.project_id,
        name=ss.name,
        description=ss.description,
        is_active=ss.is_active,
        created_at=_as_utc(ss.created_at),
        updated_at=_as_utc(getattr(ss, "updated_at", None) or ss.created_at),
        created_by_id=ss.created_by_id,
        selected_ia_rows=_deserialize_ia_rows(ss.selected_ia_rows),
        analyzed_file_ids=file_ids,
        source_files=source_files,
        ce_rules=_deserialize_dict(getattr(ss, "ce_rules", None)),
        style_profile=_deserialize_dict(getattr(ss, "style_profile", None)),
    )


def get_stylesheets_for_project(
    db: Session, *, project_id: int
) -> dict:
    stylesheets = (
        db.query(ProjectStylesheet)
        .filter(ProjectStylesheet.project_id == project_id)
        .order_by(ProjectStylesheet.created_at.desc())
        .all()
    )
    active = next((s for s in stylesheets if s.is_active), None)
    return {
        "stylesheets": stylesheets,
        "active": active,
    }


def get_active_stylesheet_for_project(
    db: Session, *, project_id: int
) -> ProjectStylesheet | None:
    return (
        db.query(ProjectStylesheet)
        .filter(
            ProjectStylesheet.project_id == project_id,
            ProjectStylesheet.is_active.is_(True),
        )
        .first()
    )


STYLESHEET_JSON_FORMAT = "cms-stylesheet/1"
CANONICAL_STYLESHEET_JSON = "stylesheet.json"
DOCX_HANDLED_KEY = "docx_handled_sha256"


def _sha256(content: bytes) -> str:
    import hashlib
    return hashlib.sha256(content).hexdigest()


def _read_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _stylesheet_json_filename(ss: ProjectStylesheet) -> str:
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', ss.name).strip('_') or f"stylesheet_{ss.id}"
    return f"{safe_name}_stylesheet.json"


def _template_dir(project) -> str:
    return os.path.join(
        str(UPLOADS_DIR),
        project.client_name or "unknown",
        project.project_code,
        "CE support",
        "Style sheet template",
    )


def migrate_ia_rows_to_ce_rules(selected_ia_rows: list[dict | schemas_v2.IARow] | None, ce_rules: dict | None) -> tuple[dict, list[str]]:
    """Convert incoming selected_ia_rows into ce_rules with conflict warnings.

    Single source of truth in storage:
    - Explicit settings in ce_rules take precedence.
    - Each IA row with an option-level mapping sets ce_rules[sno]["option"] = opt.
      If multiple rows target the same sno with different options, first row wins and a warning is logged.
    - If a row maps to structural/new rules 126-137, rule is enabled: ce_rules[sno]["enabled"] = True.
    """
    from app.processing.manuscript_core.rules.ce_rules import ia_row_to_rule

    rules = dict(_clean_ce_rules(ce_rules) if ce_rules else {})
    warnings: list[str] = []
    seen_options: dict[int, int] = {}

    rows = selected_ia_rows or []
    for r in rows:
        if hasattr(r, "model_dump"):
            r = r.model_dump()
        if not isinstance(r, dict):
            continue
        el = r.get("element") or ""
        sub = r.get("subtype") or "General"
        pat = r.get("pattern") or ""
        if not (el and pat):
            continue

        mapping = ia_row_to_rule(el, sub, pat)
        if not mapping:
            continue
        sno, opt = mapping
        sno_key = str(sno)

        if sno_key not in rules:
            rules[sno_key] = {"enabled": True}

        if opt is not None:
            existing_opt = rules[sno_key].get("option")
            if existing_opt is None:
                if sno in seen_options and seen_options[sno] != opt:
                    warnings.append(f"Conflict on Rule {sno}: pattern '{pat}' implies option {opt}, keeping option {seen_options[sno]}")
                else:
                    rules[sno_key]["option"] = opt
                    seen_options[sno] = opt
        else:
            rules[sno_key]["enabled"] = True

    return rules, warnings


def project_ia_rows(ce_rules: dict | None) -> list[dict]:
    """Derive the selected_ia_rows projection strictly from active ce_rules."""
    from app.processing.manuscript_core.rules.ce_rules import by_sno

    rules_dict = by_sno()
    clean_rules = _clean_ce_rules(ce_rules) if ce_rules else {}
    projected: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    for sno_str, setting in clean_rules.items():
        try:
            sno = int(sno_str)
        except (ValueError, TypeError):
            continue
        if not setting.get("enabled", True):
            continue
        rule_meta = rules_dict.get(sno)
        if not rule_meta:
            continue

        opt = setting.get("option", 1)
        ia_patterns = rule_meta.get("ia_patterns") or []
        for p in ia_patterns:
            p_opt = p.get("option")
            if p_opt is None or p_opt == opt:
                key = (p["element"], p.get("subtype") or "General", p["pattern"])
                if key not in seen:
                    seen.add(key)
                    projected.append({
                        "element": p["element"],
                        "subtype": p.get("subtype") or "General",
                        "pattern": p["pattern"]
                    })

    return projected


def _normalised_content(name, ce_rules, selected_ia_rows, style_profile) -> dict:
    """The parts of a stylesheet that drive the Technical Edit, in a stable form for hashing."""
    def _rows(rows):
        out = []
        for r in rows or []:
            if hasattr(r, "model_dump"):
                r = r.model_dump()
            if isinstance(r, dict):
                out.append([r.get("element") or "", r.get("subtype") or "", r.get("pattern") or ""])
        return sorted(out)

    def _load(v, default):
        if isinstance(v, str):
            try:
                return json.loads(v or "null") or default
            except Exception:
                return default
        return v or default

    return {
        "name": (name or "").strip(),
        "ce_rules": _clean_ce_rules(_load(ce_rules, {})),
        "selected_ia_rows": _rows(_load(selected_ia_rows, [])),
        "style_profile": _load(style_profile, {}),
    }


def legacy_content_hash(name, ce_rules, selected_ia_rows, style_profile) -> str:
    import hashlib
    payload = json.dumps(_normalised_content(name, ce_rules, selected_ia_rows, style_profile),
                         sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def content_hash(name, ce_rules, selected_ia_rows=None, style_profile=None) -> str:
    import hashlib
    def _load(v, default):
        if isinstance(v, str):
            try:
                return json.loads(v or "null") or default
            except Exception:
                return default
        return v or default

    clean_ce = _clean_ce_rules(_load(ce_rules, {}))
    clean_prof = _load(style_profile, {})
    payload = json.dumps({
        "name": (name or "").strip(),
        "ce_rules": clean_ce,
        "style_profile": clean_prof,
    }, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _stylesheet_hash(ss: ProjectStylesheet) -> str:
    return content_hash(ss.name, ss.ce_rules, ss.selected_ia_rows, getattr(ss, "style_profile", None))


def stylesheet_json_payload(db: Session, ss: ProjectStylesheet) -> dict:
    """The stylesheet exactly as written to CE support/Style sheet template/stylesheet.json."""
    data = _serialize_stylesheet(ss, db=db).model_dump(mode="json")
    data["format"] = STYLESHEET_JSON_FORMAT
    data["content_hash"] = _stylesheet_hash(ss)
    return data


def _save_stylesheet_to_disk(db: Session, ss: ProjectStylesheet) -> str | None:
    """Write the stylesheet to the project's 'CE support/Style sheet template' folder.

    ``<name>_stylesheet.json`` is written for every stylesheet. The canonical
    ``stylesheet.json`` (read by Technical Review) is written only for the ACTIVE
    stylesheet, so saving an inactive stylesheet never changes the rules in use.
    Both carry ``format`` and ``content_hash`` so a hand edit can be told apart from
    a file this service wrote.
    """
    try:
        from app import models
        from app.domains.projects.models import Project
        project = db.query(Project).filter(Project.id == ss.project_id).first()
        if not project or not project.project_code:
            return None

        ce_template_dir = _template_dir(project)
        os.makedirs(ce_template_dir, exist_ok=True)

        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', ss.name).strip('_') or f"stylesheet_{ss.id}"
        filename = f"{safe_name}_stylesheet.json"
        file_path = os.path.join(ce_template_dir, filename)

        data = stylesheet_json_payload(db, ss)

        # The S4C Editorial Style Sheet (.docx) is built from the same JSON payload, so the
        # Word file always matches stylesheet.json. A failure here never blocks the save.
        docx_content: bytes | None = None
        docx_name = docx_path = None
        try:
            from app.services.stylesheet_docx_export import build_style_sheet_docx, style_sheet_filename
            docx_name = style_sheet_filename(ss.name)
            docx_path = os.path.join(ce_template_dir, docx_name)
            docx_content = build_style_sheet_docx(data, project)  # build first: never leave a half-written file
        except Exception as exc:
            logger.warning("Could not build Editorial Style Sheet (.docx) for stylesheet %s: %s", ss.id, exc)

        # The .docx hash lets an edited copy in CE support be detected (docx_pending_changes).
        # Hashes of edited copies already applied or dismissed are kept across saves.
        file_data = dict(data)
        handled = _read_json(file_path).get(DOCX_HANDLED_KEY) or []
        if docx_content is not None:
            file_data["docx_file"] = docx_name
            file_data["docx_sha256"] = _sha256(docx_content)
        if handled:
            file_data[DOCX_HANDLED_KEY] = handled[-50:]
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(file_data, f, indent=2, ensure_ascii=False)

        canonical_path = os.path.join(ce_template_dir, CANONICAL_STYLESHEET_JSON)
        if ss.is_active:
            with open(canonical_path, "w", encoding="utf-8") as f:
                json.dump(file_data, f, indent=2, ensure_ascii=False)
            logger.info("Synced active stylesheet %s to disk at %s and %s", ss.id, file_path, canonical_path)
        else:
            logger.info("Synced stylesheet %s to disk at %s (inactive: %s untouched)", ss.id, file_path,
                        CANONICAL_STYLESHEET_JSON)

        written: list[tuple[str, str, str]] = [(filename, file_path, ".json")]
        if docx_content is not None:
            try:
                with open(docx_path, "wb") as f:
                    f.write(docx_content)
                written.append((docx_name, docx_path, ".docx"))
                logger.info("Wrote Editorial Style Sheet for stylesheet %s at %s", ss.id, docx_path)
            except Exception as exc:
                logger.warning("Could not write Editorial Style Sheet (.docx) for stylesheet %s: %s", ss.id, exc)

        # Also register in models.File so they appear in Chapter File Manager under 'Style sheet template'
        ce_chapter = (
            db.query(models.ChapterInfo)
            .filter(
                models.ChapterInfo.project == project.project_code,
                models.ChapterInfo.chapters.ilike("ce support"),
            )
            .first()
        )
        if ce_chapter:
            for reg_name, reg_path, reg_type in written:
                db_file = (
                    db.query(models.File)
                    .filter(
                        models.File.project_id == project.id,
                        models.File.chapter_id == ce_chapter.id,
                        models.File.filename == reg_name,
                    )
                    .first()
                )
                if not db_file:
                    db_file = models.File(
                        filename=reg_name,
                        file_type=reg_type,
                        path=reg_path,
                        project_id=project.id,
                        chapter_id=ce_chapter.id,
                        category="Style sheet template",
                        is_original=True,
                        uploaded_by_id=ss.created_by_id,
                    )
                    db.add(db_file)
                    db.commit()
                    logger.info("Registered stylesheet file %s in files DB table with ID %s", reg_name, db_file.id)
                else:
                    db_file.path = reg_path
                    db_file.category = "Style sheet template"
                    db.commit()

        return file_path
    except Exception as exc:
        logger.warning("Failed to auto-save stylesheet %s to disk: %s", getattr(ss, "id", None), exc)
        return None


def _delete_stylesheet_from_disk(db: Session, ss: ProjectStylesheet) -> None:
    """Remove stylesheet JSON file from disk and files table when deleted."""
    try:
        from app import models
        from app.domains.projects.models import Project
        project = db.query(Project).filter(Project.id == ss.project_id).first()
        if not project or not project.project_code:
            return

        client_folder = project.client_name or "unknown"
        ce_template_dir = os.path.join(
            str(UPLOADS_DIR),
            client_folder,
            project.project_code,
            "CE support",
            "Style sheet template",
        )
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', ss.name).strip('_') or f"stylesheet_{ss.id}"
        filename = f"{safe_name}_stylesheet.json"
        file_path = os.path.join(ce_template_dir, filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info("Removed deleted stylesheet JSON from disk: %s", file_path)
        # The canonical stylesheet.json belongs to this stylesheet: remove it so the next
        # Technical Review does not re-create the deleted stylesheet from the file.
        canonical_path = os.path.join(ce_template_dir, CANONICAL_STYLESHEET_JSON)
        if os.path.exists(canonical_path):
            try:
                with open(canonical_path, "r", encoding="utf-8") as f:
                    canonical_id = (json.load(f) or {}).get("id")
            except Exception:
                canonical_id = None
            if canonical_id == ss.id:
                os.remove(canonical_path)
                logger.info("Removed %s of deleted stylesheet %s", canonical_path, ss.id)

        # The Editorial Style Sheet (.docx) generated for this stylesheet
        from app.services.stylesheet_docx_export import style_sheet_filename
        docx_name = style_sheet_filename(ss.name)
        docx_path = os.path.join(ce_template_dir, docx_name)
        if os.path.exists(docx_path):
            os.remove(docx_path)
            logger.info("Removed Editorial Style Sheet of deleted stylesheet: %s", docx_path)

        for reg_name in (filename, docx_name):
            db_file = (
                db.query(models.File)
                .filter(
                    models.File.project_id == project.id,
                    models.File.filename == reg_name,
                    models.File.category == "Style sheet template",
                )
                .first()
            )
            if db_file:
                db.delete(db_file)
                db.commit()
    except Exception as exc:
        logger.warning("Failed to remove deleted stylesheet %s from disk: %s", getattr(ss, "id", None), exc)


def create_stylesheet(
    db: Session,
    *,
    project_id: int,
    name: str,
    description: str | None,
    selected_ia_rows: list[schemas_v2.IARow],
    created_by_id: int | None,
    analyzed_file_ids: list[int] | None = None,
    ce_rules: dict | None = None,
    style_profile: dict | None = None,
) -> ProjectStylesheet:
    # Single source in storage: migrate IA rows to CE rules, project IA rows for read-only use
    merged_ce_rules, _ = migrate_ia_rows_to_ce_rules(selected_ia_rows, ce_rules)
    clean_ce = _clean_ce_rules(merged_ce_rules)
    projected_rows = project_ia_rows(clean_ce)

    ss = ProjectStylesheet(
        project_id=project_id,
        name=name,
        description=description,
        selected_ia_rows=json.dumps(projected_rows),
        analyzed_file_ids=json.dumps(analyzed_file_ids or []),
        ce_rules=json.dumps(clean_ce),
        style_profile=json.dumps(style_profile or {}),
        is_active=False,
        created_at=datetime.now(timezone.utc),
        created_by_id=created_by_id,
    )
    db.add(ss)
    db.commit()
    db.refresh(ss)
    _save_stylesheet_to_disk(db, ss)
    return ss


def update_stylesheet(
    db: Session,
    *,
    stylesheet_id: int,
    project_id: int,
    name: str | None,
    description: str | None,
    selected_ia_rows: list[schemas_v2.IARow] | None,
    analyzed_file_ids: list[int] | None = None,
    ce_rules: dict | None = None,
    style_profile: dict | None = None,
) -> ProjectStylesheet | None:
    ss = (
        db.query(ProjectStylesheet)
        .filter(
            ProjectStylesheet.id == stylesheet_id,
            ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not ss:
        return None
    if name is not None:
        ss.name = name
    if description is not None:
        ss.description = description

    existing_ce = _deserialize_dict(ss.ce_rules)
    target_ce = ce_rules if ce_rules is not None else existing_ce
    if selected_ia_rows is not None and ce_rules is None:
        target_ce, _ = migrate_ia_rows_to_ce_rules(selected_ia_rows, target_ce)

    clean_ce = _clean_ce_rules(target_ce)
    ss.ce_rules = json.dumps(clean_ce)
    ss.selected_ia_rows = json.dumps(project_ia_rows(clean_ce))

    if analyzed_file_ids is not None:
        ss.analyzed_file_ids = json.dumps(analyzed_file_ids)
    if style_profile is not None:
        ss.style_profile = json.dumps(style_profile)
    db.commit()
    db.refresh(ss)
    _save_stylesheet_to_disk(db, ss)
    return ss


def delete_stylesheet(
    db: Session, *, stylesheet_id: int, project_id: int
) -> bool:
    ss = (
        db.query(ProjectStylesheet)
        .filter(
            ProjectStylesheet.id == stylesheet_id,
            ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not ss:
        return False
    _delete_stylesheet_from_disk(db, ss)
    db.delete(ss)
    db.commit()
    return True


def project_client_name(project) -> str:
    """Client name of a project: client_name, else the linked Client's company fields."""
    if project is None:
        return ""
    name = (getattr(project, "client_name", None) or "").strip()
    if name:
        return name
    client = getattr(project, "client", None)
    if client is not None:
        for attr in ("company", "name_company", "division"):
            val = (getattr(client, attr, None) or "").strip()
            if val:
                return val
    return ""


_PUBLISHER_PATTERNS = {
    "springer": re.compile(r"\b(?:springer|demos\s+medical)\b", re.IGNORECASE),
}


def resolve_publisher_key(project) -> str | None:
    """Publisher whose house-style preset applies to the project (whole-word match on the client)."""
    name = project_client_name(project)
    for key, pat in _PUBLISHER_PATTERNS.items():
        if pat.search(name):
            return key
    return None


def find_ce_support_stylesheet_file(db: Session, *, project_id: int) -> tuple[str, dict] | None:
    """Find a stylesheet.json (or *_stylesheet.json / .docx) on disk in the project's 'CE support' folder.

    Searches:
      1. <UPLOADS_DIR>/<client>/<project_code>/CE support/Style sheet template/
      2. <UPLOADS_DIR>/<client>/<project_code>/CE support/
      3. files table registered under chapter 'CE support'
    """
    try:
        from app import models
        from app.domains.projects.models import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.project_code:
            return None

        client_folder = project.client_name or "unknown"
        search_dirs = [
            os.path.join(str(UPLOADS_DIR), client_folder, project.project_code, "CE support", "Style sheet template"),
            os.path.join(str(UPLOADS_DIR), client_folder, project.project_code, "CE support"),
            os.path.join(str(UPLOADS_DIR), "unknown", project.project_code, "CE support", "Style sheet template"),
            os.path.join(str(UPLOADS_DIR), "unknown", project.project_code, "CE support"),
        ]

        candidate_paths: list[str] = []
        for sdir in search_dirs:
            if not os.path.isdir(sdir):
                continue
            # Priority 1: canonical "stylesheet.json"
            exact = os.path.join(sdir, "stylesheet.json")
            if os.path.isfile(exact):
                candidate_paths.append(exact)
            # Priority 2: other JSON files (*_stylesheet.json or *.json)
            for fname in sorted(os.listdir(sdir)):
                if fname.lower().startswith("stylesheet.orphan-"):
                    continue  # set aside by sync: belongs to a deleted stylesheet
                if fname.lower().endswith(".json") and os.path.join(sdir, fname) not in candidate_paths:
                    candidate_paths.append(os.path.join(sdir, fname))

        # Also check files table in db under chapter "CE support"
        ce_chapter = (
            db.query(models.ChapterInfo)
            .filter(
                models.ChapterInfo.project == project.project_code,
                models.ChapterInfo.chapters.ilike("ce support"),
            )
            .first()
        )
        if ce_chapter:
            db_files = (
                db.query(models.File)
                .filter(
                    models.File.project_id == project.id,
                    models.File.chapter_id == ce_chapter.id,
                )
                .all()
            )
            for df in db_files:
                if df.path and os.path.isfile(df.path) and df.filename.lower().endswith(".json"):
                    if df.path not in candidate_paths:
                        candidate_paths.append(df.path)

        for path in candidate_paths:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and any(k in data for k in ("ce_rules", "selected_ia_rows", "style_profile", "name")):
                    return path, data
            except Exception as e:
                logger.debug("Could not parse JSON stylesheet at %s: %s", path, e)

        # Fallback: check if a .docx stylesheet exists in CE support and auto-parse it
        for sdir in search_dirs:
            if not os.path.isdir(sdir):
                continue
            for fname in sorted(os.listdir(sdir)):
                if fname.lower().endswith(".docx") and not fname.startswith("~$"):
                    docx_path = os.path.join(sdir, fname)
                    try:
                        from app.processing.manuscript_core.parsers.docx_stylesheet_parser import DocxStylesheetParser
                        parsed = DocxStylesheetParser().parse(docx_path)
                        if parsed and parsed.get("matched_ce_rules"):
                            data = {
                                "format": STYLESHEET_JSON_FORMAT,
                                "name": parsed.get("suggested_name") or os.path.splitext(fname)[0],
                                "description": parsed.get("suggested_description")
                                or f"Auto-parsed from CE support DOCX: {fname}",
                                "ce_rules": {
                                    k: {"enabled": v.get("enabled", True), "option": v.get("option", 1),
                                        "severity": v.get("severity")}
                                    for k, v in parsed["matched_ce_rules"].items()
                                },
                                "selected_ia_rows": [
                                    {"element": r["element"], "subtype": r.get("subtype") or "General",
                                     "pattern": r["pattern"]}
                                    for r in parsed.get("matched_ia_rows") or []
                                ],
                                "style_profile": parsed.get("style_profile") or {},
                            }
                            # No "id": it is imported as a new stylesheet when the project has none active.
                            target_json = os.path.join(sdir, CANONICAL_STYLESHEET_JSON)
                            with open(target_json, "w", encoding="utf-8") as f:
                                json.dump(data, f, indent=2, ensure_ascii=False)
                            return target_json, data
                    except Exception as e:
                        logger.debug("Could not parse DOCX stylesheet at %s: %s", docx_path, e)

        return None
    except Exception as exc:
        logger.warning("Error searching for CE support stylesheet: %s", exc)
        return None


def stylesheet_source(db: Session, ss: ProjectStylesheet | None) -> str | None:
    """"stylesheet.json" when the canonical CE support file holds this stylesheet, else "database"."""
    if ss is None:
        return None
    try:
        from app.domains.projects.models import Project
        project = db.query(Project).filter(Project.id == ss.project_id).first()
        if project and project.project_code:
            path = os.path.join(_template_dir(project), CANONICAL_STYLESHEET_JSON)
            if os.path.isfile(path):
                with open(path, "r", encoding="utf-8") as f:
                    if (json.load(f) or {}).get("id") == ss.id:
                        return CANONICAL_STYLESHEET_JSON
    except Exception:
        pass
    return "database"


def _validated_disk_data(data: dict, path: str) -> dict | None:
    """Validate a stylesheet JSON from disk; None (and a warning) when it is not usable."""
    try:
        req = schemas_v2.StylesheetCreateRequest(
            name=(data.get("name") or "CE Support Stylesheet"),
            description=data.get("description"),
            selected_ia_rows=[r for r in (data.get("selected_ia_rows") or []) if isinstance(r, dict)],
            ce_rules=data.get("ce_rules") or {},
            style_profile=data.get("style_profile") or {},
        )
    except Exception as exc:
        logger.warning("Ignoring invalid stylesheet JSON %s: %s", path, exc)
        return None
    return {
        "name": req.name,
        "description": req.description,
        "selected_ia_rows": req.selected_ia_rows,
        "ce_rules": {k: v.model_dump(exclude_none=True) for k, v in req.ce_rules.items()},
        "style_profile": req.style_profile,
    }


def _set_orphan(path: str, file_id) -> None:
    """Rename a canonical stylesheet.json whose stylesheet no longer exists, so it is never re-imported."""
    if os.path.basename(path) != CANONICAL_STYLESHEET_JSON:
        return
    target = os.path.join(os.path.dirname(path), f"stylesheet.orphan-{file_id}.json")
    try:
        os.replace(path, target)
        logger.warning("Stylesheet %s no longer exists: moved %s to %s", file_id, path, target)
    except Exception as exc:
        logger.warning("Could not move orphan stylesheet JSON %s: %s", path, exc)


def sync_stylesheet_from_ce_support(db: Session, *, project_id: int) -> ProjectStylesheet | None:
    """Keep the active stylesheet and 'CE support/Style sheet template/stylesheet.json' in step.

    Decided by content, not by timestamps (the DB and the file clock differ):
      * The file belongs to the active stylesheet (same ``id``) and was edited by hand
        (its content no longer matches the ``content_hash`` this service wrote) ->
        the active stylesheet is updated from the file, then the file is re-written.
      * The file belongs to another or a deleted stylesheet -> it is ignored, so a
        deleted stylesheet is never re-created and an inactive one never overwrites
        the active one. A canonical file of a deleted stylesheet is set aside as
        ``stylesheet.orphan-<id>.json``.
      * The file has no ``id`` (placed by hand or parsed from a CE support .docx) and
        the project has no active stylesheet -> it is imported and activated.
      * No file, but an active stylesheet -> the file is written.
    Returns the active ProjectStylesheet.
    """
    found = find_ce_support_stylesheet_file(db, project_id=project_id)
    active = get_active_stylesheet_for_project(db, project_id=project_id)

    if not found:
        if active:
            _save_stylesheet_to_disk(db, active)
        return active

    file_path, data = found
    file_id = data.get("id")

    if file_id is not None:
        if active is not None and file_id == active.id:
            stored_hash = data.get("content_hash")
            file_hash = content_hash(data.get("name"), data.get("ce_rules"), style_profile=data.get("style_profile"))
            legacy_hash = legacy_content_hash(data.get("name"), data.get("ce_rules"), data.get("selected_ia_rows"), data.get("style_profile"))
            hand_edited = bool(stored_hash) and (stored_hash != file_hash and stored_hash != legacy_hash)
            if hand_edited and file_hash != _stylesheet_hash(active):
                clean = _validated_disk_data(data, file_path)
                if clean is not None:
                    logger.info("Updating active stylesheet %s from hand-edited %s", active.id, file_path)
                    merged_ce, _ = migrate_ia_rows_to_ce_rules(clean["selected_ia_rows"], clean["ce_rules"])
                    clean_ce = _clean_ce_rules(merged_ce)
                    active.ce_rules = json.dumps(clean_ce)
                    active.selected_ia_rows = json.dumps(project_ia_rows(clean_ce))
                    active.style_profile = json.dumps(clean["style_profile"])
                    if clean["name"]:
                        active.name = clean["name"]
                    db.commit()
                    db.refresh(active)
                    _save_stylesheet_to_disk(db, active)
            elif not stored_hash or os.path.basename(file_path) != CANONICAL_STYLESHEET_JSON or stored_hash == legacy_hash:
                _save_stylesheet_to_disk(db, active)  # rewrite with new format
            return active

        exists = db.query(ProjectStylesheet).filter(
            ProjectStylesheet.id == file_id, ProjectStylesheet.project_id == project_id).first()
        if exists is None:
            _set_orphan(file_path, file_id)
        if active is not None:
            _save_stylesheet_to_disk(db, active)  # canonical file now matches the active stylesheet
        return active

    # A file without an id: placed by hand or parsed from a CE support .docx
    if active is not None:
        logger.info("Ignoring %s (no stylesheet id) because project %s already has active stylesheet %s",
                    file_path, project_id, active.id)
        return active
    clean = _validated_disk_data(data, file_path)
    if clean is None:
        return None
    logger.info("Creating active ProjectStylesheet from CE support file %s", file_path)
    new_ss = create_stylesheet(
        db,
        project_id=project_id,
        name=clean["name"],
        description=clean["description"] or f"Loaded from CE support {os.path.basename(file_path)}",
        selected_ia_rows=clean["selected_ia_rows"],
        created_by_id=None,
        ce_rules=clean["ce_rules"],
        style_profile=clean["style_profile"],
    )
    activate_stylesheet(db, stylesheet_id=new_ss.id, project_id=project_id)
    db.refresh(new_ss)
    return new_ss


def ensure_publisher_stylesheet(db: Session, *, project_id: int) -> ProjectStylesheet | None:
    """Return the active stylesheet; for a publisher with a preset and none active, create and activate it."""
    # 1. First check if a stylesheet exists in CE support or active in DB
    active = sync_stylesheet_from_ce_support(db, project_id=project_id)
    if active:
        return active
    from app.domains.projects.models import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if resolve_publisher_key(project) != "springer":
        return None
    from app.processing.manuscript_core.rules.presets.springer import get_springer_preset
    preset = get_springer_preset()
    existing = (
        db.query(ProjectStylesheet)
        .filter(ProjectStylesheet.project_id == project_id, ProjectStylesheet.name == preset["name"])
        .first()
    )
    if existing is None:
        existing = create_stylesheet(
            db,
            project_id=project_id,
            name=preset["name"],
            description=preset["description"] + " (auto-activated for the Springer client)",
            selected_ia_rows=[schemas_v2.IARow(element=r["element"], subtype=r["subtype"], pattern=r["pattern"])
                              for r in preset["selected_ia_rows"]],
            created_by_id=None,
            ce_rules=preset["ce_rules"],
            style_profile=preset["style_profile"],
        )
    activate_stylesheet(db, stylesheet_id=existing.id, project_id=project_id)
    db.refresh(existing)
    logger.info("Auto-activated Springer house-style stylesheet %s for project %s", existing.id, project_id)
    return existing


def stylesheet_settings(ss: ProjectStylesheet | None) -> tuple[list[dict], dict, dict]:
    """(selected IA rows, ce_rules, style_profile) of a stylesheet."""
    if ss is None:
        return [], {}, {}
    try:
        rows = json.loads(ss.selected_ia_rows or "[]")
    except Exception:
        rows = []
    return rows, stylesheet_ce_rules(ss), _deserialize_dict(getattr(ss, "style_profile", None))


def apply_stylesheet_to_findings(
    findings: list[dict],
    ss: ProjectStylesheet | None,
    *,
    rule_id_to_ia: dict | None = None,
    file_path: str | None = None,
) -> list[dict]:
    """Decide every finding with the stylesheet: selected option = house style, other forms = errors.

    Adds the stylesheet's list-driven findings (publisher word list, organisation
    names, registered terms) for ``file_path`` and returns the resulting list.
    """
    from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet
    from app.processing.manuscript_core.rules.profile_rules import apply_style_profile

    rows, ce_rules, profile = stylesheet_settings(ss)
    if profile:
        findings = apply_style_profile(findings, profile, file_path=file_path)
    annotate_with_stylesheet(findings, rows, rule_id_to_ia, ce_rules=ce_rules)
    return findings


def activate_stylesheet(
    db: Session, *, stylesheet_id: int, project_id: int
) -> dict | None:
    """Set one stylesheet as active, deactivating all others for the project."""
    target = (
        db.query(ProjectStylesheet)
        .filter(
            ProjectStylesheet.id == stylesheet_id,
            ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not target:
        return None

    # Deactivate all others
    others = (
        db.query(ProjectStylesheet)
        .filter(
            ProjectStylesheet.project_id == project_id,
            ProjectStylesheet.id != stylesheet_id,
            ProjectStylesheet.is_active.is_(True),
        )
        .all()
    )
    deactivated_ids = [s.id for s in others]
    for s in others:
        s.is_active = False

    target.is_active = True
    db.commit()
    _save_stylesheet_to_disk(db, target)
    return {"activated_id": stylesheet_id, "deactivated_ids": deactivated_ids}


# --------------------------------------------------------------------------- import edits from the .docx
# An editor may edit the S4C Editorial Style Sheet (.docx) in Word. The edits are read back
# (stylesheet_docx_import), reviewed in Editorial Standards and applied only when accepted.
DOCX_UPLOAD_TTL_SECONDS = 3600
_PENDING_CACHE: dict[tuple[str, str, str], dict] = {}


def _docx_upload_dir() -> str:
    import tempfile
    path = os.path.join(tempfile.gettempdir(), "cms_style_sheet_imports")
    os.makedirs(path, exist_ok=True)
    return path


def store_docx_upload(content: bytes) -> str:
    """Keep an uploaded .docx between preview and apply; returns its token."""
    import time
    import uuid
    folder = _docx_upload_dir()
    now = time.time()
    for name in os.listdir(folder):  # drop expired uploads
        p = os.path.join(folder, name)
        try:
            if now - os.path.getmtime(p) > DOCX_UPLOAD_TTL_SECONDS:
                os.remove(p)
        except OSError:
            pass
    token = uuid.uuid4().hex
    with open(os.path.join(folder, f"{token}.docx"), "wb") as f:
        f.write(content)
    return token


def load_docx_upload(token: str) -> bytes | None:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        return None
    path = os.path.join(_docx_upload_dir(), f"{token}.docx")
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def ce_support_docx_path(db: Session, *, project_id: int, filename: str) -> str | None:
    """Path of a .docx in the project's 'CE support/Style sheet template' folder (name only, no paths)."""
    from app.domains.projects.models import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code or not filename:
        return None
    name = os.path.basename(filename)
    if name != filename or not name.lower().endswith(".docx"):
        return None
    path = os.path.join(_template_dir(project), name)
    return path if os.path.isfile(path) else None


def preview_docx_import(db: Session, ss: ProjectStylesheet, content: bytes) -> dict:
    from app.services.stylesheet_docx_import import preview_docx_changes
    return preview_docx_changes(content, stylesheet_json_payload(db, ss))


def mark_docx_handled(db: Session, ss: ProjectStylesheet, sha: str) -> None:
    """Remember an edited .docx as applied or dismissed, so it is no longer reported as pending."""
    from app.domains.projects.models import Project
    project = db.query(Project).filter(Project.id == ss.project_id).first()
    if not project or not project.project_code:
        return
    path = os.path.join(_template_dir(project), _stylesheet_json_filename(ss))
    data = _read_json(path)
    if not data:
        return
    handled = [h for h in data.get(DOCX_HANDLED_KEY) or [] if h != sha] + [sha]
    data[DOCX_HANDLED_KEY] = handled[-50:]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def apply_docx_import(
    db: Session,
    ss: ProjectStylesheet,
    content: bytes,
    *,
    accepted: list[str],
    resolutions: dict | None = None,
    source: str = "upload",
    user_label: str = "",
) -> tuple[ProjectStylesheet, list[dict]]:
    """Re-read the .docx (the client's diff is not trusted) and apply the accepted changes."""
    from app.services.stylesheet_docx_import import apply_docx_changes, preview_docx_changes

    current = stylesheet_json_payload(db, ss)
    preview = preview_docx_changes(content, current)
    ce_rules, profile, applied = apply_docx_changes(current, preview["changes"], accepted, resolutions)
    if applied:
        ss = update_stylesheet(db, stylesheet_id=ss.id, project_id=ss.project_id, name=None, description=None,
                               selected_ia_rows=None, ce_rules=ce_rules, style_profile=profile) or ss
    logger.info("Stylesheet %s: applied %d change(s) from the Editorial Style Sheet .docx (%s)%s: %s",
                ss.id, len(applied), source, f" by {user_label}" if user_label else "",
                ", ".join(c["id"] for c in applied))
    if source == "ce_support":
        mark_docx_handled(db, ss, _sha256(content))
    return ss, applied


def docx_pending_changes(db: Session, *, project_id: int) -> list[dict]:
    """Edited Editorial Style Sheets (.docx) in CE support whose changes have not been reviewed.

    A .docx counts as edited when its hash is neither the one this service wrote nor one
    already applied or dismissed. Nothing is applied here.
    """
    from app.domains.projects.models import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        return []
    folder = _template_dir(project)
    if not os.path.isdir(folder):
        return []

    known: set[str] = set()
    for name in os.listdir(folder):
        if name.lower().endswith(".json"):
            data = _read_json(os.path.join(folder, name))
            if data.get("docx_sha256"):
                known.add(data["docx_sha256"])
            known.update(data.get(DOCX_HANDLED_KEY) or [])

    stylesheets = {s.id: s for s in db.query(ProjectStylesheet).filter(ProjectStylesheet.project_id == project_id).all()}
    out: list[dict] = []
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(".docx") or name.startswith("~$"):
            continue
        path = os.path.join(folder, name)
        try:
            with open(path, "rb") as f:
                content = f.read()
            sha = _sha256(content)
            if sha in known:
                continue
            import docx as _docx
            import io as _io
            from app.services.stylesheet_docx_export import IDENTIFIER_PREFIX
            ident = _docx.Document(_io.BytesIO(content)).core_properties.identifier or ""
            if not ident.startswith(IDENTIFIER_PREFIX):
                continue  # not an S4C style sheet (customer files are imported by upload)
            ss = stylesheets.get(int(ident[len(IDENTIFIER_PREFIX):]))
            if ss is None:
                continue
            cache_key = (path, sha, _stylesheet_hash(ss))
            if cache_key not in _PENDING_CACHE:
                _PENDING_CACHE[cache_key] = preview_docx_import(db, ss, content)
            preview = _PENDING_CACHE[cache_key]
            if not preview["changes"]:
                continue
            out.append({
                "stylesheet_id": ss.id,
                "stylesheet_name": ss.name,
                "filename": name,
                "modified": datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).isoformat(),
                "change_count": len(preview["changes"]),
                "sha256": sha,
            })
        except Exception as exc:
            logger.debug("Could not check %s for style sheet edits: %s", path, exc)
    return out
