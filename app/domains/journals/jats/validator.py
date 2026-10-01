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

DTD_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "resources", "jats", "1.3")
DTD_FILE = "JATS-journalpublishing1-3-mathml3.dtd"
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


@lru_cache(maxsize=1)
def jats_dtd() -> etree.DTD:
    return etree.DTD(os.path.abspath(os.path.join(DTD_DIR, DTD_FILE)))


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


def validate_jats(xml: bytes, assets: Optional[Iterable[str]] = None) -> List[XmlFinding]:
    parser = etree.XMLParser(load_dtd=False, no_network=True, resolve_entities=False, huge_tree=False)
    try:
        doc = etree.fromstring(xml, parser)
    except etree.XMLSyntaxError as e:
        return [XmlFinding("XML-WF", "error", "XML is not well-formed", str(e), line=getattr(e, "lineno", None))]

    findings: List[XmlFinding] = []
    dtd = jats_dtd()
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
        names = {os.path.basename(a).lower() for a in assets}
        for g in doc.iter("graphic", "inline-graphic"):
            href = g.get(XLINK_HREF) or ""
            if href and os.path.basename(href).lower() not in names:
                findings.append(XmlFinding("PKG-A01", "warning", f"Image “{href}” is not in the article files",
                                           f"<{g.tag} xlink:href=\"{href}\"> has no matching art file. Upload it or relink the graphic.",
                                           line=g.sourceline, detail=href))
    return findings
