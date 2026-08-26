"""Aspen link validators.

- Page citations of the form '(See page 23)' should link to the page id.
- Glossary term ↔ definition should be a two-way link.
- External links should not be underlined via CSS.
"""

import glob
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import json

from ..engine.registry import rule
from ..services.upload_service import UPLOAD_DIR





_PAGE_IDS_CACHE: dict[str, set[str]] = {}

# URL validation constants and helpers for URL002
_URL_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0 Safari/537.36"
    )
}

# Cache: url -> issue dict (or None if URL is healthy).
# Persists for the lifetime of the process so the same URL is never
# fetched twice across different .xhtml files in one validation run.
_URL_RESULT_CACHE: dict[str, dict | None] = {}


def _make_session() -> requests.Session:
    """Create a requests session with retry logic."""
    session = requests.Session()
    retry = Retry(
        total=1,           # reduced from 3 — avoids long stalls on dead URLs
        connect=1,
        read=1,
        backoff_factor=1,  # reduced from 2 — wait: 1s between retries
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _check_mailto(href: str) -> dict | None:
    """Validate mailto: links. Return issue dict if invalid, else None."""
    # Extract email part (remove "mailto:" prefix)
    if not href.startswith("mailto:"):
        return None

    email_part = href[7:].strip()  # Remove "mailto:"

    # Check for common malformations
    if not email_part:
        return {
            "rule_name": "Empty mailto",
            "type": "mailto_invalid",
            "href": href,
            "category": "Error",
            "message": "mailto: link has no email address",
        }

    # Check for invalid characters after email (like ",call")
    if "," in email_part:
        parts = email_part.split(",")
        email = parts[0].strip()
        extra = ",".join(parts[1:]).strip()
        if extra and not extra.startswith("?"):  # "?cc=..." is valid
            return {
                "rule_name": "mailto malformed",
                "type": "mailto_invalid",
                "href": href,
                "category": "Warning",
                "message": f"mailto: has invalid suffix '{extra}'. Use ?cc=, ?bcc=, or ?subject=",
            }

    # Basic email format validation (simplified)
    email = email_part.split("?")[0].strip()  # Get just the email, ignore query params
    if "@" not in email:
        return {
            "rule_name": "Invalid email format",
            "type": "mailto_invalid",
            "href": href,
            "category": "Error",
            "message": f"Invalid email format: {email}",
        }

    # Check for obvious typos
    if email.endswith((".c", ".co")):  # Missing .com, .org, etc.
        return {
            "rule_name": "Incomplete email domain",
            "type": "mailto_invalid",
            "href": href,
            "category": "Warning",
            "message": f"Email domain may be incomplete: {email}",
        }

    return None


def _check_single_url(href: str, session: requests.Session) -> dict | None:
    """Return an issue dict if the URL has a problem, else None."""
    try:
        resp = session.head(href, timeout=10, allow_redirects=True,  # reduced from 30s
                           verify=False, headers=_URL_HEADERS)
        code = resp.status_code
        if code in (403, 405):
            resp = session.get(href, timeout=10, allow_redirects=True,  # reduced from 30s
                              verify=False, headers=_URL_HEADERS, stream=True)
            code = resp.status_code
        if code < 400:
            return None
        if code == 404:
            sev, msg = "Error", "URL not found"
        elif code == 403:
            sev, msg = "Warning", "Access forbidden or bot blocked"
        elif code == 405:
            sev, msg = "Warning", "Method not allowed"
        elif code >= 500:
            sev, msg = "Warning", "Server error"
        else:
            sev, msg = "Warning", "External URL issue"
        return {
            "rule_name": "External URL Issue",
            "type": "external_url_issue",
            "href": href,
            "status_code": code,
            "category": sev,
            "message": f"{msg}. Status code - {code}",
        }
    except requests.exceptions.Timeout:
        return {
            "rule_name": "URL Timeout",
            "type": "external_url_issue",
            "href": href,
            "category": "Warning",
            "message": "Request timeout",
        }
    except requests.exceptions.ConnectionError:
        return {
            "rule_name": "Connection Error",
            "type": "external_url_issue",
            "href": href,
            "category": "Error",
            "message": "Connection error",
        }
    except Exception as e:
        return {
            "rule_name": "URL Check Error",
            "type": "external_url_issue",
            "href": href,
            "category": "Error",
            "message": str(e),
        }


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


_CHAPTER_NUMS_CACHE: dict[str, set[str]] = {}

def _epub_chapter_numbers(epub: str) -> set[str]:
    if epub in _CHAPTER_NUMS_CACHE:
        return _CHAPTER_NUMS_CACHE[epub]

    nums: set[str] = set()
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        basename = os.path.basename(xhtml).lower()
        # Match base chapter numbers in filenames like ch110.xhtml, chapter-11.xhtml
        m = re.search(r'(?:ch|chapter|c|part|sec(?:tion)?)[_-]?(\d+)', basename)
        if m:
            nums.add(m.group(1).lstrip("0") or "0")


    _CHAPTER_NUMS_CACHE[epub] = nums
    return nums


_SUMMARY_CACHE: dict[str, dict[str, set[str]]] = {}

def _get_summary_labels(folder_name: str) -> dict[str, set[str]]:
    if not folder_name:
        return {"figures": set(), "tables": set()}
        
    if folder_name in _SUMMARY_CACHE:
        return _SUMMARY_CACHE[folder_name]

    cache_path = os.path.join(UPLOAD_DIR, folder_name, "summary_cache.json")
    labels = {"figures": set(), "tables": set()}
    
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            for label in data.get("figure_labels", []):
                m = re.search(r'fig(?:ure)?\.?\s*(\d+(?:[\.\-–]\d+)*)', label, re.IGNORECASE)
                if m:
                    labels["figures"].add(m.group(1))
                    
            for label in data.get("table_labels", []):
                m = re.search(r'tab(?:le)?\.?\s*(\d+(?:[\.\-–]\d+)*)', label, re.IGNORECASE)
                if m:
                    labels["tables"].add(m.group(1))
        except Exception:
            pass
            
    _SUMMARY_CACHE[folder_name] = labels
    return labels


@rule("COM-LINK-001")
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
    summary_labels = _get_summary_labels(file_details.get("folder_name", ""))

    issues = []
    body = soup.find("body") or soup
    
    # Unwrap inline formatting tags to prevent fragmented text nodes
    for tag in body.find_all(['span', 'strong', 'b', 'i', 'em', 'sup', 'sub', 'u']):
        tag.unwrap()
    if hasattr(body, 'smooth'):
        body.smooth()

    config_dict = (rule_config or {}).get("rule_config", {})
    custom_regex = config_dict.get("citation_regex")
    if not custom_regex:
        issues.append({
            "type": "config_error",
            "message": "Missing 'citation_regex' in rule config",
            "category": "Error"
        })
        return {"issues_count": len(issues), "issues": issues}
        
    regex = re.compile(custom_regex, re.IGNORECASE)

    for text_node in body.find_all(string=True):
        parent = text_node.parent
        if parent is None or text_node.find_parent(["a", "h1", "h2", "h3", "h4", "h5", "h6", "figure", "figcaption", "header", "title"]):
            continue
        line_num = getattr(parent, "sourceline", None)

        for m in regex.finditer(str(text_node)):
            # Extract first non-None group (pages, chapters, figures, or tables)
            num = next((g for g in m.groups() if g), None)
            if num is None:
                continue

            # Ignore table/figure captions at the start of a <p> tag right before or after a table/image
            is_figure = m.group(3) is not None if len(m.groups()) >= 3 else False
            is_table = m.group(4) is not None if len(m.groups()) >= 4 else False
            is_unit = m.group(5) is not None if len(m.groups()) >= 5 else False
            is_lesson = m.group(6) is not None if len(m.groups()) >= 6 else False
            
            if (is_table or is_figure) and parent and parent.name == "p" and m.start() < 10:
                next_tag = parent.find_next_sibling()
                valid_targets = ["table", "figure"]
                
                if next_tag and next_tag.name in valid_targets:
                    continue

            # If it is a chapter citation, only validate if the base chapter exists in this book
            if m.group(2) is not None and epub:
                chapter_num_full = m.group(2).lstrip("0") or "0"
                base_match = re.match(r'^(\d+)', chapter_num_full)
                base_chapter = base_match.group(1) if base_match else chapter_num_full
                
                available_chapters = _epub_chapter_numbers(epub)
                if available_chapters and base_chapter not in available_chapters:
                    continue

            # If it is a page citation, only validate if the page exists in this book
            if m.group(1) is not None and epub:
                page_num = m.group(1).lstrip("0") or "0"
                if page_ids and _page_id_for_number(page_num, page_ids) is None:
                    continue
                    
            # If it is a Figure citation, verify it exists
            special_message = None
            if is_figure and summary_labels["figures"]:
                fig_num = m.group(3)
                if fig_num and fig_num not in summary_labels["figures"]:
                    special_message = f"Citation '{m.group(0)}' looks like a citation but is not found in this book."
            
            # If it is a Table citation, verify it exists
            if is_table and summary_labels["tables"]:
                table_num = m.group(4)
                if table_num and table_num not in summary_labels["tables"]:
                    special_message = f"Citation '{m.group(0)}' looks like a citation but is not found in this book."

            msg = special_message or f"Citation '{m.group(0)}' is not wrapped in a link."
            rule_name = "Citation Not In Book" if special_message else "Citation Not Linked"
            issue_type = "citation_not_in_book" if special_message else "page_citation_not_linked"
            category = "Warning" if special_message else "Error"

            issues.append({
                "rule_name": rule_name,
                "type": issue_type,
                "message": msg,
                "category": category,
                "snippet": str(text_node)[max(0, m.start() - 30): m.end() + 30].strip(),
                "extract": m.group(0),
                "line_number": line_num,
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
                "extract": href,
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
                    "extract": href,
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("URL002")
def validate_external_urls(file_details, rule_config=None):
    file_path = file_details["full_path"]
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    issues = []
    hrefs = []
    mailto_links = []

    for link in soup.find_all("a", href=True):
        href = link["href"].strip()
        line_num = getattr(link, "sourceline", None)

        # Check mailto: links
        if href.startswith("mailto:"):
            mailto_links.append((href, line_num, href))
            continue

        # Check external links: http://, https://, //, www., or ftp://
        if href.startswith(("http://", "https://", "//", "www.", "ftp://")):
            raw_href = link["href"]
            invalid_reason = None
            if " " in raw_href:
                invalid_reason = "space"
            elif raw_href.endswith(";"):
                invalid_reason = "semicolon (;)"
            elif raw_href.endswith(","):
                invalid_reason = "comma (,)"
            elif raw_href.endswith("."):
                invalid_reason = "dot (.)"
            elif raw_href.endswith(":"):
                invalid_reason = "colon (:)"
            elif raw_href.endswith("?"):
                invalid_reason = "question mark (?)"
            elif raw_href.endswith("("):
                invalid_reason = "opening parenthesis (()"
            elif raw_href.endswith(")"):
                invalid_reason = "closing parenthesis ())"
            elif raw_href.endswith("["):
                invalid_reason = "opening bracket ([)"
            elif raw_href.endswith("]"):
                invalid_reason = "closing bracket (])"
            elif raw_href.endswith("{"):
                invalid_reason = "opening brace ({)"
            elif raw_href.endswith("}"):
                invalid_reason = "closing brace (})"
                
            if invalid_reason:
                issues.append({
                    "rule_name": "Invalid URL Formatting",
                    "type": "invalid_url_formatting",
                    "message": f"URL '{raw_href}' contains an invalid {invalid_reason}. Accidental characters should be removed.",
                    "category": "Error",
                    "href": raw_href,
                    "line_number": line_num,
                    "extract": raw_href,
                })
                continue
            hrefs.append((href, line_num, href))
        # Skip internal: relative paths (xhtml, #anchor, /)
        elif href.startswith(("#", "/")):
            continue

    # Validate mailto: links (synchronous)
    for href, line_num, extract_text in mailto_links:
        result = _check_mailto(href)
        if result:
            result["line_number"] = line_num
            result["extract"] = extract_text
            issues.append(result)

    # Validate external URLs (parallel), skipping already-cached URLs
    if hrefs:
        unchecked = [(href, ln, ext) for href, ln, ext in hrefs if href not in _URL_RESULT_CACHE]
        session = _make_session()

        # Fetch only URLs we haven't seen before
        if unchecked:
            with ThreadPoolExecutor(max_workers=10) as pool:
                futures = {pool.submit(_check_single_url, href, session): (href, ln, ext)
                           for href, ln, ext in unchecked}
                for future in as_completed(futures):
                    href, ln, ext = futures[future]
                    _URL_RESULT_CACHE[href] = future.result()  # store result (None = OK)

        # Apply cached results for all hrefs in this file
        for href, line_num, extract_text in hrefs:
            result = _URL_RESULT_CACHE.get(href)
            if result:
                result = dict(result)  # copy so we don't mutate the cache
                result["line_number"] = line_num
                result["extract"] = extract_text
                issues.append(result)

    return {"issues_count": len(issues), "issues": issues}


@rule("URL003")
def validate_url_text_match(file_details, rule_config=None):
    file_path = file_details["full_path"]
    issues = []
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    # Remove class_="url" requirement
    links = soup.find_all("a", href=True)
    for link in links:
        href = link["href"].strip()
        text = link.get_text(strip=True)
        line_num = getattr(link, "sourceline", None)
        
        # Only validate if both href and text look like URLs (start with http, https, or www)
        if href.startswith(("http://", "https://", "www.")) and text.lower().startswith(("http://", "https://", "www.")):
            # Normalize by stripping http:// and https:// for the comparison
            norm_href = href.replace("http://", "").replace("https://", "")
            norm_text = text.replace("http://", "").replace("https://", "")
            
            if norm_href != norm_text:
                issues.append({
                    "type": "url_text_mismatch",
                    "href": href,
                    "expected_text": href,
                    "actual_text": text,
                    "message": "Displayed URL text does not match href",
                    "category": "warning",
                    "line_number": line_num,
                    "extract": href,
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


@rule("URL005")
def validate_internal_references(file_details, rule_config=None):
    """Validate internal references: anchors, non-XHTML files, root-relative paths."""
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    links = soup.find_all("a", href=True)
    epub_root = file_details.get("epub_root", "")

    for link in links:
        href = link["href"].strip()
        line_num = getattr(link, "sourceline", None)

        # Skip external links and mailto
        if href.startswith(("http://", "https://", "mailto:", "//")):
            continue

        # Skip already validated by URL001 (XHTML files in same dir)
        if href.split("#")[0].endswith(".xhtml") and not href.startswith("/"):
            continue

        # 1. Pure anchors (#section)
        if href.startswith("#"):
            anchor = href[1:]
            if not anchor:
                issues.append({
                    "rule_name": "Empty Anchor",
                    "type": "empty_anchor",
                    "href": href,
                    "message": "Link has empty anchor (#)",
                    "category": "Error",
                    "line_number": line_num,
                })
                continue

            # Check if anchor exists in current file
            current_file_id = soup.find(id=anchor)
            if not current_file_id:
                issues.append({
                    "rule_name": "Missing Anchor in Current File",
                    "type": "missing_anchor_self",
                    "href": href,
                    "id": anchor,
                    "message": f"Anchor '{anchor}' not found in current file",
                    "category": "Error",
                    "line_number": line_num,
                })
            continue

        # 2. Root-relative paths (/path/to/file)
        if href.startswith("/"):
            if not epub_root:
                issues.append({
                    "rule_name": "Cannot Validate Root Path",
                    "type": "root_path_no_epub",
                    "href": href,
                    "message": "Root-relative path but EPUB root not found",
                    "category": "Warning",
                    "line_number": line_num,
                })
                continue

            # Remove leading slash and check if file exists
            target_file = os.path.normpath(os.path.join(epub_root, href.lstrip("/")))
            file_part = target_file.split("#")[0]

            if not os.path.exists(file_part):
                issues.append({
                    "rule_name": "Missing Root Path File",
                    "type": "missing_root_file",
                    "href": href,
                    "message": "Root-relative file not found",
                    "category": "Error",
                    "line_number": line_num,
                })
                continue

            # Check anchor in root-relative file
            if "#" in href:
                anchor = href.split("#")[1]
                try:
                    with open(file_part, "r", encoding="utf-8") as f:
                        target_soup = BeautifulSoup(f, "html.parser")
                    if not target_soup.find(id=anchor):
                        issues.append({
                            "rule_name": "Missing Anchor in Root Path File",
                            "type": "missing_anchor_root",
                            "href": href,
                            "id": anchor,
                            "message": f"Anchor '{anchor}' not found in target file",
                            "category": "Error",
                            "line_number": line_num,
                        })
                except Exception as e:
                    issues.append({
                        "rule_name": "Cannot Read Root Path File",
                        "type": "root_file_read_error",
                        "href": href,
                        "message": f"Error reading file: {e}",
                        "category": "Warning",
                        "line_number": line_num,
                    })
            continue

        # 3. Non-XHTML files (images, PDFs, etc.)
        # Check if file exists in current directory
        current_dir = os.path.dirname(file_path)
        target_file = os.path.normpath(os.path.join(current_dir, href.split("#")[0]))

        if not os.path.exists(target_file):
            issues.append({
                "rule_name": "Missing File",
                "type": "missing_file",
                "href": href,
                "message": "Referenced file not found",
                "category": "Error",
                "line_number": line_num,
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("GWP-LINK-001")
def validate_1_to_1_backlinks(book_details, rule_config=None):
    """
    GWP000: All internal links must have a 1:1 backlink relationship.
    This rule checks that for every internal link from File A to File B, 
    there is a corresponding link from File B back to File A.
    """
    epub_path = book_details.get("epub_path")
    if not epub_path:
        return {"issues_count": 0, "issues": []}

    xhtml_files = glob.glob(os.path.join(epub_path, "**", "*.xhtml"), recursive=True)
    html_files = glob.glob(os.path.join(epub_path, "**", "*.html"), recursive=True)
    all_files = xhtml_files + html_files
    
    issues = []
    
    # Map: source_file -> set of target_files
    links_from_to = {}
    
    for filepath in all_files:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:
            continue
            
        current_dir = os.path.dirname(filepath)
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            # Ignore external links and self-anchor links
            if href.startswith(("http://", "https://", "mailto:", "//", "#")):
                continue
                
            parts = href.split("#")
            target_rel = parts[0]
            if not target_rel:
                continue
                
            target_file = os.path.normpath(os.path.join(current_dir, target_rel))
            # Only consider links to other xhtml/html files in the book
            if target_file != filepath and os.path.exists(target_file):
                if filepath not in links_from_to:
                    links_from_to[filepath] = set()
                links_from_to[filepath].add(target_file)
                
    # Verify the 1:1 relationship
    for source_file, target_files in links_from_to.items():
        filename = os.path.basename(source_file).lower()
        # Skip typical navigational files that are not expected to have backlinks
        if filename in ("toc.xhtml", "nav.xhtml", "cover.xhtml", "title.xhtml", "titlepage.xhtml", "contents.xhtml"):
            continue
            
        for target_file in target_files:
            target_filename = os.path.basename(target_file).lower()
            if target_filename in ("toc.xhtml", "nav.xhtml", "cover.xhtml", "title.xhtml", "titlepage.xhtml", "contents.xhtml"):
                continue
                
            target_links = links_from_to.get(target_file, set())
            if source_file not in target_links:
                issues.append({
                    "rule_name": "Missing Backlink",
                    "type": "missing_1_to_1_backlink",
                    "message": f"File links to '{os.path.basename(target_file)}' but no backlink exists.",
                    "category": "Error",
                    "file_path": os.path.relpath(source_file, epub_path),
                })

    return {"issues_count": len(issues), "issues": issues}
