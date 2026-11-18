import os
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ._common import find_opf, read_text, get_book_language

# Case-insensitive, tolerates "Halftitle", "Half title", "Half-title".
_HALFTITLE_RE = re.compile(r"\bhalf[\s\-]?title\b", re.IGNORECASE)
# Match "and" as a word between two author-name-ish tokens.
_AUTHOR_AND_RE = re.compile(r"\band\b", re.IGNORECASE)
_OXFORD_COMMA_RE = re.compile(r",\s*and\b", re.IGNORECASE)


@rule("ASP-NAV-001")
def validate_front_matter_present(file_details, rule_config=None):
    """NAV must contain both "Cover" and "Front Matter" sections."""
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    nav = soup.find("nav", attrs={"epub:type": "toc"}) or soup.find("nav", id="toc")
    if not nav:
        return {"issues_count": 0, "issues": []}

    issues = []

    # Check for Cover
    has_cover = False
    for a in nav.find_all("a"):
        label = a.get_text(strip=True)
        if label.lower() == "cover":
            has_cover = True
            break

    if not has_cover:
        has_cover = bool(nav.find(attrs={"epub:type": lambda v: v and "cover" in (v or "").lower()}))

    if not has_cover:
        issues.append({
            "type": "cover_missing_from_nav",
            "message": 'NAV does not contain a "Cover" entry',
            "category": "Warning",
        })

    # Check for Front Matter
    has_front_matter = False
    for a in nav.find_all("a"):
        label = a.get_text(strip=True)
        if label.lower().replace(" ", "") == "frontmatter":
            has_front_matter = True
            break

    if not has_front_matter:
        # Fallback: any element in the NAV with epub:type frontmatter
        has_front_matter = bool(nav.find(attrs={"epub:type": lambda v: v and "frontmatter" in v}))

    if not has_front_matter:
        issues.append({
            "type": "front_matter_missing",
            "message": 'NAV does not contain a "Front Matter" entry',
            "category": "Warning",
        })

    if not issues:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-NAV-002")
def validate_no_halftitle_word(file_details, rule_config=None):
    """The words 'Half title', 'Half-title', 'Halftitle' should not appear
    in nav.xhtml or toc.ncx (source, not just displayed text).
    """
    text = read_text(file_details["full_path"])
    issues = []
    for match in _HALFTITLE_RE.finditer(text):
        snippet_start = max(0, match.start() - 40)
        snippet_end = min(len(text), match.end() + 40)
        issues.append({
            "type": "halftitle_word_present",
            "message": f'Forbidden word "{match.group(0)}" found in {file_details["file_name"]}',
            "category": "Error",
            "snippet": text[snippet_start:snippet_end].replace("\n", " "),
        })
    return {"issues_count": len(issues), "issues": issues}


def _is_forbidden_frontmatter_file(filename: str, stem_regex) -> bool:
    """Check if a filename indicates a half-title or title-page file."""
    if not stem_regex:
        return False
    base = os.path.basename(filename)
    stem, ext = os.path.splitext(base)
    if ext.lower() not in (".xhtml", ".html"):
        return False
    # Strip sequence/chapter numbers (e.g., 01_, 02-, ch01_)
    stem_clean = re.sub(r'^(ch|c)?\d+[\s\-_]+', '', stem).strip().lower()
    return bool(stem_regex.search(stem_clean))


def _is_forbidden_fm_text(text: str, terms_regex) -> bool:
    """Check if label/text indicates half-title or title-page."""
    if not terms_regex:
        return False
    cleaned = (text or "").strip()
    if not cleaned:
        return False
    return bool(terms_regex.search(cleaned))


