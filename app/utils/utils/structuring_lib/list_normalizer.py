"""
List-run position normalization.

annotate_document() tags every list item with a flat "-MID" family tag
(BL-MID, NL-MID, OBJ-BL-MID, ...) or, for references, REF-N/REF-U,
regardless of where the item sits within its run. This pass walks the
annotation list once, finds maximal contiguous runs of the same list
family, and rewrites their position suffixes so each run reads
FIRST -> MID* -> LAST (or just FIRST for a single-item run).

Empty/PMI paragraphs, and nested "level 2" sub-list items (BL2-MID/NL2-MID/
UL2-MID), sitting between two same-family items are treated as transparent
bridges: they don't themselves get a position suffix, but they don't break
run continuity either. Level-2 tags are always MID - no FIRST/LAST variant
exists for them, mirroring the table-nested convention (TBL2-MID/TNL2-MID).

Table-cell list tags (TBL-MID/TNL-MID/TOL-MID) are out of scope - those are
assigned separately by styler.tag_tables() and are intentionally flat per
publisher convention.
"""

from __future__ import annotations

import re
from typing import Any, Optional

_LIST_FAMILY_SUFFIX_RE = re.compile(r"^(.+)-MID$")
_REF_FAMILIES = ("REF-N", "REF-U")
_BRIDGE_TAGS = ("EMPTY", "PMI")

# Nested/sub-list "level 2" families (BL2-MID/NL2-MID/UL2-MID) are always
# MID, by definition - no FIRST/LAST variant exists for them (mirrors the
# table-nested convention TBL2-MID/TNL2-MID). Excluded here so a run of
# nested items is never rewritten into FIRST/MID/LAST.
_LEVEL2_FAMILIES = ("BL2", "NL2", "UL2", "LL2", "OL2")


def _list_family(tag: str) -> Optional[str]:
    """Return the list-family prefix for *tag*, or None if it isn't a
    recognized flat list/reference tag."""
    if tag in _REF_FAMILIES:
        return tag
    match = _LIST_FAMILY_SUFFIX_RE.match(tag or "")
    if not match:
        return None
    family = match.group(1)
    if family in _LEVEL2_FAMILIES:
        return None
    return family


def _is_level2_tag(tag: str) -> bool:
    match = _LIST_FAMILY_SUFFIX_RE.match(tag or "")
    return bool(match) and match.group(1) in _LEVEL2_FAMILIES


def _positions_for_count(count: int) -> list[str]:
    if count <= 1:
        return ["FIRST"]
    if count == 2:
        return ["FIRST", "LAST"]
    return ["FIRST"] + ["MID"] * (count - 2) + ["LAST"]


def normalize_list_positions(annotations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rewrite list-tag position suffixes for FIRST/MID/LAST continuity.

    Mutates and returns the same annotation dicts (matching the in-place
    style of enforce_hierarchy's refine_annotations).
    """
    if not annotations:
        return annotations

    n = len(annotations)
    families: list[Optional[str]] = [_list_family(item.get("tag", "")) for item in annotations]

    i = 0
    while i < n:
        family = families[i]
        if family is None:
            i += 1
            continue

        run_indices = [i]
        j = i + 1
        while j < n:
            f = families[j]
            if f == family:
                run_indices.append(j)
                j += 1
            elif f is None and (
                annotations[j].get("tag") in _BRIDGE_TAGS
                or _is_level2_tag(annotations[j].get("tag", ""))
            ):
                j += 1  # transparent bridge - not part of the run, doesn't break it
            else:
                break

        for idx, position in zip(run_indices, _positions_for_count(len(run_indices))):
            new_tag = f"{family}-{position}"
            if annotations[idx].get("tag") != new_tag:
                annotations[idx]["tag"] = new_tag
                annotations[idx]["style"] = new_tag

        i = j

    return annotations
