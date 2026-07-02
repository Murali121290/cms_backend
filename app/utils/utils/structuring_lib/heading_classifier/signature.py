"""
Multi-key comparator signature for the formatting-based heading classifier.

Each paragraph is reduced to a fixed-length tuple - a "signature" - with one
slot per formatting dimension, in strict priority order:

    1. Font size      2. Bold           3. ALL CAPS
    4. Title Case     5. Font family    6. Italic
    7. Alignment      8. Numbering

Slots are encoded so that a SMALLER tuple value means MORE senior (0 = most
senior, 1 = least senior for boolean/categorical dimensions; for font size,
the existing dense rank is used directly, where 0 already means "largest
font in the document"). This lets plain Python tuple comparison (`<`)
implement the entire 8-key lexicographic priority order with no custom
comparator code.

Underline is intentionally excluded from the signature: heading variants
that differ only by underline (e.g. bold+underline vs bold-only) should be
treated as the same heading level, not split into separate tiers. Underline
is still extracted as a feature for display/metadata purposes but does not
affect level assignment.

Italic-without-bold is treated as a veto: paragraphs that are italic but
not bold are excluded from heading candidacy by returning the baseline
signature (which is never strictly more senior than itself). In practice,
italic without bold almost always signals emphasis or citation in running
text, not a structural heading.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Any, Optional

Signature = tuple


@dataclass(frozen=True)
class DocumentSignatureBaseline:
    """Document-wide reference point every paragraph's signature is
    compared against. Built once per document, analogous to
    features.DocumentFeatureContext."""

    baseline_font_family: Optional[str]
    baseline_alignment: Optional[str]
    max_font_size_rank: int  # the document's smallest real font_size_rank


def compute_signature_baseline(all_features: list[dict[str, Any]]) -> DocumentSignatureBaseline:
    """Find the document's modal (most common) font family and alignment
    among non-empty paragraphs - these represent "ordinary body text"
    formatting, which the comparator dimensions for font family/alignment
    are measured against. Ties broken by first-encountered value."""
    families = Counter(
        f["font_family"] for f in all_features if not f.get("is_empty") and f.get("font_family")
    )
    alignments = Counter(
        f["alignment"] for f in all_features if not f.get("is_empty") and f.get("alignment")
    )
    ranks = [f["font_size_rank"] for f in all_features if f.get("font_size_rank") is not None]

    return DocumentSignatureBaseline(
        baseline_font_family=_mode_or_none(families),
        baseline_alignment=_mode_or_none(alignments),
        max_font_size_rank=max(ranks, default=0),
    )


def _mode_or_none(counter: Counter) -> Optional[str]:
    if not counter:
        return None
    top_count = max(counter.values())
    for key, count in counter.items():  # dict preserves first-insertion order
        if count == top_count:
            return key
    return None


def _bool_senior(features: dict[str, Any], key: str) -> int:
    return 0 if features.get(key) else 1


def _categorical_senior(value: Optional[str], baseline_value: Optional[str]) -> int:
    if value is None:
        return 1
    return 0 if value != baseline_value else 1


def build_signature(features: dict[str, Any], baseline: DocumentSignatureBaseline) -> Signature:
    """Build a paragraph's 8-element signature tuple.

    Returns the baseline signature (veto) for italic-without-bold paragraphs
    so they are never treated as heading candidates."""
    # Italic without bold: these paragraphs signal emphasis/citation in
    # running text, not structural headings. Returning the baseline
    # signature ensures sig < ref is always False for them.
    if features.get("italic") and not features.get("bold"):
        return _baseline_sig(baseline.max_font_size_rank)

    font_size_rank = features.get("font_size_rank")
    # No resolvable font size (e.g. an empty/run-less paragraph): least
    # senior on this dimension, pushed past every real font rank.
    fsr = font_size_rank if font_size_rank is not None else baseline.max_font_size_rank + 1

    alignment = features.get("alignment")
    if alignment == "CENTER":
        alignment_senior = 0
    else:
        alignment_senior = _categorical_senior(alignment, baseline.baseline_alignment)

    numbering_senior = 0 if (features.get("starts_with_numbering") or features.get("numbering_format")) else 1

    return (
        fsr,
        _bool_senior(features, "bold"),
        _bool_senior(features, "is_all_uppercase"),
        _bool_senior(features, "is_title_case"),
        _categorical_senior(features.get("font_family"), baseline.baseline_font_family),
        _bool_senior(features, "italic"),
        alignment_senior,
        numbering_senior,
    )


def _baseline_sig(max_font_size_rank: int) -> Signature:
    """8-element all-non-senior reference tuple. Kept here so
    `build_signature`'s italic veto can return it without importing from
    `classifier`."""
    return (max_font_size_rank, 1, 1, 1, 1, 1, 1, 1)


def explain_signature(features: dict[str, Any], baseline: DocumentSignatureBaseline) -> list[str]:
    """Human-readable reasons explaining a paragraph's heading classification,
    in the same priority order build_signature uses."""
    if features.get("italic") and not features.get("bold"):
        return ["Italic without bold: excluded from heading candidacy"]

    reasons: list[str] = []

    fsr = features.get("font_size_rank")
    if fsr is not None:
        suffix = " (most senior)" if fsr == 0 else ""
        reasons.append(f"Font size rank {fsr}{suffix}")
    if features.get("bold"):
        reasons.append("Bold")
    if features.get("is_all_uppercase"):
        reasons.append("ALL CAPS")
    if features.get("is_title_case"):
        reasons.append("Title Case")

    family = features.get("font_family")
    if family and family != baseline.baseline_font_family:
        reasons.append(f"Font family '{family}' differs from document baseline '{baseline.baseline_font_family}'")

    if features.get("italic"):
        reasons.append("Italic")

    alignment = features.get("alignment")
    if alignment == "CENTER":
        reasons.append("Centered")
    elif alignment and alignment != baseline.baseline_alignment:
        reasons.append(f"Alignment '{alignment}' differs from document baseline '{baseline.baseline_alignment}'")

    if features.get("starts_with_numbering") or features.get("numbering_format"):
        reasons.append("Numbered")

    return reasons
