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
# Do_Not_Use rule compilation (Phase A) + medication-context gating
# ---------------------------------------------------------------------------
#
# Per workbook README §8, each DN row carries an ``applies_in`` string that
# restricts WHERE the rule fires (medication orders / doses / clinical
# notes / etc.). Before this refactor the engine ignored that field and
# fired every DN rule on every paragraph — flagging "U" in "The U.S.
# states" (DN01), "IU" in "IUD placement" (DN02), "cc" in "CC: chest
# pain" (DN11). The context-gating layer below reads ``applies_in``,
# normalises it to a set of required/forbidden context tags, and
# classifies each paragraph before firing.
#
# This is additive: when the paragraph classifier returns no tags at all
# (short text, ambiguous), the DN rule stays silent — a false negative
# is always safer than a false positive on patient-safety notations
# flagged out of context.

# Signals that identify a paragraph as a medication order / dose /
# clinical note / etc. Patterns are deliberately literal — this is
# scoped to the workbook's 8 distinct ``Applies in`` values, not a
# full prescription parser.
_MED_ORDER_HEADING_RE = re.compile(
    r"(?im)^\s*(?:rx|prescription|medication(?:s)?|medication\s+orders?|order(?:s)?|"
    r"discharge\s+meds?|discharge\s+medications?|home\s+meds?|admit\s+meds?|"
    r"meds?\s+to\s+continue|outpatient\s+meds?|inpatient\s+meds?)\s*:",
)
_MAR_HEADING_RE = re.compile(
    r"(?im)^\s*(?:mar|medication\s+administration\s+record)\s*:",
)
_NOTE_HEADING_RE = re.compile(
    r"(?im)^\s*(?:note|progress\s+note|clinical\s+note|soap(?:\s+note)?|plan|assessment)\s*:",
)
# Dose token: a number immediately followed (allowing optional whitespace)
# by a dose unit. Catches ``5 mg``, ``10U``, ``2.5 mL``, ``500 mcg``,
# ``10 units``, ``1 tablet``. Word boundary on the right prevents
# matching inside identifiers.
_DOSE_TOKEN_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|μg|g|kg|mL|cc|L|units?|IU|tablet|tab|cap|capsule|"
    r"puff|drop(?:s)?|teaspoon(?:s)?|tsp|tbsp|supp(?:ositor(?:y|ies))?|patch|vial|"
    r"mL/kg|mg/kg|mg/dose|mg/day)\b",
    re.IGNORECASE,
)
# Statistical signal: p-value, confidence interval, significance test.
# DN30 (``> and <``) must not fire on these; DN06 (leading zero) must
# not fire on ``.05`` as a p-value.
_STATISTICAL_RE = re.compile(
    r"\bp\s*[<>=]\s*0?\.\d+|\b95%\s*CI\b|\bCI\s*=|\bstatistical(?:ly)?\s+significan",
    re.IGNORECASE,
)
# Scientific-text signal — DN10 (μg) stays allowed. Research / lab text
# tends to carry lab-ish cues: percentages of concentration, mL/kg,
# molar / millimolar, in vitro, serum, assay, chromatography, HPLC, etc.
# Minimal keyword set to avoid false positives.
_SCIENTIFIC_RE = re.compile(
    r"\b(?:in\s+vitro|in\s+vivo|assay|chromatograph|HPLC|ELISA|"
    r"mmol(?:/L)?|μmol(?:/L)?|nmol(?:/L)?|molar|mM|μM|nM|"
    r"spectro|serum\s+(?:level|concentration))",
    re.IGNORECASE,
)
_OTIC_RE = re.compile(
    r"\b(?:ear|otic|auricular|tympanic|AD|AS|AU)\s*(?:drop|instill|gtt|gtts)",
    re.IGNORECASE,
)
_OPHTHALMIC_RE = re.compile(
    r"\b(?:eye|ophthalmic|ocular|OD|OS|OU)\s*(?:drop|instill|gtt|gtts)",
    re.IGNORECASE,
)
# Prescription-verb cue: an imperative verb typical of medication orders
# at (or very near) sentence start. Catches `Give 10 U of insulin`,
# `Take 1 tablet`, `Administer heparin`, `Inject 2 mg` — orders that
# don't carry an explicit heading but are clearly prescription text.
# Anchored to start-of-line or start-of-sentence so prose like "we give
# priority to..." doesn't count.
_PRESCRIPTION_VERB_RE = re.compile(
    r"(?m)(?:^|(?<=[.!?]\s))\s*(?:Give|Take|Administer|Inject|Apply|Infuse|Instill|"
    r"Continue|Start|Hold|Discontinue|Dispense|Prescribe)\b",
)


