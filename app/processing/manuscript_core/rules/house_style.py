"""House-style detectors: every option form of a checklist rule is detected, and the
stylesheet's selected option decides which forms are errors.

This module adds
* detectors for variant forms the original TE detectors missed (25 percentage,
  US$5, 45 degrees, p = 0.05, 15:30, ...),
* detectors for checklist rules 92-124 (ce_rules_extensions.NEW_RULES),
* ``contextualize``: per-location targets (en dash inside parentheses and tables
  when the text option is "to", abbreviations kept inside parentheses, Greek
  symbols kept in tables),
* ``document_pass``: rules that depend on earlier text in the chapter (first
  mention of a binomial or a registered mark, number of H1 headings).

Everything here is client-agnostic. Each detector supplies its own per-option
replacements, keyed like the option forms in ce_rules_extensions.FORMS.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable

from manuscript_core.extractor import Segment
from manuscript_core.rules.base import Finding, iter_unmasked_matches
from manuscript_core.rules.finding_builder import build_finding

QUERY = "QUERY"


def _o(*vals, **extra) -> dict:
    d = {str(i + 1): v for i, v in enumerate(vals)}
    d.update(extra)
    return d


def _same_none(opts: dict, surface: str) -> dict:
    return {k: (None if v == surface else v) for k, v in opts.items()}


def _emit(seg: Segment, start: int, end: int, rule_id: str, label: str, opts: dict,
          canonical: str = "house_style") -> Finding:
    return build_finding(seg, start, end, rule_id, label, canonical, option_replacements=opts)


def _matches(pat: re.Pattern, seg: Segment) -> Iterable[re.Match]:
    return iter_unmasked_matches(pat, seg.text, seg.mask)


def in_parentheses(text: str, pos: int) -> bool:
    """True when ``pos`` sits inside an open parenthesis or bracket of its sentence."""
    depth = 0
    for ch in reversed(text[:pos]):
        if ch in ")]":
            depth -= 1
        elif ch in "([":
            depth += 1
            if depth > 0:
                return True
        elif ch in ".!?" and depth == 0:
            # A sentence end before any open bracket: not parenthetical.
            pass
    return depth > 0


def is_table_or_caption(seg: Segment) -> bool:
    return seg.source == "table" or seg.region == "table" or seg.exclude_reason == "caption"


_HEADING_TAG = re.compile(r"^\s*<\s*H(\d)[A-Z]?\s*>", re.IGNORECASE)
_HEADING_STYLE = re.compile(r"(?:heading|^h|\bhead)\s*(\d)", re.IGNORECASE)


def heading_level(seg: Segment) -> int | None:
    m = _HEADING_TAG.match(seg.text)
    if m:
        return int(m.group(1))
    style = (seg.style or "").strip()
    if not style:
        return None
    m = _HEADING_STYLE.search(style)
    if m and ("head" in style.lower() or style.lower().startswith("h")):
        return int(m.group(1))
    if style.lower() in ("title", "heading"):
        return 1
    return None


# ---------------------------------------------------------------------------
# Context-dependent targets (applied in finding_builder.build_finding)
# ---------------------------------------------------------------------------
_RANGE_IDS = {"range_to", "range_endash", "range_hyphen", "range_endash_spaced"}
_LATIN_ABBR = {"latin_eg_dots": "e.g.,", "latin_eg_nodots": "e.g.,", "latin_ie_dots": "i.e.,",
               "latin_ie_nodots": "i.e.,", "latin_etc_dot": "etc.", "latin_etc_nodot": "etc."}


def contextualize(rule_id: str, opts: dict, seg: Segment, start: int, end: int) -> dict:
    surface = seg.text[start:end]
    parenthetical = in_parentheses(seg.text, start)
    # R14: "'to' in running text" keeps the en dash inside parentheses, tables and figures.
    if rule_id in _RANGE_IDS and (parenthetical or is_table_or_caption(seg)):
        nums = re.findall(r"\d+(?:\.\d+)?", surface)
        if len(nums) >= 2:
            en = f"{nums[0]}–{nums[1]}"
            opts["2"] = None if en == surface else en
            opts["3"] = None if en == surface else en
    # R8: spell out Greek in running text only; symbols stay in tables, figures, equations.
    if rule_id in ("greek_lowercase", "greek_uppercase") and is_table_or_caption(seg):
        opts["2"] = surface  # symbol kept: compliant
    # R35: English forms in running text; abbreviations stay inside parentheses.
    if parenthetical:
        if rule_id in _LATIN_ABBR:
            abbr = _LATIN_ABBR[rule_id]
            opts["3"] = None if surface == abbr else abbr
        elif rule_id.startswith("versus_"):
            opts["3"] = None if surface == "vs." else "vs."
    return opts


def options_for_linked(f: Finding, seg: Segment) -> dict | None:
    """Per-option replacements for Mechanical Editing findings linked to a checklist rule."""
    s = f.surface
    if f.rule_id == "eponym_style":
        if re.search(r"['’]s\s", s):
            fixed = re.sub(r"['’]s(?=\s)", "", s, count=1)
            return _o(fixed, None, QUERY)
        return _o(s, None, QUERY)
    if f.rule_id == "article_an_a_mismatch" and f.replacement:
        return _o(f.replacement, None, QUERY)
    return None


# ---------------------------------------------------------------------------
# R6 percentage: "25 percentage", "25 per", "25 pct"
# ---------------------------------------------------------------------------
_PERCENT_NUM_WORD = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?:percentage(?!\s+points?\b)|pct\.?(?=\W|$)|per(?=\s*(?:[.,;:)]|$|\s+(?:of|in|and|or|to|for|were|was|are|is|had|have|with|among|at|from|by|on|across|within)\b)))",
    re.IGNORECASE)


def detect_percent_variants(seg: Segment) -> Iterable[Finding]:
    for m in _matches(_PERCENT_NUM_WORD, seg):
        n = m.group(1)
        opts = _same_none(_o(f"{n}%", f"{n} %", f"{n} percent", f"{n} per cent", f"{n} percentage points"), m.group(0))
        yield _emit(seg, m.start(), m.end(), "percent_number_word", "% vs percent vs per cent", opts, "percent_style")


# ---------------------------------------------------------------------------
# R7 comparison symbols and operator spacing
# ---------------------------------------------------------------------------
_CMP_SPACED = re.compile(r"(?<![<>=!\w])([<>≤≥])\s+(?=\d)")
_CMP_WORDS = re.compile(r"\b(greater|more|less|fewer)\s+than\s+(or\s+equal\s+to\s+)?(?=\d)", re.IGNORECASE)
_OP_TIGHT = re.compile(r"(?<=\d)(?: ?([+=]) ?)(?=\d)")


def detect_comparison_variants(seg: Segment) -> Iterable[Finding]:
    if seg.source != "table":
        for m in _matches(_CMP_SPACED, seg):
            if re.search(r"\b[pPnNtFrR]\s*$", seg.text[:m.start()]):
                continue  # p < .05: statistical notation keeps its spaces (R25)
            sym = m.group(1)
            yield _emit(seg, m.start(), m.end(), "cmp_num_spaced", "Comparison symbol spacing",
                        _o(None, None, QUERY, sym), "comparison_style")
    for m in _matches(_CMP_WORDS, seg):
        word, eq = m.group(1).lower(), bool(m.group(2))
        sym = ("≥" if eq else ">") if word in ("greater", "more") else ("≤" if eq else "<")
        yield _emit(seg, m.start(), m.end(), "cmp_words_num", "Comparison written out",
                    _o(None, None, QUERY, sym), "comparison_style")
    for m in _matches(_OP_TIGHT, seg):
        if m.group(0) == f" {m.group(1)} ":
            continue
        spaced = f" {m.group(1)} "
        yield _emit(seg, m.start(), m.end(), "op_spacing", "Space around operator",
                    _o(spaced, None, QUERY, spaced), "operator_style")


# ---------------------------------------------------------------------------
# R19 24-hour times; R21 currency amounts; R25 t test; R30 degrees with numbers
# ---------------------------------------------------------------------------
_TIME_24 = re.compile(r"\b(1[3-9]|2[0-3]):([0-5]\d)\b(?!\s*(?:[aApP]\.?[mM]\b|h\b|hrs?\b))")


def detect_time_variants(seg: Segment) -> Iterable[Finding]:
    for m in _matches(_TIME_24, seg):
        h, mm = int(m.group(1)) - 12, m.group(2)
        yield _emit(seg, m.start(), m.end(), "time_24h", "24-hour time",
                    _o(f"{h}:{mm} p.m.", None, f"{h}:{mm} pm", f"{h}:{mm} PM"), "ampm_style")


_AMOUNT = r"(\d[\d,]*(?:\.\d+)?)(\s(?:million|billion|trillion))?"
_CURRENCY_SYMBOL = re.compile(rf"(?<![\w$])(?:US\$|\$)\s?{_AMOUNT}(?:\s+(?:U\.?S\.?\s+)?dollars)?")
_CURRENCY_CODE = re.compile(rf"\bUSD\s?{_AMOUNT}")
_CURRENCY_WORD = re.compile(rf"(?<![$\w.]){_AMOUNT}\s+(?:U\.?S\.?\s+)?dollars\b", re.IGNORECASE)


def detect_currency_amounts(seg: Segment) -> Iterable[Finding]:
    seen: set[tuple[int, int]] = set()
    for pat, rid in ((_CURRENCY_SYMBOL, "currency_amount_symbol"), (_CURRENCY_CODE, "currency_amount_code"),
                     (_CURRENCY_WORD, "currency_amount_word")):
        for m in _matches(pat, seg):
            if any(a <= m.start() < b for a, b in seen):
                continue
            seen.add((m.start(), m.end()))
            amt, scale = m.group(1), m.group(2) or ""
            opts = _same_none(_o(f"${amt}{scale}", f"USD {amt}{scale}", f"{amt}{scale} dollars"), m.group(0))
            yield _emit(seg, m.start(), m.end(), rid, "Currency amount", opts, "currency_style")


_TEMP_WORDS = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:deg(?:rees?)?\.?\s+(C|F|Celsius|Fahrenheit)|(Celsius|Fahrenheit))\b",
                         re.IGNORECASE)


def detect_temperature_words(seg: Segment) -> Iterable[Finding]:
    """R5: '15 degrees C', '15 deg C', '15 degrees Celsius' with the number, so every option can rewrite them."""
    for m in _matches(_TEMP_WORDS, seg):
        n = m.group(1)
        unit = (m.group(2) or m.group(3) or "").lower()
        scale, word = ("C", "Celsius") if unit.startswith("c") else ("F", "Fahrenheit")
        try:
            val = float(n)
            conv = round(val * 9 / 5 + 32) if scale == "C" else round((val - 32) * 5 / 9)
            dual = f"{n} °{scale} ({conv} °{'F' if scale == 'C' else 'C'})"
        except ValueError:
            dual = f"{n} °{scale}"
        opts = _same_none(_o(f"{n} °{scale}", f"{n}°{scale}", f"{n} deg {scale}", f"{n} degrees {word}", dual),
                          m.group(0))
        yield _emit(seg, m.start(), m.end(), "degree_num_word", "Temperature written out", opts, "temp_style")


_T_TEST = re.compile(r"\bt-tests?\b")
_DEG_SPELLED = re.compile(r"\b(\d+(?:\.\d+)?)\s*degrees?\b(?!\s*(?:C|F|Celsius|Fahrenheit|centigrade)\b)")
_DEG_SYMBOL = re.compile(r"\b(\d+(?:\.\d+)?)°(?!\s?[CF]\b)")


def detect_stat_degree_variants(seg: Segment) -> Iterable[Finding]:
    for m in _matches(_T_TEST, seg):
        fixed = m.group(0).replace("-", " ")
        yield _emit(seg, m.start(), m.end(), "stat_t_test", "t test (no hyphen)",
                    _o(fixed, fixed, QUERY, fixed), "stat_style")
    for m in _matches(_DEG_SPELLED, seg):
        n = m.group(1)
        yield _emit(seg, m.start(), m.end(), "degree_num_spelled", "Degrees written out",
                    _same_none(_o(f"{n}°", f"{n} degrees", f"{n}°"), m.group(0)), "temp_style")
    for m in _matches(_DEG_SYMBOL, seg):
        n = m.group(1)
        yield _emit(seg, m.start(), m.end(), "degree_num_symbol", "Degree symbol",
                    _same_none(_o(f"{n}°", f"{n} degrees", f"{n}°"), m.group(0)), "temp_style")


# ---------------------------------------------------------------------------
# R46 product names (generic list; publisher lists add more through the profile)
# ---------------------------------------------------------------------------
PRODUCT_TERMS: dict[str, tuple[str, str]] = {
    "ipad": ("iPad", "tablet"), "ipads": ("iPads", "tablets"),
    "iphone": ("iPhone", "smartphone"), "iphones": ("iPhones", "smartphones"),
    "ipod": ("iPod", "MP3 player"), "ipods": ("iPods", "MP3 players"),
}
_PRODUCT_RE = re.compile(r"\b(?:" + "|".join(PRODUCT_TERMS) + r")\b|\bKindles?\b|\bAmazon(?!\s+(?:rain|river|basin|forest|region))\b",
                         re.IGNORECASE)


def detect_product_names(seg: Segment) -> Iterable[Finding]:
    for m in _matches(_PRODUCT_RE, seg):
        s = m.group(0)
        low = s.lower()
        if low.startswith("kindle"):
            if not s[0].isupper():
                continue
            correct, generic = s, "e-reader" + ("s" if low.endswith("s") else "")
        elif low == "amazon":
            if not s[0].isupper():
                continue
            correct, generic = "Amazon", "online retailer"
        else:
            correct, generic = PRODUCT_TERMS[low]
        yield _emit(seg, m.start(), m.end(), "product_name", "Trademarked product name",
                    _same_none(_o(correct, generic, QUERY), s), "product_name_style")


# ---------------------------------------------------------------------------
# R70 heading capitalisation
# ---------------------------------------------------------------------------
_MINOR_WORDS = {"a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of",
                "off", "on", "per", "to", "up", "via"}
_TITLE_MINOR = _MINOR_WORDS | {"from", "with", "into", "onto", "over", "than", "that", "upon"}
_SHORT_VERBS = {"is", "be", "am", "are", "was", "do", "did", "has", "had", "can", "may", "get", "got", "go", "use", "let", "see", "set", "put"}


def _cap(word: str) -> str:
    return word[:1].upper() + word[1:] if word else word


def _is_acronym(word: str) -> bool:
    core = re.sub(r"[^A-Za-z]", "", word)
    return len(core) >= 2 and (core.isupper() or bool(re.search(r"[a-z][A-Z]", core)))


def heading_forms(text: str) -> tuple[str, str, str]:
    """(sentence case, title case, Springer title case) of a heading."""
    words = text.split()
    sentence, title, springer = [], [], []
    for i, w in enumerate(words):
        first, last = i == 0, i == len(words) - 1
        if _is_acronym(w):
            sentence.append(w), title.append(w), springer.append(w)
            continue
        low = w.lower()
        sentence.append(_cap(low) if first or (i > 0 and words[i - 1].endswith(":")) else low)
        bare = re.sub(r"[^\w-]", "", low)
        title.append(_cap(low) if first or last or bare not in _TITLE_MINOR else low)
        # Springer: capitalise words of 4+ letters and all verbs; second element of compounds too.
        parts = low.split("-")
        cased = []
        for j, p in enumerate(parts):
            core = re.sub(r"[^\w]", "", p)
            keep_lower = core in _MINOR_WORDS and core not in _SHORT_VERBS and len(core) < 4
            cased.append(p if (keep_lower and not (first and j == 0) and not last) else _cap(p))
        springer.append("-".join(cased))
    return " ".join(sentence), " ".join(title), " ".join(springer)


def detect_heading_case(seg: Segment) -> Iterable[Finding]:
    if heading_level(seg) is None:
        return
    raw = seg.text
    tag = _HEADING_TAG.match(raw)
    start = tag.end() if tag else len(raw) - len(raw.lstrip())
    text = raw[start:].rstrip()
    if len(text.split()) < 2 or text.isupper():
        return
    sentence, title, springer = heading_forms(text)
    opts = _same_none(_o(sentence, title, None, springer), text)
    yield _emit(seg, start, start + len(text), "heading_case_check", "Heading capitalisation", opts, "heading_case")


# ---------------------------------------------------------------------------
# Rules 93-124: text replacements
# ---------------------------------------------------------------------------
_EPONYM_PAIR = re.compile(r"\b([A-Z][a-z]+)-([A-Z][a-z]+)\s+(?=(?:disease|syndrome|dystrophy|sign|test|reflex|procedure)\b)")
_PRONOUN_SLASH = re.compile(r"\b(?:he/she|she/he|s/he|he or she|she or he|his/her|her/his|his or her|him/her|him or her)\b",
                            re.IGNORECASE)
_PRONOUN_SUBS = {"he/she": "they", "she/he": "they", "s/he": "they", "he or she": "they", "she or he": "they",
                 "his/her": "their", "her/his": "their", "his or her": "their", "him/her": "them", "him or her": "them"}
_THEMSELF = re.compile(r"\bthemself\b", re.IGNORECASE)

BIAS_TERMS: dict[str, str] = {
    "the elderly": "older adults", "elderly people": "older adults", "elderly patients": "older patients",
    "the poor": "people living in poverty", "the disabled": "people with disabilities",
    "an epileptic": "a person with epilepsy", "epileptics": "people with epilepsy",
    "a diabetic": "a person with diabetes", "diabetics": "people with diabetes",
    "suffers from": "has", "suffering from": "living with", "sufferers": "patients", "sufferer": "patient",
    "victims of": "people affected by", "wheelchair-bound": "who uses a wheelchair",
    "confined to a wheelchair": "who uses a wheelchair",
}
_BIAS_RE = re.compile(r"\b(?:" + "|".join(re.escape(k) for k in sorted(BIAS_TERMS, key=len, reverse=True)) + r")\b",
                      re.IGNORECASE)

AVOID_WORDS: dict[str, str] = {
    "whilst": "while", "amidst": "amid", "amongst": "among", "firstly": "first", "secondly": "second",
    "thirdly": "third", "towards": "toward", "learnt": "learned", "upto": "up to",
}
_AVOID_RE = re.compile(r"\b(?:" + "|".join(AVOID_WORDS) + r")\b", re.IGNORECASE)

_PHYSICAL_REF = re.compile(
    r"\b(?:(?:the\s+)?(?:figure|table|box|example|list|section|discussion)\s+(?:above|below)"
    r"|(?:discussed|described|mentioned|shown|listed|noted|outlined)\s+(?:above|below|earlier|previously)"
    r"|(?:see|on)\s+(?:the\s+)?(?:next|previous|following|preceding)\s+page)\b", re.IGNORECASE)
_AMPERSAND = re.compile(r"(?<=\w) & (?=\w)")
_SERIAL_MISSING = re.compile(r"(?<![,;])\b([\w-]+(?: [\w-]+){0,2}), ([\w-]+(?: [\w-]+){0,2}) (and|or) (?=[\w-])")
_SERIAL_PRESENT = re.compile(r"\b([\w-]+(?: [\w-]+){0,2}), ([\w-]+(?: [\w-]+){0,2}), (and|or) (?=[\w-])")
_PARENS_NESTED = re.compile(r"\(([^()]*)\(([^()]*)\)([^()]*)\)")
_PARENS_BACK = re.compile(r"\)\s\(")
_ENDASH_COMPOUND = re.compile(
    r"\b(pre|post|non|anti|pro|mid|ex)-((?:[A-Z][\w]*)(?: [A-Z0-9][\w]*)+)\b"
    r"|\b((?:[A-Z][\w]*)(?: [A-Z0-9][\w]*)+)-(era|based|related|like|style|type|associated|induced|specific)\b")
_LY_EXCEPT = {"early", "family", "holy", "daily", "elderly", "friendly", "ugly", "only", "july", "italy", "supply",
              "apply", "reply", "belly", "jelly", "bully", "rally", "ally", "fly", "homely", "lovely", "lonely",
              "costly", "timely", "orderly", "lively", "deadly", "likely", "weekly", "monthly", "yearly", "hourly",
              "nightly", "quarterly", "curly", "wooly", "woolly", "hilly", "silly", "lily", "emily", "kelly",
              "molly", "polly", "sally", "billy", "chilly", "jolly", "oily", "wily", "bodily", "comely", "seemly",
              "kindly", "manly", "womanly", "scholarly", "neighborly", "neighbourly", "motherly", "fatherly",
              "brotherly", "sisterly", "leisurely", "ghostly", "beastly", "cowardly", "heavenly", "worldly",
              "unruly", "unlikely", "untimely", "sickly", "surly", "burly", "measly", "prickly", "steely", "earthly"}
_HYPHEN_LY = re.compile(r"\b([A-Za-z]+ly)-([a-z]+)\b")
_HYPHEN_COMP = re.compile(r"\b(better|worse|more|most|less|least)-([a-z]+(?:ed|en))\b", re.IGNORECASE)
_HYPHEN_LETTER = re.compile(r"\b(Type|Phase|Stage|Grade|Class|Level|Step|type|phase|stage|grade|class|level|step)-(I{1,3}|IV|VI{0,3}|IX|X|[A-D]|\d{1,2})\b")
_NUMBER_SIGN = re.compile(r"(?<![\w&])#\s?(\d+)\b")
_PLURAL_NUMBER = re.compile(r"\b(\d{2,4})['’]s\b")
_SERIES = re.compile(
    r"\b(Step|Phase|Stage|Level|Part|Grade)\s+(I{1,3}|IV|VI{0,3}|IX|X|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d{1,2})\b(?![-\w])")
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}
_ROMAN_REV = {v: k for k, v in _ROMAN.items()}
_WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_WORDNUM_REV = {v: k.capitalize() for k, v in _WORDNUM.items()}
_NAME_SUFFIX = re.compile(r"\b([A-Z][a-z]+),\s+(Jr\.?|Sr\.?|II|III|IV)(?=[\s,.;)]|$)")
_DOSAGE = re.compile(
    r"\b(?:p\.\s?o\.|P\.O\.|b\.\s?i\.\s?d\.|B\.I\.D\.|t\.\s?i\.\s?d\.|T\.I\.D\.|q\.\s?i\.\s?d\.|Q\.I\.D\.|q\.\s?d\.|"
    r"bid|tid|qid|BID|TID|QID|PO|po)(?=[\s,;.)]|$)|\bq\s?(\d{1,2})\s?(?:h|hr|hrs|hours?)\b")
_DOSE_CONTEXT = re.compile(
    r"(?:\d\s*(?:mg|g|mcg|μg|mL|ml|units?|tablets?|tabs?|caps(?:ules)?|drops?)|\b(?:PO|po|p\.o\.|IV|IM|SC|SQ|"
    r"BID|bid|TID|tid|QID|qid))\s*$", re.IGNORECASE)
_DOSAGE_FORMS = {
    "po": ("PO", "p.o.", "by mouth"), "bid": ("BID", "b.i.d.", "twice daily"),
    "tid": ("TID", "t.i.d.", "three times daily"), "qid": ("QID", "q.i.d.", "four times daily"),
    "qd": ("daily", "daily", "daily"),
}
_URL_PROTOCOL = re.compile(r"\bhttps?://(www\.[^\s)\]>]+)")
_URL_SLASH = re.compile(r"\b(www\.[^\s)\]>]+?)/(?=[\s)\]>,;]|\.(?:\s|$)|$)")
_AN_LETTERS = set("AEFHILMNORSX")
PRONOUNCED_ACRONYMS = {"NATO", "AIDS", "NASA", "OSHA", "UNESCO", "UNICEF", "NIOSH", "HIPAA", "SARS", "MERS", "COVID",
                       "LASER", "RADAR", "SCUBA", "NAFTA", "FEMA", "MEDLINE", "NICE", "NIDA", "AMA", "ASAP"}
_ARTICLE_ABBR = re.compile(r"\b(a|an|A|An) ([A-Z][A-Z0-9]{1,6})\b")
_FUTURE_WE = re.compile(r"\b(We|we) will (discuss|describe|examine|explore|present|review|cover|address|focus|outline|"
                        r"explain|introduce|consider|highlight|provide|summarize|summarise|look)\b")
_FUTURE_THIS = re.compile(r"\b(This|this|The|the) (chapter|section|book|unit|text) will (discuss|describe|examine|explore|"
                          r"present|review|cover|address|focus|outline|explain|introduce|consider|highlight|provide|"
                          r"summarize|summarise)\b")
_SELFREF = re.compile(r"\b(this|the present|the current|our) (article|paper|manuscript|submission)\b", re.IGNORECASE)
_POSSESSIVE_S = re.compile(r"\b([A-Z][a-z]+s)['’](?=\s+[a-z])")
_EDITION = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)\s+(?:ed\.|edition)(?=[\s,.;)]|$)", re.IGNORECASE)
_ORDINAL_WORDS = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth",
                  "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth", "Sixteenth", "Seventeenth",
                  "Eighteenth", "Nineteenth", "Twentieth"]


def _series_forms(label: str, val: str) -> tuple[str, str, str] | None:
    n = _ROMAN.get(val) or _WORDNUM.get(val.lower()) or (int(val) if val.isdigit() else None)
    if not n or n > 10:
        return None
    return f"{label} {n}", f"{label} {_ROMAN_REV[n]}", f"{label} {_WORDNUM_REV[n]}"


def detect_text_house_style(seg: Segment) -> Iterable[Finding]:
    t = seg.text
    # 93 eponyms with two names: Dejerine-Sottas -> Dejerine–Sottas
    for m in _matches(_EPONYM_PAIR, seg):
        s = m.group(0).rstrip()
        yield _emit(seg, m.start(), m.start() + len(s), "eponym_pair_hyphen", "Eponym with two names",
                    _o(s.replace("-", "–"), None, QUERY), "eponym_style")
    # 94 gender-neutral pronouns
    for m in _matches(_PRONOUN_SLASH, seg):
        s = m.group(0)
        sub = _PRONOUN_SUBS.get(s.lower(), "they")
        sub = _cap(sub) if s[0].isupper() else sub
        yield _emit(seg, m.start(), m.end(), "pronoun_slash", "Gender-neutral pronoun",
                    _o(sub, None if "or" in s.lower() else s.replace("/", " or "), QUERY), "pronoun_style")
    for m in _matches(_THEMSELF, seg):
        yield _emit(seg, m.start(), m.end(), "pronoun_themself", "themself → themselves",
                    _o("themselves", None, QUERY), "pronoun_style")
    # 95 bias-free language
    for m in _matches(_BIAS_RE, seg):
        s = m.group(0)
        sub = BIAS_TERMS[s.lower()]
        sub = _cap(sub) if s[0].isupper() else sub
        yield _emit(seg, m.start(), m.end(), "bias_term", "Person-first / bias-free language",
                    _o(sub, None, QUERY), "bias_style")
    # 96 words to avoid
    for m in _matches(_AVOID_RE, seg):
        s = m.group(0)
        sub = AVOID_WORDS[s.lower()]
        sub = _cap(sub) if s[0].isupper() else sub
        yield _emit(seg, m.start(), m.end(), "avoid_word", "Word to avoid", _o(sub, QUERY, None), "avoid_word")
    # 97 physical references
    for m in _matches(_PHYSICAL_REF, seg):
        yield _emit(seg, m.start(), m.end(), "physical_ref", "Physical reference (above/below)",
                    _o(QUERY, None, QUERY), "cross_ref_style")
    # 98 ampersand in running text (organisation names such as Johnson & Johnson keep it)
    if seg.region != "references":
        for m in _matches(_AMPERSAND, seg):
            left = re.search(r"(\w+)\s*$", t[:m.start()])
            right = re.match(r"\s*(\w+)", t[m.end():])
            if left and right and left.group(1)[0].isupper() and right.group(1)[0].isupper():
                continue
            yield _emit(seg, m.start(), m.end(), "ampersand_text", "Ampersand in text", _o(" and ", None, QUERY),
                        "ampersand_style")
    # 99 serial comma
    for m in _matches(_SERIAL_MISSING, seg):
        # "A, B and C": the item before "B" must itself follow a lead-in or another item.
        if not _looks_like_series(t, m.start(2) - 2) or _not_series_item(m.group(2)):
            continue
        s = t[m.start(2) - 2:m.end()]
        fixed = f", {m.group(2)}, {m.group(3)} "
        yield _emit(seg, m.start(2) - 2, m.end(), "serial_comma_missing", "Serial comma",
                    _o(fixed, None, None), "serial_comma")
    for m in _matches(_SERIAL_PRESENT, seg):
        if not _looks_like_series(t, m.start(2) - 2) or _not_series_item(m.group(2)):
            continue
        fixed = f", {m.group(2)} {m.group(3)} "
        yield _emit(seg, m.start(2) - 2, m.end(), "serial_comma_present", "Serial comma",
                    _o(None, fixed, None), "serial_comma")
    # 100 nested and back-to-back parentheses
    for m in _matches(_PARENS_NESTED, seg):
        fixed = f"({m.group(1)}[{m.group(2)}]{m.group(3)})"
        yield _emit(seg, m.start(), m.end(), "parens_nested", "Nested parentheses", _o(fixed, None, QUERY), "parens_style")
    for m in _matches(_PARENS_BACK, seg):
        yield _emit(seg, m.start(), m.end(), "parens_back_to_back", "Back-to-back parentheses", _o("; ", None, QUERY),
                    "parens_style")
    # 101 en dash in compound modifiers
    for m in _matches(_ENDASH_COMPOUND, seg):
        s = m.group(0)
        yield _emit(seg, m.start(), m.end(), "endash_compound", "En dash in open compound",
                    _same_none(_o(s.replace("-", "–"), s.replace("–", "-"), QUERY), s), "endash_style")
    # 102 compound hyphenation
    for m in _matches(_HYPHEN_LY, seg):
        if m.group(1).lower() in _LY_EXCEPT:
            continue
        s = m.group(0)
        yield _emit(seg, m.start(), m.end(), "hyphen_ly", "No hyphen after -ly adverb", _o(s.replace("-", " "), None, QUERY),
                    "hyphen_style")
    for m in _matches(_HYPHEN_COMP, seg):
        s = m.group(0)
        yield _emit(seg, m.start(), m.end(), "hyphen_comparative", "No hyphen after comparative",
                    _o(s.replace("-", " "), None, QUERY), "hyphen_style")
    for m in _matches(_HYPHEN_LETTER, seg):
        s = m.group(0)
        yield _emit(seg, m.start(), m.end(), "hyphen_letter_numeral", "No hyphen before letter/numeral",
                    _o(s.replace("-", " "), None, QUERY), "hyphen_style")
    # 104 number sign
    for m in _matches(_NUMBER_SIGN, seg):
        yield _emit(seg, m.start(), m.end(), "number_sign", "Number sign", _same_none(_o(f"No. {m.group(1)}", f"#{m.group(1)}", QUERY), m.group(0)),
                    "number_sign")
    # 105 plural numbers
    for m in _matches(_PLURAL_NUMBER, seg):
        yield _emit(seg, m.start(), m.end(), "plural_number", "Plural number", _o(f"{m.group(1)}s", None, QUERY),
                    "plural_number")
    # 106 series numbering
    for m in _matches(_SERIES, seg):
        forms = _series_forms(m.group(1), m.group(2))
        if forms:
            yield _emit(seg, m.start(), m.end(), "series_numbering", "Series numbering",
                        _same_none(_o(*forms), m.group(0)), "series_numbering")
    # 107 name suffixes
    for m in _matches(_NAME_SUFFIX, seg):
        yield _emit(seg, m.start(), m.end(), "name_suffix", "Comma before name suffix",
                    _o(f"{m.group(1)} {m.group(2)}", None, QUERY), "name_suffix")
    # 108 dosage abbreviations
    for m in _matches(_DOSAGE, seg):
        s = m.group(0)
        if m.group(1):
            n = m.group(1)
            forms = (f"q{n}h", f"q{n}h", f"every {n} hours")
        else:
            key = re.sub(r"[.\s]", "", s).lower()
            if "." not in s and not _DOSE_CONTEXT.search(t[:m.start()]):
                continue  # bare po/bid/PO only next to a dose
            if key not in _DOSAGE_FORMS:
                continue
            forms = _DOSAGE_FORMS[key]
        yield _emit(seg, m.start(), m.end(), "dosage_abbr", "Dosage abbreviation", _same_none(_o(*forms), s), "dosage_style")
    # 109 URLs
    for m in _matches(_URL_PROTOCOL, seg):
        yield _emit(seg, m.start(), m.end(), "url_protocol", "http:// before www address",
                    _o(m.group(1).rstrip("/"), None, QUERY), "url_style")
    for m in _matches(_URL_SLASH, seg):
        if re.search(r"https?://$", t[:m.start()]):
            continue  # already covered by the http:// finding
        yield _emit(seg, m.start(), m.end(), "url_trailing_slash", "Trailing slash on URL", _o(m.group(1), None, QUERY),
                    "url_style")
    # 110 a/an before abbreviations, by sound
    for m in _matches(_ARTICLE_ABBR, seg):
        art, abbr = m.group(1), m.group(2)
        if not abbr.isupper():
            continue
        # Initialisms are read letter by letter (an MRI); acronyms are read as words (a NATO member).
        wants_an = abbr[0] in "AEIOU" if abbr in PRONOUNCED_ACRONYMS else abbr[0] in _AN_LETTERS
        want = "an" if wants_an else "a"
        if art.lower() == want:
            continue
        want = _cap(want) if art[0].isupper() else want
        yield _emit(seg, m.start(), m.end(), "article_abbr", "a/an before abbreviation", _o(f"{want} {abbr}", None, QUERY),
                    "article_style")
    # 111 present tense for the book's own content
    for m in _matches(_FUTURE_WE, seg):
        yield _emit(seg, m.start(), m.end(), "future_tense", "Present tense for book content",
                    _o(f"{m.group(1)} {m.group(2)}", None, QUERY), "tense_style")
    for m in _matches(_FUTURE_THIS, seg):
        verb = m.group(3)
        verb_s = verb + ("es" if verb.endswith(("s", "sh", "ch", "x")) else "s")
        verb_s = verb_s[:-2] + "ies" if verb.endswith("y") and verb[-2] not in "aeiou" else verb_s
        yield _emit(seg, m.start(), m.end(), "future_tense", "Present tense for book content",
                    _o(f"{m.group(1)} {m.group(2)} {verb_s}", None, QUERY), "tense_style")
    # 112 chapter self-reference
    for m in _matches(_SELFREF, seg):
        lead = m.group(1)
        yield _emit(seg, m.start(), m.end(), "chapter_selfref", "Chapter self-reference",
                    _o(f"{lead} chapter", None, QUERY), "chapter_selfref")
    # 113 possessive of singular names ending in s
    for m in _matches(_POSSESSIVE_S, seg):
        if re.search(r"(?:ses|xes|zes|ches|shes)$", m.group(1)):
            continue  # plural possessive: the Jameses'
        if re.search(r"(?:^|[.!?:]\s*|[\"“(]\s*)$", t[:m.start()]):
            continue  # capitalised only because it starts a sentence (Males' ...): a plural, not a name
        yield _emit(seg, m.start(), m.end(), "possessive_s", "Possessive of name ending in s",
                    _o(f"{m.group(1)}'s", None, QUERY), "possessive_style")
    # 124 edition numbers with titles
    for m in _matches(_EDITION, seg):
        n = int(m.group(1))
        if 1 <= n < len(_ORDINAL_WORDS):
            yield _emit(seg, m.start(), m.end(), "edition_title", "Edition number",
                        _same_none(_o(f"{_ORDINAL_WORDS[n]} Edition", f"{m.group(0).split()[0]} ed.", QUERY), m.group(0)),
                        "edition_style")


_SERIES_LEADIN = re.compile(
    r"(?:[,:]|\b(?:including|such as|of|are|were|include|includes|included|involve|involves|like|as|the|three|four|"
    r"five|several|both|either|tested|used|measured|assessed))\s+$", re.IGNORECASE)


_NOT_ITEM_FIRST = {"both", "either", "neither", "between", "whether", "which", "who", "that", "including",
                   "particularly", "especially", "such", "not", "but"}
_NOT_ITEM_LAST = {"within", "between", "among", "across", "into", "from", "with", "of", "to", "for", "in", "on",
                  "at", "by", "than", "as", "the", "a", "an", "is", "are", "was", "were"}


def _not_series_item(item_b: str) -> bool:
    """'both physical and mental', 'variability within and between': not list items."""
    words = item_b.lower().split()
    return not words or words[0] in _NOT_ITEM_FIRST or words[-1] in _NOT_ITEM_LAST


def _looks_like_series(text: str, comma_pos: int) -> bool:
    """``comma_pos`` is the comma before item B in "A, B and C". Item A must follow a
    lead-in (", ", ": ", "such as", "including", ...) so "In 2020, prices and wages"
    is not treated as a list."""
    before = text[:comma_pos]
    for n in (1, 2, 3):  # item A may be one to three words long
        item_a = re.search(r"([\w-]+(?: [\w-]+){%d})$" % (n - 1), before)
        if item_a and _SERIES_LEADIN.search(before[:item_a.start()]):
            return True
    return False


# ---------------------------------------------------------------------------
# Headings, lists, MCQ (structural; flag and suggest)
# ---------------------------------------------------------------------------
_HEADING_BAD = re.compile(r"[?:]|\([^)]*\)")
_HEADING_SUPER = re.compile(r"^\s*<\s*H\d[A-Z]\s*>", re.IGNORECASE)
_LIST_STYLE = re.compile(r"list|bullet|\bbl\d|\bnl\d|\bul\b|\bol\b", re.IGNORECASE)
_LIST_LEVEL = re.compile(r"(?:bullet|bl|list)\s*(\d)", re.IGNORECASE)
_BULLET_PREFIX = re.compile(r"^\s*[•\-\*\u2022\u25aa\u25cf]\s*")
_STUB = re.compile(r"^(\s*(?:[•\-\*\u2022\u25aa\u25cf]\s*)?[^:]{2,50}):\s+([a-z])")
_MCQ_BAD_OPTION = re.compile(r"\b(?:all of the above|none of the above|both [A-E] and [A-E])\b", re.IGNORECASE)
_MCQ_NEGATIVE = re.compile(r"\bwhich of the following (?:is|are|would be|does) not\b|\ball of the following\b[^?]*\bexcept\b",
                           re.IGNORECASE)
_MCQ_DIRECTIONAL = re.compile(r"\b(best|most|priority|initial)\b(?=[^?]{0,80}\?)", re.IGNORECASE)
_MCQ_BLANK = re.compile(r"_{3,}")
_MCQ_AI_RATIONALE = re.compile(r"\b(?:in-text citations address|the text explains|thus,\s*[A-E]\s*is the only correct answer)\b",
                               re.IGNORECASE)
_MCQ_RATIONALE_LETTER = re.compile(r"\b(?:Option\s+[A-E]\s+is\s+(?:not\s+)?correct|[A-E]\s+is\s+not\s+correct\s+because)\b",
                                   re.IGNORECASE)


def detect_structure(seg: Segment) -> Iterable[Finding]:
    level = heading_level(seg)
    if level is not None:
        tag = _HEADING_TAG.match(seg.text)
        if _HEADING_SUPER.match(seg.text):
            yield _emit(seg, 0, min(len(seg.text), 10), "heading_superhead",
                        "Avoid super heads (e.g. <H1A>)", _o(QUERY, None, QUERY), "heading_content")
        body = seg.text[tag.end():] if tag else seg.text
        offset = len(seg.text) - len(body)
        for m in _HEADING_BAD.finditer(body):
            yield _emit(seg, offset + m.start(), offset + m.end(), "heading_content",
                        "Avoid ?, : and parentheticals in headings", _o(QUERY, None, QUERY), "heading_content")
        return
    style = seg.style or ""
    is_list = bool(_LIST_STYLE.search(style) or _BULLET_PREFIX.match(seg.text))
    if is_list:
        lv = _LIST_LEVEL.search(style)
        if lv and int(lv.group(1)) >= 3:
            yield _emit(seg, 0, min(len(seg.text), 40), "bullet_structure", "More than two bullet levels",
                        _o(QUERY, None, QUERY), "bullet_structure")
        m = _STUB.match(seg.text)
        if m:
            pos = m.start(2)
            yield _emit(seg, pos, pos + 1, "bullet_stub_case", "Capitalise after stub colon",
                        _o(m.group(2).upper(), None, QUERY), "bullet_structure")
        text = seg.text.rstrip()
        words = text.split()
        if words and len(words) <= 8 and text.endswith(".") and not re.search(r"\b(?:is|are|was|were|has|have|should|must|can|will)\b", text):
            yield _emit(seg, len(text) - 1, len(text), "list_punct", "List fragment ends with a period",
                        _o("", None, QUERY), "list_punct")
        elif words and words[0][:1].islower():
            yield _emit(seg, 0, len(words[0]), "list_punct", "List entry starts lowercase",
                        _o(None, _cap(words[0]), QUERY), "list_punct")
    for m in _matches(_MCQ_BAD_OPTION, seg):
        yield _emit(seg, m.start(), m.end(), "mcq_option", "MCQ option not allowed", _o(QUERY, None, QUERY), "mcq_style")
    for m in _matches(_MCQ_NEGATIVE, seg):
        yield _emit(seg, m.start(), m.end(), "mcq_negative_stem", "Negative MCQ stem", _o(QUERY, None, QUERY), "mcq_style")
    for m in _matches(_MCQ_BLANK, seg):
        yield _emit(seg, m.start(), m.end(), "mcq_stem_blank", "Avoid fill-in-the-blank in question stem",
                    _o(QUERY, None, QUERY), "mcq_style")
    for m in _matches(_MCQ_AI_RATIONALE, seg):
        yield _emit(seg, m.start(), m.end(), "mcq_ai_rationale", "AI-generated rationale marker phrase",
                    _o(QUERY, None, QUERY), "mcq_style")
    for m in _matches(_MCQ_RATIONALE_LETTER, seg):
        yield _emit(seg, m.start(), m.end(), "mcq_rationale_letter", "Avoid option letter in rationale",
                    _o(QUERY, None, QUERY), "mcq_style")
    if seg.text.rstrip().endswith("?") or re.match(r"^\s*\d+\.\s", seg.text):
        for m in _matches(_MCQ_DIRECTIONAL, seg):
            if m.group(0).isupper():
                continue
            yield _emit(seg, m.start(), m.end(), "mcq_directional", "Capitalise MCQ directional",
                        _o(m.group(0).upper(), None, QUERY), "mcq_style")


# ---------------------------------------------------------------------------
# Captions and source lines (caption segments are excluded from the TE pass)
# ---------------------------------------------------------------------------
_FIG_PART = re.compile(r"\(([a-h])\)")
_SOURCE_LEAD = re.compile(r"^\s*(?:Source\s*[-–:]\s*|Sources?:\s*)?(Reproduced from|Reprinted from|Adapted from|Modified from|"
                          r"Courtesy of|Data from|From)\b[:\s]", re.IGNORECASE)
_SOURCE_STOCK = re.compile(r"\b(?:Wikipedia|Wikimedia(?: Commons)?|Shutterstock|iStock(?:photo)?|Getty Images|Adobe Stock)\b")
_CONTINUED = re.compile(r"\((?:Cont(?:inued)?\.?|cont\.|Cont['’]d|cont['’]d|CONTINUED|Continued)\)|\bcont['’]d\b")


def detect_caption_house_style(seg: Segment) -> Iterable[Finding]:
    text = seg.text
    for m in _FIG_PART.finditer(text):
        yield _emit(seg, m.start(), m.end(), "figure_part_label", "Figure part label",
                    _o(f"({m.group(1).upper()})", None, QUERY), "figure_part")
    m = _SOURCE_LEAD.match(text)
    if m:
        lead = m.group(1)
        norm = {"reproduced from": "From", "reprinted from": "From", "data from": "From", "from": "From",
                "adapted from": "Adapted from", "modified from": "Adapted from", "courtesy of": "Courtesy of"}[lead.lower()]
        start = m.start()
        end = m.end(1)
        target = f"Source: {norm}"
        if text[start:end] != target:
            yield _emit(seg, start, end, "source_line", "Source line style", _o(target, None, QUERY), "source_line")
    if re.match(r"^\s*Source", text) or m:
        for a in re.finditer(r"(?<=\w) & (?=\w)", text):
            yield _emit(seg, a.start(), a.end(), "source_line", "Spell out 'and' in source line", _o(" and ", None, QUERY),
                        "source_line")
    for s in _SOURCE_STOCK.finditer(text):
        yield _emit(seg, s.start(), s.end(), "source_stock", "Stock-image site in credit line",
                    _o(QUERY, None, QUERY), "source_line")
    for c in _CONTINUED.finditer(text):
        yield _emit(seg, c.start(), c.end(), "continued_line", "Continued line style",
                    _same_none(_o("(continued)", "(Continued)", "(cont'd)"), c.group(0)), "continued_line")


# ---------------------------------------------------------------------------
# Document-level passes
# ---------------------------------------------------------------------------
def document_pass(findings: list[Finding], segments: list[Segment]) -> list[Finding]:
    """Rules that depend on earlier text in the same chapter. Returns extra findings."""
    extra: list[Finding] = []
    ordered = sorted(findings, key=lambda f: (f.chapter_index, f.para_index, f.match_start))
    # R36: a binomial is written in full at first mention per chapter, abbreviated after.
    seen_binomials: set[tuple[int, str]] = set()
    for f in ordered:
        if f.rule_id != "genus_species_full":
            continue
        parts = f.surface.split()
        if len(parts) < 2:
            continue
        key = (f.chapter_index, f.surface.lower())
        abbr_dot = f"{parts[0][0]}. {' '.join(parts[1:])}"
        abbr_nodot = f"{parts[0][0]} {' '.join(parts[1:])}"
        if key in seen_binomials:
            f.option_replacements = {**f.option_replacements, "2": abbr_dot, "4": abbr_nodot}
        else:
            seen_binomials.add(key)
            f.option_replacements = {**f.option_replacements, "2": None, "4": None}
    # R43 option 2: keep a registered or trademark sign at first mention per chapter only.
    seen_marks: set[tuple[int, str]] = set()
    for f in ordered:
        if f.rule_id not in ("sym_registered_char", "sym_trademark_char"):
            continue
        before = f.context.split("⟪")[0] if "⟪" in f.context else ""
        term = (before.split() or [""])[-1].lower()
        key = (f.chapter_index, term)
        if key in seen_marks:
            f.option_replacements = {**f.option_replacements, "2": ""}
        else:
            seen_marks.add(key)
            f.option_replacements = {**f.option_replacements, "2": None}
    # R119: avoid chapters with only one or two H1 headings.
    h1: dict[int, list[Segment]] = defaultdict(list)
    for seg in segments:
        if heading_level(seg) == 1:
            h1[seg.chapter_index].append(seg)
    for ch, segs in h1.items():
        if 0 < len(segs) < 3:
            seg = segs[0]
            extra.append(_emit(seg, 0, min(len(seg.text), 60), "heading_h1_count",
                               f"Only {len(segs)} H1 heading(s) in this chapter", _o(QUERY, None, QUERY), "heading_content"))
    return extra


# Order matters only for overlap resolution; all run on unexcluded body/table segments.
HOUSE_STYLE_DETECTORS = [
    detect_percent_variants,
    detect_comparison_variants,
    detect_time_variants,
    detect_currency_amounts,
    detect_stat_degree_variants,
    detect_temperature_words,
    detect_product_names,
    detect_heading_case,
    detect_text_house_style,
    detect_structure,
]
