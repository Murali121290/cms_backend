"""
Term List service — import, update, assign, and read per-project term lists.

Excel import handles the per-file quirks surfaced during the survey:
  - Ascend ATI: stray F398 cell, 243 trailing blank rows, empty extra sheets
  - APA: sheet name 'Sheet1' instead of 'Terms', empty mid-list rows
  - HSP: 2 empty extra sheets ('Sheet2', 'Sheet3')
  - BEP: 14 trailing blank rows + stray double-quote entry
  - LWW / HK: true duplicates — dropped by UNIQUE constraint, warning returned

All files are single-column lists. Rows are stored verbatim; adjacency +
prefix heuristic groups variant rows into concept groups.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional
from sqlalchemy.orm import Session

from app.core.paths import UPLOADS_DIR

logger = logging.getLogger(__name__)

TERM_LISTS_ROOT = os.path.join(str(UPLOADS_DIR), "term_lists")


# ─── Parsing ──────────────────────────────────────────────────────────────────

_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _normalise_cell(value: Any) -> str:
    """Collapse whitespace + strip. Return '' for blank / non-string."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    s = _WS_RE.sub(" ", value).strip()
    return s


def _group_key(term: str, length: int = 4) -> str:
    """Prefix fingerprint for the adjacency+prefix grouping heuristic.
    Lowercase, strip non-alphanumeric, take first N chars.
    """
    if not term:
        return ""
    norm = _NON_ALNUM_RE.sub("", term.lower())
    return norm[:length]


def parse_term_list_xlsx(path: str) -> dict[str, Any]:
    """Parse an Excel file into a flat list of term dicts.

    Returns ``{"terms": [{term, is_italic, is_bold, group_id, order_in_group}, ...],
              "sheets_scanned": [name,...], "warnings": [...]}``

    Group IDs are assigned by adjacency + 4-char prefix match: a run of rows
    whose group_key equals the previous row's group_key gets the same group_id.
    """
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=False)
    warnings: list[str] = []
    terms: list[dict[str, Any]] = []
    sheets_scanned: list[str] = []
    seen_norms: set[str] = set()

    # Target sheet: prefer 'Terms' (8 of 9 files); fall back to 'Sheet1' (APA);
    # otherwise take the first non-empty sheet.
    target_sheet = None
    if "Terms" in wb.sheetnames:
        target_sheet = wb["Terms"]
    elif "Sheet1" in wb.sheetnames:
        target_sheet = wb["Sheet1"]
    else:
        for s in wb.sheetnames:
            if any(c.value for row in wb[s].iter_rows(min_row=1, max_row=10) for c in row):
                target_sheet = wb[s]
                break
    if target_sheet is None:
        return {"terms": [], "sheets_scanned": wb.sheetnames, "warnings": ["No non-empty sheet found."]}

    sheets_scanned.append(target_sheet.title)
    other_sheets = [s for s in wb.sheetnames if s != target_sheet.title]
    if other_sheets:
        # Note empty extras but don't fail the import.
        for s in other_sheets:
            sheet = wb[s]
            has_data = any(c.value for row in sheet.iter_rows(min_row=1, max_row=5) for c in row)
            if has_data:
                warnings.append(f"Sheet '{s}' has data but was ignored (only '{target_sheet.title}' is imported).")

    group_id = 0
    prev_key: Optional[str] = None
    order_in_group = 0
    row_idx = 0

    for row in target_sheet.iter_rows(min_row=1, values_only=False):
        row_idx += 1
        # Only column A is used across all 9 files; log stray cells elsewhere.
        a_cell = row[0] if row else None
        value = _normalise_cell(a_cell.value) if a_cell is not None else ""
        if not value:
            continue
        if len(value) > 500:
            warnings.append(f"Row {row_idx}: term exceeds 500 chars, truncated.")
            value = value[:500]

        # Warn on stray cells in columns beyond A (observed: Ascend F398).
        for c in row[1:]:
            if c is not None and _normalise_cell(c.value):
                warnings.append(f"Row {row_idx}: stray value in column {c.column_letter}, ignored.")
                break

        norm = value.lower()
        if norm in seen_norms:
            warnings.append(f"Row {row_idx}: duplicate '{value}' skipped.")
            continue
        seen_norms.add(norm)

        is_italic = bool(getattr(a_cell.font, "italic", False)) if a_cell is not None else False
        is_bold = bool(getattr(a_cell.font, "bold", False)) if a_cell is not None else False

        key = _group_key(value)
        if key and key == prev_key:
            order_in_group += 1
        else:
            group_id += 1
            order_in_group = 0
            prev_key = key

        terms.append({
            "term": value,
            "term_norm": norm,
            "is_italic": is_italic,
            "is_bold": is_bold,
            "group_id": group_id,
            "order_in_group": order_in_group,
        })

    return {"terms": terms, "sheets_scanned": sheets_scanned, "warnings": warnings}


