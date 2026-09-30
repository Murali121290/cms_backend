"""Paragraph-level view of a manuscript DOCX, shared by the Pre-Editing and Language checks.

Paragraph indexes follow doc.element.body.iter(w:p), the same order
DocxToXhtmlRunsEngine writes to data-para-idx, so an issue's block_id
("p12") points at the matching paragraph in the editor's XHTML.
"""
import os
import re
from dataclasses import dataclass, field
from typing import List, Optional, Set

import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from sqlalchemy.orm import Session

from app.domains.journals.models import JournalArticle, JournalFile
from app.processing.structuring_qa_analyzer import get_tag_category_info

UNTAGGED_STYLES = {"normal", "default", "normal (web)", "no spacing"}


def categorize_style(style_name: str) -> str:
    s = (style_name or "Normal").strip()
    low = s.lower()
    m = re.fullmatch(r"(?:heading\s*|head|h)(\d)", low)
    if m:
        return f"Heading {m.group(1)}"
    if low in UNTAGGED_STYLES:
        return "Un-structured"
    # Journal front-matter tags (see journals/structuring.py) and structuring_lib tags.
    if low in ("title", "articletitle", "article-title", "at", "atl", "ct"):
        return "Article Title"
    if low in ("au", "cau", "ttlpg-au", "authors", "articleauthor"):
        return "Authors"
    if low in ("aff", "cauf", "ttlpg-au-affil", "contrib-au-affil", "affiliation", "articleaffiliation"):
        return "Affiliation"
    if low.startswith("correspond") or low in ("corresp", "cor"):
        return "Corresponding Author"
    if low in ("pmi", "aty", "articletype"):
        return "Front Matter"
    if low in ("absh", "abstractheading"):
        return "Abstract Heading"
    if "abstract" in low or low == "abs":
        return "Abstract"
    if "keyword" in low or low == "kwd":
        return "Keywords"
    if low in ("refh", "refh1", "ref-h", "refhead"):
        return "Reference Heading"
    if low == "eq":
        return "Equation"
    if low == "caption":
        return "Caption"
    return get_tag_category_info(s)[0]


def heading_level(category: str) -> Optional[int]:
    m = re.fullmatch(r"Heading (\d)", category)
    return int(m.group(1)) if m else None


@dataclass
class Block:
    idx: int
    style: str
    category: str
    text: str
    in_table: bool = False
    has_drawing: bool = False
    before_table: bool = False
    after_table: bool = False
    char_styles: Set[str] = field(default_factory=set)

    @property
    def block_id(self) -> str:
        return f"p{self.idx}"

    @property
    def words(self) -> int:
        return len(self.text.split())


def load_blocks(docx_path: str) -> List[Block]:
    document = docx.Document(docx_path)
    blocks: List[Block] = []
    for idx, p_elem in enumerate(document.element.body.iter(qn("w:p"))):
        para = Paragraph(p_elem, document)
        style = para.style.name if para.style is not None else "Normal"
        parent = p_elem.getparent()
        in_table = parent is not None and parent.tag == qn("w:tc")
        nxt, prev = p_elem.getnext(), p_elem.getprevious()
        char_styles = set()
        for run in para.runs:
            name = run.style.name if run.style is not None else None
            if name:
                char_styles.add(name)
        blocks.append(Block(
            idx=idx, style=style, category=categorize_style(style), text=para.text.strip(),
            in_table=in_table,
            has_drawing=bool(p_elem.findall(".//" + qn("w:drawing"))),
            before_table=nxt is not None and nxt.tag == qn("w:tbl"),
            after_table=prev is not None and prev.tag == qn("w:tbl"),
            char_styles=char_styles,
        ))
    return blocks


def resolve_manuscript_path(db: Session, article: JournalArticle) -> Optional[str]:
    """The article's working manuscript: the editor's edited copy if there is one, else the original DOCX."""
    if article.edited_docx_path and os.path.exists(article.edited_docx_path):
        return article.edited_docx_path
    return original_manuscript_path(db, article)


def original_manuscript_path(db: Session, article: JournalArticle) -> Optional[str]:
    """The uploaded manuscript DOCX, never the working copy."""
    if article.original_docx_path and os.path.exists(article.original_docx_path):
        return article.original_docx_path
    files = db.query(JournalFile).filter(
        JournalFile.article_id == article.id,
        JournalFile.category == "Manuscript",
        JournalFile.file_type == "docx",
    ).order_by(JournalFile.id).all()
    for f in files:
        if f.path and os.path.exists(f.path) and not os.path.basename(f.path).startswith("~$"):
            return f.path
    return None


def snippet(text: str, start: int = 0, length: int = 0, radius: int = 48) -> str:
    lo, hi = max(0, start - radius), min(len(text), start + length + radius)
    return ("…" if lo else "") + text[lo:hi] + ("…" if hi < len(text) else "")
