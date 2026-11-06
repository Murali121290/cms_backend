"""LWW-NE workbook runtime (Phase 2).

Loads the Phase-1 committed JSON (``lww_ne_terms.json``) and exposes:

  * :func:`analyze_lww_ne` — paragraph-level analyser called from
    :func:`engine.analyze`. Produces :class:`Finding` objects with the
    appropriate category per workbook row (spelling / hyphenation /
    abbreviations / bias) so findings slot into the existing UI chips.
  * :func:`compute_active_tags` — pure function that derives the
    project's active tag set from (``profile_keys``, ``is_lww_ne_project``).
    Matches the semantics agreed in Q1/Q2:
      - ``APA`` ∈ active when ``'apa'`` is in profile_keys
      - ``AMA`` ∈ active when ``'ama'`` is in profile_keys
      - ``NE`` ∈ active when the LWW_NE term list (ID 11, name 'LWW_NE')
        is assigned to the project
      - ``Generic`` is NEVER in the active set — it short-circuits as a
        per-row flag (``is_generic``) so Generic rows fire in every
        project regardless of profile or term-list assignment
      - ``Eponym`` is NEVER in the active set per the final Q2 decision —
        Eponym-tagged rows fire only via their other tags (APA/AMA/NE)

Four safety layers applied in :func:`analyze_lww_ne`:

  1. ``validation_status != "ok"`` → skip. Covers Q4 (22 quarantined)
     and Q6 (4 annotation_unclarified) rows which the Phase-1 importer
     has already tagged inactive.
  2. ``runtime_mode != "scan"`` → skip. Covers Q5 (78 editor_hint /
     Partial word rows) which are editor-review-only hints.
  3. ``confidence == "Unknown"`` → force ``tool_behaviour = "flag"``
     regardless of the row's Action, so Unknown-confidence rows are
     always flagged for reviewer attention and never auto-replaced.
     Covers Q7.
  4. Scope-C per-entry ``rule_overrides[entry_id]`` → honours
     per-project enable / tool_behaviour flip (same machinery as the
     other four workbook modules).

Scope-C invariant preserved — both ``flag`` and ``auto_replace`` produce
reviewable findings. The engine NEVER mutates the input text.

Row-to-category routing is driven by the workbook ``Category`` column:

  ================================  =====================
  Workbook Category                 Engine Finding.category
  ================================  =====================
  Spelling / Spelling (US) /        spelling
  Plural or singular / Form /
  Style / Misspelling
  Hyphenation / Closed compound /   hyphenation
  Open compound / Open or closed /
  Prefix (closed) / Hyphenation
  and case
  Abbreviation                      abbreviations
  Person-first language             bias
  Retain / Proper name / Context /  spelling (fallback — rows with
  Trademark / Eponym / Symbol or    Tool behaviour='No action' never
  format / Capitalization / Unit /  reach findings-emit; others get
  Device term / Unclear term /      a generic 'spelling' chip)
  Fragment (if ever reaches scan)
  ================================  =====================
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
_TERMS_JSON = _CONFIG_DIR / "lww_ne_terms.json"


# ---------------------------------------------------------------------------
# JSON loading (lru-cached)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("lww_ne config missing: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("lww_ne config invalid JSON at %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def _terms_data() -> dict:
    return _load_json(_TERMS_JSON)


def clear_cache() -> None:
    _terms_data.cache_clear()
    _compiled_entries.cache_clear()


# ---------------------------------------------------------------------------
# Active-tag-set composition (pure function — DB-free for testability)
# ---------------------------------------------------------------------------

#: The canonical LWW_NE term_list id. Source of truth is a name lookup at
#: runtime; this constant is the fallback used when name lookup fails
#: (e.g. staging DBs where seed order differs). See
#: ``get_lww_ne_term_list_id`` for the lookup helper used by the router.
LWW_NE_TERM_LIST_ID_FALLBACK = 11
LWW_NE_TERM_LIST_NAME = "LWW_NE"


def compute_active_tags(
    project_profile_keys: Optional[Iterable[str]],
    *,
    is_lww_ne_project: bool,
) -> set[str]:
    """Return the project's active tag set (subset of {APA, AMA, NE}).

    Generic is intentionally NOT included — Generic-tagged rows fire via
    the per-row ``is_generic`` short-circuit, not via set membership.
    Eponym is intentionally NOT included — Eponym-tagged rows fire only
    via their other tags per the final Q2 decision.
    """
    tags: set[str] = set()
    pks = {str(k).strip().lower() for k in (project_profile_keys or ())}
    if "apa" in pks:
        tags.add("APA")
    if "ama" in pks:
        tags.add("AMA")
    if is_lww_ne_project:
        tags.add("NE")
    return tags


def get_lww_ne_term_list_id(db) -> int:
    """Resolve the LWW_NE term_list id for THIS environment.

    Name lookup first (robust across environments where seed order may
    vary); falls back to the historical id 11 if the name lookup fails.
    Keep this cheap — the router calls it once per analyze request.
    """
    try:
        from app.domains.term_lists.models import TermList
        row = (
            db.query(TermList.id)
            .filter(TermList.name == LWW_NE_TERM_LIST_NAME)
            .first()
        )
        if row and row[0]:
            return int(row[0])
    except Exception as exc:
        logger.warning(
            "lww_ne: failed to look up TermList by name %r, falling back to id %d: %s",
            LWW_NE_TERM_LIST_NAME, LWW_NE_TERM_LIST_ID_FALLBACK, exc,
        )
    return LWW_NE_TERM_LIST_ID_FALLBACK


# ---------------------------------------------------------------------------
# Category routing — workbook Category → engine Finding.category
# ---------------------------------------------------------------------------

_SPELLING_CATEGORIES = frozenset({
    "Spelling", "Spelling (US)", "Plural or singular", "Form", "Style",
    "Misspelling",
})
_HYPHENATION_CATEGORIES = frozenset({
    "Hyphenation", "Closed compound", "Open compound", "Open or closed",
    "Prefix (closed)", "Hyphenation and case",
})
_ABBREVIATION_CATEGORIES = frozenset({"Abbreviation"})
_BIAS_CATEGORIES = frozenset({"Person-first language"})


def _category_to_engine_category(workbook_category: Optional[str]) -> str:
    """Map workbook Category → engine Finding.category so findings land
    in the right existing UI chip (no new UI category per spec)."""
    c = workbook_category or ""
    if c in _HYPHENATION_CATEGORIES:
        return "hyphenation"
    if c in _ABBREVIATION_CATEGORIES:
        return "abbreviations"
    if c in _BIAS_CATEGORIES:
        return "bias"
    if c in _SPELLING_CATEGORIES:
        return "spelling"
    # Fallback for everything else (Retain / Proper name / Context /
    # Trademark / Eponym classification / Symbol or format /
    # Capitalization / Unit / Device term / Unclear term / Fragment).
    # Retain rows don't emit findings (tool_behaviour='No action') so
    # this fallback only reaches the others.
    return "spelling"


# ---------------------------------------------------------------------------
# Per-entry regex compilation
# ---------------------------------------------------------------------------

def _compile_matcher(entry: dict) -> Optional[re.Pattern]:
    """Compile a regex for one entry per its Match type + Match case.

    Returns ``None`` when the entry's match_type is one the Phase-2
    runtime does NOT scan (``Partial word``) or when the pattern fails
    to compile.
    """
    source = entry.get("source_term") or ""
    match_type = entry.get("match_type") or ""
    case_sensitive = bool(entry.get("match_case", False))
    flags = 0 if case_sensitive else re.IGNORECASE

    if not source:
        return None

    if match_type == "Partial word":
        # Decision Q5 — editor_hint, not scanned. The analyser's step-2
        # filter already excludes these; the explicit None here is
        # defense in depth so any mistagged row doesn't produce
        # false-positive matches via substring semantics.
        return None

    try:
        if match_type == "Exact text":
            # Decision 6 — literal match, no word boundaries added.
            # Formatting rows like 'PaCO2' → 'PaCO₂' need case-sensitive
            # verbatim match (match_case will be True for these).
            return re.compile(re.escape(source), flags)

        if match_type == "Phrase":
            # Phrase: escape, but collapse escaped single spaces so
            # multi-space / NBSP / line-wrap variants still match.
            escaped = re.escape(source).replace(r"\ ", r"\s+")
            return re.compile(escaped, flags)

        # Default: Whole word — \b boundaries + escape.
        escaped = re.escape(source).replace(r"\ ", r"\s+")
        return re.compile(rf"\b{escaped}\b", flags)
    except re.error as exc:
        logger.warning(
            "lww_ne entry %r (%s): failed to compile matcher for %r: %s",
            entry.get("_row_num"), match_type, source, exc,
        )
        return None


@lru_cache(maxsize=1)
def _compiled_entries() -> list[dict]:
    """Return every JSON entry augmented with a compiled matcher.

    Rows that fail the Phase-2 runtime filters (``validation_status != 'ok'``
    or ``runtime_mode != 'scan'``) are EXCLUDED here so the per-paragraph
    scan doesn't have to re-check them on every call. Rows whose matcher
    fails to compile are also excluded (already logged by ``_compile_matcher``).
    """
    data = _terms_data()
    entries = data.get("entries") or []
    out: list[dict] = []
    for e in entries:
        if e.get("validation_status") != "ok":
            continue
        if e.get("runtime_mode") != "scan":
            continue
        rx = _compile_matcher(e)
        if rx is None:
            continue
        # Shallow copy + attach compiled regex so the per-paragraph scan
        # doesn't recompile. We never mutate the JSON-backed dict so this
        # is safe even though _terms_data is lru_cached.
        entry = dict(e)
        entry["_rx"] = rx
        entry["_tag_set"] = frozenset(
            r.get("rule_run") for r in (e.get("rule_runs") or [])
            if r.get("rule_run")
        )
        # Canonical rule id used both as Finding.rule_id AND as the key
        # for Scope-C per-entry overrides. Prefix keeps the id unique
        # across workbook namespaces (SV- for uk_us_spelling, MT- for
        # medical_terms, HY- for hyphenation, etc.). The LWW-NE workbook
        # has no native id column, so source_term is the discriminator.
        entry["_rule_id"] = f"LWW-NE-{e.get('source_term') or ''}"
        out.append(entry)
    return out


# ---------------------------------------------------------------------------
# Row-level filter + tool_behaviour resolution
# ---------------------------------------------------------------------------

def _row_applies_to_project(entry: dict, active_tags: frozenset[str] | set[str]) -> bool:
    """Decide whether one workbook row fires in this project.

    Generic-tagged rows short-circuit to True (Decision 8).
    Non-Generic rows require set intersection with the project's active
    tag set (Q1 — filter semantics).
    """
    if entry.get("is_generic"):
        return True
    row_tags = entry.get("_tag_set") or frozenset()
    if not row_tags:
        # Row with no Rule Runs would have been skipped at import; this
        # is a defensive guard.
        return False
    return bool(row_tags & active_tags)


def _rule_disabled_by_override(entry_id: str, overrides: dict) -> bool:
    o = (overrides or {}).get(entry_id) or {}
    return "enabled" in o and not o["enabled"]


def _resolve_tool_behaviour(entry: dict, overrides: dict) -> str:
    """Workbook (Action, Tool behaviour) → engine tool_behaviour.

    Precedence (highest first):

      1. Scope-C override — ``rule_overrides[rule_id]['tool_behaviour']``
         wins unconditionally when present. Override key is the FULL
         ``LWW-NE-{source_term}`` id, matching Finding.rule_id.
      2. Q7 safety — ``confidence == "Unknown"`` forces ``flag`` and
         never ``auto_replace`` regardless of workbook intent.
      3. Workbook ``Tool behaviour`` maps:
           - "Auto-replace"                     → auto_replace
           - "Flag and suggest"                 → flag
           - "Flag and suggest (formatting)"    → flag
           - "Flag only (review)"               → flag
           - "No action (protected form)"       → flag  (defensive; caller
             should have filtered these out before calling)
      4. Default when workbook value is missing or unrecognised → flag.
    """
    override = (overrides or {}).get(entry.get("_rule_id") or "") or {}
    o_tb = override.get("tool_behaviour")
    if o_tb in ("flag", "auto_replace"):
        return o_tb

    # Q7: Unknown-confidence rows must never auto-replace.
    if (entry.get("confidence") or "") == "Unknown":
        return "flag"

    tb = entry.get("tool_behaviour") or ""
    if tb == "Auto-replace":
        return "auto_replace"
    return "flag"


def _severity_for_entry(entry: dict) -> str:
    """Pick a severity for the finding.

    * ``Review`` action + ``Flag only (review)`` tool behaviour → suggestion
    * ``Auto-replace`` → warning
    * Unknown confidence → suggestion (less assertive)
    * Else → warning
    """
    if (entry.get("confidence") or "") == "Unknown":
        return "suggestion"
    tb = entry.get("tool_behaviour") or ""
    if tb == "Flag only (review)":
        return "suggestion"
    return "warning"


def _match_case_preserve(source: str, suggestion: str) -> str:
    """Preserve the capitalisation shape of ``source`` on ``suggestion``.

    Only applied when the row's match_case is False (case-insensitive
    matching). Case-sensitive rows match verbatim so the suggestion
    stays as-is.
    """
    if not source or not suggestion:
        return suggestion
    if source.isupper():
        return suggestion.upper()
    if source[0].isupper() and not source.isupper():
        return suggestion[0].upper() + suggestion[1:]
    return suggestion


def _format_message(entry: dict, found: str, suggestion: Optional[str]) -> str:
    """Compose a reviewer-facing message that surfaces Category + MW note."""
    cat = entry.get("category") or "LWW-NE"
    action = entry.get("action") or "Review"
    note_bits: list[str] = []
    if suggestion:
        note_bits.append(f"{found!r} → {suggestion!r}")
    else:
        note_bits.append(f"{found!r} ({action})")
    if cat:
        note_bits.append(cat)
    mw = entry.get("mw_note")
    if mw:
        note_bits.append(str(mw))
    conf = entry.get("confidence")
    if conf in ("Medium - verify", "Low - verify", "Unknown"):
        note_bits.append(f"Confidence: {conf}")
    return " — ".join(note_bits)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def analyze_lww_ne(
    text: str,
    *,
    project_profile_keys: Optional[Iterable[str]] = None,
    is_lww_ne_project: bool = False,
    rule_overrides: Optional[dict] = None,
) -> list[Finding]:
    """Scan one paragraph against the LWW-NE workbook and emit findings.

    Returns a de-duplicated list of :class:`Finding`. Never mutates
    ``text``. Safe to call on empty / whitespace-only input (returns ``[]``).

    Rows with ``Tool behaviour == 'No action (protected form)'`` are
    silently skipped — those rows exist in the workbook to protect
    correct forms, not to emit findings.
    """
    if not text or not text.strip():
        return []

    active_tags = compute_active_tags(
        project_profile_keys, is_lww_ne_project=is_lww_ne_project,
    )
    overrides = rule_overrides or {}

    try:
        compiled = _compiled_entries()
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("lww_ne: failed to load compiled entries: %s", exc)
        return []

    out: list[Finding] = []
    # Span dedup: a word that matches two overlapping workbook entries
    # (e.g. 'healthcare' as both Hyphenation and Spelling) is emitted
    # only once per unique (start, end) span. First match per span wins
    # to keep behaviour deterministic.
    seen_spans: set[tuple[int, int]] = set()

    for entry in compiled:
        rule_id = entry["_rule_id"]
        # Scope-C disable override. Key = full ``LWW-NE-{source_term}``
        # id (matches Finding.rule_id so the Rules Picker can map
        # 1:1 between what reviewers see and what they can override).
        if _rule_disabled_by_override(rule_id, overrides):
            continue
        # Workbook 'No action (protected form)' rows never produce
        # findings — they exist to document that the form is correct.
        if (entry.get("tool_behaviour") or "") == "No action (protected form)":
            continue
        # Row-level filter: Generic short-circuit OR tag intersection.
        if not _row_applies_to_project(entry, active_tags):
            continue

        rx: re.Pattern = entry["_rx"]
        suggestions = entry.get("suggestions") or []
        primary_suggestion_raw = suggestions[0] if suggestions else None
        alt_suggestions_raw = list(suggestions[1:]) if len(suggestions) > 1 else []
        tool_behaviour = _resolve_tool_behaviour(entry, overrides)
        severity = _severity_for_entry(entry)
        category = _category_to_engine_category(entry.get("category"))
        match_case = bool(entry.get("match_case", False))

        try:
            iter_matches = list(rx.finditer(text))
        except re.error as exc:
            logger.warning(
                "lww_ne entry %s: regex scan failed on text: %s",
                rule_id, exc,
            )
            continue

        for m in iter_matches:
            span = (m.start(), m.end())
            if span in seen_spans:
                continue
            seen_spans.add(span)

            found_text = m.group(0)
            if primary_suggestion_raw is None:
                primary_suggestion = found_text  # flag-only row; no replacement
            elif match_case:
                primary_suggestion = primary_suggestion_raw  # verbatim
            else:
                primary_suggestion = _match_case_preserve(found_text, primary_suggestion_raw)

            alt_cased = (
                [_match_case_preserve(found_text, a) for a in alt_suggestions_raw]
                if not match_case
                else list(alt_suggestions_raw)
            )

            out.append(Finding(
                rule_id=rule_id,
                category=category,
                start=m.start(),
                end=m.end(),
                original=found_text,
                suggestion=primary_suggestion,
                message=_format_message(entry, found_text, primary_suggestion_raw),
                severity=severity,
                autofixable=tool_behaviour == "auto_replace",
                alt_suggestions=alt_cased,
            ))
    return out
