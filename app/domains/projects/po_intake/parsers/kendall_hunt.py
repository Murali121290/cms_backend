"""Parser for the Kendall Hunt "Prepress Request for Quote".

Unlike the WK/LWW template, this is a genuine fillable PDF (AcroForm) — the entered values
live in field annotations (page.annots[*]['data']['V']), not in the flattened page text
(extract_text() only returns the printed labels). So extraction reads named form fields
directly instead of scanning text.
"""
from __future__ import annotations

import pdfplumber

from app.domains.projects.po_intake import normalize as n


def _read_form_fields(pdf_path: str) -> dict[str, str | None]:
    fields: dict[str, str | None] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for annot in page.annots:
                data = annot.get("data", {})
                name = n.decode(data.get("T"))
                if not name:
                    continue
                fields[name] = n.decode(data.get("V"))
    return fields


def parse(pdf_path: str) -> dict:
    raw = _read_form_fields(pdf_path)
    warnings: list[str] = []

    project_title = n.clean(raw.get("Title"))
    category = n.clean(raw.get("Discipline"))
    trim_size = n.clean(raw.get("Trim Size"))
    color = n.clean(raw.get("Interior Color"))
    manuscript_pages = n.to_int(raw.get("Total Msp Pages"))
    estimated_pages = n.to_int(raw.get("Final Pages"))

    due_date, due_date_warning = n.parse_date_loose(raw.get("Final Files to KH"))
    if due_date_warning:
        warnings.append(f"Final Files To KH: {due_date_warning}")

    print_isbn, print_isbn_warning = n.normalize_isbn(raw.get("PrintISBN"))
    ebook_isbn, ebook_isbn_warning = n.normalize_isbn(raw.get("ebookISBN"))
    isbn_no = print_isbn or ebook_isbn
    if not isbn_no:
        for w in (print_isbn_warning, ebook_isbn_warning):
            if w:
                warnings.append(w)

    copyright_year = n.to_int(raw.get("PublishYear"))

    author_full = n.clean(raw.get("AuthorName")) or n.clean(raw.get("Author"))

    fields = {
        "project_title": project_title,
        "category": category,
        "trim_size": trim_size,
        "color": color,
        "manuscript_pages": manuscript_pages,
        "estimated_pages": estimated_pages,
        "due_date": due_date,
        "isbn_no": isbn_no,
        "copyright_year": copyright_year,
    }

    files_to_vendor_date, _ = n.parse_date_loose(raw.get("Files To Vendor"))
    course_start_date, _ = n.parse_date_loose(raw.get("CourseStartDate"))
    publication_date, _ = n.parse_date_loose(raw.get("PubDate"))

    extras = {
        "job_number": n.clean(raw.get("Job Number")),
        "author_names": [author_full] if author_full else [],
        "author_contact": {
            "email": n.clean(raw.get("AuthorEmail")),
            "phone": n.clean(raw.get("AuthorPhone")),
            "time_zone": n.clean(raw.get("AuthorTimeZone")),
            "notes": n.clean(raw.get("AuthorNotes")),
        },
        "kh_contact": n.clean(raw.get("Contact")),
        "project_type": n.clean(raw.get("Type")),
        "binding": n.clean(raw.get("Binding")),
        "ebook_format": n.clean(raw.get("eBook")),
        "ebook_isbn": ebook_isbn,
        "key_dates": {
            "files_to_vendor": files_to_vendor_date,
            "course_start_date": course_start_date,
            "publication_date": publication_date,
        },
        "editorial_services": {
            "copyediting_style": n.clean(raw.get("Copyediting Style")),
            "copyediting_level": n.clean(raw.get("Copyediting Level")),
            "notes": n.clean(raw.get("Text17")),
        },
        "composition": {
            "interior_design": n.clean(raw.get("Interior Design")),
            "original_msp_format": n.clean(raw.get("Original Msp")),
            "keystroking_pages": n.clean(raw.get("Keystroking")),
            "num_tables": n.clean(raw.get("Tables")),
            "previous_compositor": n.clean(raw.get("Previous Comp")),
            "previous_app_files": n.clean(raw.get("Previous App")),
            "notes": n.clean(raw.get("Notes2")),
        },
        "art": {
            "num_images": n.clean(raw.get("Number of Images")),
            "notes": n.clean(raw.get("Notes4")),
        },
        "author_codes": {
            "needed": n.clean(raw.get("AuthorCodesNeeded")),
            "count": n.clean(raw.get("Numbercodes")),
        },
        "form_fields": {k: v for k, v in raw.items() if not k.startswith("Check Box")},
    }

    return {"fields": fields, "extras": extras, "warnings": warnings}
