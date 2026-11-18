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

# Heading text that opens a References/Bibliography region per the
# journal production user manual: "Only REF-N / REF-U paragraphs between
# <ref-open> and <ref-close> (or under the References heading) count as
# references." The region starts at the heading and continues until the
# next chapter-boundary heading (or EOF) so entries typeset in Normal
# paragraph style without any per-paragraph REF-* tag are still excluded
# from Language Editing analysis.
_REFERENCE_HEADING_TEXT_RE = re.compile(
    r"^\s*(?:"
    r"references?"
    r"|bibliography"
    r"|(?:selected\s+)?bibliography"
    r"|works?\s+cited"
    r"|literature\s+cited"
    r"|further\s+reading"
    r"|suggested\s+reading"
    r"|references?\s+(?:and|&)\s+(?:further\s+reading|notes?|bibliography)"
    r"|notes?\s+(?:and|&)\s+references?"
    r")"
    r"[\s\.\:\—\-–]*$",
    re.IGNORECASE,
)


def _is_reference_heading_text(text: str) -> bool:
    """True when a heading's visible text names a References /
    Bibliography section. Strips any leading inline tag (``<h1>`` style
    markup authors sometimes bake into the paragraph text) before
    matching so ``<H1>References`` is recognised the same as a plain
    ``References`` heading."""
    cleaned = re.sub(r"<[^>]+>", "", text or "").strip()
    if not cleaned:
        return False
    return bool(_REFERENCE_HEADING_TEXT_RE.match(cleaned))

# Characters that terminate a sentence. A paragraph whose last non-
# whitespace character is one of these is sentence-terminated; one that
# isn't may be an informal title (see ``_is_informal_title`` below).
_TERMINAL_PUNCTUATION_CHARS = frozenset('.!?:;"\')]')