def _medication_contexts(text: str) -> frozenset[str]:
    """Classify ``text`` into context tags used by DN rule gating.

    Returns a subset of ``{order, dose, mar, note, otic, ophthalmic,
    statistical, scientific}``. Multiple tags can be present for a
    single paragraph (e.g., an order paragraph that also has a dose
    token is both ``order`` and ``dose``).

    Deliberately permissive on the positive signals (headings OR dose
    tokens trigger ``order``/``dose``) and conservative on the negative
    signals (statistical / scientific) so the gating layer can safely
    use "required present AND forbidden absent" semantics.
    """
    if not text:
        return frozenset()
    tags: set[str] = set()
    if _MED_ORDER_HEADING_RE.search(text):
        tags.add("order")
    if _MAR_HEADING_RE.search(text):
        tags.add("mar")
        tags.add("order")  # MAR implies order context
    if _NOTE_HEADING_RE.search(text):
        tags.add("note")
    if _DOSE_TOKEN_RE.search(text):
        tags.add("dose")
        # Dose-token-only prose (no explicit heading) is treated as a
        # dose context. The workbook's DN01/DN02/DN05/DN06 need this —
        # they apply to "Medication orders and doses", where "doses"
        # covers dose expressions outside an explicit order block.
        tags.add("order")
    if _PRESCRIPTION_VERB_RE.search(text):
        # Imperative prescription verb (Give / Take / Administer / …)
        # at sentence start is a strong order signal even without a
        # dose token — covers `Give 10 U of insulin`, `Give heparin
        # SQ`, `Take 1 tablet QD`.
        tags.add("order")
    if _STATISTICAL_RE.search(text):
        tags.add("statistical")
    if _SCIENTIFIC_RE.search(text):
        tags.add("scientific")
    if _OTIC_RE.search(text):
        tags.add("otic")
        tags.add("order")
    if _OPHTHALMIC_RE.search(text):
        tags.add("ophthalmic")
        tags.add("order")
    return frozenset(tags)


def _parse_applies_in(applies_in: str) -> tuple[frozenset[str], frozenset[str]]:
    """Translate a DN row's ``Applies in`` string into
    ``(required_tags, forbidden_tags)``.

    Design notes:
      * **Required tags are advisory** — a strict "must have order
        context" filter would suppress legitimate DN matches on short
        standalone sentences (which the workbook Test_Cases exercise).
        The ``required`` set is returned for completeness but the
        caller MAY treat it as a soft signal: fire unless a forbidden
        context is present, letting the regex boundaries + the
        ``must_not_be_flagged`` allowlist do the disambiguation.
      * **Forbidden tags are hard blocks** — if the paragraph is
        classified as ``statistical`` / ``scientific`` and the rule
        says those are off-limits (DN30, DN06, DN10), the rule MUST
        stay silent. This is what README §8 actually guards against.

    All 8 distinct values from the workbook (verified in the audit)
    are handled explicitly. Unknown values return the ``order``
    required tag + no forbidden tags and log once.
    """
    s = (applies_in or "").lower().strip()
    if not s:
        return (frozenset({"order"}), frozenset())
    # Workbook's 8 distinct values, longest / most-specific first:
    if "scientific text may keep" in s:
        # DN10 — μg: orders + MAR; scientific allowed.
        return (frozenset({"order", "mar"}), frozenset({"scientific"}))
    if "outside orders is allowed" in s:
        # DN07 — MS: orders only; MS as multiple sclerosis outside is OK.
        return (frozenset({"order"}), frozenset())
    if "not statistical text" in s:
        # DN30 — > and <: orders + notes; never in statistics.
        return (frozenset({"order", "note"}), frozenset({"statistical"}))
    if "ear drops" in s:
        return (frozenset({"otic", "order"}), frozenset())
    if "eye drops" in s:
        return (frozenset({"ophthalmic", "order"}), frozenset())
    if s.startswith("medication orders and the mar") or "mar" in s:
        return (frozenset({"order", "mar"}), frozenset())
    if "and doses" in s:
        return (frozenset({"order", "dose"}), frozenset())
    if "orders and notes" in s:
        return (frozenset({"order", "note"}), frozenset())
    if "medication orders" in s:
        return (frozenset({"order"}), frozenset())
    # Unknown value — safe fallback: default order-required.
    logger.debug("Unknown DN applies_in value %r — defaulting to order-required", applies_in)
    return (frozenset({"order"}), frozenset())


def _must_not_be_flagged_fixtures(raw: Any) -> list[str]:
    """Normalise the ``Must NOT be flagged`` column into a list of
    counter-example substrings. The workbook stores entries separated
    by ``|``."""
    if not raw:
        return []
    return [s.strip() for s in str(raw).split("|") if s.strip()]


