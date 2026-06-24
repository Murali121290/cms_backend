"""
Reference numbering normalization.

Numbered reference entries (tag REF-N / REF-N-FIRST / REF-N-MID / REF-N-LAST)
keep whatever number/format the author typed - this pass renumbers each
contiguous run of REF-N-family entries sequentially from 1, rewriting only
the leading numbering substring of the paragraph's first run.

The rewrite only happens when the matched leading-number substring lives
entirely within the first run's own text (the common case). When it can't
be located there - e.g. the number was split across runs - the entry is
left untouched rather than risk corrupting run-level formatting, mirroring
the caution hierarchy_manager.py already takes for safe single-run rewrites.

Idempotent: an already-correctly-numbered run is rewritten to the same text.
"""

from __future__ import annotations

import re
from typing import Any

_LEADING_NUMBER_RE = re.compile(r"^\s*(?:\[\d+\]|\(\d+\)|\d+[\.\)]|\d+(?=\s))\s*")

_REF_N_FAMILY = ("REF-N", "REF-N-FIRST", "REF-N-MID", "REF-N-LAST")
_BRIDGE_TAGS = ("EMPTY", "PMI")


def _rewrite_leading_number(para, n: int) -> None:
    if para is None or not para.runs:
        return

    full_text = para.text
    match = _LEADING_NUMBER_RE.match(full_text)
    if not match:
        return

    leading = match.group(0)
    first_run = para.runs[0]
    if not first_run.text.startswith(leading):
        # Numbering substring spans multiple runs - unsafe to rewrite.
        return

    remainder = first_run.text[len(leading):]
    new_text = f"{n}. {remainder.lstrip()}"
    if first_run.text != new_text:
        first_run.text = new_text


def normalize_reference_numbers(annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Renumber each contiguous run of REF-N-family entries sequentially from 1.

    Mutates and returns the same annotation list/paragraphs in place.
    """
    n = 0
    in_run = False

    for item in annotations:
        tag = item.get("tag", "")
        if tag in _REF_N_FAMILY:
            n += 1
            in_run = True
            _rewrite_leading_number(item.get("para"), n)
            continue

        if in_run and tag in _BRIDGE_TAGS:
            continue  # transparent bridge - doesn't break or count toward the run

        in_run = False
        n = 0

    return annotations
