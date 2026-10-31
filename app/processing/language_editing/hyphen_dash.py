"""Hyphen & en-dash workbook runtime.

Loads the three JSON configs produced by
``scripts/import_hyphen_dash_workbook.py`` and exposes the detection
surface the language-editing engine calls into:

    analyze_hyphen_dash(text, *, dash_profile, protected_spans)
        -> list[Finding]
    build_protected_spans(text, *, dash_profile) -> list[tuple[int, int]]
    build_protected_literals(*, dash_profile) -> frozenset[str]
    workbook_covered_compound_bases() -> frozenset[str]

The JSON files are the source of truth; this module caches compiled
artifacts per-process. Call :func:`clear_cache` after regenerating the
JSONs during development.

Design points
-------------
* **No in-place text normalisation.** Hyphen character variants
  (U+2010/U+2011) are matched via explicit character classes inside the
  workbook regexes themselves (plus the ``_HYPHEN_CLASS`` constant for
  Phase-2 helpers). Finding offsets index the original paragraph so the
  DOCX export can patch exactly what the author wrote.
* **Protected spans are advisory to the analyser.** We return the overlap
  spans and the engine filters any finding whose span intersects. The
  spell checker does the same via its ``protected_spans`` kwarg.
* **Phrase lookup is one alternation per (profile, match_case) group.**
  840 rows compile to a handful of patterns; per-row metadata is a
  dict side-table keyed on normalised source.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from .rules import Finding, Rule, load_rules_from_dict

logger = logging.getLogger(__name__)


_CONFIG_DIR = Path(__file__).parent / "config" / "profiles"
_RULES_JSON = _CONFIG_DIR / "hyphen_dash_rules.json"
_TERMS_JSON = _CONFIG_DIR / "hyphen_dash_terms.json"
_PROTECTED_JSON = _CONFIG_DIR / "hyphen_dash_protected.json"


# Any hyphen-shaped character the workbook treats as equivalent to U+002D
# when detecting. (U+2013/U+2014 are DISTINCT and never collapsed.)
_HYPHEN_CLASS = r"[-‐‑]"


# Profiles the workbook ships. ``all`` is the backward-compatible default
# applied by the service layer; the other two are workbook-specific style
# axes. ``both`` is a Detect_List tag meaning "ships under multiple
# profiles" and we treat it like ``all`` for runtime filtering purposes.
# Profile match sets. Each key is a user-facing dash_profile; the value is
# every workbook ``style_profile`` tag that fires under it. Rows tagged
# ``all`` or ``both`` fire everywhere; ``us_mw_and_chicago`` is a workbook
# convention meaning "applies in all three US-centric profiles" and must
# route under every default profile. ``optional_typographic_minus`` is
# explicitly opt-in — it fires under NO default profile.
_PROFILE_MATCHES: dict[str, frozenset[str]] = {
    "all":              frozenset({"all", "both", "us_mw_and_chicago"}),
    "mw_dictionary":    frozenset({"all", "both", "us_mw_and_chicago", "mw_dictionary"}),
    "chicago_ama_apa":  frozenset({"all", "both", "us_mw_and_chicago", "chicago_ama_apa"}),
    # Opt-in profile: adds the typographic-minus rules (O01, O02) on top
    # of the baseline. Not a default — the service layer never sets this.
    "optional_typographic_minus": frozenset({
        "all", "both", "us_mw_and_chicago", "optional_typographic_minus",
    }),
}

# Protected patterns that are overbroad in the current workbook version
# and would otherwise suppress legitimate dash-rule findings. Each entry
# names a protected-row ID whose pattern we disable at compile time; a
# WARNING is logged on module load so maintainers see it. The intent (and
# correct forms) are documented inline so a future workbook update can
# retire the entry.
#
# Investigation evidence (Phase 4 preflight against the 154-case harness):
#   PR-020  (ISBN):       pattern makes the "ISBN" literal optional, so bare
#                         4-digit years like `2020` and ranges like `10-20`
#                         get swallowed. Expected tightening upstream: make
#                         the ISBN prefix mandatory OR require 10+ digits.
#   PR-024  (CLI option): pattern matches `-known` inside `well -known`
#                         (D14's job). Expected tightening: require `--`
#                         prefix OR a strict context lookbehind.
#   PR-027  (Chemical locant): pattern matches `5-year`, `3-day`, any digit-
#                         hyphen-word combo. Expected tightening: require
#                         a classic chemical suffix (`-ol`, `-ene`, `-oic`,
#                         `-amine`, …) or multi-locant notation (`1,25-`).
#   PR-023  (Phone number): pattern matches any `NNN-NNN` block, so a
#                         page range like `120-128` or a figure range
#                         `100-128` is swallowed. Expected tightening:
#                         require 7+ digits total OR a formatting marker
#                         (parens, `+`, country code).
_DISABLED_PROTECTED_IDS: frozenset[str] = frozenset({
    "PR-020", "PR-023", "PR-024", "PR-027",
})


def _rule_in_profile(rule_profile: str, active: str) -> bool:
    """Does a rule tagged with ``rule_profile`` fire under ``active``?

    Workbook convention: a rule tagged ``all`` fires everywhere; a
    profile-specific rule fires only when the active profile matches.
    """
    allowed = _PROFILE_MATCHES.get(active) or _PROFILE_MATCHES["all"]
    return rule_profile in allowed


# ---------------------------------------------------------------------------
# JSON loading
# ---------------------------------------------------------------------------

def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("hyphen_dash config missing: %s", path)
        return {}
    except json.JSONDecodeError as exc:
        logger.error("hyphen_dash config invalid JSON at %s: %s", path, exc)
        return {}


@lru_cache(maxsize=1)
def _rules_data() -> dict:
    return _load_json(_RULES_JSON)


@lru_cache(maxsize=1)
def _terms_data() -> dict:
    return _load_json(_TERMS_JSON)


@lru_cache(maxsize=1)
def _protected_data() -> dict:
    return _load_json(_PROTECTED_JSON)


def clear_cache() -> None:
    """Force a reload of the JSON configs (used by tests after regeneration)."""
    _rules_data.cache_clear()
    _terms_data.cache_clear()
    _protected_data.cache_clear()
    _compile_dash_rules.cache_clear()
    _compile_phrase_lookup.cache_clear()
    _compile_en_dash_terms.cache_clear()
    _compile_protected_patterns.cache_clear()
    workbook_covered_compound_bases.cache_clear()
    build_protected_literals.cache_clear()


# ---------------------------------------------------------------------------
# Dash_Rules compilation
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _compile_dash_rules() -> list[Rule]:
    """Compile Dash_Rules into Rule objects. Priority preserved as attribute."""
    data = _rules_data()
    rules = load_rules_from_dict(data.get("rules", []))
    for compiled, raw in zip(rules, data.get("rules", [])):
        # Attach workbook-specific metadata the base Rule dataclass doesn't
        # model. ``load_rules_from_dict`` ignores unknown keys so these are
        # not fed into regex compilation; stash them on the instance.
        compiled.priority = int(raw.get("priority", 100))
        compiled.tool_behaviour = raw.get("tool_behaviour", "flag_and_suggest")
        compiled.style_profile = raw.get("style_profile", "all")
        compiled.alt_suggestions = list(raw.get("alt_suggestions") or [])
        compiled.autofixable = bool(raw.get("autofixable", True))
    return rules


# ---------------------------------------------------------------------------
# Phrase lookup (Detect_List)
# ---------------------------------------------------------------------------

@dataclass
class _PhraseRow:
    id: str
    source: str
    suggestions: list[str]
    problem_type: str
    tool_behaviour: str
    match_type: str          # whole_word | phrase
    match_case: bool
    style_profile: str
    context_note: str
    skip_prev_regex: Optional[re.Pattern]
    require_following_word: bool


@dataclass
class _PhraseGroup:
    """One compiled alternation plus the metadata lookup for its rows."""
    style_profile: str
    match_case: bool
    regex: re.Pattern
    # Lowercased surface -> row (lowercased when match_case is False, else
    # the original surface is the key).
    lookup: dict[str, _PhraseRow]


def _preserve_case(src: str, repl: str) -> str:
    """Mimic the case pattern of ``src`` onto ``repl``.

    Rules:
      * All-upper src → upper repl.
      * Title-case src → title-case repl (first letter only).
      * Mixed/lower src → repl as-is.
    """
    if not src:
        return repl
    if src.isupper():
        return repl.upper()
    if src[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


@lru_cache(maxsize=1)
def _compile_phrase_lookup() -> list[_PhraseGroup]:
    """Build one `_PhraseGroup` per (style_profile, match_case) bucket."""
    data = _terms_data()
    rows = data.get("detect_list", [])
    buckets: dict[tuple[str, bool], list[_PhraseRow]] = {}
    for r in rows:
        skip_prev = r.get("skip_prev_regex")
        skip_prev_pat = None
        if skip_prev:
            try:
                # Anchor to end-of-string with optional trailing whitespace
                # so the pattern matches the previous WORD rather than the
                # previous character — the workbook authors wrote regexes
                # that expect a word-level neighbourhood.
                skip_prev_pat = re.compile(f"(?:{skip_prev})\\s*$", re.IGNORECASE)
            except re.error:
                logger.warning("Detect_List %s: bad skip_prev_regex, ignored", r.get("id"))
        row = _PhraseRow(
            id=r["id"],
            source=r["source"],
            suggestions=list(r.get("suggestions") or []),
            problem_type=r.get("problem_type") or "",
            tool_behaviour=r.get("tool_behaviour") or "flag_and_suggest",
            match_type=r.get("match_type") or "phrase",
            match_case=bool(r.get("match_case", False)),
            style_profile=r.get("style_profile") or "all",
            context_note=r.get("context_note") or "",
            skip_prev_regex=skip_prev_pat,
            require_following_word=bool(r.get("require_following_word", False)),
        )
        buckets.setdefault((row.style_profile, row.match_case), []).append(row)

    out: list[_PhraseGroup] = []
    for (profile, mc), rows_in_bucket in buckets.items():
        # Longest-first so multi-word phrases win alternation ties.
        rows_in_bucket.sort(key=lambda x: -len(x.source))
        # Pre-escape and anchor each phrase with word boundaries. Both
        # whole_word and phrase use \b…\b — the workbook distinguishes
        # them for cataloguing, but Python's \b works identically on either.
        pat = "|".join(r"\b" + re.escape(r.source) + r"\b" for r in rows_in_bucket)
        if not pat:
            continue
        flags = 0 if mc else re.IGNORECASE
        try:
            regex = re.compile(pat, flags)
        except re.error as exc:
            logger.error("phrase lookup regex failed to compile for %s/%s: %s",
                         profile, mc, exc)
            continue
        lookup = {}
        for r in rows_in_bucket:
            key = r.source if mc else r.source.lower()
            lookup[key] = r
        out.append(_PhraseGroup(
            style_profile=profile, match_case=mc, regex=regex, lookup=lookup,
        ))
    return out


# ---------------------------------------------------------------------------
# En_Dash_Terms compilation
# ---------------------------------------------------------------------------

@dataclass
class _EnDashRow:
    category: str
    form_en_dash: Optional[str]
    form_hyphen: Optional[str]
    correct_mw: str          # "en_dash" | "hyphen" | "both"
    correct_chi: str
    detect_list_profile: str


def _parse_en_dash_cell(cell: str) -> str:
    """Normalise the workbook's free-text "correct form" value."""
    s = (cell or "").lower().strip()
    if not s:
        return "both"
    if "both" in s:
        return "both"
    if "en dash" in s or "en-dash" in s or "en–dash" in s:
        return "en_dash"
    if "hyphen" in s:
        return "hyphen"
    return "both"


