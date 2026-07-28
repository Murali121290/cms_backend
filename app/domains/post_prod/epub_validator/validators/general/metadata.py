"""General OPF metadata validators.

Presence checks for the standard EPUB metadata every publication should carry,
plus the WCAG accessibility metadata recommended by EPUB Accessibility 1.1.
Value-shape enforcement lives in customer-specific validators.
"""

import os
import re

from bs4 import BeautifulSoup

from ...engine.registry import rule


_DC_NS = "http://purl.org/dc/elements/1.1/"


def _find_opf(epub: str) -> str | None:
    for root, _dirs, files in os.walk(epub):
        for f in files:
            if f.lower().endswith(".opf"):
                return os.path.join(root, f)
    return None


def _parse_opf(epub: str) -> tuple[BeautifulSoup | None, str | None]:
    opf = _find_opf(epub)
    if not opf:
        return None, None
    try:
        with open(opf, "r", encoding="utf-8") as f:
            return BeautifulSoup(f.read(), "xml"), opf
    except Exception:  # noqa: BLE001
        return None, opf


def _dc(soup: BeautifulSoup, name: str):
    """Return all <dc:name> elements regardless of prefix binding."""
    els = soup.find_all(name, {"xmlns": _DC_NS}) or soup.find_all(f"dc:{name}")
    if not els:
        # Fallback: any element with local name matching, ignoring namespace.
        els = [t for t in soup.find_all(True) if t.name.split(":")[-1] == name]
    return els


def _metas_by_property(soup: BeautifulSoup, prop: str) -> list:
    return [m for m in soup.find_all("meta") if (m.get("property") or "").strip() == prop]


def _metas_by_name(soup: BeautifulSoup, name: str) -> list:
    return [m for m in soup.find_all("meta") if (m.get("name") or "").strip() == name]


_REQUIRED_DC = [
    ("title", "Error"),
    ("creator", "Error"),
    ("identifier", "Error"),
    ("language", "Error"),
    ("publisher", "Warning"),
    ("date", "Warning"),
]


@rule("META001")
def validate_opf_required_metadata(book_details):
    """Required Dublin Core metadata + dcterms:modified + cover reference."""
    epub = book_details["epub_path"]
    soup, opf = _parse_opf(epub)
    if soup is None:
        return {"issues_count": 1, "issues": [{
            "type": "opf_missing",
            "message": "OPF package file not found or unreadable.",
            "category": "Error",
        }]}

    rel_opf = os.path.relpath(opf, epub) if opf else None
    issues = []

    for tag, severity in _REQUIRED_DC:
        els = _dc(soup, tag)
        if not els:
            issues.append({
                "type": f"missing_dc_{tag}",
                "message": f"OPF is missing required <dc:{tag}> element.",
                "category": severity,
                "file_path": rel_opf,
            })
        else:
            first = els[0]
            if not (first.string or "").strip():
                issues.append({
                    "type": f"empty_dc_{tag}",
                    "message": f"<dc:{tag}> exists but has no text content.",
                    "category": "Warning",
                    "file_path": rel_opf,
                })

    modified = _metas_by_property(soup, "dcterms:modified")
    if not modified:
        issues.append({
            "type": "missing_dcterms_modified",
            "message": "OPF is missing <meta property=\"dcterms:modified\">.",
            "category": "Error",
            "file_path": rel_opf,
        })
    else:
        val = (modified[0].string or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", val):
            issues.append({
                "type": "bad_dcterms_modified",
                "message": f"dcterms:modified must be ISO 8601 UTC (YYYY-MM-DDTHH:MM:SSZ); got '{val}'.",
                "category": "Warning",
                "file_path": rel_opf,
            })

    # <meta name="cover" content="..."/> — legacy cover pointer required by many readers.
    cover_meta = _metas_by_name(soup, "cover")
    if not cover_meta:
        issues.append({
            "type": "missing_cover_meta",
            "message": "OPF is missing <meta name=\"cover\" content=\"...\"/> pointing at the cover image manifest id.",
            "category": "Warning",
            "file_path": rel_opf,
        })
    else:
        content = (cover_meta[0].get("content") or "").strip()
        if not content:
            issues.append({
                "type": "empty_cover_meta",
                "message": "<meta name=\"cover\"> has empty content attribute.",
                "category": "Warning",
                "file_path": rel_opf,
            })

    return {"issues_count": len(issues), "issues": issues}


_A11Y_HAZARDS = {"noSoundHazard", "noMotionSimulationHazard", "noFlashingHazard", "none", "unknown"}
_A11Y_FEATURES_REQUIRED = {
    "displayTransformability",
    "printPageNumbers",
    "readingOrder",
    "structuralNavigation",
    "tableOfContents",
}
_A11Y_MODES_REQUIRED = {"textual"}


@rule("META002")
def validate_opf_accessibility_metadata(book_details):
    """Accessibility metadata required by EPUB Accessibility 1.1 / WCAG 2.2 AA."""
    epub = book_details["epub_path"]
    soup, opf = _parse_opf(epub)
    if soup is None:
        return {"issues_count": 0, "issues": []}

    rel_opf = os.path.relpath(opf, epub) if opf else None
    issues = []

    hazards = {(m.string or "").strip() for m in _metas_by_property(soup, "schema:accessibilityHazard")}
    if not hazards:
        issues.append({
            "type": "missing_accessibility_hazard",
            "message": "OPF has no <meta property=\"schema:accessibilityHazard\">.",
            "category": "Error",
            "file_path": rel_opf,
        })
    else:
        for h in hazards:
            if h not in _A11Y_HAZARDS:
                issues.append({
                    "type": "unknown_accessibility_hazard",
                    "message": f"schema:accessibilityHazard value '{h}' is not in the standard vocabulary.",
                    "category": "Warning",
                    "file_path": rel_opf,
                })

    features = {(m.string or "").strip() for m in _metas_by_property(soup, "schema:accessibilityFeature")}
    for req in _A11Y_FEATURES_REQUIRED:
        if req not in features:
            issues.append({
                "type": "missing_accessibility_feature",
                "message": f"OPF is missing <meta property=\"schema:accessibilityFeature\">{req}</meta>.",
                "category": "Warning",
                "file_path": rel_opf,
            })

    summary = _metas_by_property(soup, "schema:accessibilitySummary")
    if not summary:
        issues.append({
            "type": "missing_accessibility_summary",
            "message": "OPF is missing <meta property=\"schema:accessibilitySummary\">.",
            "category": "Warning",
            "file_path": rel_opf,
        })

    modes = {(m.string or "").strip() for m in _metas_by_property(soup, "schema:accessMode")}
    for req in _A11Y_MODES_REQUIRED:
        if req not in modes:
            issues.append({
                "type": "missing_access_mode",
                "message": f"OPF is missing <meta property=\"schema:accessMode\">{req}</meta>.",
                "category": "Warning",
                "file_path": rel_opf,
            })

    sufficient = _metas_by_property(soup, "schema:accessModeSufficient")
    if not sufficient:
        issues.append({
            "type": "missing_access_mode_sufficient",
            "message": "OPF is missing <meta property=\"schema:accessModeSufficient\">.",
            "category": "Warning",
            "file_path": rel_opf,
        })

    return {"issues_count": len(issues), "issues": issues}
