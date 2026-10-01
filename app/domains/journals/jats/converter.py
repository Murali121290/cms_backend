"""Built-in XHTML -> JATS 1.3 (Journal Publishing, MathML 3) converter.

Input is the XHTML written by DocxToXhtmlRunsEngine (paragraphs carry
data-style-label and data-para-idx). That XHTML has no images, so figure
positions come from the manuscript blocks (paragraphs with a w:drawing).
The Windows XSLT server is preferred when configured; this converter is the
fallback and the default until that server exists.
"""
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from lxml import etree
from lxml import html as lxml_html

from app.domains.journals.checks.references import DOI, REF_HEADINGS, REF_NUMBER, citation_pattern
from app.domains.journals.manuscript import Block, categorize_style, heading_level

XLINK = "http://www.w3.org/1999/xlink"
MML = "http://www.w3.org/1998/Math/MathML"
NSMAP = {"xlink": XLINK, "mml": MML}
DOCTYPE = ('<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Publishing DTD with MathML3 v1.3 20210610//EN" '
           '"JATS-journalpublishing1-3-mathml3.dtd">')
CITATION = re.compile(r"\[(\d+(?:\s*[-–,]\s*\d+)*)\]")
HEADING_TEXT = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$")
TABLE_LABEL = re.compile(r"^(Table\s+\d+)[.:]?\s*", re.I)
FIGURE_LABEL = re.compile(r"^((?:Figure|Fig\.)\s*\d+)[.:]?\s*", re.I)
EQ_LABEL = re.compile(r"\((\d+[a-z]?)\)\s*$")
# Front-matter paragraphs that never become body content (metadata comes from the article record).
FRONT_ONLY = {"Authors", "Affiliation", "Front Matter", "Abstract Heading", "Corresponding Author"}

# Direct-formatting tags from the XHTML engine -> JATS inline elements.
INLINE = {"strong": "bold", "b": "bold", "em": "italic", "i": "italic", "u": "underline", "sup": "sup", "sub": "sub"}
# Character styles JATS knows without configuration.
CHAR_STYLE_DEFAULTS = {"emphasis": "italic", "strong": "bold", "subtle emphasis": "italic", "intense emphasis": "bold"}
JATS_INLINE_TARGETS = {"italic", "bold", "underline", "sc", "monospace", "sup", "sub", "roman", "sans-serif", "overline", "strike"}


@dataclass
class ArticleMeta:
    journal_code: str
    journal_title: str
    publisher_name: str = ""
    issn_print: Optional[str] = None
    issn_online: Optional[str] = None
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: List[str] = field(default_factory=list)
    affiliations: List[str] = field(default_factory=list)
    abstract: Optional[str] = None
    keywords: List[str] = field(default_factory=list)
    volume: Optional[str] = None
    issue: Optional[str] = None
    article_type: str = "research-article"


def _e(tag, text=None, parent=None, **attrs):
    el = etree.SubElement(parent, tag) if parent is not None else etree.Element(tag, nsmap=NSMAP)
    for k, v in attrs.items():
        if v is None:
            continue
        el.set(k.replace("__", ":").replace("_", "-") if not k.startswith("{") else k, str(v))
    if text:
        el.text = text
    return el


def _append_text(parent, text):
    if not text:
        return
    if len(parent):
        last = parent[-1]
        last.tail = (last.tail or "") + text
    else:
        parent.text = (parent.text or "") + text


