"""Medical Terminology workbook runtime.

Loads the five committed JSON sidecars (dictionary, detect list, spelling
patterns, eponym policy, confusable terms) and exposes:

  * :func:`preferred_terms` — set of ~1055 known-correct medical terms used
    to extend the spell-check whitelist so correct medical spellings never
    fire as typos.
  * :func:`analyze_medical_terms` — paragraph-level analyser called from
    :func:`engine.analyze`. Produces :class:`Finding` objects for:
      - Detect_List rows (1003 Flag-and-suggest / Auto-replace entries,
        each with up to two suggestions and full editorial metadata)
      - Spelling_Patterns regex rules (MED-SP01 … MED-SP26)
      - Confusable_Terms context-aware pairs (ileum/ilium, etc.) with
        paragraph-scoped cue-word disambiguation.

Scope-C invariant preserved: both FLAG and AUTO_REPLACE produce reviewable
findings. The engine NEVER mutates the input text — every rule emits a
``Finding`` and the Review Page's explicit-acceptance flow decides whether
the manuscript actually changes.

Style-profile gating (decision M-A/question 1):
  * Rules marked ``style_profile='All'`` always fire.
  * The other three profile values (``US spelling``, ``Possessive``,
    ``Nonpossessive``) only fire when the project's
    ``medical_style_profile`` setting matches.
  * Projects without the setting default to ``'All'`` — the subprofile
    rules stay silent until the editor opts in.
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


_CONFIG_DIR = Path(__file__).parent / "config" / "profiles"
_DICTIONARY_JSON = _CONFIG_DIR / "medical_terms_dictionary.json"
_DETECT_JSON = _CONFIG_DIR / "medical_terms_detect.json"
_PATTERNS_JSON = _CONFIG_DIR / "medical_terms_patterns.json"
_EPONYMS_JSON = _CONFIG_DIR / "medical_terms_eponyms.json"
_CONFUSABLES_JSON = _CONFIG_DIR / "medical_terms_confusables.json"


DEFAULT_STYLE_PROFILE = "All"
VALID_STYLE_PROFILES = ("All", "US spelling", "UK spelling", "Possessive", "Nonpossessive")


# ---------------------------------------------------------------------------
# JSON loading (lru-cached)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("medical_terms config missing: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("medical_terms config invalid JSON at %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def _dictionary_data() -> dict:
    return _load_json(_DICTIONARY_JSON)


@lru_cache(maxsize=1)
def _detect_data() -> dict:
    return _load_json(_DETECT_JSON)


@lru_cache(maxsize=1)
def _patterns_data() -> dict:
    return _load_json(_PATTERNS_JSON)


@lru_cache(maxsize=1)
def _eponyms_data() -> dict:
    return _load_json(_EPONYMS_JSON)


@lru_cache(maxsize=1)
def _confusables_data() -> dict:
    return _load_json(_CONFUSABLES_JSON)


def clear_cache() -> None:
    _dictionary_data.cache_clear()
    _detect_data.cache_clear()
    _patterns_data.cache_clear()
    _eponyms_data.cache_clear()
    _confusables_data.cache_clear()
    _preferred_terms.cache_clear()
    _compiled_detect_rules.cache_clear()
    _compiled_patterns.cache_clear()
    _compiled_confusables.cache_clear()


# ---------------------------------------------------------------------------
# Preferred-terms whitelist (feeds spell-check)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _preferred_terms() -> frozenset[str]:
    """Return the set of lowercased preferred medical terms.

    Downstream (spell_check) lowercases the hay before matching, so we
    store lowercased here too. Multi-word terms stay as-is so the
    whitelist's membership check against the whole token still works for
    single-word entries.
    """
    data = _dictionary_data()
    terms = {
        (entry.get("term") or "").strip().lower()
        for entry in data.get("entries", []) or []
        if entry.get("term")
    }
    terms.discard("")
    return frozenset(terms)


def preferred_terms() -> frozenset[str]:
    """Public accessor — used by spell_check.build_whitelist."""
    return _preferred_terms()


# ---------------------------------------------------------------------------
# Compiled rule tables
# ---------------------------------------------------------------------------

def _detect_regex(source_term: str, match_type: str, match_case: bool) -> re.Pattern:
    """Compile a Detect_List source term according to its Match type / case.

    * Whole word → ``\\b<escaped>\\b``
    * Phrase     → literal escaped substring (no boundaries)

    Case folding is driven by Match case (True → literal case; False →
    IGNORECASE). The compiled pattern is cached as part of the big
    ``_compiled_detect_rules`` dict so the per-paragraph scan is cheap.
    """
    escaped = re.escape(source_term)
    pattern = fr"\b{escaped}\b" if match_type == "whole_word" else escaped
    flags = 0 if match_case else re.IGNORECASE
    return re.compile(pattern, flags)


@lru_cache(maxsize=1)
def _compiled_detect_rules() -> list[dict]:
    """Pre-compile every Detect_List row's regex once at startup."""
    out: list[dict] = []
    data = _detect_data()
    for row in data.get("entries", []) or []:
        if not row.get("source_term"):
            continue
        try:
            rx = _detect_regex(
                row["source_term"],
                row.get("match_type") or "whole_word",
                bool(row.get("match_case")),
            )
        except re.error as exc:
            logger.warning(
                "medical_terms detect rule %s: skipping — regex error %s",
                row.get("id"), exc,
            )
            continue
        out.append({**row, "_rx": rx})
    return out


