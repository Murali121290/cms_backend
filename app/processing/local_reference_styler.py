"""Apply bib_* character styles to reference-list paragraphs locally, without PPH.

The text is never rewritten: each reference is parsed (Vancouver/AMA numbered, or APA
author-year), and the existing runs are split at field boundaries so the fields carry
the same character styles PPH's structuring produces (bib_surname, bib_fname, bib_etal,
bib_article, bib_journal, bib_book, bib_year, bib_volume, bib_issue, bib_fpage, bib_lpage,
bib_doi, bib_url, bib_location, bib_publisher, bib_organization).
"""
import copy
import re
from typing import Iterable, List, Optional, Tuple

from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn

Span = Tuple[int, int, str]

_LABEL = re.compile(r"^\s*\[?\d{1,4}[\].)]?\s+")
_APA_YEAR = re.compile(r"\(\s*((?:19|20)\d{2}[a-z]?|n\.d\.|in press)\s*\)")
_VAN_SOURCE = re.compile(
    # "Journal. 2002 Jan 9;287(2):226-235" and the JMIR form "Journal. Jan 9, 2002;287(2):226-235"
    r"(?P<src>[^.;]+?)\.\s*(?:[A-Z][a-z]{2,8}\.?(?:\s+\d{1,2})?,?\s+)?(?P<year>(?:19|20)\d{2})"
    r"(?:\s+[A-Z][a-z]{2}(?:\s+\d{1,2})?)?\s*;\s*(?P<vol>\d+)"
    r"(?:\s*\((?P<iss>[^)]+)\))?\s*:\s*(?P<fp>[A-Za-z]?\d+)(?:\s*[-–]\s*(?P<lp>[A-Za-z]?\d+))?")
_BOOK = re.compile(r"(?P<loc>[A-Z][^.:;]{1,60}):\s*(?P<pub>[^;.]{2,120});\s*(?P<year>(?:19|20)\d{2})")
_APA_SOURCE = re.compile(r"(?P<src>[^,.]+?),\s*(?P<vol>\d+)(?:\s*\((?P<iss>[^)]+)\))?,\s*(?P<fp>[A-Za-z]?\d+)(?:\s*[-–]\s*(?P<lp>[A-Za-z]?\d+))?")
# No "]" in the DOI: JMIR writes "[doi: 10.1186/s12909-024-05777-5] [Medline: ...]".
_DOI = re.compile(r"(?:doi:\s*|https?://(?:dx\.)?doi\.org/)(10\.\d{4,9}/[^\s\]]+?)(?=[.,;\]]?\s*$|[.,;\]]?\s)", re.I)
_URL = re.compile(r"https?://[^\s]+?(?=[.,;]?\s*$|\s)")
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_MEDLINE = re.compile(r"\b(?:Medline|PMID|PubMed)\s*:?\s*(\d{4,9})\b", re.I)


def _author_spans(text: str, start: int, end: int, apa: bool) -> List[Span]:
    seg = text[start:end]
    spans: List[Span] = []
    if apa:
        for m in re.finditer(r"([A-Z][\w'’\-]+(?:\s[A-Z][\w'’\-]+)*),\s*((?:[A-Z]\.\s?-?)+)", seg):
            spans.append((start + m.start(1), start + m.end(1), "bib_surname"))
            spans.append((start + m.start(2), start + m.start(2) + len(m.group(2).rstrip()), "bib_fname"))
        if not spans and seg.strip():
            s = len(seg) - len(seg.lstrip())
            spans.append((start + s, start + len(seg.rstrip(" ,.")), "bib_organization"))
        return spans
    pos = 0
    for part in re.split(r"(,\s*)", seg):
        if not part or re.fullmatch(r",\s*", part):
            pos += len(part)
            continue
        p0 = start + pos + (len(part) - len(part.lstrip()))
        core = part.strip().rstrip(".")
        if re.fullmatch(r"et\s+al", core, re.I):
            spans.append((p0, p0 + len(core), "bib_etal"))
        else:
            m = re.fullmatch(r"(.+?)\s+([A-Z]{1,4})", core)
            if m:
                spans.append((p0, p0 + len(m.group(1)), "bib_surname"))
                spans.append((p0 + m.start(2), p0 + m.end(2), "bib_fname"))
            elif core:
                spans.append((p0, p0 + len(core), "bib_organization" if len(core.split()) > 2 else "bib_surname"))
        pos += len(part)
    return spans


