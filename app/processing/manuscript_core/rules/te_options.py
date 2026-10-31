"""Per-option replacements for CE checklist rules (CE_rules_tool_input.xlsx).

Keys "1"/"2"/"3" follow the workbook's Option 1/2/3. A value of None means
"leave as is"; "QUERY" means the option creates an author query. The active
stylesheet picks the option later (ce_rules.choose_replacement).
"""
from __future__ import annotations

import re

from manuscript_core.rules.te_point_replacements import get_te_replacement

QUERY = "QUERY"
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")
_SENTENCE_START_RE = re.compile(r"(?:^|[.!?]\s+|\n)\s*$")
_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
_SUP = str.maketrans("0123456789-+", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺")
_SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
MOJIBAKE = {
    "â€™": "’", "â€˜": "‘", "â€œ": "“",
    "â€\u009d": "”", "â€“": "–", "â€”": "—",
    "â€¦": "…", "Ã©": "é", "Ã¨": "è", "Ã¼": "ü",
    "Ã¶": "ö", "Ã¤": "ä", "Â°": "°", "Â±": "±",
    "Âµ": "μ", "Ã—": "×",
}
GREEK = {"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "kappa": "κ",
         "lambda": "λ", "mu": "μ", "sigma": "σ", "tau": "τ", "omega": "ω"}
_MONTH_NUM = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
              "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_MONTH_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]
_ID_CONTEXT_RE = re.compile(
    r"(?:\b[A-Z]{2}\s|\b(?:No|no|Nos|ID|ISBN|ISSN|DOI|PMID|Box|Suite|Room|page|pages|p|pp|ext|Tel|tel)\.?\s*#?|#|[-/])$")
_UNIT_SYMBOL = {"mg": "mg", "kg": "kg", "ml": "mL", "mcg": "μg", "mm": "mm", "cm": "cm", "km": "km",
                "hour": "h", "min": "min", "sec": "s"}


def _opts(o1=None, o2=None, o3=None, o4=None, o5=None, o6=None, **kwargs) -> dict:
    d = {"1": o1, "2": o2, "3": o3}
    if o4 is not None:
        d["4"] = o4
    if o5 is not None:
        d["5"] = o5
    if o6 is not None:
        d["6"] = o6
    d.update(kwargs)
    return d


def _unless_same(opts: dict, surface: str) -> dict:
    return {k: (v if v != surface else None) for k, v in opts.items()}


def _before(m: re.Match, n: int = 40) -> str:
    return m.string[max(0, m.start() - n):m.start()]


def _number_before(m: re.Match) -> str | None:
    hit = re.search(r"(\d+(?:\.\d+)?)\s*$", _before(m))
    return hit.group(1) if hit else None


def _words_to_int(word: str) -> int | None:
    w = word.lower().strip()
    teens = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
             "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
    tens = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
    if w in _ONES:
        return _ONES.index(w)
    if w in teens:
        return teens[w]
    parts = re.split(r"[-\s–]+", w)
    if parts[0] in tens and (len(parts) == 1 or parts[1] in _ONES):
        return tens[parts[0]] + (_ONES.index(parts[1]) if len(parts) == 2 else 0)
    return None


def get_te_replacements_by_option(rule_id: str, m: re.Match) -> dict:
    """Literal replacement for each workbook option of the checklist rule behind `rule_id`."""
    s = m.group(0)
    nums = _NUM_RE.findall(s)

    # R6 percentage: 25% / 25 % / 25 percent / 25 per cent / 25 percentage points / percentage
    sentence_start = bool(_SENTENCE_START_RE.search(_before(m, 80)))
    if rule_id in ("percent_symbol", "percent_word", "per_cent_word"):
        w_us = "Percent" if sentence_start else "percent"
        w_uk = "Per cent" if sentence_start else "per cent"
        if not nums:
            return _opts(None, None, w_us, w_uk, "percentage points", "Percentage" if sentence_start else "percentage")
        n = nums[0]
        return _unless_same(_opts(
            f"{n}%",
            f"{n} %",
            f"{n} {w_us}",
            f"{n} {w_uk}",
            f"{n} percentage points",
            "Percentage" if sentence_start else "percentage",
        ), s)
    if rule_id == "percent_percentage":
        p_word = "Percentage" if sentence_start else "percentage"
        return _opts(p_word, p_word, p_word, p_word, p_word, p_word)

    # R14 number ranges: 10–15 / 10 to 15 / from 10 to 15 / 10 – 15 / 10-15
    if rule_id in ("range_to", "range_endash", "range_hyphen") and len(nums) >= 2:
        a, b = nums[0], nums[1]
        has_from = bool(re.search(r"\bfrom\s+$", _before(m), re.IGNORECASE))
        has_between = bool(re.search(r"\bbetween\s+$", _before(m), re.IGNORECASE))
        from_or_to = f"between {a} and {b}" if has_between else (f"{a} to {b}" if has_from else f"from {a} to {b}")
        return _unless_same(_opts(
            f"{a}–{b}",
            f"{a} to {b}",
            from_or_to,
            f"{a} – {b}",
            f"{a}-{b}",
        ), s)

    # R13 number style: one to nine spelled out, numerals for 10 and above,
    # Option 3 spells out a number that begins a sentence.
    sentence_start = bool(_SENTENCE_START_RE.search(_before(m, 80)))
    if rule_id in ("num_single_numeral", "num_double_numeral") and s.isdigit():
        n = int(s)
        if 1 <= n <= 9:
            return _opts(_ONES[n], None, _ONES[n] if sentence_start else None)
        return _opts()
    if rule_id in ("num_single_spelled", "num_double_spelled"):
        n = _words_to_int(s)
        if n is None or sentence_start:
            return _opts()
        return _opts(str(n) if n >= 10 else None, str(n), None)
    if rule_id in ("num_zero_numeral", "num_zero_spelled"):
        return _opts()

    # R5 temperature: 25 °C / 25°C / 25 degrees Celsius / 25 deg C / dual conversion
    if rule_id in ("degree_celsius", "degree_fahrenheit"):
        scale, word = ("C", "Celsius") if rule_id == "degree_celsius" else ("F", "Fahrenheit")
        alt_scale = "F" if scale == "C" else "C"
        if nums:
            n = nums[0]
            try:
                deg_val = float(n)
                converted = round(deg_val * 9/5 + 32) if scale == "C" else round((deg_val - 32) * 5/9)
                dual = f"{n} °{scale} ({converted} °{alt_scale})"
            except ValueError:
                dual = f"{n} °{scale}"
            return _unless_same(_opts(
                f"{n} °{scale}",
                f"{n}°{scale}",
                f"{n} deg {scale}",
                f"{n} degrees {word}",
                dual,
            ), s)
        return _opts()
    if rule_id in ("degree_deg_c", "degree_deg_f"):
        scale, word = ("C", "Celsius") if rule_id == "degree_deg_c" else ("F", "Fahrenheit")
        if not _number_before(m):
            return _opts()
        return _unless_same(_opts(f"°{scale}", f"°{scale}", f"deg {scale}", f"degrees {word}"), s)

    # R30 degree symbol look-alikes (º or superscript o)
    if rule_id == "degree_lookalike":
        return _opts("°", " degrees", "°")

    # R7 mathematical symbols
    if rule_id == "cmp_gte_sym" and s == ">=":
        return _opts("≥", None, QUERY)
    if rule_id == "cmp_lte_sym" and s == "<=":
        return _opts("≤", None, QUERY)
    if rule_id == "times_letter" and len(nums) >= 2:
        return _opts(f"{nums[0]} × {nums[1]}", None, QUERY)

    # R8 Greek letters spelled out in scientific names (TNF-alpha, alpha-1)
    if rule_id == "greek_spelled":
        g = GREEK.get(s.lower())
        return _opts(g, None, QUERY) if g else _opts()

    # R10 gas formulae with plain digits
    if rule_id.startswith("gas_") and rule_id.endswith("_inline"):
        sub = re.sub(r"\d", lambda d: d.group(0).translate(_SUB), s)
        return _opts(sub, sub, QUERY)

    # R11 thousands separators: 1,000 / 1 000 (thin space) / 1000 for four digits
    if rule_id.startswith("thousands_"):
        raw = re.sub(r"[,\s  ]", "", s)
        if not raw.isdigit():
            return _opts()
        if rule_id == "thousands_nosep" and _ID_CONTEXT_RE.search(_before(m, 20)):
            return _opts()  # ZIP code, page, ISBN or other identifier, not a quantity
        n = int(raw)
        comma = f"{n:,}"
        thin = comma.replace(",", " ")
        closed = raw if len(raw) == 4 else comma
        return _unless_same(_opts(comma, thin, closed), s)

    # R15 negative numbers: true minus / en dash / hyphen / spelled
    if rule_id == "negative_hyphen":
        num_part = s[1:]
        return _opts("−" + num_part, "–" + num_part, "-" + num_part, f"negative {num_part}")

    # R17 date format: 10 October 2026 (UK) / October 10, 2026 (US) / 2026-10-10 (ISO) / ordinal / abbreviated
    if rule_id in ("date_uk_long", "date_us_long"):
        mon = re.search(r"[A-Za-z]+", s)
        day = re.search(r"\b(\d{1,2})\b", s)
        year = re.search(r"\b(\d{4})\b", s)
        if mon and day and year and mon.group(0)[:3].lower() in _MONTH_NUM:
            mi = _MONTH_NUM[mon.group(0)[:3].lower()]
            d, y = int(day.group(1)), year.group(1)
            full_m = _MONTH_FULL[mi]
            return _unless_same(_opts(
                f"{d} {full_m} {y}",
                f"{full_m} {d}, {y}",
                f"{y}-{mi:02d}-{d:02d}",
                f"{d}th {full_m} {y}",
                f"{full_m[:3]}. {d}, {y}",
            ), s)
        return _opts()
    if rule_id.startswith("date_"):
        return _opts()  # numeric dates are ambiguous (D/M vs M/D): flag only

    # R19 time format: 3:30 p.m. / 15:30 / 3:30 pm / 3:30 PM
    if rule_id.startswith("ampm_"):
        t = re.match(r"(\d{1,2})(?::(\d{2}))?", s)
        if not t:
            return _opts()
        h, mm = int(t.group(1)), t.group(2) or "00"
        pm = "_pm_" in rule_id
        suffix_dots = "p.m." if pm else "a.m."
        suffix_nodots = "pm" if pm else "am"
        suffix_caps = "PM" if pm else "AM"
        twelve_dots = f"{h}:{mm} {suffix_dots}" if t.group(2) else f"{h} {suffix_dots}"
        twelve_nodots = f"{h}:{mm} {suffix_nodots}" if t.group(2) else f"{h} {suffix_nodots}"
        twelve_caps = f"{h}:{mm} {suffix_caps}" if t.group(2) else f"{h} {suffix_caps}"
        h24 = (h % 12) + (12 if pm else 0)
        return _unless_same(_opts(twelve_dots, f"{h24:02d}:{mm}", twelve_nodots, twelve_caps), s)

    # R24 scientific notation: 3.2 × 10⁵
    if rule_id in ("sci_notation_e", "sci_notation_x"):
        sm = re.match(r"(\d+(?:\.\d+)?)\s*(?:[eE]|[xX×]\s*10\^?)\s*([-+−]?\d+)", s)
        if not sm:
            return _opts()
        nice = f"{sm.group(1)} × 10{sm.group(2).replace(chr(0x2212), '-').translate(_SUP)}"
        return _opts(nice, None if rule_id == "sci_notation_e" else nice, nice)

    # R25 statistical notation: p < 0.05 / P < .05
    if rule_id in ("stat_p_value", "stat_symbol"):
        sm = re.match(r"([A-Za-z])\s*([<=>≤≥])\s*(\S+)", s)
        if not sm:
            return _opts()
        sym, op, val = sm.groups()
        if rule_id == "stat_p_value":
            short = val[1:] if val.startswith("0.") else val
            return _opts(f"{sym.lower()} {op} {val}", f"{sym.upper()} {op} {short}", QUERY)
        return _opts(f"{sym} {op} {val}", f"{sym} {op} {val}", QUERY)

    # R29 tolerance: 5 ± 0.2
    if rule_id == "plusminus_spacing":
        a, b = re.split(r"\s*±\s*", s, maxsplit=1)
        return _unless_same(_opts(f"{a} ± {b}", None, None), s)
    if rule_id == "plusminus_text":
        return _opts(" ± ", " ± ", None)

    # R43 trademark: remove / keep at first mention / keep
    if rule_id in ("sym_trademark_char", "sym_registered_char"):
        return _opts("", None, None)
    if rule_id == "sym_trademark_text":
        return _opts("", "™", None)
    if rule_id == "sym_registered_text":
        return _opts("", "®", None)
    # R44 copyright
    if rule_id == "sym_copyright_text":
        return _opts("©", "Copyright", QUERY)
    if rule_id == "sym_copyright_char":
        return _opts(None, "Copyright", None)

    # R45 corrupted characters
    if rule_id == "special_char_corrupt":
        fix = MOJIBAKE.get(s)
        return _opts(fix, None, QUERY) if fix else _opts(None, None, QUERY)

    # R35 Latin abbreviations: roman with comma / roman without comma / English / UK forms
    if rule_id in ("latin_eg_nodots", "latin_eg_dots"):
        return _unless_same(_opts("e.g.,", "e.g.", "for example,", "eg.", "eg"), s)
    if rule_id in ("latin_ie_nodots", "latin_ie_dots"):
        return _unless_same(_opts("i.e.,", "i.e.", "that is,", "ie.", "ie"), s)
    if rule_id == "latin_etc_nodot":
        return _opts("etc.", "etc", "and so on")
    if rule_id.startswith("versus_"):
        return _unless_same(_opts("vs.", "vs", "versus", "v."), s)

    # R4 unit abbreviation consistency: symbol after a number. Option 2 (the form the
    # manuscript uses most) is filled in document-wide by the analyzer.
    if rule_id.startswith("unit_") and rule_id.endswith("_spelled"):
        sym = _UNIT_SYMBOL.get(rule_id[len("unit_"):-len("_spelled")])
        if sym and _number_before(m):
            return _opts(sym, None, QUERY)
        return _opts()
    if rule_id.startswith("unit_"):
        return _opts()

    # R89 placeholders: query / delete / keep
    if rule_id == "placeholder_text":
        return _opts(QUERY, "", None)

    # R23 chemical formulae: subscripts / element case / query
    if rule_id == "chem_formula_plain":
        cased = "NaCl" if s.upper() == "NACL" else s
        return _unless_same(_opts(re.sub(r"\d", lambda d: d.group(0).translate(_SUB), cased), cased, QUERY), s)

    # R22 equation references: Equation (1)
    if rule_id == "equation_ref" and nums:
        return _unless_same(_opts(f"Equation ({nums[0]})", None, QUERY), s)

    # Flag-only rules
    if rule_id in ("timezone_abbr", "equation_ref", "duplicate_paragraph"):
        return _opts()

    # Anything else linked to the checklist: Option 1 is the engine's existing fix.
    return _opts(get_te_replacement(rule_id, m), None, None)
