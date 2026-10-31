"""Build TE findings with their CE checklist metadata attached."""
from __future__ import annotations

import re

from manuscript_core.extractor import Segment
from manuscript_core.rules.base import Finding, context_snippet
from manuscript_core.rules.ce_rules import choose_replacement, get_ce_meta


def surface_pattern(surface: str) -> str:
    prefix = r"\b" if (surface and (surface[0].isalnum() or surface[0] == "_")) else ""
    suffix = r"\b" if (surface and (surface[-1].isalnum() or surface[-1] == "_")) else ""
    return prefix + re.escape(surface) + suffix


def build_finding(
    seg: Segment,
    start: int,
    end: int,
    rule_id: str,
    rule_label: str,
    canonical: str,
    *,
    m: re.Match | None = None,
    category: str = "te_point",
    severity: str = "info",
    option_replacements: dict | None = None,
    ce_steps: dict | None = None,
    extra_rule_nos: list[int] | None = None,
) -> Finding:
    from manuscript_core.rules.te_options import get_te_replacements_by_option
    from manuscript_core.rules.te_point_replacements import get_te_replacement, get_te_replacement_options
    surface = seg.text[start:end]
    meta = get_ce_meta(rule_id)
    rep_opts = get_te_replacement_options(rule_id, m) if m is not None else []

    if meta is None:
        replacement = get_te_replacement(rule_id, m) if m is not None else None
        ce = {}
    else:
        if option_replacements is None and m is not None:
            option_replacements = get_te_replacements_by_option(rule_id, m)
        choice = choose_replacement(surface, meta["sno"], option_replacements, ce_steps=ce_steps)
        replacement = choice["replacement"]
        nos = [meta["sno"]] + [n for n in (extra_rule_nos or []) if n != meta["sno"]]
        ce = {
            "ce_rule_no": meta["sno"],
            "ce_rule_nos": nos,
            "ce_rule_name": meta["name"],
            "ce_group": meta["group"],
            "ce_severity": choice["severity"],
            "ce_handling": meta["handling"],
            "ce_options": list(meta["options"]),
            "ce_query": choice["query"],
            "option_replacements": option_replacements or {},
            "ce_steps": ce_steps,
            "in_checklist": True,
        }

    return Finding(
        category=category, rule_id=rule_id, rule_label=rule_label,
        surface=surface, canonical=canonical,
        chapter_index=seg.chapter_index, chapter_name=seg.chapter_name,
        source=seg.source, page=seg.page, para_index=seg.para_index,
        context=context_snippet(seg.text, start, end),
        severity=severity,
        replacement=replacement,
        search_pattern=surface_pattern(surface),
        region=seg.region,
        match_start=start,
        match_end=end,
        replacement_options=rep_opts,
        **ce,
    )
