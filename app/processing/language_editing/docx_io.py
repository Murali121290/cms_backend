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
    # Normalize space/hyphen/underscore variants so "ChapterNumber", "chapter_number",
    # "Chapter-Number" and "Chapter Number" all collapse to the same key.
    s_norm = re.sub(r"[\s\-_]+", "", s)
    t = (text or "").strip()

    # Check style name
    if s.startswith(("heading", "head", "h1", "h2", "h3", "h4", "h5", "h6")) or s_norm in {
        "pt", "cn", "ct", "obj", "obj1",
        "parttitle", "chapternumber", "chaptertitle", "chapterauthor", "title",
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


# Phase D: per-paragraph role classifier for the abbreviations module.
# Walks ``doc.paragraphs`` once and returns a role dict per index covering
# the metadata AB11/AB12/AB14/AB15/AB16 need to differentiate manuscript
# regions (heading, title, caption, abstract, table, figure, body).

_HEADING_STYLE_LEVEL_RE = re.compile(r"heading\s*(\d+)", re.IGNORECASE)
_HEADING_TAG_RE = re.compile(r"^<\s*h(\d+)\b", re.IGNORECASE)
_CAPTION_TEXT_RE = re.compile(r"^(table|figure|fig\.)\s+\d", re.IGNORECASE)
_TITLE_TAG_RE = re.compile(r"^<\s*(title|ct|pt)\b", re.IGNORECASE)


def classify_paragraphs(doc) -> dict[int, dict]:
    """Return per-paragraph role metadata keyed by python-docx index.

    Each value is a dict with:
      * ``style``             — raw ``p.style.name`` or ''
      * ``role``              — ``body`` | ``heading`` | ``title`` |
                                ``caption`` | ``reference``
      * ``level``             — heading level 1–9 (None if not a heading)
      * ``chapter_boundary``  — True on top-level headings / Title paragraphs
      * ``in_abstract``       — True inside ``<abstract>…</abstract>`` /
                                ``<ABS>`` / Abstract style
      * ``in_table``          — True inside ``<table>…</table>`` or Table-
                                styled runs
      * ``in_figure``         — True inside ``<figure>`` / ``<fig>`` …

    The role / in_* flags carry through adjacent paragraphs until the
    closing tag is seen. The paragraphs between those tags all share the
    same flag — a reviewer reading the manuscript needs that continuity.
    """
    out: dict[int, dict] = {}
    in_abstract = False
    in_table = False
    in_figure = False
    for i, p in enumerate(doc.paragraphs):
        text = (p.text or "").strip()
        style = (p.style.name if p.style else "") or ""
        tl = text.lower()

        # Boundary tags (open BEFORE classifying this paragraph; close
        # AFTER so a tag paragraph itself is still inside its region).
        if "<abstract>" in tl or style.strip().lower() == "abstract":
            in_abstract = True
        if "<table>" in tl:
            in_table = True
        if "<figure>" in tl or "<fig>" in tl:
            in_figure = True

        role = "body"
        level: int | None = None
        chapter_boundary = False
        style_lc = style.strip().lower()

        if is_heading_style(style, text):
            role = "heading"
            m = _HEADING_STYLE_LEVEL_RE.search(style)
            if m:
                level = int(m.group(1))
            else:
                mt = _HEADING_TAG_RE.search(text)
                if mt:
                    level = int(mt.group(1))
            if level == 1 or style_lc.startswith("title") or style_lc in {
                "chapternumber", "chaptertitle", "parttitle",
            }:
                chapter_boundary = True
                role = "title" if (
                    style_lc.startswith("title") or _TITLE_TAG_RE.match(text)
                    or style_lc in {"chaptertitle", "chapternumber", "parttitle"}
                ) else role
        elif _TITLE_TAG_RE.match(text) or style_lc.startswith("title"):
            role = "title"
            chapter_boundary = True
        elif is_reference_style(style, text):
            role = "reference"
        elif style_lc.startswith("caption") or _CAPTION_TEXT_RE.match(text):
            role = "caption"

        out[i] = {
            "style": style,
            "role": role,
            "level": level,
            "chapter_boundary": chapter_boundary,
            "in_abstract": in_abstract,
            "in_table": in_table,
            "in_figure": in_figure,
            "text": p.text or "",
        }

        # Closing tags take effect AFTER this paragraph's classification.
        if "</abstract>" in tl:
            in_abstract = False
        if "</table>" in tl:
            in_table = False
        if "</figure>" in tl or "</fig>" in tl:
            in_figure = False
    return out


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
    """Replace paragraph text[start:end] with ``new_text`` as a Word tracked change.

    Writes a ``w:del`` wrapping the removed content (keeping per-run ``w:rPr``
    for every fragment so bold/italic/font formatting survives) and a ``w:ins``
    for the new text. Supports spans that cross multiple runs — critical for
    hyphen-boundary fixes where Word often splits a compound across runs.

    Single-run fast path (``si == ei``) is preserved verbatim; multi-run only
    kicks in when a replacement actually straddles runs.
    """
    date = date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    runs = paragraph.runs
    if not runs:
        return paragraph

    si, so = _run_at(runs, start)
    ei, eo = _run_at(runs, end)

    if si == ei:
        # ── Single-run (fast path, byte-for-byte identical to the pre-Phase-4
        #    behaviour so unchanged callers see no diff). ──────────────────
        run = runs[si]
        rPr = run._r.find(qn("w:rPr"))
        text = run.text
        pre, old, post = text[:so], text[so:eo], text[eo:]

        run.text = pre
        anchor = run._r
        seq = []
        if old:
            seq.append(_wrap("w:del", author, date, _mk_run(rPr, old, deltext=True)))
        if new_text:
            seq.append(_wrap("w:ins", author, date, _mk_run(rPr, new_text)))
        if post:
            seq.append(_mk_run(rPr, post))
        for el in reversed(seq):
            anchor.addnext(el)
        return paragraph

    # ── Multi-run span. Each contributing run keeps its own rPr in the
    #    delete fragments so struck-through text in Word retains the
    #    original formatting (bold/italic/subscript/font family/colour). ──
    first_run = runs[si]
    last_run = runs[ei]
    first_rPr = first_run._r.find(qn("w:rPr"))
    last_rPr = last_run._r.find(qn("w:rPr"))

    first_text = first_run.text
    last_text = last_run.text

    pre_first = first_text[:so]
    del_first = first_text[so:]       # tail of first run → w:del
    del_last = last_text[:eo]         # head of last run  → w:del
    post_last = last_text[eo:]

    middle = [runs[i] for i in range(si + 1, ei)]
    # Capture rPr + text BEFORE we mutate anything downstream so that
    # python-docx's lazy XPath queries don't fire against half-removed
    # elements.
    middle_fragments = [
        (r._r.find(qn("w:rPr")), r.text) for r in middle
    ]

    # Build the single w:del container holding per-run fragments. One
    # w:del element with multiple w:r children is the canonical Word
    # shape for a cross-formatting tracked deletion.
    del_el = OxmlElement("w:del")
    del_el.set(qn("w:id"), str(next(_ids)))
    del_el.set(qn("w:author"), author)
    del_el.set(qn("w:date"), date)
    if del_first:
        del_el.append(_mk_run(first_rPr, del_first, deltext=True))
    for rPr, text in middle_fragments:
        if text:
            del_el.append(_mk_run(rPr, text, deltext=True))
    if del_last:
        del_el.append(_mk_run(last_rPr, del_last, deltext=True))

    # Single w:ins (empty replacements fall through — the deletion still
    # fires, matching Word's behaviour for a pure-delete tracked change).
    ins_el = None
    if new_text:
        ins_el = _wrap("w:ins", author, date, _mk_run(first_rPr, new_text))

    # Mutate paragraph structure LAST so a mid-flight exception leaves the
    # paragraph coherent for the caller to retry.
    first_run.text = pre_first
    last_run.text = post_last
    for r in middle:
        r._r.getparent().remove(r._r)

    # Document order: first_run → w:del → w:ins → last_run.
    anchor = first_run._r
    # addnext puts the new element RIGHT AFTER the anchor; call in reverse
    # order of desired document position so ins ends up between del and
    # last_run.
    if ins_el is not None:
        anchor.addnext(ins_el)
    anchor.addnext(del_el)

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

