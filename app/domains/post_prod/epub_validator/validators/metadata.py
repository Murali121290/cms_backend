import datetime
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ..services import book_bundle_service as _bundle
from ._common import find_opf

_RIGHTS_RE = re.compile(
    r"copyright\s*©\s*\d{4}\s+aspen\s+publishing\.?\s+all\s+rights\s+reserved\.?",
    re.IGNORECASE,
)


def _load_opf_info(details: dict):
    epub_folder = details.get("epub_path") or details.get("epub_root")
    if not epub_folder and "full_path" in details:
        p = details["full_path"]
        for _ in range(5):
            p = os.path.dirname(p)
            if os.path.basename(p).lower() == "oebps" or os.path.isfile(os.path.join(p, "mimetype")):
                epub_folder = p
                break

    if not epub_folder:
        return None, None, []

    opf = find_opf(epub_folder)
    if not opf or not os.path.isfile(opf):
        return None, None, []

    with open(opf, "r", encoding="utf-8") as f:
        content = f.read()

    soup = BeautifulSoup(content, "xml")
    lines = content.splitlines()
    return soup, opf, lines


def _find_line(lines: list[str], search_str: str) -> int | None:
    """Find 1-based line number containing search_str."""
    if not search_str or not lines:
        return None
    for idx, line in enumerate(lines, 1):
        if search_str.lower() in line.lower():
            return idx
    return None


