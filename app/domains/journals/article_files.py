"""The article file manager: files grouped into production folders, version history, restore,
zip downloads and the client delivery package.

Folders are a view over JournalFile.category; storage is unchanged (see files.py). Each
"family" is one document across its versions (per category, per figure for art, per base name
otherwise). A folder shows the latest version of each family; Backup holds every older
version and the working-copy snapshots.
"""
import io
import os
import re
import zipfile
from collections import defaultdict
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.domains.journals.models import JournalArticle, JournalFile, JournalIssue

FOLDERS = [
    {"key": "manuscript", "label": "Manuscript", "hint": "Original upload, working copy, XHTML and reference reports"},
    {"key": "art", "label": "Art", "hint": "Figures linked to Figure N in the text"},
    {"key": "xml", "label": "XML", "hint": "JATS 1.3 versions"},
    {"key": "indesign", "label": "InDesign", "hint": "INDD / IDML and preflight"},
    {"key": "proof", "label": "Proof", "hint": "Proof PDFs and author corrections"},
    {"key": "delivery", "label": "Final delivery", "hint": "Packages sent to the client"},
    {"key": "backup", "label": "Backup", "hint": "Every superseded version, kept for the archive"},
]
CATEGORY_FOLDER = {
    "Manuscript": "manuscript", "XHTML": "manuscript", "Reference_Report": "backup",
    "Art": "art", "JATS_XML": "xml", "XML": "xml",
    "INDD": "indesign", "IDML": "indesign", "Preflight": "indesign",
    "Proof_PDF": "proof", "Proof": "proof", "Delivery_ZIP": "delivery",
    "Working_Copy": "backup",
}


_VERSION_SUFFIX = re.compile(r"_v\d+(?=\.[^.]+$)|_v\d+$", re.IGNORECASE)
_STRUCTURED_SUFFIX = re.compile(r"_(structured|processed)(?=\.[^.]+$)", re.IGNORECASE)


def clean_display_name(filename: str) -> str:
    name = _VERSION_SUFFIX.sub("", filename)
    name = _STRUCTURED_SUFFIX.sub("", name)
    return name


def folder_of(category: str) -> str:
    return CATEGORY_FOLDER.get(category, "backup")




def family_key(f: JournalFile) -> Tuple[str, str]:
    if f.category == "Art" and f.figure_number is not None:
        return ("Art", f"fig{f.figure_number}")
    if f.category == "Working_Copy":
        return ("Working_Copy", "working")
    base = clean_display_name(f.filename)
    return (f.category, base)


def families(db: Session, article_id: int) -> Dict[Tuple[str, str], List[JournalFile]]:
    out: Dict[Tuple[str, str], List[JournalFile]] = defaultdict(list)
    for f in db.query(JournalFile).filter(JournalFile.article_id == article_id).all():
        out[family_key(f)].append(f)
    for rows in out.values():
        rows.sort(key=lambda r: (r.version, r.id))
    return out


def _size(path: str) -> Optional[int]:
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def _user_names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    from app.models import User
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.username for u in db.query(User).filter(User.id.in_(ids)).all()}


def current_paths(article: JournalArticle) -> set:
    return {p for p in (article.original_docx_path, article.xhtml_path, article.jats_xml_path, article.indesign_path,
                        article.proof_pdf_path, article.final_delivery_path) if p}


def _open_counts(db: Session, article_id: int, module: str) -> Dict[str, int]:
    out = {"error": 0, "warning": 0, "info": 0}
    for (sev,) in db.query(JournalIssue.severity).filter(JournalIssue.article_id == article_id, JournalIssue.module == module,
                                                         JournalIssue.status == "open").all():
        out[sev] += 1
    return out


