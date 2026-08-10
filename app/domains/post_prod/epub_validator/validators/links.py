"""Aspen link validators.

- Page citations of the form '(See page 23)' should link to the page id.
- Glossary term ↔ definition should be a two-way link.
- External links should not be underlined via CSS.
"""

import glob
import os
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule


# Matches "see page 23", "(see page 23)", "pp. 12-14", "page 5".
_PAGE_CITATION_RE = re.compile(
    r"\b(?:see\s+)?p(?:age|p)\.?\s*(\d{1,4})(?:\s*[\-–]\s*\d{1,4})?\b",
    re.IGNORECASE,
)


_PAGE_IDS_CACHE: dict[str, set[str]] = {}


def _epub_page_ids(epub: str) -> set[str]:
    """Every element id that looks like a page id (id='page_N' or on a pagebreak)."""
    if epub in _PAGE_IDS_CACHE:
        return _PAGE_IDS_CACHE[epub]

    ids: set[str] = set()
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for el in soup.find_all(True):
            eid = (el.get("id") or "").strip()
            etype = (el.get("epub:type") or "").strip()
            if re.match(r"^page[_-]?[ivxlcdm0-9]+$", eid, re.IGNORECASE):
                ids.add(eid)
            elif "pagebreak" in etype and eid:
                ids.add(eid)

    _PAGE_IDS_CACHE[epub] = ids
    return ids


def _page_id_for_number(page_num: str, existing: set[str]) -> str | None:
    """Given a page number string, return the matching id from `existing` (if any)."""
    candidates = [
        f"page_{page_num}",
        f"page{page_num}",
        f"page-{page_num}",
    ]
    for c in candidates:
        if c in existing:
            return c
    # Roman-numeral pages sometimes use lower-cased ids.
    for existing_id in existing:
        if existing_id.lower().endswith(page_num.lower()):
            return existing_id
    return None


@rule("ASP-LINK-001")
def validate_page_citation_links(file_details, rule_config=None):
    """Text like '(See page 23)' should be inside an <a href='...#page_23'>."""
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    epub = file_details.get("epub_root", "")
    if not epub:
        # Best-effort: walk up from full_path to find the OEBPS root.
        p = file_details["full_path"]
        for _ in range(6):
            p = os.path.dirname(p)
            if os.path.basename(p).lower() == "oebps":
                epub = os.path.dirname(p)
                break

    page_ids = _epub_page_ids(epub) if epub else set()

    issues = []
    body = soup.find("body") or soup
    for text_node in body.find_all(string=True):
        parent = text_node.parent
        if parent is None or parent.name == "a":
            continue
        for m in _PAGE_CITATION_RE.finditer(str(text_node)):
            num = m.group(1)
            if page_ids and _page_id_for_number(num, page_ids) is None:
                continue  # nothing to link to
            issues.append({
                "type": "page_citation_not_linked",
                "message": f"Page citation '{m.group(0)}' is not wrapped in an <a href='#page_{num}'> link.",
                "category": "Warning",
                "snippet": str(text_node)[max(0, m.start() - 30): m.end() + 30].strip(),
            })
            if len(issues) >= 25:
                break
        if len(issues) >= 25:
            break
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-LINK-002")
def validate_glossary_two_way(book_details):
    """Glossary definitions should link back to the terms that reference them,
    and terms in body chapters should link into the glossary.
    """
    epub = book_details["epub_path"]
    glossary_files = []
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        base = os.path.basename(xhtml).lower()
        if "glossary" in base:
            glossary_files.append(xhtml)

    if not glossary_files:
        return {"issues_count": 0, "issues": []}

    # Collect (term text, id) from glossary <dt>/<dfn>.
    glossary_entries: dict[str, tuple[str, str]] = {}  # term_lower -> (id, file)
    for gp in glossary_files:
        try:
            with open(gp, "r", encoding="utf-8") as f:
                gsoup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for el in gsoup.find_all(["dt", "dfn"]):
            term = el.get_text(strip=True)
            eid = (el.get("id") or "").strip()
            if term and eid:
                glossary_entries[term.lower()] = (eid, gp)

    if not glossary_entries:
        return {"issues_count": 0, "issues": []}

    issues = []
    body_files = [
        f for f in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True)
        if f not in glossary_files
    ]

    unreferenced = set(glossary_entries.keys())
    for bp in body_files:
        try:
            with open(bp, "r", encoding="utf-8") as f:
                bsoup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        body = bsoup.find("body") or bsoup
        text = body.get_text(" ", strip=True).lower()
        # Any glossary term that appears in body text — check that at least one
        # occurrence is inside an <a> pointing at the glossary.
        for term_lc, (eid, gpath) in glossary_entries.items():
            if term_lc not in text:
                continue
            # Find any <a> whose href ends with #eid.
            linked = any(
                (a.get("href") or "").endswith(f"#{eid}")
                for a in bsoup.find_all("a", href=True)
            )
            if linked:
                unreferenced.discard(term_lc)

    orphan_defs = sorted(unreferenced)
    if orphan_defs:
        issues.append({
            "type": "glossary_terms_unreferenced",
            "message": (
                f"{len(orphan_defs)} glossary term(s) are defined but never linked "
                f"from body chapters: {orphan_defs[:10]}"
                + ("..." if len(orphan_defs) > 10 else "")
            ),
            "category": "Warning",
        })
    return {"issues_count": len(issues), "issues": issues}