def _active_en_dash_expectation(row: _EnDashRow, profile: str) -> str:
    """Which surface form is correct under the active dash_profile?

    Explicit profiles return the matching workbook column verbatim. The
    catch-all ``all`` profile only emits a finding when the two style
    axes AGREE — a disagreement (one says hyphen, the other en dash)
    means the author's choice is defensible under some style and the
    engine stays silent to avoid imposing a Chicago rule on an MW
    manuscript (or vice versa). Workbook test cases flagged as
    ``Must not flag`` under the all-profile confirm this contract.
    """
    if profile == "chicago_ama_apa":
        return row.correct_chi
    if profile == "mw_dictionary":
        return row.correct_mw
    if row.correct_mw == row.correct_chi:
        return row.correct_mw
    return "both"


@lru_cache(maxsize=1)
def _compile_en_dash_terms() -> list[_EnDashRow]:
    data = _terms_data()
    out = []
    for r in data.get("en_dash_terms", []):
        out.append(_EnDashRow(
            category=r.get("category") or "",
            form_en_dash=r.get("form_en_dash") or None,
            form_hyphen=r.get("form_hyphen") or None,
            correct_mw=_parse_en_dash_cell(r.get("correct_mw_dictionary") or ""),
            correct_chi=_parse_en_dash_cell(r.get("correct_chicago_ama_apa") or ""),
            detect_list_profile=r.get("detect_list_profile") or "all",
        ))
    return out


