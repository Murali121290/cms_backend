"""Identify which known customer PO/RFQ template a file matches.

Each vendor uses one fixed layout, so detection is a simple substring/extension check rather
than anything fuzzy. Unknown templates return "unknown" — the caller then skips extraction
entirely and lets the PM fill the Create Project form in by hand (see po_intake/service.py).
"""
from __future__ import annotations

WK_LWW = "wk_lww"
KENDALL_HUNT = "kendall_hunt"
ARTECH_HOUSE = "artech_house"
UNKNOWN = "unknown"

TEMPLATE_LABELS = {
    WK_LWW: "Wolters Kluwer / LWW launch form",
    KENDALL_HUNT: "Kendall Hunt prepress RFQ",
    ARTECH_HOUSE: "Artech House transmittal",
    UNKNOWN: "Unrecognized template",
}


def detect_pdf_template(pdf_text: str) -> str:
    if "PREPRESS REQUEST FOR QUOTE" in pdf_text:
        return KENDALL_HUNT
    if "Prepress Vendor Launch Form and Purchase Order" in pdf_text or "LWW Purchase Order" in pdf_text:
        return WK_LWW
    return UNKNOWN


def detect_xlsx_template(filename: str, sheet_names: list[str]) -> str:
    if "transmittal" in filename.casefold():
        return ARTECH_HOUSE
    return UNKNOWN
