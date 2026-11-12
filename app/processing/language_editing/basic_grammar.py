"""Basic Grammar & Punctuation workbook runtime.

Loads the 420-rule ``Basic_Grammar_Rules_CE_Tool.xlsx`` sidecar
(``config/profiles/basic_grammar_rules.json``) and plugs into
:func:`engine.analyze` as the seventh workbook family (after
hyphen_dash, abbreviations, medical_terms, uk_us_spelling, lww_ne,
and the existing profile rules).

Shape mirrors ``lww_ne.py``:
  * ``clear_cache()`` for test fixtures to reset per-process LRU caches.
  * ``_load()`` returns the parsed JSON with ``@lru_cache(maxsize=1)``.
  * ``build_document_state(paragraphs)`` runs ONCE per analyze job and
    returns the counters the document-scope detectors need
    (GK-001/002/003). Analogous to ``abbreviations.build_document_state``.
  * ``analyze_basic_grammar(text, …)`` runs per paragraph and returns
    :class:`Finding` objects.

Rule execution mapping (ratified in the inspection report):

| Workbook status | Count | Handling |
|---|---|---|
| READY_REGEX | 337 | Guard-aware executor (⟂ split, ``CS:`` prefix). |
| READY_RULE_BASED (reused) | 4 | GK-004→SL001, AR-001→GP006, PU-007→GP005, CA-001→SL003 — skipped here; existing engine code handles them. |
| READY_RULE_BASED (new) | 6 | GV-005 irregular_participle, PU-010 quote_punct_us, PU-017 unbalanced_brackets, GK-001/002/003 doc-scope consistency. |
| READY_RULE_BASED (ship disabled) | 2 | PU-011 comma_splice, CA-011 binomial_case — kept inert pending parser / lexicon. |
| REQUIRES_POS_TAGGING / PARSING / CONTEXT | 59 | Not executed; registered in JSON for the rule viewer only. |
| MANUAL_REVIEW | 12 | Not executed; registered for the rule viewer only. |

Safety invariants preserved verbatim from the README:
  * Nothing in the workbook has ``validation_status=verified`` — so
    every suggestion is a SUGGESTION (never auto-applied) regardless of
    ``recommended_action=AUTO_FIX``.
  * ``style_dependency ∈ {'US only', 'UK only', 'House style'}`` gates
    execution on the project's ``document_variant`` / house-style flag.
  * Scope-C overrides apply per workbook rule_id (``rule_overrides``).
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from .rules import Finding

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent / "config" / "profiles" / "basic_grammar_rules.json"

# Primary-category → engine Finding.category. Each workbook sheet feeds
# exactly one engine category (so the frontend's existing chip renderer
# picks the finding up without knowing about the workbook's internal
# sheet structure).
_SHEET_TO_CATEGORY: dict[str, str] = {
    "Grammar_Rules": "grammar",
    "Article_Usage": "grammar",
    "Subject_Verb_Agreement": "grammar",
    "Common_Misuse": "grammar",
    "Word_Phrase_Choice": "grammar",
    "Sentence_Structure": "grammar",
    "Punctuation_Capitalization": "sentence",  # routed to the existing "Punctuation and Capitalization" chip
}

# Workbook sheet → human-readable label for the finding card header.
# The engine category keeps grammar / sentence findings grouped under
# the existing sidebar chips (per spec §4); this label replaces the
# generic 'Grammar' / 'Sentence' text on the card itself so a reviewer
# can see at a glance which workbook section a finding came from.
_SHEET_TO_LABEL: dict[str, str] = {
    "Grammar_Rules": "Basic Grammar",
    "Article_Usage": "Article Usage",
    "Subject_Verb_Agreement": "Subject-Verb Agreement",
    "Common_Misuse": "Common Misuse",
    "Word_Phrase_Choice": "Word/Phrase Choice",
    "Sentence_Structure": "Sentence Structure",
    "Punctuation_Capitalization": "Punctuation and Capitalization",
}

# Workbook rules whose behaviour is already covered by an existing
# engine rule. Executing them again would double-fire on the same span.
# ``resolve_overlaps`` would then arbitrarily pick one, hiding the
# other from the user — not a visible bug but wasted work.
_REUSED_RULE_IDS: frozenset[str] = frozenset({"GK-004", "AR-001", "PU-007", "CA-001"})

# READY_RULE_BASED rules that don't have an engine detector yet. Kept
# in the JSON for discoverability; the executor skips them. Each ID
# listed here needs a resource the workbook does not ship:
#   * PU-011 — a clause-boundary parser (comma splice)
#   * CA-011 — a genus/species lexicon (binomial case)
#   * GK-001 — a consistency-pairs dictionary (email/e-mail, website/
#     web site, …). The workbook's example gives the shape of the
#     rule but ships no pair list; approximating with a hardcoded
#     dictionary would "invent a dictionary" per the user spec and
#     overlap the UK/US spelling workbook's -ise/-ize territory.
_SHIP_DISABLED_RULE_IDS: frozenset[str] = frozenset({"PU-011", "CA-011", "GK-001"})

# Guard separator defined in the workbook's Data_Dictionary. Patterns
# look like ``main ⟂ guard_before ⟂ guard_after`` (max 3 parts). Guards
# are regex fragments that must NOT match or the main match is skipped:
#   * ``guard_before`` tests the 40 chars immediately before the match.
#   * ``guard_after`` tests the text immediately after the match.
_GUARD_SEP = "⟂"
_GUARD_WINDOW = 40  # chars before/after fed to each guard


# ────────────────────────────────────────────────────────────────────
# Loading + caching
# ────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    """Parse the sidecar JSON once per process."""
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _compiled_rules() -> list[dict[str, Any]]:
    """Return the subset of rules the executor actually runs, with
    their patterns pre-compiled. Rules that are reused, ship-disabled,
    or need tagging/parsing/context are filtered out."""
    out: list[dict[str, Any]] = []
    for raw in _load().get("rules", []):
        rid = raw.get("rule_id") or ""
        status = raw.get("implementation_status") or ""
        sheet = raw.get("worksheet") or ""
        if rid in _REUSED_RULE_IDS or rid in _SHIP_DISABLED_RULE_IDS:
            continue
        if status not in ("READY_REGEX", "READY_RULE_BASED"):
            continue
        category = _SHEET_TO_CATEGORY.get(sheet, "grammar")
        detector_id = raw.get("detector_id") or ""
        pattern = raw.get("detection_pattern") or ""
        compiled: dict[str, Any] = {
            **raw,
            "_category": category,
            "_detector_id": detector_id,
        }
        if status == "READY_REGEX" and pattern:
            try:
                compiled["_compiled"] = _compile_guarded(pattern)
            except re.error as exc:
                # Don't let one bad pattern silence the whole workbook.
                logger.warning(
                    "basic_grammar: skipping %s — pattern compile error: %s",
                    rid, exc,
                )
                continue
        out.append(compiled)
    return out


@lru_cache(maxsize=1)
def _rule_id_to_worksheet() -> dict[str, str]:
    """Rule ID → source worksheet name. Covers all 420 rules (not just
    the executable subset) so the GET /findings serializer can surface
    the right source label even for persisted findings whose rule has
    since been reused or disabled."""
    return {
        r["rule_id"]: r.get("worksheet") or ""
        for r in _load().get("rules", [])
        if r.get("rule_id")
    }


def subcategory_for(rule_id: str) -> Optional[str]:
    """Return the human-readable source label for a finding's rule_id,
    or None when the rule_id is not a Basic Grammar workbook rule.

    Used by the GET /findings serializer so a workbook finding's card
    header shows ``Article Usage`` / ``Subject-Verb Agreement`` /
    ``Punctuation and Capitalization`` / etc. instead of the generic
    engine category. Non-workbook findings (profile rules, hyphen_dash,
    abbreviations, medical_terms, uk_us_spelling, lww_ne, spell_check,
    term_matcher) return None → the frontend falls back to its existing
    ``displayCategory`` derivation.

    Lookup is a pure rule-ID → sheet-label mapping. Case-sensitive,
    exact match. Returns None for rule IDs that don't appear in the
    workbook (including legacy rule IDs from previous CACHE_VERSION
    jobs and future rules not yet imported)."""
    if not rule_id:
        return None
    sheet = _rule_id_to_worksheet().get(rule_id)
    if not sheet:
        return None
    return _SHEET_TO_LABEL.get(sheet)


def clear_cache() -> None:
    """Drop the per-process caches. Called from test fixtures so a test
    that monkey-patches the sidecar JSON path sees the new content on
    the next call."""
    _load.cache_clear()
    _compiled_rules.cache_clear()
    _rule_id_to_worksheet.cache_clear()


# ────────────────────────────────────────────────────────────────────
# Guard-aware pattern compilation
# ────────────────────────────────────────────────────────────────────

def _compile_guarded(pattern: str) -> dict[str, Any]:
    """Split a workbook pattern on ``⟂`` into main/guard_before/
    guard_after and compile each part. Honour the ``CS:`` case-
    sensitive prefix on the main pattern.

    Returned dict:
      ``main``          — compiled re.Pattern
      ``guard_before``  — compiled re.Pattern or None
      ``guard_after``   — compiled re.Pattern or None
    """
    parts = pattern.split(_GUARD_SEP)
    # Normalise to exactly 3 parts (fill with empty strings).
    main_pat = parts[0].strip() if parts else ""
    guard_before = parts[1].strip() if len(parts) > 1 else ""
    guard_after = parts[2].strip() if len(parts) > 2 else ""

    cs = False
    if main_pat.startswith("CS:"):
        cs = True
        main_pat = main_pat[3:]

    flags = 0 if cs else re.IGNORECASE
    return {
        "main": re.compile(main_pat, flags),
        "guard_before": re.compile(guard_before, flags) if guard_before else None,
        "guard_after": re.compile(guard_after, flags) if guard_after else None,
    }


def _guards_block(compiled: dict[str, Any], text: str, start: int, end: int) -> bool:
    """True when either guard matches, which means the caller must
    skip this hit."""
    gb = compiled.get("guard_before")
    ga = compiled.get("guard_after")
    if gb is not None:
        window_start = max(0, start - _GUARD_WINDOW)
        if gb.search(text[window_start:start]):
            return True
    if ga is not None:
        if ga.match(text[end:]):
            return True
    return False


# ────────────────────────────────────────────────────────────────────
# Rule-level helpers
# ────────────────────────────────────────────────────────────────────

def _rule_disabled_by_override(rule_id: str, rule_overrides: Optional[dict]) -> bool:
    if not rule_overrides:
        return False
    entry = rule_overrides.get(rule_id)
    if isinstance(entry, dict) and entry.get("enabled") is False:
        return True
    return False


def _style_dependency_matches(dep: Any, document_variant: str) -> bool:
    """Gate style-dependent rules on the project's document_variant.

    Workbook values seen:
      * 'No' / 'None'       — always runs
      * 'US only'           — runs when document_variant starts with 'en-US'
      * 'UK only'           — runs when document_variant starts with 'en-GB'
      * 'House style'       — never runs by default (needs explicit opt-in)
    """
    if not dep:
        return True
    d = str(dep).strip().lower()
    if d in ("", "no", "none"):
        return True
    if d.startswith("us only"):
        return document_variant.startswith("en-US")
    if d.startswith("uk only"):
        return document_variant.startswith("en-GB")
    if d.startswith("house style"):
        return False
    # Unknown value → run. Logged once for visibility.
    logger.debug("basic_grammar: unrecognised style_dependency %r — defaulting to on", dep)
    return True


def _severity(raw: Any) -> str:
    v = str(raw or "").strip().lower()
    if v in ("high", "error"):
        return "error"
    if v in ("medium", "warning"):
        return "warning"
    if v in ("low", "suggestion"):
        return "suggestion"
    return "warning"


def _editor_message(rule: dict[str, Any]) -> str:
    msg = rule.get("editor_message") or rule.get("rule_name") or rule.get("rule_description") or ""
    return str(msg).strip() or "Basic grammar / punctuation finding."


def _apply_replacement(replacement: Any, match: re.Match) -> str:
    """Workbook replacement semantics:
      * empty / None    — no textual suggestion (use original)
      * '∅'             — delete the match (replacement = '')
      * any other       — re.Match.expand() template with \\1, \\2 refs
    """
    if replacement is None:
        return match.group(0)
    s = str(replacement)
    if not s:
        return match.group(0)
    if s.strip() == "∅":
        return ""
    try:
        return match.expand(s)
    except (re.error, IndexError):
        return match.group(0)


# ────────────────────────────────────────────────────────────────────
# Rule-based (non-regex) detectors
# ────────────────────────────────────────────────────────────────────

# Irregular past-participle pairs the engine checks after have/has/had.
# Author can safely say "I have run" (past participle) but not "I have
# ran" (past simple). Tight list — no slang / dialect forms.
_IRREGULAR_PAST_TO_PARTICIPLE: dict[str, str] = {
    "ran": "run", "began": "begun", "came": "come", "did": "done",
    "drank": "drunk", "drove": "driven", "ate": "eaten", "fell": "fallen",
    "flew": "flown", "froze": "frozen", "gave": "given", "grew": "grown",
    "knew": "known", "rose": "risen", "sang": "sung", "sank": "sunk",
    "spoke": "spoken", "stole": "stolen", "swam": "swum", "threw": "thrown",
    "took": "taken", "wore": "worn", "wrote": "written", "saw": "seen",
    "chose": "chosen", "forgot": "forgotten", "hid": "hidden",
    "shook": "shaken", "wore": "worn", "lay": "lain", "rode": "ridden",
}

_HAVE_PAST_RE = re.compile(
    r"\b(have|has|had)\s+(" + "|".join(sorted(_IRREGULAR_PAST_TO_PARTICIPLE, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def _detect_irregular_participle(rule: dict[str, Any], text: str, state: dict[str, Any], document_variant: str) -> list[Finding]:
    """GV-005: ``have/has/had + past-simple`` → suggest past-participle.

    Skipped when ``have`` / ``has`` / ``had`` is acting as a plain
    transitive verb (``had the chance``, ``has the data``) — the
    requirement here is that the next token is from the past-simple
    list. False-positive risk for rare idioms (``have ran their
    course``) is listed on the workbook row; see rule_id GV-005.
    """
    out: list[Finding] = []
    for m in _HAVE_PAST_RE.finditer(text):
        aux = m.group(1)
        past = m.group(2).lower()
        participle = _IRREGULAR_PAST_TO_PARTICIPLE.get(past)
        if not participle:
            continue
        suggestion = f"{aux} {participle}"
        out.append(Finding(
            rule_id=rule["rule_id"],
            category=rule["_category"],
            start=m.start(), end=m.end(),
            original=m.group(0),
            suggestion=suggestion,
            message=_editor_message(rule),
            severity=_severity(rule.get("severity")),
            autofixable=False,
        ))
    return out


_UNBALANCED_PAIRS = (("(", ")"), ("[", "]"), ("{", "}"))


def _detect_unbalanced_brackets(rule: dict[str, Any], text: str, state: dict[str, Any], document_variant: str) -> list[Finding]:
    """PU-017: flag unclosed / unopened brackets in the paragraph.

    Per-paragraph scope — a bracket opened in one paragraph and closed
    in the next would legitimately look unbalanced here. That's the
    workbook's trade-off (documented on PU-017 as a false-positive
    risk: 'brackets spanning paragraphs').
    """
    out: list[Finding] = []
    for opener, closer in _UNBALANCED_PAIRS:
        stack: list[int] = []
        for i, ch in enumerate(text):
            if ch == opener:
                stack.append(i)
            elif ch == closer:
                if stack:
                    stack.pop()
                else:
                    out.append(Finding(
                        rule_id=rule["rule_id"],
                        category=rule["_category"],
                        start=i, end=i + 1,
                        original=closer,
                        suggestion=closer,  # kept — no safe auto-fix
                        message=f"{_editor_message(rule)} Unmatched '{closer}'.",
                        severity=_severity(rule.get("severity")),
                        autofixable=False,
                        advisory=True,  # nothing to apply; highlight only
                    ))
        # Any openers still on the stack are unclosed.
        for pos in stack:
            out.append(Finding(
                rule_id=rule["rule_id"],
                category=rule["_category"],
                start=pos, end=pos + 1,
                original=opener,
                suggestion=opener,
                message=f"{_editor_message(rule)} Unmatched '{opener}'.",
                severity=_severity(rule.get("severity")),
                autofixable=False,
                advisory=True,
            ))
    return out


_QUOTE_PUNCT_US_RE = re.compile(r'(["”])([,.])')


def _detect_quote_punct_us(rule: dict[str, Any], text: str, state: dict[str, Any], document_variant: str) -> list[Finding]:
    """PU-010: US convention — periods and commas go INSIDE the closing
    quote, not outside. Flags ``said".`` → ``said."`` and ``said",``
    → ``said,"``. Style-dependent; the executor only calls this
    detector when ``style_dependency`` approves for en-US.
    """
    if not document_variant.startswith("en-US"):
        return []
    out: list[Finding] = []
    for m in _QUOTE_PUNCT_US_RE.finditer(text):
        quote = m.group(1)
        punct = m.group(2)
        out.append(Finding(
            rule_id=rule["rule_id"],
            category=rule["_category"],
            start=m.start(), end=m.end(),
            original=m.group(0),
            suggestion=f"{punct}{quote}",
            message=_editor_message(rule),
            severity=_severity(rule.get("severity")),
            autofixable=False,
        ))
    return out


# ────────────────────────────────────────────────────────────────────
# Document-scope detectors (GK-001 / GK-002 / GK-003)
# ────────────────────────────────────────────────────────────────────

_STRAIGHT_QUOTE_RE = re.compile(r'"')
_CURLY_QUOTE_RE = re.compile(r"[“”]")


def build_document_state(paragraphs: Iterable[tuple[int, str]]) -> dict[str, Any]:
    """Pre-compute the counters the document-scope detectors need.

    Called ONCE per analyze job (from the router), from BODY
    paragraphs only — the router filters headings / captions / tables
    / figures / abstracts / epigraphs / src blocks before calling, so
    the counts reflect only text that the analyze loop also examines.

    Current output is used by GK-002 only. GK-001 would also use this
    pre-pass once the workbook ships its consistency-pairs dictionary;
    until then the rule is disabled (see ``_SHIP_DISABLED_RULE_IDS``).
    GK-003 serial-comma logic looks at a single paragraph at a time
    and doesn't need pre-pass counters.
    """
    straight = curly = 0
    for _, text in paragraphs:
        if not text:
            continue
        straight += len(_STRAIGHT_QUOTE_RE.findall(text))
        curly += len(_CURLY_QUOTE_RE.findall(text))
    return {
        "straight_quote_count": straight,
        "curly_quote_count": curly,
    }


def _detect_quote_style_consistency(rule: dict[str, Any], text: str, state: dict[str, Any], document_variant: str) -> list[Finding]:
    """GK-002: flag the minority of straight vs curly quotes when both
    appear in the document."""
    straight = state.get("straight_quote_count", 0)
    curly = state.get("curly_quote_count", 0)
    if straight == 0 or curly == 0 or straight == curly:
        return []
    minority_re = _STRAIGHT_QUOTE_RE if straight < curly else _CURLY_QUOTE_RE
    label = "straight" if straight < curly else "curly"
    out: list[Finding] = []
    for m in minority_re.finditer(text):
        out.append(Finding(
            rule_id=rule["rule_id"],
            category=rule["_category"],
            start=m.start(), end=m.end(),
            original=m.group(0),
            suggestion=m.group(0),
            message=f"{_editor_message(rule)} Minority {label} quote in a mixed-quote document.",
            severity=_severity(rule.get("severity")),
            autofixable=False,
            advisory=True,
        ))
    return out


def _detect_serial_comma_consistency(rule: dict[str, Any], text: str, state: dict[str, Any], document_variant: str) -> list[Finding]:
    """GK-003: lightweight serial-comma consistency.

    Full implementation requires clause chunking (see the workbook's
    false-positive risk notes). This conservative version only flags a
    paragraph as inconsistent when it shows BOTH ``X, Y, and Z`` AND
    ``X, Y and Z`` style in the same paragraph. Cross-paragraph
    comparison is deferred to avoid over-flagging.
    """
    serial_with = bool(re.search(r",\s*(?:[^,.]+?)\s*,\s+(?:and|or)\s+", text))
    serial_without = bool(re.search(r"\b\w+,\s+\w+\s+(?:and|or)\s+\w+\b", text))
    if not (serial_with and serial_without):
        return []
    # Flag the first occurrence of each style in the paragraph.
    out: list[Finding] = []
    for m in re.finditer(r",\s+(and|or)\s+", text):
        out.append(Finding(
            rule_id=rule["rule_id"],
            category=rule["_category"],
            start=m.start(), end=m.end(),
            original=m.group(0),
            suggestion=m.group(0),
            message=_editor_message(rule),
            severity=_severity(rule.get("severity")),
            autofixable=False,
            advisory=True,
        ))
        break
    return out


_DETECTOR_FUNCTIONS = {
    "irregular_participle": _detect_irregular_participle,  # GV-005
    "quote_punct_us": _detect_quote_punct_us,              # PU-010 (US only)
    "unbalanced_brackets": _detect_unbalanced_brackets,    # PU-017
    # NOTE: ``consistency_pairs`` (GK-001) is intentionally not listed —
    # GK-001 ships disabled because the workbook does not supply the
    # consistency-pairs dictionary it describes (email/e-mail,
    # website/web site, …). Approximating it with a hardcoded pair
    # list would invent data the workbook does not define and would
    # overlap the UK/US spelling workbook's territory. See
    # ``_SHIP_DISABLED_RULE_IDS``.
    "quote_style_consistency": _detect_quote_style_consistency,  # GK-002
    "serial_comma_consistency": _detect_serial_comma_consistency,  # GK-003 (House style; off by default)
}


# ────────────────────────────────────────────────────────────────────
# Main entry point
# ────────────────────────────────────────────────────────────────────

def analyze_basic_grammar(
    text: str,
    *,
    document_state: Optional[dict[str, Any]] = None,
    document_variant: str = "en-GB",
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    """Per-paragraph entry point. Returns Finding objects produced by
    both the regex executor and the rule-based detectors.

    ``document_state`` is the dict returned by :func:`build_document_state`.
    When None (router didn't pre-compute) the document-scope detectors
    silently do nothing. All other rules run normally.
    """
    if not text or not text.strip():
        return []

    state = document_state or {}
    out: list[Finding] = []
    for rule in _compiled_rules():
        rid = rule.get("rule_id") or ""
        if _rule_disabled_by_override(rid, rule_overrides):
            continue
        if not _style_dependency_matches(rule.get("style_dependency"), document_variant):
            continue
        status = rule.get("implementation_status")
        if status == "READY_REGEX":
            out.extend(_run_regex_rule(rule, text))
        elif status == "READY_RULE_BASED":
            detector_id = rule.get("_detector_id") or ""
            fn = _DETECTOR_FUNCTIONS.get(detector_id)
            if fn is None:
                # Should not happen — _compiled_rules filters unreachable
                # detectors out — but log once if it does.
                logger.debug("basic_grammar: no detector function for %s (%s)", rid, detector_id)
                continue
            out.extend(fn(rule, text, state, document_variant))
    return out


def _run_regex_rule(rule: dict[str, Any], text: str) -> list[Finding]:
    compiled = rule.get("_compiled")
    if not compiled:
        return []
    out: list[Finding] = []
    main_re: re.Pattern = compiled["main"]
    replacement = rule.get("replacement")
    rid = rule["rule_id"]
    category = rule["_category"]
    message = _editor_message(rule)
    severity = _severity(rule.get("severity"))
    for m in main_re.finditer(text):
        start, end = m.start(), m.end()
        if start == end:
            # Pattern matched zero width — skip, would spam findings.
            continue
        if _guards_block(compiled, text, start, end):
            continue
        suggestion = _apply_replacement(replacement, m)
        out.append(Finding(
            rule_id=rid,
            category=category,
            start=start, end=end,
            original=m.group(0),
            suggestion=suggestion,
            message=message,
            severity=severity,
            autofixable=False,  # README safety: nothing verified → no auto-fix
        ))
    return out


# ────────────────────────────────────────────────────────────────────
# Diagnostics — used by tests + the rule viewer.
# ────────────────────────────────────────────────────────────────────

def all_rules() -> list[dict[str, Any]]:
    """All 420 rules (including disabled / reused / needs-linguistic),
    read-only snapshot for the rule viewer."""
    return list(_load().get("rules", []))


def detection_tests() -> list[dict[str, Any]]:
    """Return the Detection_Logic rows persisted alongside the rules."""
    return list(_load().get("detection_tests", []))


def runtime_summary() -> dict[str, int]:
    """One-line summary of how many rules the executor will actually
    fire. Used by the test harness + an admin endpoint."""
    rules = _compiled_rules()
    by_status: dict[str, int] = {}
    for r in rules:
        by_status[r.get("implementation_status", "?")] = by_status.get(r.get("implementation_status", "?"), 0) + 1
    return {
        "total_registered": len(_load().get("rules", [])),
        "executable": len(rules),
        "by_status": by_status,  # type: ignore[dict-item]
    }
