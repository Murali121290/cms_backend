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


_WORKBOOK_CATEGORY = "hyphenation"
_ABBREVIATIONS_CATEGORY = "abbreviations"
_MEDICAL_CATEGORY = "medical_terms"


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


# Allow tests to force a reload after regenerating JSON.
_original_clear_cache = clear_cache


def clear_cache() -> None:  # noqa: F811  (deliberate override to extend)
    _original_clear_cache()
    _base_abbreviation_rules.cache_clear()
    _base_medical_rules.cache_clear()
    _ab.clear_cache()
    _mt.clear_cache()
