import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ._common import find_opf, read_text

# Case-insensitive, tolerates "Halftitle", "Half title", "Half-title".
_HALFTITLE_RE = re.compile(r"\bhalf[\s\-]?title\b", re.IGNORECASE)
# Match "and" as a word between two author-name-ish tokens.
_AUTHOR_AND_RE = re.compile(r"\band\b", re.IGNORECASE)


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
            ncx_soup = BeautifulSoup(f, "xml")
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
    for navpoint in ncx_soup.find_all("navPoint"):
        text_tag = navpoint.find("text")
        content_tag = navpoint.find("content")
        title = text_tag.get_text(strip=True) if text_tag else ""
        href = content_tag.get("src", "").strip() if content_tag else ""
        ncx_items.append({
            "title": title,
            "href": href,
            "line_number": getattr(navpoint, "sourceline", None),
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
                "line_number": ncx_item["line_number"],
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
                "line_number": ncx_item["line_number"],
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
                "line_number": ncx_item["line_number"],
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
            })
            continue

        # Skip external URLs
        if href.startswith("http"):
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
            })
            continue

        # Get heading text
        heading_text = current_element.get_text(separator="", strip=True)

        # TEXT MATCH check (case-insensitive)
        if nav_text.lower() != heading_text.lower():
            issues.append({
                "rule_name": "Heading Text Mismatch",
                "type": "heading_text_mismatch",
                "href": href,
                "expected_text": nav_text,
                "actual_text": heading_text,
                "message": "Nav text and heading text mismatch",
                "category": "Error",
                "line_number": line_num,
            })
        # Case-sensitive mismatch
        if nav_text != heading_text:
            issues.append({
                "rule_name": "Heading Case Mismatch",
                "type": "heading_case_mismatch",
                "href": href,
                "expected_text": nav_text,
                "actual_text": heading_text,
                "message": "Case mismatch",
                "category": "Warning",
                "line_number": line_num,
            })

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
                    issues.append({
                        "rule_name": "Nav Hierarchy Mismatch",
                        "type": "hierarchy_mismatch",
                        "href": href,
                        "message": (f'"{heading_text}" heading hierarchy does not match chapter heading level. '
                                   f'Navigation level: h{parent_nav_level} '
                                   f'Chapter heading level: h{heading_level}'),
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
                })

    return {"issues_count": len(issues), "issues": issues}
