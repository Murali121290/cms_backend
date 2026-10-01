"""Match technical-review findings to a selection of IA template rows (a project or journal style sheet).

Used by the book Technical Review API (to mark findings `in_stylesheet`) and by the journal
Pre-Editing IA rules step (to keep only the selected rules). Also applies the selection's
preferred forms to range and thousand-separator replacements.
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


def annotate_with_stylesheet(findings: List[dict], selected_rows: Iterable[dict], rule_id_to_ia: Optional[Dict] = None) -> List[dict]:
    """Set finding["in_stylesheet"] for each finding and apply the preferred range / thousand-separator forms.

    A finding matches when its rule maps to a selected (element, subtype, pattern) row, or, as a
    fallback, when its category equals a selected row's subtype. Mutates and returns `findings`.
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

    preferred: Dict[str, set] = {}
    for r in rows:
        if r.get("element") and r.get("pattern"):
            preferred.setdefault(r["element"], set()).add(r["pattern"])

    for f in findings:
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
