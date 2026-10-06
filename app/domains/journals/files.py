"""Where journal files live and how their versions are kept.

Everything is stored under the CMS runtime uploads folder, which the Docker
backend mounts from the host (D:\\cms_backend\\data\\cms_runtime_data\\uploads):

    uploads/journals/<CLIENT>/<JOURNAL>/
        design/<kind>/v<N>/<file>          journal design pack (template, font, library, logo, css)
        incoming/<batch>/                  uploads before they become articles
        articles/article_<id>/
            original/ …                    the manuscript and package exactly as uploaded
            structured/ edited/            the working copy the editor saves into
            xhtml/ xml/ indesign/ proof/   stage outputs, one file per version: <name>_v<N>.<ext>
            art/                           art files, one file per version: <name>_v<N>.<ext>

Files are never overwritten. The database is the source of truth for versions:
JournalFile.version (per article + category, or per figure for art) and
JournalAsset.version / is_active (per journal + kind). "Current" means the
highest version, or for design assets the one marked active.
"""
import os
import re
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.core.paths import UPLOADS_DIR
from app.domains.journals.models import Journal, JournalArticle, JournalAsset, JournalFile

ART_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".eps", ".svg", ".pdf", ".ai", ".psd"}
ASSET_KINDS = {"template", "font", "library", "logo", "css"}
SINGLE_ACTIVE_KINDS = {"template", "library", "logo", "css"}  # one active version per journal; fonts: one per file name


def storage_root() -> Path:
    return Path(os.getenv("JOURNAL_STORAGE_ROOT") or (UPLOADS_DIR / "journals"))


def _safe(name: str) -> str:
    return re.sub(r"[^\w.-]+", "_", (name or "").strip()).strip("._") or "unnamed"


def journal_dir(journal: Journal, *parts: str) -> str:
    client_code = journal.client.client_code if journal.client else "no_client"
    path = storage_root().joinpath(_safe(client_code), _safe(journal.journal_code), *parts)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def article_dir(article: JournalArticle, *parts: str) -> str:
    return journal_dir(article.journal, "articles", f"article_{article.id}", *parts)


def incoming_dir(journal: Journal) -> str:
    return journal_dir(journal, "incoming", uuid.uuid4().hex[:12])


def latest_file(db: Session, article_id: int, category: str) -> Optional[JournalFile]:
    return db.query(JournalFile).filter(JournalFile.article_id == article_id, JournalFile.category == category) \
        .order_by(JournalFile.version.desc(), JournalFile.id.desc()).first()


def save_version(db: Session, article: JournalArticle, category: str, filename: str, data: bytes, subdir: str,
                 figure_number: Optional[int] = None) -> JournalFile:
    """Write data as the next version and register it. The caller commits.

    Versions count per article + category; art counts per figure, or per file name when unlinked.
    """
    stem, ext = os.path.splitext(_safe(filename))
    q = db.query(JournalFile).filter(JournalFile.article_id == article.id, JournalFile.category == category)
    if figure_number is not None:
        q = q.filter(JournalFile.figure_number == figure_number)
    elif category == "Art":
        q = q.filter(JournalFile.figure_number.is_(None), JournalFile.filename.like(f"{stem}_v%{ext}"))
    version = q.count() + 1
    name = f"{stem}_v{version}{ext}"
    path = os.path.join(article_dir(article, subdir), name)
    if isinstance(data, str):
        data = data.encode("utf-8")
    with open(path, "wb") as fh:
        fh.write(data)
    row = JournalFile(article_id=article.id, filename=name, file_type=ext.lstrip(".").lower(), category=category,
                      path=path, version=version, is_original=False, figure_number=figure_number)
    db.add(row)
    db.flush()
    return row


def art_files(db: Session, article_id: int) -> List[JournalFile]:
    """Current art: the latest version for each linked figure, plus every unlinked art file."""
    rows = db.query(JournalFile).filter(JournalFile.article_id == article_id, JournalFile.category == "Art") \
        .order_by(JournalFile.version.desc(), JournalFile.id.desc()).all()
    seen, out = set(), []
    for r in rows:
        if r.figure_number is not None:
            if r.figure_number in seen:
                continue
            seen.add(r.figure_number)
        out.append(r)
    return sorted(out, key=lambda r: (r.figure_number is None, r.figure_number or 0, r.filename.lower()))


def art_file_paths(db: Session, article_id: int) -> List[str]:
    paths = [r.path for r in art_files(db, article_id) if os.path.splitext(r.filename)[1].lower() in ART_EXTENSIONS]
    article = db.query(JournalArticle).get(article_id)
    if article:
        art_dir = article_dir(article, "art")
        if os.path.exists(art_dir):
            for fn in os.listdir(art_dir):
                fp = os.path.join(art_dir, fn)
                if os.path.isfile(fp) and os.path.splitext(fn)[1].lower() in ART_EXTENSIONS:
                    if fp not in paths:
                        paths.append(fp)
    return paths


def figure_files(db: Session, article_id: int) -> Dict[int, str]:
    """{figure number: file name} for art linked to a figure."""
    return {r.figure_number: os.path.basename(r.path) for r in art_files(db, article_id) if r.figure_number is not None}


def save_asset(db: Session, journal: Journal, kind: str, filename: str, data: bytes,
               note: Optional[str] = None, user_id: Optional[int] = None) -> JournalAsset:
    """Store a design file as a new version. The caller commits.

    Template/library/logo/css: versions count per kind, and a new upload only becomes active
    automatically when nothing of that kind is active yet (activate it explicitly otherwise).
    Fonts: versions count per file name, and the newest version of a font is always active.
    """
    if kind not in ASSET_KINDS:
        raise ValueError(f"Unknown asset kind '{kind}'")
    name = _safe(os.path.basename(filename))
    q = db.query(JournalAsset).filter(JournalAsset.journal_id == journal.id, JournalAsset.kind == kind)
    if kind == "font":
        q = q.filter(JournalAsset.filename == name)
    version = q.count() + 1
    path = os.path.join(journal_dir(journal, "design", kind, f"v{version}" if kind != "font" else name.rsplit(".", 1)[0] + f"_v{version}"), name)
    with open(path, "wb") as fh:
        fh.write(data)
    if kind == "font":
        q.update({JournalAsset.is_active: False})
        active = True
    else:
        active = not q.filter(JournalAsset.is_active == True).count()  # noqa: E712
    row = JournalAsset(journal_id=journal.id, kind=kind, filename=name, path=path, version=version, is_active=active,
                       note=note, size_bytes=len(data), uploaded_by_id=user_id)
    db.add(row)
    db.flush()
    return row


def activate_asset(db: Session, asset: JournalAsset) -> None:
    q = db.query(JournalAsset).filter(JournalAsset.journal_id == asset.journal_id, JournalAsset.kind == asset.kind)
    if asset.kind == "font":
        q = q.filter(JournalAsset.filename == asset.filename)
    q.update({JournalAsset.is_active: False})
    asset.is_active = True


def active_assets(db: Session, journal_id: int, kind: str) -> List[JournalAsset]:
    return db.query(JournalAsset).filter(JournalAsset.journal_id == journal_id, JournalAsset.kind == kind,
                                         JournalAsset.is_active == True).order_by(JournalAsset.filename).all()  # noqa: E712
