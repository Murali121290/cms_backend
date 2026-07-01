"""
Data model for the formatting-based heading classification engine.

These dataclasses hold only plain, JSON-serializable values (no python-docx
objects), so a Paragraph/HeadingNode/ClassificationResult can be logged,
returned from an API, or serialized to JSON via `to_dict()` without any
further conversion.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Paragraph:
    """A single paragraph, its extracted formatting features, and the
    formatting engine's verdict for it."""

    id: int
    index: int
    text: str
    features: dict[str, Any] = field(default_factory=dict)
    # 0-based rank among the document's distinct heading-candidate
    # signatures (0 = most senior, i.e. H1's signature); -1 for paragraphs
    # that aren't heading candidates at all (classification == "Body").
    score: int = -1
    classification: Optional[str] = None  # "H1".."H6" or "Body"
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "index": self.index,
            "text": self.text,
            "features": self.features,
            "score": self.score,
            "classification": self.classification,
            "reasons": list(self.reasons),
        }


@dataclass
class HeadingNode:
    """A node in the heading hierarchy tree. `children` are nested headings;
    `body` are non-heading paragraphs that fall directly under this heading,
    before the next heading at any level."""

    paragraph: Paragraph
    level: int
    children: list["HeadingNode"] = field(default_factory=list)
    body: list[Paragraph] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "paragraph": self.paragraph.to_dict(),
            "level": self.level,
            "children": [child.to_dict() for child in self.children],
            "body": [p.to_dict() for p in self.body],
        }


@dataclass
class ClassificationResult:
    """Full output of the standalone analysis pipeline: every paragraph in
    document order, plus the heading hierarchy built from them. `roots` is a
    forest, not a single tree - a document can have zero, one, or many
    top-level headings."""

    paragraphs: list[Paragraph] = field(default_factory=list)
    roots: list[HeadingNode] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "paragraphs": [p.to_dict() for p in self.paragraphs],
            "roots": [r.to_dict() for r in self.roots],
        }
