"""
Content-driven zone detection and tag overlay enforcement.

Inspects paragraph text content (independent of source pStyle) to identify
heading-driven zones — Case Study, Objectives, Key Terms, Key Points,
End-of-Chapter (Summary / Review Questions / Conclusion), and a
post-References zone for PMI promotion. Once a zone is detected, an overlay
pass rewrites validator-produced tags into the appropriate zone-qualified
form (e.g. ``H1`` -> ``EOC-H1`` inside the EOC zone, ``T1`` -> ``PMI`` after
References).

The detection is additive: it sets ``metadata['content_zone']`` on each
block and a ``metadata['content_zone_role']`` for opener / first-body
markers. Existing ``context_zone`` and ``is_reference_zone`` fields are
left untouched so prior logic continues to work.

Zone openers are heading-shaped paragraphs whose text matches a known
phrase. A zone stays active until a different known opener appears, or
until the document ends.
"""

from __future__ import annotations

import re
import logging
from typing import Iterable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Heading patterns that open each content zone
# ---------------------------------------------------------------------------

# Paragraphs whose text matches one of these (in heading shape) start the
# corresponding zone. The order here is the priority order for matching.
_ZONE_OPENERS: list[tuple[str, re.Pattern]] = [
    ("CASE_STUDY",   re.compile(r"^\s*case\s+study\b", re.IGNORECASE)),
    ("OBJ",          re.compile(r"^\s*(?:learning\s+)?objectives?\s*$", re.IGNORECASE)),
    ("KT",           re.compile(r"^\s*key\s+terms?\s*$", re.IGNORECASE)),
    ("KP",           re.compile(r"^\s*key\s+points?\s*$", re.IGNORECASE)),
    ("EOC_SUMMARY",  re.compile(r"^\s*summary\s*$", re.IGNORECASE)),
    ("EOC_REVIEW",   re.compile(r"^\s*review\s+questions?\s*$", re.IGNORECASE)),
    ("EOC_CONCL",    re.compile(r"^\s*conclusion\s*$", re.IGNORECASE)),
    ("POST_REF",     re.compile(r"^\s*references?\s*$", re.IGNORECASE)),
]

# Heading shape: short-ish, no sentence-terminating punctuation, doesn't end
# with a colon (which would be a label).
_TERMINAL_PUNCT_RE = re.compile(r"[.!?:]\s*$")


