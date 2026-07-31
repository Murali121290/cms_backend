import os

from bs4 import BeautifulSoup

from ...engine.registry import rule
from ...services import book_bundle_service as _bundle
from ._common import _cli_issue_to_web, _drop_pass_issues, get_nav_level


@rule("NAV001")
def validate_nav_headings(file_details):
    file_path = file_details["full_path"]
    issues = []
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    nav = soup.find("nav", id="toc")
    if not nav:
        issues.append({
            "rule_name": "Missing TOC Nav",
            "type": "missing_nav",
            "message": "TOC nav not found",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    nav_heading_map = {}
    nav_links = nav.find_all("a", href=True)
    for link in nav_links:
        href = link["href"].strip()
        nav_text = " ".join(link.get_text(strip=True).split())
        nav_level = get_nav_level(link)

        if "#" in href:
            chapter_file, target_id = href.split("#", 1)
        else:
            chapter_file = href
            target_id = None
        current_dir = os.path.dirname(file_path)
        target_file_path = os.path.normpath(os.path.join(current_dir, chapter_file))

        if not os.path.exists(target_file_path):
            issues.append({
                "rule_name": "Missing Referenced File",
                "type": "missing_file",
                "href": href,
                "message": "Referenced file not found",
                "category": "Error",
            })
            continue

        with open(target_file_path, "r", encoding="utf-8") as chapter:
            chapter_soup = BeautifulSoup(chapter.read(), "html.parser")

        if target_id:
            target_element = chapter_soup.find(id=target_id)
            if not target_element:
                issues.append({
                    "rule_name": "Missing Anchor ID",
                    "type": "missing_id",
                    "href": href,
                    "id": target_id,
                    "message": "Target id not found",
                    "category": "Error",
                })
                continue
        else:
            target_element = chapter_soup.find(["h1", "h2", "h3", "h4", "h5", "h6"])
            if not target_element:
                issues.append({
                    "rule_name": "Missing Heading",
                    "type": "missing_heading",
                    "href": href,
                    "message": "No heading found in chapter",
                    "category": "Warning",
                })
                continue

        heading_tags = ["h1", "h2", "h3", "h4", "h5", "h6"]
        heading_classes = ["CASE_H1", "CASE_H2", "CASE_H3", "CASE_H4", "CASE_H5", "CASE_H6", "MCQH"]
        current_element = target_element
        while current_element:
            current_classes = current_element.get("class", [])
            if current_element.name in heading_tags or any(
                cls in heading_classes for cls in current_classes
            ):
                break
            current_element = current_element.parent

        if not current_element:
            issues.append({
                "rule_name": "Heading Tag Not Found",
                "type": "heading_not_found",
                "href": href,
                "message": f'"{nav_text}" not in heading tags(h1-h6) or classes({", ".join(heading_classes)}). Heading hierarchy not checked.',
                "category": "Warning",
            })
            continue

        heading_text = current_element.get_text(separator="")

        if nav_text.lower() != heading_text.lower():
            issues.append({
                "rule_name": "Heading Text Mismatch",
                "type": "heading_text_mismatch",
                "href": href,
                "expected_text": nav_text,
                "actual_text": heading_text,
                "message": "Nav text and heading text mismatch",
                "category": "Error",
            })
        elif nav_text != heading_text:
            issues.append({
                "rule_name": "Heading Case Mismatch",
                "type": "heading_case_mismatch",
                "href": href,
                "expected_text": nav_text,
                "actual_text": heading_text,
                "message": "Case mismatch",
                "category": "Warning",
            })

        if current_element.name in heading_tags:
            heading_level = int(current_element.name[1])
            nav_heading_map[nav_level] = heading_level

            if "file_heading_map" not in locals():
                file_heading_map = {}
            if chapter_file not in file_heading_map:
                file_heading_map[chapter_file] = {}
            parent_nav_level = nav_level - 1

            if parent_nav_level in file_heading_map[chapter_file]:
                parent_heading_level = file_heading_map[chapter_file][parent_nav_level]
                if heading_level <= parent_heading_level:
                    issues.append({
                        "rule_name": "Nav Hierarchy Mismatch",
                        "type": "hierarchy_mismatch",
                        "href": href,
                        "message": (
                            f'"{heading_text}" heading hierarchy does not match chapter heading level.\n'
                            f"Navigation level: h{nav_level-1} "
                            f"Chapter heading level: h{heading_level}\n"
                        ),
                        "category": "Error",
                    })

            file_heading_map[chapter_file][nav_level] = heading_level
        else:
            issues.append({
                "rule_name": "Nav Hierarchy Mismatch",
                "type": "nav_hierarchy_mismatch",
                "href": href,
                "message": f'"{nav_text}" is not a heading tag. Found "{current_element.name}" with classes {current_element.get("class") if current_element.get("class") else "None"}. Heading hierarchy not checked.',
                "category": "Warning",
            })
    return {"issues_count": len(issues), "issues": issues}


@rule("NAV002")
def validate_ncx_headings(file_details):
    file_path = file_details["full_path"]
    issues = []
    current_dir = os.path.dirname(file_path)

    with open(file_path, "r", encoding="utf-8") as f:
        ncx_soup = BeautifulSoup(f, "xml")

    with open(os.path.join(current_dir, "nav.xhtml"), "r", encoding="utf-8") as f:
        nav_soup = BeautifulSoup(f, "html.parser")

    ncx_items = []
    for navpoint in ncx_soup.find_all("navPoint"):
        text_tag = navpoint.find("text")
        content_tag = navpoint.find("content")
        title = text_tag.get_text(strip=True) if text_tag else ""
        href = content_tag.get("src", "").strip() if content_tag else ""
        ncx_items.append({"title": title, "href": href})

    nav_items = []
    toc_nav = nav_soup.find("nav", {"epub:type": "toc"})
    if toc_nav:
        for a in toc_nav.find_all("a"):
            title = a.get_text(strip=True)
            href = a.get("href", "").strip()
            nav_items.append({"title": title, "href": href})

    if len(ncx_items) != len(nav_items):
        issues.append({
            "type": "toc_count_mismatch",
            "message": f"NCX has {len(ncx_items)} items but NAV has {len(nav_items)} items",
            "category": "Error",
        })
        return {"issues_count": len(issues), "issues": issues}

    for i in range(len(ncx_items)):
        ncx_item = ncx_items[i]
        nav_item = nav_items[i]

        ncx_title = ncx_item["title"]
        nav_title = nav_item["title"]
        ncx_href = ncx_item["href"]
        nav_href = nav_item["href"]

        if ncx_title.lower() != nav_title.lower():
            issues.append({
                "rule_name": "TOC Text Mismatch",
                "type": "toc_text_mismatch",
                "href": ncx_href,
                "expected_text": ncx_title,
                "actual_text": nav_title,
                "message": "NCX and NAV title text do not match",
                "category": "Error",
            })
        elif ncx_title != nav_title:
            issues.append({
                "rule_name": "TOC Case Mismatch",
                "type": "toc_case_mismatch",
                "href": ncx_href,
                "expected_text": ncx_title,
                "actual_text": nav_title,
                "message": "NCX and NAV title casing does not match",
                "category": "Warning",
            })

        ncx_file = ncx_href.split("#")[0]
        nav_file = nav_href.split("#")[0]
        if ncx_file != nav_file:
            issues.append({
                "rule_name": "TOC File Mismatch",
                "type": "toc_file_mismatch",
                "href": ncx_href,
                "expected_text": ncx_href,
                "actual_text": nav_href,
                "message": "NCX and NAV file mapping does not match",
                "category": "Error",
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("NAV003")
def validate_nav_full(book_details):
    """Book-scope: heading coverage + nav hierarchy + EISBN."""
    from ...vendor.pdf_epub_validator import NavValidator

    folder = book_details["folder_name"]
    bundle = _bundle.get_epub_bundle(folder)
    if not bundle:
        return {"issues_count": 0, "issues": []}
    cli_issues = NavValidator(bundle).run_all()
    issues = _drop_pass_issues([_cli_issue_to_web(i) for i in cli_issues])
    return {"issues_count": len(issues), "issues": issues}


@rule("NAV004")
def validate_nav_cover_entry(file_details):
    """nav.xhtml must contain an entry named 'Cover' (case-insensitive) or an
    element with epub:type='cover'.
    """
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    nav = soup.find("nav", attrs={"epub:type": "toc"}) or soup.find("nav", id="toc")
    if not nav:
        return {"issues_count": 0, "issues": []}

    for a in nav.find_all("a"):
        label = a.get_text(strip=True)
        if label.strip().lower() == "cover":
            return {"issues_count": 0, "issues": []}

    landmark_or_type = soup.find(attrs={"epub:type": lambda v: v and "cover" in v})
    if landmark_or_type is not None:
        return {"issues_count": 0, "issues": []}

    return {"issues_count": 1, "issues": [{
        "type": "cover_entry_missing",
        "message": "nav.xhtml does not contain a 'Cover' entry (link text 'Cover' or epub:type='cover').",
        "category": "Warning",
    }]}


import glob as _glob
import re


@rule("NAV005")
def validate_page_list_parity(book_details):
    """Every page id declared in the OPF spine/xhtml (id="page_*") must appear in
    the OPF pagelist (if present) and in the NCX pageList and in nav.xhtml page-list nav.
    """
    epub = book_details["epub_path"]
    issues = []

    # 1) Collect page IDs from all xhtml files: id="page_..." or epub:type="pagebreak" id="..."
    page_ids: set[str] = set()
    for xhtml in _glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for el in soup.find_all(True):
            eid = (el.get("id") or "").strip()
            etype = (el.get("epub:type") or "").strip()
            # Only treat as a page id when it's page_N / page-N / pageN with N digits/roman.
            if re.match(r"^page[_-]?[ivxlcdm0-9]+$", eid, re.IGNORECASE):
                page_ids.add(eid)
            elif "pagebreak" in etype and eid:
                page_ids.add(eid)

    if not page_ids:
        return {"issues_count": 0, "issues": []}

    # 2) Check nav.xhtml page-list nav.
    nav_ids: set[str] = set()
    for nav_path in _glob.glob(os.path.join(epub, "**", "nav.xhtml"), recursive=True):
        try:
            with open(nav_path, "r", encoding="utf-8") as f:
                nav_soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        page_nav = nav_soup.find("nav", attrs={"epub:type": "page-list"})
        if not page_nav:
            continue
        for a in page_nav.find_all("a", href=True):
            href = a["href"]
            if "#" in href:
                nav_ids.add(href.split("#", 1)[1])

    missing_in_nav = sorted(page_ids - nav_ids) if nav_ids else []
    if nav_ids and missing_in_nav:
        issues.append({
            "type": "page_ids_missing_in_nav",
            "message": f"nav.xhtml page-list is missing {len(missing_in_nav)} page id(s): {missing_in_nav[:10]}"
                       + ("..." if len(missing_in_nav) > 10 else ""),
            "category": "Error",
        })
    elif not nav_ids:
        issues.append({
            "type": "nav_page_list_missing",
            "message": "nav.xhtml does not contain a <nav epub:type=\"page-list\"> section.",
            "category": "Warning",
        })

    # 3) Check NCX pageList.
    ncx_ids: set[str] = set()
    ncx_found = False
    for ncx_path in _glob.glob(os.path.join(epub, "**", "toc.ncx"), recursive=True):
        ncx_found = True
        try:
            with open(ncx_path, "r", encoding="utf-8") as f:
                ncx_soup = BeautifulSoup(f.read(), "xml")
        except Exception:  # noqa: BLE001
            continue
        page_list = ncx_soup.find("pageList") or ncx_soup.find("pagelist")
        if not page_list:
            continue
        for pt in page_list.find_all(["pageTarget", "pagetarget"]):
            content = pt.find("content")
            if content and content.get("src"):
                src = content.get("src")
                if "#" in src:
                    ncx_ids.add(src.split("#", 1)[1])

    if ncx_found and not ncx_ids:
        issues.append({
            "type": "ncx_page_list_missing",
            "message": "toc.ncx does not contain a <pageList> section.",
            "category": "Warning",
        })
    elif ncx_ids:
        missing_in_ncx = sorted(page_ids - ncx_ids)
        if missing_in_ncx:
            issues.append({
                "type": "page_ids_missing_in_ncx",
                "message": f"toc.ncx pageList is missing {len(missing_in_ncx)} page id(s): {missing_in_ncx[:10]}"
                           + ("..." if len(missing_in_ncx) > 10 else ""),
                "category": "Error",
            })

    return {"issues_count": len(issues), "issues": issues}
