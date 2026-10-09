"""Parser for the Wolters Kluwer "Project Information Checklist" fillable PDF form.

This is a single-page fillable PDF form with form fields. Extraction uses pdfplumber's
form field detection to extract values from the fillable form fields.
"""
from __future__ import annotations

import pdfplumber

from app.domains.projects.po_intake import normalize as n

# Field mapping for resilience: if form layout changes, these can be updated
# Maps logical field names to possible PDF field IDs (checked in order)
FIELD_MAPPING = {
    "author": ["Text2"],
    "customer": ["Text3"],
    "division": ["Text4"],
    "customer_contact": ["Text7"],
    "title": ["Text15"],
    "edition": ["Text16"],
    "trim_size": ["Text18"],
    "manuscript_pages": ["Text20"],
    "estimated_pages": ["Text21"],
    "isbn": ["Text24"],
    "planner": ["Text29"],
    "printer_date": ["Text30"],
    "category": ["Combo Box9"],
    "discipline": ["Combo Box10"],
    "workflow": ["Combo Box11"],
    "status": ["Combo Box12"],
    "priority": ["Combo Box14"],
    "color": ["Combo Box17"],
    "copyright_year": ["Combo Box19"],
    "billing_location": ["Combo Box25"],
    "comp_level": ["Combo Box26"],
}


def _get_field_value(form_fields: dict, logical_name: str) -> str | None:
    """Get field value by logical name, checking all possible field IDs."""
    for field_id in FIELD_MAPPING.get(logical_name, []):
        if field_id in form_fields:
            return form_fields[field_id]
    return None


def parse(pdf_path: str) -> dict:
    """Parse Project Information Checklist fillable form."""
    warnings: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0] if pdf.pages else None
        if not page:
            return {"fields": {}, "extras": {}, "warnings": ["No pages in PDF"]}

        # Extract form fields from annotations
        form_fields = {}
        if page.annots:
            for annot in page.annots:
                # Get field name from title
                field_name = annot.get("title")
                # Get field value from data['V']
                field_value = annot.get("data", {}).get("V")
                if field_name and field_value:
                    # Decode bytes if necessary
                    if isinstance(field_value, bytes):
                        field_value = field_value.decode("utf-8", errors="ignore")
                    form_fields[field_name] = field_value

    # Map form fields to normalized output structure using logical names
    project_title = n.clean(_get_field_value(form_fields, "title") or "")
    isbn_raw = _get_field_value(form_fields, "isbn")
    isbn_no, isbn_warning = n.normalize_isbn(isbn_raw) if isbn_raw else (None, None)
    if isbn_warning:
        warnings.append(isbn_warning)

    edition = n.normalize_edition(_get_field_value(form_fields, "edition"))
    category = n.clean(_get_field_value(form_fields, "discipline") or "")

    # Extract manuscript pages
    manuscript_pages_raw = _get_field_value(form_fields, "manuscript_pages")
    manuscript_pages = n.to_int(manuscript_pages_raw) if manuscript_pages_raw else None

    # Extract estimated pages
    estimated_pages_raw = _get_field_value(form_fields, "estimated_pages")
    estimated_pages = n.to_int(estimated_pages_raw) if estimated_pages_raw else None

    # Extract color info
    color = n.clean(_get_field_value(form_fields, "color") or "")

    # Extract trim size
    trim_size = n.clean(_get_field_value(form_fields, "trim_size") or "")

    # Extract due date from projected printer date
    due_date_raw = _get_field_value(form_fields, "printer_date")
    due_date, due_date_warning = n.parse_date_loose(due_date_raw) if due_date_raw else (None, None)
    if due_date_warning:
        warnings.append(due_date_warning)

    # Extract author
    author = n.clean(_get_field_value(form_fields, "author") or "")

    # Extract contacts
    customer = n.clean(_get_field_value(form_fields, "customer") or "")
    customer_contact = n.clean(_get_field_value(form_fields, "customer_contact") or "")
    planner = n.clean(_get_field_value(form_fields, "planner") or "")

    # Copyediting level defaults to Level 1
    copyediting_level = "Level 1"

    fields = {
        "project_title": project_title,
        "isbn_no": isbn_no,
        "edition": edition,
        "category": category,
        "chapter_count": None,
        "manuscript_pages": manuscript_pages,
        "estimated_pages": estimated_pages,
        "color": color,
        "trim_size": trim_size,
        "due_date": due_date,
        "client_project_manager": customer_contact,
        "copyediting_level": copyediting_level,
    }

    extras = {
        "job_number": None,
        "author_names": [author] if author else [],
        "description": None,
        "contacts": {
            "customer": customer,
            "customer_contact": customer_contact,
            "planner": planner,
        },
        "services_required": [],
        "batch_schedule": [],
        "key_dates": {},
        "printer_info": {},
    }

    return {"fields": fields, "extras": extras, "warnings": warnings}
