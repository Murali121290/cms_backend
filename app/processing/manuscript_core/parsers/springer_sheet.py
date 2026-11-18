"""Parser for sectioned publisher style sheets (Springer Publishing House Style Sheet layout).

Layout (July 2026 sheet):
  Table 0  one large table. Rows with a single filled cell are section headers
           (SYMBOLS AND MEASUREMENTS, NUMBERS, ACRONYMS/ABBREVIATIONS, TEXT STYLE,
           WORD LIST, ILLUSTRATIONS, TABLES ...). Other rows are "label | value".
           Rows with an empty label continue the previous label, or, under WORD
           LIST, hold word-list entries.
  Table 1  INDEX rules.
  Later    "Appendix: Content style notes" paragraphs and example tables (headings,
           bullets, MCQ).

``parse_sectioned(doc)`` returns the specs, the CE rule selections each spec
implies (with the row it came from), and the style_profile lists (word list and
replacement pairs, never-spell-out acronyms, organisation names, -ic terms,
registered terms, words to avoid, unit style).
"""
from __future__ import annotations

import re
from typing import Any, Callable

SECTION_WORDS = (
    "SYMBOLS AND MEASUREMENTS", "NUMBERS", "ACRONYMS", "ABBREVIATIONS", "TEXT STYLE", "WORD LIST",
    "SPECIAL WORDS", "LAYOUT", "ILLUSTRATIONS", "TABLES", "INDEX",
)


def _clean(text: str) -> str:
    return (text or "").replace(" ", " ").replace("​", "").strip()


def _cell_lines(cell) -> list[str]:
    return [_clean(p.text) for p in cell.paragraphs if _clean(p.text)]


def _unique_cells(row) -> list:
    out, seen = [], set()
    for c in row.cells:
        key = id(c._tc)
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def is_sectioned_layout(doc) -> bool:
    head = " ".join(_clean(p.text) for p in doc.paragraphs[:5]).lower()
    if "house style sheet" in head and "springer" in head:
        return True
    if not doc.tables:
        return False
    first_cells = []
    for row in doc.tables[0].rows[:40]:
        cells = _unique_cells(row)
        texts = [_clean(c.text) for c in cells]
        if texts and texts[0] and not any(texts[1:]):
            first_cells.append(texts[0].upper())
    hits = sum(1 for t in first_cells if any(t.startswith(w) for w in SECTION_WORDS))
    return hits >= 2


def _is_section_header(texts: list[str]) -> str | None:
    if not texts or not texts[0]:
        return None
    if any(texts[1:]):
        # "TEXT STYLE |" style header: label in caps and value empty, handled above;
        # "WORD LIST" sometimes sits alone too.
        return None
    t = texts[0].strip().rstrip("/").strip()
    if t.isupper() or any(t.upper().startswith(w) for w in SECTION_WORDS):
        return t
    return None


# ---------------------------------------------------------------------------
# Word list parsing
# ---------------------------------------------------------------------------
_NOT_RE = re.compile(r"\(\s*(?:not|never)\s+[“\"']?([^)”\"']+?)[”\"']?(?:\s*[;,)][^)]*)?\)", re.IGNORECASE)
_NOT_DASH_RE = re.compile(r"\b(?:not|never)\s+[“\"]([^”\"]+)[”\"]", re.IGNORECASE)
_CHANGE_RE = re.compile(r"change\s+([\w\s'-]+?)\s+to\s+([\w\s'-]+)", re.IGNORECASE)
_POS_RE = re.compile(r"\((?:n|v|adj|n\.|v\.|adj\.|n,\s*adj\.?|n, v|n\.,\s*adj\.)[^)]*\)", re.IGNORECASE)


def _term_of(entry: str) -> str:
    term = re.split(r"\s*\(|\s+–\s+|\s+—\s+", entry, maxsplit=1)[0]
    return term.strip(" .;,")


