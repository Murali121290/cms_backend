"""Stage 2 (Language Editing) check: the language_editing engine driven by the journal's grammar sheet.

The US or UK base profile (app/processing/language_editing/config/profiles) supplies
grammar/spelling rules and its variant dictionary. The journal grammar sheet adds:
  - terms: [{"find", "replace", "note"}]   preferred terms (single words go into the dictionary)
  - serial_comma, data_plural, concise, spell_out_numbers: on/off switches (default on)
"""
import json
import os
import re
from typing import Dict, List

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.manuscript import heading_level, load_blocks, resolve_manuscript_path, snippet
from app.domains.journals.models import JournalGrammarsheet

PROFILE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "processing", "language_editing", "config", "profiles")
SKIP_CATEGORIES = {"References", "Reference Heading", "Front Matter", "Authors", "Affiliation", "Equation",
                   "Table Body", "Table Column Header", "Keywords"}
NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
UNITS = r"(?:%|mm|cm|km|m|mg|kg|g|µg|μg|ng|ml|mL|L|ms|s|min|h|Hz|kHz|MHz|nm|µm|μm|mmol|mol|°C|K|kDa|years?|months?|weeks?|days?)"

# Journal switches -> engine regex rules (the engine drops a match whose replacement equals the original)
SWITCH_RULES = {
    "serial_comma": [{"id": "JL-SERIAL", "category": "grammar", "type": "regex",
                      "pattern": r"\b(\w+), (\w+) (and|or) (\w+)\b", "replacement": r"\1, \2, \3 \4",
                      "message": "Use a serial (Oxford) comma before the last item of a list.", "severity": "suggestion"}],
    "data_plural": [{"id": "JL-DATA", "category": "grammar", "type": "regex", "pattern": rf"\b([Dd]ata) {v}\b",
                     "replacement": rf"\1 {p}", "message": "The journal treats “data” as plural.", "severity": "warning"}
                    for v, p in (("is", "are"), ("was", "were"), ("has", "have"))],
    "concise": [{"id": "JL-CONCISE", "category": "sentence", "type": "regex", "pattern": p, "replacement": r,
                 "message": "Prefer the shorter form “to”.", "severity": "suggestion"}
                for p, r in ((r"\bIn order to\b", "To"), (r"\bin order to\b", "to"))],
}


def _profile(variant: str) -> dict:
    name = "uk" if variant.upper().startswith("UK") else "us"
    try:
        with open(os.path.join(PROFILE_DIR, f"{name}.json"), encoding="utf-8") as fh:
            return json.load(fh)
    except OSError:
        return {"rules": [], "variant_to_canonical": {}}


def active_grammarsheet(db, article):
    return db.query(JournalGrammarsheet).filter(
        JournalGrammarsheet.journal_id == article.journal_id, JournalGrammarsheet.is_active == True  # noqa: E712
    ).order_by(JournalGrammarsheet.id.desc()).first()


def build_rules(variant: str, grammar: dict):
    from app.processing.language_editing.rules import load_house_style_from_dict, load_rules_from_dict

    profile = _profile(variant)
    rule_dicts: List[dict] = list(profile.get("rules") or [])
    dictionary: Dict[str, str] = dict(profile.get("variant_to_canonical") or {})
    for key, rds in SWITCH_RULES.items():
        if grammar.get(key, True):
            rule_dicts.extend(rds)
    for i, t in enumerate(grammar.get("terms") or []):
        find, replace = (t.get("find") or "").strip(), (t.get("replace") or "").strip()
        replace = re.sub(r"<[^>]+>", "", replace)  # e.g. "<i>in vitro</i>": the text part; italics are a style matter
        if not find or not replace or find == replace:
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z\-']*", find):
            dictionary[find] = replace
        else:
            rule_dicts.append({"id": f"JL-TERM-{i + 1}", "category": "spelling", "type": "regex",
                               "pattern": rf"\b{re.escape(find)}\b", "replacement": replace.replace("\\", "\\\\"),
                               "message": f"Preferred term: “{replace}”" + (f" ({t['note']})" if t.get("note") else ""),
                               "flags": ["IGNORECASE"], "severity": "suggestion"})
    if dictionary and not any(r.get("type") == "dictionary" for r in rule_dicts):
        rule_dicts.append({"id": "JL-DICT", "category": "spelling", "type": "dictionary", "severity": "warning",
                           "message": "House style spelling"})
    return load_rules_from_dict(rule_dicts), load_house_style_from_dict(dictionary)


