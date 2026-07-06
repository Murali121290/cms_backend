"""
Deterministic, formatting-only heading classification engine.

Classifies paragraph heading levels (H1-H6) purely from python-docx
formatting features (bold, font size, alignment, style name, numbering,
spacing, ...) - no LLMs, embeddings, or external AI services. See
`pipeline.classify_headings_by_formatting` for the entry point wired into
the live structuring pipeline (styler.process_docx), and
`pipeline.classify_document` for standalone analysis/debugging.
"""

from .models import ClassificationResult, HeadingNode, Paragraph
from .pipeline import classify_document, classify_headings_by_formatting

__all__ = [
    "Paragraph",
    "HeadingNode",
    "ClassificationResult",
    "classify_document",
    "classify_headings_by_formatting",
]
