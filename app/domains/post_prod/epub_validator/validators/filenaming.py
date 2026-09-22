import os
import re

from ..engine.registry import rule
from ._common import find_opf, read_text


_EISBN_TAG = re.compile(r"<dc:identifier[^>]*>\s*(?:urn:isbn:)?(\d{10,13})[^<]*</dc:identifier>", re.IGNORECASE)


def _extract_eisbn(epub: str) -> str | None:
    opf = find_opf(epub)
    if not opf:
        return None
    text = read_text(opf)
    if not text:
        return None
    # Prefer identifiers whose element/context hints at EPUB/EISBN.
    for m in re.finditer(
        r'<dc:identifier[^>]*id="[^"]*(?:epub|eisbn|book|pub)[^"]*"[^>]*>\s*(?:urn:isbn:)?(\d{10,13})',
        text,
        re.IGNORECASE,
    ):
        return m.group(1)
    m = _EISBN_TAG.search(text)
    return m.group(1) if m else None


@rule("ASP-FILE-001")
def validate_epub_filename(book_details):
    """Aspen: main EPUB filename must be '<eISBN>_EPUB.epub'."""
    epub = book_details["epub_path"]
    folder_name = book_details["folder_name"]
    extract_root = os.path.dirname(epub)

    epub_files: list[str] = []
    if os.path.isdir(extract_root):
        epub_files = [f for f in os.listdir(extract_root) if f.lower().endswith(".epub")]

    if not epub_files:
        return {"issues_count": 0, "issues": []}

    eisbn = _extract_eisbn(epub)
    if not eisbn:
        return {"issues_count": 1, "issues": [{
            "type": "eisbn_not_found",
            "message": "Cannot validate EPUB filename — could not extract eISBN from OPF <dc:identifier>.",
            "category": "Warning",
        }]}

    main = f"{eisbn}_EPUB.epub"
    alt = f"{eisbn}_EPUBAlt.epub"

    issues = []
    if main not in epub_files:
        # Case-insensitive match tells us whether the name is close but wrong-cased.
        near = next((f for f in epub_files if f.lower() == main.lower()), None)
        if near:
            issues.append({
                "type": "epub_filename_case",
                "message": f"Aspen main EPUB filename must be exactly '{main}' (found '{near}').",
                "category": "Error",
                "file_path": near,
            })
        else:
            # If the folder_name itself matches, the user likely renamed on zip;
            # only flag when the actual file diverges from the expected form.
            issues.append({
                "type": "epub_filename_missing",
                "message": (
                    f"Aspen main EPUB filename must be '{main}'. Uploaded folder is "
                    f"'{folder_name}'; extract contains: {sorted(epub_files)}."
                ),
                "category": "Error",
            })

    for f in epub_files:
        if f.lower() == alt.lower() and f != alt:
            issues.append({
                "type": "epub_alt_filename_case",
                "message": f"Alt EPUB filename must be exactly '{alt}' (found '{f}').",
                "category": "Warning",
                "file_path": f,
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-FILE-002")
def validate_unique_identifier_matches_db(file_details, rule_config=None):
    """OPF <package unique-identifier> must match 'p' + eISBN (from DB)."""
    full_path = file_details["full_path"]
    folder_name = file_details["folder_name"]
    
    # Query DB for project eisbn
    from app.database import SessionLocal
    from app.domains.post_prod.epub_validator.services import ev_projects_db
    db = SessionLocal()
    try:
        project = ev_projects_db.get_project_by_folder(db, folder_name)
        db_eisbn = project.eisbn if project else None
    finally:
        db.close()
        
    issues = []
    if not db_eisbn:
        issues.append({
            "type": "db_eisbn_missing",
            "message": "Cannot validate OPF unique-identifier because project eISBN is missing in the database.",
            "category": "Warning"
        })
        return {"issues_count": len(issues), "issues": issues}

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(content, "xml")
    except Exception:
        return {"issues_count": 0, "issues": []}

    package = soup.find("package")
    if not package:
        issues.append({
            "type": "package_missing",
            "message": "<package> tag missing in OPF.",
            "category": "Error"
        })
        return {"issues_count": len(issues), "issues": issues}
        
    unique_id = package.get("unique-identifier")
    
    if unique_id not in (db_eisbn, f"p{db_eisbn}", f"EPUB-{db_eisbn}"):
        # Find line number roughly
        lines = content.splitlines()
        from ..validators.metadata import _find_line
        issues.append({
            "type": "unique_identifier_mismatch",
            "message": f"Input EPUB eISBN ({db_eisbn}) and OPF mentioned unique-identifier ({unique_id}) mismatch.",
            "category": "Error",
            "line_number": _find_line(lines, "<package"),
            "extract": f'unique-identifier="{unique_id}"' if unique_id else "<package"
        })
        
    return {"issues_count": len(issues), "issues": issues}



_BACK_COVER_NAMES = ("backcover", "back_cover", "back-cover", "bcover")


@rule("ASP-COV-004")
def validate_no_back_cover(book_details):
    """Aspen: back covers are not required; flag any back-cover image."""
    epub = book_details["epub_path"]
    issues = []
    for root, _dirs, files in os.walk(epub):
        for f in files:
            stem, ext = os.path.splitext(f.lower())
            if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
                continue
            if stem in _BACK_COVER_NAMES or any(stem.startswith(n) for n in _BACK_COVER_NAMES):
                issues.append({
                    "type": "back_cover_present",
                    "message": f"Back cover images are not required for Aspen titles (found '{f}').",
                    "category": "Warning",
                    "file_path": os.path.relpath(os.path.join(root, f), epub),
                })
    return {"issues_count": len(issues), "issues": issues}
