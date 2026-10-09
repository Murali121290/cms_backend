"""
Rule engine for Ninja Inkflow Language Editing.
Applies rules to text and returns findings for human review.
The engine NEVER mutates the source text during analysis.
"""
import re
from typing import Any
from .rules import Finding, Rule
from .sentence_checks import FUNCTIONS


def _match_case(src: str, canon: str) -> str:
    """Preserves capitalization pattern of src onto canonical string."""
    if src.isupper():
        return canon.upper()
    if src[:1].isupper():
        return canon[:1].upper() + canon[1:]
    return canon


def run_regex_rule(rule: Rule, text: str) -> list[Finding]:
    if not rule.rx:
        return []
    out = []
    for m in rule.rx.finditer(text):
        # Guard GP005 against legitimate double words: "that that" and "had had"
        if rule.id == "GP005" and m.group(0).lower() in ("that that", "had had"):
            continue
        sug = m.expand(rule.replacement) if rule.replacement is not None else m.group(0)
        if sug == m.group(0):
            continue
        out.append(Finding(
            rule_id=rule.id,
            category=rule.category,
            start=m.start(),
            end=m.end(),
            original=m.group(0),
            suggestion=sug,
            message=rule.message,
            severity=rule.severity
        ))
    return out


def run_dictionary_rule(rule: Rule, text: str, dictionary: dict[str, str]) -> list[Finding]:
    if not dictionary:
        return []
    out = []
    for m in re.finditer(r"[A-Za-z][A-Za-z\-']*", text):
        w = m.group(0)
        key = w.lower()
        if key in dictionary:
            sug = _match_case(w, dictionary[key])
            if sug != w:
                out.append(Finding(
                    rule_id=rule.id,
                    category="spelling",
                    start=m.start(),
                    end=m.end(),
                    original=w,
                    suggestion=sug,
                    message=f"House style: '{w}' -> '{sug}'.",
                    severity=rule.severity or "suggestion"
                ))
    return out


def run_function_rule(rule: Rule, sents: list[tuple[int, int, str]]) -> list[Finding]:
    if not rule.function or rule.function not in FUNCTIONS:
        return []
    fn = FUNCTIONS[rule.function]
    out = []
    for s, e, sent in sents:
        out.extend(fn(sent, s, rule, rule.params))
    return out


def resolve_overlaps(findings: list[Finding]) -> list[Finding]:
    """Keep highest-severity non-overlapping set of findings (deterministic)."""
    severity_order = {"error": 0, "warning": 1, "suggestion": 2}
    kept: list[Finding] = []
    last_end = -1

    # Sort by start offset ascending, then highest severity, then shortest span
    sorted_findings = sorted(
        findings,
        key=lambda f: (f.start, severity_order.get(f.severity, 3), f.end)
    )

    for f in sorted_findings:
        if f.start >= last_end:
            kept.append(f)
            last_end = f.end

    return kept


MARKUP_TAG_RE = re.compile(
    r"</?[A-Za-z0-9_\-\.]+(\s+[^>]*|\s*)>|\[/?[A-Za-z0-9_\-\.]+(\s+[^\]]*|\s*)\]",
    re.IGNORECASE
)


def filter_markup_tag_findings(text: str, findings: list[Finding]) -> list[Finding]:
    if not findings or not text:
        return findings

    tag_spans = [(m.start(), m.end()) for m in MARKUP_TAG_RE.finditer(text)]
    if not tag_spans:
        return findings

    clean_findings = []
    for f in findings:
        overlap = False
        for ts, te in tag_spans:
            if f.start < te and f.end > ts:
                overlap = True
                break
        if not overlap:
            clean_findings.append(f)

    return clean_findings