class _Inline:
    """Converts inline XHTML content into children of a JATS element."""

    def __init__(self, char_styles: Dict[str, str], cite: bool, pattern=CITATION):
        self.char_styles = {k.lower(): v for k, v in CHAR_STYLE_DEFAULTS.items()}
        self.char_styles.update({k.lower(): v for k, v in (char_styles or {}).items()})
        self.cite = cite
        self.pattern = pattern

    def text(self, target, text):
        if not text:
            return
        text = text.replace(" ", " ")
        if not self.cite:
            _append_text(target, text)
            return
        pos = 0
        for m in self.pattern.finditer(text):
            opening, closing = m.group(0)[0], m.group(0)[-1]
            _append_text(target, text[pos:m.start()] + opening)
            parts = re.split(r"(\s*[-–,]\s*)", m.group(1))
            for part in parts:
                if part.strip().isdigit():
                    x = _e("xref", part.strip(), target, ref_type="bibr", rid=f"bib{part.strip()}")
                    x.tail = ""
                else:
                    _append_text(target, part)
            _append_text(target, closing)
            pos = m.end()
        _append_text(target, text[pos:])

    def children(self, src, target):
        self.text(target, src.text)
        for child in src:
            self.node(child, target)
            self.text(target, child.tail)

    def node(self, el, target):
        tag = el.tag.lower() if isinstance(el.tag, str) else ""
        classes = (el.get("class") or "").split()
        if tag == "del":
            return
        if tag == "br":
            _append_text(target, " ")
            return
        if tag == "span" and "math-node" in classes:
            formula = _e("inline-formula", parent=target)
            formula.append(_mathml(el))
            return
        if tag == "span" and ("FootnoteRef" in classes or "EndnoteRef" in classes):
            _e("xref", el.get("data-id"), target, ref_type="fn", rid=f"fn{el.get('data-id')}")
            return
        if tag in INLINE:
            self.children(el, _e(INLINE[tag], parent=target))
            return
        if tag == "a" and el.get("href"):
            link = _e("ext-link", parent=target, ext_link_type="uri")
            link.set(f"{{{XLINK}}}href", el.get("href"))
            self.children(el, link)
            return
        if tag == "span" and classes:
            style = " ".join(c for c in classes if not c.startswith("occurrence"))
            if style.startswith(("bib_", "cite_", "ref_")):
                # Reference-structuring styles: citations become xrefs from their text; bib_* fields are
                # used by _element_citation in the reference list, so here they are transparent.
                self.children(el, target)
                return
            if style:
                mapped = self.char_styles.get(style.lower())
                if mapped in JATS_INLINE_TARGETS:
                    self.children(el, _e(mapped, parent=target))
                else:
                    # Unmapped Word character style: keep it traceable and valid; the structuring check flags it.
                    self.children(el, _e("named-content", parent=target, content_type=style))
                return
        self.children(el, target)


def _mathml(span):
    raw = span.get("data-mathml") or ""
    try:
        m = etree.fromstring(raw.encode("utf-8"))
    except etree.XMLSyntaxError:
        m = etree.Element(f"{{{MML}}}math")
        etree.SubElement(m, f"{{{MML}}}mtext").text = span.text_content() or "[equation]"

    def to_mml(node):
        if isinstance(node.tag, str):
            local = etree.QName(node).localname
            node.tag = f"{{{MML}}}{local}"
        for c in node:
            to_mml(c)
    to_mml(m)
    etree.cleanup_namespaces(m, top_nsmap={"mml": MML})
    return m


def _plain(el) -> str:
    """Text content without tracked deletions."""
    parts = []

    def walk(n):
        if isinstance(n.tag, str) and n.tag.lower() == "del":
            return
        if n.text:
            parts.append(n.text)
        for c in n:
            walk(c)
            if c.tail:
                parts.append(c.tail)
    walk(el)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _strip_label(el, pattern) -> Optional[str]:
    """Remove a leading label ('Table 1.') from el's text content; return the label."""
    text = _plain(el)
    m = pattern.match(text)
    if not m:
        return None
    remaining = len(m.group(0))
    # walk text nodes from the start and cut `remaining` characters
    def cut(node):
        nonlocal remaining
        if remaining <= 0:
            return
        if node.text:
            n = min(remaining, len(node.text))
            node.text = node.text[n:]
            remaining -= n
        for c in node:
            if remaining <= 0:
                return
            if isinstance(c.tag, str) and c.tag.lower() == "del":
                continue
            cut(c)
            if c.tail and remaining > 0:
                n = min(remaining, len(c.tail))
                c.tail = c.tail[n:]
                remaining -= n
    cut(el)
    return m.group(1)


