import os
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ..services import book_bundle_service as _bundle
from ._common import _cli_issue_to_web, _drop_pass_issues


@rule("PDF001")
def validate_pdf_style_parity(book_details):
    """Book-scope: StyleComparator — paragraph splitting, italic/case/colour
    parity, alignment, indentation, blockquote, images, page count, etc.
    """
    from ..vendor.pdf_epub_validator import StyleComparator

    folder = book_details["folder_name"]
    bundle = _bundle.get_epub_bundle(folder)
    pdf = _bundle.get_pdf_doc(folder)
    if not bundle or not pdf:
        return {"issues_count": 0, "issues": []}
    cli_issues = StyleComparator(bundle, pdf).run_all()
    issues = _drop_pass_issues([_cli_issue_to_web(i) for i in cli_issues])
    return {"issues_count": len(issues), "issues": issues}


# ── Drop cap consistency ────────────────────────────────────────────────────

_DROP_CAP_CLASS_HINTS = re.compile(r"(dropcap|drop-cap|drop_cap|initial|firstchar|first-letter)", re.IGNORECASE)


def _chapter_files(epub: str) -> list[str]:
    """xhtml files that look like body chapters (skip nav, toc, cover, etc.)."""
    excludes = {"nav.xhtml", "toc.xhtml", "cover.xhtml", "titlepage.xhtml", "copyright.xhtml"}
    chapters = []
    for root, _dirs, files in os.walk(epub):
        for f in files:
            if not f.lower().endswith(".xhtml"):
                continue
            if f.lower() in excludes:
                continue
            fname = f.lower()
            if re.match(r"^(ch|chapter|c|part|section|sec)\d+", fname) or "chapter" in fname:
                chapters.append(os.path.join(root, f))
    if not chapters:
        for root, _dirs, files in os.walk(epub):
            for f in files:
                if f.lower().endswith(".xhtml") and f.lower() not in excludes:
                    chapters.append(os.path.join(root, f))
    return chapters


def _has_drop_cap(html_text: str) -> bool:
    try:
        soup = BeautifulSoup(html_text, "html.parser")
    except Exception:  # noqa: BLE001
        return False
    body = soup.find("body") or soup
    for p in body.find_all("p"):
        first = None
        for child in p.children:
            if getattr(child, "name", None):
                first = child
                break
            if isinstance(child, str) and child.strip():
                return False
        if first is None:
            continue
        classes = " ".join(first.get("class") or [])
        style = first.get("style") or ""
        if _DROP_CAP_CLASS_HINTS.search(classes):
            return True
        if "first-letter" in style.lower() or re.search(r"font-size\s*:\s*[2-9]\d*(?:\.\d+)?(?:em|rem|%)", style):
            return True
        return False
    return False


@rule("STYLE001")
def validate_drop_cap_consistency(book_details):
    """If any chapter uses a drop cap on its first paragraph, all chapters should."""
    epub = book_details["epub_path"]
    chapters = _chapter_files(epub)
    if len(chapters) < 2:
        return {"issues_count": 0, "issues": []}

    with_drop: list[str] = []
    without_drop: list[str] = []
    for ch in chapters:
        try:
            with open(ch, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception:  # noqa: BLE001
            continue
        (with_drop if _has_drop_cap(text) else without_drop).append(ch)

    if not with_drop or not without_drop:
        return {"issues_count": 0, "issues": []}

    return {"issues_count": 1, "issues": [{
        "type": "drop_cap_inconsistent",
        "message": (
            f"Drop cap present in {len(with_drop)} chapter(s) but missing in "
            f"{len(without_drop)}. Drop cap styling should be consistent."
        ),
        "category": "Warning",
        "details": {
            "with_drop_cap": [os.path.relpath(c, epub) for c in with_drop[:10]],
            "without_drop_cap": [os.path.relpath(c, epub) for c in without_drop[:10]],
        },
    }]}


# ── Line-spacing sanity check ───────────────────────────────────────────────

import glob

_LINE_HEIGHT_RE = re.compile(r"line-height\s*:\s*([0-9.]+)(px|em|rem|%)?", re.IGNORECASE)
_MIN_LINE_HEIGHT_UNITLESS = 0.9
_MAX_LINE_HEIGHT_UNITLESS = 2.0


@rule("STYLE002")
def validate_line_spacing_sane(book_details):
    """Every CSS line-height declaration for body text should fall in a
    reasonable range (0.9 – 2.0 for unitless / em / rem; 12 – 40 px).
    """
    epub = book_details["epub_path"]
    issues = []
    for css_path in glob.glob(os.path.join(epub, "**", "*.css"), recursive=True):
        try:
            with open(css_path, "r", encoding="utf-8") as f:
                css = f.read()
        except Exception:  # noqa: BLE001
            continue
        rel = os.path.relpath(css_path, epub)
        for m in _LINE_HEIGHT_RE.finditer(css):
            value = float(m.group(1))
            unit = (m.group(2) or "").lower()
            if unit in ("", "em", "rem"):
                if not (_MIN_LINE_HEIGHT_UNITLESS <= value <= _MAX_LINE_HEIGHT_UNITLESS):
                    issues.append({
                        "type": "line_height_out_of_range",
                        "message": f"Suspicious line-height '{m.group(0)}' in {rel}.",
                        "category": "Warning",
                        "file_path": rel,
                    })
            elif unit == "px":
                if not (12 <= value <= 40):
                    issues.append({
                        "type": "line_height_out_of_range",
                        "message": f"Suspicious line-height '{m.group(0)}' in {rel}.",
                        "category": "Warning",
                        "file_path": rel,
                    })
            elif unit == "%":
                if not (90 <= value <= 200):
                    issues.append({
                        "type": "line_height_out_of_range",
                        "message": f"Suspicious line-height '{m.group(0)}' in {rel}.",
                        "category": "Warning",
                        "file_path": rel,
                    })
    return {"issues_count": len(issues), "issues": issues}


# ── Every figure/table has a cross-reference link ─────────────────────────


@rule("STYLE003")
def validate_figures_have_cross_ref(book_details):
    """Each <figure id="fig-N"> should be referenced by at least one
    <a href="#fig-N"> somewhere in the book. Same for <table id="tab-N">.
    """
    epub = book_details["epub_path"]
    labelled_ids: dict[str, str] = {}  # id -> file
    referenced_ids: set[str] = set()

    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        rel = os.path.relpath(xhtml, epub)

        for el in soup.find_all(["figure", "table"]):
            eid = (el.get("id") or "").strip()
            if not eid:
                continue
            if re.match(r"^(fig|figure|tbl|table|tab)[-_]?[\w]+$", eid, re.IGNORECASE):
                labelled_ids[eid] = rel

        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if "#" in href:
                referenced_ids.add(href.split("#", 1)[1])

    orphans = [(fid, f) for fid, f in labelled_ids.items() if fid not in referenced_ids]
    issues = []
    for fid, f in orphans[:25]:
        issues.append({
            "type": "figure_or_table_no_xref",
            "message": (
                f"<figure|table id='{fid}'> in {f} is never referenced by any "
                f"<a href='#{fid}'> cross-reference link."
            ),
            "category": "Warning",
            "file_path": f,
        })
    if len(orphans) > 25:
        issues.append({
            "type": "figure_or_table_no_xref_more",
            "message": f"...and {len(orphans) - 25} more figures/tables without cross-refs.",
            "category": "Warning",
        })
    return {"issues_count": len(issues), "issues": issues}