@lru_cache(maxsize=1)
def _compiled_patterns() -> list[dict]:
    """Pre-compile every Spelling_Patterns regex rule once at startup."""
    out: list[dict] = []
    data = _patterns_data()
    for row in data.get("entries", []) or []:
        pat = row.get("pattern")
        if not pat:
            continue
        flag_bits = 0
        for name in (row.get("flags") or []):
            flag_bits |= getattr(re, name, 0)
        try:
            rx = re.compile(pat, flag_bits)
        except re.error as exc:
            logger.warning(
                "medical_terms spelling pattern %s: skipping — regex error %s",
                row.get("id"), exc,
            )
            continue
        out.append({**row, "_rx": rx})
    return out


@lru_cache(maxsize=1)
def _compiled_confusables() -> list[dict]:
    """Pre-compile confusable pairs: both words + cue-stem regexes.

    Each entry caches a whole-word regex for Word A, Word B, and the two
    cue-stem alternation regexes (word-boundary-anchored, case-insensitive)
    used to decide which word the author "meant" in the paragraph.
    """
    out: list[dict] = []
    data = _confusables_data()
    for row in data.get("entries", []) or []:
        word_a = row.get("word_a")
        word_b = row.get("word_b")
        if not word_a or not word_b:
            continue

        def _cue_rx(stems: list[str]) -> Optional[re.Pattern]:
            cues = [re.escape(s) for s in stems if s]
            if not cues:
                return None
            # Stems can be multi-word phrases; use \b on the ends only.
            return re.compile(
                r"\b(?:" + "|".join(cues) + r")", re.IGNORECASE,
            )

        try:
            rx_a = re.compile(fr"\b{re.escape(word_a)}\b", re.IGNORECASE)
            rx_b = re.compile(fr"\b{re.escape(word_b)}\b", re.IGNORECASE)
        except re.error as exc:
            logger.warning(
                "medical_terms confusable %s: skipping — regex error %s",
                row.get("id"), exc,
            )
            continue

        out.append({
            **row,
            "_rx_a": rx_a,
            "_rx_b": rx_b,
            "_cue_rx_a": _cue_rx(row.get("cues_a") or []),
            "_cue_rx_b": _cue_rx(row.get("cues_b") or []),
        })
    return out


# ---------------------------------------------------------------------------
# Scope-C override helpers
# ---------------------------------------------------------------------------

def _rule_disabled_by_override(rule_id: str, overrides: dict) -> bool:
    o = (overrides or {}).get(rule_id) or {}
    return "enabled" in o and not o["enabled"]


def _effective_tool_behaviour(rule_id: str, overrides: dict, default: str) -> str:
    o = (overrides or {}).get(rule_id) or {}
    tb = o.get("tool_behaviour")
    if tb in ("flag", "auto_replace"):
        return tb
    return default


def _style_profile_matches(rule_profile: str, project_profile: str) -> bool:
    """Return True if a rule tagged ``rule_profile`` should fire for a
    project that has selected ``project_profile``.

    ``All`` rules always fire. The three subprofiles only fire when
    the project matches, so the default (``All``) stays conservative —
    the subprofile rules stay silent until the editor opts in.
    """
    if rule_profile == "All":
        return True
    return rule_profile == project_profile


# ---------------------------------------------------------------------------
# Finding assembly helpers
# ---------------------------------------------------------------------------

