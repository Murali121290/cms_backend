"""
Two-pass BX box-tag prefixer module.

A box marker has one of three numbered forms - "BX<number>-<value>",
"BX<number>_<value>", or "NBX<number>-<value>" (e.g. "BX1-Header",
"BX4_Section", "NBX2-Important") - where <value> can be any suffix, used
only to pair a specific opening marker with its closing marker. It carries
no semantic meaning and is never included in the generated prefix. An
opening "<BX3-Header>" only matches a closing "</BX3-Header>": the base id
and the full suffix must match exactly (see annotator.py's
_match_box_marker for the format/recognition rules, including how
already-resolved structural tags like "BX1-H1"/"BX1-TXT" are excluded from
ever being mistaken for a fresh marker).

There are also fixed-keyword markers with no number/suffix at all - "COUT"
is the only one so far - where the bare token "<COUT>"/"</COUT>" is both the
marker and the generated prefix (see _BARE_BOX_MARKERS, mirrored from
annotator.py).

Every real structural tag strictly between a matched pair gets a "BX#-" (or
"NBX#-"/"COUT-") prefix - just the base id, never the suffix. An opening
marker with no matching close by end-of-document is downgraded to PMI, and
its contents are left unprefixed. An unmatched closing marker is ignored.

Processing is explicitly two-pass: pass 1 scans the whole document with a
stack to find every matching open/close pair without modifying anything;
pass 2 then prefixes each matched pair's contents. Pairs are discovered in
close-order, so nested boxes are prefixed innermost-first - by the time an
outer pair is processed, the inner box's tags already carry their own
prefix, and the outer prefix is simply added on top, compounding correctly
(e.g. "BX1-BX2-TXT").
"""

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from .rules_loader import get_rules_loader

logger = logging.getLogger(__name__)

_BOX_MARKER_RE = re.compile(r"^(BX\d+)[-_].+$|^(NBX\d+)-.+$")

# Mirrors annotator.py's _BARE_BOX_MARKERS - fixed-keyword markers with no
# number/suffix, where the bare token is itself the box id.
_BARE_BOX_MARKERS = {"COUT"}


def _generic_box_placeholder_role(tag: str) -> Optional[str]:
    """If *tag* is one of rules.yaml boxes.title_style/body_style/
    first_body_style (e.g. "NBX1-TTL"), return the bare role suffix
    ("TTL") it stands for.

    These defaults are assigned by annotator.py's text-pattern-only box
    title/body rules (e.g. the "^Box\\s+\\d+\\." title rule), which run
    before this module's marker-pairing pass and so have no way to know
    which numbered box (BX1, BX2, NBX1, ...) will actually enclose the
    paragraph - they always guess the generic "NBX1"/"NBX" family. Once
    the real enclosing box_id is known here, that guess needs to be
    replaced rather than blindly prefixed on top of (which would produce
    a double-family tag like "BX1-NBX1-TTL" instead of "BX1-TTL")."""
    box_cfg = get_rules_loader().get_box_config()
    for key in ("title_style", "body_style", "first_body_style"):
        default_value = box_cfg.get(key)
        if default_value and default_value == tag and "-" in default_value:
            return default_value.split("-", 1)[1]
    return None


def _box_id(full_marker: str) -> str:
    """Resolve a full marker to its prefix id ("BX1-Header" -> "BX1",
    "NBX2-Important" -> "NBX2", "COUT" -> "COUT")."""
    if full_marker in _BARE_BOX_MARKERS:
        return full_marker
    match = _BOX_MARKER_RE.match(full_marker)
    return match.group(1) or match.group(2)


def _is_pure_marker_row(item: Dict[str, Any]) -> bool:
    """True if *item*'s entire content is a box marker - its tag is exactly
    the recorded open/close marker text, e.g. a line that is only
    "</BX1-Header>". False for a trailing close sharing its row with real
    content (e.g. "Some text.</BX1-Header>"), whose tag is that content's
    own tag ("TXT", or whatever it compounded to), not the marker text."""
    marker = item.get("bx_open") or item.get("bx_close")
    return bool(marker) and item.get("tag") == marker


