"""S4C Editorial Style Sheet (.docx) built from a saved stylesheet (stylesheet.json payload).

``build_style_sheet_docx(data, project)`` returns the bytes of a Word document with:
  S4C logo + "S4C EDITORIAL STYLESHEET", project facts, a summary strip, and sections
  1 House style rules (enabled rules, by domain), Word list, Organization names,
  Abbreviations and symbols, Units and conventions, Notes and sign-off.
Sections without data are left out and the remaining ones are numbered 1, 2, 3, ...

``data`` is the stylesheet JSON exactly as written to CE support/Style sheet template:
``_serialize_stylesheet(ss).model_dump(mode="json")`` plus ``format`` and ``content_hash``.
"""
from __future__ import annotations

import datetime
import io
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

logger = logging.getLogger(__name__)

DOC_TITLE = "S4C EDITORIAL STYLESHEET"
DOC_CATEGORY = "S4C Editorial Style Sheet"
IDENTIFIER_PREFIX = "s4c-stylesheet:"
SNAPSHOT_NS = "urn:s4c:editorial-stylesheet:1"
# Hidden table captions (see _caption); the importer reads tables by these keys
CAP_RULES = "s4c:rules"
CAP_WORDS = "s4c:word_replacements"
CAP_WORD_LIST = "s4c:word_list"
CAP_ORGS = "s4c:org_names"
CAP_ACRONYMS = "s4c:acronyms"
CAP_REGISTERED = "s4c:registered"
CAP_AVOID = "s4c:avoid_words"
CAP_UNITS = "s4c:units"
TERM_SEPARATOR = "; "  # approved terms may contain commas ("Silver Spring, MD")
LOGO_PATH = Path(__file__).resolve().parents[1] / "static" / "logo.png"

BLUE = RGBColor(0x1E, 0x5A, 0xA8)      # logo blue
ORANGE = RGBColor(0xF2, 0x8C, 0x28)    # logo orange
RED = RGBColor(0xB9, 0x1C, 0x1C)
INK = RGBColor(0x0F, 0x17, 0x2A)
MUTED = RGBColor(0x64, 0x74, 0x8B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
HEAD_FILL = "1E5AA8"
BAND_FILL = "F1F5F9"
SOFT_FILL = "FFF4E8"


# --------------------------------------------------------------------------- low-level helpers
def _shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def _cell_margins(table, top=60, bottom=60, left=90, right=90) -> None:
    mar = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    _tblpr_insert(table, mar)


def _tblpr_insert(table, el) -> None:
    """Add a tblPr child before w:tblLook (schema order), else at the end."""
    tbl_pr = table._tbl.tblPr
    look = tbl_pr.find(qn("w:tblLook"))
    if look is not None:
        look.addprevious(el)
    else:
        tbl_pr.append(el)


def _caption(table, key: str) -> None:
    """Hidden table title (alt text) marking what the table holds, e.g. "s4c:rules".

    Word keeps it when the document is edited; the importer uses it to read edits back.
    """
    cap = OxmlElement("w:tblCaption")
    cap.set(qn("w:val"), key)
    table._tbl.tblPr.append(cap)  # tblCaption comes after tblLook


def _embed_snapshot(doc, data: dict) -> None:
    """Store the exported stylesheet (rules + profile) in a custom XML part.

    The importer compares an edited .docx with this snapshot, so only the editor's own
    edits are proposed, even when the stylesheet changed in the app after the export.
    """
    import json
    import uuid
    from xml.sax.saxutils import escape

    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.opc.packuri import PackURI
    from docx.opc.part import Part

    snapshot = {k: data.get(k) for k in ("id", "name", "content_hash", "ce_rules", "style_profile")}
    body = escape(json.dumps(snapshot, ensure_ascii=False, default=str))
    package = doc.part.package  # the default template already has customXml/item1.xml
    item = Part(package.next_partname("/customXml/item%d.xml"), "application/xml",
                f'<s4c:stylesheet xmlns:s4c="{SNAPSHOT_NS}">{body}</s4c:stylesheet>'.encode("utf-8"),
                doc.part.package)
    props = Part(
        PackURI(str(item.partname).replace("/item", "/itemProps")),
        "application/vnd.openxmlformats-officedocument.customXmlProperties+xml",
        ('<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
         '<ds:datastoreItem ds:itemID="{%s}" '
         'xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">'
         '<ds:schemaRefs/></ds:datastoreItem>' % str(uuid.uuid4()).upper()).encode("utf-8"),
        doc.part.package)
    item.relate_to(props, RT.CUSTOM_XML_PROPS)
    doc.part.relate_to(item, RT.CUSTOM_XML)


def _row_flag(row, tag: str) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    el = OxmlElement(f"w:{tag}")
    el.set(qn("w:val"), "true")
    tr_pr.append(el)


def _run(p, text: str, *, bold=False, color=None, size=9.0, mono=False, strike=False, italic=False):
    r = p.add_run(text)
    r.bold, r.italic = bold, italic
    r.font.size = Pt(size)
    r.font.strike = strike
    if mono:
        r.font.name = "Consolas"
    if color is not None:
        r.font.color.rgb = color
    return r


def _write(cell, text: str, *, align=None, **kw):
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    if align is not None:
        p.alignment = align
    _run(p, text, **kw)
    return p


def _sub(cell, text: str, **kw):
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    _run(p, text, **kw)
    return p


def _page_field(paragraph, size=7.5) -> None:
    run = paragraph.add_run()
    run.font.size = Pt(size)
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)


