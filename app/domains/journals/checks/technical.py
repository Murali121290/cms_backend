"""Pre-Editing step 4: technical check, driven by the journal style sheet (style_rules).

Units, percentages and ranges are left to the IA rules step when the journal's IA selection
covers them, so the same text is not flagged twice.

Rules and the style_rules keys that control them (defaults in brackets):
  JT-FIG    figure_callout ["Figure"]: "Fig. 1" vs "Figure 1" in running text
  JT-UNIT   units_thin_space [true]: 10ms -> 10 ms (thin space)
  JT-PCT    percent_symbol [true]: 27 percent -> 27%
  JT-RANGE  en_dash_ranges [true]: 10-20 -> 10–20
  JT-EQ     equation_numbering ["consecutive"]: display equations numbered (1), (2), … (error)
  JT-CITE   figures/tables that are never mentioned in the text (warning)
  JT-KWD    keywords.min / keywords.max [none]: keyword count
"""
import re
from typing import List

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.checks.structuring import active_stylesheet
from app.domains.journals.manuscript import load_blocks, resolve_manuscript_path, snippet

RULES = ("JT-FIG", "JT-UNIT", "JT-PCT", "JT-RANGE", "JT-EQ", "JT-CITE", "JT-KWD")
TEXT_SKIP = {"References", "Reference Heading", "Front Matter", "Authors", "Affiliation", "Keywords",
             "Table Body", "Table Column Header"}
CAPTION_CATEGORIES = {"Figure Caption", "Table Title", "Caption"}
UNIT = r"(mm|cm|km|mg|kg|µg|μg|ng|ml|mL|ms|min|Hz|kHz|MHz|GHz|kDa|µm|μm|nm|mmHg|mmol|µmol|μmol|°C)"
_UNIT_NOSPACE = re.compile(rf"(?<![\w.])(\d+(?:\.\d+)?){UNIT}\b")
_PERCENT = re.compile(r"\b(\d+(?:\.\d+)?)\s*(percent|per cent)\b", re.I)
_RANGE = re.compile(r"(?<![\w./:-])(\d{1,4})-(\d{1,4})(?![\w./:-])")
_EQ_LABEL = re.compile(r"\((\d+)\)\s*$")
_FIG_REF = re.compile(r"\b(Figures?|Figs?\.)\s*(\d+)", re.I)
_TAB_REF = re.compile(r"\bTables?\s*(\d+)", re.I)


def _loc(b, start=None, end=None, surface=None):
    loc = {"block_id": b.block_id, "para_idx": b.idx}
    if start is not None:
        loc.update(start=start, end=end, surface=surface)
    return loc


