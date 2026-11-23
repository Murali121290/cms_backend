"""Parse an EOC/EOL assessment Word file into questions for rule checking.

Expected plain one-line-per-item layout (G-W "Assessment Question Extraction
and Formatting Requirements"):

    1.<TAB>Question text
    A.<TAB>option          (*A. marks the correct answer)
    ...
    Shuffle: True          (optional)
    Title: ...
    Learning Outcome: N.N
    Reference: <prefix>CC_QQQ

True/False questions use bare ``True`` / ``False`` lines (``*True`` marks the
answer). Instruction lines such as "Match the following ..." may appear
between questions and introduce a matching set.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Optional

import docx
from docx.oxml.ns import qn

QUESTION_RE = re.compile(r"^(\d+)\.\t(.*)$", re.S)
QUESTION_SPACE_RE = re.compile(r"^(\d+)\.\s+(?!\t)(.*)$", re.S)
# Loose question detector used to flag lines that look like a question but
# don't use "N.<TAB>" (e.g. "1. Text" with a space).
LOOSE_QUESTION_RE = re.compile(r"^\s*(\d+)[.)]\s+\S")
OPTION_RE = re.compile(r"^(\*?)([A-Z])\.\t(.*)$", re.S)
# Ordering-question answer line: "<position>.<TAB><letter>.<TAB>item"
ORDER_ITEM_RE = re.compile(r"^(\d+)\.\t([A-Z])\.\t(.*)$", re.S)
LOOSE_OPTION_RE = re.compile(r"^\s*\*?\s*\*?([A-Z])[.)]\s*\*?\s*\S")
TF_RE = re.compile(r"^(\*?)(True|False)\.?$")
SHUFFLE_LOOSE_RE = re.compile(r"^\s*shuffle\s*:", re.I)
TITLE_RE = re.compile(r"^Title:", re.I)
LO_RE = re.compile(r"^Learning\s*Outcome\s*:", re.I)
REF_RE = re.compile(r"^Reference\s*:", re.I)
CHAPTER_FROM_NAME_RE = re.compile(r"_(?:ch|chap|chapter|eoc|eol|lesson)[_-]?(\d+)", re.I)
HEADER_RE = re.compile(r"^(Chapter|Lesson)\s+\d+(\.\d+)?\s*$", re.I)


@dataclass
class ImageMeta:
    line_idx: int
    name: str = "Image"
    alt_text: str = ""
    title: str = ""
    is_decorative: bool = False
    raw_tag: str = "drawing"
    context: str = ""
    line_label: str = ""


@dataclass
class Line:
    idx: int  # paragraph index (0-based) in the document
    text: str
    is_blank: bool
    has_numbering: bool = False
    has_indent: bool = False
    has_color: bool = False
    has_highlight: bool = False
    has_image: bool = False
    images: list[ImageMeta] = field(default_factory=list)


@dataclass
class Option:
    letter: str
    text: str
    starred: bool
    raw: str
    idx: int


@dataclass
class Question:
    number: int
    stem: str
    raw: str
    idx: int
    kind: str = "MC"  # MC | TF | ORDER | SA | EMPTY
    has_tab_error: bool = False
    order_positions: list[int] = field(default_factory=list)  # ORDER: the leading 1, 2, 3…
    options: list[Option] = field(default_factory=list)
    images: list[ImageMeta] = field(default_factory=list)
    shuffle_line: Optional[Line] = None
    title_line: Optional[Line] = None
    lo_line: Optional[Line] = None
    ref_line: Optional[Line] = None
    # Ordered list of (role, Line) for every line in the block after the stem.
    # role ∈ option | tf | shuffle | title | lo | ref | image | other
    body: list[tuple[str, Line]] = field(default_factory=list)
    group_instruction: Optional[str] = None  # "Match the following ..." etc.
    duplicate_tags: list[str] = field(default_factory=list)
    extra_lines: list[tuple[str, "Line"]] = field(default_factory=list)  # duplicate tag lines (role, line)

    @property
    def starred_count(self) -> int:
        return sum(1 for o in self.options if o.starred)


@dataclass
class ChapterFile:
    filename: str
    chapter_no: Optional[int]
    lines: list[Line]
    questions: list[Question]
    table_count: int = 0
    image_count: int = 0
    equation_count: int = 0
    images: list[ImageMeta] = field(default_factory=list)
    stray_lines: list[Line] = field(default_factory=list)  # before Q1 / unattached
    header_line: Optional[Line] = None
    had_revisions: bool = False  # file contained tracked changes (read as accepted)


def chapter_from_filename(filename: str) -> Optional[int]:
    m = CHAPTER_FROM_NAME_RE.search(filename)
    return int(m.group(1)) if m else None


def _is_black(val: str) -> bool:
    """'auto' or a near-black hex (e.g. 221E1F copied from a PDF) reads as black."""
    v = val.lower()
    if v == "auto":
        return True
    if re.fullmatch(r"[0-9a-f]{6}", v):
        return all(int(v[i:i + 2], 16) <= 0x40 for i in (0, 2, 4))
    return False


def _para_flags(p) -> dict:
    pPr = p._p.pPr
    has_numbering = pPr is not None and pPr.numPr is not None
    has_indent = False
    if pPr is not None:
        ind = pPr.find(qn("w:ind"))
        if ind is not None:
            for attr in ("w:left", "w:start", "w:firstLine", "w:hanging"):
                v = ind.get(qn(attr))
                if v and v not in ("0",):
                    has_indent = True
    has_color = False
    has_highlight = False
    for r in p.runs:
        rPr = r._r.rPr
        if rPr is None:
            continue
        c = rPr.find(qn("w:color"))
        if c is not None and not _is_black(c.get(qn("w:val")) or "auto"):
            has_color = True
        if rPr.find(qn("w:highlight")) is not None:
            has_highlight = True
        shd = rPr.find(qn("w:shd"))
        if shd is not None and (shd.get(qn("w:fill")) or "auto").lower() not in ("auto", "ffffff"):
            has_highlight = True
    return dict(has_numbering=has_numbering, has_indent=has_indent, has_color=has_color, has_highlight=has_highlight)


def _extract_images(p, line_idx: int, context: str = "", label: str = "") -> list[ImageMeta]:
    imgs: list[ImageMeta] = []
    lbl = label or f"¶{line_idx + 1}"
    # 1. DrawingML (<w:drawing>)
    for d in p._p.iter(qn("w:drawing")):
        doc_prs = [e for e in d.iter() if e.tag.endswith("docPr")]
        decorative = any("decorative" in e.tag for e in d.iter())
        if doc_prs:
            for dp in doc_prs:
                descr = (dp.get("descr") or "").strip()
                title = (dp.get("title") or "").strip()
                name = dp.get("name") or "Image"
                imgs.append(ImageMeta(
                    line_idx=line_idx,
                    name=name,
                    alt_text=descr,
                    title=title,
                    is_decorative=decorative,
                    raw_tag="drawing",
                    context=context,
                    line_label=lbl,
                ))
        else:
            imgs.append(ImageMeta(
                line_idx=line_idx,
                name="Drawing",
                alt_text="",
                title="",
                is_decorative=decorative,
                raw_tag="drawing",
                context=context,
                line_label=lbl,
            ))
    # 2. Legacy VML (<w:pict>)
    for pt in p._p.iter(qn("w:pict")):
        alt = ""
        title = ""
        name = ""
        found = False
        for elem in pt.iter():
            for k, v in elem.attrib.items():
                k_low = k.lower()
                if k_low.endswith("alt") or k_low == "alt":
                    alt = v
                elif k_low.endswith("title") or k_low == "title":
                    title = v
                elif k_low.endswith("id") or k_low == "id" or k_low.endswith("name") or k_low == "name":
                    if not name:
                        name = v
            if elem.tag.endswith("shape") or elem.tag.endswith("imagedata"):
                found = True
        if found:
            imgs.append(ImageMeta(
                line_idx=line_idx,
                name=name or "Picture",
                alt_text=(alt or title).strip(),
                title=title.strip(),
                is_decorative=False,
                raw_tag="pict",
                context=context,
                line_label=lbl,
            ))
    return imgs


def parse_docx(data: bytes, filename: str) -> ChapterFile:
    d = docx.Document(io.BytesIO(data))
    body = d.element.body
    # Read the document as it will look once tracked changes are accepted
    # (python-docx's paragraph.text ignores text inside <w:ins>/<w:del>).
    from .tracked import accept_all, has_tracked_changes

    had_revisions = has_tracked_changes(body)
    if had_revisions:
        accept_all(body)

    lines: list[Line] = []
    cf_images: list[ImageMeta] = []
    for i, p in enumerate(d.paragraphs):
        text = p.text
        # find nearby context snippet
        ctx = ""
        for prev_idx in range(i - 1, max(-1, i - 6), -1):
            t = d.paragraphs[prev_idx].text.strip()
            if t:
                ctx = t
                break
        if not ctx:
            for next_idx in range(i + 1, min(len(d.paragraphs), i + 6)):
                t = d.paragraphs[next_idx].text.strip()
                if t:
                    ctx = t
                    break
        p_images = _extract_images(p, i, context=ctx[:100], label=f"¶{i + 1}")
        has_image = bool(p_images)
        if has_image:
            cf_images.extend(p_images)
        is_blank = not text.strip() and not has_image
        lines.append(Line(idx=i, text=text, is_blank=is_blank, has_image=has_image, images=p_images, **_para_flags(p)))

    # Also extract images from tables (if any)
    for t_idx, tbl in enumerate(d.tables):
        for r_idx, row in enumerate(tbl.rows):
            for c_idx, cell in enumerate(row.cells):
                for p_idx, tp in enumerate(cell.paragraphs):
                    t_label = f"Table {t_idx + 1} R{r_idx + 1}C{c_idx + 1}"
                    t_ctx = tp.text.strip() or f"Table {t_idx + 1}"
                    t_images = _extract_images(tp, len(lines) + t_idx, context=t_ctx[:100], label=t_label)
                    if t_images:
                        cf_images.extend(t_images)

    m_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
    cf = ChapterFile(
        filename=filename,
        chapter_no=chapter_from_filename(filename),
        lines=lines,
        questions=[],
        table_count=len(body.findall(qn("w:tbl"))),
        image_count=len(cf_images) or (sum(1 for _ in body.iter(qn("w:drawing"))) + sum(1 for _ in body.iter(qn("w:pict")))),
        equation_count=sum(1 for _ in body.iter(m_ns + "oMath")),
        images=cf_images,
        had_revisions=had_revisions,
    )

    current: Optional[Question] = None
    pending_instruction: Optional[str] = None
    group_instruction: Optional[str] = None

    for ln in lines:
        if ln.is_blank:
            continue
        text = ln.text
        stripped = text.strip()

        # Ordering question answer lines look like questions ("1.\tG.\titem")
        # but belong to the open question block.
        oi = ORDER_ITEM_RE.match(text)
        if oi and current is not None and current.title_line is None and current.ref_line is None \
                and (current.kind == "ORDER" or (current.kind == "MC" and not current.options)):
            current.kind = "ORDER"
            current.options.append(Option(letter=oi.group(2), text=oi.group(3).strip(), starred=False, raw=text, idx=ln.idx))
            current.order_positions.append(int(oi.group(1)))
            current.body.append(("order", ln))
            continue

        qm = QUESTION_RE.match(text)
        qm_loose = QUESTION_SPACE_RE.match(text) if not qm else None
        is_loose_q = False
        if qm_loose:
            q_cand = int(qm_loose.group(1))
            if current is None and q_cand == 1:
                is_loose_q = True
            elif current is not None and current.ref_line is not None and q_cand > current.number:
                is_loose_q = True

        if qm or is_loose_q:
            m = qm or qm_loose
            if pending_instruction is not None:
                group_instruction = pending_instruction
                pending_instruction = None
            elif current is not None and current.ref_line is not None and group_instruction is not None:
                # A matching set continues while its questions share the same
                # option list; it ends when a question has different options.
                pass
            current = Question(
                number=int(m.group(1)),
                stem=m.group(2).strip(),
                raw=text,
                idx=ln.idx,
                has_tab_error=bool(is_loose_q),
                group_instruction=group_instruction,
            )
            if not current.stem:
                current.kind = "EMPTY"
            cf.questions.append(current)
            continue

        if current is None:
            if cf.header_line is None and HEADER_RE.match(stripped):
                cf.header_line = ln
            elif ln.has_image:
                cf.stray_lines.append(ln)
            elif not ln.is_blank:
                # Text before the first question (header, instruction for Q1…)
                if re.match(r"^(match|for questions|use the following|refer to)", stripped, re.I):
                    pending_instruction = stripped
                else:
                    cf.stray_lines.append(ln)
            continue

        # Inside a question block
        def tag(role: str, attr: Optional[str] = None):
            current.body.append((role, ln))
            if attr:
                if getattr(current, attr) is not None:
                    current.duplicate_tags.append(role)
                    current.extra_lines.append((role, ln))
                else:
                    setattr(current, attr, ln)

        if ln.has_image:
            current.images.extend(ln.images)
            if not stripped:
                tag("image")
                continue

        om = OPTION_RE.match(text)
        tf = TF_RE.match(stripped)
        if om:
            current.options.append(Option(letter=om.group(2), text=om.group(3).strip(), starred=bool(om.group(1)), raw=text, idx=ln.idx))
            tag("option")
        elif tf and current.kind != "EMPTY":
            current.kind = "TF"
            current.options.append(Option(letter=tf.group(2), text=tf.group(2), starred=bool(tf.group(1)), raw=text, idx=ln.idx))
            tag("tf")
        elif SHUFFLE_LOOSE_RE.match(stripped):
            tag("shuffle", "shuffle_line")
        elif TITLE_RE.match(stripped):
            tag("title", "title_line")
        elif LO_RE.match(stripped):
            tag("lo", "lo_line")
        elif REF_RE.match(stripped):
            tag("ref", "ref_line")
        elif current.ref_line is not None:
            # Text after a completed question = instruction for the next set.
            pending_instruction = stripped
            group_instruction = None
        elif current.title_line is None and current.lo_line is None and current.ref_line is None and not current.options:
            # Body lines before Title/LO/Ref when no options exist are the model answer / solution text
            tag("answer")
        else:
            tag("other")

    # Finalize question kind: detect Short Answer (SA) questions
    has_any_starred_or_shuffle = any(
        any(o.starred for o in q.options) or q.shuffle_line is not None
        for q in cf.questions
    )
    for q in cf.questions:
        if q.kind == "MC":
            if not q.options and q.shuffle_line is None:
                q.kind = "SA"
            elif not has_any_starred_or_shuffle and q.shuffle_line is None:
                q.kind = "SA"

    # Matching-set membership: a group instruction applies only while the
    # following questions share an identical option list.
    by_group: dict[str, list[Question]] = {}
    for q in cf.questions:
        if q.group_instruction:
            by_group.setdefault(q.group_instruction, []).append(q)
    for instr, qs in by_group.items():
        base = [o.text for o in qs[0].options]
        for q in qs[1:]:
            if [o.text for o in q.options] != base:
                q.group_instruction = None

    return cf