def _message_for_detect(row: dict) -> str:
    """Compose a reviewer-facing message that surfaces Problem type +
    Context note. Severity-level metadata (basis, confidence) ride on
    the Finding dict but don't need to be in the primary message string
    — the Review UI reads them off ``row`` directly for its badge chips.
    """
    parts: list[str] = []
    if row.get("problem_type"):
        parts.append(str(row["problem_type"]))
    if row.get("context_note"):
        parts.append(str(row["context_note"]))
    return " — ".join(parts) if parts else "Medical terminology"


def _message_for_pattern(row: dict) -> str:
    name = row.get("name") or "Medical spelling pattern"
    note = row.get("note")
    return f"{name}: {note}" if note else name


def _message_for_confusable(row: dict, flagged_word: str, suggested_word: str) -> str:
    note = row.get("note") or ""
    return f"Possible confusable: likely '{suggested_word}', not '{flagged_word}'. {note}".strip()


# ---------------------------------------------------------------------------
# Per-sub-analyser
# ---------------------------------------------------------------------------

def _detect_findings(
    text: str, *, style_profile: str, rule_overrides: dict,
) -> list[Finding]:
    out: list[Finding] = []
    for rule in _compiled_detect_rules():
        rid = rule.get("id")
        if _rule_disabled_by_override(rid, rule_overrides):
            continue
        if not _style_profile_matches(rule.get("style_profile") or "All", style_profile):
            continue

        suggestions = rule.get("suggestions") or []
        default_tb = rule.get("tool_behaviour") or "flag"
        effective_tb = _effective_tool_behaviour(rid, rule_overrides, default_tb)

        # ``Flag only`` rows (currently none in the workbook, but defensible
        # against future additions) are represented in the import as
        # tool_behaviour='flag' with an empty suggestions list; the engine
        # emits a Finding where suggestion == original so the Review Page
        # knows there's nothing to pre-fill.
        rx: re.Pattern = rule["_rx"]
        for m in rx.finditer(text):
            original = m.group(0)
            if suggestions:
                primary = suggestions[0]
                alt = list(suggestions[1:])
            else:
                primary = original
                alt = []

            out.append(Finding(
                rule_id=rid,
                category="medical_terms",
                start=m.start(),
                end=m.end(),
                original=original,
                suggestion=primary,
                message=_message_for_detect(rule),
                severity=_confidence_to_severity(rule.get("confidence")),
                autofixable=effective_tb == "auto_replace",
                alt_suggestions=alt,
            ))
    return out


def _pattern_findings(
    text: str, *, style_profile: str, rule_overrides: dict,
) -> list[Finding]:
    out: list[Finding] = []
    for rule in _compiled_patterns():
        rid = rule.get("id")
        if _rule_disabled_by_override(rid, rule_overrides):
            continue
        if not _style_profile_matches(rule.get("style_profile") or "All", style_profile):
            continue

        rx: re.Pattern = rule["_rx"]
        replacement_tmpl = rule.get("replacement")
        default_tb = rule.get("tool_behaviour") or "flag"
        effective_tb = _effective_tool_behaviour(rid, rule_overrides, default_tb)

        for m in rx.finditer(text):
            original = m.group(0)
            if replacement_tmpl is not None:
                try:
                    suggestion = m.expand(replacement_tmpl)
                except (re.error, IndexError):
                    continue
            else:
                suggestion = original
            if suggestion == original:
                continue
            out.append(Finding(
                rule_id=rid,
                category="medical_terms",
                start=m.start(),
                end=m.end(),
                original=original,
                suggestion=suggestion,
                message=_message_for_pattern(rule),
                severity="warning",
                autofixable=effective_tb == "auto_replace",
            ))
    return out