def _variant_for(term: str, wrong: str) -> str:
    """'U.S. Preventive Services Task Force' + 'Preventative' -> 'U.S. Preventative Services Task Force'."""
    wrong = wrong.strip(" .;,")
    if " " in wrong or wrong.lower().startswith(term.split()[0].lower()[:3]) and len(wrong.split()) >= len(term.split()):
        return wrong
    words = term.split()
    for i, w in enumerate(words):
        core = re.sub(r"\W", "", w).lower()
        if core and core[:4] == re.sub(r"\W", "", wrong).lower()[:4] and core != wrong.lower():
            return " ".join(words[:i] + [wrong] + words[i + 1:])
    return wrong


def parse_word_entry(entry: str) -> dict:
    """One word-list line -> {term, variants, note, registered}."""
    text = _clean(entry)
    term = _term_of(text)
    variants: list[str] = []
    for m in _NOT_RE.finditer(text):
        variants.append(_variant_for(term, m.group(1)))
    for m in _NOT_DASH_RE.finditer(text):
        v = _variant_for(term, m.group(1))
        if v not in variants:
            variants.append(v)
    for m in _CHANGE_RE.finditer(text):
        variants.append(m.group(1).strip())
        term = m.group(2).strip()
    registered = "®" in term or "registration mark" in text.lower()
    variants = [v for v in variants if v and v.lower() != term.lower().replace("®", "") and len(v) < 60]
    return {"term": term, "variants": variants, "note": text if text != term else "", "registered": registered}


