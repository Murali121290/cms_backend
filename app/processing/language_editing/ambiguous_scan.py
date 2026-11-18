"""Manuscript-wide occurrence scan for an AB07 ambiguous abbreviation whose
reviewer has picked a canonical expansion.

Scope
-----
AB07 fires per-occurrence when the Context_Rules scorer cannot resolve a
single meaning for an abbreviation (e.g. ``PT`` → "Physical Therapy" |
"Prothrombin Time" | "Patient"). The reviewer then picks one meaning on a
single card; the engine persists that choice via ``finding.edited_text``.

Once a meaning is chosen we need to surface — purely for review context,
*never* as new engine findings — every occurrence in the manuscript that
relates to the chosen pair ``(abbreviation, chosen_expansion)``:

* First valid definition pattern ``<chosen_expansion> (<abbr>)``.
* Any later definition pattern with the same pair (repeated definition).
* Definition patterns using a *different* expansion ``<other_candidate>
  (<abbr>)`` — inconsistent definition surfaced so the reviewer can see the
  conflict.
* Standalone occurrences of the chosen expansion phrase.
* Standalone occurrences of the abbreviation token.

This module is stateless and generic. It takes the abbreviation, the chosen
expansion, and a list of "other candidate expansions" (so matches of
*different* possible meanings are classified as ``inconsistent_definition``
rather than silently included as plain expansion occurrences). Nothing is
hardcoded for any particular abbreviation.

Guarantees
----------
* **No text mutation.** The scanner is a read-only pass over paragraphs.
  The returned ``text`` field always quotes the exact substring from the
  input paragraph — surface preserved (case, whitespace).
* **Exclusion-preserving.** Paragraphs the caller marks as excluded
  (``skip_para(pi) == True``) are skipped exactly like the rest of the
  abbreviations engine handles them. The caller plugs in whichever
  exclusion predicate matches its context (references / headings / tables
  / abstract / extract / src / figure / caption).
* **No duplicate occurrences.** A span that would otherwise appear as
  *both* a definition's embedded abbreviation *and* as a standalone
  abbreviation occurrence is kept only as the enclosing definition
  classification. Standalone expansion/abbreviation matches that overlap
  any already-classified span are dropped.
* **No false findings.** When the chosen expansion never appears outside
  the AB07's own paragraph and the abbreviation never appears elsewhere,
  the result is an empty list — the caller should render the panel as
  "no additional occurrences" rather than fabricating rows.

The scanner is intentionally **not** an engine rule. It never emits
``Finding`` rows; its output is consumed by the finding serializer for
display only.
"""
from __future__ import annotations

import re
from typing import Callable, Iterable, Optional


# Permissive inter-token separator for expansion phrase matching. Users
# sometimes type expansions with varying whitespace / non-breaking spaces
# (NBSP U+00A0) between words; collapsing to \s+ makes the scanner forgiving
# without widening the match to unrelated content. Hyphenated phrases are
# intentionally NOT auto-rewritten — the expansion text supplied by the
# workbook is used verbatim as the token boundary.
_WS_SPLIT_RE = re.compile(r"\s+")


def _build_phrase_regex(phrase: str) -> Optional[re.Pattern[str]]:
    """Case-insensitive, whitespace-forgiving phrase match with word-
    boundary edges. Returns ``None`` when the phrase is empty so callers
    can short-circuit cheaply."""
    tokens = [tok for tok in _WS_SPLIT_RE.split(phrase.strip()) if tok]
    if not tokens:
        return None
    body = r"\s+".join(re.escape(tok) for tok in tokens)
    # Leading / trailing boundaries: letters/digits must not sit flush
    # against the phrase or we'd match "Prothrombin Timeline" as
    # "Prothrombin Time". ``(?<![A-Za-z0-9])`` / ``(?![A-Za-z0-9])`` is
    # equivalent to a word boundary while tolerating punctuation such as
    # "(" and ")".
    return re.compile(rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])", re.IGNORECASE)


def _build_abbr_regex(abbr: str) -> Optional[re.Pattern[str]]:
    """Case-sensitive, boundary-delimited abbreviation match. Case matters
    because "PT" and "pt" are distinguishable in practice (initialism vs.
    typographic abbreviation) — the engine's AB rules preserve the surface
    too."""
    token = (abbr or "").strip()
    if not token:
        return None
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(token)}(?![A-Za-z0-9])")


def _build_definition_regex(
    expansion: str, abbr: str,
) -> Optional[re.Pattern[str]]:
    """Match ``<expansion> (<abbr>)`` with optional whitespace around the
    parentheses. Case-insensitive on the expansion, case-sensitive on the
    abbreviation (same rationale as ``_build_abbr_regex``)."""
    tokens = [tok for tok in _WS_SPLIT_RE.split(expansion.strip()) if tok]
    abbr_t = (abbr or "").strip()
    if not tokens or not abbr_t:
        return None
    body = r"\s+".join(re.escape(tok) for tok in tokens)
    return re.compile(
        rf"(?<![A-Za-z0-9]){body}\s*\(\s*{re.escape(abbr_t)}\s*\)",
        re.IGNORECASE,
    )