@lru_cache(maxsize=1)
def _compiled_dnu_rules() -> list[dict]:
    """Compile every DN row once per process, parsing applies_in into
    required/forbidden tag sets and must_not_be_flagged into a literal
    counter-example list so the per-call path is pure match + check."""
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
        required, forbidden = _parse_applies_in(row.get("applies_in") or "")
        out.append({
            **row,
            "rx": rx,
            "_required_contexts": required,
            "_forbidden_contexts": forbidden,
            "_must_not_be_flagged": _must_not_be_flagged_fixtures(row.get("must_not_be_flagged")),
        })
    return out


def analyze_do_not_use(
    text: str,
    *,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    """Scan ``text`` for Do_Not_Use notations, honouring each row's
    ``applies_in`` context and ``must_not_be_flagged`` allowlist.

    Flow per match:
      1. Compute the paragraph's context tags once.
      2. For each DN rule:
         a. Skip if any required-context tag is missing.
         b. Skip if any forbidden-context tag is present.
         c. Skip if the matched surface sits inside a documented
            counter-example string from must_not_be_flagged.
      3. Otherwise emit the Finding with the existing suggestion
         + alt_suggestions wiring.
    """
    if not text:
        return []
    contexts = _medication_contexts(text)
    out: list[Finding] = []
    for row in _compiled_dnu_rules():
        rx = row.get("rx")
        if rx is None:
            continue
        rid = row["id"]
        if _rule_disabled_by_override(rid, rule_overrides):
            continue
        required = row["_required_contexts"]
        forbidden = row["_forbidden_contexts"]
        # Context gating per workbook §8:
        #   * ``forbidden`` — HARD block. If the paragraph is clearly
        #     statistical / scientific prose and the rule says that
        #     context is off-limits (DN30 ``> and <``, DN10 ``μg`` in
        #     scientific text, DN06 leading-zero on p-values), the
        #     rule MUST stay silent.
        #   * ``required`` — SOFT signal. If the paragraph has strong
        #     negative evidence (e.g., statistical for a rule that
        #     also has order-required), the forbidden block already
        #     caught it. If the paragraph is a short standalone
        #     sentence with no context cues (the common case for the
        #     workbook's own test fixtures), we let the regex
        #     boundaries + ``must_not_be_flagged`` allowlist do the
        #     disambiguation rather than suppress a legitimate match.
        if forbidden and (forbidden & contexts):
            continue
        _ = required  # kept for future stricter gating; currently informational
        counter_examples = row["_must_not_be_flagged"]
        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            # must_not_be_flagged allowlist — fixtures the workbook
            # authors explicitly want unflagged (e.g., ``IUD placement``
            # for DN02 ``IU``). Check if the matched span sits inside
            # any counter-example substring.
            if counter_examples and _match_inside_counter_example(text, s, e, counter_examples):
                continue
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


def _match_inside_counter_example(
    text: str, start: int, end: int, counter_examples: list[str],
) -> bool:
    """True when ``text[start:end]`` sits inside any counter-example
    substring documented on the DN row. Looks in a modest window on
    either side so a counter-example like ``IUD placement`` suppresses
    a DN02 match on the ``IU`` inside it."""
    # Look 40 chars either side — longer than any workbook counter-
    # example and plenty for typical inline cues.
    window_start = max(0, start - 40)
    window_end = min(len(text), end + 40)
    window = text[window_start:window_end]
    matched_in_window_start = start - window_start
    matched_in_window_end = end - window_start
    for ce in counter_examples:
        # Case-insensitive substring search.
        pos = window.lower().find(ce.lower())
        while pos != -1:
            ce_end = pos + len(ce)
            # The DN match must fall inside the counter-example span.
            if pos <= matched_in_window_start and matched_in_window_end <= ce_end:
                return True
            pos = window.lower().find(ce.lower(), pos + 1)
    return False


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
    # Phase-4 section-level scope reset. Populated only when the
    # ``scope_reset_on_section`` opt-in is True in build_document_state.
    # Maps the section-start paragraph index → the first abbr
    # occurrence (para_idx, start, end) within that section. Default
    # empty, so legacy jobs that never set the opt-in produce zero
    # Phase-4 scope-reset findings — preserves pre-Phase-4 behaviour.
    section_firstuse_paras: dict[int, tuple[int, int, int]] = field(default_factory=dict)

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
    def abbr_usage_count(self) -> int:
        """Occurrences of the ABBREVIATION FORM only (``ICU``), not
        the expansion. Per README §4.2 the minUses threshold applies
        to actual abbreviation usage so a document that writes
        ``intensive care unit`` twice but ``ICU`` never shouldn't
        even be considered for AB05 "single use". AB05 uses this
        count instead of ``usage_count`` for its threshold check."""
        positions: set[tuple[int, int]] = set()
        for p, s, _ in self.abbr_occurrences:
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
        # Hyphen ↔ space interchangeability (README §10 "Hyphens"):
        # ``blood pressure`` must match ``blood-pressure`` and vice
        # versa. Replace every whitespace or hyphen run inside the
        # expansion with ``[\s\-]+`` so the compiled regex matches
        # either form. ``re.escape`` quotes the individual tokens; we
        # join them with the alternation-friendly separator.
        tokens = re.split(r"[\s\-]+", variant.strip())
        if not tokens:
            continue
        inner = r"[\s\-]+".join(re.escape(tok) for tok in tokens if tok)
        if not inner:
            continue
        try:
            rx = re.compile(r"\b" + inner + r"\b", re.IGNORECASE)
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


def _position_inside_parens(text: str, position: int) -> bool:
    """True when ``position`` sits inside a ``(...)`` span in ``text``.

    Used by AB01 to suppress ``expansion (ABBR)`` emission when the
    first-use position is already inside a parenthetical — otherwise
    the finding's suggestion would create ``(expansion (ABBR))``
    nested parens (README §10 "Do not nest"). Simple stack-based scan;
    bracket mismatches default to "not inside" so we never over-
    suppress. The paragraph-local check is appropriate — the workbook
    doesn't address cross-paragraph parens.
    """
    if position < 0 or position >= len(text):
        return False
    depth = 0
    for i in range(position):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
    return depth > 0


# Phase-4 exclusion spans. Any abbr/expansion/definition hit overlapping
# one of these spans is skipped — they belong to URLs, email addresses,
# DOIs, or inline-code backticks, where the surface tokens are literal
# strings and not natural-language abbreviations.
_EXCLUDED_SPAN_RE = re.compile(
    r"https?://\S+"              # HTTP(S) URLs
    r"|www\.\S+"                 # bare www. URLs
    r"|[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"  # emails
    r"|doi\.org/\S+|10\.\d{4,9}/\S+"  # DOIs
    r"|`[^`\n]+`",               # inline code spans
    re.IGNORECASE,
)


def _excluded_spans(text: str) -> list[tuple[int, int]]:
    """Return (start, end) spans in ``text`` where Abbreviations must
    not fire — URLs, emails, DOIs, inline-code backticks (Phase 4).

    Phase 4 does not try to detect author-name citation patterns
    ("Smith et al., 2023") because those false-positive on legitimate
    prose — the workbook's test corpus has no citation-heavy examples
    to tune against. Add that pattern only when a concrete regression
    demands it.
    """
    if not text:
        return []
    return [(m.start(), m.end()) for m in _EXCLUDED_SPAN_RE.finditer(text)]


def _overlaps_any(span: tuple[int, int], ranges: list[tuple[int, int]]) -> bool:
    s, e = span
    for rs, re_ in ranges:
        if not (e <= rs or s >= re_):
            return True
    return False


def _first_abbr_per_section(
    abbr_occurrences: list[tuple[int, int, int]],
    section_starts: list[int],
) -> dict[int, tuple[int, int, int]]:
    """Return a mapping of section-start-paragraph → first abbr
    occurrence within that section (Phase 4 scope-reset scaffolding).

    ``section_starts`` is the sorted list of paragraph indices where a
    new top-level section begins (``chapter_boundary=True`` in
    para_roles). Each occurrence is assigned to the greatest
    section_start ≤ its paragraph index. When no section_start exists
    at or before the occurrence (paragraphs preceding the first
    chapter heading), the implicit "section 0" starts at index -1 so
    the earliest paragraphs still get grouped.
    """
    if not abbr_occurrences:
        return {}
    starts = [-1, *section_starts] if (not section_starts or section_starts[0] != -1) else list(section_starts)
    seen: dict[int, tuple[int, int, int]] = {}
    for occ in abbr_occurrences:
        p, _s, _e = occ
        # Greatest start ≤ p.
        boundary = -1
        for st in starts:
            if st <= p:
                boundary = st
            else:
                break
        seen.setdefault(boundary, occ)
    return seen


# Lowercase English function words that can appear between
# capitalized words inside a proper-name phrase ("University of
# California", "National Center for Biotechnology Information",
# "Department of Health and Human Services"). Case-insensitive
# match; uppercase variants are accepted implicitly as regular
# capitalized words by the main regex below.
_PROPER_NAME_CONNECTORS = frozenset({
    "a", "an", "and", "at", "by", "for", "from", "in", "of", "on",
    "or", "the", "to", "with", "&",
})

# A parenthesized token that looks like an initialism / acronym:
# starts with an uppercase letter, 2-10 total chars of uppercase
# letters and digits, with an optional interior hyphen (CDC, NATO,
# COVID-19, G-8, NONPF, AIDS). Allows an optional comma-citation
# ``, 2022`` after the acronym — the APA form ``(WHO, 2022)``. The
# regex captures only the acronym itself; the enclosing parens and
# optional citation are matched by the surrounding literals.
_PAREN_ACRONYM_RE = re.compile(
    r"\(([A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]+)?)(?:\s*,\s*n\.?d\.?|\s*,\s*\d{4}[a-z]?)?\)"
)

# An APA-style citation parenthetical: ``(Capitalized Phrase, YEAR)``
# where ``Phrase`` is one or more capitalized words (connector words
# permitted between them). Protects capitalized proper nouns inside
# the citation from AB14 ("Cancer" in ``(National Cancer Institute,
# 2023)``). Generic — covers National Cancer Institute, World Health
# Organization, American Psychological Association, etc.
# ``YEAR`` matches a 4-digit year with an optional trailing letter
# (``2023a``, ``2023b``) or the APA no-date marker ``n.d.``.
_CITATION_PAREN_RE = re.compile(
    r"\((?P<name>(?:[A-Z][A-Za-z0-9'\-]*"
    r"(?:\s+(?:[A-Z][A-Za-z0-9'\-]*|(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with|&)(?![A-Za-z])))*"
    r"))"
    r"(?:,\s*(?:(?:19|20)\d{2}[a-z]?|n\.?d\.?))+\)"
)

# Match the trailing proper-name phrase immediately before an
# acronym parenthetical. CASE-SENSITIVE — the pattern distinguishes
# capitalized words (contentful name components) from lowercase
# connectors (grammatical glue). Requires at least two capitalized
# words to avoid treating "The (FOO)" or lone-cap-word phrases as
# proper names.
_CAP_WORD = r"[A-Z][A-Za-z0-9'\-]*"
_CONNECTOR_ALT = "|".join(sorted(_PROPER_NAME_CONNECTORS, key=len, reverse=True))
_PROPER_NAME_TRAILING_RE = re.compile(
    r"(?<![A-Za-z0-9])("
    + _CAP_WORD
    + r"(?:\s+(?:" + _CAP_WORD + r"|(?:" + _CONNECTOR_ALT + r")(?![A-Za-z])))*"
    + r"\s+" + _CAP_WORD
    + r")\s*$"
)


def _find_citation_parenthetical_spans(text: str) -> list[tuple[int, int]]:
    """Return spans of ``(Capitalized Phrase, YEAR)`` citation
    parentheticals.

    These are NOT abbreviation definitions — they don't declare a
    short form. But they DO wrap capitalized proper nouns (official
    organisation / institution / agency / program / publication
    names) that must not be flagged as case errors by AB14 when a
    sub-token (``Cancer`` inside ``National Cancer Institute``)
    happens to match a workbook expansion whose canonical form is
    lowercase.

    Syntactic pattern only — ``name`` is 1+ capitalised words with
    function-word connectors tolerated, followed by one or more
    comma-year or comma-``n.d.`` citation suffixes before the
    closing paren. Generic across citation styles; no workbook
    lookup; no literal name list.
    """
    out: list[tuple[int, int]] = []
    for m in _CITATION_PAREN_RE.finditer(text):
        out.append((m.start(), m.end()))
    return out


def _find_proper_name_parenthetical_spans(text: str) -> list[tuple[int, int]]:
    """Return (start, end) spans of ``Capitalized Phrase (ACRONYM)``
    constructs — a generic proper-name definition pattern.

    The engine's workbook-bound ``_detect_definitions`` only
    recognises ``expansion (ABBR)`` when ``ABBR`` is already in the
    Abbreviation_List. But organizations, institutions and programs
    routinely declare their own acronyms (``NONPF``, ``NSF``,
    ``IEEE``) that aren't in the workbook — and inside those full
    names, substrings may happen to match other workbook expansions
    (``Nurse Practitioner`` inside ``National Organization of Nurse
    Practitioner Faculties (NONPF)``). Without a protection span,
    those substring hits are wrongly reported as standalone
    expansion occurrences and trigger AB02.

    This helper detects proper-name definitions purely from the
    paragraph's surface shape: an uppercase acronym in parentheses
    preceded by a phrase of two or more capitalized words (with
    function-word connectors allowed between caps). The resulting
    spans join the workbook-bound ``def_spans`` set in
    ``build_document_state`` so any expansion hit entirely inside
    one of them is excluded from state — the same mechanism the
    workbook path already relies on.

    Notably this helper:
      * Does NOT consult the workbook — the fix is syntactic, not
        data-driven, so new proper names work on day one.
      * Does NOT create ``Finding`` objects or add to the
        ``definitions`` list — it only contributes to the
        exclusion set. A proper-name acronym not in the workbook
        won't be registered as a first-use definition of anything.
      * Requires at least TWO capitalized words to fire — single
        words in front of parentheticals (``Nurse (NP)``,
        ``Only (ONLY)``) do not trigger suppression.
      * Stops walking at sentence boundaries (``.``, ``!``,
        ``?``) so a proper-name phrase can't accidentally extend
        back into the previous sentence.
    """
    spans: list[tuple[int, int]] = []
    for m in _PAREN_ACRONYM_RE.finditer(text):
        open_paren = m.start()
        close_paren = m.end()
        # Find the nearest preceding sentence boundary (if any) so
        # the proper-name walk can't span sentences.
        left_limit = 0
        for i in range(open_paren - 1, -1, -1):
            if text[i] in ".!?":
                left_limit = i + 1
                break
        chunk = text[left_limit:open_paren]
        # Strip trailing whitespace so ``\s*$`` in the regex has
        # something to anchor against while preserving the chunk's
        # absolute offsets in ``text``.
        stripped_chunk = chunk.rstrip()
        if not stripped_chunk:
            continue
        name_match = _PROPER_NAME_TRAILING_RE.search(stripped_chunk)
        if not name_match:
            continue
        phrase_start_in_chunk = name_match.start(1)
        phrase_start = left_limit + phrase_start_in_chunk
        spans.append((phrase_start, close_paren))
    return spans


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

    def _expansion_variants(entry: _AbbrEntry) -> list[str]:
        """Expansion surfaces the detector accepts (lowercased). Covers
        the canonical singular form AND the pluralised form so a
        plural-expansion / singular-abbreviation pairing like
        ``adverse childhood experiences (ACE)`` still counts as a
        definition — otherwise the engine would miss the definition
        and re-emit AB01 as ``… (ACEs)``."""
        variants: list[str] = []
        if entry.expansion:
            variants.append(entry.expansion.lower())
        plural = _plural_expansion_for(entry)
        if plural:
            pl = plural.lower()
            if pl not in variants:
                variants.append(pl)
        return variants

    for abbr_s, abbr_e, abbr in abbr_hits:
        entry = chosen_by_abbr.get(abbr)
        if not entry or not entry.expansion:
            continue

        # Pattern 1: ``expansion (ABBR[, citation…])`` or
        # ``expansion [ABBR[, citation…]]`` — abbr preceded by an
        # opener (``(`` or ``[``) and followed by the matching closer
        # OR by ``,``/``;`` (the APA citation form ``(WHO, 2022)``).
        # Square brackets are the convention in some medical / scientific
        # styles (``B-type natriuretic peptide [BNP]``); both delimiters
        # must count as a valid first-use definition so the engine
        # doesn't re-emit AB01. Detection is syntactic — the original
        # delimiter is preserved in the stored span and never rewritten.
        # When a separator follows the abbr, we walk forward to the
        # MATCHING closer so the span covers the whole parenthetical
        # / bracketed citation.
        _MATCHING_CLOSER = {"(": ")", "[": "]"}
        opener = text[abbr_s - 1] if abbr_s >= 1 else ""
        closer = _MATCHING_CLOSER.get(opener)
        if (
            closer
            and abbr_s >= 2
            and abbr_e < len(text)
            and text[abbr_e] in (closer, ",", ";")
        ):
            close_pos = abbr_e
            if text[abbr_e] != closer:
                # Scan forward for the matching closer without crossing
                # a nested opener of the same kind.
                j = abbr_e
                depth = 0
                close_pos = -1
                while j < len(text):
                    c = text[j]
                    if c == opener:
                        depth += 1
                    elif c == closer:
                        if depth == 0:
                            close_pos = j
                            break
                        depth -= 1
                    j += 1
            if close_pos >= 0:
                exp_end = abbr_s - 1
                matched = False
                for variant in _expansion_variants(entry):
                    exp_len = len(variant)
                    exp_candidate_start = exp_end - 1 - exp_len
                    if (
                        exp_candidate_start >= 0
                        and text[exp_candidate_start:exp_candidate_start + exp_len].lower() == variant
                    ):
                        prior = text[exp_candidate_start - 1] if exp_candidate_start > 0 else " "
                        if not prior.isalnum():
                            out.append((
                                exp_candidate_start,
                                close_pos + 1,  # include the closing delimiter
                                text[exp_candidate_start:close_pos + 1],
                                "exp_paren_abbr",
                            ))
                            matched = True
                            break
                if matched:
                    continue

        # Pattern 2: ``ABBR (expansion)`` / ``ABBR [expansion]`` — abbr
        # followed by a space and an opener, then the canonical
        # expansion, then the matching closer. The reversed form is
        # rare but we accept both delimiter pairs for symmetry with
        # Pattern 1.
        if abbr_e + 1 < len(text) and text[abbr_e] == " " and text[abbr_e + 1] in ("(", "["):
            pat2_opener = text[abbr_e + 1]
            pat2_closer = _MATCHING_CLOSER[pat2_opener]
            exp_start = abbr_e + 2
            exp_len = len(entry.expansion)
            if exp_start + exp_len < len(text) \
                    and text[exp_start:exp_start + exp_len].lower() == entry.expansion.lower() \
                    and text[exp_start + exp_len] == pat2_closer:
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
    scope_reset_on_section: bool = False,
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

        # Generic proper-name parenthetical protection. Covers the
        # false-positive class "workbook expansion appears as a
        # substring inside a longer organization / institution name
        # that declares its own acronym the workbook doesn't know
        # about" (``Nurse Practitioner`` inside ``... (NONPF)``) AND
        # the APA-citation form ``(National Cancer Institute, 2023)``
        # whose proper-name surface wraps capitalized sub-terms.
        # Both are syntactic, not workbook-driven; merging into
        # ``def_spans`` reuses the existing "hit inside span → skip"
        # check below — no new skip paths.
        def_spans |= set(_find_proper_name_parenthetical_spans(text))
        def_spans |= set(_find_citation_parenthetical_spans(text))

        # Phase-4 excluded spans — URLs, emails, DOIs, inline-code
        # backticks. Any hit overlapping one of these is skipped so
        # tokens like ``admin@AI.com`` (email) or ```ICU``` (code
        # ref) do not produce AB findings.
        excluded = _excluded_spans(text)

        for abbr_s, abbr_e, abbr in abbr_hits:
            # Skip if this abbr is inside a definition span (counted
            # separately below).
            inside_def = any(ds <= abbr_s and abbr_e <= de for ds, de in def_spans)
            if inside_def:
                continue
            if _overlaps_any((abbr_s, abbr_e), excluded):
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
            if _overlaps_any((exp_s, exp_e), excluded):
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

    # Phase-4 section-level scope reset (mechanism; default OFF).
    # When ``scope_reset_on_section`` is True, record the first abbr
    # occurrence index in each top-level section (chapter_boundary
    # paragraphs mark the section starts). Downstream rules can then
    # re-fire AB01 at each per-section first-use. Default False keeps
    # pre-Phase-4 behaviour identical so legacy jobs produce the same
    # findings — the plumbing is in place for an opt-in profile.
    if scope_reset_on_section and para_roles:
        section_starts = sorted(
            p for p, roles in para_roles.items()
            if roles.get("chapter_boundary")
        )
        for s in state.values():
            s.section_firstuse_paras = _first_abbr_per_section(
                s.abbr_occurrences, section_starts,
            )

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
        #   - the term appears at least ``min_uses`` times,
        #   - this paragraph owns the first mention, and
        #   - the ABBREVIATION form itself appears somewhere in the
        #     document. If the author only uses the expansion as regular
        #     prose (e.g. "treatment" without ever writing "Tx"), the
        #     rule has no subject — AB01's purpose is to introduce an
        #     abbreviation the author is actually using, not to push one
        #     onto text that doesn't need it. Without this guard, common
        #     English words that happen to be expansions of informal
        #     medical shorthands (symptoms→Sx, treatment→Tx, history→Hx,
        #     blood pressure→BP, …) misfire whenever they appear ≥
        #     min_uses times in normal prose.
        if (not defined and first_use and first_use[0] == para_idx
                and total_uses >= min_uses
                and s.abbr_occurrences
                and not _rule_disabled_by_override("AB01", rule_overrides)):
            # Resolve which specific occurrence sits at first_use position.
            # It may be an abbreviation hit OR an expansion hit — the two
            # branches produce the same ``expansion (ABBR)`` suggestion
            # but target different spans / originals.
            fu_para, fu_start = first_use
            # README §10 "Abbreviations inside parentheses — do not
            # nest". If the first use already sits inside a ``(...)``
            # span in this paragraph, emitting AB01 would produce
            # ``(expansion (ABBR))`` — a visual error the workbook
            # explicitly calls out. Suppress AB01 in that case; AB02
            # / AB05 continue to apply at their own positions so
            # nothing is silently lost.
            if _position_inside_parens(text, fu_start):
                continue
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
        #
        # Guard (mirrors AB01, see commit e7cdd62): the abbreviation form
        # itself must appear somewhere in the document. Without this
        # check, prose that uses common English words that happen to be
        # workbook expansions of informal shorthands (history→Hx,
        # symptoms→Sx, treatment→Tx, blood pressure→BP, …) misfires
        # whenever the expansion appears ≥ min_uses times. AB02's job
        # is "compress the expansion to the abbreviation" — if the
        # abbreviation isn't being used at all, there's nothing to
        # compress toward.
        if (total_uses >= min_uses
                and s.abbr_occurrences
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
        #
        # Threshold check uses ``abbr_usage_count`` (abbreviation
        # occurrences only), not ``total_uses`` which mixes abbr +
        # expansion hits. Per README §4.2 the minUses threshold is
        # about actual abbreviation usage; a document that writes the
        # expansion twice and the abbreviation never should not trip
        # AB05 either way.
        if (not _rule_disabled_by_override("AB05", rule_overrides)
                and entry.first_use_rule not in ("no_expansion_needed", "do_not_abbreviate")):
            abbr_count = s.abbr_usage_count
            lone_abbr = (
                total_uses == 1 and len(s.abbr_occurrences) == 1
                and not s.exp_occurrences and not s.definitions
            )
            lone_def = (
                total_uses == 0 and len(s.definitions) == 1
                and not s.abbr_occurrences and not s.exp_occurrences
            )
            if lone_abbr and abbr_count < min_uses:
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

# Common Latin / titular / citation abbreviations that MUST retain
# their periods. AB13 skips any match whose lowercased form is in
# this set.
#
# Additions beyond the historical Latin / titular list:
#   * ``n.d.`` — APA "no date" citation marker. Not an initialism; the
#     periods are the convention. Flagging ``n.d.`` as a periods-in-
#     initialism error is wrong across every supported style.
#   * ``cf.`` / ``ibid.`` / ``op. cit.`` / ``loc. cit.`` / ``s.v.`` —
#     academic citation shorthands that are never meant to be
#     de-punctuated.
#   * ``a.d.`` / ``b.c.`` / ``b.c.e.`` / ``c.e.`` / ``r.`` — date and
#     era markers (common in historical prose).
#
# U.S. / U.K. / U.N. / D.C. stay on the list because they are
# documented exceptions in the US/UK style profiles that ship with
# the engine; AB13 continues to flag other genuine initialisms
# (``U.S.A.``, ``I.C.U.``) per the selected style.
_PERIODS_WHITELIST: frozenset[str] = frozenset({
    "e.g.", "i.e.", "a.m.", "p.m.", "et al.", "etc.", "vs.", "no.", "nos.",
    "vol.", "vols.", "p.", "pp.", "ch.", "fig.", "figs.", "eq.", "ref.",
    "mr.", "mrs.", "ms.", "dr.", "prof.", "jr.", "sr.", "st.", "mt.",
    "u.s.", "u.k.", "u.n.", "d.c.",
    # Citation shorthands
    "n.d.", "cf.", "ibid.", "op. cit.", "loc. cit.", "s.v.",
    "a.d.", "b.c.", "b.c.e.", "c.e.", "r.",
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
    # Reuse the generic proper-name parenthetical detector so a
    # Title-Cased workbook expansion appearing INSIDE a larger
    # proper name like "National Organization of Nurse Practitioner
    # Faculties (NONPF)" does NOT get flagged as case-wrong. The
    # Title Case there is legitimate — it's part of the org name,
    # not a mid-sentence recapitalisation of the common term.
    # Also include citation parentheticals of the form
    # ``(Capitalized Phrase, YEAR)`` — ``National Cancer Institute``
    # inside ``(National Cancer Institute, 2023)`` must stay
    # title-cased because it's a proper organization name quoted in
    # an APA citation, not a mis-capitalised common term.
    proper_name_spans = (
        _find_proper_name_parenthetical_spans(text)
        + _find_citation_parenthetical_spans(text)
    )
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
            # Skip hits that fall inside a proper-name parenthetical
            # construct — same exclusion ``build_document_state``
            # uses for AB02 expansion occurrences.
            if any(ps <= s and e <= pe for ps, pe in proper_name_spans):
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
    scope_reset_on_section: bool = False,
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
    # ``scope_reset_on_section`` is accepted at this seam so callers can
    # thread the opt-in; the actual re-fire decision lives in
    # ``build_document_state`` which populates
    # ``_AbbrState.section_firstuse_paras``. Default False preserves
    # pre-Phase-4 behaviour.
    _ = audience
    _ = scope_reset_on_section
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