@rule("BOD-FM-001")
@rule("BOD-NAV-001")
@rule("BOD-TITLE-001")
def validate_no_halftitle_titlepage(target, rule_config=None):
    """
    If half title and title page are part of the source files’ front matter,
    they must be removed from the E-Book.
    Checks:
    1. XHTML filenames (half title or title page xhtml must not be present).
    2. Navigation document (nav.xhtml TOC/landmarks/links must not contain half title or title page).
    3. NCX document (toc.ncx navPoints must not contain half title or title page).
    Configurable via rule_config:
      - forbidden_terms_pattern
      - forbidden_file_stem_pattern
    """
    import os

    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    terms_pattern = cfg.get("forbidden_terms_pattern") or cfg.get("terms_pattern")
    file_stem_pattern = cfg.get("forbidden_file_stem_pattern") or cfg.get("file_stem_pattern")
    forbidden_terms_map = cfg.get("forbidden_terms_by_language")

    if not terms_pattern or not file_stem_pattern or not forbidden_terms_map or not isinstance(forbidden_terms_map, dict):
        return {
            "issues_count": 1,
            "issues": [{
                "type": "configuration_error",
                "message": "Missing required 'forbidden_terms_pattern', 'forbidden_file_stem_pattern', or 'forbidden_terms_by_language' in rule configuration.",
                "category": "Error",
            }]
        }

    try:
        terms_re = re.compile(terms_pattern, re.IGNORECASE)
        stem_re = re.compile(file_stem_pattern, re.IGNORECASE)
    except Exception as e:
        return {
            "issues_count": 1,
            "issues": [{
                "type": "configuration_error",
                "message": f"Invalid regex pattern in rule configuration: {e}",
                "category": "Error",
            }]
        }

    # Detect book language using common helper
    detected_lang = get_book_language(target)
    lang_term_label = forbidden_terms_map.get(detected_lang) or forbidden_terms_map.get("en") or list(forbidden_terms_map.values())[0]

    issues = []
    seen_issues = set()

    def _find_line_in_text(raw_text, *needles):
        if not raw_text or not needles:
            return 1
        lines = raw_text.splitlines()
        for needle in needles:
            if not needle:
                continue
            needle_clean = str(needle).strip()
            if not needle_clean:
                continue
            for idx, line in enumerate(lines, 1):
                if needle_clean in line:
                    return idx
        return 1

    def add_issue(issue_type, message, file_path, file_name, snippet="", line_number=1):
        key = (issue_type, file_path, snippet or message)
        if key in seen_issues:
            return
        seen_issues.add(key)
        issues.append({
            "type": issue_type,
            "message": message,
            "category": "Error",
            "file_path": file_path,
            "file_name": file_name,
            "snippet": snippet,
            "extract": snippet,
            "line_number": int(line_number) if line_number else 1,
        })

    def check_nav_file(nav_full_path, epub_root):
        if not os.path.isfile(nav_full_path):
            return
        rel_path = os.path.relpath(nav_full_path, epub_root) if epub_root else nav_full_path
        fn = os.path.basename(nav_full_path)
        try:
            with open(nav_full_path, "r", encoding="utf-8") as f:
                content = f.read()
            soup = BeautifulSoup(content, "html.parser")
        except Exception:
            return

        # 1. Check all links in nav
        for a in soup.find_all("a"):
            label = a.get_text(strip=True)
            href = a.get("href", "")
            target_fn = href.split("#")[0].split("/")[-1] if href else ""

            matched_label = _is_forbidden_fm_text(label, terms_re)
            matched_href = _is_forbidden_frontmatter_file(target_fn, stem_re) if target_fn else False

            if matched_label or matched_href:
                found_desc = label if matched_label else target_fn
                snippet = f'<a href="{href}">{label}</a>'
                line_no = getattr(a, "sourceline", None) or _find_line_in_text(content, href, label)
                add_issue(
                    "forbidden_frontmatter_nav",
                    f"{lang_term_label} entry '{found_desc}' found in {fn}. Please remove it from the navigation TOC.",
                    rel_path,
                    fn,
                    snippet,
                    line_number=line_no,
                )

        # 2. Check landmarks with epub:type="titlepage" or "halftitlepage"
        for landmark in soup.find_all(attrs={"epub:type": True}):
            ep_types = landmark.get("epub:type", "").lower().split()
            for t in ep_types:
                if t in ("titlepage", "halftitlepage", "half-title"):
                    label = landmark.get_text(strip=True) or t
                    snip = str(landmark)[:120]
                    line_no = getattr(landmark, "sourceline", None) or _find_line_in_text(content, t, label)
                    add_issue(
                        "forbidden_frontmatter_landmark",
                        f"{lang_term_label} landmark '{label}' found in {fn}. Please remove it from the navigation landmarks.",
                        rel_path,
                        fn,
                        snip,
                        line_number=line_no,
                    )

    def check_ncx_file(ncx_full_path, epub_root):
        if not os.path.isfile(ncx_full_path):
            return
        rel_path = os.path.relpath(ncx_full_path, epub_root) if epub_root else ncx_full_path
        fn = os.path.basename(ncx_full_path)
        try:
            with open(ncx_full_path, "r", encoding="utf-8") as f:
                content = f.read()
            soup = BeautifulSoup(content, "html.parser")
        except Exception:
            return

        for np in soup.find_all("navpoint"):
            nav_label = np.find("navlabel")
            text_tag = nav_label.find("text") if nav_label else None
            label_text = text_tag.get_text(strip=True) if text_tag else ""

            content_tag = np.find("content")
            src = content_tag.get("src", "") if content_tag else ""
            target_fn = src.split("#")[0].split("/")[-1] if src else ""

            matched_label = _is_forbidden_fm_text(label_text, terms_re)
            matched_src = _is_forbidden_frontmatter_file(target_fn, stem_re) if target_fn else False

            if matched_label or matched_src:
                found_desc = label_text if matched_label else target_fn
                snippet = f'<navPoint><navLabel><text>{label_text}</text></navLabel><content src="{src}"/></navPoint>'
                np_id = np.get("id", "")
                line_no = getattr(np, "sourceline", None) or _find_line_in_text(content, np_id, src, label_text)
                add_issue(
                    "forbidden_frontmatter_ncx",
                    f"{lang_term_label} entry '{found_desc}' found in {fn}. Please remove it from the NCX TOC.",
                    rel_path,
                    fn,
                    snippet,
                    line_number=line_no,
                )

    # Mode 1: Book Scope (target contains epub_path)
    if isinstance(target, dict) and "epub_path" in target:
        epub = target["epub_path"]
        if not epub or not os.path.isdir(epub):
            return {"issues_count": 0, "issues": []}

        # 1. Walk and check all XHTML file names
        for root, _dirs, files in os.walk(epub):
            for f in files:
                full_p = os.path.join(root, f)
                rel_p = os.path.relpath(full_p, epub)
                if _is_forbidden_frontmatter_file(f, stem_re):
                    add_issue(
                        "forbidden_frontmatter_file",
                        f"{lang_term_label} file '{f}' must be removed from the E-Book front matter.",
                        rel_p,
                        f,
                        f"File: {f}"
                    )

        # 2. Find and check nav.xhtml
        for root, _dirs, files in os.walk(epub):
            for f in files:
                if f.lower() in ("nav.xhtml", "nav.html"):
                    check_nav_file(os.path.join(root, f), epub)

        # 3. Find and check toc.ncx
        for root, _dirs, files in os.walk(epub):
            for f in files:
                if f.lower() == "toc.ncx":
                    check_ncx_file(os.path.join(root, f), epub)

    # Mode 2: File Scope (target contains full_path)
    elif isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        full_path = target.get("full_path") or target.get("file_path")
        file_name = target.get("file_name") or os.path.basename(full_path)
        epub = target.get("epub_root") or target.get("epub_path") or os.path.dirname(full_path)
        rel_path = target.get("relative_path") or (os.path.relpath(full_path, epub) if epub else file_name)

        if file_name.lower() in ("nav.xhtml", "nav.html"):
            check_nav_file(full_path, epub)
        elif file_name.lower() == "toc.ncx":
            check_ncx_file(full_path, epub)
        elif _is_forbidden_frontmatter_file(file_name, stem_re):
            add_issue(
                "forbidden_frontmatter_file",
                f"{lang_term_label} file '{file_name}' must be removed from the E-Book front matter.",
                rel_path,
                file_name,
                f"File: {file_name}"
            )

    return {"issues_count": len(issues), "issues": issues}


