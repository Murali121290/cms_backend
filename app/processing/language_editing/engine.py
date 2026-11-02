"""
Rule engine for Ninja Inkflow Language Editing.
Applies rules to text and returns findings for human review.
The engine NEVER mutates the source text during analysis.
"""
import re
from typing import Any, Optional
from .rules import Finding, Rule
from .sentence_checks import FUNCTIONS
from . import hyphen_dash
from . import abbreviations
from . import medical_terms


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
            # The hyphen/dash workbook covers many compound bases directly;
            # suppressing those here avoids duplicate findings per the Phase-2
            # "no duplicates" rule. Non-overlapping bases keep firing so the
            # 65 compounds unique to MC_COMPOUNDS still get checked.
            try:
                covered = hyphen_dash.workbook_covered_compound_bases()
            except Exception:
                covered = frozenset()
            for base in COMPOUND_BASES:
                parts = base.split()
                if len(parts) == 2:
                    spaced = f"{parts[0]} {parts[1]}"
                    hyphenated = f"{parts[0]}-{parts[1]}"
                    base_lc = base.lower()
                    if base_lc in covered or hyphenated.lower() in covered:
                        continue
                    pat_hyp = re.compile(r"\b" + re.escape(hyphenated) + r"\b", re.IGNORECASE)
                    for m in pat_hyp.finditer(text):
                        out.append(Finding(
                            # rule_id prefix (``compound_``) still identifies the
                            # LWW curated list in the UI's source badge; category
                            # is unified to ``hyphenation`` so Compounds and
                            # Hyphenation live in one filter tab per the
                            # single-category UX decision.
                            rule_id=f"compound_{parts[0]}_{parts[1]}",
                            category="hyphenation",
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


def _filter_protected(findings: list[Finding],
                      protected_spans: list[tuple[int, int]]) -> list[Finding]:
    """Drop findings whose span overlaps any protected span.

    Protected spans come from the hyphen/dash workbook's regex-pattern
    layer (URL, DOI, ISBN, gene symbol, etc.). Any finding — hyphen,
    spelling, compound, bias — that intersects one is dropped: the user
    marked the shape as off-limits.
    """
    if not protected_spans:
        return findings
    kept: list[Finding] = []
    for f in findings:
        hit = False
        for s, e in protected_spans:
            if f.start < e and f.end > s:
                hit = True
                break
        if not hit:
            kept.append(f)
    return kept


def analyze(
    text: str,
    rules: list[Rule],
    dictionary: dict[str, str],
    sents: list[tuple[int, int, str]],
    *,
    dash_profile: str = "all",
    protected_spans: Optional[list[tuple[int, int]]] = None,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
    # Phase B: optional document-scope hooks for the abbreviations module.
    # When ``abbr_state`` is None the per-paragraph analyser only fires
    # paragraph-local rules (Do_Not_Use + AB09 + AB13). The router pre-
    # computes ``abbr_state`` via ``abbreviations.build_document_state`` and
    # threads these kwargs per paragraph so first-use / AB01 / AB02 / AB04 /
    # AB05 / AB10 can fire with full cross-paragraph awareness.
    para_idx: int = 0,
    abbr_state: Optional[dict[str, Any]] = None,
    audience: str = "general",
    min_uses: int = 2,
    para_roles: Optional[dict[int, dict]] = None,
    medical_style_profile: str = "All",
) -> list[Finding]:
    """Runs all enabled rules over paragraph text and returns de-conflicted findings.

    ``dash_profile`` / ``protected_spans`` / ``rule_overrides`` are optional
    kwargs with backward-compatible defaults so pre-Scope-C callers keep
    working untouched. When ``rule_overrides`` is provided, it applies on
    top of both profile rules (``Rule.enabled`` → skipped if override says
    False) AND workbook rules (threaded to ``hyphen_dash.analyze_hyphen_dash``).
    """
    if not text or not text.strip():
        return []

    if protected_spans is None:
        try:
            protected_spans = hyphen_dash.build_protected_spans(
                text, dash_profile=dash_profile,
            )
        except Exception:
            protected_spans = []

    overrides = rule_overrides or {}

    def _rule_enabled(r: Rule) -> bool:
        """Project override wins over the rule file's enabled flag."""
        o = overrides.get(r.id)
        if o and "enabled" in o:
            return bool(o["enabled"])
        return r.enabled

    findings: list[Finding] = []
    for r in rules:
        if not _rule_enabled(r):
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

    # Workbook-driven hyphen & en-dash detection.
    try:
        findings.extend(hyphen_dash.analyze_hyphen_dash(
            text, dash_profile=dash_profile, protected_spans=protected_spans,
            rule_overrides=overrides,
        ))
    except Exception:
        # Never let a workbook glitch break the whole analyze pass; existing
        # rule families still produce findings so the user isn't blocked.
        pass

    # Abbreviations workbook — Phase A fires Do_Not_Use regex rules
    # per-paragraph; Phase B adds AB01/AB02/AB04/AB05/AB09/AB10/AB13
    # on top when the caller provides pre-computed ``abbr_state``.
    try:
        findings.extend(abbreviations.analyze_abbreviations(
            text,
            para_idx=para_idx,
            audience=audience,
            min_uses=min_uses,
            document_state=abbr_state,
            rule_overrides=overrides,
            para_roles=para_roles,
        ))
    except Exception:
        pass

    # Medical Terminology workbook — Detect_List phrase/word lookup +
    # Spelling_Patterns regex + Confusable_Terms paragraph-scoped context
    # scan. Shares the Scope-C override map so projects can disable any
    # individual medical rule by id. ``medical_style_profile`` gates the
    # three editorial subprofiles (US spelling, Possessive, Nonpossessive);
    # default 'All' keeps those subprofiles silent until the project opts in.
    try:
        findings.extend(medical_terms.analyze_medical_terms(
            text,
            para_idx=para_idx,
            style_profile=medical_style_profile,
            rule_overrides=overrides,
        ))
    except Exception:
        pass

    # Filter against protected spans BEFORE overlap resolution so a
    # protected span never wins a tie-break and causes a legitimate
    # finding on an adjacent token to drop.
    findings = _filter_protected(findings, protected_spans)

    resolved = resolve_overlaps(findings)
    return filter_markup_tag_findings(text, resolved)