def _status(db: Session, article: JournalArticle, f: JournalFile) -> Tuple[str, str]:
    if f.category == "Manuscript" and f.path == article.original_docx_path:
        return "ok", "Original"
    if f.category == "JATS_XML":
        if f.path != article.jats_xml_path:
            return "info", "Not current"
        errors = _open_counts(db, article.id, "xml")["error"]
        return ("err", f"{errors} DTD error{'s' if errors > 1 else ''}") if errors else ("ok", "Valid")
    if f.category == "Art":
        return ("ok", f"Figure {f.figure_number}") if f.figure_number is not None else ("warn", "Not linked")
    if f.category == "Preflight":
        warnings = _open_counts(db, article.id, "indesign_qc")
        n = warnings["error"] + warnings["warning"]
        return ("warn", f"{n} to check") if n else ("ok", "Clean")
    if f.category == "Proof_PDF":
        open_proof = sum(_open_counts(db, article.id, "proof").values())
        return ("warn", "Awaiting approval") if open_proof else ("ok", "Approved")
    if f.category == "XHTML":
        return ("ok", "Current") if f.path == article.xhtml_path else ("info", "Not current")
    if f.category == "Delivery_ZIP":
        return "ok", "Packaged"
    return "ok", "Ready"


def file_row(db: Session, article: JournalArticle, f: JournalFile, versions: int, names: Dict[int, str],
             folder: Optional[str] = None) -> dict:
    kind, label = _status(db, article, f)
    protected = f.path in current_paths(article) or folder == "backup"
    display_name = clean_display_name(f.filename) if folder != "backup" else f.filename
    return {
        "id": f.id, "filename": display_name, "raw_filename": f.filename, "category": f.category, "type": (f.file_type or os.path.splitext(f.filename)[1].lstrip(".")).upper(),
        "version": f.version, "versions": versions, "size": _size(f.path), "uploaded_at": f.uploaded_at,
        "uploaded_by": names.get(getattr(f, "uploaded_by_id", None)) or "system",
        "figure_number": f.figure_number, "status": {"kind": kind, "label": label},
        "folder": folder or folder_of(f.category), "protected": protected,
        "exists": os.path.exists(f.path),
    }


def working_copy_row(article: JournalArticle, snapshots: List[JournalFile]) -> Optional[dict]:
    path = article.edited_docx_path
    if not path or not os.path.exists(path):
        return None
    orig_name = os.path.basename(article.original_docx_path) if article.original_docx_path else os.path.basename(path)
    clean_name = clean_display_name(orig_name)
    version = len(snapshots) + 1
    return {
        "id": "working", "filename": clean_name, "category": "Working_Copy", "type": "DOCX",
        "version": version, "versions": version, "size": _size(path),
        "uploaded_at": datetime.fromtimestamp(os.path.getmtime(path)), "uploaded_by": "editor",
        "figure_number": None, "status": {"kind": "ok", "label": "Working copy"}, "folder": "manuscript",
        "protected": True, "exists": True, "note": "Edited manuscript copy",
    }


def folder_listing(db: Session, article: JournalArticle) -> dict:
    fams = families(db, article.id)
    names = _user_names(db, (getattr(f, "uploaded_by_id", None) for rows in fams.values() for f in rows))
    listing: Dict[str, List[dict]] = {f["key"]: [] for f in FOLDERS}
    for key, rows in fams.items():
        if key[0] == "Working_Copy":
            for r in rows:
                listing["backup"].append({**file_row(db, article, r, 1, names, "backup"), "note": "Working-copy snapshot"})
            continue
        latest = rows[-1]
        listing[folder_of(latest.category)].append(file_row(db, article, latest, len(rows), names))
        for older in rows[:-1]:
            listing["backup"].append({**file_row(db, article, older, 1, names, "backup"),
                                      "note": f"Superseded {latest.category.replace('_', ' ')} (current is v{latest.version})"})
    wc = working_copy_row(article, fams.get(("Working_Copy", "working"), []))
    if wc:
        manuscript_rows = listing["manuscript"]
        listing["manuscript"] = []
        for r in manuscript_rows:
            if r["category"] == "Manuscript":
                listing["backup"].append({**r, "folder": "backup", "note": f"Original upload (superseded by working copy v{wc['version']})"})
            else:
                listing["manuscript"].append(r)
        listing["manuscript"].insert(0, wc)

    # Strictly filter Manuscript folder: ONLY active DOCX and active XHTML allowed!
    # Move all reports, logs, json dumps, and auxiliary files to backup.
    clean_manuscript = []
    for r in listing["manuscript"]:
        cat = r.get("category")
        file_type = r.get("type", "").upper()
        if cat in ("Working_Copy", "Manuscript") and file_type == "DOCX":
            clean_manuscript.append(r)
        elif cat == "XHTML" and file_type == "XHTML":
            clean_manuscript.append(r)
        else:
            listing["backup"].append({**r, "folder": "backup", "note": "Auxiliary report / log"})
    listing["manuscript"] = clean_manuscript

    for rows in listing.values():
        rows.sort(key=lambda r: (r["id"] != "working", r["category"] != "Manuscript", str(r["filename"]).lower()))

    folders = []
    for spec in FOLDERS:
        rows = listing[spec["key"]]
        folders.append({**spec, "count": len(rows), "attention": any(r["status"]["kind"] in ("err", "warn") for r in rows),
                        "files": rows})
    return {"folders": folders, "delivery_readiness": delivery_readiness(db, article)}