def _already_has_box_prefix(tag: str, box_id: str) -> bool:
    """True if *tag* already carries *this exact* box's own prefix (e.g.
    "BX3-TTL"/"BX3_TTL" already starts with "BX3"), so prefixing it again
    would double up into "BX3-BX3-TTL". An explicit author tag like
    "<BX3-TTL>" written directly inside its own "<BX3-TIP>" box is the
    common case this guards against. A *different* box's prefix (e.g.
    "BX2-TTL" inside an outer "BX3" box) does not match here, so legitimate
    nested compounding ("BX3-BX2-TTL") still applies."""
    return tag == box_id or tag.startswith(f"{box_id}-") or tag.startswith(f"{box_id}_")


def _prefix_range(annotations: List[Dict[str, Any]], start_idx: int, end_idx: int, box_id: str) -> None:
    """Prefix every non-marker, non-empty tag with "{box_id}-", strictly
    after start_idx (exclusive) through end_idx. end_idx itself is only
    included when it's a trailing close sharing its row with real content
    rather than a standalone closing-marker line - a closing marker that
    occupies its own line is never prefixed, exactly like the opening
    marker at start_idx. Called innermost-pair-first, so an already
    inner-prefixed tag (e.g. "BX2-TXT") correctly compounds into
    "BX1-BX2-TXT" once its enclosing box is processed afterward."""
    for idx in range(start_idx + 1, end_idx if _is_pure_marker_row(annotations[end_idx]) else end_idx + 1):
        item = annotations[idx]
        if _is_pure_marker_row(item):
            continue
        if item.get("tag") == "EMPTY":
            continue
        if _already_has_box_prefix(item["tag"], box_id):
            continue
        placeholder_role = _generic_box_placeholder_role(item["tag"])
        if placeholder_role is not None:
            # Replace the generic NBX1/NBX guess with this box's own
            # family instead of stacking a second prefix on top of it.
            item["tag"] = f"{box_id}-{placeholder_role}"
            item["style"] = f"{box_id}-{placeholder_role}"
        else:
            item["tag"] = f"{box_id}-{item['tag']}"
            item["style"] = f"{box_id}-{item['style']}"


def apply_box_tag_prefixes(annotations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Two-pass open/close box marker handling:
    1. Pass 1 - scan forward tracking open markers on a stack (supports
       nesting). A close only matches if it is exactly equal (base id AND
       suffix) to the top of the stack; record the matched (open_idx,
       close_idx, box_id) and pop. A close that doesn't match the top is a
       stray/crossing tag - left untouched, the stack is not searched
       further down. Nothing is modified during this pass.
    2. Pass 2 - prefix every matched pair's contents, in the order pairs
       were found (i.e. innermost-closed-first), so compounding lands in the
       right order automatically.
    3. Any opener left on the stack at end-of-document was never properly
       closed - downgrade it to PMI and leave its contents unprefixed.
    """
    stack: List[Dict[str, Any]] = []
    matches: List[Tuple[int, int, str]] = []

    # Pass 1: find matching pairs only - no mutation.
    for idx, item in enumerate(annotations):
        full_marker = item.get("bx_open")
        if full_marker:
            stack.append({"full_marker": full_marker, "open_idx": idx})
            continue

        close_marker = item.get("bx_close")
        if close_marker and stack and stack[-1]["full_marker"] == close_marker:
            opened = stack.pop()
            matches.append((opened["open_idx"], idx, _box_id(opened["full_marker"])))

    # Pass 2: prefix contents of every matched pair.
    for open_idx, close_idx, box_id in matches:
        _prefix_range(annotations, open_idx, close_idx, box_id)

    for opened in stack:
        annotations[opened["open_idx"]]["tag"] = "PMI"
        annotations[opened["open_idx"]]["style"] = "PMI"
        logger.warning(
            f"Unclosed box '{opened['full_marker']}' at paragraph index {opened['open_idx']} -> PMI"
        )

    return annotations
