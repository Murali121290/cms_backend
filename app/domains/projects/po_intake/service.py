"""Entry point for PO/RFQ extraction: detect template, dispatch to its parser.

Used by POST /projects/extract-po (app/routers/api_v2.py). Never raises for a
recognized-but-malformed or entirely unrecognized file — callers always get a well-formed
result with `fields` possibly empty and `warnings` explaining why, so the Create Project
page can fall back to plain manual entry.
"""
from __future__ import annotations

import openpyxl
import pdfplumber

from app.domains.projects.po_intake import detect
from app.domains.projects.po_intake.parsers import artech_house, kendall_hunt, wk_lww

_UNRECOGNIZED_WARNING = "Unrecognized PO template — please fill in the form manually."


def _empty_result(template: str, warnings: list[str] | None = None) -> dict:
    return {
        "fields": {},
        "extras": {},
        "template_detected": template,
        "warnings": warnings or [_UNRECOGNIZED_WARNING],
    }


def extract_po(file_path: str, filename: str) -> dict:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        try:
            with pdfplumber.open(file_path) as pdf:
                text = "\n".join((page.extract_text() or "") for page in pdf.pages)
        except Exception as exc:
            return _empty_result(detect.UNKNOWN, [f"Could not read PDF: {exc}"])

        template = detect.detect_pdf_template(text)
        parser = {detect.WK_LWW: wk_lww, detect.KENDALL_HUNT: kendall_hunt}.get(template)
        if not parser:
            return _empty_result(detect.UNKNOWN)

        try:
            parsed = parser.parse(file_path)
        except Exception as exc:
            return _empty_result(template, [f"Recognized as {detect.TEMPLATE_LABELS[template]} but failed to parse it: {exc}"])

        return {**parsed, "template_detected": template}

    if ext in ("xlsx", "xlsm"):
        try:
            wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
            sheet_names = wb.sheetnames
        except Exception as exc:
            return _empty_result(detect.UNKNOWN, [f"Could not read spreadsheet: {exc}"])

        template = detect.detect_xlsx_template(filename, sheet_names)
        if template != detect.ARTECH_HOUSE:
            return _empty_result(detect.UNKNOWN)

        try:
            parsed = artech_house.parse(file_path)
        except Exception as exc:
            return _empty_result(template, [f"Recognized as {detect.TEMPLATE_LABELS[template]} but failed to parse it: {exc}"])

        return {**parsed, "template_detected": template}

    return _empty_result(detect.UNKNOWN, [f"Unsupported file type '.{ext}' — please upload a .pdf or .xlsx PO file."])
