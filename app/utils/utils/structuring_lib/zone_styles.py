"""
Zone-style legality check (warn-only).

annotate_document() currently applies whatever tag/style a rule resolves to
without checking whether that style actually belongs inside the block
(zone) the paragraph sits in. This module defines the legal style set for
each known block and runs a warn-only pass over the final annotations: any
out-of-zone style is logged and counted, but never rewritten.

This is scoped to the manual pipeline's own (much smaller) tag vocabulary -
not the AI side's ~1,460-tag set. Auto-repair is a natural follow-up once
warning counts from real documents show it's safe.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

ZONE_ALLOWED_STYLES: dict[str, set[str]] = {
    "REFERENCES_BLOCK": {
        "REFH1", "PMI", "EMPTY",
        "REF-N", "REF-N-FIRST", "REF-N-MID", "REF-N-LAST",
        "REF-U", "REF-U-FIRST", "REF-U-MID", "REF-U-LAST",
    },
    "LEARNING_OBJECTIVES_BLOCK": {
        "OBJ1", "PMI", "EMPTY",
        "OBJ-TXT-FIRST", "OBJ-TXT",
        "OBJ-BL-MID", "OBJ-BL-FIRST", "OBJ-BL-LAST",
        "OBJ-NL-MID", "OBJ-NL-FIRST", "OBJ-NL-LAST",
    },
}


def check_zone_style_legality(annotations: list[dict[str, Any]]) -> int:
    """Warn (but do not rewrite) on annotations whose style falls outside
    its block's legal set. Blocks with no entry in ZONE_ALLOWED_STYLES are
    skipped (no check performed). Returns the number of violations found.
    """
    violations = 0
    for item in annotations:
        block = item.get("block")
        if not block or block not in ZONE_ALLOWED_STYLES:
            continue

        style = item.get("style")
        if style in ZONE_ALLOWED_STYLES[block]:
            continue

        violations += 1
        para = item.get("para")
        text_preview = para.text.strip()[:50] if para is not None else ""
        logger.warning(
            "ZONE_STYLE_WARN: block=%s style=%s text=%r",
            block, style, text_preview,
        )

    return violations
