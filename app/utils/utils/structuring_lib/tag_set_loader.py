"""
Per-client tag-set overlay.

Translates canonical structural tags (the single vocabulary the
detection/classification engine works in - see rules.yaml's
`structural_tags` registry) to and from client-facing tag names, purely as a
presentation-layer rename. No detection, classification, hierarchy, or
validation logic is affected by any tag set.

Each client's map lives in `tag_sets/<tag_set>.yaml` as canonical -> client
name pairs. Most entries are plain strings. A tag whose client naming
depends on the case of the list marker it was detected from (the
alphabetical `LL-*` and roman-numeral `OL-*` families, e.g. Springer's
Lc-AlphaList1 vs Uc-AlphaList1) is instead a small dict:
`{upper: ..., lower: ...}`, selected via the `case` argument to
`translate_tag`, which callers populate from an annotation's `list_case`
(see annotator.detect_list_kind).

Cached per tag-set key (not as a single mutable global), so multiple
clients' maps can be loaded and used concurrently without clobbering each
other.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

TAG_SETS_DIR = Path(__file__).parent / "tag_sets"

_tag_map_cache: Dict[str, Dict[str, Any]] = {}
_reverse_tag_map_cache: Dict[str, Dict[str, str]] = {}


def list_available_tag_sets() -> List[str]:
    """Keys of all real tag-set YAML files in tag_sets/, excluding the
    documentation-only example.yaml template."""
    if not TAG_SETS_DIR.exists():
        return []
    return sorted(
        p.stem for p in TAG_SETS_DIR.glob("*.yaml") if p.stem != "example"
    )


def _load_tag_set_file(tag_set: str) -> Dict[str, Any]:
    path = TAG_SETS_DIR / f"{tag_set}.yaml"
    if not path.exists():
        logger.warning(
            "Tag set '%s' not found at %s; canonical tag names will be used unchanged",
            tag_set, path,
        )
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


def get_tag_map(tag_set: Optional[str]) -> Dict[str, Any]:
    """Canonical -> client tag map for *tag_set*.

    Returns {} if tag_set is None or the file is missing (both mean:
    fall through to canonical tag names everywhere). Values are either a
    plain string, or a `{"upper": ..., "lower": ...}` dict for case-dependent
    tags.
    """
    if not tag_set:
        return {}
    if tag_set not in _tag_map_cache:
        _tag_map_cache[tag_set] = _load_tag_set_file(tag_set)
    return _tag_map_cache[tag_set]


def get_reverse_tag_map(tag_set: Optional[str]) -> Dict[str, str]:
    """Client -> canonical tag map (inverse of get_tag_map), used to
    normalize a document already styled with a client's tag names back to
    canonical before it re-enters the pipeline.

    Case-dependent entries contribute both their "upper" and "lower" client
    strings, each pointing back at the same canonical tag - case itself is
    re-derived from the marker text during (re-)annotation, not stored on
    the tag name.

    If two canonical tags happen to map to the same client string (e.g.
    Springer's NL-TXT and BL-TXT both -> "ListItemPara-FL1"), the map can't
    be inverted one-to-one; the first-declared canonical key wins and a
    warning is logged. This only affects reprocessing of an
    already-client-styled document, not the primary authoring flow.
    """
    if not tag_set:
        return {}
    if tag_set in _reverse_tag_map_cache:
        return _reverse_tag_map_cache[tag_set]

    forward = get_tag_map(tag_set)
    reverse: Dict[str, str] = {}
    for canonical, value in forward.items():
        client_names = value.values() if isinstance(value, dict) else [value]
        for client_name in client_names:
            existing = reverse.get(client_name)
            if existing is not None and existing != canonical:
                logger.warning(
                    "Tag set: client name '%s' maps from both '%s' and '%s' canonical "
                    "tags; keeping '%s'",
                    client_name, existing, canonical, existing,
                )
                continue
            reverse[client_name] = canonical

    _reverse_tag_map_cache[tag_set] = reverse
    return reverse


def translate_tag(
    name: str,
    tag_map: Dict[str, Any],
    prefixes: Optional[List[str]] = None,
    case: Optional[str] = None,
) -> str:
    """Translate a canonical tag *name* to its client-facing form.

    Resolution order: exact match in *tag_map*, then longest matching
    prefix (matched against *prefixes*, with only the prefix portion
    replaced and the suffix preserved), else *name* is returned unchanged.

    If the resolved value is a case-dependent dict, *case* ("upper" /
    "lower") selects the variant. If *case* is None or absent from the
    dict, *name* is returned unchanged rather than guessing, and a warning
    is logged.
    """
    if not tag_map:
        return name

    value = tag_map.get(name)

    if value is None and prefixes:
        matched_prefix = None
        for prefix in prefixes:
            if name.startswith(prefix) and prefix in tag_map:
                if matched_prefix is None or len(prefix) > len(matched_prefix):
                    matched_prefix = prefix
        if matched_prefix is not None:
            prefix_value = tag_map[matched_prefix]
            if isinstance(prefix_value, dict):
                logger.warning(
                    "Tag set prefix '%s' is case-dependent, which prefix-family "
                    "translation doesn't support; leaving '%s' untranslated",
                    matched_prefix, name,
                )
                return name
            suffix = name[len(matched_prefix):]
            return f"{prefix_value}{suffix}"

    if value is None:
        return name

    if isinstance(value, dict):
        if case is None or case not in value:
            logger.warning(
                "Tag '%s' has case-dependent client names but no marker case was "
                "detected; leaving it as the canonical name",
                name,
            )
            return name
        return value[case]

    return value