def _bottom_border(paragraph, color="F28C28", size=12) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    bdr.append(bottom)
    p_pr.append(bdr)


def _add_logo(paragraph, width_cm: float) -> bool:
    if not LOGO_PATH.is_file():
        return False
    try:
        paragraph.add_run().add_picture(str(LOGO_PATH), width=Cm(width_cm))
        return True
    except Exception as exc:  # unreadable image: export without the logo
        logger.warning("Style sheet export: could not add logo %s: %s", LOGO_PATH, exc)
        return False


class _Doc:
    """Thin wrapper that numbers sections and builds banded tables."""

    def __init__(self) -> None:
        self.doc = Document()
        self.section_no = 0

    def heading(self, title: str, intro: str | None = None) -> None:
        self.section_no += 1
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        _run(p, f"{self.section_no}  ", bold=True, color=BLUE, size=13)
        _run(p, title, bold=True, color=INK, size=13)
        if intro:
            q = self.doc.add_paragraph()
            q.paragraph_format.space_after = Pt(6)
            q.paragraph_format.keep_with_next = True
            _run(q, intro, color=MUTED, size=9)

    def subheading(self, title: str, note: str = "") -> None:
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.keep_with_next = True
        _run(p, title, bold=True, color=INK, size=10.5)
        if note:
            _run(p, f"   {note}", color=MUTED, size=8.5)

    def table(self, headers: list[str], widths: list, caption: str | None = None) -> Any:
        t = self.doc.add_table(rows=1, cols=len(headers))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        _cell_margins(t)
        if caption:
            _caption(t, caption)
        for i, h in enumerate(headers):
            c = t.rows[0].cells[i]
            _shade(c, HEAD_FILL)
            _write(c, h.upper(), bold=True, color=WHITE, size=8)
            c.width = widths[i]
        _row_flag(t.rows[0], "tblHeader")
        return t

    @staticmethod
    def row(t, widths: list, band: bool = False) -> list:
        row = t.add_row()
        _row_flag(row, "cantSplit")
        for i, w in enumerate(widths):
            row.cells[i].width = w
            if band:
                _shade(row.cells[i], BAND_FILL)
        return row.cells


# --------------------------------------------------------------------------- rule helpers
def _rules_module():
    try:
        from app.processing.manuscript_core.rules import ce_rules
    except ImportError:  # running with app/processing on sys.path
        from manuscript_core.rules import ce_rules  # type: ignore
    return ce_rules


def _clean_rules(raw: dict | None) -> dict:
    out = {}
    for k, v in (raw or {}).items():
        if not str(k).isdigit() or not isinstance(v, dict):
            continue
        out[str(k)] = {kk: vv for kk, vv in v.items() if vv is not None}
    return out


def _house_style(rule: dict, cfg: dict) -> tuple[str, str]:
    """(example form, option label) of the selected option; example '' for description-only options."""
    forms = rule.get("forms") or []
    try:
        i = int(cfg["option"]) - 1
    except (TypeError, ValueError):
        return "", f"Custom: {cfg['option']}"
    if not 0 <= i < len(forms):
        return "", f"Option {cfg['option']}"
    label, preview = forms[i].get("label", ""), forms[i].get("preview", "")
    if not preview or preview == label or preview in ("AQ", "as supplied") or len(preview) > 40:
        return "", label
    return preview, label


