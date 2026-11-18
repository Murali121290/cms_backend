"""Shared helpers for Aspen validators."""

import glob
import os


def find_opf(epub_folder: str) -> str | None:
    matches = glob.glob(os.path.join(epub_folder, "**", "*.opf"), recursive=True)
    return matches[0] if matches else None


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def get_book_language(target: dict, soup=None) -> str:
    """
    Common helper to detect the book language code (e.g. 'de', 'en', 'fr').
    Detection order:
    1. target.get("language") (from runner/DB or caller)
    2. DB lookup on EvProject using folder_name (if target.get("folder_name") exists)
    3. HTML <html lang="..." xml:lang="..."> (if soup is provided or target is an HTML/XHTML file)
    4. OPF dc:language (by inspecting any .opf in epub directory)
    Returns normalized 2-letter language code (default 'en').
    """
    if not isinstance(target, dict):
        return "en"

    # 1. From target dictionary (passed from runner/caller)
    lang = (target.get("language") or "").strip().lower()

    # 2. Query DB by folder_name if language is not yet known
    folder_name = target.get("folder_name")
    if not lang and folder_name:
        try:
            from app.core.database import SessionLocal
            from app.domains.post_prod.epub_validator.models import EvProject
            db = SessionLocal()
            try:
                proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
                if proj and proj.language:
                    lang = proj.language.strip().lower()
            finally:
                db.close()
        except Exception:
            pass

    # 3. From HTML tag if soup provided or reading target full_path
    if not lang:
        if soup:
            html_tag = soup.find("html")
            if html_tag:
                lang = (html_tag.get("xml:lang") or html_tag.get("lang") or "").strip().lower()
        elif target.get("full_path") and str(target["full_path"]).lower().endswith((".xhtml", ".html", ".htm")):
            try:
                from bs4 import BeautifulSoup
                with open(target["full_path"], "r", encoding="utf-8") as f:
                    file_soup = BeautifulSoup(f.read(), "html.parser")
                html_tag = file_soup.find("html")
                if html_tag:
                    lang = (html_tag.get("xml:lang") or html_tag.get("lang") or "").strip().lower()
            except Exception:
                pass

    # 4. From OPF dc:language
    if not lang:
        epub_root = target.get("epub_path") or target.get("epub_root")
        if not epub_root and target.get("full_path"):
            epub_root = os.path.dirname(target["full_path"])
        if epub_root:
            opf_path = find_opf(epub_root)
            if opf_path and os.path.exists(opf_path):
                try:
                    from bs4 import BeautifulSoup
                    with open(opf_path, "r", encoding="utf-8") as f:
                        opf_soup = BeautifulSoup(f.read(), "html.parser")
                    ltag = opf_soup.find(["dc:language", "language"])
                    if ltag and ltag.get_text(strip=True):
                        lang = ltag.get_text(strip=True).strip().lower()
                except Exception:
                    pass

    # Normalize language code (e.g., 'de-DE' -> 'de', 'de_AT' -> 'de')
    if "-" in lang:
        lang = lang.split("-")[0]
    if "_" in lang:
        lang = lang.split("_")[0]

    return lang if lang else "en"


from ..services.validate_service import (  # noqa: F401
    _URL_HEADERS,
    _call_w3c_css_validator,
    _check_single_url,
    _cli_issue_to_web,
    _drop_pass_issues,
    _make_session,
    _pagebreak_collect_segments,
    _pagebreak_normalize,
    get_nav_level,
)

