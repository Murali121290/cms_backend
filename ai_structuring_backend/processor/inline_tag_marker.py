"""
Inline tag marker locking.

When a paragraph's text begins with a literal ``<TAG>`` marker AND is
followed by content (``<CJC-TTL>Clinical Judgment Case``,
``<TBL-MID>1. Foo``, ``<UNT-T3>Onset``, ``<H2>Pain Control Theories``),
the author has authoritatively asserted the tag for that paragraph. The
classifier should respect the assertion instead of re-deriving the tag
from text content.

This module generalises the historical ``<H1>``-``<H6>`` inline-heading
override to any style in ``allowed_styles.json`` — e.g. ``<T2>``,
``<CJC-TTL>``, ``<TBL-MID>``, ``<UNT-T3>``, ``<NBX-TTL>``, ``<CST>``.

Blocks whose text is exactly ``<TAG>`` (no following content) are out of
scope here — :mod:`.marker_lock` already locks them to ``PMI`` (page
marker instruction). This module only fires when the paragraph carries
content after the marker.

Pipeline integration: runs as a Stage 1b pre-classification lock
alongside :func:`marker_lock.lock_marker_blocks`. Sets the existing
``lock_style`` / ``allowed_styles`` / ``skip_llm`` triple so the
deterministic gate in the classifier emits the marker tag at confidence
99, bypassing the LLM. Sets ``_inline_tag_override`` on the block so the
overlay layer skips it and the reconstruction layer can strip the
marker text from the output paragraph.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable, Sequence

logger = logging.getLogger(__name__)

# Canonical inline-marker pattern.
#
# - Anchored at paragraph start (allowing leading whitespace).
# - Tag name is uppercase alphanumeric with optional dash-separated
#   segments: ``H1``, ``T2``, ``CJC-TTL``, ``CJC-NN-TXT-FIRST``, ``BX1-CS``,
#   ``UNT-TXT-3``. Case-insensitive in the regex; canonicalisation against
#   ``allowed_styles`` is handled in :func:`extract_inline_tag`.
# - REQUIRES non-empty (non-whitespace) content after the closing ``>``.
#   A bare ``<TAG>`` paragraph is left to :func:`marker_lock.lock_marker_blocks`.
# - Excludes closing markers (``</TAG>``) — those are also handled by
#   :mod:`.marker_lock` as PMI.
INLINE_TAG_MARKER_RE = re.compile(
    r"^\s*<(?P<tag>[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)>(?P<rest>.*\S.*)$",
    re.IGNORECASE | re.DOTALL,
)


def extract_inline_tag(
    text: str,
    allowed_styles: Iterable[str],
) -> tuple[str | None, str, str]:
    """Detect an authoritative inline tag marker at paragraph start.

    Returns ``(tag, marker_str, stripped_text)`` when ``text`` begins with
    a marker whose tag (case-insensitive) is present in ``allowed_styles``.
    Returns ``(None, "", text)`` otherwise.

    ``marker_str`` is the literal substring that should be removed from
    the source text on reconstruction (e.g. ``"<CJC-TTL>"`` — without
    surrounding whitespace).

    ``stripped_text`` is the text with the marker (and any single
    trailing space) removed; provided for callers that need the cleaned
    body. Marker stripping at reconstruction time should consult the
    block's first run rather than this string, because runs carry
    formatting that whole-text stripping would lose.
    """
    if not text:
        return None, "", text or ""
    m = INLINE_TAG_MARKER_RE.match(text)
    if not m:
        return None, "", text
    raw_tag = m.group("tag") or ""
    canon = _canonicalise_against_allowed(raw_tag, allowed_styles)
    if canon is None:
        return None, "", text
    # Reconstruct the literal marker the author wrote so the reconstruction
    # layer can strip the exact substring (preserving any leading whitespace
    # before the marker, which is rare but possible in indented sources).
    leading_ws_len = len(text) - len(text.lstrip())
    marker_str = text[leading_ws_len : leading_ws_len + len(raw_tag) + 2]  # <TAG>
    rest = text[leading_ws_len + len(raw_tag) + 2 :]
    # Drop a single space immediately after the marker if present, but
    # preserve any other content (tabs, content with non-space leading char).
    if rest.startswith(" "):
        rest = rest[1:]
    return canon, marker_str, rest


def _canonicalise_against_allowed(
    raw_tag: str,
    allowed_styles: Iterable[str],
) -> str | None:
    """Return the canonical form of ``raw_tag`` if it matches an allowed
    style under case-insensitive comparison; otherwise return ``None``."""
    if not raw_tag:
        return None
    upper = raw_tag.upper()
    for style in allowed_styles:
        if not style:
            continue
        if style.upper() == upper:
            return style
    return None


def lock_inline_tag_blocks(
    blocks: Sequence[dict],
    allowed_styles: Iterable[str],
) -> list[dict]:
    """Lock paragraphs whose text begins with an authoritative ``<TAG>``
    marker so the classifier emits the asserted tag deterministically.

    For each matching block, sets:

    * ``block["lock_style"]``           → ``True``
    * ``block["allowed_styles"]``       → ``[<extracted tag>]``
    * ``block["skip_llm"]``             → ``True``
    * ``block["_inline_tag_override"]`` → ``<extracted tag>`` (diagnostic
      flag also consumed by overlays + reconstruction)
    * ``block["_inline_tag_marker"]``   → literal marker substring
      (consumed by reconstruction to strip the marker from output text)

    Skipped:
    - Blocks whose text is empty or whitespace-only.
    - Marker-only blocks (text is exactly ``<TAG>``) — :mod:`.marker_lock`
      handles those as PMI.
    - Blocks whose marker tag is not in ``allowed_styles``.
    - Blocks already locked by an earlier stage (``lock_style is True``)
      to avoid stomping on the marker_lock PMI lock.
    """
    blocks_list = list(blocks)
    if not blocks_list:
        return blocks_list
    allowed_list = list(allowed_styles or [])

    locked = 0
    for block in blocks_list:
        if block.get("lock_style") is True:
            continue
        text = block.get("text", "")
        if not text or not text.strip():
            continue
        tag, marker_str, _stripped = extract_inline_tag(text, allowed_list)
        if tag is None:
            continue
        block["lock_style"] = True
        block["allowed_styles"] = [tag]
        block["skip_llm"] = True
        block["_inline_tag_override"] = tag
        block["_inline_tag_marker"] = marker_str
        locked += 1

    if locked > 0:
        logger.info("INLINE_TAG_MARKER_LOCK locked=%d", locked)

    return blocks_list
