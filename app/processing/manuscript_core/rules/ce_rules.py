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
    ("Percent", "percentage"): (6, 6),
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
    ("Symbols", "™ trademark symbol"): (43, 3),
    ("Symbols", "® registered symbol"): (43, 3),
    ("Symbols", "© copyright symbol"): (44, 1),
    ("Degree Celsius", "°C"): (5, 1),
    ("Degree spelled", "degree(s) (spelled)"): (30, 2),
    ("Thousand separator (use/non-use)", "1,000 (comma)"): (11, 1),
    ("Thousand separator (use/non-use)", "1000 (none)"): (11, 3),
    ("Latin abbreviations", "e.g."): (35, 1),
    ("Latin abbreviations", "i.e."): (35, 1),
    ("UK date", "D Mon YYYY (long form)"): (17, 1),
    ("US date", "Month D, YYYY (long form)"): (17, 2),
}

_QUERY_OPTION_RE = re.compile(r"^query author|only if the author confirms|only after", re.IGNORECASE)


@lru_cache(maxsize=1)
def load_catalog() -> list[dict]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["rules"]


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
    opts = rule.get("options", [])
    try:
        idx = int(option) - 1
        text = opts[idx] if 0 <= idx < len(opts) else ""
    except (ValueError, TypeError):
        text = ""
    return not is_query_option(text)


def derive_from_ia_rows(selected_rows: Iterable[dict]) -> tuple[dict[int, dict], list[int]]:
    """Options implied by selected IA rows. The first ticked row wins a conflict."""
    derived: dict[int, dict] = {}
    conflicts: list[int] = []
    for row in selected_rows or []:
        hit = IA_ROW_TO_CE.get((row.get("element"), row.get("pattern")))
        if not hit:
            continue
        sno, option = hit
        if sno in derived:
            if derived[sno]["option"] != option and sno not in conflicts:
                conflicts.append(sno)
            continue
        derived[sno] = {"option": option, "from": f"{row.get('element')}: {row.get('pattern')}"}
    return derived, conflicts


def resolve_ce_config(selected_rows: Iterable[dict] | None = None, ce_rules: dict | None = None) -> dict[int, dict]:
    """Resolved settings for every catalog rule: {sno: {enabled, option, severity, source}}."""
    derived, _ = derive_from_ia_rows(selected_rows or [])
    explicit = {int(k): v for k, v in (ce_rules or {}).items() if str(k).isdigit()}
    out: dict[int, dict] = {}
    for sno, rule in by_sno().items():
        cfg = {"enabled": True, "option": 1, "severity": rule["severity"],
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
        rule_opts = rules.get(sno, {}).get("options", [])
        max_opt = max(3, len(rule_opts))
        if isinstance(opt, int):
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

    Returns {"enabled", "replacement", "query", "severity", "option"}. A replacement
    of None means the finding is only highlighted (or kept, when the option says so).
    `ce_steps` describes a composite unit edit: {"parts": {...}, "order": [...],
    "steps": [{"sno", "part", "to": {"1": str|None|"QUERY", ...}}]}.
    """
    resolved = resolved or default_config()
    cfg = resolved.get(sno) or {"enabled": True, "option": 1, "severity": by_sno().get(sno, {}).get("severity", "Minor")}
    result = {"enabled": cfg["enabled"], "replacement": None, "query": False,
              "severity": cfg["severity"], "option": cfg["option"]}
    if not cfg["enabled"]:
        return result

    if ce_steps:
        parts = dict(ce_steps["parts"])
        applied = False
        for step in ce_steps["steps"]:
            step_cfg = resolved.get(step["sno"], cfg)
            if not step_cfg["enabled"]:
                continue
            opt = step_cfg["option"]
            value = step["to"].get(str(opt))
            text = by_sno().get(step["sno"], {}).get("options", ["", "", ""])[opt - 1]
            if value == QUERY or is_query_option(text):
                result["query"] = True
                continue
            if value is None or not allows_autofix(step["sno"], opt):
                continue
            parts[step["part"]] = value
            applied = True
        new = "".join(parts[k] for k in ce_steps["order"])
        result["replacement"] = new if applied and new != surface else None
        return result

    opt = cfg["option"]
    opts = by_sno().get(sno, {}).get("options", [])
    try:
        opt_idx = int(opt) - 1
        text = opts[opt_idx] if 0 <= opt_idx < len(opts) else ""
    except (ValueError, TypeError):
        text = ""
    value = (option_replacements or {}).get(str(opt))
    if value == QUERY or is_query_option(text):
        result["query"] = True
        return result
    if value is None or value == surface or not allows_autofix(sno, opt):
        return result
    result["replacement"] = value
    return result
