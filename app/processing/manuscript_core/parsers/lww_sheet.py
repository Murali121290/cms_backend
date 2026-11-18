"""LWW editorial style sheet (3-table Word template: metadata / specifications / word list).

``read_spec_rows(doc)`` turns the specification table into rows with the section they sit
in, the house-manual column (AMA / APA) and the "Book Specific" column. The book-specific
value wins when it is filled in.

``match_spec_rows(rows, preset_id)`` maps every row to checklist rules with a table of
matchers (several rules per row are allowed) and returns
``(matched, unresolved, profile)``:

* ``matched``: {sno: {option, confidence, source_label, source_value, explanation, book_specific}}
* ``unresolved``: rows that state something no rule covers (shown to the editor)
* ``profile``: style-profile data from the sheet (word list, unit abbreviations, reference style, notes)

Every (sno, option) a matcher can emit is checked against the catalog by
``validate_matchers`` (see tests), so catalog renumbering cannot silently misroute rows.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

# Values that mean "nothing stated"
_EMPTY = {"", "na", "n/a", "nil", "none", "-", "—", "–", "book specific", "book specific:", "same as ama",
          "same as apa", "same as ama style", "same as apa style", "as per ama", "as per apa"}
# Values that state "keep the author's form": handled, no rule to switch on
_KEEP = re.compile(r"^(?:author usage|follow author|as per author|retain author|author'?s? (?:style|preference))\b", re.I)
_MANUAL_PREFIX = re.compile(r"^\s*(?:AMA|APA)(?:\s*/\s*NE)?\s*:\s*", re.I)
# The column marker always has a colon; "(… – book specific)" inside a value is not a marker
_BOOK_SPECIFIC = re.compile(r"book\s+specific\s*:", re.I)
_COLUMN_HEADER = re.compile(r"^(?:AMA|APA|APA/NE|AMA/NE)$", re.I)


@dataclass
class SpecRow:
    section: str
    label: str
    house: str
    book_specific: str

    @property
    def value(self) -> str:
        return self.book_specific if is_stated(self.book_specific) else self.house

    @property
    def from_book_specific(self) -> bool:
        return is_stated(self.book_specific)


def is_stated(text: str | None) -> bool:
    t = re.sub(r"\s+", " ", (text or "").strip().strip(".")).lower()
    return t not in _EMPTY and not re.fullmatch(r"[-—–\s/]*", t)


def _cell_text(cell) -> str:
    return "\n".join(p.text.strip() for p in cell.paragraphs if p.text.strip()).replace(" ", " ")


def read_spec_rows(doc) -> tuple[list[SpecRow], list[dict]]:
    """(rows, editor_notes) from the specification table (Table 1)."""
    rows: list[SpecRow] = []
    notes: list[dict] = []
    if len(doc.tables) < 2:
        return rows, notes
    section = ""
    for tr in doc.tables[1].rows:
        cells: list[str] = []
        for c in tr.cells:
            t = _cell_text(c)
            if not cells or cells[-1] != t:
                cells.append(t)
        cells = [c for i, c in enumerate(cells) if c or i == 0]
        if not cells:
            continue
        if not cells[0]:
            if len(cells) < 2:
                continue
            # A note row without a label ("Note that no hyphens are needed …"): its text is the label
            cells = [cells[1]] + cells[1:]
        label, rest = cells[0], cells[1:]
        if label.lower().startswith("gas abbreviations"):
            rows.append(SpecRow(section=section, label=label, house="", book_specific=""))
            continue
        if not rest:
            first = label.split("\n", 1)[0].strip()
            if "\n" in label and len(label) > 80:
                notes.append({"label": first, "text": label})
            section = first
            continue
        if len(rest) >= 1 and _COLUMN_HEADER.match(rest[0].strip()):
            section = label.split("\n", 1)[0].strip()  # "Numbers || AMA || Book Specific:"
            continue
        joined = "\n".join(rest)
        parts = _BOOK_SPECIFIC.split(joined, maxsplit=1)
        house = _MANUAL_PREFIX.sub("", parts[0].strip()).strip()
        book = parts[1].strip() if len(parts) > 1 else ""
        rows.append(SpecRow(section=section, label=label.strip(), house=house, book_specific=book))
    return rows, notes


def read_word_list(doc) -> list[str]:
    words: list[str] = []
    if len(doc.tables) < 3:
        return words
    for tr in doc.tables[2].rows:
        for c in tr.cells:
            for line in c.text.splitlines():
                line = line.strip().replace(" ", " ").strip("•- \t")
                if len(line) <= 1:
                    continue  # letter dividers A, B, C
                term = re.split(r"\s+\(", line, maxsplit=1)[0].strip()  # "US (adj) (exception…)" -> "US"
                if term and term not in words:
                    words.append(term)
    return words


# ---------------------------------------------------------------------------
# Matchers
# ---------------------------------------------------------------------------
@dataclass
class Hit:
    sno: int
    option: int
    note: str
    confidence: float = 0.95


@dataclass
class Ctx:
    preset_id: str
    profile: dict = field(default_factory=dict)


Matcher = Callable[[str, str, SpecRow, Ctx], "list[Hit] | Hit | bool | None"]
# (label regex, section regex or None, fn). fn returns hits, or True when the row is
# understood but needs no rule (e.g. "Author usage", reference samples).
MATCHERS: list[tuple[re.Pattern, re.Pattern | None, Matcher]] = []
# Every (sno, option) a matcher may return, for validate_matchers
EMITS: set[tuple[int, int]] = set()


def matcher(label: str, section: str | None = None, emits: tuple = ()):
    def deco(fn: Matcher) -> Matcher:
        MATCHERS.append((re.compile(label, re.I | re.S), re.compile(section, re.I) if section else None, fn))
        EMITS.update(emits)
        return fn
    return deco


def _has(v: str, *words: str) -> bool:
    return any(w in v for w in words)


@matcher(r"^(?:year|month|week|day|hour|minute|second)s?$", emits=((4, 1),))
def _units_tables(v, vl, row, ctx):
    unit = row.label.strip().lower().rstrip("s")
    ctx.profile.setdefault("unit_style", {}).setdefault("abbreviations", {})[unit] = v.strip()
    return Hit(4, 1, f"{unit} → {v.strip()} in tables")


@matcher(r"style for c\b|temperature", emits=((5, 1), (5, 2), (5, 3), (5, 4), (5, 5)))
def _temperature(v, vl, row, ctx):
    if "dual" in vl or re.search(r"°\s?c\s*\(\s*\d+\s*°\s?f", vl):
        return Hit(5, 5, "°C with °F in parentheses")
    if "spaced" in vl or re.search(r"\d\s+°", v):
        return Hit(5, 1, "Spaced degree (5 °C)")
    if "closed" in vl or re.search(r"\d°", v):
        return Hit(5, 2, "Closed degree (5°C)")
    if "deg c" in vl:
        return Hit(5, 3, "deg C")
    if "degrees celsius" in vl or "spell" in vl:
        return Hit(5, 4, "Spelled out")
    return None


@matcher(r"percent", emits=((6, 1), (6, 2), (6, 3), (6, 4), (6, 5)))
def _percent(v, vl, row, ctx):
    if "percentage point" in vl:
        return Hit(6, 5, "percentage points")
    if "%" in v:
        return Hit(6, 2 if re.search(r"\d\s+%", v) or "spaced" in vl else 1, "Percent symbol")
    if "per cent" in vl:
        return Hit(6, 4, "per cent")
    if "percent" in vl:
        return Hit(6, 3, "percent")
    return None


@matcher(r".", section=r"greek", emits=((8, 1), (8, 2)))
@matcher(r"greek", emits=((8, 1), (8, 2)))
def _greek(v, vl, row, ctx):
    # Explicit statements first: "Spell out Greek characters" (APA) / "Use symbols … (α-blocker)" (AMA;
    # its "spell out for EEG terms" is an exception, not the rule)
    if re.search(r"spell(?:ed)?[\s-]+out\s+greek", vl):
        return Hit(8, 2, "Greek letters spelled out")
    if re.search(r"use\s+symbols?", vl):
        return Hit(8, 1, "Greek symbols")
    if "spell out" in vl:
        return Hit(8, 2, "Greek letters spelled out", 0.8)
    if _has(vl, "symbol", "upright", "unicode") or re.search(r"[α-ωΑ-Ω]", v):
        return Hit(8, 1, "Greek symbols", 0.85)
    return None


@matcher(r"micro(?:gram|liter|litre|meter|metre)|micron", emits=((9, 1), (9, 2), (9, 3)))
def _micro(v, vl, row, ctx):
    if "mcg" in vl or "mcl" in vl:
        return Hit(9, 2, "mcg")
    if re.search(r"[μµΜ]", v):
        return Hit(9, 1, "Micro sign (μg)")
    if "microgram" in vl:
        return Hit(9, 3, "Spelled out")
    return None


@matcher(r".", section=r"unit preferences", emits=((2, 1),))
def _unit_preferences(v, vl, row, ctx):
    name = row.label.strip()
    if re.search(r"mm\s?hg", name, re.I):
        ctx.profile.setdefault("unit_style", {})["pressure"] = v.strip()
    ctx.profile.setdefault("unit_style", {}).setdefault("preferred", {})[name] = v.strip()
    hits = [Hit(2, 1, f"Unit symbols as listed ({name}: {v.strip()})", 0.8)]
    micro = _micro(v, vl, row, ctx) if re.search(r"micro", name, re.I) else None
    return hits + ([micro] if micro else [])


@matcher(r"thousand separator|comma in number", emits=((11, 1), (11, 2), (11, 3)))
def _thousands(v, vl, row, ctx):
    if "1,000" in v or "comma" in vl:
        return Hit(11, 1, "Comma separator")
    if re.search(r"\d \d{3}", v) or "thin space" in vl:
        return Hit(11, 2, "Thin space")
    if re.search(r"\b\d{4}\b", v):
        return Hit(11, 3, "Closed four-digit numbers")
    return None


@matcher(r"number usage|0\s*[–-]\s*9|ordinal", emits=((13, 1), (13, 2)))
def _number_style(v, vl, row, ctx):
    if _has(vl, "spell out", "0 to 9", "one to nine", "first to ninth", "spelled out"):
        return Hit(13, 1, "Spell out one to nine")
    if _has(vl, "numerals for all", "always numerals", "all numerals"):
        return Hit(13, 2, "Numerals for all")
    return None


@matcher(r"^ranges?\b|range style", emits=((14, 1), (14, 2), (14, 4), (14, 5), (29, 3)))
def _ranges(v, vl, row, ctx):
    if re.search(r"use\s+[“\"']?to[”\"']?|word\s+to", vl):
        return [Hit(14, 2, "'to' in text, en dash in parentheses/tables"), Hit(29, 3, "'to' in running text", 0.85)]
    if "spaced" in vl and "dash" in vl:
        return Hit(14, 4, "Spaced en dash")
    if _has(vl, "en dash", "en-dash", "endash") or "–" in v:
        return Hit(14, 1, "En dash")
    if "hyphen" in vl:
        return Hit(14, 5, "Hyphen")
    return None


@matcher(r"fraction", emits=((16, 1), (16, 2)))
def _fractions(v, vl, row, ctx):
    return Hit(16, 2 if "spell" in vl else 1, "Fractions")


@matcher(r"dates?\b.*(?:year|time|format)|date format", emits=((17, 1), (17, 2), (19, 1), (19, 2), (19, 3), (19, 4)))
def _dates_times(v, vl, row, ctx):
    hits = []
    if re.search(r"\b[A-Z][a-z]+\.? \d{1,2}, \d{4}", v):
        hits.append(Hit(17, 2, "US long date (June 5, 2026)"))
    elif re.search(r"\b\d{1,2} [A-Z][a-z]+ \d{4}", v):
        hits.append(Hit(17, 1, "UK long date (5 June 2026)"))
    if "a.m." in vl or "p.m." in vl:
        hits.append(Hit(19, 1, "a.m./p.m."))
    elif "24" in vl and "hour" in vl:
        hits.append(Hit(19, 2, "24-hour"))
    elif re.search(r"\bAM\b|\bPM\b", v) and "small cap" not in vl:
        hits.append(Hit(19, 4, "AM/PM"))
    elif re.search(r"\bam\b|\bpm\b", vl):
        hits.append(Hit(19, 3, "am/pm (small caps)"))
    return hits


@matcher(r"\bAD\b.*\bBC\b|\bera\b",emits=((141, 1), (141, 2)))
def _era(v, vl, row, ctx):
    if "a.d." in vl or "b.c." in vl:
        return Hit(141, 2, "AD/BC with periods")
    return Hit(141, 1, "AD/BC without periods (small caps)")


@matcher(r"^circa$", emits=((140, 1), (140, 2), (140, 3)))
def _circa(v, vl, row, ctx):
    if "c." in vl:
        return Hit(140, 2, "c.")
    if re.search(r"\bca\b|\bc\b", vl):
        return Hit(140, 1, "ca (no period)")
    if "circa" in vl:
        return Hit(140, 3, "circa")
    return None


@matcher(r"centur", emits=((128, 1), (128, 2)))
def _century(v, vl, row, ctx):
    if re.search(r"\d+(?:st|nd|rd|th)\s+centur", vl):
        return Hit(128, 1, "Numerals (20th century; first to ninth spelled)")
    return Hit(128, 2, "Spelled out")


@matcher(r"^currency", emits=((21, 1),))
def _currency(v, vl, row, ctx):
    return Hit(21, 1, "Currency symbol before the amount", 0.9)


@matcher(r"statistic|p value|p-value|probability|p/p", emits=((25, 1), (25, 2), (25, 4)))
def _stats(v, vl, row, ctx):
    m = re.search(r"\b([Pp])\s*[<=>≤≥]\s*(0?)\.\d", v)
    if m:
        upper, zero = m.group(1) == "P", bool(m.group(2))
        if zero:
            return Hit(25, 4, "p with leading zero") if not upper else Hit(25, 2, "Uppercase P", 0.8)
        return Hit(25, 2 if upper else 1, "Uppercase P, no leading zero" if upper else "Lowercase p, no leading zero")
    if re.search(r"uppercase\s+[“\"']?p", vl):
        return Hit(25, 2, "Uppercase P")
    if re.search(r"lowercase\s+[“\"']?p", vl):
        return Hit(25, 1, "Lowercase p")
    return None


@matcher(r"^angle|degree symbol", emits=((30, 1), (30, 2)))
def _angle(v, vl, row, ctx):
    if re.search(r"\d+-degree|degrees\b|spelled", vl):
        return Hit(30, 2, "Spelled (90-degree angle)")
    return Hit(30, 1, "Degree sign (45°)")


@matcher(r"dr\.?,?\s*phd|honorific|gas abbreviations|acronym", emits=((34, 1),))
def _acronyms(v, vl, row, ctx):
    if row.label.lower().startswith("gas abbreviations"):
        gases = [g.strip() for g in row.label.split("\n")[1:] if g.strip()]
        acr = ctx.profile.setdefault("acronyms_no_spellout", [])
        acr.extend(g for g in gases if g not in acr)
    if re.search(r"without periods|no periods|\bdr,|\bdr\b(?!\.)", vl):
        ctx.profile["_abbr_no_points"] = True
    return Hit(34, 1, "Capitalised acronyms and degrees", 0.9)


@matcher(r"e\.?g\.? and i\.?e\.?|latin abbreviation", emits=((35, 1), (35, 2), (35, 3), (35, 5), (35, 6)))
def _latin(v, vl, row, ctx):
    no_points = bool(re.search(r"\beg\b|\bie\b", vl)) and not re.search(r"e\.g\.|i\.e\.", vl)
    english_in_text = _has(vl, "spell out in text", "in text: for example", "english")
    if english_in_text:
        return Hit(35, 6 if no_points else 3, "English in text, abbreviated in parentheses"
                   + (" without points" if no_points else ""))
    if no_points:
        return Hit(35, 5, "eg / ie without points")
    if "e.g.," in vl:
        return Hit(35, 1, "e.g., with comma")
    return Hit(35, 2, "e.g. without comma")


@matcher(r"versus|v\.s\.", emits=((35, 3), (35, 6)))
def _versus(v, vl, row, ctx):
    if "versus" in vl and re.search(r"\bvs\b(?!\.)|no period", vl):
        return Hit(35, 6 if ctx.profile.get("_abbr_no_points") else 3, "versus in text, vs in tables", 0.85)
    return None


@matcher(r"genus|species", emits=((36, 2), (36, 4)))
def _genus(v, vl, row, ctx):
    if "allowed?" in row.label.lower():
        return True  # "Italicization … allowed? Yes": italics confirmed, no form stated
    if "not full point" in vl or "no period" in vl:
        return Hit(36, 4, "Abbreviated genus without period (S aureus)")
    if re.search(r"\b[A-Z]\. [a-z]{3,}", v):
        return Hit(36, 2, "Abbreviated genus with period (S. aureus)")
    if re.search(r"\b[A-Z] (?:coli|aureus|epidermidis|pneumoniae)\b", v):
        return Hit(36, 4, "Abbreviated genus without period (S aureus)")
    return None


@matcher(r"\bgene\b|protein", emits=((38, 1),))
def _gene(v, vl, row, ctx):
    return Hit(38, 1, "Gene symbols italic, proteins roman") if "italic" in vl else None


@matcher(r"eponym", emits=((93, 1), (93, 2)))
def _eponym(v, vl, row, ctx):
    if _has(vl, "no ’s", "no 's", "nonpossessive", "non-possessive", "stedman"):
        return Hit(93, 1, "Nonpossessive eponyms")
    if "possessive" in vl:
        return Hit(93, 2, "Possessive eponyms")
    return None


@matcher(r"[“\"]?-al[”\"]? suffix|-logic|medical terminology", emits=((40, 1), (40, 2)))
def _al_suffix(v, vl, row, ctx):
    if _has(vl, "may be omitted", "omit", "delete", "physiologic"):
        return Hit(40, 1, "-ic form (physiologic)")
    if _has(vl, "retain", "-ical"):
        return Hit(40, 2, "-ical form")
    return None


@matcher(r"ellipsis|three dots", emits=((92, 1), (92, 2), (92, 3)))
def _ellipsis(v, vl, row, ctx):
    if ". . ." in v or "spaced points" in vl or "spaced periods" in vl:
        return Hit(92, 2, "Spaced points")
    if "…" in v or _has(vl, "unicode", "character", "space before and after", "ellipsis with"):
        return Hit(92, 1, "Ellipsis character")
    if "..." in v:
        return Hit(92, 3, "Three points")
    return None


@matcher(r"trademark|registered symbol", emits=((43, 1), (43, 2), (43, 3)))
def _trademark(v, vl, row, ctx):
    if _has(vl, "delete", "omit", "remove"):
        return Hit(43, 1, "Remove ™ and ®")
    if "first mention" in vl:
        return Hit(43, 2, "At first mention")
    if _has(vl, "retain", "keep"):
        return Hit(43, 3, "Keep as supplied")
    return None


@matcher(r"preposition casing in head|casing in head|heading capitali[sz]ation|^with hyphens$",
         emits=((70, 1), (70, 2), (70, 4)))
def _heading_case(v, vl, row, ctx):
    if "sentence" in vl:
        return Hit(70, 1, "Sentence case")
    if re.search(r"(?:4|four) or more", vl) or "hyphenated compound" in vl:
        return Hit(70, 4, "Title case: words of 4+ letters capitalised", 0.95 if "4" in vl or "four" in vl else 0.8)
    if "title case" in vl:
        return Hit(70, 2, "Title case")
    return None


_ELEMENT_NUM = r"\b(?:Figure|FIGURE|Fig\.?|FIG\.?|Table|TABLE|Tab\.?)\s+\d+"


def _numbering(v: str, sno: int, period_opt: int, hyphen_opt: int, label: str) -> Hit | None:
    # Anchored on the element label: reference page ranges (1987;62:281-288) are not numbering
    period = re.search(_ELEMENT_NUM + r"\.\d+", v)
    hyphen = re.search(_ELEMENT_NUM + r"-\d+", v)
    if period and hyphen:
        return Hit(sno, 1, f"{label} (period or hyphen numbering as supplied)", 0.8)
    if period:
        return Hit(sno, period_opt, f"{label} with period numbering ({period.group(0)})")
    if hyphen:
        return Hit(sno, hyphen_opt, f"{label} with hyphen numbering ({hyphen.group(0)})")
    return None


@matcher(r"figure citation", emits=((72, 1), (72, 5), (72, 6)))
def _figure_citation(v, vl, row, ctx):
    return _numbering(v, 72, 5, 6, "Figure citations")


@matcher(r"table citation", emits=((71, 1), (71, 5), (71, 6)))
def _table_citation(v, vl, row, ctx):
    return _numbering(v, 71, 5, 6, "Table citations")


@matcher(r"figure caption", emits=((76, 1), (76, 4), (76, 5)))
def _figure_caption(v, vl, row, ctx):
    return _numbering(v, 76, 4, 5, "Figure captions")


@matcher(r"table title|table caption", emits=((75, 1), (75, 4), (75, 5)))
def _table_title(v, vl, row, ctx):
    return _numbering(v, 75, 4, 5, "Table titles")


@matcher(r"abbreviation in figure|tables and figures", emits=((81, 1), (76, 1)))
def _abbr_tables(v, vl, row, ctx):
    if _has(vl, "footnote", "expanded", ";") or re.search(r"[A-Z]{2,}, [a-z]", v):
        return Hit(81, 1, "Abbreviations defined in a footnote")
    return None


@matcher(r"table footnote", emits=((78, 1), (81, 1)))
def _table_footnotes(v, vl, row, ctx):
    hits = []
    if re.search(r"\ba, b\b|letter|alphabet|\*|†", vl):
        hits.append(Hit(78, 1, "Footnote markers in order"))
    if "abbreviations in alpha" in vl:
        hits.append(Hit(81, 1, "Abbreviations in alphabetical order in the footnote", 0.9))
    return hits


@matcher(r"figure parts|part label", emits=((114, 1), (114, 2)))
def _figure_parts(v, vl, row, ctx):
    if re.search(r"\b[A-D], [A-D]\b|\([A-D]\)", v):
        return Hit(114, 1, "Uppercase part labels (A, B)")
    if re.search(r"\b[a-d], [a-d]\b|\([a-d]\)", v):
        return Hit(114, 2, "Lowercase part labels (a, b)")
    return None


@matcher(r"(?:figure|table) source", emits=((115, 1),))
def _source_line(v, vl, row, ctx):
    return Hit(115, 1, "Source/credit line (Adapted from …)", 0.85)


@matcher(r"cross-references|cross references", emits=((126, 1), (126, 2), (97, 1)))
def _cross_refs(v, vl, row, ctx):
    hits = []
    if re.search(r"see (?:Chapter|Section|Box|Table|Figure)", v):
        hits.append(Hit(126, 1, "Capitalised element labels (see Chapter 7)"))
    elif re.search(r"see (?:chapter|section)", v):
        hits.append(Hit(126, 2, "Lowercase element labels"))
    if "see above" in row.label.lower() or "see below" in row.label.lower():
        hits.append(Hit(97, 1, "Query 'see above/below'; cite the element", 0.7))
    return hits


@matcher(r"^quote marks$|quotation marks", emits=((131, 1), (131, 2), (131, 3)))
def _quotes(v, vl, row, ctx):
    if "single" in vl:
        return Hit(131, 3, "Single quotation marks")
    if "straight" in vl:
        return Hit(131, 2, "Straight double quotes")
    if "double" in vl:
        return Hit(131, 1, "Double quotation marks")
    return None


@matcher(r"in[- ]line list|run-in list", emits=((117, 1), (117, 2), (117, 3)))
def _inline_list(v, vl, row, ctx):
    m = re.search(r"\(([a-z1-9])\)|\b([a-z1-9])\)", v)
    if not m:
        return None
    if m.group(2):
        return Hit(117, 3, "a) markers")
    return Hit(117, 2 if m.group(1).isdigit() else 1, f"({m.group(1)}) markers")


@matcher(r"^list\b.*punctuation|lead sentence punctuation", emits=((118, 1), (118, 2)))
def _list_punct(v, vl, row, ctx):
    if _has(vl, "period only for complete sentences", "no period", "lowercase"):
        return Hit(118, 1, "Fragments without end period; period only for sentences", 0.85)
    if "capital" in vl:
        return Hit(118, 2, "Capitalise every entry", 0.85)
    return None


@matcher(r"fold", emits=((129, 1), (129, 2)))
def _fold(v, vl, row, ctx):
    if re.search(r"\b(?:two|three|four|five|six|seven|eight|nine|ten)fold", vl):
        return Hit(129, 1, "Spelled below 10, numerals from 10 (twofold, 30-fold)")
    if re.search(r"\d+-fold", vl):
        return Hit(129, 2, "Numeral hyphenated (7-fold)")
    return None


@matcher(r"^times$", emits=((130, 1), (130, 2)))
def _times(v, vl, row, ctx):
    if re.search(r"\b(?:one|two|three|four|five|six|seven|eight|nine) times", vl):
        return Hit(130, 2, "Spelled below 10 (four times, 12 times)")
    if re.search(r"\d+ times", vl):
        return Hit(130, 1, "Numerals (3 times)")
    return None


@matcher(r"leading zero", emits=((138, 1), (138, 2)))
def _leading_zero(v, vl, row, ctx):
    if _has(vl, "cannot be greater than 1", "cannot exceed 1", "correlation", "statistical significance"):
        return Hit(138, 2, "Leading zero, except values that cannot exceed 1")
    if re.match(r"\s*(?:yes|use)\b", vl):
        return Hit(138, 1, "Leading zero (0.5)")
    if re.match(r"\s*no\b", vl):
        return Hit(138, 2, "No leading zero", 0.8)
    return None


@matcher(r"numbers with\s*>|>, <|<, >", emits=((7, 4), (7, 5)))
def _comparison(v, vl, row, ctx):
    if re.search(r"spell(?:ed)? out in text", vl):
        return Hit(7, 5, "Words in text, symbols in parentheses and tables")
    if "symbol" in vl:
        return Hit(7, 4, "Symbols closed up", 0.8)
    return None


@matcher(r"units?\s*\(repeat", emits=((139, 1), (139, 2)))
def _unit_repeat(v, vl, row, ctx):
    if "repeat %" in vl or "do not repeat the units" in vl or "do not repeat units" in vl:
        return Hit(139, 1, "Repeat %, °; give other units once")
    if "repeat" in vl:
        return Hit(139, 2, "Repeat every unit", 0.8)
    return None


@matcher(r"virgule|\bper\b.*/", emits=((133, 1), (133, 2)))
def _virgule(v, vl, row, ctx):
    if "per" in vl and "/" in v:
        return Hit(133, 1, "Slash with units, per otherwise")
    return Hit(133, 2, "Slash throughout", 0.7)


@matcher(r"equal weightage|equal weight", emits=((101, 1), (101, 2)))
def _equal_weight(v, vl, row, ctx):
    if _has(vl, "en-dash", "en dash", "endash") or "–" in v:
        return Hit(101, 1, "En dash between equal elements (acid–base)")
    if "hyphen" in vl:
        return Hit(101, 2, "Hyphen between equal elements (acid-base)")
    return None


@matcher(r"em dash|en dash", emits=((134, 1), (134, 2)))
def _dashes(v, vl, row, ctx):
    if "em dash" in vl or "em-dash" in vl or "—" in v:
        return Hit(134, 1, "Closed em dash for parenthetical dashes")
    if "en dash" in vl or "–" in v:
        return Hit(134, 2, "Spaced en dash", 0.85)
    return None


@matcher(r"^parentheses$|nested parentheses|brackets", emits=((100, 1),))
def _parens(v, vl, row, ctx):
    return Hit(100, 1, "Brackets inside parentheses ([ ])") if "[" in v else None


@matcher(r"^spellings?$", emits=((135, 1), (135, 2)))
def _spelling(v, vl, row, ctx):
    if re.search(r"\bus\b|american", vl):
        return Hit(135, 1, "American spelling")
    if re.search(r"\buk\b|british", vl):
        return Hit(135, 2, "British spelling")
    return None


@matcher(r"^punctuation$", emits=((131, 1),))
def _punctuation(v, vl, row, ctx):
    return Hit(131, 1, "US punctuation (double quotes)", 0.7) if re.search(r"\bus\b|american", vl) else None


@matcher(r"serial comma", emits=((99, 1), (99, 2)))
def _serial(v, vl, row, ctx):
    if re.match(r"\s*yes", vl):
        return Hit(99, 1, "Serial comma")
    if re.match(r"\s*no", vl):
        return Hit(99, 2, "No serial comma")
    return None


@matcher(r"sexism|gender|person-first", emits=((94, 1), (95, 1)))
def _bias(v, vl, row, ctx):
    hits = []
    if "they" in vl:
        hits.append(Hit(94, 1, "Singular they"))
    if "person-first" in vl or "person first" in vl:
        hits.append(Hit(95, 1, "Person-first language"))
    return hits


@matcher(r"hyphens?\s*\(for prefixes|^hyphenation|no hyphens are needed",emits=((102, 1),))
def _hyphens(v, vl, row, ctx):
    if _has(vl, "no hyphen", "closed up", "retain hyphen", "refer merriam"):
        return Hit(102, 1, "No hyphen for common prefixes / -ly adverbs; per Merriam-Webster", 0.85)
    return None


@matcher(r"caps after colon|capitali[sz]ation after colon", emits=((103, 1), (103, 2), (103, 3)))
def _colon(v, vl, row, ctx):
    if "complete sentence" in vl:
        return Hit(103, 1, "Capital after colon only for complete sentences")
    if "always" in vl:
        return Hit(103, 2, "Always capitalise after colon")
    if _has(vl, "never", "lowercase"):
        return Hit(103, 3, "Never capitalise after colon")
    return None


@matcher(r"magnification", emits=((24, 3),))
def _magnification(v, vl, row, ctx):
    return Hit(24, 3, "Multiplication sign (×5000), not x") if "×" in v else None


@matcher(r"editing for:? while|while/since", emits=((96, 1),))
def _avoid_words(v, vl, row, ctx):
    if re.match(r"\s*yes", vl):
        return Hit(96, 1, "Edit while/since/due to")
    return True  # "No": explicitly not edited


@matcher(r"^text\b.*allowed in heads|abbreviation style", emits=((31, 1),))
def _abbr_text(v, vl, row, ctx):
    return Hit(31, 1, "Define abbreviations at first use; not in headings", 0.8)


@matcher(r"^miscellaneous|^miscellaneous \(per", emits=())
def _misc_terms(v, vl, row, ctx):
    words = ctx.profile.setdefault("word_list", [])
    for t in re.split(r"\n| / ", v):
        t = t.strip()
        if t and t not in words:
            words.append(t)
    return True


# Reference list / citation points: kept in the profile (the reference module applies them)
@matcher(r"citation style|reference list|numerical or alphabetical|page numbers in superscript|ref sample|"
         r"^journal|^patent|^erratum|^statpearls|^urls?$|personal communication|unpublished|other styles in reference|"
         r"notes style")
def _references(v, vl, row, ctx):
    ref = ctx.profile.setdefault("reference_style", {})
    lab = row.label.lower()
    if "citation style" in lab:
        if "superscript" in vl:
            ref["citation"] = "superscript numbered"
        elif re.search(r"name[\s&-]+(?:and\s+)?year|author[\s-]date", vl):
            ref["citation"] = "name-year"
    elif lab.startswith("reference list"):
        m_all = re.search(r"1\s*[–-]\s*(\d+)\s+authors?", vl)
        m_first = re.search(r"first\s+(\d+)\s+authors?", vl)
        m_up = re.search(r"up to\s+(\d+)\s+authors?", vl)
        if m_all:
            ref["list_all_authors_up_to"] = int(m_all.group(1))
        if m_first:
            ref["et_al_after_first"] = int(m_first.group(1))
        if m_up:
            ref["list_all_authors_up_to"] = int(m_up.group(1))
    elif "numerical or alphabetical" in lab:
        ref["order"] = "alphabetical" if "alpha" in vl else "numerical"
    else:
        ref.setdefault("samples", {})[row.label.split("\n")[0][:80]] = v[:600]
    return True


def validate_matchers() -> list[str]:
    """Problems with (sno, option) pairs the matchers can emit; empty when all are valid."""
    try:
        from app.processing.manuscript_core.rules.ce_rules import by_sno, option_count
    except ImportError:  # app/processing on sys.path
        from manuscript_core.rules.ce_rules import by_sno, option_count  # type: ignore
    rules = by_sno()
    problems = []
    for sno, opt in sorted(EMITS):
        if sno not in rules:
            problems.append(f"R{sno} is not in the catalog")
        elif not 1 <= opt <= option_count(sno):
            problems.append(f"R{sno} has no option {opt}")
    return problems


def match_spec_rows(rows: list[SpecRow], preset_id: str) -> tuple[dict, list[dict], dict]:
    ctx = Ctx(preset_id=preset_id)
    best: dict[int, dict] = {}
    unresolved: list[dict] = []
    for row in rows:
        v = row.value
        if not is_stated(v) and not row.label.lower().startswith("gas abbreviations"):
            continue
        vl = v.lower()
        handled = False
        if _KEEP.match(vl.strip()):
            handled = True  # keep the author's form: nothing to switch on
        for lab_re, sec_re, fn in MATCHERS:
            if not lab_re.search(row.label) or (sec_re and not sec_re.search(row.section)):
                continue
            res = fn(v, vl, row, ctx)
            if res is None or res is False:
                continue
            handled = True
            if res is True:
                continue
            for hit in (res if isinstance(res, list) else [res]):
                score = (row.from_book_specific, hit.confidence)
                cur = best.get(hit.sno)
                if cur is None or score > cur["_score"]:
                    label = row.label.split("\n", 1)[0][:90]
                    best[hit.sno] = {
                        "option": hit.option, "confidence": hit.confidence, "_score": score,
                        "source_label": label + (" (book specific)" if row.from_book_specific else ""),
                        "source_value": v[:300], "explanation": f"Option {hit.option}: {hit.note}",
                        "book_specific": row.from_book_specific,
                    }
        if not handled:
            unresolved.append({
                "label": row.label.split("\n", 1)[0][:120],
                "value": v[:400],
                "section": row.section,
                "book_specific": row.from_book_specific,
            })
    ctx.profile.pop("_abbr_no_points", None)
    for cfg in best.values():
        cfg.pop("_score", None)
    return best, unresolved, ctx.profile
