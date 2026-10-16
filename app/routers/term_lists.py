"""
API router for Term Lists — client-specific and generic word/phrase lists
highlighted during Language Editing.

Endpoints under /api/v2/:
  Library
    GET    /term-lists                                 — list all (filter: scope, client_id, search)
    POST   /term-lists                                 — create empty list
    GET    /term-lists/{id}                            — details
    PUT    /term-lists/{id}                            — update metadata
    DELETE /term-lists/{id}                            — soft-delete (is_active=False)
    POST   /term-lists/{id}/import                     — multipart Excel upload, parse & append
    GET    /term-lists/{id}/export.xlsx                — download as Excel
    GET    /term-lists/{id}/terms                      — paginated/search terms
    POST   /term-lists/{id}/terms                      — add single term
    PUT    /term-lists/{id}/terms/{term_id}            — edit term
    DELETE /term-lists/{id}/terms/{term_id}            — delete term

  Project assignment
    GET    /projects/{project_id}/term-lists           — assigned + available
    POST   /projects/{project_id}/term-lists           — replace assignment
    DELETE /projects/{project_id}/term-lists/{list_id} — unassign one
"""
import io
import logging
import os
import tempfile
from typing import Any, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.processing.service import check_permission
from app.domains.term_lists.models import TermList, Term, ProjectTermList
from app.models import User
from app.services.term_list_service import (
    assign_term_lists_to_project,
    get_assigned_term_lists,
    import_terms_from_excel,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v2", tags=["Term Lists"])

# Admin + Project Manager may create / import / edit lists; language roles read.
TERM_LIST_EDIT_ROLES = {"admin", "projectmanager", "project manager"}


def _require_language_user(user: Optional[User]) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    check_permission(user, "language", logger=logger)
    return user


def _require_term_list_editor(user: Optional[User]) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user_roles = {(r.name or "").strip().lower() for r in user.roles}
    if not (user_roles & TERM_LIST_EDIT_ROLES):
        raise HTTPException(
            status_code=403,
            detail=f"Only Admin or Project Manager can edit term lists. Your roles: {', '.join(sorted(user_roles)) or 'none'}",
        )
    return user


# ─── Pydantic DTOs ────────────────────────────────────────────────────────────

class TermListCreate(BaseModel):
    name: str
    description: Optional[str] = None
    scope: str = "client"      # 'client' | 'generic'
    client_id: Optional[int] = None


class TermListUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[str] = None
    client_id: Optional[int] = None
    is_active: Optional[bool] = None


class TermCreate(BaseModel):
    term: str
    is_italic: bool = False
    is_bold: bool = False
    notes: Optional[str] = None


class TermUpdate(BaseModel):
    term: Optional[str] = None
    is_italic: Optional[bool] = None
    is_bold: Optional[bool] = None
    notes: Optional[str] = None


class AssignTermListsRequest(BaseModel):
    term_list_ids: list[int]


# ─── Serializers ──────────────────────────────────────────────────────────────

def _ser_list(tl: TermList, *, assigned_project_ids: Optional[list[int]] = None) -> dict:
    out = {
        "id": tl.id,
        "name": tl.name,
        "description": tl.description,
        "scope": tl.scope,
        "client_id": tl.client_id,
        "source_file": tl.source_file,
        "term_count": tl.term_count,
        "is_active": tl.is_active,
        "created_at": tl.created_at.isoformat() if tl.created_at else None,
        "updated_at": tl.updated_at.isoformat() if tl.updated_at else None,
    }
    if assigned_project_ids is not None:
        out["assigned_project_ids"] = assigned_project_ids
    return out


def _ser_term(t: Term) -> dict:
    return {
        "id": t.id,
        "term": t.term,
        "group_id": t.group_id,
        "order_in_group": t.order_in_group,
        "is_italic": t.is_italic,
        "is_bold": t.is_bold,
        "notes": t.notes,
    }


# ─── Library endpoints ────────────────────────────────────────────────────────

@router.get("/term-lists")
def list_term_lists(
    scope: Optional[str] = None,
    client_id: Optional[int] = None,
    search: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_language_user(current_user)
    q = db.query(TermList)
    if not include_inactive:
        q = q.filter(TermList.is_active == True)  # noqa: E712
    if scope:
        q = q.filter(TermList.scope == scope)
    if client_id is not None:
        q = q.filter(TermList.client_id == client_id)
    if search:
        q = q.filter(TermList.name.ilike(f"%{search}%"))
    rows = q.order_by(TermList.name).all()
    return {"items": [_ser_list(tl) for tl in rows]}


@router.post("/term-lists")
def create_term_list(
    body: TermListCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    if body.scope not in ("client", "generic"):
        raise HTTPException(status_code=400, detail="scope must be 'client' or 'generic'.")
    if body.scope == "client" and body.client_id is None:
        raise HTTPException(status_code=400, detail="client_id required when scope='client'.")

    tl = TermList(
        name=body.name.strip(),
        description=body.description,
        scope=body.scope,
        client_id=body.client_id if body.scope == "client" else None,
        created_by_id=current_user.id,
    )
    db.add(tl)
    db.commit()
    db.refresh(tl)
    return _ser_list(tl)


@router.get("/term-lists/{term_list_id}")
def get_term_list(
    term_list_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_language_user(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")
    assigned = [p[0] for p in db.query(ProjectTermList.project_id)
                .filter(ProjectTermList.term_list_id == term_list_id).all()]
    return _ser_list(tl, assigned_project_ids=assigned)


@router.put("/term-lists/{term_list_id}")
def update_term_list(
    term_list_id: int,
    body: TermListUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(tl, f, v)
    db.commit()
    db.refresh(tl)
    return _ser_list(tl)


@router.delete("/term-lists/{term_list_id}")
def delete_term_list(
    term_list_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")
    tl.is_active = False
    db.commit()
    return {"ok": True, "id": term_list_id}


@router.post("/term-lists/{term_list_id}/import")
async def import_term_list_xlsx(
    term_list_id: int,
    file: UploadFile = File(...),
    replace: bool = Query(False, description="If true, delete existing terms before importing."),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Multipart upload of an Excel file; parses column A, appends unique terms."""
    _require_term_list_editor(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")

    original_filename = file.filename or "upload.xlsx"
    if not original_filename.lower().endswith(('.xlsx', '.xlsm')):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xlsm files are supported.")

    # Save upload to a temp path (openpyxl needs a file-like with seek).
    suffix = os.path.splitext(original_filename)[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = import_terms_from_excel(
            db,
            term_list_id=term_list_id,
            excel_path=tmp_path,
            original_filename=original_filename,
            created_by_id=current_user.id,
            replace=replace,
        )
        db.commit()
        return result
    except ValueError as err:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as exc:
        db.rollback()
        logger.error("Term list import failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@router.get("/term-lists/{term_list_id}/export.xlsx")
def export_term_list_xlsx(
    term_list_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Download the term list as an Excel file (single column, same shape as source)."""
    from openpyxl import Workbook
    from openpyxl.styles import Font

    _require_language_user(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")

    terms = (
        db.query(Term)
        .filter(Term.term_list_id == term_list_id)
        .order_by(Term.group_id.nullsfirst(), Term.order_in_group, Term.id)
        .all()
    )

    wb = Workbook()
    ws = wb.active
    ws.title = "Terms"
    for i, t in enumerate(terms, start=1):
        c = ws.cell(row=i, column=1, value=t.term)
        if t.is_italic or t.is_bold:
            c.font = Font(italic=t.is_italic, bold=t.is_bold)
    ws.column_dimensions["A"].width = 50

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    safe_name = tl.name.replace(" ", "_").replace("/", "_")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_terms.xlsx"'},
    )


# ─── Term endpoints ───────────────────────────────────────────────────────────

@router.get("/term-lists/{term_list_id}/terms")
def list_terms(
    term_list_id: int,
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_language_user(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")

    q = db.query(Term).filter(Term.term_list_id == term_list_id)
    if search:
        q = q.filter(Term.term_norm.ilike(f"%{search.lower()}%"))
    total = q.count()
    rows = (q.order_by(Term.group_id.nullsfirst(), Term.order_in_group, Term.id)
            .offset(offset).limit(limit).all())
    return {"total": total, "limit": limit, "offset": offset, "items": [_ser_term(t) for t in rows]}


@router.post("/term-lists/{term_list_id}/terms")
def add_term(
    term_list_id: int,
    body: TermCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if not tl:
        raise HTTPException(status_code=404, detail=f"Term list {term_list_id} not found.")
    text = body.term.strip()
    if not text:
        raise HTTPException(status_code=400, detail="term cannot be empty.")
    existing = (db.query(Term)
                .filter(Term.term_list_id == term_list_id, Term.term == text).first())
    if existing:
        raise HTTPException(status_code=409, detail=f"Term '{text}' already exists in this list.")
    t = Term(
        term_list_id=term_list_id,
        term=text,
        term_norm=text.lower(),
        is_italic=body.is_italic,
        is_bold=body.is_bold,
        notes=body.notes,
    )
    db.add(t)
    tl.term_count = (tl.term_count or 0) + 1
    db.commit()
    db.refresh(t)
    return _ser_term(t)


@router.put("/term-lists/{term_list_id}/terms/{term_id}")
def update_term(
    term_list_id: int,
    term_id: int,
    body: TermUpdate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    t = db.query(Term).filter(Term.id == term_id, Term.term_list_id == term_list_id).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"Term {term_id} not found in list {term_list_id}.")
    data = body.model_dump(exclude_unset=True)
    if "term" in data:
        text = data["term"].strip()
        if not text:
            raise HTTPException(status_code=400, detail="term cannot be empty.")
        t.term = text
        t.term_norm = text.lower()
    for f in ("is_italic", "is_bold", "notes"):
        if f in data:
            setattr(t, f, data[f])
    db.commit()
    db.refresh(t)
    return _ser_term(t)


@router.delete("/term-lists/{term_list_id}/terms/{term_id}")
def delete_term(
    term_list_id: int,
    term_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    t = db.query(Term).filter(Term.id == term_id, Term.term_list_id == term_list_id).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"Term {term_id} not found in list {term_list_id}.")
    db.delete(t)
    tl = db.query(TermList).filter(TermList.id == term_list_id).first()
    if tl:
        tl.term_count = max(0, (tl.term_count or 1) - 1)
    db.commit()
    return {"ok": True, "id": term_id}


# ─── Project assignment endpoints ─────────────────────────────────────────────

@router.get("/projects/{project_id}/term-lists")
def get_project_term_lists(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Return lists assigned to this project + lists available to assign
    (generic + client-matching). Used by the Project Term Lists page."""
    _require_language_user(current_user)
    from app.domains.projects.models import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")

    assigned = get_assigned_term_lists(db, project_id=project_id)
    assigned_ids = {tl.id for tl in assigned}

    # Available = generic + lists matching the project's client (from clients table).
    # Project→Client link: projects.client_id (if present).
    available_q = db.query(TermList).filter(TermList.is_active == True)  # noqa: E712
    project_client_id = getattr(project, "client_id", None)
    if project_client_id is not None:
        from sqlalchemy import or_
        available_q = available_q.filter(or_(
            TermList.scope == "generic",
            TermList.client_id == project_client_id,
        ))
    else:
        available_q = available_q.filter(TermList.scope == "generic")

    available = available_q.order_by(TermList.name).all()

    return {
        "project_id": project_id,
        "assigned": [_ser_list(tl) for tl in assigned],
        "available": [_ser_list(tl) for tl in available if tl.id not in assigned_ids],
    }


@router.post("/projects/{project_id}/term-lists")
def set_project_term_lists(
    project_id: int,
    body: AssignTermListsRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Replace the project's assigned term lists with the given set."""
    _require_term_list_editor(current_user)
    from app.domains.projects.models import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")

    # Validate the IDs exist and are assignable (generic or matching this client).
    requested = db.query(TermList).filter(TermList.id.in_(body.term_list_ids)).all()
    found_ids = {tl.id for tl in requested}
    missing = set(body.term_list_ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Term lists not found: {sorted(missing)}")

    assign_term_lists_to_project(
        db, project_id=project_id,
        term_list_ids=list(found_ids),
        assigned_by_id=current_user.id,
    )
    db.commit()
    return {"ok": True, "project_id": project_id, "assigned_term_list_ids": sorted(found_ids)}


@router.delete("/projects/{project_id}/term-lists/{term_list_id}")
def unassign_term_list(
    project_id: int,
    term_list_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    _require_term_list_editor(current_user)
    row = (db.query(ProjectTermList)
           .filter(ProjectTermList.project_id == project_id,
                   ProjectTermList.term_list_id == term_list_id)
           .first())
    if not row:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    db.delete(row)
    db.commit()
    # Keep selected_terms.json in sync.
    from app.services.term_list_service import _write_selected_terms_json
    _write_selected_terms_json(db, project_id=project_id, assigned_by_id=current_user.id)
    db.commit()
    return {"ok": True}


@router.get("/projects/{project_id}/term-lists/export.json")
def export_project_terms_json(
    project_id: int,
    download: bool = False,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Serialise the project's selected term lists to JSON.

    Inline for the View-JSON modal; ``?download=true`` for a browser download
    saved as ``{project_code}_selected_terms.json``.
    """
    import json as _json
    from fastapi.responses import Response
    from app.services.term_list_service import read_selected_terms_json

    _require_language_user(current_user)
    payload = read_selected_terms_json(db, project_id=project_id)
    code = payload.get("project_code") or f"project-{project_id}"
    body = _json.dumps(payload, indent=2, ensure_ascii=False)
    headers: dict = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{code}_selected_terms.json"'
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/projects/{project_id}/term-lists/export.xlsx")
def export_project_terms_xlsx(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_from_cookie),
):
    """Download the project's selected term lists as an Excel workbook.

    Layout:
      - Sheet 1: "Summary"  — one row per assigned list (scope, client, count)
      - Sheet 2+: one sheet per assigned list, named after the list (truncated
        to 31 chars per Excel's limit), containing its terms with the same
        single-column shape as the source files.
    """
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter

    _require_language_user(current_user)
    from app.services.term_list_service import read_selected_terms_json

    payload = read_selected_terms_json(db, project_id=project_id)
    code = payload.get("project_code") or f"project-{project_id}"

    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"

    # Header band
    brand = PatternFill("solid", fgColor="312E81")
    hdr_fill = PatternFill("solid", fgColor="EEF2FF")
    ws["A1"] = f"Selected Term Lists — {code}"
    ws["A1"].font = Font(size=16, bold=True, color="FFFFFF")
    ws["A1"].fill = brand
    ws.merge_cells("A1:E1")
    ws.row_dimensions[1].height = 32
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center", indent=1)

    ws.cell(row=2, column=1, value="Selected at").font = Font(bold=True, color="475569")
    ws.cell(row=2, column=2, value=payload.get("selected_at") or "")
    ws.cell(row=3, column=1, value="Selected by").font = Font(bold=True, color="475569")
    ws.cell(row=3, column=2, value=payload.get("selected_by") or "")
    ws.cell(row=4, column=1, value="Total lists").font = Font(bold=True, color="475569")
    ws.cell(row=4, column=2, value=payload.get("total_lists", 0))
    ws.cell(row=5, column=1, value="Total terms").font = Font(bold=True, color="475569")
    ws.cell(row=5, column=2, value=payload.get("total_terms", 0))

    # Summary table
    headers = ["Scope", "List name", "Client ID", "Term count", "Source file"]
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=7, column=col, value=h)
        c.font = Font(bold=True, color="312E81")
        c.fill = hdr_fill

    all_lists = [("generic", tl) for tl in payload.get("generic_lists", [])] + \
                [("client", tl) for tl in payload.get("client_lists", [])]

    for i, (scope, tl) in enumerate(all_lists, start=8):
        ws.cell(row=i, column=1, value=scope.title())
        ws.cell(row=i, column=2, value=tl.get("name"))
        ws.cell(row=i, column=3, value=tl.get("client_id") or "")
        ws.cell(row=i, column=4, value=tl.get("term_count") or 0)
        ws.cell(row=i, column=5, value=tl.get("source_file") or "")

    for col, w in enumerate([12, 42, 10, 12, 36], start=1):
        ws.column_dimensions[get_column_letter(col)].width = w

    # One sheet per list, with terms.
    for scope, tl in all_lists:
        rows = (db.query(Term)
                .filter(Term.term_list_id == tl["id"])
                .order_by(Term.group_id.nullsfirst(), Term.order_in_group, Term.id)
                .all())
        # Excel sheet name limit = 31 chars, no special chars
        safe = (tl.get("name") or f"list-{tl['id']}").replace("/", "-").replace("\\", "-")[:31]
        sheet = wb.create_sheet(title=safe)
        sheet.cell(row=1, column=1, value=tl.get("name")).font = Font(bold=True, size=12, color="312E81")
        sheet.cell(row=2, column=1, value=f"{len(rows)} terms · scope={scope}").font = Font(italic=True, color="64748B")
        for i, t in enumerate(rows, start=4):
            c = sheet.cell(row=i, column=1, value=t.term)
            if t.is_italic or t.is_bold:
                c.font = Font(italic=t.is_italic, bold=t.is_bold)
        sheet.column_dimensions["A"].width = 50

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{code}_selected_terms.xlsx"'},
    )
