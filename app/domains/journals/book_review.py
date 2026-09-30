"""Open a journal article in the book Structuring / Technical / Language review pages.

Those pages work on a row of the book `files` table. Each journal gets one hidden book
project (project_code JRNL-<journal code>, is_deleted=True so book lists skip it), and
each article gets a shadow File row whose path IS the article's working copy. Saves in
the book pages therefore patch the journal working copy directly; the book pages keep
their own Archive/ copies and FileVersion rows next to it.
"""
import os
from typing import Dict

from sqlalchemy.orm import Session

from app.domains.journals.models import Journal, JournalArticle


class NoWorkingCopy(Exception):
    pass


def journal_book_project(db: Session, journal: Journal):
    from app.domains.projects.models import Project

    code = f"JRNL-{journal.journal_code}"[:100]
    project = db.query(Project).filter(Project.project_code == code).first()
    if project is None:
        client = journal.client
        project = Project(
            project_code=code, project_title=f"[Journal] {journal.journal_title}"[:500],
            client_name=client.publisher_name if client else None, xml_standard="JATS",
            status="Journal", is_deleted=True,
        )
        db.add(project)
        db.flush()
    return project


def ensure_review_file(db: Session, article: JournalArticle) -> Dict[str, int]:
    """Create or refresh the article's shadow book file. Returns {file_id, project_id}."""
    from app import models

    path = article.edited_docx_path
    if not path or not os.path.exists(path):
        raise NoWorkingCopy("Run pre-editing first: the review pages open the article's working copy")
    path = os.path.abspath(path)
    project = journal_book_project(db, article.journal)
    row = db.get(models.File, article.review_file_id) if article.review_file_id else None
    if row is None:
        row = models.File(project_id=project.id, chapter_id=None, filename=os.path.basename(path), file_type="docx",
                          category="Manuscript", path=path, version=1, is_original=False)
        db.add(row)
        db.flush()
        article.review_file_id = row.id
    elif row.path != path:
        row.path, row.filename = path, os.path.basename(path)
    db.commit()
    return {"file_id": row.id, "project_id": project.id}


def working_copy_changed(article: JournalArticle) -> bool:
    """True when the working copy was saved after the latest XHTML (e.g. by a book review page)."""
    w, x = article.edited_docx_path, article.xhtml_path
    if not (w and x and os.path.exists(w) and os.path.exists(x)):
        return False
    return os.path.getmtime(w) > os.path.getmtime(x) + 1


# --- IA rules (book editorial stylesheet) for a journal -------------------------------------------
def ia_catalog():
    from app.data.ia_template_rows import IA_TEMPLATE_ROWS
    return [{"element": e, "subtype": s, "pattern": p, "example": ex} for e, s, p, ex in IA_TEMPLATE_ROWS]


def journal_ia_stylesheet(db: Session, journal: Journal):
    """The active editorial stylesheet of the journal's hidden book project (what the book Technical page reads)."""
    from app.domains.projects.models import ProjectStylesheet
    project = journal_book_project(db, journal)
    sheet = db.query(ProjectStylesheet).filter(ProjectStylesheet.project_id == project.id, ProjectStylesheet.is_active == True) \
        .order_by(ProjectStylesheet.id.desc()).first()  # noqa: E712
    return project, sheet


def selected_ia_rows(db: Session, journal: Journal):
    """The journal's selected IA rows, read-only (no hidden project is created). [] when none are selected."""
    import json
    from app.domains.projects.models import Project, ProjectStylesheet
    project = db.query(Project).filter(Project.project_code == f"JRNL-{journal.journal_code}"[:100]).first()
    if project is None:
        return []
    sheet = db.query(ProjectStylesheet).filter(ProjectStylesheet.project_id == project.id, ProjectStylesheet.is_active == True) \
        .order_by(ProjectStylesheet.id.desc()).first()  # noqa: E712
    try:
        return json.loads(sheet.selected_ia_rows or "[]") if sheet else []
    except (TypeError, ValueError):
        return []


def save_journal_ia_rules(db: Session, journal: Journal, rows, user_id=None, name=None):
    """Replace the selected IA rows and make that stylesheet the project's only active one."""
    import json
    from app.domains.projects.models import ProjectStylesheet

    known = {(r["element"], r["subtype"], r["pattern"]) for r in ia_catalog()}
    clean, seen = [], set()
    for r in rows:
        key = (r.get("element"), r.get("subtype"), r.get("pattern"))
        if key in known and key not in seen:
            seen.add(key)
            clean.append({"element": key[0], "subtype": key[1], "pattern": key[2]})
    project, sheet = journal_ia_stylesheet(db, journal)
    if sheet is None:
        sheet = ProjectStylesheet(project_id=project.id, name=name or f"{journal.journal_code} editorial stylesheet",
                                  description="Selected in Journal Settings → IA rules", created_by_id=user_id)
        db.add(sheet)
    elif name:
        sheet.name = name
    sheet.selected_ia_rows = json.dumps(clean)
    db.query(ProjectStylesheet).filter(ProjectStylesheet.project_id == project.id).update({ProjectStylesheet.is_active: False})
    sheet.is_active = True
    db.commit()
    db.refresh(sheet)
    return project, sheet, clean
