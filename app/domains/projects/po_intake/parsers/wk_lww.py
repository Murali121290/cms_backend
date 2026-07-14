"""Parser for the Wolters Kluwer / LWW "Prepress Vendor Launch Form and Purchase Order".

This template is a flattened (non-fillable) PDF — pdfplumber's extract_text() returns each
"Label: value" pair as ordinary page text in reading order, so extraction is plain
label-anchored regex scanning over the full 3-page text.
"""
from __future__ import annotations

import re

import pdfplumber

from app.domains.projects.po_intake import normalize as n

_SERVICE_LABELS = [
    "Project management",
    "Copyediting",
    "Art sizing & cropping",
    "Art labeling",
    "Art creation",
    "Composition & page makeup",
    "Preflight test to printer",
    "Proofreading",
    "Index preparation (standard)",
    "Index preparation (premium)",
    "Additional services req'd:",
]


def _search(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def _extract_services(text: str) -> list[dict]:
    block_match = re.search(r"SERVICES REQUIRED:(.*?)(?:Contributor affiliations|Printed:)", text, re.DOTALL)
    if not block_match:
        return []
    block = block_match.group(1)
    escaped = [re.escape(label) for label in _SERVICE_LABELS]
    positions = []
    for label, escaped_label in zip(_SERVICE_LABELS, escaped):
        m = re.search(escaped_label, block)
        if m:
            positions.append((m.start(), m.end(), label))
    positions.sort()
    services = []
    for i, (start, end, label) in enumerate(positions):
        next_start = positions[i + 1][0] if i + 1 < len(positions) else len(block)
        note = n.clean(block[end:next_start])
        if note:
            services.append({"service": label.rstrip(":"), "note": note})
    return services


def _extract_batch_schedule(text: str) -> list[dict]:
    block_match = re.search(r"Batch Schedule for Outstanding Items(.*?)(?:DESIGN SPECS|$)", text, re.DOTALL)
    if not block_match:
        return []
    rows = []
    for line in block_match.group(1).splitlines():
        m = re.match(r"\s*(\d+)\s+(.+?)\s+(\d{1,2}/\d{1,2}/\d{4})\s*$", line)
        if m:
            rows.append({"batch": m.group(1), "items": m.group(2).strip(), "delivery_date": m.group(3)})
    return rows


def parse(pdf_path: str) -> dict:
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages)

    warnings: list[str] = []

    title = _search(r"Title:\s*(.+)", text)
    subtitle = _search(r"Subtitle:\s*(.+)", text)
    project_title = n.clean(": ".join(p for p in (title, subtitle) if n.clean(p)))

    isbn_raw = _search(r"ISBN:\s*([^\n]+?)\s+Job\s*#:", text) or _search(r"ISBN:\s*(\S+)", text)
    isbn_no, isbn_warning = n.normalize_isbn(isbn_raw)
    if isbn_warning:
        warnings.append(isbn_warning)

    edition = n.normalize_edition(_search(r"Edition:\s*(\S+)", text))
    category = n.clean(_search(r"Business Unit:\s*(.+)", text))
    chapter_count = n.to_int(_search(r"Total chapters:\s*(\d+)", text))
    manuscript_pages = n.to_int(_search(r"Number of MS pages:\s*(\d+)", text))
    estimated_pages = n.to_int(_search(r"Est\.\s*No\s*Printed\s*Pages\s*(\d+)", text))
    color = n.clean(_search(r"#\s*of\s*Colors:\s*(.+?)\s+Est\.\s*No\s*Printed\s*Pages", text))
    trim_size = n.clean(_search(r"Book Trim Size:\s*([^\n]+)", text))

    due_date_raw = _search(r"Files to Printer:\s*(\S+)", text)
    due_date, due_date_warning = n.parse_date_loose(due_date_raw)
    if due_date_warning:
        warnings.append(due_date_warning)

    description = n.clean(_search(r"Description:\s*(.+?)\s*Files to Printer:", text.replace("\n", " ")))

    job_number = n.clean(_search(r"Job\s*#:\s*(\S+)", text))
    author = n.clean(_search(r"Author:\s*(.+)", text))
    co_author = n.clean(_search(r"AUTHOR 2 INFORMATION:.*?Author Name \(First/Last\)\s*(.+?)\s+Address:", text.replace("\n", " ")))

    ec_contact = n.clean(_search(r"EC:\s*(.+)", text))
    manufacturing_coordinator = n.clean(_search(r"Manufacturing Coordinator:\s*\n?\s*(.+)", text))
    ppm = n.clean(_search(r"Ordered By \(PPM\):\s*(.+)", text))

    castoff_due = n.clean(_search(r"Castoff due at LWW by:\s*(\S+)", text))
    estimate_due = n.clean(_search(r"Estimate due at LWW by:\s*(\S+)", text))
    printer = n.clean(_search(r"Printer:\s*(.+?)\s+Contact:", text))
    printer_contact = n.clean(_search(r"Contact:\s*(.+)", text))

    fields = {
        "project_title": project_title,
        "isbn_no": isbn_no,
        "edition": edition,
        "category": category,
        "chapter_count": chapter_count,
        "manuscript_pages": manuscript_pages,
        "estimated_pages": estimated_pages,
        "color": color,
        "trim_size": trim_size,
        "due_date": due_date,
    }

    extras = {
        "job_number": job_number,
        "author_names": [a for a in (author, co_author) if a],
        "description": description,
        "contacts": {
            "ec": ec_contact,
            "manufacturing_coordinator": manufacturing_coordinator,
            "ppm": ppm,
        },
        "services_required": _extract_services(text),
        "batch_schedule": _extract_batch_schedule(text),
        "key_dates": {
            "castoff_due_at_lww": castoff_due,
            "estimate_due_at_lww": estimate_due,
        },
        "printer_info": {
            "printer": printer,
            "contact": printer_contact,
        },
    }

    return {"fields": fields, "extras": extras, "warnings": warnings}