def convert_xhtml_to_jats(xhtml: str, meta: ArticleMeta, blocks: Optional[List[Block]] = None,
                          art_files: Optional[List[str]] = None, char_styles: Optional[Dict[str, str]] = None,
                          figure_files: Optional[Dict[int, str]] = None) -> bytes:
    """figure_files maps figure numbers to the art file linked in the Files panel; otherwise art is matched by name."""
    doc = lxml_html.fromstring(xhtml)
    body_src = doc.find(".//body") if doc.tag != "body" else doc
    if body_src is None:
        body_src = doc
    drawings = {b.idx for b in (blocks or []) if b.has_drawing}
    art_files = list(art_files or [])

    # Flatten block-level XHTML into a list of (kind, element).
    items = []

    def collect(container):
        for el in container:
            if not isinstance(el.tag, str):
                continue
            tag = el.tag.lower()
            cls = el.get("class") or ""
            if tag in ("p",) or re.fullmatch(r"h[1-6]", tag):
                items.append(("para", el))
            elif tag in ("ul", "ol"):
                items.append(("list", el))
            elif tag == "table":
                items.append(("table", el))
            elif tag == "div" and "NotesContainer" in cls:
                items.append(("notes", el))
            elif tag == "div":
                collect(el)
    collect(body_src)

    def category(el):
        tag = el.tag.lower()
        if re.fullmatch(r"h[1-6]", tag):
            return f"Heading {tag[1]}"
        return categorize_style(el.get("data-style-label") or el.get("class") or "Normal")

    def para_idx(el):
        try:
            return int(el.get("data-para-idx"))
        except (TypeError, ValueError):
            return None

    # --- Locate front matter, abstract, keywords and the reference list ---
    # Front matter (title, authors, affiliations) runs up to the abstract/keywords; the body starts
    # after them, or at the first heading when the manuscript has neither.
    abstract_el = keyword_el = title_el = None
    author_els, aff_els, corresp_els, type_el = [], [], [], None  # tagged front matter -> contrib/aff/author-notes
    abstract_more = []  # further paragraphs of a structured abstract (Background, Methods, ...)
    front_end = None  # index just past the last front-matter paragraph we recognised
    first_heading = ref_start = None
    for i, (kind, el) in enumerate(items):
        if kind != "para":
            continue
        cat, text = category(el), _plain(el)
        if not text:
            continue
        if text.rstrip(":").lower() in REF_HEADINGS:
            ref_start = i
            break
        if cat in FRONT_ONLY and first_heading is None:
            front_end = max(front_end or 0, i + 1)
            if cat == "Authors":
                author_els.append(el)
            elif cat == "Affiliation":
                aff_els.append(el)
            elif cat == "Corresponding Author":
                corresp_els.append(el)
            elif type_el is None and (el.get("data-style-label") or "").lower() in ("articletype", "aty"):
                type_el = el
        elif cat == "Article Title" and title_el is None and first_heading is None:
            title_el, front_end = el, max(front_end or 0, i + 1)
        elif abstract_el is not None and cat == "Abstract" and first_heading is None:
            abstract_more.append(el)
            front_end = max(front_end or 0, i + 1)
        elif abstract_el is None and first_heading is None and (cat == "Abstract" or re.match(r"^abstract\b", text, re.I)):
            abstract_el, front_end = el, max(front_end or 0, i + 1)
        elif keyword_el is None and first_heading is None and (cat == "Keywords" or re.match(r"^key\s*words?\b", text, re.I)):
            keyword_el, front_end = el, max(front_end or 0, i + 1)
        elif first_heading is None and heading_level(cat):
            first_heading = i
    if abstract_el is not None or keyword_el is not None:
        first_body = front_end
    elif first_heading is not None:
        first_body = first_heading
    else:
        first_body = front_end or 0
    body_end = ref_start if ref_start is not None else len(items)
    ref_items = []
    if ref_start is not None:
        for kind, el in items[ref_start + 1:]:
            if kind == "para" and heading_level(category(el)):
                break
            if kind == "para" and _plain(el):
                ref_items.append(el)
    tagged_refs = [el for kind, el in items if kind == "para" and category(el) == "References" and el not in ref_items]
    if not ref_items and tagged_refs:
        ref_items = tagged_refs

    ref_numbers = []
    for pos, el in enumerate(ref_items, start=1):
        m = REF_NUMBER.match(_plain(el))
        ref_numbers.append(int(m.group(1)) if m else pos)
    ref_ids = {id(el) for el in ref_items}
    pattern = citation_pattern(_plain(el) for kind, el in items if kind == "para" and id(el) not in ref_ids)
    inline = _Inline(char_styles or {}, cite=bool(ref_items), pattern=pattern)
    plain_inline = _Inline(char_styles or {}, cite=False)

    # --- <front> ---
    article = _e("article", dtd_version="1.3", article_type=meta.article_type)
    article.set("{http://www.w3.org/XML/1998/namespace}lang", "en")
    front = _e("front", parent=article)
    jm = _e("journal-meta", parent=front)
    _e("journal-id", meta.journal_code, jm, journal_id_type="publisher-id")
    jtg = _e("journal-title-group", parent=jm)
    _e("journal-title", meta.journal_title, jtg)
    if meta.issn_print:
        _e("issn", meta.issn_print, jm, pub_type="ppub")
    if meta.issn_online:
        _e("issn", meta.issn_online, jm, pub_type="epub")
    if meta.publisher_name:
        pub = _e("publisher", parent=jm)
        _e("publisher-name", meta.publisher_name, pub)

    am = _e("article-meta", parent=front)
    if meta.doi:
        _e("article-id", meta.doi, am, pub_id_type="doi")
    if type_el is not None and _plain(type_el).strip():
        sg = _e("subj-group", parent=_e("article-categories", parent=am), subj_group_type="heading")
        _e("subject", _plain(type_el).strip(), sg)
    tg = _e("title-group", parent=am)
    at = _e("article-title", parent=tg)
    if title_el is not None:
        plain_inline.children(title_el, at)
    else:
        at.text = meta.title or "Untitled"

    # Authors, affiliations and author notes: the tagged paragraphs (ArticleAuthor, ArticleAffiliation,
    # CorrespondingAuthor) win; the upload's metadata guess is only a fallback for untagged manuscripts.
    from app.domains.journals.jats import front_matter as fm
    authors = [a for el in author_els for a in fm.parse_authors(fm.marked_text(el))]
    affs, notes = [], []
    for el in aff_els:
        aff, note = fm.parse_affiliation(fm.marked_text(el))
        if aff:
            affs.append(aff)
        if note:
            notes.append(note)
    corresp = fm.parse_corresp([_plain(el) for el in corresp_els]) if corresp_els else None
    if not authors:
        for name in meta.authors:
            given, surname = fm._split_name(name.replace(",", " ").strip())
            authors.append(fm.Author(given, surname))
    if not affs and not aff_els:
        affs = [fm.Affiliation(None, a) for a in meta.affiliations]
    fm.build_front(am, authors, affs, notes, corresp, _e)
    if meta.volume:
        _e("volume", meta.volume, am)
    if meta.issue:
        _e("issue", meta.issue, am)
    if abstract_el is not None or meta.abstract:
        ab = _e("abstract", parent=am)
        p = _e("p", parent=ab)
        if abstract_el is not None:
            _strip_label(abstract_el, re.compile(r"^(abstract)[.:]?\s*", re.I))
            plain_inline.children(abstract_el, p)
            p.text = (p.text or "").lstrip()
            for extra in abstract_more:
                plain_inline.children(extra, _e("p", parent=ab))
            if not (p.text or len(p)) and len(ab) > 1:
                ab.remove(p)  # "Abstract" was only a label; its text is in the following paragraphs
        else:
            p.text = meta.abstract
    keywords = meta.keywords
    if keyword_el is not None:
        kw_text = re.sub(r"^key\s*words?[.:]?\s*", "", _plain(keyword_el), flags=re.I)
        keywords = [k.strip() for k in re.split(r"[;,]", kw_text) if k.strip()]
    if keywords:
        kg = _e("kwd-group", parent=am, kwd_group_type="author")
        for k in keywords:
            _e("kwd", k, kg)

    # --- <body> ---
    body = _e("body", parent=article)
    stack = [(0, body)]
    counters = {"sec": 0, "fig": 0, "tbl": 0}
    pending_table_caption = None
    skip = {id(x) for x in (abstract_el, keyword_el, title_el, *abstract_more) if x is not None}
    skip |= {id(el) for kind, el in items if kind == "para" and category(el) in FRONT_ONLY | {"Reference Heading"}}
    body_items = items[first_body:body_end]

    def container():
        return stack[-1][1]

    def add_caption(parent, caption_el, pattern):
        label = _strip_label(caption_el, pattern)
        if label:
            _e("label", label, parent)
        cap = _e("caption", parent=parent)
        p = _e("p", parent=cap)
        inline.children(caption_el, p)
        p.text = (p.text or "").lstrip()

    def add_figure(caption_el=None):
        counters["fig"] += 1
        n = counters["fig"]
        fig = _e("fig", parent=container(), id=f"f{n}")
        if caption_el is not None:
            add_caption(fig, caption_el, FIGURE_LABEL)
        else:
            _e("label", f"Figure {n}", fig)
        href = (figure_files or {}).get(n) or next(
            (a for a in art_files if re.search(rf"(fig(ure)?|f)[_\- ]?0*{n}(\D|$)", a, re.I)), f"fig{n}.tif")
        g = _e("graphic", parent=fig)
        g.set(f"{{{XLINK}}}href", href)

    i = 0
    while i < len(body_items):
        kind, el = body_items[i]
        nxt = body_items[i + 1] if i + 1 < len(body_items) else (None, None)
        if id(el) in skip:
            i += 1
            continue
        if kind == "para":
            cat, text, idx = category(el), _plain(el), para_idx(el)
            level = heading_level(cat)
            if idx in drawings:
                cap = None
                if nxt[0] == "para" and FIGURE_LABEL.match(_plain(nxt[1])):
                    cap = nxt[1]
                    i += 1
                add_figure(cap)
                i += 1
                continue
            if not text:
                i += 1
                continue
            if level:
                while stack[-1][0] >= level:
                    stack.pop()
                counters["sec"] += 1
                sec = _e("sec", parent=container(), id=f"s{counters['sec']}")
                m = HEADING_TEXT.match(text)
                if m:
                    _e("label", m.group(1), sec)
                    _e("title", m.group(2), sec)
                else:
                    t = _e("title", parent=sec)
                    plain_inline.children(el, t)
                stack.append((level, sec))
            elif TABLE_LABEL.match(text) and nxt[0] == "table":
                pending_table_caption = el
            elif FIGURE_LABEL.match(text) and cat in ("Figure Caption", "Caption"):
                add_figure(el)
            else:
                maths = el.findall(".//span[@class='math-node']")
                if len(maths) == 1 and maths[0].get("data-display") == "block":
                    df = _e("disp-formula", parent=container())
                    lab = EQ_LABEL.search(text)
                    if lab:
                        df.set("id", f"eq{lab.group(1)}")
                        _e("label", f"({lab.group(1)})", df)
                    df.append(_mathml(maths[0]))
                else:
                    p = _e("p", parent=container())
                    inline.children(el, p)
        elif kind == "list":
            _list(el, container(), inline)
        elif kind == "table":
            counters["tbl"] += 1
            tw = _e("table-wrap", parent=container(), id=f"t{counters['tbl']}")
            caption_el = pending_table_caption
            if caption_el is None and nxt[0] == "para" and TABLE_LABEL.match(_plain(nxt[1])):
                caption_el = nxt[1]
                i += 1
            if caption_el is not None:
                add_caption(tw, caption_el, TABLE_LABEL)
            _table(el, tw, inline)
            pending_table_caption = None
        i += 1

    # --- <back> ---
    notes = [el for kind, el in items if kind == "notes"]
    if ref_items or notes:
        back = _e("back", parent=article)
        if ref_items:
            rl = _e("ref-list", parent=back)
            _e("title", "References", rl)
            for n, el in zip(ref_numbers, ref_items):
                ref = _e("ref", parent=rl, id=f"bib{n}")
                _e("label", str(n), ref)
                if not _element_citation(el, ref):  # structured references (bib_* styles) -> element-citation
                    mc = _e("mixed-citation", parent=ref)
                    _strip_label(el, REF_NUMBER)
                    plain_inline.children(el, mc)
                    _wrap_doi(mc)
        for note in notes:
            fg = _e("fn-group", parent=back)
            for k, p in enumerate(note.iter("p"), start=1):
                if not _plain(p):
                    continue
                fid = p.get("data-id") or str(k)
                fn = _e("fn", parent=fg, id=f"fn{fid}")
                inline.children(p, _e("p", parent=fn))

    xml = etree.tostring(article, pretty_print=True, encoding="UTF-8", xml_declaration=True, doctype=DOCTYPE)
    return xml


