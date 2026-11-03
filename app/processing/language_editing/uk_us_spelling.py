"""US / UK spelling workbook runtime.

Loads the five committed JSON sidecars (variants, common-both-valid,
patterns, protected phrases, rule table) and exposes:

  * :func:`preferred_terms_for` — set of lowercased spellings that are
    *correct* for a given document variant. Feeds the pyspellchecker
    whitelist so a UK-correct word like "colour" does not surface as a
    typo in a UK document.
  * :func:`analyze_uk_us_spelling` — paragraph-level analyser called from
    :func:`engine.analyze`. Produces :class:`Finding` objects for words
    that use the wrong-regional spelling for the document's variant.

Direction awareness (decision 3 — en-GB default)
------------------------------------------------
  * ``en-GB``          — standard UK (default). Flags US forms, suggests
    UK form. Oxford-ize spellings (``organize``) are NOT accepted.
  * ``en-US``          — standard US. Flags UK forms, suggests US form.
  * ``en-GB-oxendict`` — UK with Oxford spelling. Flags US forms EXCEPT
    those that the workbook lists as a UK alternative under Oxford
    (``uk_alternatives`` includes the US form), in which case the word
    is accepted. Still flags UK-only forms that are wrong for Oxford.

Scope-C invariant preserved — both ``flag`` and ``auto_replace`` produce
reviewable findings. The engine NEVER mutates the input text; the Review
Page's explicit-acceptance flow decides whether the manuscript changes.

Safety layers (in order of application)
---------------------------------------
  1. ``Common_Spellings`` (552 both-valid words) — a word in this list
     is always correct and never flagged.
  2. ``Protected_Terms`` (28 phrases: WHO, ISO, NIH, …) — matches inside
     these phrases are skipped so proper-name capitalisation /
     spelling is preserved.
  3. ``validation_status`` filter — ``disputed`` entries never fire.
  4. Per-entry Scope-C ``rule_overrides`` — projects can disable or
     flip tool_behaviour per entry_id.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .rules import Finding

logger = logging.getLogger(__name__)


_CONFIG_DIR = Path(__file__).parent / "config" / "profiles"
_VARIANTS_JSON = _CONFIG_DIR / "uk_us_spelling_variants.json"
_COMMON_JSON = _CONFIG_DIR / "uk_us_spelling_common.json"
_PATTERNS_JSON = _CONFIG_DIR / "uk_us_spelling_patterns.json"
_PROTECTED_JSON = _CONFIG_DIR / "uk_us_spelling_protected.json"
_RULES_JSON = _CONFIG_DIR / "uk_us_spelling_rules.json"


DEFAULT_DOCUMENT_VARIANT = "en-GB"
VALID_DOCUMENT_VARIANTS = ("en-GB", "en-US", "en-GB-oxendict")


# ---------------------------------------------------------------------------
# JSON loading (lru-cached)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("uk_us_spelling config missing: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("uk_us_spelling config invalid JSON at %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def _variants_data() -> dict:
    return _load_json(_VARIANTS_JSON)


@lru_cache(maxsize=1)
def _common_data() -> dict:
    return _load_json(_COMMON_JSON)


@lru_cache(maxsize=1)
def _patterns_data() -> dict:
    return _load_json(_PATTERNS_JSON)


@lru_cache(maxsize=1)
def _protected_data() -> dict:
    return _load_json(_PROTECTED_JSON)


@lru_cache(maxsize=1)
def _rules_data() -> dict:
    return _load_json(_RULES_JSON)


def clear_cache() -> None:
    _variants_data.cache_clear()
    _common_data.cache_clear()
    _patterns_data.cache_clear()
    _protected_data.cache_clear()
    _rules_data.cache_clear()
    _common_spellings_lc.cache_clear()
    _protected_terms_compiled.cache_clear()
    _variants_index.cache_clear()
    _preferred_terms_en_us.cache_clear()
    _preferred_terms_en_gb.cache_clear()
    _preferred_terms_en_gb_oxendict.cache_clear()


# ---------------------------------------------------------------------------
# Safety layer 1: Common_Spellings (both-valid words — never flag)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _common_spellings_lc() -> frozenset[str]:
    """Lowercased set of 552 words valid in BOTH US and UK English.

    A match on any of these words — even if some other variant row
    would ``technically`` apply — is always correct and never flagged.
    """
    out: set[str] = set()
    for row in _common_data().get("entries", []) or []:
        s = (row.get("spelling") or "").strip().lower()
        if s:
            out.add(s)
    return frozenset(out)


# ---------------------------------------------------------------------------
# Safety layer 2: Protected_Terms (exact-phrase skip)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _protected_terms_compiled() -> list[tuple[re.Pattern, dict]]:
    """Compile each Protected_Terms row into a regex that respects the
    workbook's ``case_sensitive`` + ``match_type`` columns.

    Returns ``[(compiled_regex, row_dict), …]`` so the caller can emit
    diagnostics or just filter by span overlap.
    """
    out: list[tuple[re.Pattern, dict]] = []
    for row in _protected_data().get("entries", []) or []:
        term = row.get("term")
        if not term:
            continue
        mtype = (row.get("match_type") or "exact_phrase").lower()
        case_sensitive = bool(row.get("case_sensitive", True))
        flags = 0 if case_sensitive else re.IGNORECASE

        if mtype == "regex":
            # Pre-vetted regex patterns from editorial — trust but compile.
            try:
                rx = re.compile(term, flags)
            except re.error as exc:
                logger.warning("protected term %s: bad regex %s", row.get("term_id"), exc)
                continue
        else:
            # exact_phrase / word both resolve to a word-boundaried
            # literal match. Phrases may embed whitespace runs, so match
            # any whitespace between tokens rather than a single space.
            escaped = re.escape(term)
            # Collapse escaped single spaces into \s+ to tolerate
            # non-breaking space, double-space, line-wrap variants.
            escaped = escaped.replace(r"\ ", r"\s+")
            rx = re.compile(rf"\b{escaped}\b", flags)
        out.append((rx, row))
    return out


def _protected_spans_in(text: str) -> list[tuple[int, int]]:
    """Return merged non-overlapping spans in ``text`` covered by any
    Protected_Terms match. Used to filter uk_us_spelling findings before
    they're emitted (so a match on "Organization" inside "World Health
    Organization" is suppressed)."""
    if not text:
        return []
    raw: list[tuple[int, int]] = []
    for rx, _row in _protected_terms_compiled():
        for m in rx.finditer(text):
            raw.append((m.start(), m.end()))
    if not raw:
        return []
    raw.sort()
    merged: list[list[int]] = [list(raw[0])]
    for s, e in raw[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged]


