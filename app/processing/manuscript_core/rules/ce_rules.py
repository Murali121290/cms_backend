"""CE checklist catalog: the 72 technical-editing rules from CE_rules_tool_input.xlsx.

The catalog (ce_rules_catalog.json, built by scripts/build_ce_rules_catalog.py)
links each checklist rule to the TE engine rule_ids it covers. A project's active
stylesheet then chooses, per checklist rule, which of the three options to apply,
whether the rule runs, and its severity.

Settings resolve in three layers, later layers winning:
  1. catalog default: rule on, Option 1, severity from the workbook
  2. options implied by the stylesheet's selected IA rows (IA_ROW_TO_CE)
  3. the stylesheet's explicit ce_rules
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterable

CATALOG_PATH = Path(__file__).with_name("ce_rules_catalog.json")
SEVERITIES = ("Critical", "Major", "Minor", "Informational")
NEVER_AUTOFIX = {12, 26, 28}
QUERY = "QUERY"

# (IA element, IA pattern) -> (checklist S.No., option number)
IA_ROW_TO_CE: dict[tuple[str, str], tuple[int, int]] = {
    ("Percent", "%"): (6, 1),
    ("Percent", "percent"): (6, 3),
    ("Percent", "per cent"): (6, 4),
    ("Percent", "percentage"): (6, 1),  # "percentage" for bare words; numbers take the symbol
    ("Percent", "percentage points"): (6, 5),
    ("Ranges", "X–Y (en dash)"): (14, 1),
    ("Ranges", "X to Y"): (14, 2),
    ("Numbers", "0 to 9 spelled out"): (13, 1),
    ("Numbers", "0 to 9 numerals"): (13, 2),
    ("Numbers", "0 to 99 numerals"): (13, 2),
    ("Units (abbreviated)", "mg"): (4, 1),
    ("Units (abbreviated)", "kg"): (4, 1),
    ("Units (abbreviated)", "mL / ml"): (4, 1),
    ("Units (abbreviated)", "mm"): (4, 1),
    ("Units (abbreviated)", "cm"): (4, 1),
    ("Time units", "h / hr"): (4, 1),
    ("Time units", "min"): (4, 1),
    ("Time units", "s / sec"): (4, 1),
    ("Symbols", "™ trademark symbol"): (43, 3),
    ("Symbols", "® registered symbol"): (43, 3),
    ("Symbols", "© copyright symbol"): (44, 1),
    ("Degree Celsius", "°C"): (5, 1),
    ("Degree Fahrenheit", "°F"): (5, 1),
    ("Degree spelled", "degree(s) (spelled)"): (30, 2),
    ("Degree symbol", "° (bare degree)"): (30, 1),
    ("Thousand separator (use/non-use)", "1,000 (comma)"): (11, 1),
    ("Thousand separator (use/non-use)", "1000 (none)"): (11, 3),
    ("Leading zero", "0.^#"): (11, 1),
    ("Ordinals - numerals", "^#th"): (13, 1),
    ("Ordinals - spelled out", "first, second, … hundredth, thousandth"): (13, 1),
    ("Fractions", "½ [symbol]"): (16, 1),
    ("Fractions", "^#/^# [slash]"): (16, 1),
    ("Fractions", "spelled fraction"): (16, 2),
    ("Latin abbreviations", "e.g."): (35, 1),
    ("Latin abbreviations", "i.e."): (35, 1),
    ("Latin abbreviations", "eg"): (35, 2),
    ("Latin abbreviations", "ie"): (35, 2),
    ("Genus species", "[Genus species]"): (36, 1),
    ("Genus species", "[G. species] (abbreviated)"): (36, 2),
    ("Genus species", "[G species] (no dot)"): (36, 1),
    ("Greek letters", "Lowercase Greek"): (8, 1),
    ("Greek letters", "Greek letter spelled out"): (8, 2),
    ("(-al) endings", "(-al) endings"): (40, 2),
    ("UK date", "D Mon YYYY (long form)"): (17, 1),
    ("US date", "Month D, YYYY (long form)"): (17, 2),
    ("Periods", "am"): (19, 3),
    ("Periods", "pm"): (19, 3),
    ("Periods", "AM"): (19, 4),
    ("Periods", "PM"): (19, 4),
    ("Periods", "a.m."): (19, 1),
    ("Periods", "p.m."): (19, 1),
    ("Periods", "a.m"): (19, 1),
    ("Periods", "p.m"): (19, 1),
    ("Periods", "A.M."): (19, 4),
    ("Periods", "P.M."): (19, 4),
    ("Periods", "A.M"): (19, 4),
    ("Periods", "P.M"): (19, 4),
    ("Table", "Table ^#"): (71, 1),
    ("Table", "Table ^#.^#"): (71, 1),
    ("Table", "Table ^#-^#"): (71, 1),
    ("Table", "Tables ^#.^# to ^#.^#"): (71, 1),
    ("Table", "Tables ^#.^# and ^#.^#"): (71, 1),
    ("Table", "Tables ^#.^# & ^#.^#"): (71, 1),
    ("Table", "Tables ^#.^#-^#.^#"): (71, 1),
    ("Table", "Tables ^#.^#–^#.^#"): (71, 1),
    ("Table", "Tables ^#.^# through ^#.^#"): (71, 1),
    ("Table", "Tab ^#"): (71, 2),
    ("Table", "Tab ^#.^#"): (71, 2),
    ("Table", "Tab ^#-^#"): (71, 2),
    ("Table", "Tabs ^#.^# to ^#.^#"): (71, 2),
    ("Table", "Tabs ^#.^# and ^#.^#"): (71, 2),
    ("Table", "Tabs ^#.^# & ^#.^#"): (71, 2),
    ("Table", "Tabs ^#.^#-^#.^#"): (71, 2),
    ("Table", "Tabs ^#.^#–^#.^#"): (71, 2),
    ("Table", "Tabs ^#.^# through ^#.^#"): (71, 2),
    ("Table", "table ^# (lowercase)"): (71, 4),
    ("Figure", "Figure ^#"): (72, 1),
    ("Figure", "Figure ^#.^#"): (72, 1),
    ("Figure", "Figure ^#-^#"): (72, 1),
    ("Figure", "Figures ^#.^# to ^#.^#"): (72, 1),
    ("Figure", "Figures ^#.^# and ^#.^#"): (72, 1),
    ("Figure", "Figures ^#.^# & ^#.^#"): (72, 1),
    ("Figure", "Figures ^#.^#-^#.^#"): (72, 1),
    ("Figure", "Figures ^#.^#–^#.^#"): (72, 1),
    ("Figure", "Figures ^#.^# through ^#.^#"): (72, 1),
    ("Figure", "Fig ^#"): (72, 2),
    ("Figure", "Fig ^#.^#"): (72, 2),
    ("Figure", "Fig ^#-^#"): (72, 2),
    ("Figure", "Figs ^#.^# to ^#.^#"): (72, 2),
    ("Figure", "Figs ^#.^# and ^#.^#"): (72, 2),
    ("Figure", "Figs ^#.^# & ^#.^#"): (72, 2),
    ("Figure", "Figs ^#.^#-^#.^#"): (72, 2),
    ("Figure", "Figs ^#.^#–^#.^#"): (72, 2),
    ("Figure", "Figs ^#.^# through ^#.^#"): (72, 2),
    ("Figure", "figure ^# (lowercase)"): (72, 4),
    ("Figure", "figures ^# (lowercase)"): (72, 4),
    ("Abbreviations", "Abbreviations in heading"): (34, 1),
    ("Abbreviations", "Abbreviations in FC/TC"): (81, 1),
}

_QUERY_OPTION_RE = re.compile(r"^query author|only if the author confirms|only after", re.IGNORECASE)


@lru_cache(maxsize=1)
def load_catalog() -> list[dict]:
    """Workbook catalog merged with ce_rules_extensions (option forms, extra rule ids, rules 92+)."""
    from . import ce_rules_extensions as ext
    rules =json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["rules"]
    for r in rules:
        forms = ext.FORMS.get(r["sno"])
        if forms:
            r["forms"] = [{"label": label, "preview": preview} for label, preview in forms]
            # The forms follow the engine's option keys, so their labels are the options.
            r["workbook_options"] = list(r["options"])
            r["options"] = [label for label, _ in forms]
        else:
            r["forms"] = [{"label": o, "preview": o} for o in r["options"]]
        r["te_rule_ids"] = list(r["te_rule_ids"]) + ext.EXTRA_TE_RULE_IDS.get(r["sno"], [])
        r.setdefault("default_enabled", True)
    known = {r["sno"] for r in rules}
    for nr in ext.NEW_RULES:
        if nr["sno"] in known:
            continue
        rule = dict(nr)
        rule["forms"] = [{"label": label, "preview": preview} for label, preview in nr["forms"]]
        rules.append(rule)
    return rules


def option_count(sno: int) -> int:
    rule = by_sno().get(sno, {})
    return max(3, len(rule.get("forms") or []), len(rule.get("options") or []))


def option_text(sno: int, option: int | str) -> str:
    opts = by_sno().get(sno, {}).get("options", [])
    try:
        idx = int(option) - 1
    except (TypeError, ValueError):
        return ""
    return opts[idx] if 0 <= idx < len(opts) else ""


@lru_cache(maxsize=1)
def by_sno() -> dict[int, dict]:
    return {r["sno"]: r for r in load_catalog()}


@lru_cache(maxsize=1)
def _rule_id_index() -> tuple[dict[str, int], list[tuple[str, int]]]:
    exact: dict[str, int] = {}
    prefixes: list[tuple[str, int]] = []
    for r in load_catalog():
        for rid in r["te_rule_ids"]:
            if rid.endswith("*"):
                prefixes.append((rid[:-1], r["sno"]))
            else:
                exact.setdefault(rid, r["sno"])
    # Longest prefix first so "ref_tables_" beats "ref_table_" style overlaps.
    prefixes.sort(key=lambda p: -len(p[0]))
    return exact, prefixes


def sno_for_rule_id(rule_id: str) -> int | None:
    exact, prefixes = _rule_id_index()
    if rule_id in exact:
        return exact[rule_id]
    for prefix, sno in prefixes:
        if rule_id.startswith(prefix):
            return sno
    return None


def get_ce_meta(rule_id: str) -> dict | None:
    sno = sno_for_rule_id(rule_id)
    return by_sno().get(sno) if sno is not None else None


def is_query_option(text: str | None) -> bool:
    return bool(text and _QUERY_OPTION_RE.search(text))


def allows_autofix(sno: int, option: int | str = 1) -> bool:
    """Whether a rule may change the text by itself with the chosen option."""
    rule = by_sno().get(sno)
    if not rule or sno in NEVER_AUTOFIX:
        return False
    if rule["behaviour"] == "Flag and suggest":
        return False
    return not is_query_option(option_text(sno, option))


def derive_from_ia_rows(selected_rows: Iterable[dict]) -> tuple[dict[int, dict], list[int]]:
    """Options implied by selected IA rows. The first ticked row wins a conflict."""
    derived: dict[int, dict] = {}
    conflicts: list[int] = []
    for row in selected_rows or []:
        elem = row.get("element")
        subtype = (row.get("subtype") or "").lower()
        patt = row.get("pattern")
        hit = IA_ROW_TO_CE.get((elem, patt))
        if not hit:
            continue
        sno, option = hit
        # Route Caption vs Citation to correct CE rules
        if subtype == "caption" and sno in (71, 72):
            sno = 75 if sno == 71 else 76
        elif subtype == "citation" and sno in (75, 76):
            sno = 71 if sno == 75 else 72

        if sno in derived:
            if derived[sno]["option"] != option and sno not in conflicts:
                conflicts.append(sno)
            continue
        derived[sno] = {"option": option, "from": f"{elem} ({row.get('subtype') or 'General'}): {patt}"}
    return derived, conflicts


def resolve_ce_config(selected_rows: Iterable[dict] | None = None, ce_rules: dict | None = None) -> dict[int, dict]:
    """Resolved settings for every catalog rule: {sno: {enabled, option, severity, source}}."""
    derived, _ = derive_from_ia_rows(selected_rows or [])
    explicit = {int(k): v for k, v in (ce_rules or {}).items() if str(k).isdigit()}
    out: dict[int, dict] = {}
    for sno, rule in by_sno().items():
        cfg = {"enabled": rule.get("default_enabled", True), "option": 1, "severity": rule["severity"],
               "source": {"enabled": "catalog", "option": "catalog", "severity": "catalog"}}
        if sno in derived:
            cfg["option"] = derived[sno]["option"]
            cfg["source"]["option"] = "ia_row"
        for field in ("enabled", "option", "severity"):
            if field in explicit.get(sno, {}):
                cfg[field] = explicit[sno][field]
                cfg["source"][field] = "stylesheet"
        out[sno] = cfg
    return out


def validate_ce_rules(ce_rules: dict | None) -> dict:
    """Drop unknown rules and invalid values; return a clean ce_rules dict."""
    clean: dict[str, dict] = {}
    rules = by_sno()
    for key, setting in (ce_rules or {}).items():
        try:
            sno = int(key)
        except (TypeError, ValueError):
            continue
        if sno not in rules or not isinstance(setting, dict):
            continue
        item: dict = {}
        if isinstance(setting.get("enabled"), bool):
            item["enabled"] = setting["enabled"]
        opt = setting.get("option")
        max_opt = option_count(sno)
        if isinstance(opt, str) and opt.strip().isdigit():
            opt = int(opt.strip())
        if isinstance(opt, int) and not isinstance(opt, bool):
            if 1 <= opt <= max_opt:
                item["option"] = opt
        elif isinstance(opt, str) and opt.strip():
            item["option"] = opt.strip()
        if setting.get("custom_template") and isinstance(setting["custom_template"], str):
            item["custom_template"] = setting["custom_template"].strip()
        if setting.get("severity") in SEVERITIES:
            item["severity"] = setting["severity"]
        if item:
            clean[str(sno)] = item
    return clean


@lru_cache(maxsize=1)
def default_config() -> dict[int, dict]:
    return resolve_ce_config()


def choose_replacement(
    surface: str,
    sno: int,
    option_replacements: dict | None,
    resolved: dict[int, dict] | None = None,
    ce_steps: dict | None = None,
) -> dict:
    """Apply resolved settings to one finding.

    Returns {"enabled", "replacement", "suggestion", "status", "query", "severity", "option"}.

    The selected option is the house style; every other form is an error:
      status "error"     the text differs from the selected option's form. ``suggestion``
                         is that form; ``replacement`` carries it too when the rule may
                         auto-correct (Flag-and-suggest rules only suggest).
      status "compliant" the text already is the selected form (or the option says keep).
      status "query"     the option raises an author query.
      status "flag"      the rule has no automatic form for this hit; the editor decides.
      status "off"       the rule is switched off in the stylesheet.
    `ce_steps` describes a composite unit edit: {"parts": {...}, "order": [...],
    "steps": [{"sno", "part", "to": {"1": str|None|"QUERY", ...}}]}.
    """
    resolved = resolved or default_config()
    cfg = resolved.get(sno) or {"enabled": by_sno().get(sno, {}).get("default_enabled", True), "option": 1,
                                "severity": by_sno().get(sno, {}).get("severity", "Minor")}
    result = {"enabled": cfg["enabled"], "replacement": None, "suggestion": None, "status": "off",
              "query": False, "severity": cfg["severity"], "option": cfg["option"]}
    if not cfg["enabled"]:
        return result

    if ce_steps:
        parts = dict(ce_steps["parts"])
        applied = suggested = False
        for step in ce_steps["steps"]:
            step_cfg = resolved.get(step["sno"], cfg)
            if not step_cfg["enabled"]:
                continue
            opt = step_cfg["option"]
            value = step["to"].get(str(opt))
            if value == QUERY or is_query_option(option_text(step["sno"], opt)):
                result["query"] = True
                continue
            if value is None:
                continue
            parts[step["part"]] = value
            suggested = True
            applied = applied or allows_autofix(step["sno"], opt)
        new = "".join(parts[k] for k in ce_steps["order"])
        if suggested and new != surface:
            result["suggestion"] = new
            result["replacement"] = new if applied else None
            result["status"] = "error"
        else:
            result["status"] = "query" if result["query"] else "compliant"
        return result

    opt = cfg["option"]
    replacements = option_replacements or {}
    value = replacements.get(str(opt))
    if value is None and isinstance(opt, str) and cfg.get("custom_template"):
        value = None  # custom templates are rendered by the stylesheet editor only
    if value == QUERY or is_query_option(option_text(sno, opt)):
        result["query"] = True
        result["status"] = "query"
        return result
    if value is None or value == surface:
        has_any = any(v not in (None, QUERY) for v in replacements.values())
        keep_option = option_text(sno, opt).strip().lower().startswith("keep")
        result["status"] = "compliant" if (value == surface or has_any or keep_option) else "flag"
        return result
    result["suggestion"] = value
    result["status"] = "error"
    if allows_autofix(sno, opt):
        result["replacement"] = value
    return result
