"""Identify which known customer PO/RFQ template a file matches.

Each vendor uses one fixed layout, so detection is a simple substring/extension check rather
than anything fuzzy. Unknown templates return "unknown" — the caller then skips extraction
entirely and lets the PM fill the Create Project form in by hand (see po_intake/service.py).
"""
from __future__ import annotations

WK_LWW = "wk_lww"
WK_PROJECT_CHECKLIST = "wk_project_checklist"
KENDALL_HUNT = "kendall_hunt"
ARTECH_HOUSE = "artech_house"
SPRINGER = "springer"
BEP = "bep"
UNKNOWN = "unknown"

TEMPLATE_LABELS = {
    WK_LWW: "Wolters Kluwer / LWW launch form",
    WK_PROJECT_CHECKLIST: "Wolters Kluwer project information checklist",
    KENDALL_HUNT: "Kendall Hunt prepress RFQ",
    ARTECH_HOUSE: "Artech House",
    SPRINGER: "Springer Publishing Assignment Memo",
    BEP: "Business Expert Press",
    UNKNOWN: "Unrecognized template",
}


def detect_pdf_template(pdf_text: str) -> str:
    if "PROJECT INFORMATION CHECKLIST" in pdf_text:
        return WK_PROJECT_CHECKLIST
    if "PREPRESS REQUEST FOR QUOTE" in pdf_text:
        return KENDALL_HUNT
    if "Prepress Vendor Launch Form and Purchase Order" in pdf_text or "LWW Purchase Order" in pdf_text:
        return WK_LWW
    return UNKNOWN


def detect_xlsx_template(filename: str, sheet_names: list[str], sample_text: str = "") -> str:
    fn_lower = filename.casefold()
    text_lower = sample_text.casefold()
    sheet_names_lower = [s.casefold() for s in sheet_names]

    # 1. Content-based detection (works for any file name)
    if "business expert press" in text_lower or ("specs" in sheet_names_lower and any(kw in text_lower for kw in ("target final files posted", "bep collection", "collection editor"))):
        return BEP
    if "artech house" in text_lower or "transmittal info" in sheet_names_lower or "frontmatter" in sheet_names_lower:
        return ARTECH_HOUSE

    # 2. Filename fallback (for backwards compatibility)
    if "bep" in fn_lower:
        return BEP
    if "transmittal" in fn_lower or "artech" in fn_lower:
        return ARTECH_HOUSE
    return UNKNOWN


def detect_docx_template(docx_text: str, filename: str) -> str:
    text_lower = docx_text.lower()
    fn_lower = filename.lower()
    if ("assignment memo" in text_lower or "assignment memo" in fn_lower) and ("springer" in text_lower or "springer" in fn_lower or "s4carlisle" in text_lower):
        return SPRINGER
    return UNKNOWN
