"""Metadata helpers for the Abbreviations module serializer.

Phase 2 of the Abbreviations audit mandates that the GET /findings
response expose the workbook metadata that the Abbreviations engine
currently drops on the floor:

  * ``problem_label``   — short human-readable label per README §9
                          ("First use", "Repeated expansion",
                          "Definition after use", "Single use",
                          "Do not use", "Ambiguous", …).
  * ``note``            — the workbook ``Note`` column (per-row warning
                          like "Never use MS for morphine sulfate").
  * ``mw_lookup``       — Merriam-Webster look-up link from the
                          Abbreviation_List row. Null for rows the
                          workbook does not link.
  * ``confidence``      — ``High`` or ``Medium - verify`` from the
                          workbook.
  * ``tool_behaviour``  — e.g., ``Flag and suggest``, ``Auto-fix``;
                          the workbook's recommendation, independent
                          of the engine's runtime safety policy.
  * ``applies_in``      — DN rows only: the medication-context string
                          (``Medication orders``, ``Orders and notes``
                          and so on).
  * ``meanings``        — AB07 only: ordered list of candidate
                          meanings, best cue match first. Derived from
                          ``alt_suggestions`` which the engine already
                          populates sorted by descending score.

All lookups are pure functions over the already-loaded workbook JSON
(no new disk reads at request time; ``abbreviations._list_data`` /
``_dnu_data`` are ``@lru_cache``'d).

This module is import-safe from the router without creating a cycle —
it only reads the config JSONs via the existing ``abbreviations``
module's data loaders.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any, Optional

from . import abbreviations as _ab

logger = logging.getLogger(__name__)


# ─── Problem-label mapping per README §9 ──────────────────────────
#
# Keys are the rule_id values the engine emits. The 17 AB rule IDs
# map to their README §9 labels; the 32 DN rule IDs all collapse into
# a single "Do not use" label (patient-safety notation).

_AB_PROBLEM_LABELS: dict[str, str] = {
    "AB01": "First use",
    "AB02": "Repeated expansion",
    "AB03": "Definition after use",
    "AB04": "Repeated definition",
    "AB05": "Single use",
    "AB06": "Inconsistent form",
    "AB07": "Ambiguous",
    "AB08": "Do not use",
    "AB09": "Plural apostrophe",
    "AB10": "Article agreement",
    "AB11": "Abbreviation in heading",
    "AB12": "Abstract-only definition",
    "AB13": "Periods in initialism",
    "AB14": "Case of expansion",
    "AB15": "Table/figure definition missing",
    "AB16": "Scope reset",
    "AB17": "Never expand",
}


def problem_label_for(rule_id: Optional[str]) -> Optional[str]:
    """Return the short README-§9 problem label for ``rule_id``, or
    None when the rule is not an abbreviation rule. DN rules all map
    to ``Do not use`` per README §9."""
    if not rule_id:
        return None
    if rule_id.startswith("DN"):
        return "Do not use"
    return _AB_PROBLEM_LABELS.get(rule_id)


# ─── Do_Not_Use metadata lookup ───────────────────────────────────

@lru_cache(maxsize=1)
def _dn_index() -> dict[str, dict[str, Any]]:
    """Rule ID → full workbook row. Loaded once per process."""
    out: dict[str, dict[str, Any]] = {}
    for row in (_ab._dnu_data().get("rules") or []):
        rid = row.get("id")
        if rid:
            out[rid] = row
    return out


def dn_metadata_for(rule_id: str) -> dict[str, Optional[str]]:
    """Return the DN row's reviewer-facing metadata or an empty dict
    when the rule_id isn't a DN rule.

    Keys:
      note / confidence / applies_in / tool_behaviour / source / notation
    """
    row = _dn_index().get(rule_id or "")
    if not row:
        return {}
    return {
        "note": row.get("note"),
        "confidence": row.get("confidence"),
        "applies_in": row.get("applies_in"),
        "tool_behaviour": row.get("tool_behaviour"),
        "source": row.get("source"),
        "notation": row.get("notation"),
    }


# ─── Abbreviation_List metadata lookup ────────────────────────────

@lru_cache(maxsize=1)
def _abbr_index_by_token() -> dict[str, list[dict[str, Any]]]:
    """Case-sensitive abbreviation token → one or more workbook rows
    (ambiguous abbreviations have multiple entries). Loaded once per
    process."""
    out: dict[str, list[dict[str, Any]]] = {}
    for row in (_ab._list_data().get("abbreviations") or []):
        abbr = (row.get("abbreviation") or "").strip()
        if not abbr:
            continue
        out.setdefault(abbr, []).append(row)
    return out


# Common shape for an AB finding's suggestion: ``expansion (ABBR)``.
# Used to extract the abbreviation from AB01/AB02/AB03 suggestions.
_ABBR_IN_PARENS_RE = re.compile(r"\(([A-Z][A-Za-z0-9]{0,15})\)\s*$")


def extract_abbreviation(rule_id: str, original: str, suggestion: str) -> Optional[str]:
    """Best-effort extraction of the abbreviation an AB finding is
    about. Used so the serializer can look up the Abbreviation_List
    row for note / mw_lookup / confidence.

    Order of attempts:
      1. ``original`` itself is a registered abbreviation (case-sensitive).
      2. ``suggestion`` ends with ``(ABBR)`` — extract ABBR.
      3. ``original`` ends with ``(ABBR)`` — extract ABBR.
      4. First whitespace-separated token of ``suggestion`` that is a
         registered abbreviation (handles AB02 where suggestion is
         just the bare abbreviation).

    Returns None when extraction isn't reliable; the serializer then
    skips abbreviation-metadata lookup for that finding.
    """
    index = _abbr_index_by_token()
    original = (original or "").strip()
    suggestion = (suggestion or "").strip()
    # 1
    if original and original in index:
        return original
    # 2
    m = _ABBR_IN_PARENS_RE.search(suggestion)
    if m and m.group(1) in index:
        return m.group(1)
    # 3
    m = _ABBR_IN_PARENS_RE.search(original)
    if m and m.group(1) in index:
        return m.group(1)
    # 4 — tokens of suggestion
    for tok in re.split(r"[\s(),.;:]+", suggestion):
        if tok and tok in index:
            return tok
    return None


def abbreviation_metadata_for(abbreviation: Optional[str]) -> dict[str, Any]:
    """Return the workbook metadata for an abbreviation token or an
    empty dict when unknown.

    Keys:
      note / mw_lookup / confidence / subject_area / type / article /
      first_use_rule / ambiguity / abbreviation

    When the token resolves to multiple rows (ambiguous abbreviation
    like ``RA``), notes / subject_area are listed per-meaning so the
    reviewer sees them all.
    """
    if not abbreviation:
        return {}
    rows = _abbr_index_by_token().get(abbreviation)
    if not rows:
        return {}
    first = rows[0]
    out: dict[str, Any] = {
        "abbreviation": abbreviation,
        "note": first.get("note"),
        "mw_lookup": first.get("mw_lookup"),
        "confidence": first.get("confidence"),
        "subject_area": first.get("subject_area"),
        "type": first.get("type"),
        "article": first.get("article"),
        "first_use_rule": first.get("first_use_rule"),
        "ambiguity": first.get("ambiguity"),
    }
    if len(rows) > 1:
        # For ambiguous entries surface the per-meaning notes + subject
        # areas so the reviewer can see which meaning each warning
        # relates to.
        out["meanings_metadata"] = [
            {
                "expansion": r.get("expansion"),
                "subject_area": r.get("subject_area"),
                "note": r.get("note"),
                "confidence": r.get("confidence"),
                "mw_lookup": r.get("mw_lookup"),
            }
            for r in rows
        ]
    return out


def _canonical_expansion_for(abbreviation: Optional[str]) -> Optional[str]:
    """First workbook row's ``expansion`` for an abbreviation token,
    or None when the token isn't in the list. Used by the grouping
    serializer below."""
    if not abbreviation:
        return None
    rows = _abbr_index_by_token().get(abbreviation)
    if not rows:
        return None
    exp = (rows[0].get("expansion") or "").strip()
    return exp or None


def grouping_fields_for(
    rule_id: Optional[str],
    original: str,
    suggestion: str,
) -> dict[str, Optional[str]]:
    """Derive the three fields the frontend needs to coalesce multiple
    AB occurrences of the same abbreviation into a single card:

      * ``abbreviation`` — the short form (e.g. ``ICU``)
      * ``expansion``    — the long form the card header displays
      * ``group_key``    — stable identity used by the frontend's
                           ``Map<groupKey, Finding[]>`` reducer

    Rules:
      * Populated only for AB rules (``rule_id`` starts with ``AB``).
        Non-AB findings (DN01-32, LWW-NE, grammar, spelling, …) get
        all three keys set to ``None`` so the UI falls through to the
        existing one-card-per-finding render path. DN rules in
        particular are excluded by requirement: each patient-safety
        notation stays as its own card.
      * Key does NOT include ``rule_id``: AB01 (first use), AB02
        (repeated expansion) and AB13 (periods in initialism) on the
        same ``ICU`` abbreviation MUST land in the same group so the
        reviewer sees the full first-use / subsequent-use picture
        inside one card. Each occurrence keeps its own ``rule_id``
        and ``id`` fields untouched — grouping is purely a UI concern.
      * AB07 (ambiguous) uses the finding's ``suggestion`` as the
        expansion — different reviewer-visible meanings on the same
        abbreviation (``AMA`` → "American Medical Association" vs
        "Against Medical Advice") must stay in DIFFERENT groups
        ("different expansions → separate groups").
      * Other AB rules use the canonical workbook expansion so every
        finding on ``ICU`` for ``intensive care unit`` coalesces
        regardless of each occurrence's local ``suggestion`` text.
      * When the abbreviation cannot be extracted (unlikely but
        possible for an unusually-shaped suggestion), we return
        ``group_key=None`` and the card renders ungrouped.

    Keys are always present in the output dict so the serializer's
    row shape stays consistent across rules.
    """
    out: dict[str, Optional[str]] = {
        "abbreviation": None,
        "expansion": None,
        "group_key": None,
    }
    if not rule_id or not rule_id.startswith("AB"):
        return out

    abbr = extract_abbreviation(rule_id, original, suggestion)
    if not abbr:
        return out

    if rule_id == "AB07":
        # Different candidate meanings must stay in separate groups.
        expansion = (suggestion or "").strip() or None
    else:
        expansion = _canonical_expansion_for(abbr)

    out["abbreviation"] = abbr
    out["expansion"] = expansion
    # group_key covers only (abbreviation, expansion). Mixed rule_ids
    # (AB01 + AB02 + AB13) on the same abbreviation all land in the
    # same bucket; per-occurrence ``problem_label`` differentiates
    # first-use from subsequent-use inside the card.
    out["group_key"] = f"{abbr}|{expansion or ''}"
    return out


def clear_cache() -> None:
    """Drop LRU caches — test fixtures call this when they monkey-
    patch the backing JSON files."""
    _dn_index.cache_clear()
    _abbr_index_by_token.cache_clear()


# ─── Finding-level composite ──────────────────────────────────────

def enrich_finding(rule_id: str, original: str, suggestion: str,
                   alt_suggestions: Optional[list[str]] = None) -> dict[str, Any]:
    """One-stop helper for the GET /findings serializer.

    Returns a dict with every Phase-2 metadata field (keys always
    present; values are ``None`` when not applicable) so the response
    shape is consistent regardless of which rule emitted the finding.

    AB07 findings additionally get a ``meanings`` list — the engine
    populates ``alt_suggestions`` for AB07 with the candidate meanings
    sorted by descending cue score, so the ordering is semantic: the
    first entry is the best contextual match (per README §9 "Put the
    best cue match first").
    """
    out: dict[str, Any] = {
        "problem_label": problem_label_for(rule_id),
        "note": None,
        "mw_lookup": None,
        "confidence": None,
        "tool_behaviour": None,
        "applies_in": None,
        "notation": None,
        "source": None,
        "subject_area": None,
        "first_use_rule": None,
        "ambiguity": None,
        "meanings": None,
    }
    if not rule_id:
        return out

    if rule_id.startswith("DN"):
        dn = dn_metadata_for(rule_id)
        out["note"] = dn.get("note")
        out["confidence"] = dn.get("confidence")
        out["applies_in"] = dn.get("applies_in")
        out["tool_behaviour"] = dn.get("tool_behaviour")
        out["source"] = dn.get("source")
        out["notation"] = dn.get("notation")
        return out

    # AB rule — look up by the abbreviation the finding is about.
    abbr = extract_abbreviation(rule_id, original, suggestion)
    if abbr:
        am = abbreviation_metadata_for(abbr)
        out["note"] = am.get("note")
        out["mw_lookup"] = am.get("mw_lookup")
        out["confidence"] = am.get("confidence")
        out["subject_area"] = am.get("subject_area")
        out["first_use_rule"] = am.get("first_use_rule")
        out["ambiguity"] = am.get("ambiguity")

    if rule_id == "AB07" and alt_suggestions:
        # alt_suggestions is already in best-score-first order (see
        # engine Phase C emission). Mark the first as the suggested
        # best match; the UI shows every meaning and never pre-
        # selects per README §7.
        out["meanings"] = [
            {"meaning": m, "is_best_match": idx == 0}
            for idx, m in enumerate(alt_suggestions)
        ]

    return out