def protected_phrases() -> list[str]:
    """Public: lowercased protected phrase strings — used by spell_check
    whitelist feed so pyspellchecker doesn't flag words inside WHO / ISO / …
    """
    return [
        (row.get("term") or "").strip()
        for row in _protected_data().get("entries", []) or []
        if row.get("term")
    ]


# ---------------------------------------------------------------------------
# Variants index — lookup by lowercased spelling
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _variants_index() -> dict[str, list[dict]]:
    """Lowercased-spelling → list of variant rows that reference it.

    Both ``us_spelling`` and ``uk_spelling`` are indexed. A single word
    may appear on multiple rows (plural + base + inflection); the
    analyser iterates and picks the appropriate suggestion for the
    document variant.
    """
    out: dict[str, list[dict]] = {}
    for row in _variants_data().get("entries", []) or []:
        for key_field in ("us_spelling", "uk_spelling"):
            w = (row.get(key_field) or "").strip().lower()
            if w:
                out.setdefault(w, []).append(row)
    return out


# ---------------------------------------------------------------------------
# Preferred-terms whitelist per variant (feeds spell_check)
# ---------------------------------------------------------------------------

def _preferred_terms_for(variant: str) -> frozenset[str]:
    """Return lowercased set of spellings CORRECT for the given document
    variant. Feeds the pyspellchecker whitelist so correct regional words
    don't fire as typos.

    * ``en-US``          — US spellings
    * ``en-GB``          — UK spellings (standard -ise)
    * ``en-GB-oxendict`` — UK spellings PLUS any US form the workbook
                           lists as a UK alternative (Oxford -ize set)
    """
    out: set[str] = set()
    data = _variants_data()
    for row in data.get("entries", []) or []:
        us = (row.get("us_spelling") or "").strip().lower()
        uk = (row.get("uk_spelling") or "").strip().lower()
        if variant == "en-US" and us:
            out.add(us)
            for alt in row.get("us_alternatives") or []:
                out.add(alt.strip().lower())
        elif variant == "en-GB" and uk:
            out.add(uk)
        elif variant == "en-GB-oxendict":
            if uk:
                out.add(uk)
            for alt in row.get("uk_alternatives") or []:
                a = alt.strip().lower()
                if a:
                    out.add(a)
    # Common_Spellings are always valid.
    out.update(_common_spellings_lc())
    return frozenset(out)


