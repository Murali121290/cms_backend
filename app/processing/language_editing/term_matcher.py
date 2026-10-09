"""Term-list matching for Language Editing.

A separate concern from grammar/spelling/sentence rules: scans paragraph text
for exact whole-word matches against the project's assigned term lists and
emits findings with ``source='term'`` so the UI can show a dedicated Terms
tab (view-only highlighting — no accept/reject).

Matching semantics (confirmed with the team):
  - Case-insensitive whole-word (``\\b`` on both sides)
  - EXACT match: ``color`` matches ``color`` but NOT ``colors`` or ``colored``
  - Multi-word phrases supported natively (``ad hoc``, ``et al.``, ``cul-de-sac``)
  - Each list compiled once per analyze run as a single alternation regex

Each match becomes a Finding carrying:
    rule_id    = f"term:{term_list.id}:{term.id}"
    category   = "term"
    severity   = "info"
    source     = "term"       (DB column, filled by caller)
    term_list_id = term_list.id   (DB column, filled by caller)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from .rules import Finding


@dataclass
class CompiledTermList:
    """A term list prepared for matching: one compiled regex per list.

    ``term_lookup`` maps the lowercased surface form back to the ``Term.id`` so
    the finding can be linked to the exact row.
    """
    list_id: int
    list_name: str
    regex: re.Pattern | None
    term_lookup: dict[str, int]  # lowercased term -> term row id


def compile_term_list(list_id: int, list_name: str, terms: Iterable[tuple[int, str]]) -> CompiledTermList:
    """Build a single alternation regex from the term list.

    ``terms`` is an iterable of ``(term_id, term_text)``. Returns a
    ``CompiledTermList`` whose ``regex`` is ``None`` if the list is empty.

    Longer terms are placed earlier in the alternation so that multi-word
    phrases take precedence over sub-words.
    """
    term_lookup: dict[str, int] = {}
    unique: list[tuple[int, str]] = []
    for tid, text in terms:
        norm = text.lower().strip()
        if not norm:
            continue
        if norm in term_lookup:
            continue
        term_lookup[norm] = tid
        unique.append((tid, text))

    if not unique:
        return CompiledTermList(list_id=list_id, list_name=list_name, regex=None, term_lookup={})

    # Longest first — regex alternation picks the first match, so "ad hoc" wins over "ad".
    unique.sort(key=lambda x: -len(x[1]))

    # Each term gets its own anchored pattern. \b only applies to term edges
    # that are word characters; terms like "et al." or "'90s" that begin/end
    # with non-word characters use look-around assertions against alphanumerics
    # instead, otherwise \b wouldn't fire at those non-word→non-word transitions.
    def _anchor(term: str) -> str:
        escaped = re.escape(term)
        left = r"\b" if term[:1].isalnum() else r"(?<![A-Za-z0-9])"
        right = r"\b" if term[-1:].isalnum() else r"(?![A-Za-z0-9])"
        return f"{left}(?:{escaped}){right}"

    pattern = "|".join(_anchor(text) for _, text in unique)
    return CompiledTermList(
        list_id=list_id,
        list_name=list_name,
        regex=re.compile(pattern, re.IGNORECASE),
        term_lookup=term_lookup,
    )


def find_term_matches(text: str, compiled_lists: list[CompiledTermList]) -> list[dict]:
    """Scan ``text`` against each compiled list; return deduplicated match dicts.

    Deduplication: if the same span (``start, end``) is matched by two or more
    lists (e.g. the word "patient" appears in both LWW and APA), only ONE
    finding is emitted — attributed to the first list that matched, with
    additional lists recorded in ``also_in_list_ids`` / ``also_in_list_names``
    for tooltip attribution if the UI wants to show them.

    Each returned dict has: ``start, end, matched_text, term_list_id,
    term_list_name, term_id, also_in_list_ids, also_in_list_names``.
    """
    if not text or not compiled_lists:
        return []

    # (start, end) -> match dict (first list wins)
    span_map: dict[tuple[int, int], dict] = {}
    for cl in compiled_lists:
        if cl.regex is None:
            continue
        for m in cl.regex.finditer(text):
            key = (m.start(), m.end())
            matched = m.group(0)
            if key in span_map:
                # Already captured by an earlier list; just note the overlap.
                existing = span_map[key]
                if cl.list_id not in existing["also_in_list_ids"] and cl.list_id != existing["term_list_id"]:
                    existing["also_in_list_ids"].append(cl.list_id)
                    existing["also_in_list_names"].append(cl.list_name)
                continue
            span_map[key] = {
                "start": m.start(),
                "end": m.end(),
                "matched_text": matched,
                "term_list_id": cl.list_id,
                "term_list_name": cl.list_name,
                "term_id": cl.term_lookup.get(matched.lower()),
                "also_in_list_ids": [],
                "also_in_list_names": [],
            }

    # Sorted output so tests / UI see stable order.
    return sorted(span_map.values(), key=lambda m: (m["start"], m["end"]))


def build_matcher_for_project(db, *, project_id: int) -> list[CompiledTermList]:
    """Load the project's SAVED term list assignments and compile each one.

    Source of truth: ``selected_terms.json`` written to the project's CE Support
    folder on every Save Assignment. If the JSON is missing (project never
    saved an assignment, or legacy project pre-dating this feature), fall back
    to the ``project_term_lists`` DB table so analysis still works.

    Only ``is_active`` term lists are included; a list unassigned since the
    last save is dropped from the engine on the next analyze. This guarantees
    "only selected and saved terms get highlighted" per the team requirement.
    """
    from app.services.term_list_service import read_selected_terms_json
    from app.domains.term_lists.models import TermList, Term

    payload = read_selected_terms_json(db, project_id=project_id)
    assigned_ids: list[int] = [tl["id"] for tl in (payload.get("generic_lists") or [])]
    assigned_ids += [tl["id"] for tl in (payload.get("client_lists") or [])]

    if not assigned_ids:
        return []

    compiled: list[CompiledTermList] = []
    for list_id in assigned_ids:
        tl = (db.query(TermList)
              .filter(TermList.id == list_id, TermList.is_active == True)  # noqa: E712
              .first())
        if not tl:
            # List was deactivated after being saved — skip silently.
            continue
        rows = db.query(Term.id, Term.term).filter(Term.term_list_id == tl.id).all()
        compiled.append(compile_term_list(tl.id, tl.name, [(r[0], r[1]) for r in rows]))
    return compiled
