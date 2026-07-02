"""
Phase 2 of the formatting-based heading classifier: extract every
formatting-relevant feature for each paragraph.

Two-pass design: `build_feature_context()` walks the whole document once to
compute document-relative statistics (font-size ranks, spacing baseline)
that no single paragraph can compute on its own; `extract_features()` then
reads one paragraph at a time, using that context to resolve relative
signals like "is this the largest font in the document."

Numbering/bullet detection reuses `is_list_paragraph`/`get_word_list_type`
from `annotator.py` rather than reimplementing Word-list XML inspection.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph as DocxParagraph

from ..annotator import get_word_list_type, is_list_paragraph
from .reader import RawParagraph
from .utils import compute_baseline_spacing, is_large_space, rank_font_sizes, safe_pt

_HEADING_STYLE_RE = re.compile(r"^(heading\s*\d|h\d)\b", re.IGNORECASE)
_BULLET_PREFIX_RE = re.compile(r"^[•\-–—▪■●○➢*>]\s+")
_NUMBER_PREFIX_RE = re.compile(r"^(?:\d+|[ivxlcdm]+|[a-zA-Z])[.\)]\s+", re.IGNORECASE)
_SENTENCE_SPLIT_RE = re.compile(r"[.!?]+(?:\s|$)")


@dataclass
class DocumentFeatureContext:
    """Whole-document statistics needed before any single paragraph's
    features can be finalized. Built once per document via
    `build_feature_context()`, then passed into `extract_features()` for
    every paragraph."""

    font_size_ranks: dict[float, int]
    spacing_baseline_pt: float
    total_paragraphs: int


def build_feature_context(raw_paragraphs: list[RawParagraph]) -> DocumentFeatureContext:
    """Pass 1: walk every paragraph's runs once to collect every font size
    and space-before/after value present in the document, then derive the
    relative font-size ranking and spacing baseline from that."""
    sizes: list[Optional[float]] = []
    spacing_values: list[float] = []

    for raw in raw_paragraphs:
        para = raw.docx_paragraph
        for run in para.runs:
            sizes.append(safe_pt(run.font.size))

        pf = para.paragraph_format
        before = safe_pt(pf.space_before)
        after = safe_pt(pf.space_after)
        if before is not None:
            spacing_values.append(before)
        if after is not None:
            spacing_values.append(after)

    return DocumentFeatureContext(
        font_size_ranks=rank_font_sizes(sizes),
        spacing_baseline_pt=compute_baseline_spacing(spacing_values),
        total_paragraphs=len(raw_paragraphs),
    )


def extract_features(
    raw: RawParagraph,
    prev: Optional[RawParagraph],
    next_: Optional[RawParagraph],
    context: DocumentFeatureContext,
    doc: DocxDocument,
) -> dict[str, Any]:
    """Pass 2: per-paragraph. Returns a flat, JSON-serializable dict (no
    python-docx objects, no un-stringified enums) covering text, font,
    paragraph, word-style, and context features."""
    para = raw.docx_paragraph
    text = raw.text
    stripped = text.strip()
    words = stripped.split()

    features: dict[str, Any] = {}

    # --- Text features ---
    features.update({
        "char_count": len(text),
        "word_count": len(words),
        "sentence_count": _sentence_count(stripped),
        "is_empty": not stripped,
        "is_all_uppercase": _is_all_uppercase(stripped),
        "is_title_case": _is_title_case(words),
        "is_lowercase": _is_lowercase(stripped),
        "ends_with_period": stripped.endswith("."),
        "ends_with_colon": stripped.endswith(":"),
    })

    # --- Word style / numbering (computed early so the text-level
    # starts_with_numbering/starts_with_bullet flags below can fold in real
    # Word list formatting, not just a manual text prefix) ---
    is_word_list = is_list_paragraph(para)
    numbering_format = get_word_list_type(para, doc) if is_word_list else None
    style_name = para.style.name if para.style is not None else None

    features.update({
        "starts_with_bullet": bool(_BULLET_PREFIX_RE.match(stripped)) or numbering_format == "bullet",
        "starts_with_numbering": bool(_NUMBER_PREFIX_RE.match(stripped)) or numbering_format in ("number", "roman"),
    })

    # --- Font features (dominant run) ---
    run = _dominant_run(para)
    font_size_pt = safe_pt(run.font.size) if run is not None else None
    features.update({
        "font_family": run.font.name if run is not None else None,
        "font_size_pt": font_size_pt,
        "font_size_rank": context.font_size_ranks.get(font_size_pt) if font_size_pt is not None else None,
        "bold": bool(run.bold) if run is not None else False,
        "italic": bool(run.italic) if run is not None else False,
        "underline": bool(run.underline) if run is not None else False,
        "font_color_rgb": _font_color_rgb(run) if run is not None else None,
        "highlight_color": _highlight_color(run) if run is not None else None,
    })

    # --- Paragraph features ---
    pf = para.paragraph_format
    space_before_pt = safe_pt(pf.space_before)
    space_after_pt = safe_pt(pf.space_after)
    features.update({
        "alignment": _alignment_name(para),
        "left_indent_pt": safe_pt(pf.left_indent),
        "right_indent_pt": safe_pt(pf.right_indent),
        "first_line_indent_pt": safe_pt(pf.first_line_indent),
        "space_before_pt": space_before_pt,
        "space_after_pt": space_after_pt,
        "line_spacing": _line_spacing(para),
        "is_large_space_before": is_large_space(space_before_pt, context.spacing_baseline_pt),
        "is_large_space_after": is_large_space(space_after_pt, context.spacing_baseline_pt),
    })

    # --- Word style features ---
    outline_level = _outline_level(para)
    features.update({
        "style_name": style_name,
        "outline_level": outline_level,
        "is_heading_style": _is_heading_style(style_name, outline_level),
        "numbering_format": numbering_format,
        "is_list": is_word_list,
    })

    # --- Context features ---
    total = max(context.total_paragraphs - 1, 1)
    features.update({
        "prev_is_empty": (not prev.text.strip()) if prev is not None else None,
        "next_is_empty": (not next_.text.strip()) if next_ is not None else None,
        "position_index": raw.index,
        "position_ratio": raw.index / total,
        "prev_font_size_rank": _font_size_rank_for(prev, context) if prev is not None else None,
        "next_font_size_rank": _font_size_rank_for(next_, context) if next_ is not None else None,
    })

    return features


def _dominant_run(para: DocxParagraph):
    """Heading-candidate paragraphs are usually single-run, but multi-run
    paragraphs (mixed formatting) need a deterministic "representative" run
    for font/bold/etc. Picks the run with the most characters (ties: first
    run), so a short leading symbol/number run doesn't dominate the font
    read for an otherwise-bold heading."""
    non_empty = [r for r in para.runs if r.text]
    if non_empty:
        return max(non_empty, key=lambda r: len(r.text))
    return para.runs[0] if para.runs else None


def _font_size_rank_for(raw: RawParagraph, context: DocumentFeatureContext) -> Optional[int]:
    run = _dominant_run(raw.docx_paragraph)
    if run is None:
        return None
    size = safe_pt(run.font.size)
    return context.font_size_ranks.get(size) if size is not None else None


def _font_color_rgb(run) -> Optional[str]:
    try:
        color = run.font.color
        if color is not None and color.type is not None and color.rgb is not None:
            return str(color.rgb)
    except Exception:
        pass
    return None


def _highlight_color(run) -> Optional[str]:
    try:
        highlight = run.font.highlight_color
        return highlight.name if highlight is not None else None
    except Exception:
        return None


def _alignment_name(para: DocxParagraph) -> Optional[str]:
    try:
        alignment = para.alignment
        return alignment.name if alignment is not None else None
    except Exception:
        return None


def _line_spacing(para: DocxParagraph) -> Optional[float]:
    try:
        spacing = para.paragraph_format.line_spacing
        if spacing is None:
            return None
        if hasattr(spacing, "pt"):
            return float(spacing.pt)
        return float(spacing)
    except Exception:
        return None


def _outline_level(para: DocxParagraph) -> Optional[int]:
    """Read w:outlineLvl from the paragraph's raw XML; no python-docx-native
    accessor exists for this. Returns 0-8 (Word's native range), or None if
    absent."""
    try:
        p_pr = para._p.pPr
        if p_pr is None:
            return None
        element = p_pr.find(qn("w:outlineLvl"))
        if element is None:
            return None
        val = element.get(qn("w:val"))
        return int(val) if val is not None else None
    except Exception:
        return None


def _is_heading_style(style_name: Optional[str], outline_level: Optional[int]) -> bool:
    if style_name and _HEADING_STYLE_RE.match(style_name.strip()):
        return True
    return outline_level is not None and outline_level <= 8


def _is_all_uppercase(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


def _is_lowercase(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and all(c.islower() for c in letters)


def _is_title_case(words: list[str]) -> bool:
    """At least 70% of words start with an uppercase letter - the same
    title-case heuristic styler.py already uses for stub-heading detection
    (`_looks_like_stub_heading`), reused here for consistency rather than
    inventing a second convention."""
    if not words:
        return False
    capitalized = sum(1 for w in words if w[:1].isupper())
    return (capitalized / len(words)) >= 0.7


def _sentence_count(stripped: str) -> int:
    if not stripped:
        return 0
    count = len(_SENTENCE_SPLIT_RE.findall(stripped))
    return count if count > 0 else 1
