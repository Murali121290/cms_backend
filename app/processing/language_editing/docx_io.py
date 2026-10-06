"""
DOCX reader and Word Tracked Changes exporter for Ninja Inkflow Language Editing.
Writes accepted edits back as Word revision marks (w:ins / w:del) with author="LangQA".
"""
import copy
import datetime
import itertools
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

import re

_ids = itertools.count(1)


MARKUP_TAG_RE = re.compile(
    r"</?[A-Za-z0-9_\-\.]+(\s+[^>]*|\s*)>|\[/?[A-Za-z0-9_\-\.]+(\s+[^\]]*|\s*)\]",
    re.IGNORECASE
)


def is_markup_tag_paragraph(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return True
    cleaned = MARKUP_TAG_RE.sub("", t).strip()
    return len(cleaned) == 0


def is_heading_style(style_name: str, text: str) -> bool:
    s = (style_name or "").strip().lower()
    t = (text or "").strip()
    
    # Check style name
    if s.startswith(("heading", "head", "h1", "h2", "h3", "h4", "h5", "h6")) or s in {
        "pt", "cn", "ct", "obj", "obj1", "part title", "chapter number", "chapter title", "title"
    }:
        return True
        
    # Check text tag prefix patterns e.g. <H1-INTRO>, <H2-SUB>, <PT>, <CN>, <CT>, <OBJ1>, <FM-TITLE>
    if re.match(r"^<(H[1-6](-[A-Z0-9]+)?|PT|CN|CT|OBJ[0-9]*|TITLE|PART|CHAPTER|FM-[A-Z0-9]+)[^>]*>", t, re.IGNORECASE):
        return True
        
    return False


def is_reference_style(style_name: str, text: str) -> bool:
    s = (style_name or "").strip().upper()
    t = (text or "").strip()
    if s in {"REF-U", "REF-N", "REF", "REFERENCE", "REFERENCES", "REFERENCE-NUMBERED", "REFERENCE-ALPHABETICAL"} or s.startswith("BIB"):
        return True
    if t.upper().startswith(("<REF-U>", "<REF-N>", "<REF>", "<BIB>")):
        return True
    return False


def read_paragraphs(path: str) -> tuple[Document, list[tuple[int, str]]]:
    """Return python-docx Document object and filtered list of (paragraph_index, paragraph_text)."""
    doc = Document(path)
    paras = []
    
    in_front_matter = False
    in_ref_block = False
    
    for i, p in enumerate(doc.paragraphs):
        raw_text = p.text or ""
        text = raw_text.strip()
        if not text:
            continue
            
        t_lower = text.lower()
        
        # Check boundary tags
        if "<front>" in t_lower:
            in_front_matter = True
        if "<body>" in t_lower:
            in_front_matter = False
            if t_lower == "<body>":
                continue
                
        if "<ref-open>" in t_lower:
            in_ref_block = True
        if "<ref-close>" in t_lower:
            in_ref_block = False
            if t_lower == "<ref-close>":
                continue
                
        # Skip if currently inside front matter or reference block, or standalone boundary tag
        if in_front_matter or in_ref_block or t_lower in ("<front>", "<ref-open>"):
            continue
            
        # Skip paragraphs that consist purely of markup tags e.g. <FIG3.4>, <TAB3.2>, <BXM>, </BXM>, <EXT>, </EXT>
        if is_markup_tag_paragraph(text):
            continue
            
        style_name = p.style.name if p.style else ""
        
        # Skip headings
        if is_heading_style(style_name, text):
            continue
            
        # Skip reference styles (REF-U, REF-N, etc.)
        if is_reference_style(style_name, text):
            continue
            
        paras.append((i, raw_text))
        
    return doc, paras


def _run_at(runs: list, offset: int) -> tuple[int, int]:
    """Return (run_index, offset_within_run) for a char offset in paragraph text."""
    pos = 0
    for i, r in enumerate(runs):
        n = len(r.text)
        if offset <= pos + n:
            return i, offset - pos
        pos += n
    if runs:
        return len(runs) - 1, len(runs[-1].text)
    return 0, 0


def _mk_run(rPr, text: str, deltext: bool = False):
    r = OxmlElement("w:r")
    if rPr is not None:
        r.append(copy.deepcopy(rPr))
    t = OxmlElement("w:delText" if deltext else "w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = text
    r.append(t)
    return r


def _wrap(tag: str, author: str, date: str, child):
    el = OxmlElement(tag)                     # w:ins or w:del
    el.set(qn("w:id"), str(next(_ids)))
    el.set(qn("w:author"), author)
    el.set(qn("w:date"), date)
    el.append(child)
    return el


def apply_tracked_change(
    paragraph,
    start: int,
    end: int,
    new_text: str,
    author: str = "LangQA",
    date: str | None = None
):
    """
    Replaces paragraph text[start:end] with new_text as a Word tracked change.
    Inserts w:del for deleted text and w:ins for inserted text.
    """
    date = date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    runs = paragraph.runs
    if not runs:
        return paragraph

    si, so = _run_at(runs, start)
    ei, eo = _run_at(runs, end)

    if si != ei:
        # Multi-run span fallback: handle first run
        eo = len(runs[si].text)

    run = runs[si]
    rPr = run._r.find(qn("w:rPr"))
    text = run.text
    pre, old, post = text[:so], text[so:eo], text[eo:]

    run.text = pre                            # Keep leading part in original run
    anchor = run._r
    seq = []

    if old:
        seq.append(_wrap("w:del", author, date, _mk_run(rPr, old, deltext=True)))
    if new_text:
        seq.append(_wrap("w:ins", author, date, _mk_run(rPr, new_text)))
    if post:
        seq.append(_mk_run(rPr, post))

    for el in reversed(seq):                  # Insert elements right after anchor run
        anchor.addnext(el)

    return paragraph


def apply_highlight_change(
    paragraph,
    start: int,
    end: int,
    color: str = "yellow"
):
    """
    Applies background highlight color (e.g. 'yellow', 'cyan', 'magenta') to paragraph text[start:end] in Word XML.
    Does NOT delete or replace any text.
    """
    runs = paragraph.runs
    if not runs:
        return paragraph

    si, so = _run_at(runs, start)
    ei, eo = _run_at(runs, end)

    if si != ei:
        eo = len(runs[si].text)

    run = runs[si]
    rPr = run._r.find(qn("w:rPr"))

    text = run.text
    pre, target, post = text[:so], text[so:eo], text[eo:]

    run.text = pre
    anchor = run._r
    seq = []

    if target:
        hl_rPr = copy.deepcopy(rPr) if rPr is not None else OxmlElement("w:rPr")
        hl_el = OxmlElement("w:highlight")
        hl_el.set(qn("w:val"), color)
        hl_rPr.append(hl_el)
        seq.append(_mk_run(hl_rPr, target))

    if post:
        seq.append(_mk_run(rPr, post))

    for el in reversed(seq):
        anchor.addnext(el)

    return paragraph