# ---------------------------------------------------------------------------
# Protected terms / spans
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _compile_protected_patterns() -> list[tuple[str, re.Pattern]]:
    """Compile the Pattern-kind protected rows. ``_meta['style_profile']``
    is kept alongside each compiled regex so profile-specific exclusions
    can filter later (none exist today; future-proofing).

    Overbroad patterns listed in :data:`_DISABLED_PROTECTED_IDS` are
    skipped with a loud warning so the workbook maintainers see them.
    """
    data = _protected_data()
    out = []
    for row in data.get("patterns", []):
        rid = row.get("id") or ""
        pat = row.get("term_or_pattern")
        if not pat:
            continue
        if rid in _DISABLED_PROTECTED_IDS:
            logger.warning(
                "hyphen_dash: protected pattern %s (%s) is DISABLED pending a "
                "workbook fix — see _DISABLED_PROTECTED_IDS in hyphen_dash.py",
                rid, row.get("type") or "",
            )
            continue
        try:
            rx = re.compile(pat)
        except re.error as exc:
            logger.error("protected pattern %s invalid: %s", rid, exc)
            continue
        out.append((row.get("style_profile") or "all", rx))
    return out


@lru_cache(maxsize=1)
def build_protected_literals(*, dash_profile: str = "all") -> frozenset[str]:
    """Return lowercased protected literals active under ``dash_profile``.

    These are added to the spell-check whitelist and are also used by the
    phrase lookup to skip any Detect_List finding whose source matches
    a protected literal (defence in depth)."""
    data = _protected_data()
    out: set[str] = set()
    for row in data.get("literals", []):
        if not _rule_in_profile(row.get("style_profile") or "all", dash_profile):
            continue
        term = row.get("term_or_pattern")
        if term:
            out.add(term.lower())
    return frozenset(out)


