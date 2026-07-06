"""
Phase 4 of the formatting-based heading classifier: turn a paragraph's
signature into a classification (H1..H6 or Body).

Tier assignment is based on **font-size rank only**, not the full signature
tuple. All paragraphs that share the same font-size rank are assigned the
same heading level, regardless of other formatting differences (bold,
ALL CAPS, alignment, etc.). Those secondary dimensions still affect the
signature tuple - and therefore which paragraphs compare as "more senior
than the baseline" - but once a paragraph clears that bar, its heading
*level* is determined solely by how many distinct font-size ranks exist
above the body-text baseline.

This means, for example, that a 16pt bold paragraph and a 16pt non-bold
paragraph land on the same heading level (both 16pt), while a 16pt
bold+underline paragraph also lands on the same level as the 16pt bold-only
one (underline does not affect the tier, only whether the paragraph clears
the candidacy threshold).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .signature import DocumentSignatureBaseline, Signature

MAX_HEADING_LEVEL = 6  # H1..H6


@dataclass
class SignatureRanking:
    """Maps every heading-candidate signature to "H1".."H6". Multiple
    signatures that share the same font-size rank map to the same level."""

    ordered_signatures: list[Signature]
    level_by_signature: dict[Signature, str]


def baseline_signature(max_font_size_rank: int) -> Signature:
    """8-element body-text reference point: the document's smallest real
    font size with every other dimension at its non-senior value.

    A paragraph must be strictly more senior than this to be a heading
    candidate at all. The font-size slot must equal `max_font_size_rank`
    exactly (not +1) - otherwise ordinary body text at the smallest font
    would spuriously satisfy sig < ref on the first element alone."""
    return (max_font_size_rank, 1, 1, 1, 1, 1, 1, 1)


def rank_signatures(signatures: list[Signature], baseline: DocumentSignatureBaseline) -> SignatureRanking:
    """Collect heading-candidate signatures (strictly more senior than the
    baseline), group them by font-size rank (signature slot 0), and assign
    H1..H6 to the distinct font-size rank groups (most senior first).
    All signatures sharing the same font-size rank get the same level.
    A 7th+ distinct font-size rank collapses into H6."""
    ref = baseline_signature(baseline.max_font_size_rank)
    candidate_sigs = {sig for sig in signatures if sig < ref}

    # Distinct font-size ranks present among candidates, most senior first
    distinct_font_ranks = sorted({sig[0] for sig in candidate_sigs})
    font_rank_to_level: dict[int, str] = {
        fr: f"H{min(i + 1, MAX_HEADING_LEVEL)}"
        for i, fr in enumerate(distinct_font_ranks)
    }

    # Map every candidate signature to the level of its font-size rank group
    level_by_signature: dict[Signature, str] = {
        sig: font_rank_to_level[sig[0]] for sig in candidate_sigs
    }

    return SignatureRanking(
        ordered_signatures=sorted(candidate_sigs),
        level_by_signature=level_by_signature,
    )


def classify_by_signature(features: dict[str, Any], signature: Signature, ranking: SignatureRanking) -> str:
    """Per-paragraph lookup against the whole-document ranking. Empty
    paragraphs are always Body."""
    if features.get("is_empty"):
        return "Body"
    return ranking.level_by_signature.get(signature, "Body")