@rule("ASP-META-001")
def validate_publisher_is_aspen(book_details, rule_config=None):
    """<dc:publisher> must equal 'Aspen Publishing'."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 1, "issues": [{
            "type": "opf_missing",
            "message": "Could not locate OPF to verify publisher",
            "category": "Warning",
            "extract": "<metadata",
        }]}
    pub = soup.find("dc:publisher")
    if pub is None:
        return {"issues_count": 1, "issues": [{
            "type": "publisher_missing",
            "message": "<dc:publisher> not present in OPF",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    value = pub.get_text(strip=True)
    if value != "Aspen Publishing":
        return {"issues_count": 1, "issues": [{
            "type": "publisher_mismatch",
            "message": f"Expected publisher 'Aspen Publishing', found '{value}'",
            "category": "Error",
            "line_number": _find_line(lines, "dc:publisher"),
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-002")
def validate_rights_string(book_details, rule_config=None):
    """<dc:rights> must match 'Copyright © YYYY Aspen Publishing. All Rights Reserved.'."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    rights = soup.find("dc:rights")
    if rights is None:
        return {"issues_count": 1, "issues": [{
            "type": "rights_missing",
            "message": "<dc:rights> not present in OPF",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    value = rights.get_text(strip=True)
    if not _RIGHTS_RE.search(value):
        return {"issues_count": 1, "issues": [{
            "type": "rights_pattern_mismatch",
            "message": (
                f"<dc:rights> does not match expected Aspen pattern 'Copyright © YYYY Aspen Publishing. All Rights Reserved.'. Found: '{value}'"
            ),
            "category": "Error",
            "line_number": _find_line(lines, "dc:rights"),
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-003")
def validate_certifier(book_details, rule_config=None):
    """<meta property="a11y:certifiedBy"> must be 'S4Carlisle Publishing Services'."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "a11y:certifiedBy"})
    if meta is None:
        return {"issues_count": 1, "issues": [{
            "type": "certifier_missing",
            "message": '<meta property="a11y:certifiedBy"> not present',
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    value = meta.get_text(strip=True)
    if value != "S4Carlisle Publishing Services":
        return {"issues_count": 1, "issues": [{
            "type": "certifier_mismatch",
            "message": f"Expected certifier 'S4Carlisle Publishing Services', found '{value}'",
            "category": "Error",
            "line_number": _find_line(lines, "a11y:certifiedBy"),
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-004")
def validate_conforms_to(book_details, rule_config=None):
    """<meta property="dcterms:conformsTo"> must equal
    'EPUB Accessibility 1.1 - WCAG 2.2 Level AA'.
    """
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "dcterms:conformsTo"})
    if meta is None:
        return {"issues_count": 1, "issues": [{
            "type": "conforms_to_missing",
            "message": '<meta property="dcterms:conformsTo"> not present',
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    expected = "EPUB Accessibility 1.1 - WCAG 2.2 Level AA"
    value = meta.get_text(strip=True)
    if value != expected:
        return {"issues_count": 1, "issues": [{
            "type": "conforms_to_mismatch",
            "message": f"Expected conformsTo '{expected}', found '{value}'",
            "category": "Error",
            "line_number": _find_line(lines, "dcterms:conformsTo"),
            "extract": value,
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
def validate_title_case(book_details, rule_config=None):
    """<dc:title> should be Title Case / Upper Lower Case (not ALL CAPS)."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    title_el = soup.find("dc:title")
    if title_el is None:
        return {"issues_count": 0, "issues": []}
    value = title_el.get_text(strip=True)
    if not value:
        return {"issues_count": 0, "issues": []}
    line_num = _find_line(lines, "dc:title")
    if value.isupper():
        return {"issues_count": 1, "issues": [{
            "type": "title_all_caps",
            "message": f"<dc:title> should be Title Case, not ALL CAPS. Found: '{value}'",
            "category": "Error",
            "line_number": line_num,
            "extract": value,
        }]}
    if value.islower():
        return {"issues_count": 1, "issues": [{
            "type": "title_all_lower",
            "message": f"<dc:title> should be Title Case. Found: '{value}'",
            "category": "Error",
            "line_number": line_num,
            "extract": value,
        }]}
    if not _is_title_case(value):
        return {"issues_count": 1, "issues": [{
            "type": "title_case_off",
            "message": f"<dc:title> may not be in Title Case: '{value}'",
            "category": "Warning",
            "line_number": line_num,
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-006")
def validate_date_is_current_year(book_details, rule_config=None):
    """<dc:date> should be the current calendar year."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    date_el = soup.find("dc:date")
    if date_el is None:
        return {"issues_count": 1, "issues": [{
            "type": "date_missing",
            "message": "<dc:date> not present in OPF",
            "category": "Warning",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    value = date_el.get_text(strip=True)
    line_num = _find_line(lines, "dc:date")
    m = re.match(r"^(\d{4})", value)
    if not m:
        return {"issues_count": 1, "issues": [{
            "type": "date_bad_format",
            "message": f"<dc:date> should start with a 4-digit year. Found: '{value}'",
            "category": "Warning",
            "line_number": line_num,
            "extract": value,
        }]}
    year = int(m.group(1))
    current = datetime.date.today().year
    if year != current:
        return {"issues_count": 1, "issues": [{
            "type": "date_not_current_year",
            "message": f"<dc:date> year is {year}; expected current year {current}.",
            "category": "Warning",
            "line_number": line_num,
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


def _get_pdf_page_count(book_details: dict) -> int | None:
    """Find the associated PDF and return its total page count."""
    folder_name = book_details.get("folder_name", "")
    if folder_name:
        try:
            pdf = _bundle.get_pdf_doc(folder_name)
            if pdf:
                count = getattr(pdf, "page_count", None) or len(getattr(pdf, "pages", []) or [])
                if count:
                    return count
        except Exception:  # noqa: BLE001
            pass

    base_paths = []
    for key in ("full_path", "epub_root", "epub_path"):
        val = book_details.get(key)
        if val:
            p = val if os.path.isdir(val) else os.path.dirname(val)
            for _ in range(5):
                base_paths.append(p)
                p = os.path.dirname(p)

    for bp in base_paths:
        if not os.path.exists(bp):
            continue
        pdf_files = glob.glob(os.path.join(bp, "*.pdf")) + glob.glob(os.path.join(bp, "**", "*.pdf"), recursive=True)
        if pdf_files:
            target_pdf = pdf_files[0]
            try:
                import fitz  # PyMuPDF
                doc = fitz.open(target_pdf)
                count = len(doc)
                doc.close()
                return count
            except Exception:  # noqa: BLE001
                try:
                    from ..vendor.pdf_epub_validator.pdf_parser import PdfParser
                    pdf = PdfParser(target_pdf).parse()
                    return getattr(pdf, "page_count", None) or len(getattr(pdf, "pages", []) or [])
                except Exception:  # noqa: BLE001
                    pass
    return None


@rule("ASP-META-007")
def validate_format_matches_pdf_pages(book_details, rule_config=None):
    """<dc:format> page count must match the PDF page count."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    fmt_el = soup.find("dc:format")
    if fmt_el is None:
        return {"issues_count": 1, "issues": [{
            "type": "format_missing",
            "message": "<dc:format> not present in OPF.",
            "category": "Warning",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    value = fmt_el.get_text(strip=True)
    line_num = _find_line(lines, "dc:format")
    m = re.search(r"(\d+)\s*(?:pp|pages?)", value, re.IGNORECASE)
    if not m:
        return {"issues_count": 1, "issues": [{
            "type": "format_no_page_count",
            "message": f"<dc:format> has no parseable page count. Found: '{value}'",
            "category": "Warning",
            "line_number": line_num,
            "extract": value,
        }]}
    declared = int(m.group(1))
    actual = _get_pdf_page_count(book_details)
    if actual is None:
        return {"issues_count": 1, "issues": [{
            "type": "format_pdf_unavailable",
            "message": f"<dc:format> declares {declared} pages but no PDF is available to verify.",
            "category": "Warning",
            "line_number": line_num,
            "extract": value,
        }]}
    if declared != actual:
        return {"issues_count": 1, "issues": [{
            "type": "format_page_count_mismatch",
            "message": f"<dc:format> declares {declared} pages; PDF has {actual}.",
            "category": "Error",
            "line_number": line_num,
            "extract": value,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-008")
def validate_source_print_isbn(book_details, rule_config=None):
    """<dc:source> should be present with urn:isbn print ISBN."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}

    src = soup.find("dc:source")
    if src is None:
        return {"issues_count": 1, "issues": [{
            "type": "source_missing",
            "message": "<dc:source> (Print ISBN) not present in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}

    issues = []
    value = src.get_text(strip=True)
    line_num = _find_line(lines, "dc:source")
    if not re.search(r"urn:isbn:\d{10,13}", value):
        issues.append({
            "type": "source_bad_format",
            "message": f"<dc:source> should be 'urn:isbn:<PrintISBN>'. Found: '{value}'",
            "category": "Error",
            "line_number": line_num,
            "extract": value,
        })

    src_id = src.get("id")
    if not src_id:
        issues.append({
            "type": "source_id_missing",
            "message": "<dc:source> is missing an 'id' attribute (e.g. id=\"src-id\").",
            "category": "Error",
            "line_number": line_num,
            "extract": "dc:source",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-META-019")
def validate_source_of_pagination_refines(book_details, rule_config=None):
    """<meta refines="#src-id" property="source-of">pagination</meta> must refine <dc:source>."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}

    src = soup.find("dc:source")
    src_id = src.get("id") if src else "src-id"

    refines = soup.find("meta", attrs={"property": "source-of"})
    if refines is None or refines.get_text(strip=True) != "pagination":
        target_id = f"#{src_id}" if src_id else "#src-id"
        return {"issues_count": 1, "issues": [{
            "type": "source_of_pagination_missing",
            "message": f"Missing required pagination refines tag: <meta refines=\"{target_id}\" property=\"source-of\">pagination</meta>",
            "category": "Error",
            "line_number": _find_line(lines, "source-of") or _find_line(lines, "<metadata"),
            "extract": "source-of",
        }]}

    return {"issues_count": 0, "issues": []}


_EISBN_TAG = re.compile(r"(\d{10,13})")


@rule("ASP-META-009")
def validate_identifier_convention(book_details, rule_config=None):
    """<dc:identifier> should have id 'Epub-<eISBN>' and contain the eISBN number."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    ids = soup.find_all("dc:identifier")
    if not ids:
        return {"issues_count": 1, "issues": [{
            "type": "identifier_missing",
            "message": "<dc:identifier> not present in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}

    issues = []
    found_epub_id = False
    for id_el in ids:
        id_attr = (id_el.get("id") or "").strip()
        value = id_el.get_text(strip=True)
        line_num = _find_line(lines, f"id=\"{id_attr}\"") or _find_line(lines, "dc:identifier")
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
                        "line_number": line_num,
                        "extract": value,
                    })
    if not found_epub_id:
        issues.append({
            "type": "identifier_id_missing",
            "message": "No <dc:identifier> has an id starting with 'Epub-'. Aspen convention is id=\"Epub-<eISBN>\".",
            "category": "Warning",
            "line_number": _find_line(lines, "dc:identifier"),
            "extract": "dc:identifier",
        })
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-META-010")
def validate_dc_language_is_en(book_details, rule_config=None):
    """<dc:language> must equal 'en' or 'en-US'."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    lang = soup.find("dc:language")
    if lang is None:
        return {"issues_count": 1, "issues": [{
            "type": "language_missing",
            "message": "<dc:language> not present in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    val = lang.get_text(strip=True).lower()
    if val not in ("en", "en-us"):
        return {"issues_count": 1, "issues": [{
            "type": "language_invalid",
            "message": f"<dc:language> should be 'en' or 'en-US'. Found: '{lang.get_text(strip=True)}'",
            "category": "Error",
            "line_number": _find_line(lines, "dc:language"),
            "extract": val,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-META-018")
def validate_cover_manifest_link(book_details, rule_config=None):
    """<meta name="cover"> content must resolve to an item id in the manifest."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    cover_meta = soup.find("meta", attrs={"name": "cover"})
    if cover_meta is None:
        return {"issues_count": 0, "issues": []}
    content = (cover_meta.get("content") or "").strip()
    if not content:
        return {"issues_count": 0, "issues": []}
    item = soup.find("item", attrs={"id": content})
    if item is None:
        return {"issues_count": 1, "issues": [{
            "type": "cover_manifest_missing",
            "message": f"<meta name=\"cover\" content=\"{content}\"/> does not match any <item id=...> in the manifest.",
            "category": "Error",
            "line_number": _find_line(lines, 'name="cover"'),
            "extract": content,
        }]}
    return {"issues_count": 0, "issues": []}


# ── Aspen accessibility metadata strict-value assertions ──────────────────

_REQUIRED_HAZARDS = {"noSoundHazard", "noMotionSimulationHazard", "none"}
_REQUIRED_ACCESS_MODES = {"textual", "visual"}
_REQUIRED_ACCESS_MODE_SUFFICIENT = {"textual,visual", "textual"}


@rule("ASP-META-011")
def validate_accessibility_hazards_strict(book_details, rule_config=None):
    """Aspen requires the three specific hazard values: noSoundHazard,
    noMotionSimulationHazard, and none.
    """
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessibilityHazard"})
    }
    missing = sorted(_REQUIRED_HAZARDS - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    missing_tags = " ".join(f'<meta property="schema:accessibilityHazard">{m}</meta>' for m in missing)
    return {"issues_count": 1, "issues": [{
        "type": "accessibility_hazard_values_missing",
        "message": (
            "All 3 accessibility hazard tags are mandatory: 'noSoundHazard', 'noMotionSimulationHazard', and 'none'. "
            f"Missing tag(s): {missing_tags}"
        ),
        "category": "Error",
        "line_number": _find_line(lines, "accessibilityHazard") or _find_line(lines, "<metadata"),
        "extract": "accessibilityHazard",
    }]}


@rule("ASP-META-012")
def validate_access_modes_strict(book_details, rule_config=None):
    """Aspen requires both accessMode=textual AND accessMode=visual."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessMode"})
    }
    missing = sorted(_REQUIRED_ACCESS_MODES - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    missing_tags = " ".join(f'<meta property="schema:accessMode">{m}</meta>' for m in missing)
    return {"issues_count": 1, "issues": [{
        "type": "access_mode_missing",
        "message": (
            "Both access mode tags are mandatory: 'textual' and 'visual'. "
            f"Missing tag(s): {missing_tags}"
        ),
        "category": "Error",
        "line_number": _find_line(lines, "accessMode") or _find_line(lines, "<metadata"),
        "extract": "accessMode",
    }]}


@rule("ASP-META-013")
def validate_access_mode_sufficient_strict(book_details, rule_config=None):
    """Aspen requires both accessModeSufficient values: 'textual,visual' and 'textual'."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "").replace(" ", "")
        for m in soup.find_all("meta", attrs={"property": "schema:accessModeSufficient"})
    }
    missing = sorted(_REQUIRED_ACCESS_MODE_SUFFICIENT - present)
    if not missing:
        return {"issues_count": 0, "issues": []}
    missing_tags = " ".join(f'<meta property="schema:accessModeSufficient">{m}</meta>' for m in missing)
    return {"issues_count": 1, "issues": [{
        "type": "access_mode_sufficient_missing",
        "message": (
            "Both access mode sufficient tags are mandatory: 'textual,visual' and 'textual'. "
            f"Missing tag(s): {missing_tags}"
        ),
        "category": "Error",
        "line_number": _find_line(lines, "accessModeSufficient") or _find_line(lines, "<metadata"),
        "extract": "accessModeSufficient",
    }]}


# ── Creator count parity with Front Matter ────────────────────────────────

import glob
import os


def _find_front_matter_file(epub: str) -> str | None:
    """Locate a chapter that looks like the front-matter / title page."""
    candidates = []
    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True) + glob.glob(os.path.join(epub, "**", "*.html"), recursive=True):
        base = os.path.basename(xhtml).lower()
        if any(k in base for k in ("front_matter", "frontmatter", "titlepage", "title_page", "title", "fm", "tp", "prelim")):
            candidates.append(xhtml)
    return sorted(candidates)[0] if candidates else None


def _count_authors_in_front_matter(path: str) -> int | None:
    """Best-effort count of author names on a front-matter page."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")
    except Exception:  # noqa: BLE001
        return None

    # 1. Check for class hints (author, byline, etc.)
    for cls_hint in ("author", "authorname", "byline", "contributor"):
        els = soup.find_all(class_=re.compile(cls_hint, re.IGNORECASE))
        if len(els) >= 1:
            names = [e.get_text(strip=True) for e in els if e.get_text(strip=True)]
            total = 0
            for n in names:
                parts = re.split(r",|\band\b", n)
                total += sum(1 for p in parts if p.strip())
            if total:
                return total

    # 2. Look for "By Author Name" line in <p> / <div> elements
    for p in soup.find_all(["p", "div"]):
        text = p.get_text(" ", strip=True)
        m = re.search(r"\bby\s+([A-Z][a-zA-Z\.\s,]+)", text, re.IGNORECASE)
        if m:
            parts = re.split(r",|\band\b", m.group(1))
            names = [p.strip() for p in parts if p.strip() and len(p.strip().split()) >= 1]
            if names:
                return len(names)

    return None


@rule("ASP-META-014")
def validate_creator_count_matches_front_matter(book_details, rule_config=None):
    """Count of <dc:creator> in OPF should equal number of authors on the Front Matter page."""
    epub = book_details.get("epub_path") or book_details.get("epub_root") or ""
    if not epub and "full_path" in book_details:
        p = book_details["full_path"]
        for _ in range(5):
            p = os.path.dirname(p)
            if os.path.basename(p).lower() == "oebps" or os.path.isfile(os.path.join(p, "mimetype")):
                epub = p
                break

    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    opf_creators = soup.find_all("dc:creator")
    opf_count = len(opf_creators)
    if opf_count == 0:
        return {"issues_count": 1, "issues": [{
            "type": "creator_missing",
            "message": "<dc:creator> (Author) is missing in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}

    fm_path = _find_front_matter_file(epub)
    if not fm_path:
        return {"issues_count": 0, "issues": []}

    fm_name = os.path.basename(fm_path)
    fm_count = _count_authors_in_front_matter(fm_path)
    lines = _load_opf_info(book_details)[2] if soup else []

    if fm_count is None:
        return {"issues_count": 1, "issues": [{
            "type": "creator_count_unverifiable",
            "message": f"Front Matter file '{fm_name}' was found, but no author names could be detected to verify against OPF <dc:creator> count ({opf_count}).",
            "category": "Warning",
            "line_number": _find_line(lines, "dc:creator") or _find_line(lines, "<metadata"),
            "extract": "dc:creator",
        }]}

    if opf_count != fm_count:
        return {"issues_count": 1, "issues": [{
            "type": "creator_count_mismatch",
            "message": f"OPF declares {opf_count} <dc:creator> tag(s), but Front Matter page ({fm_name}) lists {fm_count} author(s).",
            "category": "Error",
            "line_number": _find_line(lines, "dc:creator") or _find_line(lines, "<metadata"),
            "extract": "dc:creator",
        }]}

    return {"issues_count": 0, "issues": []}


@rule("ASP-META-015")
def validate_dcterms_modified(book_details, rule_config=None):
    """<meta property="dcterms:modified"> must be present with valid ISO timestamp."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "dcterms:modified"})
    if meta is None:
        return {"issues_count": 1, "issues": [{
            "type": "dcterms_modified_missing",
            "message": "<meta property=\"dcterms:modified\"> is missing in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    val = meta.get_text(strip=True)
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", val):
        return {"issues_count": 1, "issues": [{
            "type": "dcterms_modified_invalid",
            "message": f"<meta property=\"dcterms:modified\"> timestamp must end with 'Z' for UTC (YYYY-MM-DDTHH:MM:SSZ). Found: '{val}'",
            "category": "Error",
            "line_number": _find_line(lines, "dcterms:modified"),
            "extract": val,
        }]}
    return {"issues_count": 0, "issues": []}


_A11Y_FEATURE_MAP = {
    "displaytransformability": "displayTransformability",
    "printpagenumbers": "printPageNumbers",
    "readingorder": "readingOrder",
    "structuralnavigation": "structuralNavigation",
    "tableofcontents": "tableOfContents",
}


@rule("ASP-META-016")
def validate_accessibility_features(book_details, rule_config=None):
    """Aspen requires accessibilityFeature: displayTransformability, printPageNumbers, readingOrder, structuralNavigation, tableOfContents."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    present = {
        (m.get_text(strip=True) or "").lower()
        for m in soup.find_all("meta", attrs={"property": "schema:accessibilityFeature"})
    }
    missing_keys = sorted(set(_A11Y_FEATURE_MAP.keys()) - present)
    if not missing_keys:
        return {"issues_count": 0, "issues": []}
    missing_names = [_A11Y_FEATURE_MAP[k] for k in missing_keys]
    missing_tags = " ".join(f'<meta property="schema:accessibilityFeature">{name}</meta>' for name in missing_names)
    return {"issues_count": 1, "issues": [{
        "type": "accessibility_feature_missing",
        "message": (
            "All 5 accessibility feature tags are mandatory: 'displayTransformability', 'printPageNumbers', 'readingOrder', 'structuralNavigation', and 'tableOfContents'. "
            f"Missing tag(s): {missing_tags}"
        ),
        "category": "Error",
        "line_number": _find_line(lines, "accessibilityFeature") or _find_line(lines, "<metadata"),
        "extract": "accessibilityFeature",
    }]}


@rule("ASP-META-017")
def validate_accessibility_summary_present(book_details, rule_config=None):
    """<meta property="schema:accessibilitySummary"> must be present and non-empty."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    meta = soup.find("meta", attrs={"property": "schema:accessibilitySummary"})
    if meta is None or not meta.get_text(strip=True):
        return {"issues_count": 1, "issues": [{
            "type": "accessibility_summary_missing",
            "message": "<meta property=\"schema:accessibilitySummary\"> is missing or empty in OPF.",
            "category": "Error",
            "line_number": _find_line(lines, "<metadata"),
            "extract": "<metadata",
        }]}
    return {"issues_count": 0, "issues": []}

@rule("GWP-META-000")
def validate_gwp_opf_version(book_details, rule_config=None):
    """Check OPF file in Chrome. Version="3.0" should be at the top of the page within the package information."""
    soup, opf_path, lines = _load_opf_info(book_details)
    if soup is None:
        return {"issues_count": 0, "issues": []}
    
    package = soup.find("package")
    if not package:
        # Fallback if package is namespaced
        package = soup.find(lambda tag: tag.name.endswith("package"))

    if package and package.get("version") != "3.0":
        return {"issues_count": 1, "issues": [{
            "type": "opf_version_not_3_0",
            "message": f"OPF package version is '{package.get('version')}', expected '3.0'.",
            "category": "Error",
            "line_number": _find_line(lines, "<package"),
            "extract": f"<package version=\"{package.get('version')}\""
        }]}
    elif not package:
        return {"issues_count": 1, "issues": [{
            "type": "opf_package_missing",
            "message": "OPF package tag is missing.",
            "category": "Error",
            "line_number": 1,
            "extract": ""
        }]}
        
    return {"issues_count": 0, "issues": []}