# ─── Persistence ──────────────────────────────────────────────────────────────

def _store_source_file(src_path: str, term_list_id: int) -> str:
    """Copy the uploaded Excel to data/uploads/term_lists/{id}_{basename}."""
    os.makedirs(TERM_LISTS_ROOT, exist_ok=True)
    stem = os.path.basename(src_path).replace(" ", "_")
    dest = os.path.join(TERM_LISTS_ROOT, f"{term_list_id}_{stem}")
    try:
        with open(src_path, "rb") as rf, open(dest, "wb") as wf:
            wf.write(rf.read())
    except Exception as exc:
        logger.warning("Could not persist term list source file: %s", exc)
    return dest


def import_terms_from_excel(
    db: Session,
    *,
    term_list_id: int,
    excel_path: str,
    original_filename: str,
    created_by_id: Optional[int] = None,
    replace: bool = False,
) -> dict[str, Any]:
    """Parse an Excel and persist rows into ``terms`` under ``term_list_id``.

    - ``replace=True`` deletes existing terms first; otherwise appends and
      the UNIQUE (term_list_id, term) index drops rows that collide.
    - Updates ``term_lists.source_file``, ``source_file_path``, ``term_count``,
      ``updated_at``.
    """
    from app.domains.term_lists.models import TermList, Term

    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise ValueError(f"Term list {term_list_id} not found.")

    parsed = parse_term_list_xlsx(excel_path)

    if replace:
        db.query(Term).filter(Term.term_list_id == term_list_id).delete()
        db.flush()

    # Persist source file next to runtime data.
    stored_path = _store_source_file(excel_path, term_list_id)
    tl.source_file = original_filename
    tl.source_file_path = stored_path

    existing_terms = {
        t[0] for t in db.query(Term.term)
        .filter(Term.term_list_id == term_list_id).all()
    }
    inserted = 0
    skipped_dup = 0
    for entry in parsed["terms"]:
        if entry["term"] in existing_terms:
            skipped_dup += 1
            continue
        db.add(Term(
            term_list_id=term_list_id,
            term=entry["term"],
            term_norm=entry["term_norm"],
            group_id=entry["group_id"],
            order_in_group=entry["order_in_group"],
            is_italic=entry["is_italic"],
            is_bold=entry["is_bold"],
        ))
        existing_terms.add(entry["term"])
        inserted += 1

    db.flush()

    tl.term_count = db.query(Term).filter(Term.term_list_id == term_list_id).count()

    return {
        "term_list_id": term_list_id,
        "inserted": inserted,
        "skipped_duplicates_in_file": skipped_dup,
        "skipped_already_present": len(parsed["terms"]) - inserted - skipped_dup,
        "total_in_list": tl.term_count,
        "sheets_scanned": parsed["sheets_scanned"],
        "warnings": parsed["warnings"],
    }


# ─── Project assignment ───────────────────────────────────────────────────────

def assign_term_lists_to_project(
    db: Session, *, project_id: int, term_list_ids: list[int], assigned_by_id: Optional[int] = None,
) -> list[int]:
    """Replace the project's assigned lists with ``term_list_ids`` (set semantics).

    Side effects:
      1. Delete + re-insert rows in ``project_term_lists`` (source of truth for the engine).
      2. Write ``{project_code}_selected_terms.json`` into the project's existing
         CE Support → Style sheet template folder (next to the Rules JSON).
      3. Register / update that JSON in the ``files`` table so it shows up in
         the UI's file browser alongside the Rules JSON.
    """
    from app.domains.term_lists.models import ProjectTermList

    db.query(ProjectTermList).filter(ProjectTermList.project_id == project_id).delete()
    db.flush()

    added: list[int] = []
    for tl_id in term_list_ids:
        db.add(ProjectTermList(
            project_id=project_id,
            term_list_id=tl_id,
            assigned_by_id=assigned_by_id,
        ))
        added.append(tl_id)
    db.flush()

    # Mirror the selection to a per-project JSON file in CE Support (same
    # chapter + folder the Rules JSON uses). The JSON is a durable, browsable
    # snapshot — the engine still reads project_term_lists from the DB.
    _write_selected_terms_json(db, project_id=project_id, assigned_by_id=assigned_by_id)
    return added


