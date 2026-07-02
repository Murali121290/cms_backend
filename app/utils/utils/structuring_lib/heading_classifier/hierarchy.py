"""
Phase 5 of the formatting-based heading classifier: build a heading tree
from a flat, already-classified list of paragraphs using a stack.
"""

from __future__ import annotations

from .models import HeadingNode, Paragraph

_HEADING_LEVELS = {f"H{i}": i for i in range(1, 7)}


def build_hierarchy(paragraphs: list[Paragraph]) -> list[HeadingNode]:
    """Walk `paragraphs` in document order, maintaining a stack of
    currently-open heading nodes:

    - A heading paragraph (classification in H1..H6) pops every open node at
      its level or deeper, then is attached as a child of whatever remains
      open (or becomes a new root if nothing is open), and is itself pushed.
    - Any other paragraph is attached as a body leaf of the innermost open
      heading; if no heading is open yet (e.g. a document abstract/preamble
      before the first heading), it is not attached anywhere - the flat
      `paragraphs` list (kept separately by the caller) already preserves
      it.

    Returns the forest of top-level nodes - a document can have zero, one,
    or many roots; a document that starts at H3 with no H1/H2 gets H3 roots
    directly rather than synthesizing missing ancestor levels."""
    roots: list[HeadingNode] = []
    stack: list[HeadingNode] = []

    for paragraph in paragraphs:
        level = _HEADING_LEVELS.get(paragraph.classification or "")
        if level is None:
            if stack:
                stack[-1].body.append(paragraph)
            continue

        while stack and stack[-1].level >= level:
            stack.pop()

        node = HeadingNode(paragraph=paragraph, level=level)
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)

    return roots