def build_protected_spans(text: str, *, dash_profile: str = "all") -> list[tuple[int, int]]:
    """Return protected (start, end) spans in ``text`` as a sorted,
    merged list. Patterns from the workbook are the sole source; literal
    protected terms are handled via the whitelist and don't need span
    tracking."""
    if not text:
        return []
    raw: list[tuple[int, int]] = []
    for profile, rx in _compile_protected_patterns():
        if not _rule_in_profile(profile, dash_profile):
            continue
        for m in rx.finditer(text):
            raw.append((m.start(), m.end()))
    if not raw:
        return []
    raw.sort()
    merged: list[tuple[int, int]] = []
    for s, e in raw:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def _span_overlaps(a: int, b: int, spans: Iterable[tuple[int, int]]) -> bool:
    for s, e in spans:
        if a < e and b > s:
            return True
    return False


# ---------------------------------------------------------------------------
# MC_COMPOUNDS subtraction
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def workbook_covered_compound_bases() -> frozenset[str]:
    """Lowercased 2-word bases that the workbook already covers.

    ``engine.run_manuscript_core_rules`` consults this to skip
    ``COMPOUND_BASES`` entries whose coverage now lives in the workbook —
    avoiding duplicate findings per the Phase-2 "no duplicates" rule.
    """
    data = _terms_data()
    out: set[str] = set()
    for r in data.get("detect_list", []):
        src = (r.get("source") or "").strip().lower()
        if src:
            out.add(src)
            out.add(src.replace("-", " "))
            out.add(src.replace(" ", "-"))
    for r in data.get("hyphen_compounds", []):
        form = (r.get("correct_form") or "").strip().lower()
        if form:
            out.add(form)
            out.add(form.replace("-", " "))
            out.add(form.replace(" ", "-"))
    return frozenset(out)