@register
class LanguageCheck(JournalCheck):
    key = "language"
    name = "Language editing"

    def run(self, article, db) -> CheckResult:
        from app.processing.language_editing.engine import analyze
        from app.processing.language_editing.segmenter import sentences

        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        sheet = active_grammarsheet(db, article)
        grammar = (sheet.grammar_rules if sheet else None) or {}
        variant = sheet.language_variant if sheet else "US_English"
        rules, dictionary = build_rules(variant, grammar)

        issues: List[IssueDraft] = []
        in_refs = False
        for b in load_blocks(path):
            if not b.text or b.in_table:
                continue
            if b.category == "Reference Heading" or b.text.strip().rstrip(":").lower() in ("references", "bibliography"):
                in_refs = True
            if in_refs or b.category in SKIP_CATEGORIES:
                continue
            # Detect Headings (Head1 to Head7 / Heading 1..7) and Captions (FGC, FigureLegend, TT, TableCaption, Caption, etc.)
            is_heading = (
                heading_level(b.category) is not None
                or bool(re.match(r"^(Head\d|Heading\s*\d)$", b.category or "", re.I))
                or bool(re.match(r"^(Head\d|Heading\s*\d)$", b.style or "", re.I))
            )
            is_caption = (
                (b.category or "") in ("FGC", "FigureLegend", "TT", "TableCaption", "Figure Caption", "Table Title", "Caption", "TB-CAP", "FIG-CAP")
                or (b.style or "") in ("FGC", "ArticleTitle", "ArticleType","FigureLegend", "TT", "TableCaption", "Figure Caption", "Table Title", "Caption", "TB-CAP", "FIG-CAP")
            )

            for f in analyze(b.text, rules, dictionary, sentences(b.text)):
                msg_lower = (f.message or "").lower()

                # Rule 1: Ignore "Sentence may be missing terminal punctuation" on Headings (Head1-Head7) and Captions (FGC, FigureLegend, TT, TableCaption)
                if (is_heading or is_caption) and ("missing terminal punctuation" in msg_lower or f.rule_id == "terminal_punctuation"):
                    continue

                # Rule 2: Ignore "Sentence should start with a capital letter" and "Add a space after punctuation" on URLs and Initials
                if "start with a capital letter" in msg_lower or f.rule_id == "start_capital" or "space after punctuation" in msg_lower or f.rule_id == "GP003":
                    ctx = b.text[max(0, f.start - 15):min(len(b.text), f.end + 25)]
                    # Check for URL / DOI / Email
                    is_url = bool(re.search(r"https?://|www\.|doi\.org|10\.\d{4,9}/|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|://|doi\:", ctx, re.I))
                    # Check for Initials / Abbreviations (e.g. J.K., A.B., Smith, J., e.g., i.e., et al., vol., p., etc.)
                    is_initials = bool(re.search(r"\b[A-Z]\.(?:[A-Z]\.)*|\b[A-Z]\.,|\b(?:e\.g\.|i\.e\.|vs\.|et al\.|vol\.|no\.|p\.|pp\.|ref\.|fig\.|eq\.|dr\.|prof\.|mr\.|mrs\.|ms\.)\b", ctx, re.I))
                    if is_url or is_initials:
                        continue

                suggestion = f.suggestion
                if f.original[:1].isupper() and suggestion[:1].islower():
                    suggestion = suggestion[:1].upper() + suggestion[1:]  # "In order to" -> "To", not "to"
                severity = {"error": "warning", "warning": "warning"}.get(f.severity, "info")  # language never blocks a stage
                issues.append(IssueDraft(
                    rule_id=f.rule_id, severity=severity, title=f.message or f"{f.original} → {suggestion}",
                    message=f"“{f.original}” → “{suggestion}”" if suggestion != f.original else f.message,
                    location={"block_id": b.block_id, "para_idx": b.idx, "start": f.start, "end": f.end, "surface": f.original},
                    context_snippet=snippet(b.text, f.start, f.end - f.start),
                    suggestion={"type": "replace", "from": f.original, "to": suggestion} if suggestion != f.original else None,
                    fingerprint=f"{f.rule_id}:{b.block_id}:{f.start}:{f.original}"[:255],
                ))
            if grammar.get("spell_out_numbers", True):
                for m in re.finditer(rf"(?<![\d.,])\b([1-9])\b(?![.,]\d)(?!\s?{UNITS}\b)", b.text):
                    if re.search(r"(Figure|Fig\.|Table|Section|Eq\.?|\(|\[)\s*$", b.text[:m.start()]):
                        continue  # "Figure 2", "(3)", "[4]"
                    word = NUMBER_WORDS[int(m.group(1)) - 1]
                    issues.append(IssueDraft(
                        rule_id="JL-NUM", severity="info", title=f"Spell out {m.group(1)} as “{word}”",
                        message="Numbers one to nine are spelled out in running text, except with units.",
                        location={"block_id": b.block_id, "para_idx": b.idx, "start": m.start(), "end": m.end(), "surface": m.group(1)},
                        context_snippet=snippet(b.text, m.start(), 1),
                        suggestion={"type": "replace", "from": m.group(1), "to": word},
                        fingerprint=f"JL-NUM:{b.block_id}:{m.start()}",
                    ))
        return CheckResult(issues=issues, rules_total=len(rules) + 1,
                           rule_set_version=(sheet.name if sheet else f"{variant} (default profile)"))
