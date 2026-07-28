"""Pelagic-specific link rules."""

import glob
import os

from bs4 import BeautifulSoup

from ....engine.registry import rule


@rule("PEL-LINK-001")
def validate_toc_two_way(book_details):
    """Every chapter listed in nav.xhtml TOC must contain a back-link that
    points to the TOC (href='nav.xhtml' or role='doc-toc' or epub:type='toc').
    """
    epub = book_details["epub_path"]

    nav_paths = glob.glob(os.path.join(epub, "**", "nav.xhtml"), recursive=True)
    if not nav_paths:
        return {"issues_count": 0, "issues": []}
    nav_path = nav_paths[0]

    try:
        with open(nav_path, "r", encoding="utf-8") as f:
            nav_soup = BeautifulSoup(f.read(), "html.parser")
    except Exception:  # noqa: BLE001
        return {"issues_count": 0, "issues": []}

    toc_nav = nav_soup.find("nav", attrs={"epub:type": "toc"}) or nav_soup.find("nav", id="toc")
    if not toc_nav:
        return {"issues_count": 0, "issues": []}

    chapter_files: list[str] = []
    for a in toc_nav.find_all("a", href=True):
        href = a["href"].split("#", 1)[0].strip()
        if not href:
            continue
        chapter_path = os.path.normpath(os.path.join(os.path.dirname(nav_path), href))
        if os.path.isfile(chapter_path):
            chapter_files.append(chapter_path)

    orphans = []
    for ch in chapter_files:
        try:
            with open(ch, "r", encoding="utf-8") as f:
                ch_soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        has_toc_back = False
        for a in ch_soup.find_all("a", href=True):
            href = a["href"].strip().lower()
            role = (a.get("epub:type") or "").lower()
            if "nav.xhtml" in href or role == "toc" or role == "doc-toc":
                has_toc_back = True
                break
        if not has_toc_back:
            orphans.append(os.path.relpath(ch, epub))

    if not orphans:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "toc_not_two_way",
        "message": (
            f"{len(orphans)} chapter(s) have no back-link to the TOC "
            f"(expected an <a href=\"nav.xhtml\"> or epub:type='toc'): "
            f"{orphans[:8]}" + ("..." if len(orphans) > 8 else "")
        ),
        "category": "Warning",
    }]}