def _split_entries(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        for part in re.split(r"\s{3,}|\t", line):
            if _clean(part):
                out.append(_clean(part))
    return out


# ---------------------------------------------------------------------------
# Spec -> rule matching
# ---------------------------------------------------------------------------
Rule = tuple[int, int]
Matcher = tuple[str, Callable[[str, str], list[Rule] | None], str]


def _has(v: str, *words: str) -> bool:
    lv = v.lower()
    return all(w.lower() in lv for w in words)


def _any(v: str, *words: str) -> bool:
    lv = v.lower()
    return any(w.lower() in lv for w in words)


MATCHERS: list[Matcher] = [
    (r"^percent", lambda l, v: [(6, 1)] if "%" in v and _any(v, "symbol", "%") else [(6, 3)], "25% with a number; percentage without"),
    (r"^statistic", lambda l, v: [(25, 4 if _any(v, "zero before", "0.05") and not _any(v, "no zero") else (2 if re.search(r"\bP values|uppercase", v) else 1))],
     "p values"),
    (r"^dosage", lambda l, v: [(108, 1)] if re.search(r"\b(?:PO|BID|TID|QID)\b", v) else None, "dosage abbreviations"),
    (r"^time$", lambda l, v: [(19, 1 if "a.m." in v else (4 if re.search(r"\bAM\b", v) else 3))], "time of day"),
    (r"^patent", lambda l, v: [(43, 1 if _any(v, "omit", "only use", "should be omitted") else 3), (44, 1)], "® ™ © symbols"),
    (r"greater than|less than", lambda l, v: [(7, 4)] if _any(v, "use the greater than", "symbols") else [(7, 1)], "> and < symbols"),
    (r"^avoid these", lambda l, v: ([(9, 2)] if "mcg" in v else []) + ([(3, 1)] if _any(v, "space between numbers") else [])
     + ([(8, 2)] if _any(v, "write out alpha") else []), "units to avoid"),
    (r"^temperature", lambda l, v: [(5, 2 if re.search(r"\d°[CF]", v) else 1)], "temperature"),
    (r"^thousand", lambda l, v: [(11, 1 if "1,234" in v or "," in v else 3)], "thousands separator"),
    (r"number ranges|^ranges", lambda l, v: [(14, 2 if re.search(r"\bin text,?\s*\d+\s+to\s+\d+", v) else 1)], "ranges"),
    (r"^number style", lambda l, v: [(13, 1 if _any(v, "below 10", "under 10", "one to nine") else 2)], "numbers"),
    (r"^name suffix", lambda l, v: [(107, 1 if not re.search(r",\s*(?:III|Jr)", v) else 2)], "name suffixes"),
    (r"^series", lambda l, v: [(106, 1 if _any(v, "arabic") else 2)], "series"),
    (r"^plural numbers", lambda l, v: [(105, 1 if _any(v, "no apostrophe") else 2)], "plural numbers"),
    (r"^number sign", lambda l, v: [(104, 1)] if "No." in v else None, "No. for number"),
    (r"abbreviations?|acronyms?", lambda l, v: [(31, 1), (34, 1), (81, 1)], "first-mention definitions"),
    (r"heading capitali", lambda l, v: [(70, 4 if _any(l + v, "4 letters", "four letters", "verbs") else 2)], "heading case"),
    (r"^emphasis", lambda l, v: [(123, 1)], "italics for emphasis"),
    (r"in-text lists", lambda l, v: [(117, 1)] if re.search(r"\([a-c]\)", v) else None, "(a), (b) lists"),
    (r"^urls in main", lambda l, v: [(109, 1)] if _any(v, "http") else None, "URLs"),
    (r"compound words in headings", lambda l, v: [(70, 4)], "Self-Report in headings"),
    (r"^latin", lambda l, v: [(35, 3 if _any(v, "spell out") else 1)], "i.e., e.g., etc."),
    (r"^headings$", lambda l, v: [(119, 1), (68, 1)], "headings"),
    (r"^capitalization", lambda l, v: [(103, 1)] if _any(v, "colon") else None, "capital after colon"),
    (r"^lists$", lambda l, v: [(118, 1)], "list punctuation"),
    (r"we discuss", lambda l, v: [(111, 1)], "present tense"),
    (r"edition numbers|revised edition", lambda l, v: [(124, 1)], "Seventh Edition, roman"),
    (r"^hyphenation", lambda l, v: [(102, 1)], "compound hyphenation"),
    (r"^commas", lambda l, v: [(99, 1)] if _any(v, "series comma", "serial comma") else None, "serial comma"),
    (r"^parentheses", lambda l, v: [(100, 1)], "nested parentheses"),
    (r"^en dashes", lambda l, v: [(101, 1)], "en dash compounds"),
    (r"^ampersand", lambda l, v: [(98, 1)], "and, not &"),
    (r"^ellipsis", lambda l, v: [(92, 1)] if _any(v, "character") else [(92, 2)], "ellipsis"),
    (r"biological nomenclature", lambda l, v: [(36, 4 if re.search(r"\b[A-Z] [a-z]{3,}", v) else 2)], "genus abbreviation"),
    (r"ical.*ic|ic.*ical", lambda l, v: [(40, 1 if _any(v, "shorter form", "ic” form is preferred", "ic form is preferred") else 2)], "-ic endings"),
    (r"^greek", lambda l, v: [(8, 2 if _any(v, "spell out") else 1)] + ([(9, 2)] if "mcg" in v else []), "Greek letters"),
    (r"^eponym", lambda l, v: [(93, 1 if _any(v, "nonpossessive") else 2)], "eponyms"),
    (r"-ly", lambda l, v: [(102, 1)], "-ly adverbs"),
    (r"^drug names", lambda l, v: [(39, 1)], "drug names"),
    (r"gender-neutral", lambda l, v: [(94, 1)], "singular they"),
    (r"language sensitivity|person-first", lambda l, v: [(95, 1)], "person-first language"),
    (r"^names \(possessives\)|possessive", lambda l, v: [(113, 1)] if "’s" in v or "'s" in v else None, "Rogers's"),
    (r"figure number|figure titles", lambda l, v: [(72, 5), (76, 4), (79, 1)] if _any(v, "period not hyphen") else [(72, 1)], "Figure 1.2"),
    (r"^figure parts", lambda l, v: [(114, 1)] if _any(v, "upper case", "uppercase") else [(114, 2)], "(A), (B)"),
    (r"figure credit|^table source|stock images", lambda l, v: [(115, 1)], "source lines"),
    (r"continue", lambda l, v: [(116, 1)] if "(continued)" in v else None, "(continued)"),
    (r"figure in-text", lambda l, v: [(72, 5)] if _any(v, "spell out word figure") else None, "Figure not Fig."),
    (r"table title|table number", lambda l, v: [(71, 5), (75, 4)] if _any(v, "period not hyphen") else [(71, 1)], "Table 5.4"),
    (r"table footnotes", lambda l, v: [(78, 1), (81, 1)], "table footnotes"),
    (r"^units$", lambda l, v: [(2, 1), (3, 1)], "unit symbols"),
    (r"words to avoid", lambda l, v: [(96, 1), (94, 1), (97, 1), (46, 2), (112, 1), (95, 1)], "words to avoid"),
    (r"outline format", lambda l, v: [(118, 2)], "outline format"),
    (r"quotation marks", lambda l, v: [(122, 1)], "quotation marks for chapter titles"),
    (r"quoted material", lambda l, v: [(125, 1)], "quoted material / DSM permissions"),
    (r"copyright", lambda l, v: [(44, 1)], "copyright year flip"),
    (r"degrees and salutations", lambda l, v: [(124, 1)], "degrees without periods"),
    (r"special words", lambda l, v: [(94, 1)], "gender-neutral Latinx and special terms"),
    (r"model/program/theory names", lambda l, v: [], "lowercase model names"),
    (r"tests/scales", lambda l, v: [], "tests and scales in roman"),
    (r"layout/design", lambda l, v: [], "running heads orientation"),
    (r"full-page figures|artwork", lambda l, v: [(72, 5)], "figures formatting"),
    (r"full-spread tables|full-page tables|table column and row heads", lambda l, v: [(71, 5)], "tables formatting"),
    (r"book front matter|book back matter|chapter front matter|chapter back matter|chapter opener", lambda l, v: [], "matter structure"),
    (r"half-title|p\. ii|dedication|contents|contributor list|preface", lambda l, v: [], "front matter elements"),
]


def match_spec(section: str, label: str, value: str) -> list[dict]:
    hits: list[dict] = []
    lab = label.lower().strip()
    for pat, fn, note in MATCHERS:
        if not re.search(pat, lab):
            continue
        try:
            rules = fn(label, value) or []
        except Exception:
            rules = []
        for sno, option in rules:
            hits.append({"sno": sno, "option": option, "note": note})
    return hits


# ---------------------------------------------------------------------------
# Profile list extraction
# ---------------------------------------------------------------------------
_AVOID_DEFAULTS = {
    "whilst": "while",
    "amidst": "amid",
    "firstly": "first",
    "towards": "toward",
    "learnt": "learned",
    "amongst": "among",
    "sufferer": "patient",
    "victim": "patient",
    "he/she": "they",
    "the elderly": "older adults",
    "elderly": "older adults",
    "the poor": "people living in poverty",
    "an epileptic": "a person with epilepsy",
    "a diabetic": "a person with diabetes",
    "diabetic": "patient with diabetes",
    "epileptic": "patient with epilepsy",
    "wheelchair-bound": "who uses a wheelchair",
    "cc": "mL",
    "μg": "mcg",
    "upto": "up to",
    "ipad": "tablet",
    "iphone": "smartphone",
    "ipod": "MP3 player",
    "kindle": "e-reader",
    "amazon": "online retailer",
    "this article": "this chapter",
    "this paper": "this chapter",
    "submission": "chapter",
}


def _parse_acronyms(lines: list[str]) -> list[str]:
    text = " ".join(lines)
    text = text.split("If a book uses an acronym")[0]
    text = re.sub(r"\([^)]*\)", lambda m: " " + ", ".join(re.findall(r"\b[A-Z][A-Za-z]{1,4}\b", m.group(0))) + " "
                  if "degrees" in m.group(0) else " ", text)
    out = []
    for tok in re.split(r"[,;]\s*|\s{2,}", text):
        tok = tok.strip(" .")
        tok = tok.split(" ")[0] if " " in tok and re.match(r"[A-Z]{2,}", tok) else tok
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9+\-/]{0,12}", tok) and sum(c.isupper() for c in tok) >= 1 and tok not in out:
            if tok.lower() in ("and", "academic", "degrees", "etc", "note", "do", "not", "use"):
                continue
            out.append(tok)
    for extra in ("OB/GYN",):
        if extra in text and extra not in out:
            out.append(extra)
    return out