def _list(src, parent, inline):
    lst = _e("list", parent=parent, list_type="bullet" if src.tag.lower() == "ul" else "order")
    for li in src.findall("li"):
        item = _e("list-item", parent=lst)
        for child in li:
            tag = child.tag.lower() if isinstance(child.tag, str) else ""
            if tag == "p":
                inline.children(child, _e("p", parent=item))
            elif tag in ("ul", "ol"):
                _list(child, item, inline)
        if not len(item):
            _e("p", parent=item)


def _table(src, parent, inline):
    table = _e("table", parent=parent)
    rows = src.findall(".//tr")
    if not rows:
        return
    # The first row is the header; a one-row table has no header (tbody is required).
    has_head = len(rows) > 1
    head = _e("thead", parent=table) if has_head else None
    body = _e("tbody", parent=table)
    for r, tr in enumerate(rows):
        is_head = has_head and r == 0
        row = _e("tr", parent=head if is_head else body)
        for td in tr:
            if not isinstance(td.tag, str) or td.tag.lower() not in ("td", "th"):
                continue
            cell = _e("th" if is_head else "td", parent=row)
            paras = td.findall("p") or [td]
            for k, p in enumerate(paras):
                if k:
                    _e("break", parent=cell)
                inline.children(p, cell)


# bib_* character style -> JATS element inside <element-citation>
BIB_FIELDS = {
    "bib_article": "article-title", "bib_chaptertitle": "chapter-title", "bib_journal": "source", "bib_book": "source",
    "bib_title": "source", "bib_year": "year", "bib_month": "month", "bib_day": "day", "bib_volume": "volume",
    "bib_issue": "issue", "bib_fpage": "fpage", "bib_lpage": "lpage", "bib_publisher": "publisher-name",
    "bib_location": "publisher-loc", "bib_editionno": "edition", "bib_isbn": "isbn", "bib_conference": "conf-name",
    "bib_confdate": "conf-date", "bib_conflocation": "conf-loc", "bib_comment": "comment", "bib_institution": "institution",
}


