"""
Shared, python-docx-independent helpers for the heading classifier:
relative font-size ranking, spacing-baseline detection, and safe unit
conversion. Kept free of python-docx imports so they're trivially testable
with plain numbers.
"""

from __future__ import annotations

from statistics import median
from typing import Iterable, Optional


def safe_pt(length) -> Optional[float]:
    """Convert a python-docx Length (EMU-based: font.size, indents,
    space_before/after, ...) to plain float points. Returns None if `length`
    is None, centralizing the `.pt` access + None-guard repeated throughout
    features.py."""
    if length is None:
        return None
    return float(length.pt)


def rank_font_sizes(sizes: Iterable[Optional[float]]) -> dict[float, int]:
    """Dense-rank the distinct font sizes (in pt) seen across a document,
    largest first: rank 0 = the document's largest font size, rank 1 = the
    next distinct size down, etc. Ties share a rank. None values are
    ignored.

    "Largest font" must be relative to each document's own size
    distribution (a 14pt heading in one document may be the largest font
    present, while 14pt is body text in another), never a fixed absolute pt
    cutoff.
    """
    distinct_sizes = sorted({s for s in sizes if s is not None}, reverse=True)
    return {size: rank for rank, size in enumerate(distinct_sizes)}


def compute_baseline_spacing(values_pt: Iterable[float]) -> float:
    """Median of the nonzero spacing values (space-before/after, in pt)
    seen across a document. Returns 0.0 if no nonzero values are present.
    Used as the reference point for "large space before/after" instead of a
    fixed absolute pt threshold."""
    nonzero = [v for v in values_pt if v]
    if not nonzero:
        return 0.0
    return float(median(nonzero))


def is_large_space(value_pt: Optional[float], baseline_pt: float, multiplier: float = 1.5) -> bool:
    """True if `value_pt` is meaningfully larger than the document's
    baseline spacing. With no established baseline (baseline_pt <= 0), any
    positive spacing counts as "large" relative to a document with no
    spacing convention at all."""
    if value_pt is None or value_pt <= 0:
        return False
    if baseline_pt <= 0:
        return True
    return value_pt >= baseline_pt * multiplier
