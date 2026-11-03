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
            from manuscript_core.ia_mapping import RULE_ID_TO_IA
            return RULE_ID_TO_IA
        except ImportError:
            return {}


def _ce_rules_module():
    try:
        from app.processing.manuscript_core.rules import ce_rules
    except ImportError:
        from manuscript_core.rules import ce_rules
    return ce_rules


def apply_ce_settings(findings: List[dict], selected_rows: Iterable[dict] = (), ce_rules: Optional[dict] = None) -> List[dict]:
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
    rows = list(selected_rows or [])
    exact = {(r.get("element"), r.get("subtype"), r.get("pattern")) for r in rows}
    subtypes = {(r.get("subtype") or "").lower() for r in rows if r.get("subtype")}
    elements = {r.get("element") for r in rows if r.get("element")}
    mapping = _rule_id_to_ia(rule_id_to_ia)

    # First, apply CE settings to resolve option, replacement, and enabled flag
    apply_ce_settings(findings, rows, ce_rules)

    preferred: Dict[str, set] = {}
    for r in rows:
        if r.get("element") and r.get("pattern"):
            preferred.setdefault(r["element"], set()).add(r["pattern"])

    for f in findings:
        ia_row = mapping.get(f.get("rule_id"))
        has_ia = isinstance(ia_row, (tuple, list)) and len(ia_row) >= 3
        elem = ia_row[0] if has_ia else None
        patt = ia_row[2] if has_ia else None

        # Determine in_stylesheet
        if f.get("ce_rule_no"):
            if not f.get("ce_enabled", True):
                f["in_stylesheet"] = False
            else:
                # Rule is enabled. It is in stylesheet if it matches an exact row,
                # or if it has an active replacement / query under the stylesheet option,
                # or if its element is in the stylesheet.
                if (has_ia and (ia_row[0], ia_row[1], ia_row[2]) in exact) or f.get("replacement") is not None or f.get("ce_query"):
                    f["in_stylesheet"] = True
                elif elem and elem in elements:
                    f["in_stylesheet"] = True
                else:
                    cat = (f.get("category") or "").lower()
                    f["in_stylesheet"] = bool(cat and cat in subtypes)
        else:
            # Non-checklist finding
            if has_ia and (ia_row[0], ia_row[1], ia_row[2]) in exact:
                f["in_stylesheet"] = True
            elif elem and elem in elements:
                # Element is configured in stylesheet, this is a finding in that element
                f["in_stylesheet"] = True
            else:
                cat = (f.get("category") or "").lower()
                f["in_stylesheet"] = bool(cat and cat in subtypes)

    # Non-checklist rule replacements based on IA preferred rows
    for f in findings:
        if f.get("ce_rule_no"):
            continue
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
