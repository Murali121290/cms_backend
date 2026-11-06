"""Surface the hyphen & en-dash workbook rules as unified ``LanguageRule``
dicts for the Rules Picker (Scope C).

The workbook is split across two JSONs on disk:
  * ``hyphen_dash_rules.json`` — 35 regex rules.
  * ``hyphen_dash_terms.json`` — 840 phrase-lookup rows (Detect_List).

The Rules Picker page needs ONE flat list in the same shape as every other
rule it already renders (regex / dictionary / function / builtin), so this
module normalises both into the shared wire format and merges the project's
per-rule overrides on top.

Public API
----------
``list_hyphenation_rules(overrides=None)``
    Returns ``list[dict]`` — one dict per workbook rule, with every field
    the frontend ``RuleDetails`` component expects. Overrides are applied
    in-place: ``enabled`` and ``tool_behaviour`` reflect the merged value.

``hyphenation_rule_summary(overrides=None)``
    Returns ``{total, enabled, flag, auto_replace}`` for header stats
    without materialising the full 875-row list. Cheap enough to compute
    on every GET.

Shape
-----
Every returned dict carries at least::

    {
      "id":              "HY-0001" | "D01" | ...,
      "category":        "hyphenation",
      "type":            "regex" | "phrase_lookup",
      "enabled":         bool,
      "tool_behaviour":  "flag" | "auto_replace",
      "severity":        "warning" | "suggestion" | "error",
      "message":         "<human-readable short description>",
      "source_of":       "workbook",
      # ---- regex rules ----
      "pattern":         "...",
      "replacement":     "...",
      "alt_suggestions": [...],
      "flags":           ["IGNORECASE", ...],
      # ---- phrase_lookup rules ----
      "source":          "acid base balance",
      "suggestions":     ["acid-base balance"],
      # ---- optional display-only metadata ----
      "group" | "problem_type" | "style_profile" | "context_note" |
      "example_wrong" | "example_right" | "match_type" | "match_case" |
      "require_following_word",
      # ---- when a project override is applied ----
      "is_overridden":   true,
      "override":        {"enabled"?: bool, "tool_behaviour"?: str},
    }
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

from . import abbreviations as _ab
from . import hyphen_dash
from . import medical_terms as _mt
from . import uk_us_spelling as _uus
from . import lww_ne as _lww_ne


_WORKBOOK_CATEGORY = "hyphenation"
_ABBREVIATIONS_CATEGORY = "abbreviations"
_MEDICAL_CATEGORY = "medical_terms"
_UK_US_SPELLING_CATEGORY = "spelling"
# LWW-NE entries route to multiple existing categories based on their
# workbook Category column — spelling / hyphenation / abbreviations /
# bias. The mapping helper lives in the runtime module to keep a single
# source of truth.
_LWW_NE_CATEGORY_MAPPER = _lww_ne._category_to_engine_category


# Short, human-friendly source labels for the UI's provenance badge. Keys
# are the raw workbook ``Source`` strings; values are the compact label
# shown next to the rule ID. Any Source we don't have a short label for
# falls back to the raw string.
_DNU_SOURCE_BADGES: dict[str, str] = {
    "The Joint Commission official Do Not Use list": "Joint Commission",
    "The Joint Commission additional list":           "Joint Commission",
    "The Joint Commission additional list; ISMP":     "Joint Commission + ISMP",
    "The Joint Commission additional list: apothecary units": "Joint Commission",
    "ISMP list of error-prone abbreviations":         "ISMP",
    "ISMP list: drug name abbreviations":             "ISMP",
}


# ---------------------------------------------------------------------------
# Normalisation (workbook JSON row -> unified LanguageRule dict)
# ---------------------------------------------------------------------------

def _normalise_dash_rule(row: dict[str, Any]) -> dict[str, Any]:
    """Dash_Rules row (regex) → wire dict. Preserves every workbook field the
    UI needs; drops nothing silently."""
    return {
        "id": row["id"],
        "category": _WORKBOOK_CATEGORY,
        "type": "regex",
        "enabled": bool(row.get("enabled", True)),
        "tool_behaviour": row.get("tool_behaviour") or "flag",
        "severity": row.get("severity") or "warning",
        "message": row.get("message") or row.get("problem") or row["id"],
        "source_of": "workbook",
        # type-specific
        "pattern": row.get("pattern"),
        "replacement": row.get("replacement"),
        "alt_suggestions": list(row.get("alt_suggestions") or []),
        "flags": list(row.get("flags") or []),
        # display-only workbook metadata
        "group": row.get("group") or "",
        "style_profile": row.get("style_profile") or "all",
        "example_wrong": row.get("example_wrong") or "",
        "example_right": row.get("example_right") or "",
        "confidence": row.get("confidence") or "",
        "notes": row.get("notes") or "",
    }


def _normalise_phrase_rule(row: dict[str, Any]) -> dict[str, Any]:
    """Detect_List row (phrase_lookup) → wire dict."""
    suggestions = list(row.get("suggestions") or [])
    primary = suggestions[0] if suggestions else ""
    return {
        "id": row["id"],
        "category": _WORKBOOK_CATEGORY,
        "type": "phrase_lookup",
        # Detect_List rows always ship enabled=true from the import script;
        # workbook can't disable individual rows, only the project overrides can.
        "enabled": True,
        "tool_behaviour": row.get("tool_behaviour") or "flag",
        "severity": "suggestion" if row.get("tool_behaviour") == "auto_replace" else "warning",
        "message": row.get("problem_type") or row["id"],
        "source_of": "workbook",
        # type-specific
        "source": row.get("source"),
        "suggestions": suggestions,
        "replacement": primary,       # mirrored for UI convenience
        # display-only workbook metadata
        "problem_type": row.get("problem_type") or "",
        "style_profile": row.get("style_profile") or "all",
        "match_type": row.get("match_type") or "phrase",
        "match_case": bool(row.get("match_case", False)),
        "require_following_word": bool(row.get("require_following_word", False)),
        "context_note": row.get("context_note") or "",
        "confidence": row.get("confidence") or "",
        "origin": row.get("origin") or "",
    }


@lru_cache(maxsize=1)
def _base_rules() -> list[dict[str, Any]]:
    """Materialise + cache the full normalised workbook rule list.

    875 rows × ~15 small fields each lives comfortably in memory. The cache
    is invalidated by :func:`clear_cache` (used by tests after re-importing
    the workbook)."""
    out: list[dict[str, Any]] = []
    rules_data = hyphen_dash._rules_data() or {}
    terms_data = hyphen_dash._terms_data() or {}
    for row in rules_data.get("rules", []) or []:
        if not row.get("id"):
            continue
        out.append(_normalise_dash_rule(row))
    for row in terms_data.get("detect_list", []) or []:
        if not row.get("id"):
            continue
        out.append(_normalise_phrase_rule(row))
    return out


def clear_cache() -> None:
    _base_rules.cache_clear()


# ---------------------------------------------------------------------------
# Override merge
# ---------------------------------------------------------------------------

def _apply_override(rule: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow-copied rule with the override merged on top. Keeps
    the base rule immutable so the LRU cache isn't mutated across requests."""
    merged = dict(rule)
    if "enabled" in override:
        merged["enabled"] = bool(override["enabled"])
    if override.get("tool_behaviour") in ("flag", "auto_replace"):
        merged["tool_behaviour"] = override["tool_behaviour"]
    merged["is_overridden"] = True
    merged["override"] = {k: v for k, v in override.items()
                          if k in ("enabled", "tool_behaviour")}
    return merged


