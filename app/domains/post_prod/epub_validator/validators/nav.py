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

        # Skip heading check for copyright files configured in rule_config
        import fnmatch
        target_fn_lower = os.path.basename(chapter_file).lower()
        skip_file_patterns = inner_config.get("skip_heading_file_patterns") or []
        if skip_file_patterns and any(fnmatch.fnmatch(target_fn_lower, pat.lower()) for pat in skip_file_patterns):
            continue

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

            # Top-level TOC item (nav_level == 1) should be an h1 heading
            if nav_level == 1 and heading_level > 1:
                issues.append({
                    "rule_name": "Nav Hierarchy Mismatch",
                    "type": "hierarchy_mismatch",
                    "href": href,
                    "message": (f'"{heading_text}" heading hierarchy does not match TOC hierarchy. '
                               f'Top-level TOC entry implies this should be h1, '
                               f'but an h{heading_level} was found in the chapter.'),
                    "category": "Error",
                    "line_number": line_num,
                    "extract": nav_text,
                })

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
                        "extract": nav_text,
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


@rule("BOD-COV-009")
def validate_no_cover_in_toc(file_details, rule_config=None):
    """
    Cover entry must not be included in TOC (both nav.xhtml and toc.ncx),
    although found as a part of the book.
    Config-driven: reads forbidden_titles and forbidden_file_patterns from rule_config.
    """
    import fnmatch
    import os

    file_path = file_details["full_path"]
    rel_path = file_details.get("relative_path") or os.path.basename(file_path)
    file_name = os.path.basename(file_path).lower()
    issues = []

    # Read configuration dynamically
    inner_config = rule_config.get("rule_config", {}) if rule_config else {}
    forbidden_titles = [t.strip().lower() for t in inner_config.get("forbidden_titles", ["Cover"])]
    forbidden_file_patterns = [p.strip().lower() for p in inner_config.get("forbidden_file_patterns", ["*cover*.xhtml", "*cover*.html"])]

    text = read_text(file_path)
    if not text.strip():
        return {"issues_count": 0, "issues": []}

    lines = text.splitlines()

    def find_line_for_snippet(snippet):
        if not snippet:
            return 1
        snip = snippet.strip()
        for idx, line in enumerate(lines, 1):
            if snip in line:
                return idx
        return 1

    def is_forbidden_entry(label, target_href):
        lbl_lower = label.strip().lower()
        if lbl_lower and lbl_lower in forbidden_titles:
            return True
        target_fn = os.path.basename(target_href.split("#")[0]).lower()
        if target_fn and any(fnmatch.fnmatch(target_fn, pat) for pat in forbidden_file_patterns):
            return True
        return False

    is_ncx = file_name.endswith(".ncx")

    if is_ncx:
        # Check toc.ncx <navMap>
        try:
            soup = BeautifulSoup(text, "xml")
        except Exception as e:
            return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

        navmap = soup.find("navMap")
        if not navmap:
            return {"issues_count": 0, "issues": []}

        for np in navmap.find_all("navPoint"):
            text_tag = np.find("text")
            label_text = text_tag.get_text(strip=True) if text_tag else ""
            content_tag = np.find("content")
            src = content_tag.get("src", "").strip() if content_tag else ""

            if is_forbidden_entry(label_text, src):
                np_id = np.get("id", "")
                line_no = (
                    getattr(text_tag, "sourceline", None)
                    or getattr(content_tag, "sourceline", None)
                    or getattr(np, "sourceline", None)
                    or (find_line_for_snippet(label_text) if label_text else 1)
                )
                issues.append({
                    "rule_name": "Cover image entry check",
                    "type": "cover_entry_in_ncx_toc",
                    "message": "Cover image entry should not be included in TOC (both NAV and NCX), although found as a part of the book.",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": line_no,
                    "extract": label_text or src or np_id,
                    "snippet": label_text or src or str(np)[:150],
                })

    else:
        # Check nav.xhtml <nav epub:type="toc"> or <nav role="doc-toc"> or id="toc"
        try:
            soup = BeautifulSoup(text, "html.parser")
        except Exception as e:
            return {"issues_count": 1, "issues": [{"type": "nav_read_error", "message": f"Could not read NAV file: {e}", "category": "Error"}]}

        toc_nav = (
            soup.find("nav", attrs={"epub:type": lambda v: v and "toc" in v.lower()})
            or soup.find("nav", attrs={"role": lambda v: v and "doc-toc" in v.lower()})
            or soup.find("nav", id="toc")
        )
        if not toc_nav:
            return {"issues_count": 0, "issues": []}

        for a in toc_nav.find_all("a"):
            link_text = a.get_text(strip=True)
            href = a.get("href", "").strip()

            if is_forbidden_entry(link_text, href):
                line_no = getattr(a, "sourceline", None) or (getattr(a.parent, "sourceline", None) if a.parent else None) or find_line_for_snippet(link_text or href)
                issues.append({
                    "rule_name": "Cover image entry check",
                    "type": "cover_entry_in_nav_toc",
                    "message": "Cover image entry should not be included in TOC (both NAV and NCX), although found as a part of the book.",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": line_no,
                    "extract": link_text or href,
                    "snippet": link_text or href,
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
    """
    Ensure navPoint elements are present and have content src.
    If max_count is specified in rule_config (e.g. max_navpoints = 100),
    validates that the count of <navPoint> elements does not exceed max_count.
    If not specified, works as usual.
    """
    file_path = file_details["full_path"]
    rel_path = file_details.get("relative_path") or os.path.basename(file_path)
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
            "file_path": rel_path,
        })
        return {"issues_count": len(issues), "issues": issues}

    # Check max navpoints limit if configured
    inner_config = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    max_navpoints = inner_config.get("max_navpoints") or inner_config.get("max_count")
    if max_navpoints is not None:
        try:
            max_limit = int(max_navpoints)
            if len(navpoints) > max_limit:
                first_line = getattr(navpoints[0], "sourceline", 1)
                issues.append({
                    "rule_name": "TOC Entry Count Exceeded",
                    "type": "max_navpoints_exceeded",
                    "message": (
                        f"toc.ncx contains {len(navpoints)} <navPoint> elements, which exceeds the maximum limit of {max_limit}. "
                        "If the title contains more than 100 ToC entries, no ToC needs to be created."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": first_line,
                    "extract": f"{len(navpoints)} navPoints",
                    "snippet": f"Found {len(navpoints)} navPoints (max: {max_limit})",
                })
        except (ValueError, TypeError):
            pass

    for np in navpoints:
        content = np.find("content")
        if not content or not content.get("src"):
            issues.append({
                "type": "invalid_navpoint",
                "message": f"<navPoint id='{np.get('id', '')}'> is missing a valid <content src='...'>.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": getattr(np, "sourceline", None),
                "extract": np.get("id", ""),
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


@rule("COM-NCX-005")
def validate_ncx_pagetarget_links(file_details, rule_config=None):
    """Validate that pageTarget elements in toc.ncx have matching text vs target ID and existing targets."""
    import os
    import re
    from urllib.parse import unquote

    file_path = file_details["full_path"]
    rel_path = file_details.get("relative_path") or os.path.basename(file_path)
    issues = []

    text = read_text(file_path)
    if not text.strip():
        return {"issues_count": 0, "issues": []}

    lines = text.splitlines()

    def find_line_for_target(pt_id, src_val, label_val):
        candidates = []
        if pt_id:
            candidates.append(f'id="{pt_id}"')
            candidates.append(f"id='{pt_id}'")
            candidates.append(pt_id)
        if src_val:
            candidates.append(f'src="{src_val}"')
            candidates.append(f"src='{src_val}'")
            candidates.append(src_val)
        if label_val:
            candidates.append(f"<text>{label_val}</text>")

        for needle in candidates:
            for idx, line in enumerate(lines, 1):
                if needle in line:
                    return idx
        return 1

    try:
        import warnings
        from bs4 import XMLParsedAsHTMLWarning
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
            ncx_soup = BeautifulSoup(text, "html.parser")
    except Exception as e:
        return {"issues_count": 1, "issues": [{"type": "ncx_read_error", "message": f"Could not read NCX file: {e}", "category": "Error"}]}

    pagelist = ncx_soup.find(["pagelist", "pageList"])
    if not pagelist:
        return {"issues_count": 0, "issues": []}

    pagetargets = pagelist.find_all(["pagetarget", "pageTarget"])
    if not pagetargets:
        return {"issues_count": 0, "issues": []}

    current_dir = os.path.dirname(file_path)
    parsed_files_cache = {}

    for pt in pagetargets:
        pt_id = pt.get("id", "")

        # 1. Extract label text
        nav_label = pt.find(["navlabel", "navLabel"])
        text_tag = nav_label.find("text") if nav_label else None
        label_text = text_tag.get_text(strip=True) if text_tag else ""

        # 2. Extract content src
        content_tag = pt.find("content")
        src = content_tag.get("src", "").strip() if content_tag else ""

        line_num = (
            getattr(content_tag, "sourceline", None)
            or getattr(text_tag, "sourceline", None)
            or getattr(pt, "sourceline", None)
            or find_line_for_target(pt_id, src, label_text)
        )

        if not src:
            issues.append({
                "rule_name": "Page Target Missing Content",
                "type": "pagetarget_missing_src",
                "message": f"<pageTarget id='{pt_id}'> is missing a valid <content src='...'>.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": line_num,
                "extract": pt_id or label_text,
                "snippet": str(pt)[:150],
            })
            continue

        # Split file path and anchor ID
        if "#" in src:
            target_file, target_anchor = src.split("#", 1)
        else:
            target_file, target_anchor = src, ""

        # Check 1: Label text vs target anchor mismatch (e.g. text '10' vs 'page_10')
        if target_anchor:
            clean_anchor = re.sub(r'^(page|p)[_-]?', '', target_anchor, flags=re.IGNORECASE)
            if label_text.strip().lower() != clean_anchor.strip().lower():
                text_line = (
                    getattr(text_tag, "sourceline", None)
                    or find_line_for_target(pt_id, f"<text>{label_text}</text>", label_text)
                    or line_num
                )
                issues.append({
                    "rule_name": "Page Target Text Mismatch",
                    "type": "pagetarget_text_mismatch",
                    "src": src,
                    "message": f"Page target text '{label_text}' does not match target ID '{target_anchor}' in content src.",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": text_line,
                    "extract": label_text,
                    "snippet": label_text,
                })

        # Check 2: Target file exists
        target_abs_path = os.path.normpath(os.path.join(current_dir, unquote(target_file)))
        if not os.path.exists(target_abs_path):
            src_line = (
                getattr(content_tag, "sourceline", None)
                or find_line_for_target(pt_id, src, "")
                or line_num
            )
            issues.append({
                "rule_name": "Page Target File Missing",
                "type": "pagetarget_file_missing",
                "src": src,
                "message": f"Referenced file '{target_file}' in pageTarget does not exist.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": src_line,
                "extract": src,
                "snippet": src,
            })
            continue

        # Check 3: Target ID exists inside the target file
        if target_anchor:
            if target_abs_path not in parsed_files_cache:
                try:
                    with open(target_abs_path, "r", encoding="utf-8") as tf:
                        parsed_files_cache[target_abs_path] = BeautifulSoup(tf.read(), "html.parser")
                except Exception as e:
                    src_line = getattr(content_tag, "sourceline", None) or line_num
                    issues.append({
                        "rule_name": "Page Target File Read Error",
                        "type": "pagetarget_file_read_error",
                        "src": src,
                        "message": f"Could not read target file '{target_file}': {e}",
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": src_line,
                        "extract": src,
                        "snippet": src,
                    })
                    continue

            tf_soup = parsed_files_cache[target_abs_path]
            target_el = tf_soup.find(id=target_anchor) or tf_soup.find(attrs={"name": target_anchor})
            if not target_el:
                src_line = (
                    getattr(content_tag, "sourceline", None)
                    or find_line_for_target(pt_id, src, "")
                    or line_num
                )
                issues.append({
                    "rule_name": "Page Target Anchor Missing",
                    "type": "pagetarget_anchor_missing",
                    "src": src,
                    "message": f"Target ID '{target_anchor}' does not exist in '{target_file}'.",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": src_line,
                    "extract": src,
                    "snippet": src,
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

    def is_copyright_match(label_text, href_or_src, require_both=False):
        target = os.path.basename((href_or_src or "").split("#")[0]).strip()
        # If the target file is a half title or title page file, it is NOT a valid copyright page!
        if target and _is_forbidden_frontmatter_file(target, forbidden_fm_filename_re):
            return False

        lbl = (label_text or "").strip()
        label_matches = bool(lbl and terms_re.search(lbl))
        file_matches = bool(target and copyright_filename_re.search(target))

        if require_both:
            # Both the TOC link text and target file must match valid copyright conventions
            return label_matches and file_matches

        return label_matches or file_matches

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
    is_opf = file_name.lower().endswith(".opf")

    if is_opf:
        detected_lang = get_book_language(file_details)
        expected_term = term_map.get(detected_lang, term_map.get("en", "Copyright"))

        soup = BeautifulSoup(text, "xml")
        manifest = soup.find("manifest")
        spine = soup.find("spine")

        # Map item id -> href and media-type
        manifest_items = {}
        if manifest:
            for item in manifest.find_all("item"):
                item_id = item.get("id", "").strip()
                item_href = item.get("href", "").strip()
                if item_id:
                    manifest_items[item_id] = item_href

        if spine:
            itemrefs = spine.find_all("itemref")
            if itemrefs:
                last_itemref = itemrefs[-1]
                last_idref = last_itemref.get("idref", "").strip()
                last_href = manifest_items.get(last_idref, "")

                if not is_copyright_match("", last_href):
                    # Search specifically for the itemref tag in the spine to pinpoint the exact spine line (e.g. <itemref idref="nav_23"/>)
                    # rather than the manifest item declaration
                    exact_itemref_pattern = f'<itemref[^>]*idref=["\']{re.escape(last_idref)}["\']'
                    line_no = getattr(last_itemref, "sourceline", None)
                    if not line_no:
                        for idx, line in enumerate(lines, 1):
                            if re.search(exact_itemref_pattern, line):
                                line_no = idx
                                break
                    if not line_no:
                        line_no = find_line_in_content(last_idref, str(last_itemref))

                    raw_extract = str(last_itemref)[:200]
                    target_fn = os.path.basename((last_href or "").split("#")[0]).strip()

                    # Find where the copyright/impressum item is in manifest and spine (e.g. nav_02 -> B_impressum.xhtml)
                    impressum_idref = None
                    impressum_fn = None
                    for mid, mhref in manifest_items.items():
                        if is_copyright_match("", mhref):
                            impressum_idref = mid
                            impressum_fn = os.path.basename((mhref or "").split("#")[0]).strip()
                            break

                    impressum_itemref_tag = None
                    impressum_line_no = None
                    if impressum_idref:
                        # Find the actual <itemref idref="..."> element in spine
                        for ir in itemrefs:
                            if ir.get("idref", "").strip() == impressum_idref:
                                impressum_itemref_tag = ir
                                break

                        exact_impressum_pattern = f'<itemref[^>]*idref=["\']{re.escape(impressum_idref)}["\']'
                        for idx, line in enumerate(lines, 1):
                            if re.search(exact_impressum_pattern, line):
                                impressum_line_no = idx
                                break

                    # If the copyright/impressum item is found in the spine, highlight it directly
                    if impressum_itemref_tag is not None:
                        line_no = impressum_line_no or getattr(impressum_itemref_tag, "sourceline", None) or line_no
                        raw_extract = str(impressum_itemref_tag)[:200]
                    elif impressum_idref:
                        if impressum_line_no:
                            line_no = impressum_line_no
                        raw_extract = f'<itemref idref="{impressum_idref}"/>'

                    impressum_hint = ""
                    if impressum_idref:
                        impressum_hint = f" The copyright/impressum entry (<itemref idref=\"{impressum_idref}\"/> targeting '{impressum_fn or expected_term}') must be moved to the end of <spine>."

                    if target_fn and _is_forbidden_frontmatter_file(target_fn, forbidden_fm_filename_re):
                        reason = f"the last <itemref> in <spine> targets forbidden front matter file '{target_fn}' instead of a valid {expected_term} page.{impressum_hint}"
                    elif target_fn:
                        reason = f"the last <itemref idref=\"{last_idref}\"> targets '{target_fn}' instead of a valid {expected_term} page.{impressum_hint}"
                    else:
                        reason = f"the last <itemref idref=\"{last_idref}\"> does not point to a valid {expected_term} page.{impressum_hint}"

                    issues.append({
                        "type": "copyright_not_last_in_opf_spine",
                        "message": (
                            f"The copyright page must be placed as the last page of the ePub file. "
                            f"In '{rel_path}' (<spine>), {reason}"
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": line_no,
                        "snippet": raw_extract,
                        "extract": raw_extract,
                    })

    elif is_ncx:
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

                if not is_copyright_match(last_label, last_src, require_both=True):
                    raw_extract = ET.tostring(last_navpoint, encoding="unicode")[:200]
                    line_no = find_line_in_content(np_id, last_src, last_label)
                    target_fn = os.path.basename((last_src or "").split("#")[0]).strip()
                    lbl_ok = bool(last_label and terms_re.search(last_label))
                    fn_ok = bool(target_fn and copyright_filename_re.search(target_fn))

                    if target_fn and _is_forbidden_frontmatter_file(target_fn, forbidden_fm_filename_re):
                        reason = f"the last entry targets forbidden front matter file '{target_fn}' instead of a valid {expected_term} page"
                    elif fn_ok and not lbl_ok:
                        reason = f"the last entry title '{last_label}' does not match expected term '{expected_term}'"
                    elif lbl_ok and not fn_ok:
                        reason = f"the last entry targets '{last_src}' instead of a valid {expected_term} page"
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

                    if not is_copyright_match(last_text, last_href, require_both=True):
                        line_no = (
                            getattr(last_li, "sourceline", None)
                            or (getattr(a_tag, "sourceline", None) if a_tag else None)
                            or find_line_in_content(last_href, last_text)
                        )
                        raw_extract = str(last_li)[:200]
                        target_fn = os.path.basename((last_href or "").split("#")[0]).strip()
                        lbl_ok = bool(last_text and terms_re.search(last_text))
                        fn_ok = bool(target_fn and copyright_filename_re.search(target_fn))

                        if target_fn and _is_forbidden_frontmatter_file(target_fn, forbidden_fm_filename_re):
                            reason = f"the last entry targets forbidden front matter file '{target_fn}' instead of a valid {expected_term} page"
                        elif fn_ok and not lbl_ok:
                            reason = f"the last entry title '{last_text}' does not match expected term '{expected_term}'"
                        elif lbl_ok and not fn_ok:
                            reason = f"the last entry targets '{last_href}' instead of a valid {expected_term} page"
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


@rule("BOD-LM-001")
def validate_bod_landmarks(file_details, rule_config=None):
    """
    BOD Landmark Validation:
    Validates <nav epub:type="landmarks"> in nav.xhtml.
    Must contain 3 ordered landmark items:
    1. epub:type="cover" href pointing to cover file (e.g. *cover*.xhtml) and title 'Cover'
    2. epub:type="toc" href pointing to TOC file and title based on book language
    3. epub:type="bodymatter" href pointing to first bodymatter chapter (e.g. 01_*.xhtml) and title (e.g. 'Textbeginn' / 'Start of Text')
    """
    import os
    import re
    from bs4 import BeautifulSoup
    from ._common import get_book_language

    file_path = file_details.get("full_path") or ""
    if not file_path or not os.path.isfile(file_path):
        return {"issues_count": 0, "issues": []}

    fn = os.path.basename(file_path).lower()
    if fn not in ("nav.xhtml", "nav.html"):
        return {"issues_count": 0, "issues": []}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"issues_count": 0, "issues": []}

    soup = BeautifulSoup(content, "html.parser")
    epub_root = file_details.get("epub_root") or file_details.get("epub_path") or os.path.dirname(os.path.dirname(file_path))
    rel_path = file_details.get("file_path") or os.path.basename(file_path)

    # Helper to find line numbers
    lines = content.splitlines()

    def find_tag_line(tag):
        line = getattr(tag, "sourceline", None)
        if line:
            return line
        tag_str = str(tag)
        opening = tag_str.split(">")[0] + ">" if ">" in tag_str else tag_str[:50]
        for idx, l in enumerate(lines, 1):
            if opening[:40] in l:
                return idx
        return 1

    # Locate landmarks nav: <nav epub:type="landmarks">
    landmarks_nav = soup.find(
        lambda t: t.name == "nav" and "landmarks" in (t.get("epub:type") or "").lower()
    )

    issues = []

    if not landmarks_nav:
        issues.append({
            "type": "landmarks_nav_missing",
            "message": 'Landmarks navigation (<nav epub:type="landmarks">) is missing in navigation document.',
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": '<nav epub:type="landmarks">',
            "extract": '<nav epub:type="landmarks">',
        })
        return {"issues_count": len(issues), "issues": issues}

    # Extract all landmark items <a> inside <nav epub:type="landmarks">
    landmark_links = landmarks_nav.find_all("a")

    if not landmark_links:
        line_no = find_tag_line(landmarks_nav)
        issues.append({
            "type": "landmarks_empty",
            "message": 'Landmarks navigation (<nav epub:type="landmarks">) contains no landmark entries.',
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_no,
            "snippet": str(landmarks_nav)[:200],
            "extract": str(landmarks_nav)[:200],
        })
        return {"issues_count": len(issues), "issues": issues}

    # Read configuration
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}

    toc_titles_map = cfg.get("toc_titles_by_language")
    if not toc_titles_map or not isinstance(toc_titles_map, dict):
        return {
            "issues_count": 1,
            "issues": [{
                "rule_name": "Check landmark navigation in nav.xhtml",
                "type": "configuration_error",
                "message": "Missing required 'toc_titles_by_language' in rule configuration for BOD-LM-001.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": 1,
            }]
        }

    detected_lang = get_book_language(file_details, soup=soup)
    norm_lang = (detected_lang or "en").lower()
    # Normalize 2-letter prefix
    if "-" in norm_lang:
        norm_lang = norm_lang.split("-")[0]
    elif "_" in norm_lang:
        norm_lang = norm_lang.split("_")[0]

    # Resolve expected TOC title and allowed variants for this language from config
    allowed_toc_titles = toc_titles_map.get(norm_lang) or toc_titles_map.get("en")
    if not allowed_toc_titles:
        # Fallback to first configured language list in config if language code not directly matched
        allowed_toc_titles = list(toc_titles_map.values())[0] if toc_titles_map else []
    if isinstance(allowed_toc_titles, str):
        allowed_toc_titles = [allowed_toc_titles]
    allowed_toc_lower = {t.lower().replace(" ", "") for t in allowed_toc_titles}
    expected_toc_title = allowed_toc_titles[0]

    # Resolve expected Bodymatter title from config if provided
    bm_titles_map = cfg.get("bodymatter_titles_by_language") or {}
    allowed_bm_titles = bm_titles_map.get(norm_lang) or bm_titles_map.get("en") or []
    if isinstance(allowed_bm_titles, str):
        allowed_bm_titles = [allowed_bm_titles]
    allowed_bm_lower = {t.lower().replace(" ", "") for t in allowed_bm_titles}
    expected_bm_title = allowed_bm_titles[0] if allowed_bm_titles else ""

    # Find the actual landmarks by epub:type
    cover_item = None
    toc_item = None
    bodymatter_item = None

    for link in landmark_links:
        raw_type = (link.get("epub:type") or "").strip().lower()
        types = set(raw_type.split())
        if "cover" in types and not cover_item:
            cover_item = link
        elif "toc" in types and not toc_item:
            toc_item = link
        elif ("bodymatter" in types or "ibooks:reader-start-page" in types) and not bodymatter_item:
            bodymatter_item = link

    # Helper to resolve target file path
    nav_dir = os.path.dirname(file_path)

    def resolve_target_file(href_val: str) -> str:
        if not href_val:
            return ""
        clean_href = href_val.split("#")[0].strip()
        if not clean_href:
            return ""
        # 1. Direct relative to nav.xhtml directory
        target_abs = os.path.normpath(os.path.join(nav_dir, clean_href))
        if os.path.isfile(target_abs):
            return target_abs

        # 2. Check if clean_href without subfolder or with 'xhtml' subfolder exists
        target_in_xhtml = os.path.normpath(os.path.join(nav_dir, "xhtml", os.path.basename(clean_href)))
        if os.path.isfile(target_in_xhtml):
            return target_in_xhtml

        # 3. Check directly in nav_dir by basename
        target_in_nav_dir = os.path.normpath(os.path.join(nav_dir, os.path.basename(clean_href)))
        if os.path.isfile(target_in_nav_dir):
            return target_in_nav_dir

        # 4. Search under epub_root
        if epub_root and os.path.isdir(epub_root):
            bn = os.path.basename(clean_href).lower()
            for r, _d, files in os.walk(epub_root):
                for f in files:
                    if f.lower() == bn:
                        return os.path.join(r, f)

        return target_abs

    # 1. Validate First Item: epub:type="cover"
    if not cover_item:
        first_li = landmark_links[0] if landmark_links else landmarks_nav
        line_no = find_tag_line(first_li)
        raw_extract = str(first_li.parent if getattr(first_li, "parent", None) and first_li.parent.name == "li" else first_li)[:200]
        issues.append({
            "type": "landmarks_cover_missing",
            "message": 'Landmarks navigation is missing the required "cover" landmark (<li><a epub:type="cover" href="...">Cover</a></li>).',
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_no,
            "snippet": raw_extract,
            "extract": raw_extract,
        })
    else:
        cov_href = (cover_item.get("href") or "").strip()
        cov_title = cover_item.get_text(strip=True)
        cov_li = cover_item.parent if getattr(cover_item, "parent", None) and cover_item.parent.name == "li" else cover_item
        cov_line = find_tag_line(cov_li)
        cov_extract = str(cov_li)[:200]
        cov_target_fn = os.path.basename(cov_href.split("#")[0]).lower()

        # Check title
        if cov_title.lower() != "cover":
            issues.append({
                "type": "landmarks_cover_title_mismatch",
                "message": f'Landmarks cover title should be "Cover", but found "{cov_title}".',
                "category": "Error",
                "file_path": rel_path,
                "line_number": cov_line,
                "snippet": cov_extract,
                "extract": cov_extract,
            })

        # Check href points to cover file (e.g. A_Cover*.xhtml or cover.xhtml)
        if not cov_href:
            issues.append({
                "type": "landmarks_cover_href_empty",
                "message": 'Landmarks cover item has an empty href.',
                "category": "Error",
                "file_path": rel_path,
                "line_number": cov_line,
                "snippet": cov_extract,
                "extract": cov_extract,
            })
        else:
            stem, _ = os.path.splitext(cov_target_fn)
            # Must match A_Cover*.xhtml (or cover.xhtml)
            is_valid_cover_fn = bool(re.search(r'(^|/)a_cover', stem, re.IGNORECASE) or stem == "cover")
            if not is_valid_cover_fn:
                issues.append({
                    "type": "landmarks_cover_href_mismatch",
                    "message": f'Landmarks cover href should point to cover file ("A_Cover*.xhtml" or "cover.xhtml"), but points to "{cov_href}".',
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": cov_line,
                    "snippet": cov_extract,
                    "extract": cov_extract,
                })
            else:
                # Check that the cover file actually exists on disk
                target_cov_abs = resolve_target_file(cov_href)
                if not (target_cov_abs and os.path.isfile(target_cov_abs)):
                    issues.append({
                        "type": "landmarks_cover_file_not_found",
                        "message": f'Cover file "{cov_href}" referenced in landmarks does not exist in the EPUB.',
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": cov_line,
                        "snippet": cov_href,
                        "extract": cov_href,
                    })

    # 2. Validate Second Item: epub:type="toc"
    if not toc_item:
        second_li = landmark_links[1] if len(landmark_links) > 1 else (landmark_links[0] if landmark_links else landmarks_nav)
        line_no = find_tag_line(second_li)
        raw_extract = str(second_li.parent if getattr(second_li, "parent", None) and second_li.parent.name == "li" else second_li)[:200]
        issues.append({
            "type": "landmarks_toc_missing",
            "message": f'Landmarks navigation is missing the required "toc" landmark (<li><a epub:type="toc" href="...">...</a></li>).',
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_no,
            "snippet": raw_extract,
            "extract": raw_extract,
        })
    else:
        toc_href = (toc_item.get("href") or "").strip()
        toc_title = toc_item.get_text(strip=True)
        toc_li = toc_item.parent if getattr(toc_item, "parent", None) and toc_item.parent.name == "li" else toc_item
        toc_line = find_tag_line(toc_li)
        toc_extract = str(toc_li)[:200]
        toc_target_fn = os.path.basename(toc_href.split("#")[0]).lower()

        # Check title based on language
        toc_title_clean = toc_title.lower().replace(" ", "")
        if toc_title_clean not in allowed_toc_lower:
            issues.append({
                "type": "landmarks_toc_title_mismatch",
                "message": (
                    f'Landmarks TOC title for language "{norm_lang}" should be "{expected_toc_title}" '
                    f'(allowed: {", ".join(allowed_toc_titles)}), but found "{toc_title}".'
                ),
                "category": "Error",
                "file_path": rel_path,
                "line_number": toc_line,
                "snippet": toc_extract,
                "extract": toc_extract,
            })

        # Check href points to TOC file (nav.xhtml, toc.xhtml, inhalt.xhtml, etc.)
        if not toc_href:
            issues.append({
                "type": "landmarks_toc_href_empty",
                "message": 'Landmarks TOC item has an empty href.',
                "category": "Error",
                "file_path": rel_path,
                "line_number": toc_line,
                "snippet": toc_extract,
                "extract": toc_extract,
            })
        else:
            stem, _ = os.path.splitext(toc_target_fn)
            is_toc_file = bool(re.search(r'(toc|nav|inhalt|sommaire|contents|inhaltsverzeichnis|indice|indholdsforteg|innehall|sisallys|inhoud|sommario|sumario)', stem, re.IGNORECASE))
            if not is_toc_file:
                issues.append({
                    "type": "landmarks_toc_href_mismatch",
                    "message": f'Landmarks TOC href should point to the table of contents file (e.g. "nav.xhtml", "D_inhalt.xhtml"), but points to "{toc_href}".',
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": toc_line,
                    "snippet": toc_extract,
                    "extract": toc_extract,
                })
            else:
                # Check that the TOC file actually exists on disk
                target_toc_abs = resolve_target_file(toc_href)
                if not (target_toc_abs and os.path.isfile(target_toc_abs)):
                    issues.append({
                        "type": "landmarks_toc_file_not_found",
                        "message": f'TOC file "{toc_href}" referenced in landmarks does not exist in the EPUB.',
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": toc_line,
                        "snippet": toc_href,
                        "extract": toc_href,
                    })

    # 3. Validate Third Item: epub:type="bodymatter"
    if not bodymatter_item:
        third_li = landmark_links[2] if len(landmark_links) > 2 else (landmark_links[-1] if landmark_links else landmarks_nav)
        line_no = find_tag_line(third_li)
        raw_extract = str(third_li.parent if getattr(third_li, "parent", None) and third_li.parent.name == "li" else third_li)[:200]
        issues.append({
            "type": "landmarks_bodymatter_missing",
            "message": f'Landmarks navigation is missing the required "bodymatter" landmark (<li><a epub:type="bodymatter" href="...">...</a></li>).',
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_no,
            "snippet": raw_extract,
            "extract": raw_extract,
        })
    else:
        bm_href = (bodymatter_item.get("href") or "").strip()
        bm_title = bodymatter_item.get_text(strip=True)
        bm_li = bodymatter_item.parent if getattr(bodymatter_item, "parent", None) and bodymatter_item.parent.name == "li" else bodymatter_item
        bm_line = find_tag_line(bm_li)
        bm_extract = str(bm_li)[:200]
        bm_target_fn = os.path.basename(bm_href.split("#")[0]).lower()

        # Check href points to first chapter file (01 start file)
        if not bm_href:
            issues.append({
                "type": "landmarks_bodymatter_href_empty",
                "message": 'Landmarks bodymatter item has an empty href.',
                "category": "Error",
                "file_path": rel_path,
                "line_number": bm_line,
                "snippet": bm_extract,
                "extract": bm_extract,
            })
        else:
            stem, _ = os.path.splitext(bm_target_fn)
            is_01_file = bool(re.search(r'(^|/)(01_|01[\s\-_]|ch(apter)?0?1[\s\-_]?|c0?1[\s\-_]?|part0?1[\s\-_]?|kapitel0?1[\s\-_]?)', stem, re.IGNORECASE) or stem.startswith("01") or stem.endswith("01"))
            if not is_01_file:
                issues.append({
                    "type": "landmarks_bodymatter_href_not_01",
                    "message": f'Landmarks bodymatter href should point to the first bodymatter chapter file (e.g. starting with "01_"), but points to "{bm_href}".',
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": bm_line,
                    "snippet": bm_extract,
                    "extract": bm_extract,
                })
            else:
                # Check that the 01 bodymatter chapter file actually exists on disk
                target_bm_abs = resolve_target_file(bm_href)
                if not (target_bm_abs and os.path.isfile(target_bm_abs)):
                    issues.append({
                        "type": "landmarks_bodymatter_file_not_found",
                        "message": f'First bodymatter chapter file "{bm_href}" referenced in landmarks does not exist in the EPUB.',
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": bm_line,
                        "snippet": bm_href,
                        "extract": bm_href,
                    })

        # Check that title is non-empty and matches language-specific title if configured
        if not bm_title:
            issues.append({
                "type": "landmarks_bodymatter_title_empty",
                "message": 'Landmarks bodymatter item has empty title text.',
                "category": "Error",
                "file_path": rel_path,
                "line_number": bm_line,
                "snippet": bm_extract,
                "extract": bm_extract,
            })
        elif allowed_bm_lower:
            bm_title_clean = bm_title.lower().replace(" ", "")
            if bm_title_clean not in allowed_bm_lower:
                issues.append({
                    "type": "landmarks_bodymatter_title_mismatch",
                    "message": (
                        f'Landmarks bodymatter title for language "{norm_lang}" should be "{expected_bm_title}" '
                        f'(allowed: {", ".join(allowed_bm_titles)}), but found "{bm_title}".'
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": bm_line,
                    "snippet": bm_extract,
                    "extract": bm_extract,
                })

    # Check order if all three items are present: cover -> toc -> bodymatter
    if cover_item and toc_item and bodymatter_item:
        links_order = [l for l in landmark_links if l in (cover_item, toc_item, bodymatter_item)]
        if len(links_order) >= 3:
            expected_order = [cover_item, toc_item, bodymatter_item]
            if links_order[:3] != expected_order:
                issues.append({
                    "type": "landmarks_order_invalid",
                    "message": 'Landmarks order is invalid. Expected order: 1. Cover (epub:type="cover"), 2. TOC (epub:type="toc"), 3. Bodymatter (epub:type="bodymatter").',
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": find_tag_line(landmarks_nav),
                    "snippet": str(landmarks_nav)[:200],
                    "extract": str(landmarks_nav)[:200],
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-FM-002")
def validate_standard_toc_frontmatter_order(file_details, rule_config=None):
    """
    Standard ToC format should be followed for the front matter.
    ToC is always frontmatter, which means it must appear before the chapters (bodymatter) in the reading order.

    Validates:
    1. In OPF (<spine>):
       The Table of Contents entry (itemref) must appear before the first chapter (e.g., 01_*.xhtml or configured chapter patterns).
    2. In NAV (nav.xhtml <nav epub:type="toc">) / NCX (toc.ncx <navMap>):
       If both TOC and chapters appear, the TOC entry must appear before the first chapter.
    """
    import os
    import fnmatch
    import xml.etree.ElementTree as ET

    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}

    toc_file_patterns = cfg.get("toc_file_patterns")
    first_chapter_patterns = cfg.get("first_chapter_patterns")

    if not toc_file_patterns or not first_chapter_patterns:
        return {"issues_count": 0, "issues": []}

    issues = []
    file_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(file_path)
    rel_path = file_details.get("relative_path") or file_name

    text = read_text(file_path)
    if not text.strip():
        return {"issues_count": 0, "issues": []}

    lines = text.splitlines()

    def matches_any_pattern(filename, patterns):
        fn_lower = os.path.basename(filename).lower().split("#")[0]
        for pat in patterns:
            if fnmatch.fnmatch(fn_lower, pat.lower()):
                return True
        return False

    is_opf = file_name.lower().endswith(".opf")
    is_ncx = file_name.lower().endswith(".ncx") or "toc.ncx" in file_name.lower()
    is_nav = ("nav" in file_name.lower()) and (file_name.lower().endswith(".xhtml") or file_name.lower().endswith(".html"))

    if is_opf:
        soup = BeautifulSoup(text, "xml")
        manifest = soup.find("manifest")
        spine = soup.find("spine")

        # Map item id -> href and media-type
        manifest_items = {}
        if manifest:
            for item in manifest.find_all("item"):
                item_id = item.get("id", "").strip()
                item_href = item.get("href", "").strip()
                if item_id:
                    manifest_items[item_id] = item_href

        if spine:
            itemrefs = spine.find_all("itemref")
            first_chapter_idx = None
            first_chapter_idref = None
            first_chapter_href = None
            first_chapter_tag = None

            toc_entries = []  # list of (idx, idref, href, tag)

            for idx, ir in enumerate(itemrefs):
                idref = ir.get("idref", "").strip()
                href = manifest_items.get(idref, "")
                target_base = os.path.basename((href or "").split("#")[0])

                if matches_any_pattern(target_base, first_chapter_patterns):
                    if first_chapter_idx is None:
                        first_chapter_idx = idx
                        first_chapter_idref = idref
                        first_chapter_href = href
                        first_chapter_tag = ir

                if matches_any_pattern(target_base, toc_file_patterns):
                    toc_entries.append((idx, idref, href, ir))

            if first_chapter_idx is not None:
                if not toc_entries:
                    # TOC is missing from spine or not placed before chapters
                    # Check if a TOC file exists in manifest
                    toc_in_manifest = None
                    for mid, mhref in manifest_items.items():
                        if matches_any_pattern(mhref, toc_file_patterns):
                            toc_in_manifest = (mid, mhref)
                            break

                    line_no = getattr(first_chapter_tag, "sourceline", None)
                    if not line_no:
                        exact_ir_pattern = f'<itemref[^>]*idref=["\']{re.escape(first_chapter_idref)}["\']'
                        for l_idx, line in enumerate(lines, 1):
                            if re.search(exact_ir_pattern, line):
                                line_no = l_idx
                                break
                    if not line_no:
                        line_no = 1

                    raw_extract = str(first_chapter_tag)[:200] if first_chapter_tag is not None else ""
                    msg = (
                        f"Standard ToC format should be followed for the front matter. "
                        f"Table of Contents is frontmatter and must be placed before the chapters (chapter start: '{os.path.basename(first_chapter_href or '')}'). "
                    )
                    if toc_in_manifest:
                        msg += f"The TOC file '{os.path.basename(toc_in_manifest[1])}' is declared in the manifest but missing from <spine> before the first chapter."
                    else:
                        msg += "No Table of Contents entry found in <spine> before the first chapter."

                    issues.append({
                        "type": "toc_missing_before_chapters",
                        "message": msg,
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": line_no,
                        "snippet": raw_extract,
                        "extract": raw_extract,
                    })
                else:
                    # Check if any TOC entry appears AFTER the first chapter
                    for t_idx, t_idref, t_href, t_tag in toc_entries:
                        if t_idx > first_chapter_idx:
                            line_no = getattr(t_tag, "sourceline", None)
                            if not line_no:
                                exact_ir_pattern = f'<itemref[^>]*idref=["\']{re.escape(t_idref)}["\']'
                                for l_idx, line in enumerate(lines, 1):
                                    if re.search(exact_ir_pattern, line):
                                        line_no = l_idx
                                        break
                            if not line_no:
                                line_no = 1

                            raw_extract = str(t_tag)[:200]
                            issues.append({
                                "type": "toc_placed_after_chapters",
                                "message": (
                                    f"Standard ToC format should be followed for the front matter. "
                                    f"Table of Contents is frontmatter and must be placed before the chapters. "
                                    f"TOC entry '{os.path.basename(t_href)}' (<itemref idref=\"{t_idref}\"/>) "
                                    f"appears after the first chapter '{os.path.basename(first_chapter_href)}' (<itemref idref=\"{first_chapter_idref}\"/>) in <spine>."
                                ),
                                "category": "Error",
                                "file_path": rel_path,
                                "line_number": line_no,
                                "snippet": raw_extract,
                                "extract": raw_extract,
                            })

    elif is_ncx:
        try:
            clean_xml = re.sub(r'xmlns(:\w+)?="[^"]*"', '', text, count=1)
            root = ET.fromstring(clean_xml.encode("utf-8"))
        except Exception:
            try:
                root = ET.fromstring(text.encode("utf-8"))
            except Exception:
                return {"issues_count": 0, "issues": []}

        nav_map = root.find(".//navMap")
        if nav_map is not None:
            top_navpoints = [elem for elem in nav_map if elem.tag.endswith("navPoint")]
            first_ch_idx = None
            first_ch_src = None
            first_ch_np = None
            toc_entries = []

            for idx, np in enumerate(top_navpoints):
                content_elem = np.find(".//content")
                src = content_elem.get("src", "").strip() if content_elem is not None else ""
                target_base = os.path.basename(src.split("#")[0])

                if matches_any_pattern(target_base, first_chapter_patterns):
                    if first_ch_idx is None:
                        first_ch_idx = idx
                        first_ch_src = src
                        first_ch_np = np

                if matches_any_pattern(target_base, toc_file_patterns):
                    toc_entries.append((idx, src, np))

            if first_ch_idx is not None and toc_entries:
                for t_idx, t_src, t_np in toc_entries:
                    if t_idx > first_ch_idx:
                        np_id = t_np.get("id", "").strip()
                        raw_extract = ET.tostring(t_np, encoding="unicode")[:200]
                        line_no = 1
                        for l_idx, line in enumerate(lines, 1):
                            if (np_id and np_id in line) or (t_src and t_src in line):
                                line_no = l_idx
                                break
                        issues.append({
                            "type": "toc_placed_after_chapters_ncx",
                            "message": (
                                f"Standard ToC format should be followed for the front matter. "
                                f"Table of Contents is frontmatter and must be placed before the chapters. "
                                f"TOC entry '{os.path.basename(t_src)}' appears after the first chapter '{os.path.basename(first_ch_src)}' in <navMap>."
                            ),
                            "category": "Error",
                            "file_path": rel_path,
                            "line_number": line_no,
                            "snippet": raw_extract,
                            "extract": raw_extract,
                        })

    elif is_nav:
        soup = BeautifulSoup(text, "html.parser")
        toc_nav = (
            soup.find("nav", attrs={"epub:type": lambda v: v and "toc" in v.lower().split()})
            or soup.find("nav", attrs={"role": lambda v: v and "doc-toc" in v.lower().split()})
            or soup.find("nav", id="toc")
        )
        if toc_nav:
            top_ol = toc_nav.find("ol")
            if top_ol:
                top_lis = [child for child in top_ol.find_all("li", recursive=False)]
                first_ch_idx = None
                first_ch_href = None
                first_ch_li = None
                toc_entries = []

                for idx, li in enumerate(top_lis):
                    a_tag = li.find("a")
                    href = a_tag.get("href", "").strip() if a_tag else ""
                    target_base = os.path.basename(href.split("#")[0])

                    if matches_any_pattern(target_base, first_chapter_patterns):
                        if first_ch_idx is None:
                            first_ch_idx = idx
                            first_ch_href = href
                            first_ch_li = li

                    if matches_any_pattern(target_base, toc_file_patterns):
                        toc_entries.append((idx, href, li))

                if first_ch_idx is not None and toc_entries:
                    for t_idx, t_href, t_li in toc_entries:
                        if t_idx > first_ch_idx:
                            line_no = getattr(t_li, "sourceline", None)
                            if not line_no:
                                for l_idx, line in enumerate(lines, 1):
                                    if t_href and t_href in line:
                                        line_no = l_idx
                                        break
                            if not line_no:
                                line_no = 1
                            raw_extract = str(t_li)[:200]
                            issues.append({
                                "type": "toc_placed_after_chapters_nav",
                                "message": (
                                    f"Standard ToC format should be followed for the front matter. "
                                    f"Table of Contents is frontmatter and must be placed before the chapters. "
                                    f"TOC entry '{os.path.basename(t_href)}' appears after the first chapter '{os.path.basename(first_ch_href)}' in TOC navigation list."
                                ),
                                "category": "Error",
                                "file_path": rel_path,
                                "line_number": line_no,
                                "snippet": raw_extract,
                                "extract": raw_extract,
                            })

    return {"issues_count": len(issues), "issues": issues}