def _is_heading_shape(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if len(t) > 80:
        return False
    if _TERMINAL_PUNCT_RE.search(t):
        return False
    return True


def _match_opener(text: str) -> str | None:
    """Return the zone name if *text* opens a known content zone."""
    if not _is_heading_shape(text):
        return None
    for name, pat in _ZONE_OPENERS:
        if pat.match(text):
            return name
    return None


# Zones whose name is just a finer-grained EOC subtype collapse to "EOC" for
# the overlay layer (one set of EOC-* rules covers all of them).
_EOC_SUBZONES = {"EOC_SUMMARY", "EOC_REVIEW", "EOC_CONCL"}


def detect_content_zones(blocks: list[dict]) -> list[dict]:
    """Annotate each block's metadata with a content-driven zone label.

    Mutates ``metadata['content_zone']`` and (for openers and first-body
    paragraphs) ``metadata['content_zone_role']``. Returns the same list for
    fluent use.

    Zone state is tracked linearly through the document. The first opener
    seen begins a zone. Subsequent openers replace it. Paragraphs between
    openers inherit the active zone. Paragraphs before any opener get no
    ``content_zone`` (treated as plain body).
    """
    current: str | None = None
    role_for_first_body = False  # next non-opener paragraph becomes FIRST_BODY

    for b in blocks:
        meta = b.setdefault("metadata", {})
        text = b.get("text") or ""

        opener = _match_opener(text)
        if opener is not None:
            current = opener
            meta["content_zone"] = opener
            meta["content_zone_role"] = "OPENER"
            role_for_first_body = True
            continue

        if current is not None:
            meta["content_zone"] = current
            if role_for_first_body:
                meta["content_zone_role"] = "FIRST_BODY"
                role_for_first_body = False

    return blocks


# ---------------------------------------------------------------------------
# Overlay rules — produce the zone-qualified tag from the validator's tag
# ---------------------------------------------------------------------------

# Family-level positional list mapping ("BL-FIRST" -> "{zone_prefix}-BL-FIRST")
_LIST_FAMILIES = ("BL", "NL", "UL")
_LIST_POSITIONS = ("FIRST", "MID", "LAST")


def _overlay_for_case_study(tag: str, role: str | None) -> str | None:
    if tag in {"TTL", "CS-TTL"} and role == "OPENER":
        return "CS-TTL"
    if tag == "H1":
        return "CS-H1"
    if tag == "TXT" and role == "FIRST_BODY":
        return "CS-TXT-FIRST"
    if tag == "TXT":
        return "CS-TXT"
    return None


def _overlay_for_eoc(tag: str, role: str | None) -> str | None:
    if tag == "H1":
        return "EOC-H1"
    if tag == "TXT" and role == "FIRST_BODY":
        return "EOC-TXT-FIRST"
    if tag == "TXT":
        return "EOC-TXT"
    if tag == "TXT-FLUSH":
        return "EOC-TXT-FLUSH"
    for fam in ("NL",):
        for pos in _LIST_POSITIONS:
            if tag == f"{fam}-{pos}":
                return f"EOC-NL-{pos}"
    return None


def _overlay_for_obj(tag: str, role: str | None) -> str | None:
    if tag == "H1" and role == "OPENER":
        return "OBJ1"
    for fam in _LIST_FAMILIES:
        for pos in _LIST_POSITIONS:
            if tag == f"{fam}-{pos}":
                return f"OBJ-{fam}-{pos}"
    return None


def _overlay_for_kt(tag: str, role: str | None) -> str | None:
    if tag == "H1" and role == "OPENER":
        return "KT1"
    for fam in _LIST_FAMILIES:
        for pos in _LIST_POSITIONS:
            if tag == f"{fam}-{pos}":
                return f"KT-{fam}-{pos}"
    return None


def _overlay_for_kp(tag: str, role: str | None) -> str | None:
    if tag == "H1" and role == "OPENER":
        return "KP1"
    for fam in ("BL", "NL"):
        for pos in _LIST_POSITIONS:
            if tag == f"{fam}-{pos}":
                return f"KP-{fam}-{pos}"
    return None


def _overlay_for_post_ref(tag: str, role: str | None) -> str | None:
    # After References, any figure/table caption that the engine produced
    # collapses to PMI.
    if tag in {"T1", "FIG-LEG", "UNFIG-LEG"}:
        return "PMI"
    return None


_OVERLAY_DISPATCH = {
    "CASE_STUDY": _overlay_for_case_study,
    "EOC_SUMMARY": _overlay_for_eoc,
    "EOC_REVIEW": _overlay_for_eoc,
    "EOC_CONCL": _overlay_for_eoc,
    "OBJ": _overlay_for_obj,
    "KT": _overlay_for_kt,
    "KP": _overlay_for_kp,
    "POST_REF": _overlay_for_post_ref,
}


def apply_content_zone_overlays(
    classifications: list[dict],
    blocks: list[dict] | Iterable[dict],
    allowed_styles: Iterable[str] | None = None,
) -> list[dict]:
    """Rewrite ``classifications`` tags per content-zone overlay rules.

    Skips a rewrite when the candidate target is not in ``allowed_styles``
    (to avoid producing tags the validator would later strip).

    Both ``classifications`` and ``blocks`` are expected to be aligned by
    ``id``. ``blocks`` must already have ``metadata['content_zone']`` set
    (call :func:`detect_content_zones` first).
    """
    if not classifications:
        return classifications

    allowed: set[str] | None = (
        set(allowed_styles) if allowed_styles is not None else None
    )

    block_meta_by_id: dict = {}
    for b in blocks:
        bid = b.get("id")
        if bid is not None:
            block_meta_by_id[bid] = b.get("metadata") or {}

    out: list[dict] = []
    for clf in classifications:
        tag = str(clf.get("tag") or "")
        meta = block_meta_by_id.get(clf.get("id"), {})
        zone = meta.get("content_zone")
        role = meta.get("content_zone_role")

        if not zone or zone not in _OVERLAY_DISPATCH:
            out.append(clf)
            continue

        new_tag = _OVERLAY_DISPATCH[zone](tag, role)
        if not new_tag or new_tag == tag:
            out.append(clf)
            continue

        if allowed is not None and new_tag not in allowed:
            logger.debug(
                "content-zone-overlay: skip %s -> %s (not in allowed_styles)",
                tag, new_tag,
            )
            out.append(clf)
            continue

        out.append({
            **clf,
            "tag": new_tag,
            "repaired": True,
            "repair_reason": (
                (clf.get("repair_reason") or "") + ",content-zone-overlay"
            ).lstrip(","),
        })

    return out
