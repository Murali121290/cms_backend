import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ._common import find_opf, read_text

# Case-insensitive, tolerates "Halftitle", "Half title", "Half-title".
_HALFTITLE_RE = re.compile(r"\bhalf[\s\-]?title\b", re.IGNORECASE)
# Match "and" as a word between two author-name-ish tokens.
_AUTHOR_AND_RE = re.compile(r"\band\b", re.IGNORECASE)


@rule("ASP-NAV-001")
def validate_front_matter_present(file_details):
    """NAV must contain a "Front Matter" section (or epub:type='frontmatter')."""
    text = read_text(file_details["full_path"])
    soup = BeautifulSoup(text, "html.parser")
    nav = soup.find("nav", attrs={"epub:type": "toc"}) or soup.find("nav", id="toc")
    if not nav:
        return {"issues_count": 0, "issues": []}

    has_front_matter = False
    for a in nav.find_all("a"):
        label = a.get_text(strip=True)
        if label.lower().replace(" ", "") == "frontmatter":
            has_front_matter = True
            break

    if not has_front_matter:
        # Fallback: any element in the NAV with epub:type frontmatter
        has_front_matter = bool(nav.find(attrs={"epub:type": lambda v: v and "frontmatter" in v}))

    if has_front_matter:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "front_matter_missing",
        "message": 'NAV does not contain a "Front Matter" entry',
        "category": "Warning",
    }]}


@rule("ASP-NAV-002")
def validate_no_halftitle_word(file_details):
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


@rule("NAV001")
def validate_nav_xhtml(file_details):
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    nav = soup.find("nav", attrs={"epub:type": "toc"})
    if not nav:
        issues.append({
            "rule_name": "Missing TOC Nav",
            "type": "missing_toc_nav",
            "message": "nav.xhtml is missing <nav epub:type='toc'> element",
            "category": "Error",
        })

    ol = nav.find("ol") if nav else None
    if not ol:
        issues.append({
            "rule_name": "Missing Main OL",
            "type": "missing_main_ol",
            "message": "TOC nav is missing main <ol> list",
            "category": "Error",
        })

    if nav:
        links = nav.find_all("a")
        for link in links:
            text = link.get_text(strip=True)
            line_num = getattr(link, "sourceline", None)
            if not text:
                issues.append({
                    "rule_name": "Empty Nav Link",
                    "type": "empty_nav_link",
                    "message": f"{f'Line {line_num}: ' if line_num else ''}Nav link text is empty",
                    "category": "Error",
                    "line_number": line_num,
                })

    return {"issues_count": len(issues), "issues": issues}
