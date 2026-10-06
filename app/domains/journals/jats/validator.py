"""JATS 1.3 validation: the bundled NLM Journal Publishing DTD plus publisher rules.

The document is parsed without loading its DOCTYPE, external entities or
network resources; the DTD from app/resources/jats/1.3 is applied explicitly.
"""
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable, List, Optional

from lxml import etree

DTD_DIR_13 = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "jats", "1.3"))
DTD_FILE_13 = "JATS-journalpublishing1-3-mathml3.dtd"

DTD_DIR_20 = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "jats", "2.0"))
DTD_FILE_20 = "journalpublishing.dtd"

XLINK_HREF = "{http://www.w3.org/1999/xlink}href"


@dataclass
class XmlFinding:
    rule_id: str
    severity: str
    title: str
    message: str
    line: Optional[int] = None
    element: Optional[str] = None
    detail: Optional[str] = None  # e.g. the unresolved ID or missing asset name


@lru_cache(maxsize=2)
def jats_dtd(version: str = "2.0") -> etree.DTD:
    if str(version).startswith("2") or version == "2.0":
        path = os.path.join(DTD_DIR_20, DTD_FILE_20)
        if os.path.exists(path):
            return etree.DTD(path)
    return etree.DTD(os.path.join(DTD_DIR_13, DTD_FILE_13))


def _classify(message: str):
    m = re.search(r'references an unknown ID "([^"]+)"', message)
    if m:
        return "DTD-IDREF", f"Reference to missing ID “{m.group(1)}”", m.group(1)
    m = re.search(r"ID (\S+) already defined", message)
    if m:
        return "DTD-ID", f"Duplicate ID “{m.group(1)}”", m.group(1)
    m = re.search(r"No declaration for element (\S+)", message)
    if m:
        return "DTD-ELEM", f"Element <{m.group(1)}> is not allowed in JATS", m.group(1)
    m = re.search(r"No declaration for attribute (\S+) of element (\S+)", message)
    if m:
        return "DTD-ATTR", f"Attribute {m.group(1)} is not allowed on <{m.group(2)}>", m.group(1)
    m = re.search(r"Element (\S+) content does not follow the DTD", message)
    if m:
        return "DTD-CONTENT", f"<{m.group(1)}> has content in the wrong order or missing required parts", m.group(1)
    m = re.search(r"Element (\S+) is not declared in (\S+) list of possible children", message)
    if m:
        return "DTD-CHILD", f"<{m.group(1)}> is not allowed inside <{m.group(2)}>", m.group(1)
    return "DTD-OTHER", "DTD validity error", None


HINTS = {
    ("DTD-CONTENT", "journal-meta"): "The journal record needs at least one ISSN (print or online). Add it to the journal, then convert again.",
}


def validate_jats(xml: bytes, assets: Optional[Iterable[str]] = None, dtd_version: str = "2.0") -> List[XmlFinding]:
    parser = etree.XMLParser(load_dtd=False, no_network=True, resolve_entities=False, huge_tree=False)
    try:
        doc = etree.fromstring(xml, parser)
    except etree.XMLSyntaxError as e:
        return [XmlFinding("XML-WF", "error", "XML is not well-formed", str(e), line=getattr(e, "lineno", None))]

    findings: List[XmlFinding] = []
    if doc.get("dtd-version") == "2.0" or b'journalpublishing.dtd' in xml or b'Journal Publishing DTD v2.0' in xml:
        dtd_version = "2.0"
    elif doc.get("dtd-version") == "1.3" or b'JATS-journalpublishing1-3' in xml or b'dtd/1.3' in xml:
        dtd_version = "1.3"
    dtd = jats_dtd(dtd_version)
    if not dtd.validate(doc):
        seen = set()
        for err in dtd.error_log.filter_from_errors():
            rule, title, detail = _classify(err.message)
            key = (rule, err.line, err.message)
            if key in seen:
                continue
            seen.add(key)
            message = f"article.xml:{err.line}: {err.message}"
            hint = HINTS.get((rule, detail))
            findings.append(XmlFinding(rule, "error", title, message + (f" — {hint}" if hint else ""), line=err.line, detail=detail))

    # Publisher rules (Schematron-style checks the DTD cannot express).
    for tw in doc.iter("table-wrap"):
        if tw.find("caption") is None:
            findings.append(XmlFinding("JATS-X03", "warning", "Table has no caption",
                                       f"<table-wrap id=\"{tw.get('id')}\"> must contain a <caption>.", line=tw.sourceline, detail=tw.get("id")))
    for fig in doc.iter("fig"):
        if fig.find("caption") is None:
            findings.append(XmlFinding("JATS-X04", "warning", "Figure has no caption",
                                       f"<fig id=\"{fig.get('id')}\"> should contain a <caption>.", line=fig.sourceline, detail=fig.get("id")))
    am = doc.find("front/article-meta")
    if am is not None and am.find("article-id[@pub-id-type='doi']") is None:
        findings.append(XmlFinding("JATS-M01", "warning", "Article DOI is missing",
                                   "article-meta has no <article-id pub-id-type=\"doi\">. Add the DOI to the article record.", line=am.sourceline))
    if assets is not None:
        names = set()
        for a in assets:
            base = os.path.basename(a).lower()
            names.add(base)
            unver = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", base)
            names.add(unver)
            unver_noext = re.sub(r"_v\d+$", "", base)
            names.add(unver_noext)
            fig_padded = re.sub(r"fig0+(\d+)", r"fig\1", unver)
            names.add(fig_padded)
            fig_unpadded = re.sub(r"fig(\d+)", lambda m: f"fig{int(m.group(1)):02d}", unver)
            names.add(fig_unpadded)

        for g in doc.iter("graphic", "inline-graphic"):
            href = g.get(XLINK_HREF) or ""
            if href:
                href_base = os.path.basename(href).lower()
                href_unver = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", href_base)
                href_fig_padded = re.sub(r"fig0+(\d+)", r"fig\1", href_unver)
                href_fig_unpadded = re.sub(r"fig(\d+)", lambda m: f"fig{int(m.group(1)):02d}", href_unver)

                if not ({href_base, href_unver, href_fig_padded, href_fig_unpadded} & names):
                    findings.append(XmlFinding("PKG-A01", "warning", f"Image “{href}” is not in the article files",
                                               f"<{g.tag} xlink:href=\"{href}\"> has no matching art file. Upload it or relink the graphic.",
                                               line=g.sourceline, detail=href))
    return findings
