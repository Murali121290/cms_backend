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


def _ce_fields(meta: dict, surface: str, option_replacements: dict | None, ce_steps: dict | None,
               extra_rule_nos: list[int] | None) -> tuple[dict, dict]:
    choice = choose_replacement(surface, meta["sno"], option_replacements, ce_steps=ce_steps)
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
        "ce_status": choice["status"],
        "suggestion": choice["suggestion"],
    }
    return ce, choice


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
    from manuscript_core.rules.house_style import contextualize
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
        if option_replacements:
            option_replacements = contextualize(rule_id, dict(option_replacements), seg, start, end)
        ce, choice = _ce_fields(meta, surface, option_replacements, ce_steps, extra_rule_nos)
        replacement = choice["replacement"]
        if not rep_opts and option_replacements:
            rep_opts = [v for v in option_replacements.values() if v and v != "QUERY" and v != surface]

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


def link_ce(findings: list[Finding], seg: Segment) -> list[Finding]:
    """Attach checklist metadata to findings built without build_finding (ME detectors).

    Eponyms, a/an and similar Mechanical Editing detectors create Finding objects
    directly. When their rule_id belongs to a checklist rule, give them per-option
    replacements so the stylesheet's selected option decides them like any TE point.
    """
    from manuscript_core.rules.house_style import options_for_linked
    for f in findings:
        if f.ce_rule_no:
            continue
        meta = get_ce_meta(f.rule_id)
        if meta is None:
            continue
        start = f.match_start
        if not f.match_end:
            idx = seg.text.find(f.surface)
            if idx < 0:
                continue
            start = idx
            f.match_start, f.match_end = idx, idx + len(f.surface)
        opts = options_for_linked(f, seg)
        ce, choice = _ce_fields(meta, f.surface, opts, None, None)
        for k, v in ce.items():
            setattr(f, k, v)
        f.replacement = choice["replacement"]
        f.region = seg.region
        if opts and not f.replacement_options:
            f.replacement_options = [v for v in opts.values() if v and v != "QUERY" and v != f.surface]
    return findings
