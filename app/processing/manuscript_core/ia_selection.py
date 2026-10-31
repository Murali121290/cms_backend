"""Match technical-review findings to a selection of IA template rows (a project or journal style sheet).

Used by the book Technical Review API (to mark findings `in_stylesheet`), by the fix job, and by
the journal Pre-Editing IA rules step (to keep only the selected rules). Also applies the
stylesheet's CE checklist settings (option, on/off, severity) to every checklist finding, and the
selection's preferred forms to range and thousand-separator replacements.
"""
import re
from typing import Dict, Iterable, List, Optional

RANGE_RULES = {"range_to", "range_endash", "range_hyphen"}
THOUSAND_RULES = {"thous_sep_missing", "thous_sep_comma", "thous_sep_space", "thous_sep_nbsp"}


def _rule_id_to_ia(rule_id_to_ia: Optional[Dict]) -> Dict:
    if rule_id_to_ia:
        return rule_id_to_ia
    try:
        from app.processing.manuscript_core.ia_mapping import RULE_ID_TO_IA
        return RULE_ID_TO_IA
    except ImportError:
        try:
            from manuscript_core.ia_mapping import RULE_ID_TO_IA  # type: ignore
            return RULE_ID_TO_IA
        except ImportError:
            return {}


def _ce_rules_module():
    try:
        from app.processing.manuscript_core.rules import ce_rules
    except ImportError:
        from manuscript_core.rules import ce_rules  # type: ignore
    return ce_rules


def apply_ce_settings(findings: List[dict], selected_rows: Iterable[dict] = (), ce_rules: Optional[dict] = None) -> List[dict]:
    """Re-pick the replacement of every checklist finding from the stylesheet's CE settings.

    Findings are the cached scan dicts; only those with a `ce_rule_no` change. A rule switched
    off gets `ce_enabled=False` and no replacement; a review-only or query option gets no
    replacement (the finding is highlighted) and `ce_query` when the option is an author query.
    """
    ce = _ce_rules_module()
    resolved = ce.resolve_ce_config(list(selected_rows or []), ce_rules or {})
    for f in findings:
        sno = f.get("ce_rule_no")
        if not sno:
            continue
        choice = ce.choose_replacement(
            f.get("surface", ""), sno, f.get("option_replacements") or {},
            resolved=resolved, ce_steps=f.get("ce_steps"),
        )
        f["ce_enabled"] = choice["enabled"]
        f["ce_option"] = choice["option"]
        f["ce_severity"] = choice["severity"]
        f["ce_query"] = choice["query"]
        f["replacement"] = choice["replacement"]
    return findings


def annotate_with_stylesheet(
    findings: List[dict],
    selected_rows: Iterable[dict],
    rule_id_to_ia: Optional[Dict] = None,
    ce_rules: Optional[dict] = None,
) -> List[dict]:
    """Set finding["in_stylesheet"] for each finding and apply the stylesheet's preferred forms.

    A finding matches when its rule maps to a selected (element, subtype, pattern) row, or, as a
    fallback, when its category equals a selected row's subtype. Checklist findings take their
    replacement from the stylesheet's CE settings, and a checklist rule switched off is never
    in the stylesheet. Mutates and returns `findings`.
    """
    rows = list(selected_rows or [])
    exact = {(r.get("element"), r.get("subtype"), r.get("pattern")) for r in rows}
    subtypes = {(r.get("subtype") or "").lower() for r in rows if r.get("subtype")}
    mapping = _rule_id_to_ia(rule_id_to_ia)

    for f in findings:
        ia_row = mapping.get(f.get("rule_id"))
        matched = isinstance(ia_row, (tuple, list)) and len(ia_row) >= 3 and (ia_row[0], ia_row[1], ia_row[2]) in exact
        if not matched:
            cat = (f.get("category") or "").lower()
            matched = bool(cat and cat in subtypes)
        f["in_stylesheet"] = matched

    apply_ce_settings(findings, rows, ce_rules)
    for f in findings:
        if f.get("ce_rule_no") and not f.get("ce_enabled", True):
            f["in_stylesheet"] = False

    preferred: Dict[str, set] = {}
    for r in rows:
        if r.get("element") and r.get("pattern"):
            preferred.setdefault(r["element"], set()).add(r["pattern"])

    for f in findings:
        if f.get("ce_rule_no"):
            continue  # ranges (R14) and thousands (R11) follow the CE option instead
        rule_id, surface = f.get("rule_id", ""), f.get("surface", "")
        if rule_id in RANGE_RULES and preferred.get("Ranges"):
            pref = next(iter(preferred["Ranges"])).lower()
            nums = re.findall(r"\d+", surface)
            if len(nums) >= 2:
                if "to" in pref:
                    f["replacement"] = f"{nums[0]} to {nums[1]}"
                elif "en dash" in pref:
                    f["replacement"] = f"{nums[0]}–{nums[1]}"
                elif "hyphen" in pref:
                    f["replacement"] = f"{nums[0]}-{nums[1]}"
        elif rule_id in THOUSAND_RULES and preferred.get("Thousand separator (use/non-use)"):
            pref = next(iter(preferred["Thousand separator (use/non-use)"])).lower()
            clean = re.sub(r"[,\s ]", "", surface)
            try:
                n = int(clean)
            except ValueError:
                continue
            if "comma" in pref and "no comma" not in pref:
                f["replacement"] = f"{n:,}"
            elif "no comma" in pref:
                f["replacement"] = clean
    return findings