def _intervals_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def scan_for_chosen_expansion(
    paragraphs: Iterable[tuple[int, str]],
    abbreviation: str,
    chosen_expansion: str,
    *,
    other_expansions: Optional[Iterable[str]] = None,
    skip_para: Optional[Callable[[int], bool]] = None,
) -> list[dict]:
    """Walk the paragraphs and return every occurrence relevant to the
    reviewer's chosen meaning for an ambiguous abbreviation.

    Parameters
    ----------
    paragraphs : iterable of ``(para_index, text)``
        Same shape ``docx_io.read_paragraphs`` returns. ``para_index`` is
        the 0-based paragraph index the Finding rows reference.
    abbreviation : str
        The short form (e.g. ``"PT"``). Matched case-sensitively with
        non-alphanumeric boundaries.
    chosen_expansion : str
        The expansion the reviewer picked on the AB07 card
        (e.g. ``"Prothrombin Time"``). Matched case-insensitively.
    other_expansions : iterable of str, optional
        Every *other* candidate meaning for the same abbreviation
        (e.g. ``["Physical Therapy", "Patient"]``). When any of these
        appears as the expansion in a ``<expansion> (<abbr>)`` pattern
        the match is classified as ``inconsistent_definition`` rather
        than quietly dropped. Standalone matches of other expansions are
        not reported — they belong to a different semantic and should
        never appear in the chosen-meaning's panel.
    skip_para : callable, optional
        ``skip_para(para_index) -> bool``. When ``True`` for a given
        paragraph the scanner skips it entirely. Lets the caller apply
        the same reference / heading / table / abstract / extract / src
        exclusions the abbreviations engine uses so this scan never
        surfaces an occurrence from a paragraph the engine already
        suppresses.

    Returns
    -------
    list of dict
        Sorted by ``(para_index, start_offset)``. Each item:

        * ``kind`` — one of ``first_definition``, ``repeated_definition``,
          ``inconsistent_definition``, ``expansion``, ``abbreviation``.
        * ``para_index`` — 0-based paragraph index.
        * ``start_offset`` / ``end_offset`` — character offsets inside
          the paragraph text.
        * ``text`` — exact substring from the paragraph (preserves
          original case + whitespace).
        * ``rule_id`` — a presentation hint tying each kind to the
          nearest engine rule the UI can pivot on
          (``AB01`` for first_definition, ``AB04`` for
          repeated_definition, ``AB02`` for expansion, ``AB06`` for
          inconsistent_definition, ``None`` for standalone abbreviation).
    """
    expansion = (chosen_expansion or "").strip()
    abbr = (abbreviation or "").strip()
    if not expansion or not abbr:
        return []

    others = [e.strip() for e in (other_expansions or []) if e and e.strip()]
    # The caller sometimes passes the chosen expansion inside
    # ``other_expansions`` too (e.g. by forwarding the untrimmed AB07 meaning
    # list). Strip the chosen one out so we don't double-match definitions
    # against it as "inconsistent".
    others = [o for o in others if o.lower() != expansion.lower()]

    def_regex = _build_definition_regex(expansion, abbr)
    phrase_regex = _build_phrase_regex(expansion)
    abbr_regex = _build_abbr_regex(abbr)
    other_def_regexes: list[tuple[str, re.Pattern[str]]] = []
    for o in others:
        p = _build_definition_regex(o, abbr)
        if p is not None:
            other_def_regexes.append((o, p))

    results: list[dict] = []
    seen_definition = False

    for para_index, text in paragraphs:
        if not text:
            continue
        if skip_para is not None and skip_para(int(para_index)):
            continue

        para_hits: list[dict] = []
        taken_spans: list[tuple[int, int]] = []

        def _reserve(start: int, end: int) -> bool:
            for s, e in taken_spans:
                if _intervals_overlap(start, end, s, e):
                    return False
            taken_spans.append((start, end))
            return True

        # 1. Definitions with the chosen expansion — enclosing span first
        #    so later passes can skip the embedded abbreviation.
        if def_regex is not None:
            for m in def_regex.finditer(text):
                s, e = m.start(), m.end()
                if not _reserve(s, e):
                    continue
                kind = "first_definition" if not seen_definition else "repeated_definition"
                seen_definition = True
                para_hits.append({
                    "kind": kind,
                    "para_index": int(para_index),
                    "start_offset": s,
                    "end_offset": e,
                    "text": text[s:e],
                    "rule_id": "AB01" if kind == "first_definition" else "AB04",
                })

        # 2. Definitions using one of the *other* candidate expansions.
        #    These are inconsistent with the reviewer's choice; surface
        #    them so the conflict is visible.
        for other_label, pat in other_def_regexes:
            for m in pat.finditer(text):
                s, e = m.start(), m.end()
                if not _reserve(s, e):
                    continue
                para_hits.append({
                    "kind": "inconsistent_definition",
                    "para_index": int(para_index),
                    "start_offset": s,
                    "end_offset": e,
                    "text": text[s:e],
                    "rule_id": "AB06",
                    "conflicting_expansion": other_label,
                })

        # 3. Standalone chosen-expansion phrase.
        if phrase_regex is not None:
            for m in phrase_regex.finditer(text):
                s, e = m.start(), m.end()
                if not _reserve(s, e):
                    continue
                para_hits.append({
                    "kind": "expansion",
                    "para_index": int(para_index),
                    "start_offset": s,
                    "end_offset": e,
                    "text": text[s:e],
                    "rule_id": "AB02",
                })

        # 4. Standalone abbreviation token.
        if abbr_regex is not None:
            for m in abbr_regex.finditer(text):
                s, e = m.start(), m.end()
                if not _reserve(s, e):
                    continue
                para_hits.append({
                    "kind": "abbreviation",
                    "para_index": int(para_index),
                    "start_offset": s,
                    "end_offset": e,
                    "text": text[s:e],
                    "rule_id": None,
                })

        para_hits.sort(key=lambda d: d["start_offset"])
        results.extend(para_hits)

    return results
