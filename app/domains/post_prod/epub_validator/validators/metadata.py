import datetime
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ....services import book_bundle_service as _bundle
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


# ── Additional Aspen OPF checks (mapped to the "Metadata" tab of the spec) ────

_STOPWORDS_TITLE_CASE = {
    "a", "an", "the", "and", "or", "but", "nor", "for", "of", "at", "by",
    "in", "on", "to", "up", "as", "if", "vs", "via", "per",
}


def _is_title_case(value: str) -> bool:
    """Approximate 'Title Case / Upper Lower Case' check: every non-stopword
    token has an upper-case first letter; ALL-CAPS or lowercase tokens fail.
    """
    words = [w for w in re.split(r"\s+", value.strip()) if w]
    if not words:
        return False
    for i, w in enumerate(words):
        core = re.sub(r"[^A-Za-z]", "", w)
        if not core:
            continue
        if core.isupper() and len(core) > 1:
            return False
        # First word and last word are always capitalised.
        if i not in (0, len(words) - 1) and core.lower() in _STOPWORDS_TITLE_CASE:
            continue
        if not core[0].isupper():
            return False
    return True


@rule("ASP-META-005")
def validate_title_case(book_details):
    """<dc:title> should be Title Case / Upper Lower Case (not ALL CAPS)."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    title_el = soup.find("dc:title")
    if title_el is None:
        return {"issues_count": 0, "issues": []}
    value = title_el.get_text(strip=True)
    if not value:
        return {"issues_count": 0, "issues": []}
    if value.isupper():
        return {"issues_count": 1, "issues": [{
            "type": "title_all_caps",
            "message": f"<dc:title> should be Title Case, not ALL CAPS. Found: '{value}'",
            "category": "Error",
        }]}
    if value.islower():
        return {"issues_count": 1, "issues": [{
            "type": "title_all_lower",
            "message": f"<dc:title> should be Title Case. Found: '{value}'",
            "category": "Error",
        }]}
    if not _is_title_case(value):
        return {"issues_count": 1, "issues": [{
            "type": "title_case_off",
            "message": f"<dc:title> may not be in Title Case: '{value}'",
            "category": "Warning",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-006")
def validate_date_is_current_year(book_details):
    """<dc:date> should be the current calendar year."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    date_el = soup.find("dc:date")
    if date_el is None:
        return {"issues_count": 1, "issues": [{
            "type": "date_missing",
            "message": "<dc:date> not present in OPF",
            "category": "Warning",
        }]}
    value = date_el.get_text(strip=True)
    m = re.match(r"^(\d{4})", value)
    if not m:
        return {"issues_count": 1, "issues": [{
            "type": "date_bad_format",
            "message": f"<dc:date> should start with a 4-digit year. Found: '{value}'",
            "category": "Warning",
        }]}
    year = int(m.group(1))
    current = datetime.date.today().year
    if year != current:
        return {"issues_count": 1, "issues": [{
            "type": "date_not_current_year",
            "message": f"<dc:date> year is {year}; expected current year {current}.",
            "category": "Warning",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-007")
def validate_format_matches_pdf_pages(book_details):
    """<dc:format> page count must match the PDF page count."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    fmt_el = soup.find("dc:format")
    if fmt_el is None:
        return {"issues_count": 1, "issues": [{
            "type": "format_missing",
            "message": "<dc:format> not present in OPF.",
            "category": "Warning",
        }]}
    value = fmt_el.get_text(strip=True)
    m = re.search(r"(\d+)\s*(?:pp|pages?)", value, re.IGNORECASE)
    if not m:
        return {"issues_count": 1, "issues": [{
            "type": "format_no_page_count",
            "message": f"<dc:format> has no parseable page count. Found: '{value}'",
            "category": "Warning",
        }]}
    declared = int(m.group(1))
    try:
        pdf = _bundle.get_pdf_doc(book_details["folder_name"])
    except Exception:  # noqa: BLE001
        pdf = None
    if not pdf:
        return {"issues_count": 1, "issues": [{
            "type": "format_pdf_unavailable",
            "message": f"<dc:format> declares {declared} pages but no PDF is available to verify.",
            "category": "Warning",
        }]}
    actual = pdf.page_count if hasattr(pdf, "page_count") else len(getattr(pdf, "pages", []) or [])
    if actual and declared != actual:
        return {"issues_count": 1, "issues": [{
            "type": "format_page_count_mismatch",
            "message": f"<dc:format> declares {declared} pages; PDF has {actual}.",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-008")
def validate_source_print_isbn(book_details):
    """<dc:source> should be a urn:isbn print ISBN, refined by source-of=pagination."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    src = soup.find("dc:source")
    if src is None:
        return {"issues_count": 1, "issues": [{
            "type": "source_missing",
            "message": "<dc:source> (Print ISBN) not present in OPF.",
            "category": "Warning",
        }]}
    value = src.get_text(strip=True)
    if not re.search(r"urn:isbn:\d{10,13}", value):
        return {"issues_count": 1, "issues": [{
            "type": "source_bad_format",
            "message": f"<dc:source> should be 'urn:isbn:<PrintISBN>'. Found: '{value}'",
            "category": "Error",
        }]}

    issues = []
    src_id = src.get("id")
    if src_id:
        refines = soup.find("meta", attrs={"refines": f"#{src_id}", "property": "source-of"})
        if refines is None or refines.get_text(strip=True) != "pagination":
            issues.append({
                "type": "source_of_pagination_missing",
                "message": f"Expected <meta refines=\"#{src_id}\" property=\"source-of\">pagination</meta>.",
                "category": "Warning",
            })
    return {"issues_count": len(issues), "issues": issues}


_EISBN_TAG = re.compile(r"(\d{10,13})")


@rule("ASP-META-009")
def validate_identifier_convention(book_details):
    """<dc:identifier> should have id 'Epub-<eISBN>' and contain the eISBN number."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    ids = soup.find_all("dc:identifier")
    if not ids:
        return {"issues_count": 1, "issues": [{
            "type": "identifier_missing",
            "message": "<dc:identifier> not present in OPF.",
            "category": "Error",
        }]}

    issues = []
    found_epub_id = False
    for id_el in ids:
        id_attr = (id_el.get("id") or "").strip()
        value = id_el.get_text(strip=True)
        m = _EISBN_TAG.search(value)
        if id_attr.lower().startswith("epub-") or (m and id_attr.lower() == f"epub-{m.group(1)}".lower()):
            found_epub_id = True
            if m:
                expected_id = f"Epub-{m.group(1)}"
                if id_attr != expected_id:
                    issues.append({
                        "type": "identifier_id_case",
                        "message": f"Identifier id should be '{expected_id}'; found '{id_attr}'.",
                        "category": "Warning",
                    })
    if not found_epub_id:
        issues.append({
            "type": "identifier_id_missing",
            "message": "No <dc:identifier> has an id starting with 'Epub-'. Aspen convention is id=\"Epub-<eISBN>\".",
            "category": "Warning",
        })
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-META-010")
def validate_cover_manifest_link(book_details):
    """<meta name="cover"> content must resolve to an item id in the manifest."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    cover_meta = soup.find("meta", attrs={"name": "cover"})
    if cover_meta is None:
        return {"issues_count": 0, "issues": []}  # META001 already flags absence
    content = (cover_meta.get("content") or "").strip()
    if not content:
        return {"issues_count": 0, "issues": []}
    item = soup.find("item", attrs={"id": content})
    if item is None:
        return {"issues_count": 1, "issues": [{
            "type": "cover_manifest_missing",
            "message": f"<meta name=\"cover\" content=\"{content}\"/> does not match any <item id=...> in the manifest.",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


# ── Aspen accessibility metadata strict-value assertions ──────────────────

_REQUIRED_HAZARDS = {"noSoundHazard", "noMotionSimulationHazard", "none"}
_REQUIRED_ACCESS_MODES = {"textual", "visual"}
_REQUIRED_ACCESS_MODE_SUFFICIENT = {"textual,visual", "textual"}


@rule("ASP-META-011")
def validate_accessibility_hazards_strict(book_details):
    """Aspen requires the three specific hazard values: noSoundHazard,
    noMotionSimulationHazard, and none.
    """
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessibilityHazard"})
    }
    missing = sorted(_REQUIRED_HAZARDS - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "accessibility_hazard_values_missing",
        "message": (
            "OPF is missing required accessibilityHazard value(s) "
            f"{missing}. Aspen convention requires all of {sorted(_REQUIRED_HAZARDS)}."
        ),
        "category": "Error",
    }]}


@rule("ASP-META-012")
def validate_access_modes_strict(book_details):
    """Aspen requires both accessMode=textual AND accessMode=visual."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessMode"})
    }
    missing = sorted(_REQUIRED_ACCESS_MODES - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "access_mode_missing",
        "message": (
            f"OPF is missing required accessMode value(s) {missing}. "
            f"Aspen convention requires both {sorted(_REQUIRED_ACCESS_MODES)}."
        ),
        "category": "Error",
    }]}


@rule("ASP-META-013")
def validate_access_mode_sufficient_strict(book_details):
    """Aspen requires both accessModeSufficient values: 'textual,visual' and 'textual'."""
    soup = _load_opf_soup(book_details["epub_path"])
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "").replace(" ", "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessModeSufficient"})
    }
    missing = sorted(_REQUIRED_ACCESS_MODE_SUFFICIENT - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    return {"issues_count": 1, "issues": [{
        "type": "access_mode_sufficient_missing",
        "message": (
            f"OPF is missing required accessModeSufficient value(s) {missing}. "
            f"Aspen convention requires both {sorted(_REQUIRED_ACCESS_MODE_SUFFICIENT)}."
        ),
        "category": "Error",
    }]}


# ── Creator count parity with Front Matter ────────────────────────────────

import glob
import os


def _find_front_matter_file(epub: str) -> str | None:
    """Locate a chapter that looks like the front-matter / title page."""
    candidates = []
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        base = os.path.basename(xhtml).lower()
        if any(k in base for k in ("front_matter", "frontmatter", "titlepage", "title_page")):
            candidates.append(xhtml)
    return sorted(candidates)[0] if candidates else None


def _count_authors_in_front_matter(path: str) -> int | None:
    """Best-effort count of author names on a front-matter page.

    Aspen title pages typically render each author in its own element with a
    class hinting at role (author/authorname/by/contributor). Fall back to
    counting lines beginning with 'By ' or comma-separated names.
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")
    except Exception:  # noqa: BLE001
        return None
    for cls_hint in ("author", "authorname", "byline", "contributor"):
        els = soup.find_all(class_=re.compile(cls_hint, re.IGNORECASE))
        if len(els) >= 1:
            names = [e.get_text(strip=True) for e in els if e.get_text(strip=True)]
            # Split any "A, B and C" style lines and count.
            total = 0
            for n in names:
                parts = re.split(r",|\band\b", n)
                total += sum(1 for p in parts if p.strip())
            if total:
                return total
    # Fallback: look for a "By X, Y" line in <p> elements.
    for p in soup.find_all(["p", "div"]):
        text = p.get_text(" ", strip=True)
        m = re.match(r"^by\s+(.+)$", text, re.IGNORECASE)
        if m:
            parts = re.split(r",|\band\b", m.group(1))
            names = [p.strip() for p in parts if p.strip()]
            if names:
                return len(names)
    return None


@rule("ASP-META-014")
def validate_creator_count_matches_front_matter(book_details):
    """Count of <dc:creator> in OPF should equal number of authors on the Front Matter page."""
    epub = book_details["epub_path"]
    soup = _load_opf_soup(epub)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    opf_creators = soup.find_all("dc:creator")
    opf_count = len(opf_creators)
    if opf_count == 0:
        return {"issues_count": 0, "issues": []}

    fm_path = _find_front_matter_file(epub)
    if not fm_path:
        return {"issues_count": 0, "issues": []}
    fm_count = _count_authors_in_front_matter(fm_path)
    if fm_count is None:
        return {"issues_count": 1, "issues": [{
            "type": "creator_count_unverifiable",
            "message": (
                f"OPF has {opf_count} <dc:creator> entries but front-matter author "
                f"markup in '{os.path.relpath(fm_path, epub)}' could not be parsed."
            ),
            "category": "Warning",
        }]}
    if opf_count != fm_count:
        return {"issues_count": 1, "issues": [{
            "type": "creator_count_mismatch",
            "message": (
                f"OPF has {opf_count} <dc:creator> entries but front matter lists "
                f"{fm_count} author(s) in '{os.path.relpath(fm_path, epub)}'."
            ),
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}