def _element_citation(el, ref) -> bool:
    """Build <element-citation> from bib_*-styled runs. False when the reference is not structured."""
    fields = []
    for span in el.iter("span"):
        cls = [c for c in (span.get("class") or "").split() if c.startswith("bib_")]
        if cls and not any(isinstance(a.tag, str) and a.tag.lower() == "del" for a in span.iterancestors()):
            text = re.sub(r"\s+", " ", span.text_content()).strip()
            if text:
                fields.append((cls[0], text))
    if len(fields) < 2:
        return False
    styles = {s for s, _ in fields}
    kind = ("journal" if "bib_journal" in styles else "book" if styles & {"bib_book", "bib_publisher", "bib_chaptertitle"}
            else "confproc" if "bib_conference" in styles else "other")
    ec = _e("element-citation", parent=ref, publication_type=kind)
    group, name = None, None
    for style, text in fields:
        if style in ("bib_surname", "bib_fname", "bib_etal", "bib_organization", "bib_ed-surname", "bib_ed-fname", "bib_ed-etal"):
            editor = style.startswith("bib_ed-")
            gtype = "editor" if editor else "author"
            if group is None or group.get("person-group-type") != gtype:
                group, name = _e("person-group", parent=ec, person_group_type=gtype), None
            if style in ("bib_etal", "bib_ed-etal"):
                _e("etal", parent=group)
            elif style == "bib_organization":
                _e("collab", text, group)
            elif style in ("bib_surname", "bib_ed-surname") or name is None:
                name = _e("name", parent=group)
                _e("surname" if style.endswith("surname") else "given-names", text.rstrip(",."), name)
            else:
                _e("given-names", text.rstrip(","), name)
                name = None
            continue
        group = name = None
        if style == "bib_doi":
            _e("pub-id", re.sub(r"^(doi:\s*|https?://(dx\.)?doi\.org/)", "", text, flags=re.I), ec, pub_id_type="doi")
        elif style == "bib_medline":
            _e("pub-id", text, ec, pub_id_type="pmid")
        elif style in ("bib_url", "bib_extlink"):
            link = _e("ext-link", text, ec, ext_link_type="uri")
            link.set(f"{{{XLINK}}}href", text)
        elif style in BIB_FIELDS:
            _e(BIB_FIELDS[style], text.rstrip(".") if BIB_FIELDS[style] in ("article-title", "source", "chapter-title") else text, ec)
    return True


def _wrap_doi(mc):
    """Turn a trailing 'doi:10.x/y' in a citation into <pub-id pub-id-type="doi">."""
    target = mc[-1] if len(mc) and mc[-1].tail else mc
    attr = "tail" if target is not mc else "text"
    text = getattr(target, attr) or ""
    m = DOI.search(text)
    if not m:
        return
    before, doi, after = text[:m.start(1)], m.group(1), text[m.end(1):]
    setattr(target, attr, before)
    pid = etree.Element("pub-id")
    pid.set("pub-id-type", "doi")
    pid.text = doi
    pid.tail = after
    if target is mc:
        mc.insert(0, pid)
    else:
        mc.append(pid)
