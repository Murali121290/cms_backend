"""Shared unit registry and matcher for the CE unit rules.

One matcher finds "number + optional space + unit expression"; each checklist
rule is a check on that same match:

  R1  SI standardisation   non-SI label with the same quantity (sec -> s, hr -> h)
  R2  symbol formatting    case (KG -> kg, KHz -> kHz), plural (kgs), stray full stop
  R3  number-unit spacing  25kg -> 25 kg
  R9  micro prefix         ug / U+00B5 -> U+03BC, mcg per option
  R10 exponents            m2, m^2, s-1 -> m², s⁻¹
  R28 conversion           non-SI unit that needs a value change: flagged, never fixed

All edits on one match become a single finding with `ce_steps`, so the fixer
writes one tracked change and the stylesheet can still switch each rule off.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from manuscript_core.extractor import Segment
from manuscript_core.rules.base import Finding
from manuscript_core.rules.ce_rules import QUERY
from manuscript_core.rules.finding_builder import build_finding

REGISTRY_PATH = Path(__file__).parent / "data" / "units_registry.json"
MICRO = "μ"
SUPERSCRIPT = str.maketrans("0123456789-+", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺")
STEP_ORDER = ("num", "gap", "unit", "tail")


@dataclass(frozen=True)
class UnitInfo:
    symbol: str
    name: str
    quantity: str
    kind: str
    ambiguous: bool = False


@lru_cache(maxsize=1)
def registry() -> dict:
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    symbols: dict[str, UnitInfo] = {}
    bare_ambiguous: set[str] = set()
    for u in data["units"]:
        info = UnitInfo(u["symbol"], u["name"], u["quantity"], u["kind"], u.get("ambiguous", False))
        if u.get("bare", True):
            symbols.setdefault(u["symbol"], info)
            if info.ambiguous:
                bare_ambiguous.add(u["symbol"])
        for p in u.get("prefixes", []):
            symbols.setdefault(p + u["symbol"], UnitInfo(p + u["symbol"], u["name"], u["quantity"], u["kind"]))
    lower: dict[str, set[str]] = {}
    for sym in symbols:
        lower.setdefault(sym.lower(), set()).add(sym)
    return {
        "symbols": symbols,
        "lower": lower,
        "bare_ambiguous": bare_ambiguous,
        "renames": {k.lower(): v for k, v in data["renames"].items()},
        "convert": data["convert"],
        "exceptions": set(data["default_exceptions"]),
        "never": set(data["never_units"]),
        "micro_lookalikes": tuple(data["micro_lookalikes"]),
    }


# number, optional gap, unit token. The token may carry an exponent (m2, m^2, s-1, m²).
_UNIT_RE = re.compile(
    r"(?<![\w.,])(?P<num>\d+(?:[.,]\d+)?)"
    r"(?P<gap>[   ]?)"
    r"(?P<unit>(?:[A-Za-zµμΩÅ]{1,8})(?:\^?-?[1-4](?![\d.,])|[²³⁻¹]{1,3})?)"
    r"(?P<period>\.(?=\s+[a-z]))?"
    r"(?![A-Za-zµμΩ])"
)
_EXP_RE = re.compile(r"^(?P<base>.+?)(?:\^?(?P<exp>-?[1-4]))$")


@dataclass
class UnitMatch:
    start: int
    end: int
    num: str
    gap: str
    unit: str
    period: str


def match_units(text: str, mask: list[bool] | None = None) -> Iterable[UnitMatch]:
    for m in _UNIT_RE.finditer(text):
        if mask and any(i < len(mask) and mask[i] for i in range(m.start(), m.end())):
            continue
        yield UnitMatch(m.start(), m.end(), m.group("num"), m.group("gap"), m.group("unit"), m.group("period") or "")


def _case_fix(token: str) -> tuple[str | None, bool]:
    """Return (canonical symbol, ambiguous) for a token that differs only by case."""
    if len(token) < 2:
        return None, False
    cands = registry()["lower"].get(token.lower(), set())
    if len(cands) == 1:
        return next(iter(cands)), False
    return None, len(cands) > 1


def _normalise_unit(token: str) -> dict:
    """Work out what is wrong with one unit token.

    Returns a dict with the canonical symbol and which rules fired:
    {"symbol", "r1", "r2", "r9", "r10", "convert", "ambiguous", "known"}.
    """
    reg = registry()
    out = {"symbol": None, "r1": None, "r2": None, "r9": None, "r10": None,
           "convert": None, "ambiguous": False, "case_ambiguous": False, "known": False}
    base, exp = token, ""
    if token and token[-1] in "²³¹" or "⁻" in token:
        return {**out, "symbol": token, "known": token.rstrip("²³¹⁻") in reg["symbols"]}
    m = _EXP_RE.match(token)
    if m and (m.group("base") in reg["symbols"] or m.group("base").lower() in reg["lower"]):
        base, exp = m.group("base"), m.group("exp")

    symbols = reg["symbols"]
    sym = base
    if base in reg["exceptions"]:
        return {**out, "symbol": base, "known": True}
    if base in reg["convert"]:
        return {**out, "symbol": base, "convert": reg["convert"][base], "known": True}
    if base.lower() in reg["renames"]:
        sym = reg["renames"][base.lower()]
        out["r1"] = sym
    elif base[:1] in reg["micro_lookalikes"] and (MICRO + base[1:]) in symbols:
        sym = MICRO + base[1:]
        out["r9"] = sym
    elif base == "mcg" or base.lower() == "mcg":
        sym = MICRO + "g"
        out["r9"] = sym
    elif base == "l":
        sym = "L"
        out["r2"] = sym
    elif base in symbols:
        if base in reg["bare_ambiguous"]:
            out["ambiguous"] = True
    else:
        fixed, ambiguous = _case_fix(base)
        if fixed is None and len(base) > 2 and base[-1] in "sS":
            stem = base[:-1]
            fixed = stem if stem in symbols else _case_fix(stem)[0]
        if fixed and fixed.lower() not in _CASE_FIX_UNITS:
            return out  # 4 Ps is not picoseconds: only correct the case of common units
        if fixed:
            sym = fixed
            out["r2"] = sym
        elif ambiguous:
            return {**out, "symbol": base, "case_ambiguous": True, "known": True}
        else:
            return out  # not a unit

    out["known"] = True
    if exp:
        out["r10"] = sym + exp.translate(SUPERSCRIPT)
        sym = out["r10"]
    out["symbol"] = sym
    return out


# Units that are safe to recognise when written straight after a number (25kg, 10mL).
# Case-only errors are fixed in that position only for these.
_CLOSED_FORM_UNITS = {"kg", "mg", "g", "ml", "mm", "cm", "km", "mmol", "μmol", "nmol", "kpa", "mpa",
                      "khz", "mhz", "ghz", "kda", "mmhg", "ms", "μg", "ng", "kcal", "kj", "mv", "kv", "mw", "kw"}


# Units whose capitalisation is corrected (KG -> kg, Mol -> mol). A rarer symbol that only
# matches by case (Ps -> ps, Gs -> Gs) is more likely an abbreviation and is left alone.
_CASE_FIX_UNITS = _CLOSED_FORM_UNITS | {"mol", "hz", "pa", "l", "dl", "μl", "mmhg", "ev", "kev", "mev", "gy", "sv", "bq"}


def _closed_form_is_unit(token: str, info: dict) -> bool:
    if info["r1"] or info["r9"]:
        return True  # 10sec, 3hrs, 15ug
    target = (info["symbol"] or token).rstrip("²³¹⁻")
    return target.lower() in _CLOSED_FORM_UNITS


def detect_units(seg: Segment) -> Iterable[Finding]:
    reg = registry()
    for um in match_units(seg.text, seg.mask):
        if um.unit in reg["never"]:
            continue
        info = _normalise_unit(um.unit)
        if not info["known"]:
            continue
        if not um.gap and not _closed_form_is_unit(um.unit, info):
            continue  # 1970s, 4Ps, 3D, $5m: letters glued to a number are rarely units
        surface = seg.text[um.start:um.end]
        parts = {"num": um.num, "gap": um.gap, "unit": um.unit, "tail": um.period}

        if info["convert"]:
            yield build_finding(
                seg, um.start + len(um.num) + len(um.gap), um.end - len(um.period),
                "si_nonsi_convert", f"Non-SI unit ({um.unit}); SI is {info['convert']}", "si_unit_style",
                option_replacements={"1": None, "2": QUERY, "3": QUERY}, extra_rule_nos=[28])
            continue
        if info["case_ambiguous"]:
            options = " or ".join(sorted(reg["lower"].get(um.unit.lower(), ())))
            yield build_finding(
                seg, um.start + len(um.num) + len(um.gap), um.end - len(um.period),
                "unit_case_wrong", f"Unit symbol case is ambiguous ({um.unit}: {options}?)", "unit_symbol_style",
                option_replacements={"1": None, "2": None, "3": QUERY})
            continue
        if info["ambiguous"]:
            yield build_finding(
                seg, um.start + len(um.num) + len(um.gap), um.end - len(um.period),
                "si_ambiguous_symbol", f"Ambiguous unit symbol ({um.unit})", "si_unit_style",
                option_replacements={"1": None, "2": None, "3": QUERY})
            continue

        steps: list[dict] = []
        rule_ids: list[tuple[str, str]] = []
        unit_now = um.unit
        if info["r1"]:
            target = info["r1"] if not info["r10"] else info["symbol"]
            steps.append({"sno": 1, "part": "unit", "to": {
                "1": target, "2": f"{um.unit} ({um.num} {target})", "3": QUERY}})
            rule_ids.append(("si_nonsi_rename", f"Non-SI unit label ({um.unit} → {target})"))
            unit_now = target
        if info["r9"]:
            target = info["r9"] if not info["r10"] else info["symbol"]
            spelled = "microgram" if target.startswith(MICRO + "g") else None
            steps.append({"sno": 9, "part": "unit", "to": {
                "1": target, "2": None if um.unit.lower() == "mcg" else target, "3": spelled}})
            rule_ids.append(("micro_lookalike", f"Micro prefix ({um.unit} → {target})"))
            unit_now = target
        if info["r2"]:
            target = info["r2"] if not info["r10"] else info["symbol"]
            steps.append({"sno": 2, "part": "unit", "to": {"1": target, "2": target, "3": QUERY}})
            rule_ids.append(("unit_case_wrong", f"Unit symbol form ({um.unit} → {target})"))
            unit_now = target
        if info["r10"] and not (info["r1"] or info["r9"] or info["r2"]):
            steps.append({"sno": 10, "part": "unit", "to": {"1": info["r10"], "2": info["r10"], "3": QUERY}})
            rule_ids.append(("unit_exp_plain", f"Unit exponent ({um.unit} → {info['r10']})"))
            unit_now = info["r10"]
        if um.period:
            steps.append({"sno": 2, "part": "tail", "to": {"1": "", "2": "", "3": QUERY}})
            rule_ids.append(("unit_symbol_period", "Full stop after unit symbol"))
        if um.gap == "" and unit_now not in ("%",):
            steps.append({"sno": 3, "part": "gap", "to": {"1": " ", "2": " ", "3": None}})
            rule_ids.append(("unit_space_missing", "No space between number and unit"))

        if not steps:
            continue
        nos = []
        for s in steps:
            if s["sno"] not in nos:
                nos.append(s["sno"])
        rule_id, label = rule_ids[0]
        ce_steps = {"parts": parts, "order": list(STEP_ORDER), "steps": steps}
        default = {}
        for opt in ("1", "2", "3"):
            p = dict(parts)
            for s in steps:
                v = s["to"].get(opt)
                if v not in (None, QUERY):
                    p[s["part"]] = v
            joined = "".join(p[k] for k in STEP_ORDER)
            default[opt] = joined if joined != surface else None
        yield build_finding(seg, um.start, um.end, rule_id, label, "unit_symbol_style",
                            option_replacements=default, ce_steps=ce_steps, extra_rule_nos=nos)