def _parse_org_and_ic(lines: list[str]) -> tuple[list[dict], dict, list[str]]:
    orgs: list[dict] = []
    ic: dict[str, str] = {}
    keep_both: list[str] = []
    mode = None
    for line in lines:
        low = line.lower()
        if "organization names" in low:
            mode = "org"
            continue
        if "same meaning" in low:
            mode = "ic"
            continue
        if "different meanings" in low:
            mode = "diff"
            continue
        if "no corresponding" in low:
            mode = "ical_only"
            continue
        if mode == "ic":
            m = re.match(r"([A-Za-z]+ic)\s*/\s*([A-Za-z]+ical)\b", line)
            if m:
                ic[m.group(2).lower()] = m.group(1).lower()
        elif mode == "diff":
            m = re.match(r"([A-Za-z]+ic)\s*/\s*([A-Za-z]+ical)\b", line)
            if m:
                keep_both += [m.group(1).lower(), m.group(2).lower()]
        elif mode == "org":
            entry = parse_word_entry(line)
            name = entry["term"]
            for v in entry["variants"]:
                orgs.append({"find": v, "replace": name, "note": entry["note"]})
            m = re.search(r"\bno longer\s+([^()\[]+?)\s*[\[(]", line)
            if m:
                orgs.append({"find": m.group(1).strip(), "replace": name, "note": entry["note"]})
            m = re.search(r"NOT\s+([A-Z][\w ]+?)(?:\s*\(|$)", line)
            if m:
                orgs.append({"find": m.group(1).strip(), "replace": name, "note": entry["note"]})
    return orgs, ic, keep_both