# ---------------------------------------------------------------------------
# Detection — phrase lookup
# ---------------------------------------------------------------------------

_WORD_BEFORE_RE = re.compile(r"(\w+)\W*$")
_FOLLOWING_WORD_RE = re.compile(r"^\W*\w")


def _effective_tool_behaviour(
    rule_id: str,
    default: Optional[str],
    overrides: Optional[dict[str, dict[str, Any]]],
) -> str:
    """Resolve the per-rule override on top of the workbook default.

    Returns one of ``auto_replace`` | ``flag``. All non-``auto_replace``
    workbook values (``flag_only``, ``flag_and_suggest``, ``None``) collapse
    to ``flag`` — the Scope-C UI only exposes the two canonical values.
    """
    if overrides:
        o = overrides.get(rule_id) or {}
        if o.get("tool_behaviour") in ("flag", "auto_replace"):
            return o["tool_behaviour"]
    if default == "auto_replace":
        return "auto_replace"
    return "flag"


def _rule_is_disabled_by_override(
    rule_id: str,
    overrides: Optional[dict[str, dict[str, Any]]],
) -> bool:
    if not overrides:
        return False
    o = overrides.get(rule_id) or {}
    return o.get("enabled") is False


def _phrase_findings(
    text: str,
    *,
    dash_profile: str,
    protected_literals: frozenset[str],
    protected_spans: list[tuple[int, int]],
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    """Run every active _PhraseGroup over ``text`` and emit findings.

    Context filters (``skip_prev_regex`` and ``require_following_word``)
    are applied per-match. Protected literals and spans short-circuit
    before a finding is created so the overlap filter never has to drop
    them later.
    """
    out: list[Finding] = []
    for group in _compile_phrase_lookup():
        if not _rule_in_profile(group.style_profile, dash_profile):
            continue
        for m in group.regex.finditer(text):
            surface = m.group(0)
            key = surface if group.match_case else surface.lower()
            row = group.lookup.get(key)
            if row is None:
                # Can happen when match_case is False but the key already
                # lower is from a case variant not in the map; try the
                # mixed form.
                row = group.lookup.get(surface.lower())
                if row is None:
                    continue

            # Per-project override: skip rule entirely when disabled.
            if _rule_is_disabled_by_override(row.id, rule_overrides):
                continue

            s, e = m.start(), m.end()

            # Protected literal (same lowercase form) — never flag.
            if surface.lower() in protected_literals:
                continue
            if _span_overlaps(s, e, protected_spans):
                continue

            # Context filter: previous-word negative lookbehind.
            if row.skip_prev_regex is not None:
                left = text[:s]
                if row.skip_prev_regex.search(left):
                    continue

            # Context filter: must be followed by another word.
            if row.require_following_word:
                tail = text[e:]
                if not _FOLLOWING_WORD_RE.match(tail):
                    continue

            # Compute effective tool_behaviour (project override on top of
            # workbook default). ``flag`` and ``auto_replace`` BOTH produce
            # reviewable findings — this invariant is enforced by always
            # emitting a Finding here and never mutating text.
            eff_tb = _effective_tool_behaviour(row.id, row.tool_behaviour, rule_overrides)

            if not row.suggestions:
                # flag-only row with no suggestion — still emit a finding so
                # a reviewer sees it. Primary suggestion mirrors the surface
                # (no replacement) and ``autofixable`` is False.
                primary = surface
                alt = []
                autofixable = False
            else:
                primary = _preserve_case(surface, row.suggestions[0])
                alt = [_preserve_case(surface, s_) for s_ in row.suggestions[1:]]
                # Both FLAG and AUTO_REPLACE allow user acceptance; only the
                # severity colour changes. autofixable=True in both cases so
                # the Accept button is active for the reviewer.
                autofixable = True

            # Severity now derived from the effective behaviour.
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"

            msg = row.problem_type or "Hyphenation"
            if row.context_note:
                msg = f"{msg}: {row.context_note}"

            out.append(Finding(
                rule_id=row.id,
                category="hyphenation",
                start=s,
                end=e,
                original=surface,
                suggestion=primary,
                message=msg,
                severity=severity,
                autofixable=autofixable,
                alt_suggestions=alt,
            ))
    return out


# ---------------------------------------------------------------------------
# Detection — Dash_Rules regexes
# ---------------------------------------------------------------------------

def _dash_rule_findings(
    text: str,
    *,
    dash_profile: str,
    protected_spans: list[tuple[int, int]],
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    out: list[Finding] = []
    for rule in _compile_dash_rules():
        if not rule.enabled or not rule.rx:
            continue
        if _rule_is_disabled_by_override(rule.id, rule_overrides):
            continue
        rule_profile = getattr(rule, "style_profile", "all")
        if not _rule_in_profile(rule_profile, dash_profile):
            continue
        for m in rule.rx.finditer(text):
            s, e = m.start(), m.end()
            if _span_overlaps(s, e, protected_spans):
                continue
            try:
                primary = m.expand(rule.replacement) if rule.replacement else ""
            except re.error:
                logger.warning("rule %s: replacement expand failed", rule.id)
                continue
            if primary == m.group(0):
                continue  # no-op replacement; don't flag
            alts = []
            for a in getattr(rule, "alt_suggestions", []) or []:
                try:
                    alts.append(m.expand(a))
                except re.error:
                    continue
            eff_tb = _effective_tool_behaviour(
                rule.id, getattr(rule, "tool_behaviour", None), rule_overrides,
            )
            # Both FLAG and AUTO_REPLACE allow user acceptance; severity
            # colour differs so the reviewer can tell them apart at a glance.
            severity = "suggestion" if eff_tb == "auto_replace" else "warning"
            autofixable = True
            out.append(Finding(
                rule_id=rule.id,
                category="hyphenation",
                start=s,
                end=e,
                original=m.group(0),
                suggestion=primary,
                message=rule.message or rule.id,
                severity=severity,
                autofixable=autofixable,
                alt_suggestions=alts,
            ))
    return out


# ---------------------------------------------------------------------------
# Detection — En_Dash_Terms
# ---------------------------------------------------------------------------

def _en_dash_findings(
    text: str,
    *,
    dash_profile: str,
    protected_spans: list[tuple[int, int]],
) -> list[Finding]:
    """For each En_Dash_Terms row, under the active profile, flag the
    surface form that disagrees with the profile's expectation."""
    out: list[Finding] = []
    for i, row in enumerate(_compile_en_dash_terms()):
        if not _rule_in_profile(row.detect_list_profile, dash_profile):
            continue
        expected = _active_en_dash_expectation(row, dash_profile)
        if expected == "both":
            continue
        # Determine which surface, if present, is wrong under the profile.
        wrong_form: Optional[str] = None
        right_form: Optional[str] = None
        if expected == "en_dash":
            wrong_form, right_form = row.form_hyphen, row.form_en_dash
        else:  # expected == "hyphen"
            wrong_form, right_form = row.form_en_dash, row.form_hyphen
        if not wrong_form or not right_form:
            continue
        # Build a strict regex: whole-word on either side when the token
        # endpoints are alphanumeric, else a non-letter/digit boundary.
        esc = re.escape(wrong_form)
        left = r"\b" if wrong_form[:1].isalnum() else r"(?<![A-Za-z0-9])"
        right = r"\b" if wrong_form[-1:].isalnum() else r"(?![A-Za-z0-9])"
        try:
            rx = re.compile(f"{left}{esc}{right}", re.IGNORECASE)
        except re.error:
            continue
        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            if _span_overlaps(s, e, protected_spans):
                continue
            out.append(Finding(
                rule_id=f"EN-{i:04d}",
                category="hyphenation",
                start=s,
                end=e,
                original=m.group(0),
                suggestion=_preserve_case(m.group(0), right_form),
                message=f"{row.category}: {wrong_form!r} should use {expected.replace('_', ' ')}",
                severity="suggestion",
                autofixable=True,
                alt_suggestions=[],
            ))
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def analyze_hyphen_dash(
    text: str,
    *,
    dash_profile: str = "all",
    protected_spans: Optional[list[tuple[int, int]]] = None,
    rule_overrides: Optional[dict[str, dict[str, Any]]] = None,
) -> list[Finding]:
    """Run the full workbook detection stack over ``text``.

    Arguments
    ---------
    text:
        Paragraph text (not sentence; the dash rules need word context).
    dash_profile:
        One of ``all`` | ``mw_dictionary`` | ``chicago_ama_apa``. Any
        other value falls back to ``all``.
    protected_spans:
        Pre-computed protected spans. If omitted, this function computes
        them from ``text`` internally. Callers that also hand the same
        spans to the spell checker should compute once and pass twice.

    Returns findings sorted by (priority, start). Priority is taken from
    the Dash_Rules workbook column for regex rules; phrase lookup and
    en-dash findings use a default of 100 so they land after the
    priority-ordered dash rules.
    """
    if not text:
        return []
    if dash_profile not in _PROFILE_MATCHES:
        dash_profile = "all"

    if protected_spans is None:
        protected_spans = build_protected_spans(text, dash_profile=dash_profile)
    protected_literals = build_protected_literals(dash_profile=dash_profile)

    findings: list[Finding] = []
    findings.extend(_dash_rule_findings(
        text, dash_profile=dash_profile, protected_spans=protected_spans,
        rule_overrides=rule_overrides,
    ))
    findings.extend(_phrase_findings(
        text,
        dash_profile=dash_profile,
        protected_literals=protected_literals,
        protected_spans=protected_spans,
        rule_overrides=rule_overrides,
    ))
    findings.extend(_en_dash_findings(
        text, dash_profile=dash_profile, protected_spans=protected_spans,
    ))

    # Priority ordering: Dash_Rules carry explicit priority (lower = earlier);
    # phrase + en-dash findings default to 100.
    rule_priority = {r.id: getattr(r, "priority", 100) for r in _compile_dash_rules()}
    findings.sort(key=lambda f: (rule_priority.get(f.rule_id, 100), f.start))
    return findings
