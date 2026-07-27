import re

from bs4 import BeautifulSoup

from ....engine.registry import rule
from ._common import find_opf

_PRINTED_RE = re.compile(r"\bprinted\b", re.IGNORECASE)
_EISBN_DIGITS_RE = re.compile(r"\d[\d\-\s]{10,}\d")


def _extract_eisbn(epub_folder: str) -> str | None:
    opf = find_opf(epub_folder)
    if not opf:
        return None
    try:
        with open(opf, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "xml")
    except Exception:
        return None
    for ident in soup.find_all("dc:identifier"):
        id_attr = (ident.get("id") or "").lower()
        text = ident.get_text(strip=True)
        if "epub" in id_attr or "eisbn" in text.lower():
            digits = "".join(ch for ch in text if ch.isdigit())
            return digits or None
    ident = soup.find("dc:identifier")
    if ident:
        digits = "".join(ch for ch in ident.get_text(strip=True) if ch.isdigit())
        return digits or None
    return None


@rule("ASP-COPY-001")
def validate_no_printed_word(file_details):
    """The word "Printed" must not appear on the copyright page."""
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    body_text = soup.get_text(" ", strip=True)
    if _PRINTED_RE.search(body_text):
        return {"issues_count": 1, "issues": [{
            "type": "printed_word_present",
            "message": 'Copyright page contains the forbidden word "Printed"',
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-COPY-002")
def validate_eisbn_in_copyright(file_details):
    """The eISBN (from OPF) must appear on the copyright page."""
    eisbn = _extract_eisbn(file_details["epub_root"])
    if not eisbn:
        return {"issues_count": 1, "issues": [{
            "type": "eisbn_unknown",
            "message": "Could not extract eISBN from OPF to check copyright page",
            "category": "Warning",
        }]}
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        text = f.read()
    body_digits = "".join(ch for ch in text if ch.isdigit())
    if eisbn not in body_digits:
        return {"issues_count": 1, "issues": [{
            "type": "eisbn_missing_from_copyright",
            "message": f"Copyright page does not contain the eISBN {eisbn}",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