def reference_spans(text: str) -> List[Span]:
    """Field spans (start, end, style) over the reference text, in order, non-overlapping."""
    spans: List[Span] = []
    m = _LABEL.match(text)
    body = m.end() if m else 0
    apa = _APA_YEAR.search(text, body)
    doi = _DOI.search(text)
    url = _URL.search(text) if not doi else None
    medline = _MEDLINE.search(text, body)
    tail_limit = min(p.start() for p in (doi, url, medline) if p) if (doi or url or medline) else len(text)

    if apa and apa.start() - body < 400:
        spans += _author_spans(text, body, apa.start(), apa=True)
        spans.append((apa.start(1), apa.end(1), "bib_year"))
        rest = apa.end() + len(re.match(r"[.\s]*", text[apa.end():]).group(0))  # skip "). "
        t = re.search(r"\S.*?[.?!](?=\s|$)", text[rest:tail_limit])
        src = _APA_SOURCE.search(text, rest + t.end(), tail_limit) if t else None
        if t:
            spans.append((rest + t.start(), rest + t.end() - (1 if text[rest + t.end() - 1] == "." else 0),
                          "bib_article" if src else "bib_book"))
        if src:
            spans += _source_spans(src)
    else:
        a = re.search(r"\.\s", text[body:])
        if a:
            spans += _author_spans(text, body, body + a.start(), apa=False)
            t0 = body + a.end()
            t = re.search(r"[.?!](?=\s)", text[t0:tail_limit])
            if t:
                in_chapter = " In: " in text[t0:]
                spans.append((t0, t0 + t.start() + (1 if text[t0 + t.start()] in "?!" else 0),
                              "bib_chaptertitle" if in_chapter else "bib_article"))
                after = t0 + t.end()
                src = _VAN_SOURCE.search(text, after, tail_limit)
                book = _BOOK.search(text, after, tail_limit) if not src else None
                if src:
                    spans += _source_spans(src)
                elif book:
                    spans.append((book.start("loc"), book.end("loc"), "bib_location"))
                    spans.append((book.start("pub"), book.end("pub"), "bib_publisher"))
                    spans.append((book.start("year"), book.end("year"), "bib_year"))
                    if not in_chapter:  # "Authors. Title. Place: Publisher; Year." -> the title is a book
                        spans = [(s, e, "bib_book" if st == "bib_article" else st) for s, e, st in spans]
                else:
                    y = _YEAR.search(text, after, tail_limit)
                    if y:
                        spans.append((y.start(), y.end(), "bib_year"))
    if doi:
        spans.append((doi.start(1), doi.end(1), "bib_doi"))
    elif url:
        spans.append((url.start(), url.end(), "bib_url"))
    if medline:
        spans.append((medline.start(1), medline.end(1), "bib_medline"))
    return _clean(spans, len(text))


def _source_spans(m) -> List[Span]:
    src = m.group("src")
    out = [(m.start("src") + len(src) - len(src.lstrip()), m.end("src") - (len(src) - len(src.rstrip())), "bib_journal")]
    if "year" in m.groupdict() and m.group("year"):
        out.append((m.start("year"), m.end("year"), "bib_year"))
    for g, st in (("vol", "bib_volume"), ("iss", "bib_issue"), ("fp", "bib_fpage"), ("lp", "bib_lpage")):
        if m.group(g):
            out.append((m.start(g), m.end(g), st))
    return out


def _clean(spans: Iterable[Span], n: int) -> List[Span]:
    out, last = [], 0
    for s, e, st in sorted(spans):
        if s < last or e <= s or e > n:
            continue
        out.append((s, e, st))
        last = e
    return out


# ── applying spans to python-docx runs ─────────────────────────────────────────

def _ensure_char_style(doc, name: str) -> None:
    try:
        doc.styles[name]
    except KeyError:
        doc.styles.add_style(name, WD_STYLE_TYPE.CHARACTER)


def _split_run(run, offset: int):
    """Split `run` at offset; returns the new right-hand run (same formatting)."""
    text = run.text
    right = copy.deepcopy(run._r)
    run._r.addnext(right)
    run.text = text[:offset]
    from docx.text.run import Run
    r2 = Run(right, run._parent)
    r2.text = text[offset:]
    return r2


def _drop_hyperlink_style(r_elem) -> None:
    rpr = r_elem.find(qn("w:rPr"))
    rstyle = rpr.find(qn("w:rStyle")) if rpr is not None else None
    if rstyle is not None and (rstyle.get(qn("w:val")) or "").lower() in ("hyperlink", "followedhyperlink"):
        rpr.remove(rstyle)


def remove_hyperlinks(para) -> int:
    """Remove the links from a reference paragraph, keeping their text: w:hyperlink elements are
    unwrapped, HYPERLINK fields (begin/instr/separate/end) lose their field codes, and the
    Hyperlink character style is dropped. Other fields are left alone. Returns links removed."""
    p = para._p
    removed = 0
    for link in list(p.iter(qn("w:hyperlink"))):
        parent = link.getparent()
        for child in list(link):
            if child.tag == qn("w:r"):
                _drop_hyperlink_style(child)
            link.addprevious(child)
        parent.remove(link)
        removed += 1
    for simple in list(p.iter(qn("w:fldSimple"))):
        if (simple.get(qn("w:instr")) or "").strip().upper().startswith("HYPERLINK"):
            for child in list(simple):
                if child.tag == qn("w:r"):
                    _drop_hyperlink_style(child)
                simple.addprevious(child)
            simple.getparent().remove(simple)
            removed += 1

    # Complex fields: [begin] [instrText...] [separate] result runs... [end]
    runs = [r for r in p.iter(qn("w:r"))]
    stack = []  # each: {"runs": code runs, "instr": str, "result": bool, "result_runs": []}
    for r in runs:
        fld = r.find(qn("w:fldChar"))
        kind = fld.get(qn("w:fldCharType")) if fld is not None else None
        if kind == "begin":
            stack.append({"code": [r], "instr": "", "sep": False, "result": []})
        elif not stack:
            continue
        elif kind == "separate":
            stack[-1]["code"].append(r)
            stack[-1]["sep"] = True
        elif kind == "end":
            field = stack.pop()
            field["code"].append(r)
            if field["instr"].strip().upper().startswith("HYPERLINK"):
                for code_run in field["code"]:
                    if code_run.getparent() is not None:
                        code_run.getparent().remove(code_run)
                for res in field["result"]:
                    _drop_hyperlink_style(res)
                removed += 1
            elif stack:  # a non-link field nested in another: its runs belong to the outer field
                (stack[-1]["result"] if stack[-1]["sep"] else stack[-1]["code"]).extend(field["code"] + field["result"])
        elif stack[-1]["sep"]:
            stack[-1]["result"].append(r)
        else:
            instr = r.find(qn("w:instrText"))
            stack[-1]["instr"] += (instr.text or "") if instr is not None else ""
            stack[-1]["code"].append(r)
    return removed