def _parse_unit_style(time_value: str, units_value: str) -> dict:
    style: dict[str, Any] = {}
    if _any(time_value, "write out terms", "write out"):
        style["time_in_text"] = "spelled"
    m = re.search(r"abbreviations?:\s*([a-z ,]+)", time_value, re.IGNORECASE)
    if m:
        names = {"sec": "second", "s": "second", "min": "minute", "hr": "hour", "h": "hour", "d": "day",
                 "wk": "week", "y": "year", "yr": "year", "mo": "month"}
        abbrevs = {}
        for tok in re.split(r"[,\s]+", m.group(1)):
            tok = tok.strip().lower()
            if tok in names and names[tok] not in abbrevs:
                abbrevs[names[tok]] = tok
        if abbrevs:
            style["abbreviations"] = abbrevs
    if "mmHg" in units_value:
        style["pressure"] = "mmHg"
    return style


def parse_sectioned(doc) -> dict:
    specs: list[dict] = []
    word_entries: list[dict] = []
    section = ""
    last: dict | None = None
    table0 = doc.tables[0] if doc.tables else None
    if table0 is not None:
        for idx, row in enumerate(table0.rows):
            cells = _unique_cells(row)
            texts = [_clean(c.text) for c in cells]
            header = _is_section_header(texts)
            if header:
                section = header
                last = None
                continue
            label = texts[0] if texts else ""
            value_lines: list[str] = []
            for c in cells[1:]:
                value_lines += _cell_lines(c)
            if not label and not value_lines:
                continue
            if section.upper().startswith("WORD LIST") and not label and last is None:
                word_entries += [parse_word_entry(e) for e in _split_entries(value_lines)]
                continue
            if label.upper() in ("TEXT STYLE", "ILLUSTRATIONS", "TABLES") and not value_lines:
                section = label
                continue
            if not label and last is not None:
                last["lines"] += value_lines
                last["value"] = " / ".join(last["lines"])
                continue
            label_lines = _cell_lines(cells[0]) if cells else []
            last = {"row": idx, "section": section, "label": " ".join(label_lines) or label,
                    "lines": value_lines, "value": " / ".join(value_lines)}
            specs.append(last)

    index_rules: list[str] = []
    red_flag_rules: list[dict] = []
    heading_examples: list[dict] = []
    bullet_examples: list[dict] = []

    for tbl in (doc.tables[1:] if doc.tables else []):
        if not tbl.rows or not tbl.rows[0].cells:
            continue
        first_cell = _clean(tbl.rows[0].cells[0].text).lower()
        all_head = " ".join(_clean(c.text) for r in tbl.rows[:2] for c in r.cells).lower()
        if "index" in first_cell:
            for r in tbl.rows:
                for c in _unique_cells(r)[1:2] + _unique_cells(r)[:1]:
                    index_rules += _cell_lines(c)
        elif "reference" in first_cell or ("reference" in all_head and "cross-reference" not in all_head):
            for r in tbl.rows:
                cells = _unique_cells(r)
                texts = [_clean(c.text) for c in cells]
                if not texts or not texts[0]:
                    continue
                label = texts[0].lower()
                val = " / ".join(texts[1:])
                if "red flag" in label:
                    for line in val.split(". "):
                        line_clean = line.strip(" .")
                        if "campinha-bacote" in line_clean.lower():
                            red_flag_rules.append({
                                "pattern": r"\b(?:J\.\s*)?Campinha[- ]Bacote\b",
                                "message": "J. Campinha-Bacote: flag all references and mentions of Campinha-Bacote."
                            })
                            red_flag_rules.append({
                                "pattern": r"\bASKED\s+model\b",
                                "message": "ASKED model: flag all mentions of the ASKED model of Campinha-Bacote."
                            })
                        if "diagnostic and statistical manual" in line_clean.lower() or "dsm" in line_clean.lower():
                            red_flag_rules.append({
                                "pattern": r"\bDiagnostic and Statistical Manual(?: of Mental Disorders)?\b",
                                "message": "DSM: flag all direct quotations from any edition of the DSM for permissions/accuracy."
                            })
                        if "wikipedia" in line_clean.lower():
                            red_flag_rules.append({
                                "pattern": r"\b(?:Wikipedia|Wikimedia)\b",
                                "message": "Wikipedia/Wikimedia: reference sources from Wikipedia should be avoided; query author for alternate."
                            })
        elif "original" in all_head or "improved" in all_head or "<h1" in all_head:
            for r in tbl.rows:
                cells = _unique_cells(r)
                if len(cells) >= 2:
                    orig = _clean(cells[0].text)
                    if orig and orig.lower() not in ("original", "examples"):
                        heading_examples.append({"original": orig, "improved": _clean(cells[1].text)})
        elif "incorrect" in all_head or "stubs" in all_head or "comments" in all_head:
            for r in tbl.rows:
                cells = _unique_cells(r)
                if len(cells) >= 2:
                    inc = _clean(cells[0].text)
                    if inc and inc.lower() not in ("incorrect", "examples"):
                        bullet_examples.append({"incorrect": inc, "correct": _clean(cells[1].text),
                                                 "comment": _clean(cells[2].text) if len(cells) > 2 else ""})
    appendix: list[str] = []
    in_appendix = False
    for p in doc.paragraphs:
        t = _clean(p.text)
        if not t:
            continue
        if t.lower().startswith("appendix"):
            in_appendix = True
            continue
        if in_appendix:
            appendix.append(t)

    # Rules from specs
    rules: dict[str, dict] = {}
    unresolved: list[dict] = []
    for s in specs:
        hits = match_spec(s["section"], s["label"], s["value"])
        label_short = re.sub(r"\s+", " ", s["label"]).strip()[:80]
        source_label = f"{s['section'].title()} › {label_short}" if s["section"] else label_short
        if not hits:
            unresolved.append({"row": s["row"], "section": s["section"], "label": label_short,
                               "value": s["value"][:300]})
        for h in hits:
            key = str(h["sno"])
            if key in rules and rules[key]["option"] == h["option"]:
                continue
            rules[key] = {"sno": h["sno"], "option": h["option"], "enabled": True, "confidence": 0.95,
                          "source_label": source_label, "source_value": s["value"][:300],
                          "explanation": f"Row {s['row']}: {h['note']} → option {h['option']}"}
    if appendix:
        joined = " ".join(appendix).lower()
        if "headings" in joined:
            rules.setdefault("119", {"sno": 119, "option": 1, "enabled": True, "confidence": 0.9,
                                     "source_label": "Appendix › Headings", "source_value": "Headings—Technical Considerations",
                                     "explanation": "Appendix: avoid ?, :, parentheticals; 3+ H1s"})
            rules.setdefault("68", {"sno": 68, "option": 1, "enabled": True, "confidence": 0.9,
                                    "source_label": "Appendix › Headings", "source_value": "Avoid super heads",
                                    "explanation": "Appendix: no super heads"})
        if "bullet" in joined:
            rules.setdefault("120", {"sno": 120, "option": 1, "enabled": True, "confidence": 0.9,
                                     "source_label": "Appendix › Bulleted Lists", "source_value": "Minimize bullet levels",
                                     "explanation": "Appendix: two bullet levels; capitalise after stub colon"})
        if "questions and rationales" in joined:
            rules.setdefault("121", {"sno": 121, "option": 1, "enabled": False, "confidence": 0.9,
                                     "source_label": "Appendix › Questions and Rationales",
                                     "source_value": "MCQ style points (Q&A / Exam Prep content)",
                                     "explanation": "MCQ rules: switched on for Q&A books"})
            red_flag_rules.extend([
                {
                    "pattern": r"(?i)\b(?:in-text\s+citations\s+address|the\s+text\s+explains|thus,\s*[A-D]\s+is\s+the\s+only\s+correct\s+answer)\b",
                    "message": "AI-generated rationale phrasing detected; rationales must explain WHY the answer is correct.",
                },
                {
                    "pattern": r"_{3,}",
                    "message": "Fill-in-the-blank style stems with underlines are prohibited in MCQs.",
                },
                {
                    "pattern": r"(?i)\b(?:Both\s+[A-D]\s+and\s+[A-D]|None\s+of\s+the\s+above|All\s+of\s+the\s+above)\b",
                    "message": "Prohibited MCQ option phrasing ('Both A and B', 'None of the above', 'All of the above').",
                },
            ])
    if red_flag_rules:
        rules.setdefault("125", {"sno": 125, "option": 1, "enabled": True, "confidence": 0.95,
                                 "source_label": "References › Red Flags",
                                 "source_value": "Editorial Red Flags",
                                 "explanation": "Flag Campinha-Bacote, ASKED model, DSM direct quotes, Wikipedia, etc."})

    by_label = {re.sub(r"\s+", " ", s["label"]).lower(): s for s in specs}

    def _spec(prefix: str) -> dict | None:
        return next((s for k, s in by_label.items() if k.startswith(prefix)), None)

    # Profile lists
    word_list = [e["term"] for e in word_entries if e["term"]]
    replacements: list[dict] = []
    registered: list[str] = []
    for e in word_entries:
        term_plain = e["term"].split("®")[0].strip() if e["registered"] else e["term"]
        for v in e["variants"]:
            replacements.append({"find": v, "replace": e["term"].replace("®", "").strip() or e["term"], "note": e["note"]})
        if e["registered"] and "®" in e["term"]:
            registered.append(term_plain)
    acr_spec = _spec("acronyms that do not need")
    acronyms = _parse_acronyms(acr_spec["lines"]) if acr_spec else []
    ic_spec = next((s for s in specs if "ical" in s["label"].lower() or "organization names" in s["label"].lower()), None)
    orgs, ic, keep_both = _parse_org_and_ic(ic_spec["lines"]) if ic_spec else ([], {}, [])
    avoid_spec = _spec("words to avoid")
    avoid: dict[str, str] = {}
    if avoid_spec:
        joined_avoid = " ".join(avoid_spec["lines"]).lower()
        for k, v in _AVOID_DEFAULTS.items():
            if k in joined_avoid:
                avoid[k] = v
        if "physical references" in joined_avoid or "physical" in joined_avoid:
            rules.setdefault("97", {"sno": 97, "option": 1, "enabled": True, "confidence": 0.95,
                                    "source_label": "Words to avoid", "source_value": "Physical references must be avoided",
                                    "explanation": "above/below → query"})
        if "apple" in joined_avoid or "ipad" in joined_avoid:
            rules.setdefault("46", {"sno": 46, "option": 2, "enabled": True, "confidence": 0.95,
                                    "source_label": "Words to avoid", "source_value": "iPad becomes tablet",
                                    "explanation": "generic product terms"})
        if "article" in joined_avoid and "chapter" in joined_avoid:
            rules.setdefault("112", {"sno": 112, "option": 1, "enabled": True, "confidence": 0.95,
                                     "source_label": "Words to avoid", "source_value": "use chapter instead",
                                     "explanation": "article/paper → chapter"})
        if "he/she" in joined_avoid:
            rules.setdefault("94", {"sno": 94, "option": 1, "enabled": True, "confidence": 0.95,
                                     "source_label": "Words to avoid", "source_value": "Avoid he/she",
                                     "explanation": "singular they"})

    meas_avoid = _spec("avoid these")
    if meas_avoid:
        joined_meas = " ".join(meas_avoid["lines"]).lower()
        for k in ("cc", "μg"):
            if k in joined_meas and k in _AVOID_DEFAULTS:
                avoid[k] = _AVOID_DEFAULTS[k]

    lang_spec = next((s for s in specs if "language sensitivity" in s["label"].lower()), None)
    if lang_spec:
        joined_lang = " ".join(lang_spec["lines"]).lower()
        for k in ("the elderly", "the poor", "an epileptic", "a diabetic", "wheelchair-bound"):
            if k in joined_lang and k in _AVOID_DEFAULTS:
                avoid[k] = _AVOID_DEFAULTS[k]

    gender_spec = next((s for s in specs if "gender-neutral" in s["label"].lower()), None)
    if gender_spec:
        avoid.setdefault("he/she", "they")

    time_spec, units_spec = _spec("time"), _spec("units")
    unit_style = _parse_unit_style(time_spec["value"] if time_spec else "", units_spec["value"] if units_spec else "")
    patent = _spec("patent")
    if patent:
        for name in re.findall(r"\b(NCLEX-RN|NCLEX|CNE)\b(?=\s+exam)", patent["value"]):
            if name not in registered:
                registered.append(name)

    title = next((_clean(p.text) for p in doc.paragraphs[:5] if _clean(p.text)), "Style Sheet")
    return {
        "title": title,
        "specs": [{k: v for k, v in s.items() if k != "lines"} for s in specs],
        "rules": rules,
        "unresolved": unresolved,
        "profile": {
            "word_list": word_list,
            "word_replacements": replacements,
            "registered_terms": registered,
            "acronyms_no_spellout": acronyms,
            "org_names": orgs,
            "ic_preferred": ic,
            "ic_keep_both": keep_both,
            "avoid_words": avoid,
            "unit_style": unit_style,
            "red_flags": red_flag_rules,
            "structural_guidelines": {
                "index": index_rules,
                "appendix": appendix,
                "headings_examples": heading_examples,
                "bullet_examples": bullet_examples,
            },
        },
    }