def list_hyphenation_rules(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return the full normalised workbook rule list with overrides applied."""
    overrides = overrides or {}
    base = _base_rules()
    if not overrides:
        return [dict(r) for r in base]
    out: list[dict[str, Any]] = []
    for r in base:
        o = overrides.get(r["id"])
        if o:
            out.append(_apply_override(r, o))
        else:
            out.append(dict(r))
    return out


def hyphenation_rule_summary(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, int]:
    """Return the header stats without materialising the full list."""
    overrides = overrides or {}
    total = 0
    enabled = 0
    flag = 0
    auto_replace = 0
    for r in _base_rules():
        total += 1
        o = overrides.get(r["id"]) or {}
        eff_enabled = bool(o["enabled"]) if "enabled" in o else bool(r.get("enabled", True))
        eff_tb = o.get("tool_behaviour") or r.get("tool_behaviour") or "flag"
        if eff_enabled:
            enabled += 1
            if eff_tb == "auto_replace":
                auto_replace += 1
            else:
                flag += 1
    return {
        "total": total,
        "enabled": enabled,
        "flag": flag,
        "auto_replace": auto_replace,
    }


# ---------------------------------------------------------------------------
# Abbreviations surface (Phase A — Do_Not_Use + Abbreviation_List)
# ---------------------------------------------------------------------------

def _normalise_dnu_rule(row: dict[str, Any]) -> dict[str, Any]:
    """Do_Not_Use row → unified ``LanguageRule`` wire dict.

    Rows without a ``pattern`` (advisory ``Flag only`` entries) still land
    here so the Rules Picker lists them; the engine's
    :func:`abbreviations.analyze_do_not_use` skips them for text matching.
    """
    raw_source = row.get("source") or ""
    source_badge = _DNU_SOURCE_BADGES.get(raw_source, raw_source)
    return {
        "id": row["id"],
        "category": _ABBREVIATIONS_CATEGORY,
        "type": "regex",
        "enabled": bool(row.get("enabled", True)),
        "tool_behaviour": row.get("tool_behaviour") or "flag",
        "severity": "suggestion" if row.get("tool_behaviour") == "auto_replace" else "warning",
        "message": (
            f"{row.get('notation') or row['id']}: {row.get('intended_meaning') or ''}"
        ).strip(": "),
        "source_of": "workbook",
        # type-specific
        "pattern": row.get("pattern"),
        "replacement": row.get("replacement") or row.get("suggestion_1"),
        "alt_suggestions": list(row.get("alt_suggestions") or []),
        "flags": [],
        # display-only metadata — RuleDetails surfaces the badge in the header
        "source_badge": source_badge,
        "source_raw": raw_source,
        "applies_in": row.get("applies_in") or "",
        "common_mistake": row.get("common_mistake") or "",
        "example_wrong": row.get("example_wrong") or "",
        "example_right": row.get("example_right") or "",
        "confidence": row.get("confidence") or "",
        "note": row.get("note") or "",
    }


def _normalise_abbreviation_entry(row: dict[str, Any]) -> dict[str, Any]:
    """Abbreviation_List row → unified ``LanguageRule`` wire dict.

    Rendered as a ``phrase_lookup``-style entry (the existing RuleDetails
    renderer handles the ``source → suggestion`` display). Phase A doesn't
    yet fire findings from these rows — they are listed for configurability
    (enable/disable per project) and the Phase-B engine will consult them.
    """
    abbr = row.get("abbreviation") or ""
    expansion = row.get("expansion") or ""
    message_bits = [row.get("subject_area") or ""]
    if row.get("first_use_rule") == "do_not_abbreviate":
        message_bits.insert(0, "DO NOT ABBREVIATE")
    elif row.get("first_use_rule") == "no_expansion_needed":
        message_bits.insert(0, "No expansion needed")
    elif row.get("first_use_rule") == "expand_for_general_only":
        message_bits.insert(0, "Expand for general audience")
    message = " · ".join(b for b in message_bits if b)
    return {
        "id": row["id"],
        "category": _ABBREVIATIONS_CATEGORY,
        "type": "phrase_lookup",
        # The Abbreviation_List rows ship enabled=true from the import;
        # per-project overrides are the only way to disable them.
        "enabled": True,
        # Default FLAG — findings on these only land when Phase B's engine
        # ships, so the field is just stored metadata today.
        "tool_behaviour": "flag",
        "severity": "warning",
        "message": message or abbr,
        "source_of": "workbook",
        # type-specific — map abbreviation/expansion into the same shape
        # phrase_lookup already uses on the Hyphenation side.
        "source": abbr,
        "suggestions": [expansion] if expansion else [],
        "replacement": expansion,
        # abbreviation-specific display-only metadata
        "abbreviation": abbr,
        "expansion": expansion,
        "plural_abbreviation": row.get("plural_abbreviation"),
        "plural_expansion_override": row.get("plural_expansion_override"),
        "subject_area": row.get("subject_area") or "",
        "abbr_type": row.get("type") or "",
        "article": row.get("article") or "",
        "first_use_rule": row.get("first_use_rule") or "",
        "ambiguity": row.get("ambiguity") or "unique",
        "do_not_abbreviate": bool(row.get("do_not_abbreviate", False)),
        "confidence": row.get("confidence") or "",
        "note": row.get("note") or "",
    }


@lru_cache(maxsize=1)
def _base_abbreviation_rules() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    dnu = _ab._dnu_data() or {}
    lst = _ab._list_data() or {}
    for row in dnu.get("rules", []) or []:
        if not row.get("id"):
            continue
        out.append(_normalise_dnu_rule(row))
    for row in lst.get("abbreviations", []) or []:
        if not row.get("id"):
            continue
        out.append(_normalise_abbreviation_entry(row))
    return out


def list_abbreviation_rules(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return the full normalised abbreviations rule list with overrides applied."""
    overrides = overrides or {}
    base = _base_abbreviation_rules()
    if not overrides:
        return [dict(r) for r in base]
    out: list[dict[str, Any]] = []
    for r in base:
        o = overrides.get(r["id"])
        if o:
            out.append(_apply_override(r, o))
        else:
            out.append(dict(r))
    return out


def abbreviation_rule_summary(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, int]:
    overrides = overrides or {}
    total = 0
    enabled = 0
    flag = 0
    auto_replace = 0
    for r in _base_abbreviation_rules():
        total += 1
        o = overrides.get(r["id"]) or {}
        eff_enabled = bool(o["enabled"]) if "enabled" in o else bool(r.get("enabled", True))
        eff_tb = o.get("tool_behaviour") or r.get("tool_behaviour") or "flag"
        if eff_enabled:
            enabled += 1
            if eff_tb == "auto_replace":
                auto_replace += 1
            else:
                flag += 1
    return {
        "total": total,
        "enabled": enabled,
        "flag": flag,
        "auto_replace": auto_replace,
    }


# ---------------------------------------------------------------------------
# Medical Terminology surface (Detect_List + Spelling_Patterns + Confusables)
# ---------------------------------------------------------------------------

def _medical_severity(confidence: str | None, tool_behaviour: str | None) -> str:
    """Mirror ``medical_terms._confidence_to_severity`` for display.

    Keeping this inline (not importing) avoids a circular dependency and
    keeps the surface module self-contained.
    """
    c = (confidence or "").strip().lower()
    if c == "high":
        return "warning"
    if c in ("medium - verify", "medium", "low"):
        return "suggestion"
    return "warning" if tool_behaviour != "auto_replace" else "suggestion"


def _normalise_medical_detect(row: dict[str, Any]) -> dict[str, Any]:
    """Detect_List row → unified ``LanguageRule`` wire dict.

    Renders as a ``phrase_lookup`` so the existing RuleDetails renderer
    shows the ``source → suggestion`` block without new code. Every
    original column is retained for the Rules Picker metadata display.
    """
    suggestions = list(row.get("suggestions") or [])
    source_term = row.get("source_term") or ""
    tb = row.get("tool_behaviour") or "flag"
    confidence = row.get("confidence")
    primary = suggestions[0] if suggestions else source_term
    msg_bits = [row.get("problem_type") or "", row.get("context_note") or ""]
    message = " — ".join(b for b in msg_bits if b) or "Medical terminology"
    return {
        "id": row["id"],
        "category": _MEDICAL_CATEGORY,
        "type": "phrase_lookup",
        "enabled": True,
        "tool_behaviour": tb,
        "severity": _medical_severity(confidence, tb),
        "message": message,
        "source_of": "workbook",
        # phrase_lookup shape (reused by hyphenation workbook)
        "source": source_term,
        "suggestions": suggestions,
        "replacement": primary,
        # alt_suggestions for Review Page's dropdown
        "alt_suggestions": list(suggestions[1:]) if len(suggestions) > 1 else [],
        # Full editorial metadata — preserved for RuleDetails + Review card
        "problem_type": row.get("problem_type") or "",
        "match_type": row.get("match_type_raw") or row.get("match_type") or "",
        "match_case": bool(row.get("match_case")),
        "style_profile": row.get("style_profile") or "All",
        "context_note": row.get("context_note") or "",
        "basis": row.get("basis") or "",
        "confidence": confidence or "",
        "mw_medical_lookup": row.get("mw_medical_lookup") or "",
        "origin": row.get("origin") or "",
        "source_badge": "Medical workbook",
        "source_raw": "Medical Terminology List",
    }


def _normalise_medical_pattern(row: dict[str, Any]) -> dict[str, Any]:
    """Spelling_Patterns row → unified ``LanguageRule`` wire dict (regex)."""
    tb = row.get("tool_behaviour") or "flag"
    return {
        "id": row["id"],
        "category": _MEDICAL_CATEGORY,
        "type": "regex",
        "enabled": True,
        "tool_behaviour": tb,
        "severity": "warning",
        "message": row.get("name") or "Medical spelling pattern",
        "source_of": "workbook",
        "pattern": row.get("pattern"),
        "replacement": row.get("replacement"),
        "flags": list(row.get("flags") or []),
        "alt_suggestions": [],
        "style_profile": row.get("style_profile") or "All",
        "example_wrong": row.get("example_wrong") or "",
        "example_right": row.get("example_right") or "",
        "note": row.get("note") or "",
        "source_badge": "Medical workbook",
        "source_raw": "Medical Terminology List — Spelling_Patterns",
    }


def _normalise_medical_confusable(row: dict[str, Any]) -> dict[str, Any]:
    """Confusable_Terms row → unified ``LanguageRule`` wire dict.

    Displayed as a function-style entry since there's no single pattern
    (the engine scans both words with paragraph-wide cue-stem context).
    """
    note = row.get("note") or ""
    return {
        "id": row["id"],
        "category": _MEDICAL_CATEGORY,
        "type": "function",
        "enabled": True,
        "tool_behaviour": row.get("tool_behaviour") or "flag",
        "severity": "warning",
        "message": note or f"Confusable: {row.get('word_a')} vs {row.get('word_b')}",
        "source_of": "workbook",
        "function": "confusable_terms_context_scan",
        "params": {
            "word_a": row.get("word_a"),
            "word_b": row.get("word_b"),
            "cues_a": row.get("cues_a") or [],
            "cues_b": row.get("cues_b") or [],
        },
        "note": note,
        "source_badge": "Medical workbook",
        "source_raw": "Medical Terminology List — Confusable_Terms",
    }


@lru_cache(maxsize=1)
def _base_medical_rules() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in (_mt._detect_data().get("entries") or []):
        if not row.get("id"):
            continue
        out.append(_normalise_medical_detect(row))
    for row in (_mt._patterns_data().get("entries") or []):
        if not row.get("id"):
            continue
        out.append(_normalise_medical_pattern(row))
    for row in (_mt._confusables_data().get("entries") or []):
        if not row.get("id"):
            continue
        out.append(_normalise_medical_confusable(row))
    return out


def list_medical_terms_rules(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return the full normalised medical rule list with overrides applied."""
    overrides = overrides or {}
    base = _base_medical_rules()
    if not overrides:
        return [dict(r) for r in base]
    out: list[dict[str, Any]] = []
    for r in base:
        o = overrides.get(r["id"])
        if o:
            out.append(_apply_override(r, o))
        else:
            out.append(dict(r))
    return out


def medical_terms_rule_summary(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, int]:
    overrides = overrides or {}
    total = enabled = flag = auto_replace = 0
    for r in _base_medical_rules():
        total += 1
        o = overrides.get(r["id"]) or {}
        eff_enabled = bool(o["enabled"]) if "enabled" in o else bool(r.get("enabled", True))
        eff_tb = o.get("tool_behaviour") or r.get("tool_behaviour") or "flag"
        if eff_enabled:
            enabled += 1
            if eff_tb == "auto_replace":
                auto_replace += 1
            else:
                flag += 1
    return {"total": total, "enabled": enabled, "flag": flag, "auto_replace": auto_replace}


# ---------------------------------------------------------------------------
# UK/US Spelling surface (variants + common + protected)
# ---------------------------------------------------------------------------

def _normalise_uk_us_variant(row: dict[str, Any]) -> dict[str, Any]:
    """US_UK_Spelling_Variants row → unified LanguageRule wire dict.

    Rendered as a ``phrase_lookup`` so the existing RuleDetails
    renderer displays the ``US → UK`` (or ``UK → US``) pair. Every
    editorial column is preserved for Rules Picker + Review Page
    display: validation_status, us_preference, uk_preference,
    spelling_pattern, requires_context, part_of_speech, etc.
    """
    status = (row.get("validation_status") or "needs_review").lower()
    # tool_behaviour defaults to the UK-doc action (most projects are UK;
    # the US-doc half is symmetric). Projects always see both directions
    # at analyze time — this flag is just the Rules Picker preview.
    uk_action = row.get("uk_doc_action") or "flag_suggest"
    autocorrect_safe = bool(row.get("uk_doc_autocorrect_safe"))
    if status == "disputed":
        tb = "flag"
    elif status == "needs_review":
        tb = "flag"
    elif uk_action == "flag_autocorrect" and autocorrect_safe:
        tb = "auto_replace"
    else:
        tb = "flag"
    severity_raw = (row.get("uk_doc_severity") or "warning").lower()
    severity = "error" if severity_raw == "error" else "suggestion" if severity_raw in ("info", "info or warning") else "warning"
    us = row.get("us_spelling") or ""
    uk = row.get("uk_spelling") or ""
    return {
        "id": row["entry_id"],
        "category": _UK_US_SPELLING_CATEGORY,
        "type": "phrase_lookup",
        "enabled": True,
        "tool_behaviour": tb,
        "severity": severity,
        "message": f"{us} (US) ↔ {uk} (UK)",
        "source_of": "workbook",
        "source": us,
        "suggestions": [uk],
        "replacement": uk,
        "alt_suggestions": [],
        # Preserved editorial metadata — RuleDetails ignores keys it
        # doesn't render but they're round-tripped for anyone who wants
        # to see them (API consumers, future UI).
        "us_spelling": us,
        "uk_spelling": uk,
        "us_alternatives": list(row.get("us_alternatives") or []),
        "uk_alternatives": list(row.get("uk_alternatives") or []),
        "spelling_pattern": row.get("spelling_pattern") or "",
        "part_of_speech": row.get("part_of_speech") or "",
        "word_family": row.get("word_family") or "",
        "variant_type": row.get("variant_type") or "",
        "us_preference": row.get("us_preference") or "",
        "uk_preference": row.get("uk_preference") or "",
        "validation_status": status,
        "requires_context": bool(row.get("requires_context")),
        "formality_level": row.get("formality_level") or "",
        "style_guide_notes": row.get("style_guide_notes") or "",
        "exceptions_notes": row.get("exceptions_notes") or "",
        "source_dictionary": row.get("source_dictionary") or "",
        "source_badge": "US/UK workbook",
        "source_raw": "Ninja Inkflow CE US and UK Spelling Database",
    }


@lru_cache(maxsize=1)
def _base_uk_us_rules() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in (_uus._variants_data().get("entries") or []):
        if not row.get("entry_id"):
            continue
        out.append(_normalise_uk_us_variant(row))
    return out


def list_uk_us_spelling_rules(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return the full normalised UK/US spelling rule list with overrides applied."""
    overrides = overrides or {}
    base = _base_uk_us_rules()
    if not overrides:
        return [dict(r) for r in base]
    out: list[dict[str, Any]] = []
    for r in base:
        o = overrides.get(r["id"])
        if o:
            out.append(_apply_override(r, o))
        else:
            out.append(dict(r))
    return out


def uk_us_spelling_rule_summary(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, int]:
    overrides = overrides or {}
    total = enabled = flag = auto_replace = 0
    for r in _base_uk_us_rules():
        total += 1
        o = overrides.get(r["id"]) or {}
        eff_enabled = bool(o["enabled"]) if "enabled" in o else bool(r.get("enabled", True))
        eff_tb = o.get("tool_behaviour") or r.get("tool_behaviour") or "flag"
        if eff_enabled:
            enabled += 1
            if eff_tb == "auto_replace":
                auto_replace += 1
            else:
                flag += 1
    return {"total": total, "enabled": enabled, "flag": flag, "auto_replace": auto_replace}


# ---------------------------------------------------------------------------
# LWW-NE workbook surface (Phase 4)
# ---------------------------------------------------------------------------
#
# The LWW-NE workbook is unusual among our integrations in that its
# rows span FOUR engine-facing categories (spelling / hyphenation /
# abbreviations / bias) based on each row's workbook Category column.
# We surface them as a single "lww_ne" workbook bucket in the GET
# payload, but each row carries its own ``category`` field so the
# Rules Picker renders it under the correct existing chip.
#
# Phase-1/2 Decisions applied in the surface (consistent with the
# runtime filter in ``lww_ne.analyze_lww_ne``):
#   - validation_status != "ok"      → not surfaced (quarantined / annotation)
#   - runtime_mode != "scan"         → not surfaced (editor_hint / Partial word)
#   - "No action (protected form)"   → not surfaced (protect-only rows)
# Result: the Rules Picker shows exactly the rows that CAN fire at
# runtime, so toggling one off actually changes analyze output.

def _normalise_lww_ne_entry(row: dict[str, Any]) -> dict[str, Any]:
    """LWW-NE Tool_Input row → unified ``LanguageRule`` wire dict.

    Rendered as ``phrase_lookup`` so the existing RuleDetails
    component shows the source → suggestions pair. Every editorial
    column is preserved for Rules Picker display: workbook Category,
    Action, Tool behaviour, Match type, Match case, Confidence,
    Rule Runs, MW note, Original text (if cleaned).
    """
    source = row.get("source_term") or ""
    suggestions = list(row.get("suggestions") or [])
    primary = suggestions[0] if suggestions else source
    alt = list(suggestions[1:]) if len(suggestions) > 1 else []

    # Tool behaviour mirrors the runtime module's resolution.
    confidence = row.get("confidence") or ""
    wb_tb = row.get("tool_behaviour") or ""
    if confidence == "Unknown":
        tb = "flag"
    elif wb_tb == "Auto-replace":
        tb = "auto_replace"
    else:
        tb = "flag"

    # Severity mirrors the runtime module.
    if confidence == "Unknown" or wb_tb == "Flag only (review)":
        severity = "suggestion"
    else:
        severity = "warning"

    # Rule-run display: the raw list of base tags (annotations stripped
    # for display; the full workbook text is preserved in rule_runs_raw
    # for anyone who wants to see the parenthetical annotations).
    rule_runs = row.get("rule_runs") or []
    tag_display = ", ".join(r["rule_run"] for r in rule_runs if r.get("rule_run"))
    rule_runs_raw = []
    for r in rule_runs:
        base = r.get("rule_run") or ""
        annotation = r.get("annotation")
        rule_runs_raw.append(f"{base} ({annotation})" if annotation else base)

    engine_category = _LWW_NE_CATEGORY_MAPPER(row.get("category"))

    return {
        "id": f"LWW-NE-{source}",
        "category": engine_category,
        "type": "phrase_lookup",
        "enabled": True,
        "tool_behaviour": tb,
        "severity": severity,
        "message": f"{source} → {primary}" if suggestions else source,
        "source_of": "workbook",
        # phrase_lookup wire shape reused by hyphenation / medical workbooks
        "source": source,
        "suggestions": suggestions,
        "replacement": primary if suggestions else None,
        "alt_suggestions": alt,
        # Editorial metadata preserved for RuleDetails + Rules Picker
        "workbook_category": row.get("category") or "",
        "action": row.get("action") or "",
        "tool_behaviour_raw": wb_tb,
        "match_type": row.get("match_type") or "",
        "match_case": bool(row.get("match_case")),
        "confidence": confidence,
        "mw_note": row.get("mw_note") or "",
        "rule_runs_display": tag_display,
        "rule_runs_raw": rule_runs_raw,
        "is_generic": bool(row.get("is_generic")),
        "original_text": row.get("original_text") or "",
        "source_badge": "LWW-NE",
        "source_raw": "LWW-NE language-tool workbook",
    }


@lru_cache(maxsize=1)
def _base_lww_ne_rules() -> list[dict[str, Any]]:
    """Return the Rules-Picker-ready LWW-NE entries.

    Filters at surface time (mirrors the runtime module) so toggling
    a surfaced rule actually affects analyze output:
      * validation_status == "ok"
      * runtime_mode == "scan"
      * tool_behaviour != "No action (protected form)"
    """
    out: list[dict[str, Any]] = []
    for row in (_lww_ne._terms_data().get("entries") or []):
        if row.get("validation_status") != "ok":
            continue
        if row.get("runtime_mode") != "scan":
            continue
        if (row.get("tool_behaviour") or "") == "No action (protected form)":
            continue
        out.append(_normalise_lww_ne_entry(row))
    return out


def list_lww_ne_rules(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return the full normalised LWW-NE rule list with overrides applied."""
    overrides = overrides or {}
    base = _base_lww_ne_rules()
    if not overrides:
        return [dict(r) for r in base]
    out: list[dict[str, Any]] = []
    for r in base:
        o = overrides.get(r["id"])
        if o:
            out.append(_apply_override(r, o))
        else:
            out.append(dict(r))
    return out


def lww_ne_rule_summary(
    overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, int]:
    overrides = overrides or {}
    total = enabled = flag = auto_replace = 0
    for r in _base_lww_ne_rules():
        total += 1
        o = overrides.get(r["id"]) or {}
        eff_enabled = bool(o["enabled"]) if "enabled" in o else bool(r.get("enabled", True))
        eff_tb = o.get("tool_behaviour") or r.get("tool_behaviour") or "flag"
        if eff_enabled:
            enabled += 1
            if eff_tb == "auto_replace":
                auto_replace += 1
            else:
                flag += 1
    return {"total": total, "enabled": enabled, "flag": flag, "auto_replace": auto_replace}


# Allow tests to force a reload after regenerating JSON.
_original_clear_cache = clear_cache


def clear_cache() -> None:  # noqa: F811  (deliberate override to extend)
    _original_clear_cache()
    _base_abbreviation_rules.cache_clear()
    _base_medical_rules.cache_clear()
    _base_uk_us_rules.cache_clear()
    _base_lww_ne_rules.cache_clear()
    _ab.clear_cache()
    _mt.clear_cache()
    _uus.clear_cache()
    _lww_ne.clear_cache()
