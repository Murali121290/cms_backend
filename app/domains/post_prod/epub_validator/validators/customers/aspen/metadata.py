import re

from bs4 import BeautifulSoup

from ....engine.registry import rule
from ._common import find_opf

_RIGHTS_RE = re.compile(
    r"copyright\s*©\s*\d{4}\s+aspen\s+publishing\.?\s+all\s+rights\s+reserved\.?",
    re.IGNORECASE,
)


def _load_opf_soup(epub_folder: str):
    opf = find_opf(epub_folder)
    if not opf:
        return None
    with open(opf, "r", encoding="utf-8") as f:
        return BeautifulSoup(f.read(), "xml")


@rule("ASP-META-001")
def validate_publisher_is_aspen(book_details):
    """<dc:publisher> must equal 'Aspen Publishing'."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 1, "issues": [{
            "type": "opf_missing",
            "message": "Could not locate OPF to verify publisher",
            "category": "Warning",
        }]}
    pub = soup.find("dc:publisher")
    if pub is None:
        return {"issues_count": 1, "issues": [{
            "type": "publisher_missing",
            "message": "<dc:publisher> not present in OPF",
            "category": "Error",
        }]}
    value = pub.get_text(strip=True)
    if value != "Aspen Publishing":
        return {"issues_count": 1, "issues": [{
            "type": "publisher_mismatch",
            "message": f"Expected publisher 'Aspen Publishing', found '{value}'",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-002")
def validate_rights_string(book_details):
    """<dc:rights> must match 'Copyright © YYYY Aspen Publishing. All Rights Reserved.'."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    rights = soup.find("dc:rights")
    if rights is None:
        return {"issues_count": 1, "issues": [{
            "type": "rights_missing",
            "message": "<dc:rights> not present in OPF",
            "category": "Error",
        }]}
    value = rights.get_text(strip=True)
    if not _RIGHTS_RE.search(value):
        return {"issues_count": 1, "issues": [{
            "type": "rights_pattern_mismatch",
            "message": (
                f"<dc:rights> does not match expected Aspen pattern. Found: '{value}'"
            ),
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-003")
def validate_certifier(book_details):
    """<meta property="a11y:certifiedBy"> must be 'S4Carlisle Publishing Services'."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "a11y:certifiedBy"})
    if meta is None:
        return {"issues_count": 1, "issues": [{
            "type": "certifier_missing",
            "message": '<meta property="a11y:certifiedBy"> not present',
            "category": "Error",
        }]}
    value = meta.get_text(strip=True)
    if value != "S4Carlisle Publishing Services":
        return {"issues_count": 1, "issues": [{
            "type": "certifier_mismatch",
            "message": f"Expected certifier 'S4Carlisle Publishing Services', found '{value}'",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-004")
def validate_conforms_to(book_details):
    """<meta property="dcterms:conformsTo"> must equal
    'EPUB Accessibility 1.1 - WCAG 2.2 Level AA'.
    """
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "dcterms:conformsTo"})
    if meta is None:
        return {"issues_count": 1, "issues": [{
            "type": "conforms_to_missing",
            "message": '<meta property="dcterms:conformsTo"> not present',
            "category": "Error",
        }]}
    expected = "EPUB Accessibility 1.1 - WCAG 2.2 Level AA"
    value = meta.get_text(strip=True)
    if value != expected:
        return {"issues_count": 1, "issues": [{
            "type": "conforms_to_mismatch",
            "message": f"Expected conformsTo '{expected}', found '{value}'",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}