@lru_cache(maxsize=1)
def _preferred_terms_en_us() -> frozenset[str]:
    return _preferred_terms_for("en-US")


@lru_cache(maxsize=1)
def _preferred_terms_en_gb() -> frozenset[str]:
    return _preferred_terms_for("en-GB")


@lru_cache(maxsize=1)
def _preferred_terms_en_gb_oxendict() -> frozenset[str]:
    return _preferred_terms_for("en-GB-oxendict")


def preferred_terms_for(document_variant: str) -> frozenset[str]:
    """Public — used by spell_check.build_whitelist."""
    if document_variant == "en-US":
        return _preferred_terms_en_us()
    if document_variant == "en-GB-oxendict":
        return _preferred_terms_en_gb_oxendict()
    return _preferred_terms_en_gb()


# ---------------------------------------------------------------------------
# Scope-C override helpers (same shape as other workbook modules)
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


# ---------------------------------------------------------------------------
# Direction logic
# ---------------------------------------------------------------------------

def _pick_suggestion(row: dict, found_word: str, document_variant: str) -> Optional[tuple[str, str, str, bool]]:
    """For a variant row that was matched in ``text``, decide whether the
    match is actually wrong-for-this-document, and if so return
    ``(suggestion, action, severity, autocorrect_safe)``.

    Returns ``None`` when the match is correct for the document and
    should NOT be flagged. Three cases produce ``None``:
      * document is en-US and the found word is the US spelling (correct)
      * document is en-GB and the found word is the UK spelling (correct)
      * document is en-GB-oxendict and the found word is listed in
        ``uk_alternatives`` (Oxford opt-in accepts e.g. "organize")
    """
    us = (row.get("us_spelling") or "").strip()
    uk = (row.get("uk_spelling") or "").strip()
    found_lc = found_word.lower()

    is_us_form = found_lc == us.lower()
    is_uk_form = found_lc == uk.lower()
    if not (is_us_form or is_uk_form):
        # Fell through from the index but doesn't match either canonical
        # form — probably an alternative; don't flag.
        return None

    # en-GB-oxendict: accept US forms when workbook lists them as a UK
    # alternative (Oxford -ize set). This is the ONLY path that treats
    # the US form as valid under a UK variant.
    if document_variant == "en-GB-oxendict" and is_us_form:
        uk_alts_lc = {a.strip().lower() for a in (row.get("uk_alternatives") or [])}
        if found_lc in uk_alts_lc:
            return None

    if document_variant == "en-US":
        if is_us_form:
            return None  # correct for the document
        # Found a UK form in a US doc → suggest US.
        action = row.get("us_doc_action") or "flag_suggest"
        severity = row.get("us_doc_severity") or "warning"
        autocorrect_safe = bool(row.get("us_doc_autocorrect_safe"))
        return (us, action, severity, autocorrect_safe)

    # en-GB and en-GB-oxendict share the same UK-document rules except
    # for the uk_alternatives acceptance above.
    if is_uk_form:
        return None  # correct for the document
    # Found a US form in a UK doc → suggest UK.
    action = row.get("uk_doc_action") or "flag_suggest"
    severity = row.get("uk_doc_severity") or "warning"
    autocorrect_safe = bool(row.get("uk_doc_autocorrect_safe"))
    return (uk, action, severity, autocorrect_safe)


def _match_case(src: str, canon: str) -> str:
    """Preserve the capitalisation shape of ``src`` on ``canon``."""
    if not src:
        return canon
    if src.isupper():
        return canon.upper()
    if src[0].isupper():
        return canon[0].upper() + canon[1:]
    return canon


def _resolve_tool_behaviour(action: str, autocorrect_safe: bool, status: str) -> str:
    """Workbook action + status → engine tool_behaviour.

    * ``disputed`` → never auto-replace (caller already skipped the row
      entirely but this is a defensive secondary gate).
    * ``needs_review`` → flag only, even if the action says
      flag_autocorrect, because the entry hasn't been safety-reviewed yet.
    * ``dictionary_checked`` + ``flag_autocorrect`` + ``autocorrect_safe=Y``
      → auto_replace (reviewer still clicks accept per Scope-C).
    * Everything else → flag.
    """
    if status == "disputed":
        return "flag"
    if status == "needs_review":
        return "flag"
    if action == "flag_autocorrect" and autocorrect_safe:
        return "auto_replace"
    return "flag"


