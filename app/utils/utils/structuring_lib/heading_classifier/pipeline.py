"""
Orchestration for the formatting-based heading classification engine: wires
reader -> features -> signature -> classifier -> hierarchy together, and
exposes the two public entry points used elsewhere in the codebase:

- `classify_document()` - standalone analysis over a DOCX path, for ad-hoc
  inspection/debugging. Opens its own Document, never mutates the source
  file.
- `classify_headings_by_formatting()` - the styler.py pipeline-integration
  entry point. Operates on an already-open Document and the regex engine's
  `annotations` list, returning a refined copy of that list.

Classification is inherently a whole-document operation: a paragraph's
level depends on how its formatting signature compares to every other
distinct signature in the document, not on the paragraph alone. So
`classify_paragraphs()` runs as three explicit passes: (1) extract features
for every paragraph, (2) build the signature baseline and rank the distinct
senior signatures across the whole document, (3) look up each paragraph's
level against that ranking.
"""

from __future__ import annotations

from typing import Any

from docx import Document
from docx.document import Document as DocxDocument

from ..logger_config import get_logger
from .classifier import classify_by_signature, rank_signatures
from .features import build_feature_context, extract_features
from .hierarchy import build_hierarchy
from .models import ClassificationResult, Paragraph
from .reader import RawParagraph, read_paragraphs, read_paragraphs_from_annotations
from .signature import build_signature, compute_signature_baseline, explain_signature

logger = get_logger(__name__)

HEADING_TAGS = {"H1", "H2", "H3", "H4", "H5", "H6"}

# Tags the formatting engine is allowed to overwrite. Every structural tag
# the regex engine assigns with semantic meaning (list items, box content,
# objectives, references, figures, tables, chapter titles, key terms, etc.)
# is NOT in this set and will never be touched by the formatting engine -
# even if the paragraph has large, bold formatting that scores as a heading.
# Only genuinely "unclassified" generic paragraphs and existing heading
# tags are eligible for promotion.
PROMOTION_ELIGIBLE_TAGS = HEADING_TAGS


def classify_paragraphs(doc: DocxDocument, raw_paragraphs: list[RawParagraph]) -> list[Paragraph]:
    """Three-pass whole-document classification. Pass 1: extract features
    for every paragraph. Pass 2: build the signature baseline and rank the
    distinct senior signatures present in the document. Pass 3: assign each
    paragraph its label by looking up its own signature in that ranking."""
    context = build_feature_context(raw_paragraphs)
    total = len(raw_paragraphs)

    all_features: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_paragraphs):
        prev = raw_paragraphs[i - 1] if i > 0 else None
        next_ = raw_paragraphs[i + 1] if i + 1 < total else None
        all_features.append(extract_features(raw, prev, next_, context, doc))

    baseline = compute_signature_baseline(all_features)
    signatures = [build_signature(f, baseline) for f in all_features]
    ranking = rank_signatures(signatures, baseline)

    results: list[Paragraph] = []
    for raw, features, signature in zip(raw_paragraphs, all_features, signatures):
        classification = classify_by_signature(features, signature, ranking)
        is_heading = classification in HEADING_TAGS
        reasons = explain_signature(features, baseline) if is_heading else []
        # 0-based rank among distinct senior signatures (most senior = 0);
        # -1 for paragraphs that aren't heading candidates at all (Body).
        rank_index = ranking.ordered_signatures.index(signature) if signature in ranking.level_by_signature else -1
        results.append(
            Paragraph(
                id=raw.index,
                index=raw.index,
                text=raw.text,
                features=features,
                score=rank_index,
                classification=classification,
                reasons=reasons,
            )
        )
    return results


def classify_document(docx_path: str) -> ClassificationResult:
    """Standalone entry point: open `docx_path` fresh and run the full
    reader -> features -> signature -> classifier -> hierarchy pipeline.
    Does not mutate or save the source file."""
    doc = Document(docx_path)
    raw_paragraphs = read_paragraphs(doc)
    paragraphs = classify_paragraphs(doc, raw_paragraphs)
    roots = build_hierarchy(paragraphs)
    return ClassificationResult(paragraphs=paragraphs, roots=roots)


def classify_headings_by_formatting(doc: DocxDocument, annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Full-promotion reconciliation: any non-locked paragraph may be
    classified as any heading level H1-H6 by the formatting engine,
    regardless of the regex engine's original tag. Locked paragraphs
    (author-explicit <TAG> markers) are never touched. When the formatting
    engine's verdict is "not a heading" (Body), the regex engine's original
    tag/style is left completely untouched - only an active H1-H6 verdict
    overwrites tag/style. Returns a new list; the input is not mutated."""
    if not annotations:
        return annotations

    raw_paragraphs = read_paragraphs_from_annotations(annotations)
    classified = classify_paragraphs(doc, raw_paragraphs)

    refined: list[dict[str, Any]] = []
    for item, paragraph in zip(annotations, classified):
        if item.get("locked"):
            refined.append(item)
            continue

        if item.get("tag") not in PROMOTION_ELIGIBLE_TAGS:
            # The regex engine assigned a structural tag (list item, box
            # content, objective, reference, figure, table, etc.) - keep it
            # regardless of what the formatting engine thinks.
            refined.append(item)
            continue

        if paragraph.classification not in HEADING_TAGS:
            # Formatting engine has no opinion / says Body: leave the
            # regex engine's original tag completely untouched.
            refined.append(item)
            continue

        new_tag = paragraph.classification
        if new_tag != item.get("tag"):
            logger.debug(
                "Heading classifier promoted: %s -> %s (signature_rank=%s, reasons=%s)",
                item.get("tag"), new_tag, paragraph.score, paragraph.reasons,
            )
        refined.append({
            **item,
            "tag": new_tag,
            "style": new_tag,
            "_heading_classifier_reasons": paragraph.reasons,
        })

    return refined