@register
class TechnicalCheck(JournalCheck):
    key = "technical"
    name = "Technical editing"

    def run(self, article, db) -> CheckResult:
        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        sheet = active_stylesheet(db, article)
        rules = (sheet.style_rules if sheet else None) or {}
        callout = rules.get("figure_callout", "Figure")
        from app.domains.journals.checks.ia_rules import selected_elements
        ia = {e.lower() for e in selected_elements(db, article)}
        ia_units = any("unit" in e for e in ia)
        ia_percent = any("percent" in e for e in ia)
        ia_ranges = any("range" in e for e in ia)
        blocks = load_blocks(path)
        issues: List[IssueDraft] = []

        in_refs = False
        figure_captions, table_captions = {}, {}
        mentioned_figs, mentioned_tabs = set(), set()
        eq_labels = []  # (label, block, start)

        for b in blocks:
            if not b.text:
                continue
            if b.category == "Reference Heading" or b.text.strip().rstrip(":").lower() in ("references", "bibliography"):
                in_refs = True
            if in_refs:
                continue
            is_caption = b.category in CAPTION_CATEGORIES or re.match(r"^(Figure|Fig\.|Table)\s*\d+[.:]", b.text)
            if is_caption:
                m = re.match(r"^(Figure|Fig\.)\s*(\d+)", b.text, re.I)
                if m:
                    figure_captions.setdefault(int(m.group(2)), b)
                m = re.match(r"^Table\s*(\d+)", b.text, re.I)
                if m:
                    table_captions.setdefault(int(m.group(1)), b)
            if b.category == "Equation" or (_EQ_LABEL.search(b.text) and len(b.text) < 160 and b.category not in TEXT_SKIP
                                            and not is_caption and b.category != "Body Text"):
                m = _EQ_LABEL.search(b.text)
                if m:
                    eq_labels.append((int(m.group(1)), b, m.start(1) - 1))
            if b.category in TEXT_SKIP or b.in_table:
                continue

            if not is_caption:
                for m in _FIG_REF.finditer(b.text):
                    mentioned_figs.add(int(m.group(2)))
                    word = m.group(1)
                    if callout == "Figure" and word.lower().startswith("fig."):
                        want = f"Figure{'s' if word.lower() == 'figs.' else ''} {m.group(2)}"
                    elif callout == "Fig." and word.lower().startswith("figure"):
                        want = f"Fig{'s' if word.lower() == 'figures' else ''}. {m.group(2)}"
                    else:
                        continue
                    issues.append(IssueDraft(
                        rule_id="JT-FIG", severity="warning", title=f"Write “{want}” in running text",
                        message=f"The style sheet uses “{callout} N” for figure callouts.",
                        location=_loc(b, m.start(), m.end(), m.group(0)), context_snippet=snippet(b.text, m.start(), m.end() - m.start()),
                        suggestion={"type": "replace", "from": m.group(0), "to": want}, fingerprint=f"JT-FIG:{b.block_id}:{m.start()}",
                    ))
                for m in _TAB_REF.finditer(b.text):
                    mentioned_tabs.add(int(m.group(1)))

            if rules.get("units_thin_space", True) and not ia_units:
                for m in _UNIT_NOSPACE.finditer(b.text):
                    want = f"{m.group(1)} {m.group(2)}"
                    issues.append(IssueDraft(
                        rule_id="JT-UNIT", severity="warning", title=f"Space between number and unit: “{m.group(1)} {m.group(2)}”",
                        message="Put a thin space between a value and its unit.",
                        location=_loc(b, m.start(), m.end(), m.group(0)), context_snippet=snippet(b.text, m.start(), m.end() - m.start()),
                        suggestion={"type": "replace", "from": m.group(0), "to": want}, fingerprint=f"JT-UNIT:{b.block_id}:{m.start()}",
                    ))
            if rules.get("percent_symbol", True) and not ia_percent:
                for m in _PERCENT.finditer(b.text):
                    want = f"{m.group(1)}%"
                    issues.append(IssueDraft(
                        rule_id="JT-PCT", severity="info", title=f"Use “{want}”",
                        message="Write percentages with the % symbol after a numeral.",
                        location=_loc(b, m.start(), m.end(), m.group(0)), context_snippet=snippet(b.text, m.start(), m.end() - m.start()),
                        suggestion={"type": "replace", "from": m.group(0), "to": want}, fingerprint=f"JT-PCT:{b.block_id}:{m.start()}",
                    ))
            if rules.get("en_dash_ranges", True) and not ia_ranges:
                for m in _RANGE.finditer(b.text):
                    a, z = int(m.group(1)), int(m.group(2))
                    if z <= a and not (a >= 1000 and z < 100):  # "2019-20" is a range; "12-3" is probably not
                        continue
                    want = f"{m.group(1)}–{m.group(2)}"
                    issues.append(IssueDraft(
                        rule_id="JT-RANGE", severity="info", title=f"Use an en dash in the range “{want}”",
                        message="Number ranges take an en dash (–), not a hyphen.",
                        location=_loc(b, m.start(), m.end(), m.group(0)), context_snippet=snippet(b.text, m.start(), m.end() - m.start()),
                        suggestion={"type": "replace", "from": m.group(0), "to": want}, fingerprint=f"JT-RANGE:{b.block_id}:{m.start()}",
                    ))

        for b in blocks:
            if b.category == "Keywords" or re.match(r"^\s*key\s*-?words?\b", b.text, re.I):
                kw = [k for k in re.split(r"[;,]", re.sub(r"^\s*key\s*-?words?[.:]?\s*", "", b.text, flags=re.I)) if k.strip()]
                lo, hi = (rules.get("keywords") or {}).get("min"), (rules.get("keywords") or {}).get("max")
                if (lo and len(kw) < lo) or (hi and len(kw) > hi):
                    issues.append(IssueDraft(
                        rule_id="JT-KWD", severity="warning", title=f"{len(kw)} keywords (the journal asks for {lo or 0}–{hi or '∞'})",
                        message="Add or remove keywords, or query the author.", location=_loc(b),
                        context_snippet=snippet(b.text, 0, 0, 80), fingerprint="JT-KWD"))
                break

        if rules.get("equation_numbering", "consecutive") == "consecutive":
            expected = 1
            for label, b, start in eq_labels:
                if label != expected:
                    issues.append(IssueDraft(
                        rule_id="JT-EQ", severity="error",
                        title=f"Equation numbered ({label}); expected ({expected})",
                        message="Display equations are numbered consecutively. The JATS equation IDs come from these labels.",
                        location=_loc(b, start, start + len(str(label)) + 2, f"({label})"),
                        context_snippet=snippet(b.text, start, len(str(label)) + 2),
                        suggestion={"type": "replace", "from": f"({label})", "to": f"({expected})"},
                        fingerprint=f"JT-EQ:{b.block_id}:{label}",
                    ))
                expected += 1

        for kind, captions, mentioned in (("Figure", figure_captions, mentioned_figs), ("Table", table_captions, mentioned_tabs)):
            for n, b in sorted(captions.items()):
                if n not in mentioned:
                    issues.append(IssueDraft(
                        rule_id="JT-CITE", severity="warning", title=f"{kind} {n} is never mentioned in the text",
                        message=f"Cite {kind.lower()} {n} in the text before it appears, or query the author.",
                        location=_loc(b), context_snippet=snippet(b.text, 0, 0, 80), fingerprint=f"JT-CITE:{kind}:{n}"))

        return CheckResult(issues=issues, rules_total=len(RULES), rule_set_version=sheet.name if sheet else "Default technical rules")