def _confusable_findings(
    text: str, *, rule_overrides: dict,
) -> list[Finding]:
    """Paragraph-scoped cue-word scan.

    For each pair (A, B):
      * Count B's cue hits in the paragraph. If > 0 and A appears, every
        occurrence of A is flagged as "did you mean B?" with suggestion=B.
      * Symmetrically for A's cues vs B occurrences.
      * If BOTH words appear and BOTH cue sets fire, we don't flag either
        — the paragraph genuinely talks about both and the author is
        presumably being precise.

    Scope: current paragraph only, matching the user's decision for M-A
    question 3.
    """
    out: list[Finding] = []
    for rule in _compiled_confusables():
        rid = rule.get("id")
        if _rule_disabled_by_override(rid, rule_overrides):
            continue

        word_a: str = rule["word_a"]
        word_b: str = rule["word_b"]
        rx_a: re.Pattern = rule["_rx_a"]
        rx_b: re.Pattern = rule["_rx_b"]
        cue_rx_a: Optional[re.Pattern] = rule.get("_cue_rx_a")
        cue_rx_b: Optional[re.Pattern] = rule.get("_cue_rx_b")

        has_a = rx_a.search(text) is not None
        has_b = rx_b.search(text) is not None
        if not has_a and not has_b:
            continue

        cue_a_hits = len(cue_rx_a.findall(text)) if cue_rx_a else 0
        cue_b_hits = len(cue_rx_b.findall(text)) if cue_rx_b else 0

        # Both words present with both cue sets firing → ambiguous but
        # author is talking about both; don't double-flag.
        both_cues_present = cue_a_hits > 0 and cue_b_hits > 0
        if has_a and has_b and both_cues_present:
            continue

        default_tb = rule.get("tool_behaviour") or "flag"
        effective_tb = _effective_tool_behaviour(rid, rule_overrides, default_tb)

        # Flag A when B's cue words dominate and A's don't.
        if has_a and cue_b_hits > 0 and cue_a_hits == 0:
            for m in rx_a.finditer(text):
                out.append(Finding(
                    rule_id=rid,
                    category="medical_terms",
                    start=m.start(),
                    end=m.end(),
                    original=m.group(0),
                    suggestion=word_b,
                    message=_message_for_confusable(rule, word_a, word_b),
                    severity="warning",
                    autofixable=effective_tb == "auto_replace",
                ))

        # Flag B when A's cue words dominate and B's don't.
        if has_b and cue_a_hits > 0 and cue_b_hits == 0:
            for m in rx_b.finditer(text):
                out.append(Finding(
                    rule_id=rid,
                    category="medical_terms",
                    start=m.start(),
                    end=m.end(),
                    original=m.group(0),
                    suggestion=word_a,
                    message=_message_for_confusable(rule, word_b, word_a),
                    severity="warning",
                    autofixable=effective_tb == "auto_replace",
                ))
    return out


def _confidence_to_severity(confidence: Optional[str]) -> str:
    """Map workbook confidence to the engine's severity axis.

    * ``High``            → warning (actionable, but not fatal)
    * ``Medium - verify`` → suggestion (reviewer discretion)
    * ``Low``             → suggestion
    """
    c = (confidence or "").strip().lower()
    if c == "high":
        return "warning"
    if c in ("medium - verify", "medium", "low"):
        return "suggestion"
    return "warning"


# ---------------------------------------------------------------------------
# Overlap dedup
# ---------------------------------------------------------------------------

def _dedup_longest_match_wins(findings: list[Finding]) -> list[Finding]:
    """Keep the longest span for any overlapping group of medical findings.

    Ties break on earlier start. This mirrors the pattern used in
    abbreviations.py so a 3-word phrase match wins over a 1-word match
    sitting inside it (e.g., "ulcerative colitis" over "colitis").
    """
    if not findings:
        return findings
    # Sort by start, then by span-length descending.
    findings = sorted(findings, key=lambda f: (f.start, -(f.end - f.start)))
    kept: list[Finding] = []
    for f in findings:
        if kept:
            last = kept[-1]
            if f.start < last.end:
                # overlap — only replace if strictly longer AND same start
                # (shorter-same-start was already pruned by the sort above)
                continue
        kept.append(f)
    return kept


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def analyze_medical_terms(
    text: str,
    *,
    para_idx: int = 0,  # kept for parity with other analysers; not used today
    style_profile: str = DEFAULT_STYLE_PROFILE,
    rule_overrides: Optional[dict] = None,
) -> list[Finding]:
    """Run all three medical sub-analysers against one paragraph of text.

    Returns a de-duplicated list of :class:`Finding`. Never mutates
    ``text``. Safe to call on empty / whitespace-only input (returns ``[]``).
    """
    if not text or not text.strip():
        return []
    if style_profile not in VALID_STYLE_PROFILES:
        style_profile = DEFAULT_STYLE_PROFILE
    overrides = rule_overrides or {}

    findings: list[Finding] = []
    findings.extend(_detect_findings(text, style_profile=style_profile, rule_overrides=overrides))
    findings.extend(_pattern_findings(text, style_profile=style_profile, rule_overrides=overrides))
    findings.extend(_confusable_findings(text, rule_overrides=overrides))
    return _dedup_longest_match_wins(findings)
