"""
Phase 1 of the formatting-based heading classifier: read paragraphs out of a
DOCX document (or an existing regex-engine `annotations` list) into a flat,
ordered list of RawParagraph carriers, before any feature extraction
happens.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from docx.document import Document as DocxDocument
from docx.text.paragraph import Paragraph as DocxParagraph


@dataclass
class RawParagraph:
    """A python-docx Paragraph paired with its position in the document,
    before feature extraction. Kept separate from models.Paragraph (the
    post-feature-extraction, JSON-serializable result) so this module has no
    dependency on features.py."""

    index: int
    docx_paragraph: DocxParagraph
    text: str


def read_paragraphs(doc: DocxDocument) -> list[RawParagraph]:
    """Read every top-level body paragraph (doc.paragraphs) in document
    order. Table-cell paragraphs are out of scope, matching
    annotator.annotate_document's own scope (tables are handled separately
    by tag_tables/table_tagger)."""
    return [
        RawParagraph(index=i, docx_paragraph=p, text=p.text)
        for i, p in enumerate(doc.paragraphs)
    ]


def read_paragraphs_from_annotations(annotations: list[dict[str, Any]]) -> list[RawParagraph]:
    """Build a RawParagraph list directly from an existing regex-engine
    `annotations` list (each item's "para" key), preserving index = position
    in `annotations`. Used by the styler.py pipeline-integration path so the
    classifier operates on exactly the same paragraph objects/ordering the
    regex engine already produced, instead of re-reading the document from
    scratch."""
    return [
        RawParagraph(index=i, docx_paragraph=item["para"], text=item["para"].text)
        for i, item in enumerate(annotations)
    ]