def run_manuscript_core_rules(
    text: str,
    *,
    enable_uk_us: bool = True,
    enable_bias: bool = True,
    enable_compounds: bool = True,
) -> list[Finding]:
    """Run the three built-in manuscript_core rule families.

    Each family is gated by a meta-toggle (MC_UK_US / MC_BIAS / MC_COMPOUNDS in
    the profile JSON). Defaults are True so profiles that don't declare the
    meta-toggles behave as before.
    """
    out: list[Finding] = []

    # 1. UK/US Spelling Pairs
    if enable_uk_us:
        try:
            from app.processing.manuscript_core.data.uk_us_pairs import UK_US_PAIRS
            for uk, us in UK_US_PAIRS:
                pat_uk = re.compile(r"\b" + re.escape(uk) + r"\b", re.IGNORECASE)
                for m in pat_uk.finditer(text):
                    sug = _match_case(m.group(0), us)
                    out.append(Finding(
                        rule_id=f"uk_us_{us}",
                        category="spelling",
                        start=m.start(),
                        end=m.end(),
                        original=m.group(0),
                        suggestion=sug,
                        message=f"UK/US spelling: '{m.group(0)}' -> suggested US form '{sug}'.",
                        severity="warning"
                    ))
        except Exception:
            pass

    # 2. Inclusive Language & Bias Terms
    if enable_bias:
        try:
            from app.processing.manuscript_core.rules.bias_and_articles import BIAS_TERMS
            for pat_str, label, suggestion in BIAS_TERMS:
                pat = re.compile(r"\b" + pat_str + r"\b", re.IGNORECASE)
                for m in pat.finditer(text):
                    out.append(Finding(
                        rule_id=f"bias_{label}",
                        category="bias",
                        start=m.start(),
                        end=m.end(),
                        original=m.group(0),
                        suggestion=suggestion,
                        message=f"Inclusive Language: preferred term for '{m.group(0)}' is '{suggestion}'.",
                        severity="warning"
                    ))
        except Exception:
            pass

    # 3. Compound Variants
    if enable_compounds:
        try:
            from app.processing.manuscript_core.rules.compounds import COMPOUND_BASES
            for base in COMPOUND_BASES:
                parts = base.split()
                if len(parts) == 2:
                    spaced = f"{parts[0]} {parts[1]}"
                    hyphenated = f"{parts[0]}-{parts[1]}"
                    pat_hyp = re.compile(r"\b" + re.escape(hyphenated) + r"\b", re.IGNORECASE)
                    for m in pat_hyp.finditer(text):
                        out.append(Finding(
                            rule_id=f"compound_{parts[0]}_{parts[1]}",
                            category="compounds",
                            start=m.start(),
                            end=m.end(),
                            original=m.group(0),
                            suggestion=spaced,
                            message=f"Compound term variant: '{m.group(0)}' (canonical: '{spaced}').",
                            severity="suggestion"
                        ))
        except Exception:
            pass

    return out


# Meta-toggles for the three manuscript_core rule families. When these rule
# ids appear in a profile's rules list with `enabled: false`, the matching
# family is skipped. When absent, the family runs (backwards compatible).
_META_RULE_IDS = {
    "MC_UK_US": "enable_uk_us",
    "MC_BIAS": "enable_bias",
    "MC_COMPOUNDS": "enable_compounds",
}


def _resolve_manuscript_core_toggles(rules: list[Rule]) -> dict[str, bool]:
    toggles = {kw: True for kw in _META_RULE_IDS.values()}
    for r in rules:
        kw = _META_RULE_IDS.get(r.id)
        if kw is not None:
            toggles[kw] = bool(r.enabled)
    return toggles


def analyze(
    text: str,
    rules: list[Rule],
    dictionary: dict[str, str],
    sents: list[tuple[int, int, str]]
) -> list[Finding]:
    """Runs all enabled rules over paragraph text and returns de-conflicted findings."""
    if not text or not text.strip():
        return []

    findings: list[Finding] = []
    for r in rules:
        if not r.enabled:
            continue
        if r.id in _META_RULE_IDS:
            # Meta-toggles are gating flags, not analysable rules.
            continue
        if r.type == "regex":
            findings.extend(run_regex_rule(r, text))
        elif r.type == "dictionary":
            findings.extend(run_dictionary_rule(r, text, dictionary))
        elif r.type == "function":
            findings.extend(run_function_rule(r, sents))

    mc_toggles = _resolve_manuscript_core_toggles(rules)
    findings.extend(run_manuscript_core_rules(text, **mc_toggles))
    resolved = resolve_overlaps(findings)
    return filter_markup_tag_findings(text, resolved)