@rule("NAV002")
def validate_ncx_nav_sync(file_details, rule_config=None):
    """Validate that NCX (EPUB 2 TOC) matches NAV (EPUB 3 TOC)."""
    import os
    file_path = file_details["full_path"]
    issues = []
    current_dir = os.path.dirname(file_path)

    # Read NCX file
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f, "html.parser")
    except Exception as e:
        issues.append({
            "rule_name": "NCX Read Error",
            "type": "ncx_read_error",
            "message": f"Could not read NCX file: {e}",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    # Read NAV file
    nav_path = os.path.join(current_dir, "nav.xhtml")
    if not os.path.exists(nav_path):
        issues.append({
            "rule_name": "NAV File Missing",
            "type": "nav_file_missing",
            "message": "nav.xhtml not found in same directory",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    try:
        with open(nav_path, "r", encoding="utf-8") as f:
            nav_soup = BeautifulSoup(f, "html.parser")
    except Exception as e:
        issues.append({
            "rule_name": "NAV Read Error",
            "type": "nav_read_error",
            "message": f"Could not read NAV file: {e}",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    # Extract NCX items
    ncx_items = []
    for navpoint in ncx_soup.find_all("navpoint"):
        text_tag = navpoint.find("text")
        content_tag = navpoint.find("content")
        title = text_tag.get_text(strip=True) if text_tag else ""
        href = content_tag.get("src", "").strip() if content_tag else ""
        ncx_items.append({
            "title": title,
            "href": href,
            "line_number": getattr(navpoint, "sourceline", None),
            "text_line": getattr(text_tag, "sourceline", getattr(navpoint, "sourceline", None)),
            "content_line": getattr(content_tag, "sourceline", getattr(navpoint, "sourceline", None)),
        })

    # Extract NAV items
    nav_items = []
    toc_nav = nav_soup.find("nav", {"epub:type": "toc"}) or nav_soup.find("nav", id="toc")
    if toc_nav:
        for a in toc_nav.find_all("a"):
            title = a.get_text(strip=True)
            href = a.get("href", "").strip()
            nav_items.append({
                "title": title,
                "href": href,
                "line_number": getattr(a, "sourceline", None),
            })

    # Check count match
    if len(ncx_items) != len(nav_items):
        issues.append({
            "rule_name": "TOC Count Mismatch",
            "type": "toc_count_mismatch",
            "message": f"NCX has {len(ncx_items)} items but NAV has {len(nav_items)} items",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    # Compare items
    for i in range(len(ncx_items)):
        ncx_item = ncx_items[i]
        nav_item = nav_items[i]

        ncx_title = ncx_item["title"]
        nav_title = nav_item["title"]
        ncx_href = ncx_item["href"]
        nav_href = nav_item["href"]

        # Text match (case-insensitive)
        if ncx_title.lower() != nav_title.lower():
            issues.append({
                "rule_name": "TOC Text Mismatch",
                "type": "toc_text_mismatch",
                "href": nav_href,
                "expected_text": ncx_title,
                "actual_text": nav_title,
                "message": f"Item {i+1}: NCX and NAV title text do not match",
                "category": "Error",
                "line_number": ncx_item["text_line"],
                "extract": ncx_title,
            })
        # Case mismatch
        elif ncx_title != nav_title:
            issues.append({
                "rule_name": "TOC Case Mismatch",
                "type": "toc_case_mismatch",
                "href": nav_href,
                "expected_text": ncx_title,
                "actual_text": nav_title,
                "message": f"Item {i+1}: NCX and NAV title casing does not match",
                "category": "Warning",
                "line_number": ncx_item["text_line"],
                "extract": ncx_title,
            })

        # File reference match
        ncx_file = ncx_href.split("#")[0]
        nav_file = nav_href.split("#")[0]
        if ncx_file != nav_file:
            issues.append({
                "rule_name": "TOC File Mismatch",
                "type": "toc_file_mismatch",
                "href": nav_href,
                "expected_file": ncx_file,
                "actual_file": nav_file,
                "message": f"Item {i+1}: NCX and NAV file references do not match",
                "category": "Error",
                "line_number": ncx_item["content_line"],
                "extract": ncx_href,
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-NAV-003")
def validate_author_separator(book_details):
    """In OPF (dc:creator) and NCX (docAuthor), multiple authors must be
    separated by ',' — the word 'and' should not appear as a separator.
    """
    epub = book_details["epub_path"]
    issues = []

    opf = find_opf(epub)
    if opf:
        try:
            with open(opf, "r", encoding="utf-8") as f:
                opf_soup = BeautifulSoup(f.read(), "xml")
            for creator in opf_soup.find_all("dc:creator"):
                name = creator.get_text(strip=True)
                if _AUTHOR_AND_RE.search(name):
                    issues.append({
                        "type": "author_uses_and",
                        "message": f'Author name uses "and" as a separator in OPF: "{name}"',
                        "category": "Error",
                        "file_path": opf,
                    })
        except Exception as e:  # noqa: BLE001
            issues.append({
                "type": "opf_parse_failed",
                "message": f"Could not parse OPF: {e}",
                "category": "Warning",
            })

    # NCX docAuthor
    import glob, os
    for ncx in glob.glob(f"{epub}/**/toc.ncx", recursive=True):
        try:
            with open(ncx, "r", encoding="utf-8") as f:
                ncx_soup = BeautifulSoup(f.read(), "xml")
            for author in ncx_soup.find_all(["docAuthor", "docauthor"]):
                text = author.get_text(strip=True)
                if _AUTHOR_AND_RE.search(text):
                    issues.append({
                        "type": "author_uses_and",
                        "message": f'docAuthor uses "and" as a separator in NCX: "{text}"',
                        "category": "Error",
                        "file_path": os.path.relpath(ncx, epub),
                    })
        except Exception as e:  # noqa: BLE001
            issues.append({
                "type": "ncx_parse_failed",
                "message": f"Could not parse NCX: {e}",
                "category": "Warning",
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-NAV-004")
def validate_author_oxford_comma(file_details, rule_config=None):
    """In NCX (docAuthor), multiple authors must not use
    an comma before 'and' (e.g. 'A, B and C' is correct, 'A, B, and C' is invalid).
    """
    file_path = file_details["full_path"]
    issues = []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f.read(), "xml")
        for author in ncx_soup.find_all(["docAuthor", "docauthor"]):
            text = author.get_text(strip=True)
            if _OXFORD_COMMA_RE.search(text):
                issues.append({
                    "type": "author_uses_oxford_comma",
                    "message": f'docAuthor uses an comma before "and" in NCX: "{text}"',
                    "category": "Error",
                    "line_number": author.sourceline,
                    "extract": text
                })
    except Exception as e:  # noqa: BLE001
        issues.append({
            "type": "ncx_parse_failed",
            "message": f"Could not parse NCX: {e}",
            "category": "Warning",
        })

    return {"issues_count": len(issues), "issues": issues}


def get_nav_level(link_tag):
    """Calculate navigation nesting level by counting parent <ol> elements."""
    level = 0
    parent = link_tag.parent
    while parent:
        if parent.name == "ol":
            level += 1
        parent = parent.parent
    return level


@rule("NAV001")
def validate_nav_xhtml(file_details, rule_config=None):
    import os
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    nav = soup.find("nav", attrs={"epub:type": "toc"})
    if not nav:
        issues.append({
            "rule_name": "Missing TOC Nav",
            "type": "missing_nav",
            "message": "TOC nav not found",
            "category": "Error"
        })
        return {"issues_count": len(issues), "issues": issues}

    file_heading_map = {}
    nav_links = nav.find_all("a", href=True)

    for link in nav_links:
        href = link["href"].strip()
        nav_text = " ".join(link.get_text(strip=True).split())
        nav_level = get_nav_level(link)
        line_num = getattr(link, "sourceline", None)

        # Check for empty nav link text
        if not nav_text:
            issues.append({
                "rule_name": "Empty Nav Link",
                "type": "empty_nav_link",
                "message": "Nav link text is empty",
                "category": "Error",
                "line_number": line_num,
                "extract": href,
            })
            continue

        # Skip external URLs
        if href.startswith("http"):
            continue

        # Skip specific nav items (configured in rule_config)
        inner_config = rule_config.get("rule_config", {}) if rule_config else {}
        skip_items = inner_config.get("skip_nav_text", [])
        if nav_text.strip().lower() in [item.lower() for item in skip_items]:
            continue

        # Split file and ID
        if "#" in href:
            chapter_file, target_id = href.split("#", 1)
        else:
            chapter_file = href
            target_id = None

        current_dir = os.path.dirname(file_path)
        target_file_path = os.path.normpath(os.path.join(current_dir, chapter_file))

        # FILE EXISTS check
        if not os.path.exists(target_file_path):
            issues.append({
                "rule_name": "Missing Referenced File",
                "type": "missing_file",
                "href": href,
                "message": "Referenced file not found",
                "category": "Error",
                "line_number": line_num,
                "extract": href,
            })
            continue

        # If path is a directory, look for a file inside it
        if os.path.isdir(target_file_path):
            # Try to find an xhtml file in the directory
            xhtml_files = [f for f in os.listdir(target_file_path)
                          if f.endswith(('.xhtml', '.html'))]
            if not xhtml_files:
                issues.append({
                    "rule_name": "No Content File in Directory",
                    "type": "no_content_file",
                    "href": href,
                    "message": "Directory contains no XHTML files",
                    "category": "Error",
                    "line_number": line_num,
                    "extract": href,
                })
                continue
            # Use the first xhtml file found
            target_file_path = os.path.join(target_file_path, xhtml_files[0])

        # Open target XHTML
        try:
            with open(target_file_path, "r", encoding="utf-8") as chapter:
                chapter_soup = BeautifulSoup(chapter.read(), "html.parser")
        except Exception as e:
            issues.append({
                "rule_name": "File Read Error",
                "type": "file_read_error",
                "href": href,
                "message": f"Could not read target file: {e}",
                "category": "Error",
                "line_number": line_num,
                "extract": href,
            })
            continue

        # Find target element
        if target_id:
            target_element = chapter_soup.find(id=target_id)
            if not target_element:
                issues.append({
                    "rule_name": "Missing Referenced Anchor ID",
                    "type": "missing_referenced_id",
                    "href": href,
                    "id": target_id,
                    "message": "Referenced Anchor ID id not found",
                    "category": "Error",
                    "line_number": line_num,
                    "extract": href,
                })
                continue
        else:
            # Use first heading if no anchor
            target_element = chapter_soup.find(["h1", "h2", "h3", "h4", "h5", "h6"])
            if not target_element:
                issues.append({
                    "rule_name": "Missing Heading",
                    "type": "missing_heading",
                    "href": href,
                    "message": "No heading found in chapter",
                    "category": "Warning",
                    "line_number": line_num,
                    "extract": href,
                })
                continue

        # Move to heading tag
        heading_tags = ["h1", "h2", "h3", "h4", "h5", "h6"]
        heading_classes = ["CASE_H1", "CASE_H2", "CASE_H3", "CASE_H4", "CASE_H5", "CASE_H6", "MCQH"]
        current_element = target_element

        while current_element:
            current_classes = current_element.get("class", [])
            if (current_element.name in heading_tags or
                any(cls in heading_classes for cls in current_classes)):
                break
            current_element = current_element.parent

        # Heading not found
        if not current_element:
            issues.append({
                "rule_name": "Heading Tag Not Found",
                "type": "heading_not_found",
                "href": href,
                "message": (f'"{nav_text}" not in heading tags(h1-h6) or '
                           f'classes({", ".join(heading_classes)}). Heading hierarchy not checked.'),
                "category": "Warning",
                "line_number": line_num,
                "extract": nav_text,
            })
            continue

        # Get heading text, using null byte to track tag boundaries and strip=False to preserve node spaces
        # Collect text from current heading and any immediately following headings (split headings)
        collected_headings = [current_element]
        next_sib = current_element.find_next_sibling()
        while next_sib:
            if next_sib.name in heading_tags or any(cls in heading_classes for cls in next_sib.get("class", [])):
                collected_headings.append(next_sib)
                next_sib = next_sib.find_next_sibling()
            else:
                # If there's a `<br/>` or empty `<p>` we could theoretically skip it, but typically they are true siblings.
                break
                
        heading_texts = [h.get_text(separator="\x00", strip=False) for h in collected_headings]
        heading_text = " ".join(heading_texts)

        # TEXT MATCH check with normalized spacing
        import re
        def normalize_spacing(text):
            # 1. Remove \x00 before punctuation (e.g. `1\x00.` -> `1.`)
            text = re.sub(r'\x00+([.,:;!?\)\]])', r'\1', text)
            
            # 2. If \x00 is AFTER punctuation and before a letter/number/quote, 
            # it indicates a tag boundary (e.g. `</span>Gun`). 
            # We assume CSS handles the spacing here, so we convert the boundary to a space.
            text = re.sub(r'([.,:;!?\)\]])\x00+(?=[a-zA-Z0-9\(\[\"\'“‘])', r'\1 ', text)
            
            # 3. Remove all other \x00 (e.g. drop caps like `C\x00hapter` -> `Chapter`)
            text = text.replace('\x00', '')
            
            # 4. Collapse multiple spaces into a single space
            text = re.sub(r'\s+', ' ', text)
            return text.strip()
            
        nav_text_norm = normalize_spacing(nav_text)
        heading_text_norm = normalize_spacing(heading_text)

        matched = False
        if nav_text_norm.lower() == heading_text_norm.lower():
            matched = True
        elif len(heading_texts) > 1:
            # Fallback for split headings: structural punctuation (. : -) is often added to the TOC 
            # exactly at the boundary between two split heading elements.
            # We build a regex that allows optional punctuation ONLY at these specific boundaries,
            # ensuring all other text/punctuation (like trailing dots) is strictly checked.
            escaped_texts = [re.escape(normalize_spacing(t).lower()) for t in heading_texts]
            separator_pattern = r'\s*[.:\-]?\s*'
            full_pattern = "^" + separator_pattern.join(escaped_texts) + "$"
            if re.match(full_pattern, nav_text_norm.lower()):
                matched = True

        if not matched:
                issues.append({
                    "rule_name": "Heading Text Mismatch",
                    "type": "heading_text_mismatch",
                    "href": href,
                    "expected_text": nav_text,
                    "actual_text": heading_text,
                    "message": "Nav text and heading text mismatch",
                    "category": "Error",
                    "line_number": line_num,
                    "extract": nav_text,
                })
        # # True case mismatch (triggers if text is identical ignoring case and spacing variations)
        # elif nav_text_norm != heading_text_norm:
        #     issues.append({
        #         "rule_name": "Heading Case Mismatch",
        #         "type": "heading_case_mismatch",
        #         "href": href,
        #         "expected_text": nav_text,
        #         "actual_text": heading_text,
        #         "message": "Case mismatch",
        #         "category": "Warning",
        #         "line_number": line_num,
        #          "extract": nav_text
        #     })

        # Heading level validation
        if current_element.name in heading_tags:
            heading_level = int(current_element.name[1])

            # Store current heading level per file
            if chapter_file not in file_heading_map:
                file_heading_map[chapter_file] = {}

            parent_nav_level = nav_level - 1

            # Validate hierarchy only within same file
            if parent_nav_level in file_heading_map[chapter_file]:
                parent_heading_level = file_heading_map[chapter_file][parent_nav_level]
                # Child heading must be deeper
                if heading_level <= parent_heading_level:
                    expected_min_level = parent_heading_level + 1
                    issues.append({
                        "rule_name": "Nav Hierarchy Mismatch",
                        "type": "hierarchy_mismatch",
                        "href": href,
                        "message": (f'"{heading_text}" heading hierarchy does not match TOC hierarchy. '
                                   f'TOC implies this should be at least h{expected_min_level}, '
                                   f'but an h{heading_level} was found in the chapter.'),
                        "category": "Error",
                        "line_number": line_num,
                    })

            # Store current level
            file_heading_map[chapter_file][nav_level] = heading_level
        else:
            # Element has CSS class but not a heading tag
            current_classes = current_element.get("class", [])
            issues.append({
                "rule_name": "Nav Hierarchy Mismatch",
                "type": "nav_hierarchy_mismatch",
                "href": href,
                "message": (f'"{nav_text}" is not a heading tag. Found "{current_element.name}" '
                           f'with classes {current_classes if current_classes else "None"}. '
                           'Heading hierarchy not checked.'),
                "category": "Warning",
                "line_number": line_num,
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("NAV004")
def validate_cover_entry_required(file_details, rule_config=None):
    """Cover entry is compulsory in nav.xhtml TOC."""
    import os
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    nav = soup.find("nav", attrs={"epub:type": "toc"}) or soup.find("nav", id="toc")
    if not nav:
        issues.append({
            "rule_name": "Missing TOC Nav",
            "type": "missing_toc_nav",
            "message": "TOC nav not found - cannot verify cover entry",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    # Look for cover entry
    has_cover = False
    cover_link = None

    # Check by link text "Cover" (case-insensitive)
    for a in nav.find_all("a"):
        link_text = a.get_text(strip=True)
        if link_text.lower() == "cover":
            has_cover = True
            cover_link = a
            break

    # Fallback: check for epub:type="cover"
    if not has_cover:
        cover_element = nav.find(attrs={"epub:type": lambda v: v and "cover" in (v or "").lower()})
        if cover_element:
            has_cover = True
            cover_link = cover_element

    if not has_cover:
        issues.append({
            "rule_name": "Cover Entry Missing",
            "type": "cover_entry_missing",
            "message": 'Cover entry is mandatory in TOC. Add: <li><a href="...">Cover</a></li>',
            "category": "Error",
        })
    else:
        # Validate cover link
        if cover_link and cover_link.get("href"):
            href = cover_link.get("href").strip()
            current_dir = os.path.dirname(file_path)
            target_path = os.path.normpath(os.path.join(current_dir, href.split("#")[0]))

            if not os.path.exists(target_path):
                issues.append({
                    "rule_name": "Cover File Missing",
                    "type": "cover_file_missing",
                    "href": href,
                    "message": "Cover file referenced in nav does not exist",
                    "category": "Error",
                    "line_number": getattr(cover_link, "sourceline", None),
                    "extract": href,
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("NAV005")
def validate_page_list_links(file_details, rule_config=None):
    """Validate that page list items contain properly linked anchor tags."""
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    issues = []

    # Find the nav element with role="doc-pagelist" or epub:type="page-list"
    page_list_nav = soup.find("nav", attrs={"role": "doc-pagelist"}) or soup.find("nav", attrs={"epub:type": "page-list"})

    if not page_list_nav:
        return {"issues_count": 0, "issues": []}

    # Check for direct text or <p> tags inside the <nav> element
    if page_list_nav.find("p"):
        issues.append({
            "rule_name": "Page List Link Check",
            "type": "page_list_contains_p_tag",
            "message": "Page list <nav> element must not contain a <p> tag.",
            "category": "Error",
            "line_number": getattr(page_list_nav, "sourceline", None),
            "extract": str(page_list_nav)[:100],
        })

    has_nav_direct_text = False
    nav_direct_text_snippet = ""
    for child in page_list_nav.contents:
        if child.name is None and str(child).strip():
            has_nav_direct_text = True
            nav_direct_text_snippet = str(child).strip()
            break
            
    if has_nav_direct_text:
        issues.append({
            "rule_name": "Page List Link Check",
            "type": "page_list_nav_direct_text",
            "message": "Page list <nav> element must not contain direct text.",
            "category": "Error",
            "line_number": getattr(page_list_nav, "sourceline", None),
            "extract": nav_direct_text_snippet[:100],
        })

    ols = page_list_nav.find_all("ol")
    for ol in ols:
        # We find direct <li> elements to handle nested lists properly
        for li in ol.find_all("li", recursive=False):
            a_tag = li.find("a")
            
            # Check 1: <li> must contain an <a> tag with an href
            if not a_tag or not a_tag.get("href"):
                issues.append({
                    "rule_name": "Page List Link Check",
                    "type": "page_list_link_missing",
                    "message": "Page list <li> element must contain an <a> tag with an href.",
                    "category": "Error",
                    "line_number": getattr(li, "sourceline", None),
                    "extract": li.get_text(strip=True) or str(li)[:100],
                })
                continue
            
            # Check 2: <li> must not contain direct text outside the <a> tag
            has_direct_text = False
            li_direct_text_snippet = ""
            for child in li.contents:
                if child.name is None and str(child).strip():
                    has_direct_text = True
                    li_direct_text_snippet = str(child).strip()
                    break
                    
            if has_direct_text:
                issues.append({
                    "rule_name": "Page List Link Check",
                    "type": "page_list_direct_text",
                    "message": "Page list <li> element must not contain direct text outside the <a> tag.",
                    "category": "Error",
                    "line_number": getattr(li, "sourceline", None),
                    "extract": li_direct_text_snippet[:100],
                })
                
            # Check 3: Text in <a> tag must match the page number/identifier in the href
            a_text = a_tag.get_text(strip=True).lower()
            href = a_tag.get("href", "")
            if "#" in href:
                target_id = href.split("#", 1)[-1].lower()
                # Remove common prefixes like 'page_', 'page-', 'page', 'p_', 'p-', 'p'
                import re
                clean_target_id = re.sub(r'^(page|p)[_-]?', '', target_id)
                if a_text != clean_target_id:
                    issues.append({
                        "rule_name": "page list text mismatch",
                        "type": "page_list_text_mismatch",
                        "message": f"Page list link text '{a_text}' does not match the target ID '{target_id}' in the href.",
                        "category": "Error",
                        "line_number": getattr(a_tag, "sourceline", None),
                        "extract": str(a_tag)[:100],
                    })
                    
            # Check 4: Target file must exist
            if href:
                import os
                if "#" in href:
                    chapter_file = href.split("#", 1)[0]
                else:
                    chapter_file = href
                    
                file_path = file_details["full_path"]
                current_dir = os.path.dirname(file_path)
                target_file_path = os.path.normpath(os.path.join(current_dir, chapter_file))
                
                if not os.path.exists(target_file_path):
                    issues.append({
                        "rule_name": "Page list missing file",
                        "type": "page_list_missing_file",
                        "message": f"Referenced file '{chapter_file}' does not exist.",
                        "category": "Error",
                        "line_number": getattr(a_tag, "sourceline", None),
                        "extract": href,
                    })
                elif "#" in href:
                    exact_target_id = href.split("#", 1)[1]
                    try:
                        with open(target_file_path, "r", encoding="utf-8") as tf:
                            tf_soup = BeautifulSoup(tf.read(), "html.parser")
                            target_el = tf_soup.find(id=exact_target_id)
                            if not target_el:
                                target_el = tf_soup.find(attrs={"name": exact_target_id})
                            if not target_el:
                                issues.append({
                                    "rule_name": "Page list missing target ID",
                                    "type": "page_list_missing_target_id",
                                    "message": f"Target ID '{exact_target_id}' does not exist in '{chapter_file}'.",
                                    "category": "Error",
                                    "line_number": getattr(a_tag, "sourceline", None),
                                    "extract": href,
                                })
                    except Exception:
                        pass

    return {"issues_count": len(issues), "issues": issues}

@rule("COM-NAV-001")
@rule("COM-NAV-002")
@rule("COM-NAV-003")
def validate_nav_epub_type(file_details, rule_config=None):
    """Validate that the navigation document contains a <nav> element with a specific epub:type."""
    config_dict = (rule_config or {}).get("rule_config", {})
    expected_type = config_dict.get("expected_type")
    
    if not expected_type:
        return {"issues_count": 1, "issues": [{"type": "configuration_error", "message": "Missing expected_type in rule_config.", "category": "Error"}]}
        
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    
    issues = []
    
    # Get all epub:type attributes from <nav> elements
    nav_elements = soup.find_all("nav")
    found_types = set()
    for nav in nav_elements:
        epub_type = nav.get("epub:type")
        if epub_type:
            # epub:type can have multiple values separated by space
            found_types.update(epub_type.split())
            
    if expected_type not in found_types:
        issues.append({
            "type": "missing_nav_epub_type",
            "message": f'Navigation document is missing <nav epub:type="{expected_type}">',
            "category": "Error",
        })
            
    return {"issues_count": len(issues), "issues": issues}


@rule("COM-NCX-001")
def validate_ncx_navpoint(file_details, rule_config=None):
    """Ensure navPoint elements are present and have content src."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f, "xml")
    except Exception as e:
        return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

    navpoints = ncx_soup.find_all("navPoint")
    if not navpoints:
        issues.append({
            "type": "missing_navpoint",
            "message": "No <navPoint> elements found in toc.ncx.",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    for np in navpoints:
        content = np.find("content")
        if not content or not content.get("src"):
            issues.append({
                "type": "invalid_navpoint",
                "message": f"<navPoint id='{np.get('id', '')}'> is missing a valid <content src='...'>.",
                "category": "Error",
                "line_number": getattr(np, "sourceline", None)
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("COM-NCX-002")
def validate_ncx_pagetarget(file_details, rule_config=None):
    """Ensure pageTarget elements exist in toc.ncx pageList."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f, "xml")
    except Exception as e:
        return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

    pagelist = ncx_soup.find("pageList")
    if not pagelist:
        issues.append({
            "type": "missing_pagelist",
            "message": "No <pageList> element found in toc.ncx.",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    pagetargets = pagelist.find_all("pageTarget")
    if not pagetargets:
        issues.append({
            "type": "missing_pagetarget",
            "message": "No <pageTarget> elements found in <pageList>.",
            "category": "Error",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("COM-NCX-003")
def validate_ncx_pdf_page_count(file_details, rule_config=None):
    """Check that dtb:totalPageCount and dtb:maxPageNumber match the PDF page count."""
    from .metadata import _get_pdf_page_count
    file_path = file_details["full_path"]
    issues = []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f, "xml")
    except Exception as e:
        return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

    actual = _get_pdf_page_count(file_details)
    if actual is None:
        return {"issues_count": 1, "issues": [{"type": "pdf_unavailable", "message": "No PDF is available to verify page count.", "category": "Warning"}]}

    for meta_name in ["dtb:totalPageCount", "dtb:maxPageNumber"]:
        meta = ncx_soup.find("meta", {"name": meta_name})
        if not meta:
            issues.append({"type": f"missing_{meta_name.replace(':', '_')}", "message": f"Missing <meta name='{meta_name}'> in toc.ncx.", "category": "Error"})
            continue
            
        declared = meta.get("content")
        try:
            declared_int = int(declared)
            if declared_int != actual:
                issues.append({
                    "type": f"{meta_name.replace(':', '_')}_mismatch",
                    "message": f"toc.ncx {meta_name} declares {declared_int} pages; PDF has {actual}.",
                    "category": "Error",
                    "line_number": getattr(meta, "sourceline", None)
                })
        except (ValueError, TypeError):
            issues.append({"type": "invalid_page_count", "message": f"Invalid {meta_name} value: '{declared}'", "category": "Error", "line_number": getattr(meta, "sourceline", None)})

    return {"issues_count": len(issues), "issues": issues}


@rule("COM-NCX-004")
def validate_ncx_isbn(file_details, rule_config=None):
    """Check that dtb:uid in toc.ncx matches the OPF eISBN."""
    from .copyright import _extract_eisbn
    file_path = file_details["full_path"]
    issues = []
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            ncx_soup = BeautifulSoup(f, "xml")
    except Exception as e:
        return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

    eisbn = _extract_eisbn(file_details["epub_root"])
    if not eisbn:
        return {"issues_count": 1, "issues": [{"type": "eisbn_unknown", "message": "Could not extract eISBN from OPF to check toc.ncx.", "category": "Warning"}]}

    meta = ncx_soup.find("meta", {"name": "dtb:uid"})
    if not meta:
        return {"issues_count": 1, "issues": [{"type": "missing_dtb_uid", "message": "Missing <meta name='dtb:uid'> in toc.ncx.", "category": "Error"}]}

    declared = meta.get("content", "").replace("-", "")
    expected = eisbn.replace("-", "")
    
    if expected not in declared and declared not in expected:
        issues.append({
            "type": "uid_mismatch",
            "message": f"toc.ncx dtb:uid ({declared}) does not match OPF eISBN ({expected}).",
            "category": "Error",
            "line_number": getattr(meta, "sourceline", None)
        })

    return {"issues_count": len(issues), "issues": issues}

@rule("INDEX001")
def validate_index_links(file_details, rule_config=None):
    """Validate that index items contain properly linked anchor tags."""
    import os
    import urllib.parse
    
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    issues = []

    # Find the index element with role="doc-index" or epub:type="index"
    index_nav = soup.find(attrs={"role": "doc-index"}) or soup.find(attrs={"epub:type": "index"})

    if not index_nav:
        # Check if the filename has 'index'
        if "index" not in os.path.basename(file_details["full_path"]).lower():
            return {"issues_count": 0, "issues": []}
        index_nav = soup.find("body") or soup
        
    target_ids_cache = {}

    for a_tag in index_nav.find_all("a"):
        href = a_tag.get("href")
        if not href:
            issues.append({
                "rule_name": "Index link missing href",
                "type": "index_link_missing_href",
                "message": "Index <a> tag is missing an href attribute.",
                "category": "Error",
                "line_number": getattr(a_tag, "sourceline", None),
                "extract": str(a_tag)[:100],
            })
            continue

        a_text = a_tag.get_text(strip=True).lower()
        if "#" in href:
            target_id = href.split("#", 1)[-1].lower()
            import re
            
            clean_target_id = re.sub(r'^(page|p)[_-]?', '', target_id)
            
            # The text inside index link could be something like 147f
            a_text_digits = re.sub(r'\D', '', a_text)
            id_digits = re.sub(r'\D', '', clean_target_id)
            
            if a_text_digits and id_digits and a_text_digits != id_digits:
                issues.append({
                    "rule_name": "Index text mismatch",
                    "type": "index_text_mismatch",
                    "message": f"Index link text '{a_text}' does not match the target ID '{target_id}' in the href.",
                    "category": "Error",
                    "line_number": getattr(a_tag, "sourceline", None),
                    "extract": str(a_tag)[:100],
                })
                
        # Check if the target file exists
        if href:
            if "#" in href:
                chapter_file = href.split("#", 1)[0]
            else:
                chapter_file = href
                
            if chapter_file:
                target_path = os.path.join(os.path.dirname(file_details["full_path"]), chapter_file)
                target_path = urllib.parse.unquote(target_path)
                
                if not os.path.exists(target_path):
                    issues.append({
                        "rule_name": "Index target missing",
                        "type": "index_target_missing",
                        "message": f"Target file '{chapter_file}' does not exist.",
                        "category": "Error",
                        "line_number": getattr(a_tag, "sourceline", None),
                        "extract": str(a_tag)[:100],
                    })
                    continue
                    
                # Check target ID exists
                if "#" in href:
                    target_id = href.split("#", 1)[-1]
                    if target_path not in target_ids_cache:
                        try:
                            target_text = read_text(target_path)
                            target_soup = BeautifulSoup(target_text, "html.parser")
                            target_ids_cache[target_path] = {tag.get("id") for tag in target_soup.find_all(id=True)}
                        except Exception as e:
                            target_ids_cache[target_path] = set()
                            
                    if target_id not in target_ids_cache[target_path]:
                        issues.append({
                            "rule_name": "Index target ID missing",
                            "type": "index_target_id_missing",
                            "message": f"Target ID '{target_id}' does not exist in '{chapter_file}'.",
                            "category": "Error",
                            "line_number": getattr(a_tag, "sourceline", None),
                            "extract": str(a_tag)[:100],
                        })
                        
    return {"issues_count": len(issues), "issues": issues}

@rule("INDEX002")
def validate_index_list_format(file_details, rule_config=None):
    """Validate that index entries use unordered lists."""
    import os
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    issues = []

    # Find the index element
    index_nav = soup.find(attrs={"role": "doc-index"}) or soup.find(attrs={"epub:type": "index"})

    if not index_nav:
        if "index" not in os.path.basename(file_details["full_path"]).lower():
            return {"issues_count": 0, "issues": []}
        index_nav = soup.find("body") or soup

    # Find all p tags inside index_nav with a class containing 'index'
    index_ps = index_nav.find_all("p", class_=lambda x: x and any(c.startswith("index") for c in (x.split() if isinstance(x, str) else x)))
    
    for p in index_ps:
        # Check if it is inside an <li> tag
        if not p.find_parent("li"):
            s = str(p)
            idx = text.find(s[:20])
            if idx == -1:
                text_val = p.get_text(strip=True)
                if text_val:
                    idx = text.find(text_val[:20])
                    
            line = text.count('\n', 0, idx) + 1 if idx != -1 else getattr(p, "sourceline", None)
            
            raw_extract = str(p)[:150]
            if idx != -1:
                tag_start = text.rfind('<p', max(0, idx-100), idx+1)
                if tag_start != -1:
                    raw_extract = text[tag_start:tag_start+150]
                else:
                    raw_extract = text[idx:idx+150]
            
            issue = {
                "type": "invalid_index_format",
                "message": "Index entries should be formatted using unordered list (<ul> and <li>) tags.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": raw_extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-001")
def validate_copyright_last_page(file_details, rule_config=None):
    """
    The copyright page must be placed as the last page of the ePub file.
    Validates that:
    1. In nav.xhtml / nav.html:
       - The last entry in TOC (<nav epub:type="toc"> or role="doc-toc") is the copyright page.
       - The last entry in Page List (<nav epub:type="page-list"> or role="doc-pagelist"), if present, targets the copyright page.
    2. In toc.ncx:
       - The last <navPoint> in <navMap> is the copyright page.
       - The last <pageTarget> in <pageList>, if present, targets the copyright page.
    """
    import os
    import xml.etree.ElementTree as ET

    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    term_map = cfg.get("expected_term_by_language")

    if not term_map or not isinstance(term_map, dict):
        return {
            "issues_count": 1,
            "issues": [{
                "type": "configuration_error",
                "message": "Missing required 'expected_term_by_language' in rule configuration.",
                "category": "Error",
            }]
        }

    # Automatically derive regex patterns from the configured language terms
    configured_terms = list(term_map.values())
    try:
        escaped_terms = [re.escape(t.strip()) for t in configured_terms if t and t.strip()]
        # Allow variations like apostrophe styles or spaces in terms
        term_patterns = []
        for term in configured_terms:
            t = term.strip()
            if not t:
                continue
            # Replace apostrophe with character class [’'] and spaces with \s+
            p = re.escape(t).replace(r"\ ", r"\s+").replace("’", r"[’']").replace("'", r"[’']")
            # Replace hyphen/dash with [\s\-_]?
            p = p.replace(r"\-", r"[\s\-_]?")
            term_patterns.append(p)
        terms_re = re.compile(r"\b(" + "|".join(term_patterns) + r")\b", re.IGNORECASE)
    except Exception as e:
        return {
            "issues_count": 1,
            "issues": [{
                "type": "configuration_error",
                "message": f"Failed to compile copyright terms from configuration: {e}",
                "category": "Error",
            }]
        }

    # Helper regex for copyright file stems derived from configured terms
    stem_keywords = set()
    for term in configured_terms:
        # Extract base words from term (e.g. 'Impressum', 'Copyright', 'Kolofon', 'Imprenta', 'Imprensa')
        for word in re.findall(r"\b\w{4,}\b", term, re.UNICODE):
            if word.lower() not in ("page", "drets", "autor", "side"):
                stem_keywords.add(re.escape(word.lower()))
    stem_keywords.update(["copyright", "impressum", "colophon", "kolofon", "imprenta", "imprensa"])
    copyright_filename_re = re.compile("|".join(stem_keywords), re.IGNORECASE)

    # Regex for forbidden front matter filenames (e.g. half_title, title_page, vortitel)
    forbidden_fm_filename_re = re.compile(
        r"(half[\s\-_]?title|title[\s\-_]?page|vortitel|vor[\s\-_]?titel|schmutztitel|schmutz[\s\-_]?titel|"
        r"titelseite|titel[\s\-_]?seite|titelblatt|titel[\s\-_]?blatt|haupttitel|haupt[\s\-_]?titel)|^title$|^titel$",
        re.IGNORECASE
    )

    def is_copyright_match(label_text, href_or_src):
        target = os.path.basename((href_or_src or "").split("#")[0]).strip()
        # If the target file is a half title or title page file, it is NOT a valid copyright page!
        if target and _is_forbidden_frontmatter_file(target, forbidden_fm_filename_re):
            return False

        lbl = (label_text or "").strip()
        if lbl and terms_re.search(lbl):
            return True
        if target and copyright_filename_re.search(target):
            return True
        return False

    issues = []
    file_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(file_path)
    rel_path = file_details.get("relative_path") or file_name

    text = read_text(file_path)
    if not text.strip():
        return {"issues_count": 0, "issues": []}

    lines = text.splitlines()

    def find_line_in_content(*needles):
        for needle in needles:
            if not needle:
                continue
            needle_clean = str(needle).strip()
            if not needle_clean:
                continue
            for idx, line in enumerate(lines, 1):
                if needle_clean in line:
                    return idx
        return 1

    is_ncx = file_name.lower().endswith(".ncx") or "toc.ncx" in file_name.lower()

    if is_ncx:
        detected_lang = get_book_language(file_details)
        expected_term = term_map.get(detected_lang, term_map.get("en", "Copyright"))

        try:
            # Parse NCX using XML ElementTree
            clean_xml = re.sub(r'xmlns(:\w+)?="[^"]*"', '', text, count=1)
            root = ET.fromstring(clean_xml.encode("utf-8"))
        except Exception:
            try:
                root = ET.fromstring(text.encode("utf-8"))
            except Exception as e:
                return {
                    "issues_count": 1,
                    "issues": [{
                        "type": "ncx_parse_error",
                        "message": f"Could not parse NCX file: {e}",
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": 1,
                    }]
                }

        # Check <navMap>
        nav_map = root.find(".//navMap")
        if nav_map is not None:
            # Find top-level navPoints
            top_navpoints = [elem for elem in nav_map if elem.tag.endswith("navPoint")]
            if top_navpoints:
                last_navpoint = top_navpoints[-1]
                # Extract text and content src
                text_elem = last_navpoint.find(".//navLabel/text")
                last_label = (text_elem.text or "").strip() if text_elem is not None else ""
                content_elem = last_navpoint.find(".//content")
                last_src = content_elem.get("src", "").strip() if content_elem is not None else ""
                np_id = last_navpoint.get("id", "").strip()

                if not is_copyright_match(last_label, last_src):
                    raw_extract = ET.tostring(last_navpoint, encoding="unicode")[:200]
                    line_no = find_line_in_content(np_id, last_src, last_label)
                    target_fn = os.path.basename((last_src or "").split("#")[0]).strip()
                    if target_fn and _is_forbidden_frontmatter_file(target_fn, forbidden_fm_filename_re):
                        reason = f"the last entry targets forbidden front matter file '{target_fn}' instead of a valid {expected_term} page"
                    elif last_label and terms_re.search(last_label):
                        reason = f"the last entry '{last_label}' targets '{last_src}' instead of a valid {expected_term} page"
                    else:
                        reason = f"the last item is '{last_label or last_src}' instead of {expected_term}"

                    issues.append({
                        "type": "copyright_not_last_in_toc_ncx",
                        "message": (
                            f"The copyright page must be placed as the last page of the ePub file. "
                            f"In '{rel_path}' (<navMap>), {reason}."
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": line_no,
                        "snippet": raw_extract,
                        "extract": raw_extract,
                    })

        # Check <pageList>
        page_list = root.find(".//pageList")
        if page_list is not None:
            page_targets = [elem for elem in page_list if elem.tag.endswith("pageTarget")]
            if page_targets:
                last_target = page_targets[-1]
                text_elem = last_target.find(".//navLabel/text")
                last_label = (text_elem.text or "").strip() if text_elem is not None else ""
                content_elem = last_target.find(".//content")
                last_src = content_elem.get("src", "").strip() if content_elem is not None else ""
                target_id = last_target.get("id", "").strip()

                if not is_copyright_match(last_label, last_src):
                    raw_extract = ET.tostring(last_target, encoding="unicode")[:200]
                    line_no = find_line_in_content(target_id, last_src, last_label)
                    issues.append({
                        "type": "copyright_not_last_in_pagelist_ncx",
                        "message": (
                            f"The copyright page must be placed as the last page of the ePub file. "
                            f"In '{rel_path}' (<pageList>), the last page target points to '{last_src or last_label}' instead of the copyright page."
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": line_no,
                        "snippet": raw_extract,
                        "extract": raw_extract,
                    })

    else:
        # nav.xhtml or nav.html
        soup = BeautifulSoup(text, "html.parser")
        detected_lang = get_book_language(file_details, soup=soup)
        expected_term = term_map.get(detected_lang, term_map.get("en", "Copyright"))

        # 1. Check TOC nav
        toc_nav = (
            soup.find("nav", attrs={"epub:type": lambda v: v and "toc" in v.lower().split()})
            or soup.find("nav", attrs={"role": lambda v: v and "doc-toc" in v.lower().split()})
            or soup.find("nav", id="toc")
        )

        if toc_nav:
            # Look at top-level <ol> of TOC
            top_ol = toc_nav.find("ol")
            if top_ol:
                top_lis = [child for child in top_ol.find_all("li", recursive=False)]
                if top_lis:
                    last_li = top_lis[-1]
                    a_tag = last_li.find("a")
                    last_text = a_tag.get_text(strip=True) if a_tag else last_li.get_text(strip=True)
                    last_href = a_tag.get("href", "").strip() if a_tag else ""

                    if not is_copyright_match(last_text, last_href):
                        line_no = (
                            getattr(last_li, "sourceline", None)
                            or (getattr(a_tag, "sourceline", None) if a_tag else None)
                            or find_line_in_content(last_href, last_text)
                        )
                        raw_extract = str(last_li)[:200]
                        target_fn = os.path.basename((last_href or "").split("#")[0]).strip()
                        if target_fn and _is_forbidden_frontmatter_file(target_fn, forbidden_fm_filename_re):
                            reason = f"the last entry targets forbidden front matter file '{target_fn}' instead of a valid {expected_term} page"
                        elif last_text and terms_re.search(last_text):
                            reason = f"the last entry '{last_text}' targets '{last_href}' instead of a valid {expected_term} page"
                        else:
                            reason = f"the last entry is '{last_text or last_href}' instead of {expected_term}"

                        issues.append({
                            "type": "copyright_not_last_in_nav_toc",
                            "message": (
                                f"The copyright page must be placed as the last page of the ePub file. "
                                f"In '{rel_path}' (Table of Contents), {reason}."
                            ),
                            "category": "Error",
                            "file_path": rel_path,
                            "line_number": line_no,
                            "snippet": raw_extract,
                            "extract": raw_extract,
                        })

        # 2. Check Page List nav
        page_list_nav = (
            soup.find("nav", attrs={"epub:type": lambda v: v and "page-list" in v.lower().split()})
            or soup.find("nav", attrs={"role": lambda v: v and "doc-pagelist" in v.lower().split()})
            or soup.find("nav", id="page-list")
        )

        if page_list_nav:
            all_links = page_list_nav.find_all("a")
            if all_links:
                last_a = all_links[-1]
                last_href = last_a.get("href", "").strip()
                last_text = last_a.get_text(strip=True)

                if not is_copyright_match(last_text, last_href):
                    line_no = (
                        getattr(last_a, "sourceline", None)
                        or (getattr(last_a.parent, "sourceline", None) if last_a.parent else None)
                        or find_line_in_content(last_href, last_text)
                    )
                    raw_extract = str(last_a.parent if last_a.parent else last_a)[:200]
                    issues.append({
                        "type": "copyright_not_last_in_nav_pagelist",
                        "message": (
                            f"The copyright page must be placed as the last page of the ePub file. "
                            f"In '{rel_path}' (Page List), the last page entry points to '{last_href or last_text}' instead of the copyright page."
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": line_no,
                        "snippet": raw_extract,
                        "extract": raw_extract,
                    })

    return {"issues_count": len(issues), "issues": issues}