def _text_runs(para):
    """The paragraph's runs in order, including those inside w:hyperlink (para.runs leaves them out,
    so a reference with a linked "Medline: 123" never matched para.text and was skipped)."""
    from docx.text.run import Run
    out = []
    for child in para._p:
        if child.tag == qn("w:r"):
            out.append(Run(child, para))
        elif child.tag == qn("w:hyperlink"):
            out.extend(Run(r, para) for r in child if r.tag == qn("w:r"))
    return out


def style_paragraph(para, doc) -> int:
    """Apply bib_* styles to one reference paragraph. Returns the number of fields styled (0 = skipped)."""
    runs = _text_runs(para)
    text = "".join(r.text for r in runs)
    if not text.strip() or text != para.text:
        return 0  # hyperlinks/fields inside the paragraph: leave it alone rather than risk the text
    if any(r.style is not None and r.style.name.startswith("bib_") for r in runs):
        return 0  # already structured (PPH or an earlier run)
    spans = reference_spans(text)
    if not spans:
        return 0
    return _apply_spans(para, doc, spans)


def _apply_spans(para, doc, spans: List[Span]) -> int:
    """Split the paragraph's runs at the span edges and give each span its character style."""
    runs = _text_runs(para)
    text = "".join(r.text for r in runs)
    cuts = sorted({p for s, e, _ in spans for p in (s, e)} - {0, len(text)})
    pos, out = 0, []
    for r in runs:
        length = len(r.text)
        inner = [c - pos for c in cuts if pos < c < pos + length]
        cur, consumed = r, 0
        for c in inner:
            nxt = _split_run(cur, c - consumed)
            out.append((pos + consumed, cur))
            consumed = c
            cur = nxt
        out.append((pos + consumed, cur))
        pos += length
    for s, e, st in spans:
        _ensure_char_style(doc, st)
        for start, r in out:
            if s <= start < e and r.text:
                r.style = doc.styles[st]
    return len(spans)


def style_reference_paragraphs(docx_path: str, paragraph_indexes: Optional[List[int]] = None) -> dict:
    """Style the given body paragraphs (indexes in body order, as in load_blocks). Saves in place."""
    import docx
    from docx.text.paragraph import Paragraph

    document = docx.Document(docx_path)
    paras = [Paragraph(p, document) for p in document.element.body.iter(qn("w:p"))]
    targets = paragraph_indexes if paragraph_indexes is not None else []
    styled = skipped = fields = links = 0
    for idx in targets:
        if 0 <= idx < len(paras):
            links += remove_hyperlinks(paras[idx])  # plain text first, then the bib_* styles
            n = style_paragraph(paras[idx], document)
            if n:
                styled += 1
                fields += n
            else:
                skipped += 1
    document.save(docx_path)
    return {"references_styled": styled, "references_skipped": skipped, "fields": fields, "hyperlinks_removed": links}


def style_citations(docx_path: str, paragraph_indexes: List[int], pattern: "re.Pattern") -> dict:
    """cite_bib on in-text citations ([1], [2,3], (4–6)...) matched by `pattern` in the given
    body paragraphs. Text is never changed; paragraphs that already carry cite_bib are skipped."""
    import docx
    from docx.text.paragraph import Paragraph

    document = docx.Document(docx_path)
    paras = [Paragraph(p, document) for p in document.element.body.iter(qn("w:p"))]
    cited = paragraphs = 0
    for idx in paragraph_indexes:
        if not 0 <= idx < len(paras):
            continue
        para = paras[idx]
        runs = _text_runs(para)
        text = "".join(r.text for r in runs)
        if not text.strip() or text != para.text:
            continue
        if any(r.style is not None and r.style.name.startswith("cite_") for r in runs):
            continue
        spans = [(m.start(), m.end(), "cite_bib") for m in pattern.finditer(text)]
        if spans:
            _apply_spans(para, document, spans)
            cited += len(spans)
            paragraphs += 1
    document.save(docx_path)
    return {"citations_styled": cited, "citation_paragraphs": paragraphs}
