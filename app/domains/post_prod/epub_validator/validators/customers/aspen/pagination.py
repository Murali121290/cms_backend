"""Aspen page-ruler validators.

Aspen requires a page ruler (pagebreak marker) in the EPUB for every
non-blank page in the source PDF (per VST EPUB requirements). Blank pages
at the very end of the book are exempted.
"""

import glob
import os

from bs4 import BeautifulSoup

from ....engine.registry import rule
from ....services import book_bundle_service as _bundle


def _epub_page_labels(epub: str) -> set[str]:
    """Collect all page-break labels from xhtml files (epub:type='pagebreak' title=...)."""
    labels: set[str] = set()
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for el in soup.find_all(True):
            etype = (el.get("epub:type") or "").strip()
            role = (el.get("role") or "").strip()
            aria = (el.get("aria-label") or "").strip()
            title = (el.get("title") or "").strip()
            if "pagebreak" in etype or role == "doc-pagebreak":
                label = title or aria or el.get_text(strip=True) or ""
                if label:
                    labels.add(label)
    return labels


def _pdf_page_labels(folder_name: str) -> list[str]:
    """Return the list of PDF page labels in order (fall back to 1..N when unset)."""
    try:
        pdf = _bundle.get_pdf_doc(folder_name)
    except Exception:  # noqa: BLE001
        return []
    if pdf is None:
        return []
    doc = getattr(pdf, "doc", None) or getattr(pdf, "_doc", None)
    if doc is None:
        return []
    labels: list[str] = []
    try:
        page_count = doc.page_count
    except Exception:  # noqa: BLE001
        return []
    for i in range(page_count):
        try:
            lbl = doc[i].get_label() or str(i + 1)
        except Exception:  # noqa: BLE001
            lbl = str(i + 1)
        labels.append(lbl)
    return labels


def _pdf_page_is_blank(folder_name: str, index: int) -> bool:
    try:
        pdf = _bundle.get_pdf_doc(folder_name)
    except Exception:  # noqa: BLE001
        return False
    if pdf is None:
        return False
    doc = getattr(pdf, "doc", None) or getattr(pdf, "_doc", None)
    if doc is None:
        return False
    try:
        text = doc[index].get_text("text").strip()
    except Exception:  # noqa: BLE001
        return False
    return len(text) < 3


@rule("ASP-PAGE-001")
def validate_page_ruler_present(book_details):
    """Every non-blank PDF page must have a pagebreak marker in the EPUB.
    Blank pages at the end of the book are exempted (Aspen convention).
    """
    epub = book_details["epub_path"]
    folder = book_details["folder_name"]

    pdf_labels = _pdf_page_labels(folder)
    if not pdf_labels:
        return {"issues_count": 0, "issues": []}

    # Trim trailing blanks.
    end = len(pdf_labels)
    while end > 0 and _pdf_page_is_blank(folder, end - 1):
        end -= 1
    expected = set(pdf_labels[:end])
    if not expected:
        return {"issues_count": 0, "issues": []}

    actual = _epub_page_labels(epub)
    missing = sorted(expected - actual)
    if not missing:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "page_ruler_incomplete",
        "message": (
            f"EPUB is missing pagebreak markers for {len(missing)} PDF page(s): "
            f"{missing[:15]}" + ("..." if len(missing) > 15 else "")
        ),
        "category": "Error",
    }]}


@rule("PAGE002")
def validate_page_number_sequence(book_details):
    """Numeric page labels in the EPUB must appear in an unbroken sequence
    (no gaps in the arabic-numbered part of the book).
    """
    epub = book_details["epub_path"]
    labels = _epub_page_labels(epub)
    nums = sorted({int(l) for l in labels if l.isdigit()})
    if len(nums) < 2:
        return {"issues_count": 0, "issues": []}
    gaps = []
    for prev, cur in zip(nums, nums[1:]):
        if cur - prev > 1:
            gaps.append((prev, cur))
    if not gaps:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "page_number_sequence_gap",
        "message": (
            f"Page number sequence has {len(gaps)} gap(s): "
            + ", ".join(f"{a}→{b}" for a, b in gaps[:8])
            + ("..." if len(gaps) > 8 else "")
        ),
        "category": "Warning",
    }]}