def history(db: Session, article: JournalArticle, file_id) -> List[dict]:
    fams = families(db, article.id)
    names = _user_names(db, (getattr(f, "uploaded_by_id", None) for rows in fams.values() for f in rows))
    if file_id == "working":
        rows = fams.get(("Working_Copy", "working"), [])
        out = [file_row(db, article, r, 1, names, "backup") for r in rows]
        wc = working_copy_row(article, rows)
        return out + ([wc] if wc else [])
    f = db.query(JournalFile).filter(JournalFile.article_id == article.id, JournalFile.id == int(file_id)).first()
    if f is None:
        raise LookupError("File not found")
    rows = fams[family_key(f)]
    return [{**file_row(db, article, r, len(rows), names), "current": r is rows[-1]} for r in rows]


# --- restore ----------------------------------------------------------------------------------------
SUBDIR = {"XHTML": "xhtml", "JATS_XML": "xml", "INDD": "indesign", "IDML": "indesign", "Preflight": "indesign",
          "Proof_PDF": "proof", "Reference_Report": "references", "Art": "art", "Delivery_ZIP": "delivery"}
POINTER = {"XHTML": "xhtml_path", "JATS_XML": "jats_xml_path", "INDD": "indesign_path", "IDML": "indesign_path",
           "Proof_PDF": "proof_pdf_path", "Delivery_ZIP": "final_delivery_path"}


def restore(db: Session, article: JournalArticle, f: JournalFile, user_id: Optional[int] = None) -> Tuple[str, Optional[JournalFile]]:
    """Make an old version current again as the next version. Returns (message, new row)."""
    import shutil
    from app.domains.journals.files import save_version

    with open(f.path, "rb") as fh:
        data = fh.read()
    if f.category == "Working_Copy":
        from app.domains.journals.production import snapshot_working_copy
        if not article.edited_docx_path:
            raise ValueError("This article has no working copy to restore into")
        snapshot_working_copy(db, article, f"before restoring snapshot v{f.version}")
        shutil.copyfile(f.path, article.edited_docx_path)
        db.commit()
        return f"Working copy restored from snapshot v{f.version}. Re-run the Pre-Editing checks to refresh the findings.", None
    if f.category not in SUBDIR:
        raise ValueError(f"{f.category.replace('_', ' ')} files are not versioned, so they cannot be restored")
    base = _VERSION_SUFFIX.sub("", f.filename)
    row = save_version(db, article, f.category, base, data, SUBDIR[f.category], figure_number=f.figure_number)
    row.uploaded_by_id = user_id
    if f.category in POINTER:
        setattr(article, POINTER[f.category], row.path)
    db.commit()
    return f"{base}: v{f.version} restored as v{row.version}. The replaced version moved to Backup.", row


# --- zips -------------------------------------------------------------------------------------------
def build_zip(entries: Iterable[Tuple[str, str]]) -> bytes:
    """entries: (path on disk, name inside the zip)."""
    buf = io.BytesIO()
    seen = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, arc in entries:
            if not path or not os.path.exists(path) or arc in seen:
                continue
            seen.add(arc)
            z.write(path, arc)
    return buf.getvalue()