def _is_informal_title(p) -> bool:
    """Detect section titles that the DOCX author formatted as bolded
    runs inside a plain ``Normal`` paragraph instead of applying a
    Heading / Title style. Classic pattern in copy-edited manuscripts:
    ``THE STUDY`` or ``Impact of ... quality of life`` sit as 100%-
    bold ``Normal`` paragraphs with no terminal punctuation, directly
    above the running prose.

    Signal: every non-empty run in the paragraph is bold AND the
    paragraph has no sentence-terminating punctuation. The combination
    is distinctive — a body paragraph with emphasis-bolding has
    mixed-bold runs, and a legitimate sentence ends in a terminator.

    Returns False on empty paragraphs so the caller can fall through
    to its existing body-vs-caption logic.
    """
    text = (p.text or "").strip()
    if not text:
        return False
    if text[-1] in _TERMINAL_PUNCTUATION_CHARS:
        return False
    # Inspect all runs that carry visible text. If every one is bold
    # (``run.bold is True`` — explicitly set, not inherited-as-None),
    # treat the paragraph as an informal title. A single non-bold run
    # anywhere drops it back to body.
    has_run = False
    for r in p.runs:
        if not (r.text or "").strip():
            continue
        has_run = True
        if r.bold is not True:
            return False
    return has_run


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
      * ``in_table_note``     — True when ``in_table`` AND role=="caption";
                                marks the table's notes/caption line
                                where it IS legitimate for authors to
                                define an abbreviation (Phase 4).
      * ``in_figure``         — True inside ``<figure>`` / ``<fig>`` …
      * ``in_figure_legend``  — True when ``in_figure`` AND role=="caption";
                                the figure's legend text where
                                abbreviation definitions are expected
                                (Phase 4).
      * ``in_epigraph``       — True inside ``<epigraph>…</epigraph>`` or
                                Epigraph-styled paragraphs
      * ``in_src``            — True inside ``<src>…</src>`` (code /
                                source blocks) or Code/Source-styled
                                paragraphs
      * ``in_extract``        — True inside ``<extract>…</extract>`` or
                                Extract/BlockQuote-styled paragraphs
                                (long quoted passages; ref/epi/src/
                                extract are the four boundary-tag
                                regions required for Language Editing
                                exclusion).
      * ``in_references``     — True inside ``<references>…</references>``
                                or ``<REF>…</REF>`` boundary tags.
                                Reference entries typeset in Normal
                                paragraph style (common bibliography
                                pattern) cannot be detected without
                                such a boundary tag — they'd pass as
                                body text otherwise. See Issue 2.

    The role / in_* flags carry through adjacent paragraphs until the
    closing tag is seen. The paragraphs between those tags all share the
    same flag — a reviewer reading the manuscript needs that continuity.
    """
    out: dict[int, dict] = {}
    in_abstract = False
    in_table = False
    in_figure = False
    in_epigraph = False
    in_src = False
    in_extract = False
    in_references = False
    # Tracks whether the current in_references region was opened by a
    # ``References`` heading (as opposed to a ``<references>`` /
    # ``<ref-open>`` boundary tag or a Reference paragraph style). A
    # heading-opened region has no closing tag — it ends at the next
    # chapter-boundary heading (or EOF). Boundary-tag regions are closed
    # explicitly by their matching close tag and MUST NOT be affected by
    # a subsequent chapter-boundary heading inside the section.
    in_references_opened_by_heading = False
    for i, p in enumerate(doc.paragraphs):
        text = (p.text or "").strip()
        style = (p.style.name if p.style else "") or ""
        tl = text.lower()
        style_lc_boundary = style.strip().lower()

        # Boundary tags (open BEFORE classifying this paragraph; close
        # AFTER so a tag paragraph itself is still inside its region).
        if "<abstract>" in tl or style_lc_boundary == "abstract":
            in_abstract = True
        if "<table>" in tl:
            in_table = True
        if "<figure>" in tl or "<fig>" in tl:
            in_figure = True
        # Epigraph: author quote block at chapter start. Boundary tag OR
        # the Word paragraph style literally named "Epigraph".
        if "<epigraph>" in tl or style_lc_boundary == "epigraph":
            in_epigraph = True
        # Source / code block. Boundary tag OR Code / Source / SourceCode /
        # CodeBlock paragraph styles (common conventions across templates).
        if "<src>" in tl or style_lc_boundary in {"code", "source", "sourcecode", "codeblock", "src"}:
            in_src = True
        # Extract: long quoted passage set off from body. Boundary tag
        # OR Extract / BlockQuote / BlockQuotation / Quotation paragraph
        # styles (common conventions).
        if "<extract>" in tl or style_lc_boundary in {
            "extract", "blockquote", "blockquotation", "quotation", "quote",
        }:
            in_extract = True
        # References section. Many templates typeset references in
        # Normal paragraphs with no distinguishing style — only a
        # boundary tag can mark them reliably. ``<references>``,
        # ``<REF>``, and the long-form ``<ref-open>`` all open the
        # region; ``is_reference_style`` still catches explicit
        # Reference / Bibliography / BibEntry styles at the per-paragraph
        # level below. The ``<ref-open>`` / ``<ref-close>`` form is the
        # convention documented in the journal production user manual
        # (``Only REF-N / REF-U paragraphs between <ref-open> and
        # <ref-close> … count as references``) and used across the
        # existing reference-review and journal-styling tests. It must
        # be recognised here too so entries typeset in Normal paragraph
        # style between the boundary tags are tagged in_references and
        # skipped by the Language Editing router gate — the
        # ``read_paragraphs`` extraction filter is NOT a guarantee
        # (some code paths classify without re-running extraction).
        if "<references>" in tl or "<ref>" in tl or "<ref-open>" in tl or style_lc_boundary in {
            "references", "bibliography", "bibliographyentry", "bibentry",
            "referenceslist", "reflist",
        }:
            in_references = True
            in_references_opened_by_heading = False

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
        elif _is_informal_title(p):
            # Fallback — paragraph is styled ``Normal`` but every run is
            # bold and there's no terminal punctuation. Treat as a
            # heading so the router's paragraph-exclusion gate skips it
            # for every rule category (no spurious terminal_punctuation
            # or passive_voice findings on titles).
            role = "heading"

        # Heading-driven in_references opener / closer. A ``References``
        # or ``Bibliography`` heading (any level) opens the region; it
        # continues until the next chapter-boundary heading or EOF —
        # the convention used by non-templated manuscripts that don't
        # wrap entries with ``<ref-open>`` / ``<ref-close>`` or carry
        # per-paragraph REF-U / REF-N style. Ordering matters:
        #   * A chapter-level ``References`` heading is itself a
        #     chapter_boundary; we must open the region at it rather
        #     than closing a hypothetical previous one on the same
        #     paragraph.
        #   * Subsequent chapter-boundary headings that are NOT also
        #     reference-section titles close the region.
        # Boundary-tag regions (``<references>`` / ``<ref-open>`` /
        # Bibliography style) are NOT closed here — their close tag
        # does that job explicitly below. Tracked via
        # ``in_references_opened_by_heading`` so a chapter heading
        # inside a boundary-tagged references block doesn't
        # prematurely clear the flag.
        if role in ("heading", "title") and _is_reference_heading_text(text):
            in_references = True
            in_references_opened_by_heading = True
        elif role in ("heading", "title") and chapter_boundary and in_references_opened_by_heading:
            in_references = False
            in_references_opened_by_heading = False

        # Positive subroles for Phase-4 abbreviations rules.
        # ``in_table_note`` and ``in_figure_legend`` combine the region
        # flag with the paragraph's caption role so Abbreviations can
        # treat a definition inside a table's notes line or a figure's
        # legend as a legitimate local definition (AB15 should NOT flag
        # the abbreviation as undefined when its expansion appears in
        # the caption line attached to the same table / figure).
        in_table_note = bool(in_table and role == "caption")
        in_figure_legend = bool(in_figure and role == "caption")

        out[i] = {
            "style": style,
            "role": role,
            "level": level,
            "chapter_boundary": chapter_boundary,
            "in_abstract": in_abstract,
            "in_table": in_table,
            "in_table_note": in_table_note,
            "in_figure": in_figure,
            "in_figure_legend": in_figure_legend,
            "in_epigraph": in_epigraph,
            "in_src": in_src,
            "in_extract": in_extract,
            "in_references": in_references,
            "text": p.text or "",
        }

        # Closing tags take effect AFTER this paragraph's classification.
        if "</abstract>" in tl:
            in_abstract = False
        if "</table>" in tl:
            in_table = False
        if "</figure>" in tl or "</fig>" in tl:
            in_figure = False
        if "</epigraph>" in tl:
            in_epigraph = False
        if "</src>" in tl:
            in_src = False
        if "</extract>" in tl:
            in_extract = False
        if "</references>" in tl or "</ref>" in tl or "<ref-close>" in tl:
            in_references = False
            in_references_opened_by_heading = False
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

