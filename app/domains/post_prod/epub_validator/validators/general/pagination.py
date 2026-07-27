import os
import re

from bs4 import BeautifulSoup

from ...engine.registry import rule
from ._common import _pagebreak_collect_segments, _pagebreak_normalize

_PAGEBREAK_WORD_RE = re.compile(r"\w+", re.UNICODE)


@rule("PAGE001")
def validate_pagebreak_positions(file_details):
    from ...services.pdf_service import _pdf_path
    import pymupdf as fitz

    file_path = file_details["full_path"]
    folder_name = file_details["folder_name"]
    issues: list[dict] = []

    pdf_file = _pdf_path(folder_name)
    if not os.path.exists(pdf_file):
        return {"issues_count": 0, "issues": []}

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    segments = _pagebreak_collect_segments(soup)
    labelled = [(label, text) for label, text in segments[1:] if label]
    if not labelled:
        return {"issues_count": 0, "issues": []}

    doc = fitz.open(pdf_file)
    try:
        for label, text in labelled:
            try:
                indices = doc.get_page_numbers(label)
            except Exception:
                indices = []
            if not indices:
                issues.append({
                    "type": "pagebreak_label_unknown",
                    "rule_name": "Pagebreak Position",
                    "page_label": label,
                    "message": f'Pagebreak marker title="{label}" has no matching page label in the PDF',
                    "category": "Warning",
                })
                continue

            tokens = _PAGEBREAK_WORD_RE.findall(text.replace("­", "").lower())
            head_tokens = tokens[:5]
            if len(head_tokens) < 3:
                continue

            pdf_words = _pagebreak_normalize(doc[indices[0]].get_text("text")).split()
            scan = pdf_words[:30]
            matched = 0
            cursor = 0
            for tok in head_tokens:
                while cursor < len(scan) and scan[cursor] != tok:
                    cursor += 1
                if cursor < len(scan):
                    matched += 1
                    cursor += 1
            if matched >= 3:
                continue

            xhtml_head = " ".join(head_tokens)
            pdf_excerpt = " ".join(pdf_words[:24]) if pdf_words else ""
            issues.append({
                "type": "pagebreak_position_mismatch",
                "rule_name": "Pagebreak Position",
                "page_label": label,
                "message": (
                    f"Pagebreak marker for page {label} does not appear at the "
                    f"start of the matching PDF page"
                ),
                "expected_text": pdf_excerpt,
                "actual_text": xhtml_head,
                "category": "Warning",
            })
    finally:
        doc.close()

    return {"issues_count": len(issues), "issues": issues}