def _write_selected_terms_json(
    db: Session, *, project_id: int, assigned_by_id: Optional[int] = None,
) -> dict[str, Any]:
    """Build the selected-terms JSON for the project, write to disk, register
    the file row under the project's CE Support chapter. Returns the dict that
    was written (also used by the view/download endpoints)."""
    import datetime
    from app import models
    from app.domains.projects.models import Project
    from app.domains.term_lists.models import ProjectTermList, TermList
    from app.services.language_rule_service import (
        get_project_language_rules_dir, _ensure_ce_support_chapter,
    )

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        logger.warning("Cannot write selected_terms.json: project %s missing project_code", project_id)
        return {}

    # Resolve the assigned lists with full metadata so the JSON is self-describing.
    rows = (
        db.query(TermList)
        .join(ProjectTermList, ProjectTermList.term_list_id == TermList.id)
        .filter(ProjectTermList.project_id == project_id, TermList.is_active == True)  # noqa: E712
        .order_by(TermList.scope, TermList.name)
        .all()
    )

    assigned_by_name = None
    if assigned_by_id is not None:
        from app.models import User
        u = db.query(User).filter(User.id == assigned_by_id).first()
        if u:
            assigned_by_name = u.username

    def _ser(tl: TermList) -> dict[str, Any]:
        return {
            "id": tl.id,
            "name": tl.name,
            "description": tl.description,
            "term_count": tl.term_count,
            "source_file": tl.source_file,
            "client_id": tl.client_id,
        }

    generic_lists = [_ser(tl) for tl in rows if tl.scope == "generic"]
    client_lists = [_ser(tl) for tl in rows if tl.scope == "client"]

    payload: dict[str, Any] = {
        "project_id": project.id,
        "project_code": project.project_code,
        "selected_at": datetime.datetime.utcnow().isoformat() + "Z",
        "selected_by_id": assigned_by_id,
        "selected_by": assigned_by_name,
        "total_lists": len(rows),
        "total_terms": sum(tl.term_count or 0 for tl in rows),
        "generic_lists": generic_lists,
        "client_lists": client_lists,
    }

    # Reuse the exact same folder the Rules JSON uses (CE Support → Style sheet template).
    ce_template_dir = get_project_language_rules_dir(project.project_code)
    filename = f"{project.project_code}_selected_terms.json"
    file_path = os.path.join(ce_template_dir, filename)

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    logger.info("Wrote selected terms JSON for project %s at %s",
                project.project_code, file_path)

    # Register under the same CE Support chapter as the Rules JSON.
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
    else:
        db_file.path = file_path
        db_file.category = "Style sheet template"

    return payload


def read_selected_terms_json(db: Session, *, project_id: int) -> dict[str, Any]:
    """Return the on-disk ``selected_terms.json`` for a project, or an empty
    skeleton if no selection has been saved yet. Used by the view/download
    endpoints so the user sees the same JSON the UI was built against."""
    from app.domains.projects.models import Project
    from app.services.language_rule_service import get_project_language_rules_dir

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or not project.project_code:
        return {"project_id": project_id, "generic_lists": [], "client_lists": [],
                "total_lists": 0, "total_terms": 0}

    ce_dir = get_project_language_rules_dir(project.project_code)
    path = os.path.join(ce_dir, f"{project.project_code}_selected_terms.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            logger.warning("Could not read %s: %s", path, exc)

    # No file yet — derive a fresh snapshot from the DB so the view isn't blank.
    return _derive_selected_terms_payload(db, project_id=project_id)


def _derive_selected_terms_payload(db: Session, *, project_id: int) -> dict[str, Any]:
    """Build the same payload shape as _write_selected_terms_json but purely from DB."""
    from app.domains.projects.models import Project
    from app.domains.term_lists.models import ProjectTermList, TermList

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return {"project_id": project_id, "total_lists": 0, "total_terms": 0,
                "generic_lists": [], "client_lists": []}
    rows = (
        db.query(TermList)
        .join(ProjectTermList, ProjectTermList.term_list_id == TermList.id)
        .filter(ProjectTermList.project_id == project_id, TermList.is_active == True)  # noqa: E712
        .order_by(TermList.scope, TermList.name)
        .all()
    )
    def _ser(tl):
        return {"id": tl.id, "name": tl.name, "description": tl.description,
                "term_count": tl.term_count, "source_file": tl.source_file,
                "client_id": tl.client_id}
    return {
        "project_id": project.id,
        "project_code": project.project_code,
        "selected_at": None,
        "selected_by": None,
        "total_lists": len(rows),
        "total_terms": sum(tl.term_count or 0 for tl in rows),
        "generic_lists": [_ser(tl) for tl in rows if tl.scope == "generic"],
        "client_lists": [_ser(tl) for tl in rows if tl.scope == "client"],
    }


def get_assigned_term_lists(db: Session, *, project_id: int) -> list["TermList"]:
    from app.domains.term_lists.models import TermList, ProjectTermList
    return (
        db.query(TermList)
        .join(ProjectTermList, ProjectTermList.term_list_id == TermList.id)
        .filter(ProjectTermList.project_id == project_id, TermList.is_active == True)  # noqa: E712
        .order_by(TermList.name)
        .all()
    )