_EXTERNAL_LINK_SELECTOR_RE = re.compile(
    r'a\[href[\^\$\*]?=["\']?https?', re.IGNORECASE,
)
_UNDERLINE_RE = re.compile(r"text-decoration\s*:\s*[^;}]*underline", re.IGNORECASE)


@rule("ASP-LINK-003")
def validate_external_links_not_underlined(book_details):
    """CSS should not apply text-decoration: underline to external (http) links."""
    epub = book_details["epub_path"]
    issues = []
    css_files = glob.glob(os.path.join(epub, "**", "*.css"), recursive=True)
    for css_path in css_files:
        try:
            with open(css_path, "r", encoding="utf-8") as f:
                css = f.read()
        except Exception:  # noqa: BLE001
            continue

        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
            selector = m.group(1).strip()
            body = m.group(2)
            if _EXTERNAL_LINK_SELECTOR_RE.search(selector) and _UNDERLINE_RE.search(body):
                issues.append({
                    "type": "external_link_underlined",
                    "message": (
                        f"CSS rule '{selector}' underlines external links in "
                        f"{os.path.relpath(css_path, epub)}; Aspen convention is no underline."
                    ),
                    "category": "Warning",
                    "file_path": os.path.relpath(css_path, epub),
                })

    # Inline <a style="text-decoration: underline"> on http links.
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href.lower().startswith(("http://", "https://")):
                continue
            style = (a.get("style") or "")
            if _UNDERLINE_RE.search(style):
                issues.append({
                    "type": "external_link_underlined_inline",
                    "message": f"External link to '{href}' has inline underline style.",
                    "category": "Warning",
                    "file_path": os.path.relpath(xhtml, epub),
                    "href": href,
                })
    return {"issues_count": len(issues), "issues": issues}


from concurrent.futures import ThreadPoolExecutor, as_completed
from ._common import _check_single_url, _cli_issue_to_web, _drop_pass_issues, _make_session
from ..services import book_bundle_service as _bundle


@rule("URL001")
def validate_internal_xhtml_links(file_details, rule_config=None):
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    links = soup.find_all("a", href=True)

    for link in links:
        href = link["href"].strip()
        line_num = getattr(link, "sourceline", None)
        if not href.split("#")[0].endswith(".xhtml"):
            continue
        parts = href.split("#")
        file_name = parts[0]
        anchor = parts[1] if len(parts) > 1 else None
        current_dir = os.path.dirname(file_path)
        target_file = os.path.normpath(os.path.join(current_dir, file_name))

        if not os.path.exists(target_file):
            issues.append({
                "rule_name": "Missing Internal File",
                "type": "missing_internal_file",
                "href": href,
                "message": f"{f'Line {line_num}: ' if line_num else ''}Referenced XHTML file not found",
                "category": "Error",
                "line_number": line_num,
            })
            continue

        if anchor:
            with open(target_file, "r", encoding="utf-8") as f:
                soup_target = BeautifulSoup(f, "html.parser")
            element = soup_target.find(id=anchor)
            if not element:
                issues.append({
                    "rule_name": "Missing Anchor",
                    "type": "missing_anchor",
                    "href": href,
                    "message": f"{f'Line {line_num}: ' if line_num else ''}Referenced anchor not found in target file",
                    "category": "Error",
                    "line_number": line_num,
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("URL002")
def validate_external_urls(file_details, rule_config=None):
    file_path = file_details["full_path"]
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    hrefs = [
        link["href"].strip()
        for link in soup.find_all("a", href=True, class_="url")
        if link["href"].strip().startswith(("http://", "https://"))
    ]

    if not hrefs:
        return {"issues_count": 0, "issues": []}

    session = _make_session()
    issues = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_check_single_url, href, session): href for href in hrefs}
        for future in as_completed(futures):
            result = future.result()
            if result:
                issues.append(result)

    return {"issues_count": len(issues), "issues": issues}


@rule("URL003")
def validate_url_text_match(file_details, rule_config=None):
    file_path = file_details["full_path"]
    issues = []
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    links = soup.find_all("a", href=True, class_="url")
    for link in links:
        href = link["href"].strip()
        text = link.get_text(strip=True)
        line_num = getattr(link, "sourceline", None)
        if href != text:
            issues.append({
                "type": "url_text_mismatch",
                "href": href,
                "expected_text": href,
                "actual_text": text,
                "message": f"{f'Line {line_num}: ' if line_num else ''}Displayed URL text does not match href",
                "category": "warning",
                "line_number": line_num,
            })
    return {"issues_count": len(issues), "issues": issues}


@rule("URL004")
def validate_pdf_link_checker(book_details):
    """Book-scope: broken anchors + missing-link patterns."""
    from ..vendor.pdf_epub_validator import LinkChecker

    folder = book_details["folder_name"]
    bundle = _bundle.get_epub_bundle(folder)
    if not bundle:
        return {"issues_count": 0, "issues": []}
    cli_issues = LinkChecker(bundle).run_all()
    issues = _drop_pass_issues([_cli_issue_to_web(i) for i in cli_issues])
    return {"issues_count": len(issues), "issues": issues}
