"""Abbreviations & first-use workbook runtime.

Phase A (shipped): Do_Not_Use regex detection + Rules Picker surface.

Phase B (this update): document-scope rule engine.
  * ``build_document_state(paragraphs, *, audience, min_uses, rule_overrides)``
    pre-scans every paragraph once to produce a dict keyed by abbreviation
    with every occurrence, every expansion mention, and every definition
    pattern it finds. The engine then calls :func:`analyze_abbreviations`
    per-paragraph with that state threaded through.
  * The following Expansion_Rules fire in Phase B:
      - AB01  first use without a definition  (flag, suggest "exp (ABBR)")
      - AB02  expansion repeated after the abbreviation is defined (auto)
      - AB04  definition repeated                                    (auto)
      - AB05  single use → spell out                                 (flag)
      - AB09  apostrophe in a plural abbreviation                    (auto)
      - AB10  article agreement                                      (auto)
      - AB13  periods in an initialism                               (auto)
      - AB17  never expand                                           (filter)
  * Filters honoured: ``do_not_abbreviate``, ``no_expansion_needed``,
    ``expand_for_general_only`` × audience, and the Scope-C per-rule
    override map.
  * Deferred to Phase C: AB03 reorder, AB06 inconsistent abbrs,
    AB07 context disambiguation, AB16 scopeReset.
  * Deferred to Phase D (needs paragraph-style metadata we don't have
    in a plain text list): AB11 titles, AB12 abstract/body, AB14 case,
    AB15 tables/figures.

Scope-C invariant preserved: both FLAG and AUTO_REPLACE produce reviewable
findings. The engine NEVER mutates the input text — every rule emits a
``Finding`` and the Review Page's explicit-acceptance flow decides whether
the manuscript actually changes.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from .rules import Finding

logger = logging.getLogger(__name__)


_CONFIG_DIR = Path(__file__).parent / "config" / "profiles"
_LIST_JSON = _CONFIG_DIR / "abbreviations_list.json"
_DNU_JSON = _CONFIG_DIR / "abbreviations_do_not_use.json"
_CONTEXT_JSON = _CONFIG_DIR / "abbreviations_context_rules.json"
_EXPANSION_JSON = _CONFIG_DIR / "abbreviations_expansion_rules.json"


# ---------------------------------------------------------------------------
# JSON loading (lru-cached)
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("abbreviations config missing: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("abbreviations config invalid JSON at %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def _list_data() -> dict:
    return _load_json(_LIST_JSON)


@lru_cache(maxsize=1)
def _dnu_data() -> dict:
    return _load_json(_DNU_JSON)


@lru_cache(maxsize=1)
def _context_data() -> dict:
    return _load_json(_CONTEXT_JSON)


@lru_cache(maxsize=1)
def _expansion_data() -> dict:
    return _load_json(_EXPANSION_JSON)


def clear_cache() -> None:
    _list_data.cache_clear()
    _dnu_data.cache_clear()
    _context_data.cache_clear()
    _expansion_data.cache_clear()
    _compiled_dnu_rules.cache_clear()
    _abbr_entries_by_abbr.cache_clear()
    _periods_initialism_rx.cache_clear()
    _apostrophe_plural_rx.cache_clear()
    _compiled_context_rules.cache_clear()
    _preferred_abbr_for_expansion.cache_clear()
    _title_case_expansion_map.cache_clear()


# ---------------------------------------------------------------------------
# Phase C: Context_Rules (178 ambiguous abbreviations)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _compiled_context_rules() -> dict[str, list[tuple[str, "re.Pattern[str]"]]]:
    """Return ``{abbreviation: [(meaning, compiled_cue_regex), …]}``.

    Rows whose regex fails to compile are logged and skipped — the UI
    simply has one fewer disambiguation candidate for that abbreviation.
    """
    data = _context_data()
    out: dict[str, list[tuple[str, re.Pattern]]] = {}
    for row in data.get("context_rules", []) or []:
        abbr = row.get("abbreviation")
        meaning = row.get("meaning")
        cue = row.get("cue_regex")
        if not (abbr and meaning and cue):
            continue
        try:
            rx = re.compile(cue, re.IGNORECASE)
        except re.error as exc:
            logger.warning("Context_Rules %s: invalid cue regex: %s",
                           row.get("id"), exc)
            continue
        out.setdefault(abbr, []).append((meaning, rx))
    return out


# Context-scoring window: ±N characters around the abbreviation occurrence.
# Matches the workbook's own guidance ("within about 100 characters of
# the abbreviation") so the scoring behaviour is reproducible against
# the workbook test cases.
_CONTEXT_WINDOW = 100


def _score_meanings_at(
    text: str, abbr_s: int, abbr_e: int,
    candidates: list[tuple[str, re.Pattern]],
) -> list[tuple[str, int]]:
    """Return candidates sorted by descending score. Score = number of
    distinct cue-word matches within the ±_CONTEXT_WINDOW snippet."""
    ws = max(0, abbr_s - _CONTEXT_WINDOW)
    we = min(len(text), abbr_e + _CONTEXT_WINDOW)
    snippet = text[ws:we]
    out: list[tuple[str, int]] = []
    for meaning, rx in candidates:
        matches = {m.group(0).lower() for m in rx.finditer(snippet)}
        out.append((meaning, len(matches)))
    out.sort(key=lambda t: -t[1])
    return out


def _choose_meaning_for_occurrence(
    text: str, abbr: str, abbr_s: int, abbr_e: int,
    entries: list["_AbbrEntry"],
) -> tuple[Optional["_AbbrEntry"], list[tuple[str, int]]]:
    """Return ``(chosen_entry_or_None, scored_candidates)`` for one abbr hit.

    chosen_entry is None when:
      * no Context_Rules exist for this abbreviation, or
      * no candidate scored > 0 (no cue words nearby), or
      * two or more candidates tie at the top score.

    scored_candidates is always returned so the caller can emit an AB07
    "ask the author" finding listing every meaning the author must choose
    between.
    """
    rules = _compiled_context_rules().get(abbr) or []
    if not rules:
        return None, []
    scored = _score_meanings_at(text, abbr_s, abbr_e, rules)
    top = scored[0][1]
    if top == 0:
        return None, scored
    winners = [m for m, s in scored if s == top]
    if len(winners) > 1:
        return None, scored
    winner = winners[0]
    for e in entries:
        if e.expansion == winner:
            return e, scored
    # No matching entry (filtered out by audience / overrides) — treat as
    # ambiguous.
    return None, scored


def resolve_abbreviation_meaning(
    text: str, abbr: str, position: int,
    *, rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> Optional[str]:
    """Convenience for callers / tests: return the chosen expansion string
    for ``abbr`` at ``position`` in ``text``, or None when ambiguous.

    Only consults Context_Rules + eligibility filters — mirrors what the
    engine does internally when building document state.
    """
    all_by_abbr = _abbr_entries_by_abbr()
    entries = [
        e for e in all_by_abbr.get(abbr, [])
        if _is_entry_eligible(e, audience="general")
        and not _rule_disabled_by_override(e.id, rule_overrides)
    ]
    if not entries:
        return None
    chosen, _ = _choose_meaning_for_occurrence(
        text, abbr, position, position + len(abbr), entries,
    )
    return chosen.expansion if chosen else None


# ---------------------------------------------------------------------------
# Phase C: AB06 — preferred-abbreviation lookup for an expansion
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _preferred_abbr_for_expansion() -> dict[str, str]:
    """``{lowercased_expansion: preferred_abbr_surface}``.

    When two or more rows share the same expansion (ECG/EKG for
    electrocardiogram, for example), the first row in the workbook wins —
    matches the workbook convention of listing the preferred form first.
    """
    out: dict[str, str] = {}
    data = _list_data()
    for row in data.get("abbreviations", []) or []:
        exp = (row.get("expansion") or "").strip().lower()
        abbr = (row.get("abbreviation") or "").strip()
        if not exp or not abbr:
            continue
        out.setdefault(exp, abbr)
    return out


# ---------------------------------------------------------------------------
# Override helpers
# ---------------------------------------------------------------------------

def _rule_disabled_by_override(
    rule_id: str,
    overrides: Optional[dict[str, dict[str, Any]]],
) -> bool:
    if not overrides:
        return False
    o = overrides.get(rule_id) or {}
    return o.get("enabled") is False


def _effective_tool_behaviour(
    rule_id: str,
    default: Optional[str],
    overrides: Optional[dict[str, dict[str, Any]]],
) -> str:
    if overrides:
        o = overrides.get(rule_id) or {}
        if o.get("tool_behaviour") in ("flag", "auto_replace"):
            return o["tool_behaviour"]
    if default == "auto_replace":
        return "auto_replace"
    return "flag"


# ---------------------------------------------------------------------------
# Do_Not_Use rule compilation (Phase A — unchanged)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _compiled_dnu_rules() -> list[dict]:
    data = _dnu_data()
    out: list[dict] = []
    for row in data.get("rules", []) or []:
        rx = None
        pattern = row.get("pattern")
        if pattern:
            try:
                rx = re.compile(pattern)
            except re.error as exc:
                logger.error("Do_Not_Use %s: invalid regex: %s", row.get("id"), exc)
                continue
        out.append({**row, "rx": rx})
    return out


def analyze_do_not_use(
    text: str,
    *,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    if not text:
        return []
    out: list[Finding] = []
    for row in _compiled_dnu_rules():
        rx = row.get("rx")
        if rx is None:
            continue
        rid = row["id"]
        if _rule_disabled_by_override(rid, rule_overrides):
            continue
        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            replacement_tmpl = row.get("replacement") or ""
            try:
                primary = m.expand(replacement_tmpl) if replacement_tmpl else ""
            except re.error:
                logger.warning("Do_Not_Use %s: replacement expand failed", rid)
                continue
            if primary and primary == m.group(0):
                continue
            if not primary and row.get("suggestion_1"):
                primary = row["suggestion_1"]
            alts: list[str] = []
            for a in row.get("alt_suggestions") or []:
                try:
                    alts.append(m.expand(a))
                except re.error:
                    alts.append(a)
            eff_tb = _effective_tool_behaviour(rid, row.get("tool_behaviour"), rule_overrides)
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            msg = f"{row.get('notation') or rid}: {row.get('intended_meaning') or ''}".strip(": ")
            if row.get("common_mistake"):
                msg = f"{msg} (common error: {row['common_mistake']})"
            out.append(Finding(
                rule_id=rid,
                category="abbreviations",
                start=s,
                end=e,
                original=m.group(0),
                suggestion=primary,
                message=msg or rid,
                severity=severity,
                autofixable=True,
                alt_suggestions=alts,
            ))
    return out


# ---------------------------------------------------------------------------
# Abbreviation entries
# ---------------------------------------------------------------------------

@dataclass
class _AbbrEntry:
    """One row from Abbreviation_List, filtered + typed."""
    id: str
    abbreviation: str
    expansion: str
    plural_abbreviation: Optional[str]
    plural_expansion_override: Optional[str]
    article: Optional[str]          # 'a' | 'an' | None
    first_use_rule: str             # expand_at_first_use | expand_for_general_only | no_expansion_needed | do_not_abbreviate
    ambiguity: str                  # unique | ambiguous | unique_dnu_sibling
    do_not_abbreviate: bool
    subject_area: str


@lru_cache(maxsize=1)
def _abbr_entries_by_abbr() -> dict[str, list[_AbbrEntry]]:
    """Return every Abbreviation_List row keyed by abbreviation surface.

    Entries that opt out of expansion ('no_expansion_needed',
    'do_not_abbreviate'=True) are retained here — Phase-B filters apply
    them per-rule to avoid two cache keys."""
    out: dict[str, list[_AbbrEntry]] = {}
    data = _list_data()
    for row in data.get("abbreviations", []) or []:
        abbr = (row.get("abbreviation") or "").strip()
        if not abbr:
            continue
        entry = _AbbrEntry(
            id=row["id"],
            abbreviation=abbr,
            expansion=(row.get("expansion") or "").strip(),
            plural_abbreviation=row.get("plural_abbreviation"),
            plural_expansion_override=row.get("plural_expansion_override"),
            article=row.get("article"),
            first_use_rule=row.get("first_use_rule") or "expand_at_first_use",
            ambiguity=row.get("ambiguity") or "unique",
            do_not_abbreviate=bool(row.get("do_not_abbreviate", False)),
            subject_area=row.get("subject_area") or "",
        )
        out.setdefault(abbr, []).append(entry)
    return out


def _is_entry_eligible(entry: _AbbrEntry, *, audience: str) -> bool:
    """Should this abbreviation be considered for first-use rules?"""
    if entry.do_not_abbreviate:
        return False
    if entry.first_use_rule == "do_not_abbreviate":
        return False
    if entry.first_use_rule == "no_expansion_needed":
        return False  # AB17
    if entry.first_use_rule == "expand_for_general_only" and audience != "general":
        return False
    return True


def _pick_entry(entries: list[_AbbrEntry]) -> _AbbrEntry:
    """Choose the canonical meaning when an abbreviation has multiple.

    Phase B picks the first eligible entry (deterministic, matches the
    workbook's row order). Phase C will replace this with Context_Rules
    scoring.
    """
    return entries[0]


# ---------------------------------------------------------------------------
# Document-scope state
# ---------------------------------------------------------------------------

@dataclass
class _AbbrState:
    """Per-abbreviation state across the whole document."""
    abbreviation: str
    entries: list[_AbbrEntry]
    chosen_entry: Optional[_AbbrEntry]
    # (para_idx, start, end) — the abbreviation surface text itself
    abbr_occurrences: list[tuple[int, int, int]] = field(default_factory=list)
    # (para_idx, start, end, surface_text, is_plural) — the expansion surface
    exp_occurrences: list[tuple[int, int, int, str, bool]] = field(default_factory=list)
    # (para_idx, start, end, surface_text, kind) kind='exp_paren_abbr' | 'abbr_paren_exp'
    definitions: list[tuple[int, int, int, str, str]] = field(default_factory=list)
    # Phase C: AB07 "ask the author" state. ``context_candidates`` lists
    # every (meaning, score) tuple returned by Context_Rules scoring at
    # the FIRST abbr occurrence. ``context_resolved`` is True when the
    # scorer picked a confident winner (so chosen_entry is trustworthy);
    # False means Phase B rules stay silent and AB07 fires an ask-author
    # finding on each occurrence.
    context_candidates: list[tuple[str, int]] = field(default_factory=list)
    context_resolved: bool = True

    # Phase D region tracking — para indices where the abbreviation was
    # observed inside each manuscript region. Populated by
    # build_document_state from the para_roles map.
    abstract_paras: set[int] = field(default_factory=set)
    body_paras: set[int] = field(default_factory=set)
    heading_paras: set[int] = field(default_factory=set)
    table_paras: set[int] = field(default_factory=set)
    figure_paras: set[int] = field(default_factory=set)
    # Definition locations by region — supports AB12 (abstract-only
    # definition) and AB15 (table/figure needs a local definition).
    def_paras_in_abstract: set[int] = field(default_factory=set)
    def_paras_in_body: set[int] = field(default_factory=set)
    def_paras_in_table: set[int] = field(default_factory=set)
    def_paras_in_figure: set[int] = field(default_factory=set)

    @property
    def usage_count(self) -> int:
        # Expansions and abbreviations both count as uses; a definition is
        # one definition + one abbreviation + one expansion that overlap.
        # We count unique (para, start) positions to avoid triple-counting
        # the same stretch of text.
        positions: set[tuple[int, int]] = set()
        for p, s, _ in self.abbr_occurrences:
            positions.add((p, s))
        for p, s, _, _, _ in self.exp_occurrences:
            positions.add((p, s))
        return len(positions)

    @property
    def defined_anywhere(self) -> bool:
        return bool(self.definitions)

    def first_abbr_position(self) -> Optional[tuple[int, int, int]]:
        return self.abbr_occurrences[0] if self.abbr_occurrences else None

    def first_def_position(self) -> Optional[tuple[int, int, int, str, str]]:
        return self.definitions[0] if self.definitions else None

    def first_use_position(self) -> Optional[tuple[int, int]]:
        """(para_idx, start) of the EARLIEST use (abbr or expansion), ignoring
        order within a position. Used by AB02 to flag expansions-after-def."""
        candidates: list[tuple[int, int]] = []
        if self.abbr_occurrences:
            candidates.append((self.abbr_occurrences[0][0], self.abbr_occurrences[0][1]))
        if self.exp_occurrences:
            candidates.append((self.exp_occurrences[0][0], self.exp_occurrences[0][1]))
        return min(candidates) if candidates else None


def _find_abbreviation_occurrences(
    text: str, abbrs: Iterable[str],
) -> list[tuple[int, int, str]]:
    """Return (start, end, abbreviation) for each abbreviation whole-word
    hit in ``text``. Case-sensitive — canonical case is how abbreviations
    are written in medical copy."""
    out: list[tuple[int, int, str]] = []
    for abbr in abbrs:
        if not abbr:
            continue
        # \b handles alphanumeric boundaries; for abbreviations starting
        # with a non-letter (rare), fall back to simple non-letter asserts.
        esc = re.escape(abbr)
        left = r"(?<![A-Za-z0-9])" if not abbr[:1].isalpha() else r"\b"
        right = r"(?![A-Za-z0-9])" if not abbr[-1:].isalpha() else r"\b"
        try:
            rx = re.compile(f"{left}{esc}{right}")
        except re.error:
            continue
        for m in rx.finditer(text):
            out.append((m.start(), m.end(), abbr))
    return out


def _plural_expansion_for(entry: _AbbrEntry) -> Optional[str]:
    """Return the pluralised expansion for an entry, or None if the entry
    opts out of pluralisation."""
    if entry.plural_expansion_override:
        return entry.plural_expansion_override
    exp = entry.expansion
    if not exp:
        return None
    # Default pluralisation: just add 's'. The Abbreviation_List workbook
    # authors use the override column whenever the simple 's' rule is wrong.
    return exp + "s"


def _plural_abbr_for(entry: _AbbrEntry) -> Optional[str]:
    """Return the plural abbreviation ('ICUs'), or None if the entry opts
    out (workbook plural_abbreviation == '-' already normalised to None by
    the import script)."""
    return entry.plural_abbreviation


def _find_expansion_occurrences(
    text: str, expansions: Iterable[tuple[str, str, bool]],
) -> list[tuple[int, int, str, str, bool]]:
    """Return (start, end, matched_surface, canonical_expansion, is_plural) hits.

    ``expansions`` is an iterable of (canonical_expansion, variant_phrase,
    is_plural) — the caller feeds both the singular and plural forms so
    the matcher can report whether a hit was a plural variant without
    the detector having to re-tokenise.

    Case-insensitive, word-boundary anchored. Preserves the ACTUAL matched
    surface (``Blood pressure``) so downstream rules can keep the author's
    capitalisation when rewriting.

    Overlap handling: longest match wins (``neonatal intensive care unit``
    beats the ICU-only substring; plural matches beat the singular inside
    them).
    """
    raw: list[tuple[int, int, str, str, bool]] = []
    seen: set[tuple[str, bool]] = set()
    for canonical, variant, is_plural in expansions:
        if not variant:
            continue
        key = (variant, is_plural)
        if key in seen:
            continue
        seen.add(key)
        esc = re.escape(variant)
        try:
            rx = re.compile(r"\b" + esc + r"\b", re.IGNORECASE)
        except re.error:
            continue
        for m in rx.finditer(text):
            raw.append((m.start(), m.end(), m.group(0), canonical, is_plural))
    # Longest-first dedupe.
    raw.sort(key=lambda t: (-(t[1] - t[0]), t[0]))
    kept: list[tuple[int, int, str, str, bool]] = []
    for s, e, surface, canonical, is_plural in raw:
        if any(not (e <= ks or s >= ke) for ks, ke, _, _, _ in kept):
            continue
        kept.append((s, e, surface, canonical, is_plural))
    kept.sort()
    return kept


_DEF_WINDOW_WHITESPACE = re.compile(r"\s*")


def _detect_definitions(
    text: str,
    abbr_hits: list[tuple[int, int, str]],
    exp_hits: list[tuple[int, int, str, str]],
    chosen_by_abbr: dict[str, _AbbrEntry],
) -> list[tuple[int, int, str, str]]:
    """Return (start, end, surface, kind) for each 'exp (ABBR)' or
    'ABBR (expansion)' pattern found adjacently.

    An abbr hit at [a, b) counts as part of ``exp (ABBR)`` when:
      * text[b:b+2] starts with ``)`` and text[?:a-1] matches an eligible
        expansion followed by ``(``.
    Mirrored for ``ABBR (exp)``.
    """
    out: list[tuple[int, int, str, str]] = []
    # (exp_index was intentionally dropped — _detect_definitions scans the
    # text around each abbr hit directly rather than cross-referencing hits.)

    for abbr_s, abbr_e, abbr in abbr_hits:
        entry = chosen_by_abbr.get(abbr)
        if not entry:
            continue
        canonical_exp = entry.expansion.lower()

        # Pattern 1: ``expansion (ABBR)`` — abbr preceded by '(' and before that
        # by the canonical expansion.
        if abbr_s >= 2 and text[abbr_s - 1] == "(" and abbr_e < len(text) and text[abbr_e] == ")":
            # Find the expansion ending at abbr_s - 1 (ignoring whitespace
            # between expansion and the '(').
            exp_end = abbr_s - 1
            # Walk back past whitespace between the ')' before and the exp text.
            # Expansion must end just before the '(' with at most one space.
            # Simplest check: does text[exp_end - len(exp) - 1 : exp_end - 1] (approx) equal the expansion case-insensitively?
            exp_len = len(entry.expansion)
            exp_candidate_start = exp_end - 1 - exp_len  # skip the single space before '('
            if exp_candidate_start >= 0 and text[exp_candidate_start:exp_candidate_start + exp_len].lower() == canonical_exp:
                # Confirm word boundary at the start of the expansion.
                prior = text[exp_candidate_start - 1] if exp_candidate_start > 0 else " "
                if not prior.isalnum():
                    out.append((
                        exp_candidate_start,
                        abbr_e + 1,  # include the ')'
                        text[exp_candidate_start:abbr_e + 1],
                        "exp_paren_abbr",
                    ))
                    continue

        # Pattern 2: ``ABBR (expansion)`` — abbr followed by ' (' and the
        # canonical expansion then ')'.
        if abbr_e + 1 < len(text) and text[abbr_e] == " " and text[abbr_e + 1] == "(":
            exp_start = abbr_e + 2
            exp_len = len(entry.expansion)
            if exp_start + exp_len < len(text) \
                    and text[exp_start:exp_start + exp_len].lower() == canonical_exp \
                    and text[exp_start + exp_len] == ")":
                out.append((
                    abbr_s,
                    exp_start + exp_len + 1,
                    text[abbr_s:exp_start + exp_len + 1],
                    "abbr_paren_exp",
                ))
                continue
    return out


def build_document_state(
    paragraphs: list[tuple[int, str]],
    *,
    audience: str = "general",
    min_uses: int = 2,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
    para_roles: Optional[dict[int, dict]] = None,
) -> dict[str, _AbbrState]:
    """Pre-scan every paragraph; return per-abbreviation state keyed by surface.

    Only abbreviations with at least one eligible meaning (surviving the
    ``_is_entry_eligible`` filter + the Scope-C override map) appear in
    the output. ``min_uses`` is NOT applied here — it filters at the
    rule-emission stage so a single-use abbreviation can still trigger
    AB05.
    """
    overrides = rule_overrides or {}
    all_by_abbr = _abbr_entries_by_abbr()

    # Step 1: filter to eligible abbreviations only — one chosen entry per
    # surface. Entries disabled by override are dropped entirely.
    chosen_by_abbr: dict[str, _AbbrEntry] = {}
    entries_by_abbr: dict[str, list[_AbbrEntry]] = {}
    for abbr, entries in all_by_abbr.items():
        kept = [
            e for e in entries
            if _is_entry_eligible(e, audience=audience)
            and not _rule_disabled_by_override(e.id, overrides)
        ]
        if not kept:
            continue
        chosen_by_abbr[abbr] = _pick_entry(kept)
        entries_by_abbr[abbr] = kept

    if not chosen_by_abbr:
        return {}

    # Pre-build state records for every known abbreviation; occurrences
    # populate on the scan pass.
    state: dict[str, _AbbrState] = {
        abbr: _AbbrState(abbreviation=abbr, entries=entries_by_abbr[abbr],
                         chosen_entry=chosen_by_abbr[abbr])
        for abbr in chosen_by_abbr
    }

    # Canonical-expansion → abbreviation map; keys are lowercased so a
    # case-insensitive text match can look up the owning abbreviation
    # regardless of whether the author capitalised the term.
    expansions_canonical: dict[str, str] = {
        chosen_by_abbr[abbr].expansion.lower(): abbr
        for abbr in chosen_by_abbr if chosen_by_abbr[abbr].expansion
    }
    # Also index the pluralised variant → owning abbr for AB01 / AB02 on
    # plural expansions ("intensive care units" → ICUs).
    plural_variant_to_abbr: dict[str, str] = {}
    for abbr, entry in chosen_by_abbr.items():
        pl = _plural_expansion_for(entry)
        if pl:
            plural_variant_to_abbr[pl.lower()] = abbr

    # Build the (canonical, variant, is_plural) iterable for the expansion
    # matcher — one entry per variant per abbreviation.
    expansion_variants: list[tuple[str, str, bool]] = []
    for abbr, entry in chosen_by_abbr.items():
        if entry.expansion:
            expansion_variants.append((entry.expansion, entry.expansion, False))
        pl = _plural_expansion_for(entry)
        if pl and pl != entry.expansion:
            expansion_variants.append((entry.expansion, pl, True))

    # Step 2: paragraph scan.
    for para_idx, text in paragraphs:
        if not text:
            continue
        abbr_hits = _find_abbreviation_occurrences(text, chosen_by_abbr.keys())
        exp_hits = _find_expansion_occurrences(text, expansion_variants)
        definitions = _detect_definitions(text, abbr_hits, exp_hits, chosen_by_abbr)

        # Collect the (start, end) spans the definitions cover so we don't
        # double-count the embedded abbreviation / expansion that lives
        # inside each definition.
        def_spans: set[tuple[int, int]] = {(s, e) for s, e, _, _ in definitions}

        for abbr_s, abbr_e, abbr in abbr_hits:
            # Skip if this abbr is inside a definition span (counted
            # separately below).
            inside_def = any(ds <= abbr_s and abbr_e <= de for ds, de in def_spans)
            if inside_def:
                continue
            # Skip ``ICU's`` — the apostrophe-plural form belongs to AB09,
            # not AB05. Without this, a single ``ICU's were closed``
            # mention would be counted as a lone ICU and AB05 would try
            # to spell it out while AB09 is trying to drop the apostrophe.
            if text[abbr_e:abbr_e + 2] == "'s":
                continue
            state[abbr].abbr_occurrences.append((para_idx, abbr_s, abbr_e))

        for exp_s, exp_e, surface, canonical, is_plural in exp_hits:
            inside_def = any(ds <= exp_s and exp_e <= de for ds, de in def_spans)
            if inside_def:
                continue
            abbr = expansions_canonical.get(canonical.lower())
            if not abbr or abbr not in state:
                continue
            state[abbr].exp_occurrences.append((para_idx, exp_s, exp_e, surface, is_plural))

        for def_s, def_e, surface, kind in definitions:
            # Find which abbreviation this definition belongs to by
            # scanning its surface for a known abbr.
            matched_abbr = None
            for abbr in chosen_by_abbr:
                esc = re.escape(abbr)
                if re.search(rf"\b{esc}\b", surface):
                    matched_abbr = abbr
                    break
            if matched_abbr:
                state[matched_abbr].definitions.append(
                    (para_idx, def_s, def_e, surface, kind)
                )

    # Sort every occurrence list by document position so first_* properties work.
    for s in state.values():
        s.abbr_occurrences.sort()
        s.exp_occurrences.sort()
        s.definitions.sort()

    # Phase D region tracking — attribute each abbr/exp/definition
    # occurrence to its paragraph region using the para_roles map.
    # When para_roles is None (legacy callers), every region set stays
    # empty and Phase D rules stay silent.
    if para_roles:
        for s in state.values():
            for p, _s, _e in s.abbr_occurrences:
                roles = para_roles.get(p) or {}
                if roles.get("role") in ("heading", "title"):
                    s.heading_paras.add(p)
                if roles.get("in_abstract"):
                    s.abstract_paras.add(p)
                else:
                    s.body_paras.add(p)
                if roles.get("in_table"):
                    s.table_paras.add(p)
                if roles.get("in_figure"):
                    s.figure_paras.add(p)
            for p, _s, _e, _surf, _plural in s.exp_occurrences:
                roles = para_roles.get(p) or {}
                if roles.get("in_abstract"):
                    s.abstract_paras.add(p)
                else:
                    s.body_paras.add(p)
                if roles.get("in_table"):
                    s.table_paras.add(p)
                if roles.get("in_figure"):
                    s.figure_paras.add(p)
            for p, _s, _e, _surf, _kind in s.definitions:
                roles = para_roles.get(p) or {}
                if roles.get("in_abstract"):
                    s.def_paras_in_abstract.add(p)
                else:
                    s.def_paras_in_body.add(p)
                if roles.get("in_table"):
                    s.def_paras_in_table.add(p)
                if roles.get("in_figure"):
                    s.def_paras_in_figure.add(p)

    # Phase C: for ambiguous abbreviations, re-pick ``chosen_entry`` using
    # Context_Rules scored at the first abbreviation occurrence. When no
    # confident winner can be chosen, mark ``context_resolved=False`` so
    # downstream Phase-B rules stay silent and AB07 fires an ask-author
    # finding on each occurrence.
    for abbr, s in state.items():
        if s.chosen_entry is not None and s.chosen_entry.ambiguity != "ambiguous":
            continue
        first_abbr = s.first_abbr_position()
        if first_abbr is None:
            # Only expansion mentions? Fall back to the first entry
            # heuristically — Context_Rules cue words are keyed to abbr
            # occurrences, not expansion mentions.
            continue
        fa_para, fa_s, fa_e = first_abbr
        # Reach into the paragraph text for scoring. ``paragraphs`` is a
        # list of (para_idx, text); look up by index.
        para_text = next((t for p, t in paragraphs if p == fa_para), "")
        if not para_text:
            continue
        chosen, scored = _choose_meaning_for_occurrence(
            para_text, abbr, fa_s, fa_e, s.entries,
        )
        s.context_candidates = scored
        if chosen is not None:
            s.chosen_entry = chosen
            s.context_resolved = True
        else:
            s.context_resolved = False
    return state


# ---------------------------------------------------------------------------
# Phase B — document-scope rule emission (AB01, AB02, AB04, AB05)
# ---------------------------------------------------------------------------

def _rule_label(rule_id: str) -> str:
    return {
        "AB01": "AB01: Expand abbreviation at first use",
        "AB02": "AB02: Repeated expansion — use the abbreviation",
        "AB03": "AB03: Abbreviation used before its definition — move the definition to first use",
        "AB04": "AB04: Repeated definition — use the abbreviation",
        "AB05": "AB05: Single use — spell out",
        "AB06": "AB06: Inconsistent abbreviation — use the preferred form",
        "AB07": "AB07: Ambiguous abbreviation — ask the author",
        "AB09": "AB09: Remove apostrophe from plural abbreviation",
        "AB10": "AB10: Article agreement",
        "AB11": "AB11: Abbreviation in a heading / title — spell it out",
        "AB12": "AB12: Abstract-only definition — redefine at first use in body",
        "AB13": "AB13: Remove periods from initialism",
        "AB14": "AB14: Expansion written in Title Case — use lowercase",
        "AB15": "AB15: Abbreviation in a table / figure — add a local definition",
    }.get(rule_id, rule_id)


_SENTENCE_END_CHARS = frozenset(".!?")


def _is_sentence_initial(text: str, pos: int) -> bool:
    """True if ``pos`` is at the start of a sentence in ``text``.

    "Start of sentence" means: text begins at ``pos`` (ignoring whitespace),
    OR the first non-whitespace character to the left is ``.``/``!``/``?``.
    """
    i = pos - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    if i < 0:
        return True
    return text[i] in _SENTENCE_END_CHARS


def _expansion_cased(text: str, pos: int, expansion: str) -> str:
    """Return the expansion with sentence-initial Capital if ``pos`` begins
    a sentence; otherwise verbatim (lowercase by workbook convention)."""
    if not expansion:
        return expansion
    if _is_sentence_initial(text, pos):
        return expansion[:1].upper() + expansion[1:]
    return expansion


def _emit_doc_scope_findings(
    text: str, para_idx: int, state: dict[str, _AbbrState],
    *, min_uses: int,
    rule_overrides: Optional[dict[str, dict[str, Any]]],
    para_roles: Optional[dict[int, dict]] = None,
) -> list[Finding]:
    """Document-scope rule emission for AB01, AB02, AB04, AB05.

    Workbook semantics (confirmed against the 14 First-use test cases):
      * AB01 — on the very first mention (whichever comes first: the
        abbreviation surface OR the expansion), suggest the paired form
        ``expansion (ABBR)``. Fires when total mentions ≥ min_uses and
        the author never spelled out the definition themselves.
      * AB02 — every expansion mention that comes AFTER the first mention
        (whether that first was abbr or expansion) collapses to just the
        abbreviation. The pair created by AB01 counts as "defined" for
        this purpose.
      * AB04 — if the author wrote the ``expansion (ABBR)`` pattern more
        than once, keep the first and compress the rest to just ABBR.
      * AB05 — a lone single use that will never pay off → spell it out
        (if abbreviation) and skip introducing the abbreviation.
    """
    # Phase D: when THIS paragraph is a heading / title / table / figure,
    # suppress the generic first-use rules (AB01/AB05 would introduce the
    # abbreviation, but the workbook says these regions should either
    # spell it out via AB11/AB15 or leave untouched). The role-specific
    # emitters below handle those cases.
    this_role_lookup = (para_roles or {}).get(para_idx, {}) or {}
    suppress_firstuse = (
        this_role_lookup.get("role") in ("heading", "title")
        or this_role_lookup.get("in_table")
        or this_role_lookup.get("in_figure")
    )

    out: list[Finding] = []
    for abbr, s in state.items():
        entry = s.chosen_entry
        # Phase C: ambiguous abbreviations fire first-use rules only when
        # Context_Rules has picked a confident meaning for this document.
        # Otherwise AB07 (below) emits an "ask the author" finding and
        # AB01/AB02/AB05 stay silent to avoid imposing the wrong meaning.
        if entry is None or (entry.ambiguity == "ambiguous" and not s.context_resolved):
            # AB07 ask-author emission per occurrence happens in a
            # separate pass below (needs the full state). Skip Phase B
            # rules for this abbreviation.
            continue
        # Phase D: skip Phase B first-use rules when this paragraph is a
        # heading / table / figure — AB11 / AB15 will fire instead.
        if suppress_firstuse:
            continue
        total_uses = s.usage_count
        defined = s.defined_anywhere
        first_abbr = s.first_abbr_position()
        first_def = s.first_def_position()
        first_use = s.first_use_position()  # (para, start) earliest of abbr/exp

        # ─── AB01: introduce the abbreviation at the first mention ──
        # Only fires when:
        #   - the document already has NO explicit definition pair,
        #   - the term appears at least ``min_uses`` times, and
        #   - this paragraph owns the first mention.
        if (not defined and first_use and first_use[0] == para_idx
                and total_uses >= min_uses
                and not _rule_disabled_by_override("AB01", rule_overrides)):
            # Resolve which specific occurrence sits at first_use position.
            # It may be an abbreviation hit OR an expansion hit — the two
            # branches produce the same ``expansion (ABBR)`` suggestion
            # but target different spans / originals.
            fu_para, fu_start = first_use
            abbr_hit_at_fu = next(
                ((p, s_, e_) for (p, s_, e_) in s.abbr_occurrences
                 if (p, s_) == (fu_para, fu_start)),
                None,
            )
            exp_hit_at_fu = next(
                ((p, s_, e_, surface, is_plural) for (p, s_, e_, surface, is_plural) in s.exp_occurrences
                 if (p, s_) == (fu_para, fu_start)),
                None,
            )
            eff_tb = _effective_tool_behaviour("AB01", "flag", rule_overrides)
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            if abbr_hit_at_fu:
                _, s_, e_ = abbr_hit_at_fu
                surface = text[s_:e_]
                exp_cased = _expansion_cased(text, s_, entry.expansion)
                suggestion = f"{exp_cased} ({surface})"
                out.append(Finding(
                    rule_id="AB01",
                    category="abbreviations",
                    start=s_, end=e_,
                    original=surface,
                    suggestion=suggestion,
                    message=_rule_label("AB01"),
                    severity=severity,
                    autofixable=True,
                ))
            elif exp_hit_at_fu:
                _, s_, e_, exp_surface, is_plural = exp_hit_at_fu
                # Preserve the author's original expansion case verbatim.
                # For plurals, pair with the plural abbr (ICUs) when the
                # entry provides one; otherwise fall back to the singular.
                abbr_form = abbr
                if is_plural:
                    plural_abbr = _plural_abbr_for(entry)
                    if plural_abbr:
                        abbr_form = plural_abbr
                suggestion = f"{exp_surface} ({abbr_form})"
                out.append(Finding(
                    rule_id="AB01",
                    category="abbreviations",
                    start=s_, end=e_,
                    original=exp_surface,
                    suggestion=suggestion,
                    message=_rule_label("AB01"),
                    severity=severity,
                    autofixable=True,
                ))

        # ─── AB04: repeated explicit definition ─────────────────────
        if (len(s.definitions) > 1
                and not _rule_disabled_by_override("AB04", rule_overrides)):
            for def_para, def_s, def_e, def_surface, _kind in s.definitions[1:]:
                if def_para != para_idx:
                    continue
                # Abbreviations stay canonical case — never transform.
                suggestion = abbr
                eff_tb = _effective_tool_behaviour("AB04", "auto_replace", rule_overrides)
                severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                out.append(Finding(
                    rule_id="AB04",
                    category="abbreviations",
                    start=def_s, end=def_e,
                    original=def_surface,
                    suggestion=suggestion,
                    message=_rule_label("AB04"),
                    severity=severity,
                    autofixable=True,
                ))

        # ─── AB03: abbreviation used BEFORE its definition ──────────
        # Workbook: "Move the definition to the first use. Replace the
        # later definition with the abbreviation." Two findings land —
        # one on the first abbr occurrence (expand to the def form), one
        # on the explicit definition that came later (compress to abbr).
        if (first_abbr and first_def and (first_abbr[0], first_abbr[1]) < (first_def[0], first_def[1])
                and not _rule_disabled_by_override("AB03", rule_overrides)):
            fa_para, fa_s, fa_e = first_abbr
            fd_para, fd_s, fd_e, fd_surface, _fd_kind = first_def
            eff_tb = _effective_tool_behaviour("AB03", "flag", rule_overrides)
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            if fa_para == para_idx:
                fa_surface = text[fa_s:fa_e]
                exp_cased = _expansion_cased(text, fa_s, entry.expansion)
                out.append(Finding(
                    rule_id="AB03",
                    category="abbreviations",
                    start=fa_s, end=fa_e,
                    original=fa_surface,
                    suggestion=f"{exp_cased} ({fa_surface})",
                    message=_rule_label("AB03"),
                    severity=severity,
                    autofixable=True,
                ))
            if fd_para == para_idx:
                out.append(Finding(
                    rule_id="AB03",
                    category="abbreviations",
                    start=fd_s, end=fd_e,
                    original=fd_surface,
                    suggestion=abbr,
                    message=_rule_label("AB03"),
                    severity=severity,
                    autofixable=True,
                ))

        # ─── AB02: compress expansions after the first use ──────────
        # AB01 introduces a definition at the first mention; every later
        # expansion mention should be compressed to the abbreviation.
        # Also fires when the author DEFINED the term explicitly — later
        # expansions compress against the explicit definition's position.
        if (total_uses >= min_uses
                and not _rule_disabled_by_override("AB02", rule_overrides)):
            # Compute the "anchor" position after which later expansions
            # compress. If a definition exists, use the FIRST definition's
            # position; otherwise use the first use that AB01 anchors on.
            if first_def:
                anchor = (first_def[0], first_def[1])
            elif first_use:
                anchor = first_use
            else:
                anchor = None
            if anchor is not None:
                for exp_para, exp_s, exp_e, exp_surface, is_plural in s.exp_occurrences:
                    if exp_para != para_idx:
                        continue
                    if (exp_para, exp_s) <= anchor:
                        continue
                    # Plural expansion ("intensive care units") compresses
                    # to the plural abbreviation ("ICUs") when the entry
                    # provides one; otherwise fall back to the canonical.
                    suggestion = abbr
                    if is_plural:
                        plural_abbr = _plural_abbr_for(entry)
                        if plural_abbr:
                            suggestion = plural_abbr
                    eff_tb = _effective_tool_behaviour("AB02", "auto_replace", rule_overrides)
                    severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                    out.append(Finding(
                        rule_id="AB02",
                        category="abbreviations",
                        start=exp_s, end=exp_e,
                        original=exp_surface,
                        suggestion=suggestion,
                        message=_rule_label("AB02"),
                        severity=severity,
                        autofixable=True,
                    ))
                    # AB10 piggy-back: if the author wrote 'a <expansion>'
                    # and after AB02 the article will sit next to the
                    # abbreviation, the article may no longer agree. Fire
                    # AB10 on the article so the two findings resolve
                    # together.
                    if entry.article in ("a", "an"):
                        _maybe_emit_ab10_before_span(
                            text, exp_s, entry.article,
                            abbr_form=suggestion,
                            rule_overrides=rule_overrides,
                            out=out,
                        )

        # ─── AB05: single use → spell out / drop parens ─────────────
        # Two variants, both captured by "the term is used only once":
        #   (a) sole occurrence is an abbreviation → spell it out.
        #   (b) sole occurrence is a definition pair ``expansion (ABBR)``
        #       → drop the parenthetical, keep just the expansion.
        if (not _rule_disabled_by_override("AB05", rule_overrides)
                and entry.first_use_rule not in ("no_expansion_needed", "do_not_abbreviate")):
            lone_abbr = (
                total_uses == 1 and len(s.abbr_occurrences) == 1
                and not s.exp_occurrences and not s.definitions
            )
            lone_def = (
                total_uses == 0 and len(s.definitions) == 1
                and not s.abbr_occurrences and not s.exp_occurrences
            )
            if lone_abbr and total_uses < min_uses:
                abbr_para, abbr_s, abbr_e = s.abbr_occurrences[0]
                if abbr_para == para_idx:
                    surface = text[abbr_s:abbr_e]
                    suggestion = _expansion_cased(text, abbr_s, entry.expansion)
                    eff_tb = _effective_tool_behaviour("AB05", "flag", rule_overrides)
                    severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                    out.append(Finding(
                        rule_id="AB05",
                        category="abbreviations",
                        start=abbr_s, end=abbr_e,
                        original=surface,
                        suggestion=suggestion,
                        message=_rule_label("AB05"),
                        severity=severity,
                        autofixable=True,
                    ))
            elif lone_def:
                def_para, def_s, def_e, def_surface, _kind = s.definitions[0]
                if def_para == para_idx:
                    # Keep just the expansion with the author's original
                    # case — stripping the ``(ABBR)`` tail.
                    # The expansion is the part BEFORE the ' (' in the surface.
                    paren_idx = def_surface.find(" (")
                    if paren_idx > 0:
                        suggestion = def_surface[:paren_idx]
                    else:
                        suggestion = entry.expansion
                    eff_tb = _effective_tool_behaviour("AB05", "flag", rule_overrides)
                    severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                    out.append(Finding(
                        rule_id="AB05",
                        category="abbreviations",
                        start=def_s, end=def_e,
                        original=def_surface,
                        suggestion=suggestion,
                        message=_rule_label("AB05"),
                        severity=severity,
                        autofixable=True,
                    ))

    # ─── Phase C cross-cutting passes ─────────────────────────────────

    # AB06 — inconsistent abbreviations for the same canonical expansion.
    # When the document uses two abbreviations that both expand to the
    # same term, flag the non-preferred surface on every occurrence.
    if not _rule_disabled_by_override("AB06", rule_overrides):
        pref_lookup = _preferred_abbr_for_expansion()
        for abbr, s in state.items():
            entry = s.chosen_entry
            if entry is None:
                continue
            preferred = pref_lookup.get(entry.expansion.lower())
            if not preferred or preferred == abbr:
                continue
            # Only inconsistent when the preferred surface is ALSO used in
            # the document — otherwise the author is simply using a known
            # alternate, which Phase B rules handle.
            if preferred not in state or not state[preferred].abbr_occurrences:
                continue
            for ap, as_, ae in s.abbr_occurrences:
                if ap != para_idx:
                    continue
                eff_tb = _effective_tool_behaviour("AB06", "flag", rule_overrides)
                severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                out.append(Finding(
                    rule_id="AB06",
                    category="abbreviations",
                    start=as_, end=ae,
                    original=text[as_:ae],
                    suggestion=preferred,
                    message=f"{_rule_label('AB06')}: {abbr} → {preferred} (same expansion: {entry.expansion})",
                    severity=severity,
                    autofixable=True,
                ))

    # ─── Phase D cross-cutting passes ─────────────────────────────────

    this_role = (para_roles or {}).get(para_idx, {}) or {}

    # AB11 — abbreviation inside a heading or title. Workbook says: spell
    # it out unless it's a 'No expansion needed' entry (DNA / HIV / …).
    if (this_role.get("role") in ("heading", "title")
            and not _rule_disabled_by_override("AB11", rule_overrides)):
        for abbr, s in state.items():
            if not s.entries:
                continue
            # Skip universally-known abbreviations.
            if all(e.first_use_rule == "no_expansion_needed" for e in s.entries):
                continue
            # Fire on each abbr occurrence in THIS heading paragraph.
            # chosen_entry may be None for unresolved ambiguous abbrs — in
            # that case we flag without a replacement, letting the author
            # pick a meaning first.
            entry = s.chosen_entry
            for ap, as_, ae in s.abbr_occurrences:
                if ap != para_idx:
                    continue
                surface = text[as_:ae]
                if entry is not None and entry.expansion:
                    suggestion = _expansion_cased(text, as_, entry.expansion)
                    autofix = True
                else:
                    suggestion = surface
                    autofix = False
                eff_tb = _effective_tool_behaviour("AB11", "flag", rule_overrides)
                severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                out.append(Finding(
                    rule_id="AB11",
                    category="abbreviations",
                    start=as_, end=ae,
                    original=surface,
                    suggestion=suggestion,
                    message=_rule_label("AB11"),
                    severity=severity,
                    autofixable=autofix,
                ))

    # AB12 — abbreviation defined only in the abstract but used in the
    # body with no local definition. Fires on the FIRST body occurrence
    # (abbr or expansion). The suggestion rewrites that first body use
    # to the "expansion (ABBR)" definition form so the body is self-
    # contained.
    if (this_role.get("in_abstract") is False
            and not _rule_disabled_by_override("AB12", rule_overrides)):
        for abbr, s in state.items():
            entry = s.chosen_entry
            if entry is None or entry.ambiguity == "ambiguous" and not s.context_resolved:
                continue
            # Trigger: at least one definition in the abstract AND zero
            # definitions in the body.
            if not s.def_paras_in_abstract or s.def_paras_in_body:
                continue
            # Find the first body occurrence (abbr OR expansion).
            body_abbr = [(p, a, b) for (p, a, b) in s.abbr_occurrences
                         if p not in s.abstract_paras]
            body_exp = [(p, a, b, surf) for (p, a, b, surf, _pl) in s.exp_occurrences
                        if p not in s.abstract_paras]
            if not body_abbr and not body_exp:
                continue
            first_body_abbr = body_abbr[0] if body_abbr else None
            first_body_exp = body_exp[0] if body_exp else None
            first_body = (
                first_body_abbr if (first_body_abbr and (not first_body_exp
                    or (first_body_abbr[0], first_body_abbr[1]) <= (first_body_exp[0], first_body_exp[1])))
                else first_body_exp
            )
            # Only emit when this paragraph owns the first body use.
            if first_body[0] != para_idx:
                continue
            if len(first_body) == 3:  # abbr form
                _, as_, ae = first_body
                surface = text[as_:ae]
                exp_cased = _expansion_cased(text, as_, entry.expansion)
                suggestion = f"{exp_cased} ({surface})"
            else:  # expansion form
                _, as_, ae, surface = first_body
                suggestion = f"{surface} ({abbr})"
            eff_tb = _effective_tool_behaviour("AB12", "flag", rule_overrides)
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            out.append(Finding(
                rule_id="AB12",
                category="abbreviations",
                start=as_, end=ae,
                original=surface,
                suggestion=suggestion,
                message=_rule_label("AB12"),
                severity=severity,
                autofixable=True,
            ))

    # AB15 — abbreviation in a table / figure with no local definition.
    # "Local" means a definition in the same table/figure group. For
    # Phase D we approximate that by "any definition in a table / figure
    # paragraph anywhere in the document" (the workbook's test corpus
    # doesn't contain the complex multi-table case). Phase E can tighten.
    if ((this_role.get("in_table") or this_role.get("in_figure"))
            and not _rule_disabled_by_override("AB15", rule_overrides)):
        region = "table" if this_role.get("in_table") else "figure"
        local_defs = (s.def_paras_in_table if region == "table"
                      else s.def_paras_in_figure)
        for abbr, s in state.items():
            if not s.entries:
                continue
            # Skip universally-known abbreviations.
            if all(e.first_use_rule == "no_expansion_needed" for e in s.entries):
                continue
            # Local definition exists → nothing to flag.
            region_defs = (s.def_paras_in_table if region == "table"
                           else s.def_paras_in_figure)
            if region_defs:
                continue
            # Flag each occurrence in this paragraph.
            region_set = s.table_paras if region == "table" else s.figure_paras
            if para_idx not in region_set:
                continue
            entry = s.chosen_entry
            for ap, as_, ae in s.abbr_occurrences:
                if ap != para_idx:
                    continue
                surface = text[as_:ae]
                if entry is not None and entry.expansion:
                    exp_cased = _expansion_cased(text, as_, entry.expansion)
                    suggestion = f"{exp_cased} ({surface})"
                    autofix = True
                else:
                    suggestion = surface
                    autofix = False
                eff_tb = _effective_tool_behaviour("AB15", "flag", rule_overrides)
                severity = "suggestion" if eff_tb == "auto_replace" else "warning"
                out.append(Finding(
                    rule_id="AB15",
                    category="abbreviations",
                    start=as_, end=ae,
                    original=surface,
                    suggestion=suggestion,
                    message=f"{_rule_label('AB15')} ({region})",
                    severity=severity,
                    autofixable=autofix,
                ))

    # AB07 — ambiguous abbreviation whose Context_Rules could not pick a
    # single meaning. Emits an "ask the author" finding per occurrence
    # with every candidate meaning in alt_suggestions so the Review UI
    # can offer them in the alt-dropdown.
    if not _rule_disabled_by_override("AB07", rule_overrides):
        for abbr, s in state.items():
            if s.context_resolved:
                continue
            # Only ambiguous entries reach this branch (the scorer only
            # runs for ambiguous ones).
            if not any(e.ambiguity == "ambiguous" for e in s.entries):
                continue
            candidates = [m for m, _ in s.context_candidates] or [e.expansion for e in s.entries]
            msg = (
                f"{_rule_label('AB07')} ({abbr}): "
                f"candidates — {', '.join(candidates)}"
            )
            for ap, as_, ae in s.abbr_occurrences:
                if ap != para_idx:
                    continue
                out.append(Finding(
                    rule_id="AB07",
                    category="abbreviations",
                    start=as_, end=ae,
                    original=text[as_:ae],
                    suggestion=text[as_:ae],  # no auto-fix; author picks
                    message=msg,
                    severity="warning",
                    autofixable=False,
                    alt_suggestions=candidates,
                ))

    return out


# ---------------------------------------------------------------------------
# Phase B — paragraph-local regex rules (AB09, AB10, AB13)
# ---------------------------------------------------------------------------

# Common Latin / titular abbreviations that MUST retain their periods.
# AB13 skips any match whose lowercased form is in this set.
_PERIODS_WHITELIST: frozenset[str] = frozenset({
    "e.g.", "i.e.", "a.m.", "p.m.", "et al.", "etc.", "vs.", "no.", "nos.",
    "vol.", "vols.", "p.", "pp.", "ch.", "fig.", "figs.", "eq.", "ref.",
    "mr.", "mrs.", "ms.", "dr.", "prof.", "jr.", "sr.", "st.", "mt.",
    "u.s.", "u.k.", "u.n.", "d.c.",
})


@lru_cache(maxsize=1)
def _periods_initialism_rx() -> re.Pattern[str]:
    # 2+ ``letter.`` pairs, optionally one trailing bare letter. ``\b``
    # breaks here (``.`` is non-word, next char is non-word) so we use
    # explicit alnum lookaround.
    return re.compile(r"(?<![\w.])(?:[A-Za-z]\.){2,}[A-Za-z]?(?!\w)")


def _analyze_periods_in_initialism(
    text: str,
    *,
    rule_overrides: Optional[dict[str, dict[str, Any]]],
) -> list[Finding]:
    if not text:
        return []
    if _rule_disabled_by_override("AB13", rule_overrides):
        return []
    out: list[Finding] = []
    for m in _periods_initialism_rx().finditer(text):
        surface = m.group(0)
        if surface.lower() in _PERIODS_WHITELIST:
            continue
        # Strip periods — preserve letter case.
        stripped = surface.replace(".", "")
        if stripped == surface:
            continue
        eff_tb = _effective_tool_behaviour("AB13", "auto_replace", rule_overrides)
        severity = "suggestion" if eff_tb == "auto_replace" else "warning"
        out.append(Finding(
            rule_id="AB13",
            category="abbreviations",
            start=m.start(), end=m.end(),
            original=surface,
            suggestion=stripped,
            message=_rule_label("AB13"),
            severity=severity,
            autofixable=True,
        ))
    return out


@lru_cache(maxsize=1)
def _apostrophe_plural_rx() -> re.Pattern[str]:
    # ``ICU's are`` / ``ICU's were`` — abbreviation + ``'s`` followed by a
    # plural verb that would make the apostrophe nonsensical as a possessive.
    # ``ICU's staff`` (noun after) stays untouched — it's a legitimate
    # possessive.
    plural_verbs = (
        "are", "were", "have", "had", "do", "did", "will", "shall", "may",
        "must", "can", "could", "should", "would", "include", "exist",
    )
    return re.compile(
        r"\b([A-Z]{2,}[A-Za-z]*)'s\s+(?=(?:"
        + "|".join(re.escape(v) for v in plural_verbs) + r")\b)"
    )


def _analyze_apostrophe_plural(
    text: str,
    *,
    rule_overrides: Optional[dict[str, dict[str, Any]]],
) -> list[Finding]:
    if not text:
        return []
    if _rule_disabled_by_override("AB09", rule_overrides):
        return []
    out: list[Finding] = []
    for m in _apostrophe_plural_rx().finditer(text):
        surface = m.group(0).rstrip()  # drop trailing whitespace captured by \s+
        abbr = m.group(1)
        suggestion = f"{abbr}s"
        # Determine the exact end position: just past the 's.
        apostrophe_pos = text.find("'s", m.start(1))
        if apostrophe_pos == -1:
            continue
        end = apostrophe_pos + 2
        start = m.start(1)
        eff_tb = _effective_tool_behaviour("AB09", "auto_replace", rule_overrides)
        severity = "suggestion" if eff_tb == "auto_replace" else "warning"
        out.append(Finding(
            rule_id="AB09",
            category="abbreviations",
            start=start, end=end,
            original=text[start:end],
            suggestion=suggestion,
            message=_rule_label("AB09"),
            severity=severity,
            autofixable=True,
        ))
    return out


# AB14 — expansion written in Title Case mid-sentence. Walks the full
# Abbreviation_List once to build a lookup of ``title_cased_expansion``
# → canonical lowercase expansion. At analyze time, every match whose
# position is NOT sentence-initial gets flagged.
@lru_cache(maxsize=1)
def _title_case_expansion_map() -> dict[str, str]:
    """Return ``{title_cased: lowercased_expansion}`` for every entry
    whose canonical expansion is lowercase in the workbook (i.e. the
    editorial team deemed it a common term, not a proper noun or org
    name). Entries whose expansion is ALREADY capitalised (eponyms,
    organizations) are excluded because capitalisation is correct for
    those.
    """
    out: dict[str, str] = {}
    for entries in _abbr_entries_by_abbr().values():
        for e in entries:
            exp = e.expansion
            if not exp:
                continue
            # Skip entries whose first word is capitalised in the
            # workbook — those are proper nouns / organizations where
            # Title Case is the correct form.
            first_word = exp.split()[0]
            if first_word[:1].isupper():
                continue
            # Build the Title Case variant: capitalise every word.
            title = " ".join(w[:1].upper() + w[1:] for w in exp.split())
            if title == exp:
                continue  # already Title Case → nothing to flag
            out[title] = exp
    return out


def _analyze_case_of_expansion(
    text: str,
    *,
    rule_overrides: Optional[dict[str, dict[str, Any]]],
) -> list[Finding]:
    """AB14: Title-cased common-term expansion mid-sentence → lowercase.

    Pure regex pass, no document state needed. The lookup is built from
    the Abbreviation_List at import time; proper-noun / organization
    expansions (first word capitalised in the workbook) are excluded so
    legitimate caps stay untouched.
    """
    if not text:
        return []
    if _rule_disabled_by_override("AB14", rule_overrides):
        return []
    lookup = _title_case_expansion_map()
    if not lookup:
        return []
    out: list[Finding] = []
    for title_form, lower_form in lookup.items():
        esc = re.escape(title_form)
        try:
            rx = re.compile(r"\b" + esc + r"\b")
        except re.error:
            continue
        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            # Skip sentence-initial — Title Case at a sentence start is
            # a legitimate capitalisation choice.
            if _is_sentence_initial(text, s):
                continue
            eff_tb = _effective_tool_behaviour("AB14", "flag", rule_overrides)
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            out.append(Finding(
                rule_id="AB14",
                category="abbreviations",
                start=s, end=e,
                original=m.group(0),
                suggestion=lower_form,
                message=_rule_label("AB14"),
                severity=severity,
                autofixable=True,
            ))
    return out


# AB10 article agreement — build an abbr→article lookup from document_state's
# chosen entries, scan for 'a X' / 'an X' where X is a known abbreviation
# and the article disagrees.
_ARTICLE_RX = re.compile(r"\b([Aa]n?|AN|AN?N?)\s+([A-Z][A-Za-z0-9]*)\b")


def _maybe_emit_ab10_before_span(
    text: str, span_start: int, expected_article: str,
    *,
    abbr_form: str,
    rule_overrides: Optional[dict[str, dict[str, Any]]],
    out: list[Finding],
) -> None:
    """Fire AB10 when the article immediately preceding ``span_start`` is
    ``a``/``an`` and disagrees with ``expected_article``.

    Called from AB02 so the article flip is proposed alongside the
    expansion→abbreviation compression that triggered it.
    """
    if _rule_disabled_by_override("AB10", rule_overrides):
        return
    # The article slot is "a" or "an" followed by exactly one space, then
    # the span. Walk backward from span_start.
    if span_start < 2 or text[span_start - 1] != " ":
        return
    i = span_start - 2
    # Skip back past the article letters.
    j = i
    while j >= 0 and text[j].isalpha():
        j -= 1
    article = text[j + 1:i + 1]
    if article.lower() not in ("a", "an"):
        return
    if article.lower() == expected_article:
        return
    if article[:1].isupper():
        fix = expected_article[:1].upper() + expected_article[1:]
    else:
        fix = expected_article
    eff_tb = _effective_tool_behaviour("AB10", "auto_replace", rule_overrides)
    severity = "suggestion" if eff_tb == "auto_replace" else "warning"
    out.append(Finding(
        rule_id="AB10",
        category="abbreviations",
        start=j + 1, end=i + 1,
        original=article,
        suggestion=fix,
        message=f"{_rule_label('AB10')}: {article} → {fix} before {abbr_form}",
        severity=severity,
        autofixable=True,
    ))


def _analyze_article_agreement(
    text: str,
    *,
    document_state: Optional[dict[str, _AbbrState]],
    rule_overrides: Optional[dict[str, dict[str, Any]]],
) -> list[Finding]:
    if not text or not document_state:
        return []
    if _rule_disabled_by_override("AB10", rule_overrides):
        return []
    out: list[Finding] = []
    for m in _ARTICLE_RX.finditer(text):
        article = m.group(1)
        abbr = m.group(2)
        s = document_state.get(abbr)
        if s is None:
            continue
        expected = s.chosen_entry.article
        if expected not in ("a", "an"):
            continue
        article_lc = article.lower()
        if article_lc == expected:
            continue
        # Preserve case: 'A' stays 'A', 'An' stays 'An', 'a' stays 'a'.
        if article[:1].isupper():
            fix = expected[:1].upper() + expected[1:]
        else:
            fix = expected
        eff_tb = _effective_tool_behaviour("AB10", "auto_replace", rule_overrides)
        severity = "suggestion" if eff_tb == "auto_replace" else "warning"
        art_start = m.start(1)
        art_end = m.end(1)
        out.append(Finding(
            rule_id="AB10",
            category="abbreviations",
            start=art_start, end=art_end,
            original=text[art_start:art_end],
            suggestion=fix,
            message=f"{_rule_label('AB10')}: {article} → {fix} before {abbr}",
            severity=severity,
            autofixable=True,
        ))
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def analyze_abbreviations(
    text: str,
    *,
    para_idx: int = 0,
    audience: str = "general",
    min_uses: int = 2,
    document_state: Optional[dict[str, _AbbrState]] = None,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
    para_roles: Optional[dict[int, dict]] = None,
) -> list[Finding]:
    """Run every Phase-A + Phase-B rule over a single paragraph.

    ``document_state`` is REQUIRED to produce AB01/AB02/AB04/AB05/AB10
    findings — the caller (router) builds it once per analyze request
    via :func:`build_document_state` and threads it into each per-
    paragraph call. When ``None``, only paragraph-local rules fire
    (Do_Not_Use + AB09 + AB13).

    ``para_idx`` identifies which paragraph this call is handling so
    rules anchored on cross-paragraph positions (AB01 fires only in the
    paragraph with the first abbr occurrence) know whether to emit here.
    """
    # These settings are reserved for the Phase-B filter / caller — the
    # per-paragraph function only needs state + overrides.
    _ = audience
    out: list[Finding] = []
    out.extend(analyze_do_not_use(text, rule_overrides=rule_overrides))
    out.extend(_analyze_periods_in_initialism(text, rule_overrides=rule_overrides))
    out.extend(_analyze_apostrophe_plural(text, rule_overrides=rule_overrides))
    out.extend(_analyze_case_of_expansion(text, rule_overrides=rule_overrides))
    if document_state is not None:
        out.extend(_emit_doc_scope_findings(
            text, para_idx, document_state,
            min_uses=min_uses, rule_overrides=rule_overrides,
            para_roles=para_roles,
        ))
        out.extend(_analyze_article_agreement(
            text, document_state=document_state, rule_overrides=rule_overrides,
        ))
    return out