def _severity_slug(workbook_severity: str) -> str:
    """Map workbook severity values to engine's {error, warning, suggestion}."""
    s = (workbook_severity or "").strip().lower()
    if s == "error":
        return "error"
    if s in ("warning", "warn"):
        return "warning"
    if s in ("info", "info or warning", "suggestion"):
        return "suggestion"
    return "warning"


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

_WORD_RE = re.compile(r"[A-Za-z][A-Za-z\-']*")


def analyze_uk_us_spelling(
    text: str,
    *,
    document_variant: str = DEFAULT_DOCUMENT_VARIANT,
    rule_overrides: Optional[dict] = None,
) -> list[Finding]:
    """Scan one paragraph for wrong-direction regional spellings.

    Produces :class:`Finding` objects with ``category='spelling'`` so
    they slot into the existing Spelling chip in the Review UI. Never
    mutates ``text``.
    """
    if not text or not text.strip():
        return []
    if document_variant not in VALID_DOCUMENT_VARIANTS:
        document_variant = DEFAULT_DOCUMENT_VARIANT
    overrides = rule_overrides or {}

    index = _variants_index()
    if not index:
        return []
    common_lc = _common_spellings_lc()
    protected_spans = _protected_spans_in(text)

    def _span_is_protected(start: int, end: int) -> bool:
        for ps, pe in protected_spans:
            if start < pe and end > ps:
                return True
        return False

    out: list[Finding] = []
    seen_spans: set[tuple[int, int]] = set()

    for m in _WORD_RE.finditer(text):
        word = m.group(0)
        wlc = word.lower()

        # Safety layer 1: both-valid word.
        if wlc in common_lc:
            continue

        rows = index.get(wlc)
        if not rows:
            continue

        # Safety layer 2: span lives inside a protected phrase.
        if _span_is_protected(m.start(), m.end()):
            continue

        # Dedup when a word appears in multiple rows (plural + base + …).
        # First row that produces a non-None suggestion wins; subsequent
        # rows for the same span are skipped.
        for row in rows:
            # Scope-C per-entry override + disputed filter.
            entry_id = row.get("entry_id") or ""
            if _rule_disabled_by_override(entry_id, overrides):
                continue
            status = (row.get("validation_status") or "").lower()
            if status == "disputed":
                # Disputed entries never fire regardless of status setting.
                continue

            pick = _pick_suggestion(row, word, document_variant)
            if pick is None:
                continue
            suggestion_canon, action, severity, autocorrect_safe = pick

            span_key = (m.start(), m.end())
            if span_key in seen_spans:
                break
            seen_spans.add(span_key)

            default_tb = _resolve_tool_behaviour(action, autocorrect_safe, status)
            effective_tb = _effective_tool_behaviour(entry_id, overrides, default_tb)

            # requires_context=Y should never auto-replace even if the
            # row otherwise permits it (POS/semantic ambiguity).
            if row.get("requires_context"):
                effective_tb = "flag"

            sug = _match_case(word, suggestion_canon)
            msg = _format_message(row, word, sug, document_variant)

            out.append(Finding(
                rule_id=entry_id,
                category="spelling",
                start=m.start(),
                end=m.end(),
                original=word,
                suggestion=sug,
                message=msg,
                severity=_severity_slug(severity),
                autofixable=effective_tb == "auto_replace",
            ))
            break
    return out


def _format_message(row: dict, found: str, suggestion: str, document_variant: str) -> str:
    """Build a one-line finding message surfacing status + pattern +
    context notes. Follows the Rule_Table message_template shape:

        ``{found} is the {found_region} spelling; {doc_region} English
        uses {suggestion} ({pattern}).``

    Needs-review + disputed get a leading note so reviewers see the
    status up-front.
    """
    us_lc = (row.get("us_spelling") or "").lower()
    found_lc = found.lower()
    found_region = "US" if found_lc == us_lc else "UK"
    doc_region = {
        "en-US": "US", "en-GB": "UK", "en-GB-oxendict": "UK (Oxford)",
    }.get(document_variant, document_variant)
    pattern = row.get("spelling_pattern") or ""
    status = (row.get("validation_status") or "").lower()
    status_prefix = ""
    if status == "needs_review":
        status_prefix = "Review: "
    elif status == "disputed":
        status_prefix = "Disputed: "
    base = (
        f"{status_prefix}{found!r} is the {found_region} spelling; "
        f"{doc_region} English uses {suggestion!r}"
    )
    if pattern:
        base += f" ({pattern})"
    base += "."
    if row.get("requires_context"):
        base += " Verify in context."
    return base