def _handling(ce_rules, sno: int, rule: dict, cfg: dict) -> str:
    if ce_rules.is_query_option(ce_rules.option_text(sno, cfg["option"])):
        return "Query"
    behaviour = rule.get("behaviour") or ""
    if behaviour == "Flag and suggest":
        return "Suggest" if rule.get("detectable") == "auto" else "Flag"
    return "Auto-fix" if behaviour.startswith("Auto") else "Flag"


def _val(project: Any, key: str) -> str:
    v = project.get(key) if isinstance(project, dict) else getattr(project, key, None)
    return "—" if v in (None, "") else str(v)


# --------------------------------------------------------------------------- main builder
def build_style_sheet_docx(data: dict, project: Any) -> bytes:
    ce_rules = _rules_module()
    catalog = ce_rules.by_sno()
    resolved = ce_rules.resolve_ce_config([], _clean_rules(data.get("ce_rules")))
    profile = data.get("style_profile") or {}
    name = data.get("name") or "Stylesheet"
    project_code = _val(project, "project_code")

    w = _Doc()
    doc = w.doc
    doc.core_properties.title = DOC_TITLE
    doc.core_properties.subject = f"{project_code} · {name}"
    # Machine-readable markers for importing an edited copy (kept by Word on save)
    doc.core_properties.category = DOC_CATEGORY
    if data.get("id") is not None:
        doc.core_properties.identifier = f"{IDENTIFIER_PREFIX}{data['id']}"
    if data.get("content_hash"):
        doc.core_properties.version = str(data["content_hash"])
    try:
        _embed_snapshot(doc, data)
    except Exception as exc:  # the import then compares with the current stylesheet
        logger.warning("Style sheet export: could not embed the stylesheet snapshot: %s", exc)
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.8)
    sec.top_margin, sec.bottom_margin = Cm(1.6), Cm(1.6)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(9.5)
    normal.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "Calibri")

    # Running header (pages 2+): small logo, title, project and stylesheet name
    sec.different_first_page_header_footer = True
    hp = sec.header.paragraphs[0]
    _add_logo(hp, 1.6)
    _run(hp, f"   {DOC_TITLE}", bold=True, color=BLUE, size=8)
    _run(hp, f"     {project_code} · {name}", color=MUTED, size=8)

    footer_text = (f"Generated from CE support/Style sheet template/stylesheet.json  ·  stylesheet #{data.get('id', '—')}"
                   f"  ·  content hash {str(data.get('content_hash') or '')[:12] or '—'}  ·  page ")
    for footer in (sec.footer, sec.first_page_footer):
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _run(fp, footer_text, color=MUTED, size=7.5)
        _page_field(fp)

    # First page: logo + title
    p = doc.add_paragraph()
    _add_logo(p, 4.5)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    _run(p, DOC_TITLE, bold=True, color=BLUE, size=18)
    _bottom_border(p)

    # No separate title block: the stylesheet name is in the running header and the
    # project / customer / category details are in the facts table below.

    # Project facts grid
    facts = [
        ("Project", project_code), ("Customer", _val(project, "client_name")),
        ("Edition", _val(project, "edition")), ("ISBN", _val(project, "isbn_no")),
        ("Book category", _val(project, "category")), ("Level of editing", _val(project, "copyediting_level")),
        ("Book type", str(profile.get("book_type") or "—").replace("_", " ").title()),
        ("List style", str(profile.get("list_style") or "—").title()),
        ("Stylesheet status", "Active" if data.get("is_active") else "Inactive"),
        ("Last updated", str(data.get("updated_at") or "—")[:10]),
        ("Generated", datetime.date.today().strftime("%d %b %Y")),
        ("Format", data.get("format") or "cms-stylesheet/1"),
    ]
    grid = doc.add_table(rows=3, cols=4)
    grid.style = "Table Grid"
    _cell_margins(grid, 80, 80, 110, 110)
    for i, (k, v) in enumerate(facts):
        c = grid.rows[i // 4].cells[i % 4]
        _shade(c, BAND_FILL)
        _write(c, k.upper(), bold=True, color=MUTED, size=7)
        _sub(c, v, bold=True, color=INK, size=10)

    # Summary strip
    enabled = [s for s, c in sorted(resolved.items()) if c["enabled"] and s in catalog]
    handling = {s: _handling(ce_rules, s, catalog[s], resolved[s]) for s in enabled}
    pairs = (profile.get("word_replacements") or []) + (profile.get("org_names") or [])
    stats = [
        (str(len(enabled)), f"rules applied (of {len(catalog)})"),
        (str(sum(1 for h in handling.values() if h == "Auto-fix")), "auto-fixed"),
        (str(sum(1 for h in handling.values() if h != "Auto-fix")), "suggested / flagged"),
        (str(len(pairs)), "word-list corrections"),
        (str(len(profile.get("acronyms_no_spellout") or [])), "acronyms never spelled out"),
    ]
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    st = doc.add_table(rows=1, cols=len(stats))
    _cell_margins(st, 90, 90, 100, 100)
    for i, (n, label) in enumerate(stats):
        c = st.rows[0].cells[i]
        _shade(c, SOFT_FILL)
        _write(c, n, bold=True, color=ORANGE, size=18, align=WD_ALIGN_PARAGRAPH.CENTER)
        q = _sub(c, label, color=MUTED, size=8)
        q.alignment = WD_ALIGN_PARAGRAPH.CENTER

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    _run(p, "How to read this sheet. ", bold=True, size=9)
    _run(p, "For every rule the house style is the form shown in blue. Other forms found in a manuscript are "
            "corrected to it during Technical Edit (Auto-fix), offered to the editor (Suggest), or raised for the "
            "editor or author (Flag / Query).", color=MUTED, size=9)

    # 1. House style rules (enabled only), by domain
    w.heading("House style rules", "Rules applied by Technical Edit, grouped by domain.")
    widths = [Cm(1.4), Cm(5.8), Cm(6.6), Cm(3.3)]
    groups: dict[str, list[int]] = defaultdict(list)
    for s in enabled:
        groups[catalog[s]["group"]].append(s)
    for group in sorted(groups, key=lambda g: min(groups[g])):
        w.subheading(group, f"{len(groups[group])} rules")
        t = w.table(["Rule", "Topic", "House style", "Handling"], widths, CAP_RULES)
        for k, s in enumerate(groups[group]):
            rule, cfg = catalog[s], resolved[s]
            example, label = _house_style(rule, cfg)
            c = w.row(t, widths, band=bool(k % 2))
            _write(c[0], f"R{s}", bold=True, mono=True, size=8.5)
            _write(c[1], rule["name"], bold=True, size=9)
            _sub(c[1], f"Severity: {cfg['severity']}", color=MUTED, size=7.5)
            if example:
                _write(c[2], example, bold=True, color=BLUE, mono=True, size=9)
                _sub(c[2], label, color=MUTED, size=7.5)
            else:
                _write(c[2], label, color=INK, size=8.5)
            h = handling[s]
            _write(c[3], h, bold=True, size=8, color=BLUE if h == "Auto-fix" else (MUTED if h == "Suggest" else RED))

    # Word list
    replacements = sorted(profile.get("word_replacements") or [], key=lambda x: str(x.get("replace", "")).lower())
    words = sorted({w_ for w_ in (profile.get("word_list") or []) if w_}, key=str.lower)
    if replacements or words:
        w.heading("Word list", "Preferred spellings and terms. Variants are corrected to the preferred form.")
        if replacements:
            w3 = [Cm(5.6), Cm(5.6), Cm(5.9)]
            t = w.table(["Use", "Not", "Note"], w3, CAP_WORDS)
            for k, pr in enumerate(replacements):
                c = w.row(t, w3, band=bool(k % 2))
                _write(c[0], str(pr.get("replace", "")), bold=True, color=BLUE, size=9)
                _write(c[1], str(pr.get("find", "")), color=RED, size=9, strike=True)
                _write(c[2], str(pr.get("note") or ""), color=MUTED, size=8)
        if words:
            w.subheading(f"Approved terms ({len(words)})")
            by_letter: dict[str, list[str]] = defaultdict(list)
            for term in words:
                by_letter[(re.sub(r"[^A-Za-z]", "", term)[:1] or "#").upper()].append(term)
            letters = sorted(by_letter)
            t = doc.add_table(rows=0, cols=3)
            _cell_margins(t, 40, 40, 80, 80)
            _caption(t, CAP_WORD_LIST)
            for i in range(0, len(letters), 3):
                row = t.add_row()
                for j in range(3):
                    if i + j < len(letters):
                        letter = letters[i + j]
                        _write(row.cells[j], letter, bold=True, color=BLUE, size=11)
                        _sub(row.cells[j], TERM_SEPARATOR.join(by_letter[letter]), size=8.5)

    # Organization names
    orgs = sorted(profile.get("org_names") or [], key=lambda x: str(x.get("replace", "")).lower())
    if orgs:
        w.heading("Organization names", "Correct forms of frequently misspelled organization names.")
        w2 = [Cm(8.6), Cm(8.5)]
        t = w.table(["Use", "Not"], w2, CAP_ORGS)
        for k, pr in enumerate(orgs):
            c = w.row(t, w2, band=bool(k % 2))
            _write(c[0], str(pr.get("replace", "")), bold=True, color=BLUE, size=9)
            _write(c[1], str(pr.get("find", "")), color=RED, size=9, strike=True)

    # Abbreviations and symbols
    acr = sorted(profile.get("acronyms_no_spellout") or [], key=str.lower)
    reg = profile.get("registered_terms") or []
    avoid = profile.get("avoid_words") or {}
    if acr or reg or avoid:
        w.heading("Abbreviations and symbols")
        # One borderless cell each, so editors can add terms and the importer finds them
        if acr:
            w.subheading("Never spelled out at first use", f"({len(acr)})")
            t = doc.add_table(rows=1, cols=1)
            _caption(t, CAP_ACRONYMS)
            _write(t.rows[0].cells[0], "   ".join(acr), mono=True, size=8.5)
        if reg:
            w.subheading("Registration mark (®) at first mention in each chapter; omitted after")
            t = doc.add_table(rows=1, cols=1)
            _caption(t, CAP_REGISTERED)
            _write(t.rows[0].cells[0], "   ".join(f"{t_}®" for t_ in reg), mono=True, size=8.5)
        if avoid:
            w.subheading("Words to avoid")
            w2 = [Cm(8.6), Cm(8.5)]
            t = w.table(["Avoid", "Use"], w2, CAP_AVOID)
            for k, (a, u) in enumerate(sorted(avoid.items())):
                c = w.row(t, w2, band=bool(k % 2))
                _write(c[0], str(a), color=RED, size=9, strike=True)
                _write(c[1], str(u), bold=True, color=BLUE, size=9)

    # Units and conventions (always present: book type / list style / unit style)
    units = profile.get("unit_style") or {}
    ic = profile.get("ic_preferred") or {}
    rows = [
        ("Time units in running text",
         "Written out (hour, minute)" if units.get("time_in_text") == "spelled" else ("Abbreviated" if units else "—")),
        ("Abbreviations in tables, figures, dosages",
         ", ".join(f"{k} → {v}" for k, v in (units.get("abbreviations") or {}).items()) or "—"),
        ("Blood pressure unit", units.get("pressure") or "—"),
        ("-ic / -ical preference",
         (f"-ic form ({len(ic)} terms, e.g. " + ", ".join(list(ic.values())[:4]) + ")") if ic else "—"),
        ("Book type", str(profile.get("book_type") or "—").replace("_", " ").title()),
        ("List style", str(profile.get("list_style") or "—").title()),
    ]
    w.heading("Units and conventions")
    wu = [Cm(6.5), Cm(10.6)]
    t = w.table(["Setting", "House style"], wu, CAP_UNITS)
    for k, (a, b) in enumerate(rows):
        c = w.row(t, wu, band=bool(k % 2))
        _write(c[0], a, bold=True, size=9)
        _write(c[1], b, size=9)

    # Notes and sign-off
    w.heading("Notes and sign-off")
    ws = [Cm(5.7), Cm(5.7), Cm(5.7)]
    t = w.table(["Prepared by", "Reviewed by (PE)", "Date"], ws)
    for cell in w.row(t, ws):
        _write(cell, " ", size=14)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def style_sheet_filename(name: str, project_code: str | None = None) -> str:
    base = re.sub(r"[^a-zA-Z0-9_\-]", "_", name or "stylesheet").strip("_") or "stylesheet"
    return f"{base}_Editorial_Style_Sheet.docx"