def archive_entries(db: Session, article: JournalArticle) -> List[Tuple[str, str]]:
    """Every file of the article, arranged by folder (current files and Backup)."""
    labels = {f["key"]: f["label"].replace(" ", "_") for f in FOLDERS}
    out = []
    for key, rows in families(db, article.id).items():
        for r in rows:
            folder = "backup" if (r is not rows[-1] or key[0] == "Working_Copy") else folder_of(r.category)
            out.append((r.path, f"{labels[folder]}/{r.filename}"))
    if article.edited_docx_path:
        out.append((article.edited_docx_path, f"Manuscript/{os.path.basename(article.edited_docx_path)}"))
    return out


# --- delivery ---------------------------------------------------------------------------------------
def delivery_readiness(db: Session, article: JournalArticle) -> List[dict]:
    from app.domains.journals.files import latest_file
    xml_errors = _open_counts(db, article.id, "xml")["error"]
    proof_open = sum(_open_counts(db, article.id, "proof").values())
    unlinked = db.query(JournalFile).filter(JournalFile.article_id == article.id, JournalFile.category == "Art",
                                            JournalFile.figure_number.is_(None)).count()
    has_xml = bool(article.jats_xml_path and os.path.exists(article.jats_xml_path))
    has_proof = bool(article.proof_pdf_path and os.path.exists(article.proof_pdf_path))
    has_indd = bool(article.indesign_path and os.path.exists(article.indesign_path)) or latest_file(db, article.id, "IDML") is not None
    return [
        {"key": "xml", "label": "JATS XML valid against the DTD", "ok": has_xml and not xml_errors,
         "detail": None if has_xml and not xml_errors else ("No JATS XML yet" if not has_xml else f"{xml_errors} DTD error(s) open")},
        {"key": "proof", "label": "Proof PDF approved", "ok": has_proof and not proof_open,
         "detail": None if has_proof and not proof_open else ("No proof yet" if not has_proof else "Proof sign-off is open")},
        {"key": "indesign", "label": "InDesign files", "ok": has_indd, "detail": None if has_indd else "No INDD/IDML yet"},
        {"key": "art", "label": "All art linked to a figure", "ok": unlinked == 0,
         "detail": None if unlinked == 0 else f"{unlinked} art file(s) not linked"},
    ]


def build_delivery(db: Session, article: JournalArticle, include_indesign: bool = True, include_art: bool = True,
                   user_id: Optional[int] = None, channel: str = "MANUAL_DOWNLOAD") -> Tuple[JournalFile, List[dict]]:
    """Zip the current XML, proof, InDesign and art as the next Delivery_ZIP version and record the delivery."""
    from app.domains.journals.files import art_files, latest_file, save_version
    from app.domains.journals.models import JournalDelivery

    if not article.jats_xml_path or not os.path.exists(article.jats_xml_path):
        raise ValueError("Convert the article to JATS XML before building the delivery package")
    entries = [(article.jats_xml_path, os.path.basename(article.jats_xml_path))]
    if article.proof_pdf_path:
        entries.append((article.proof_pdf_path, os.path.basename(article.proof_pdf_path)))
    if include_indesign:
        for cat in ("INDD", "IDML"):
            r = latest_file(db, article.id, cat)
            if r:
                entries.append((r.path, f"indesign/{r.filename}"))
    if include_art:
        entries += [(r.path, f"art/{r.filename}") for r in art_files(db, article.id)]
    readiness = delivery_readiness(db, article)
    doi = re.sub(r"[^\w.-]+", "_", article.article_doi or f"article_{article.id}")
    journal_code = article.journal.journal_code if article.journal else "journal"
    name = f"{journal_code}_{doi}_delivery.zip"
    row = save_version(db, article, "Delivery_ZIP", name, build_zip(entries), "delivery")
    row.uploaded_by_id = user_id
    article.final_delivery_path = row.path
    db.add(JournalDelivery(article_id=article.id, package_name=row.filename, jats_xml_file=article.jats_xml_path,
                           pdf_file=article.proof_pdf_path, indd_file=article.indesign_path if include_indesign else None,
                           delivery_channel=channel, delivery_status="Packaged", delivered_by_id=user_id))
    db.commit()
    return row, readiness
