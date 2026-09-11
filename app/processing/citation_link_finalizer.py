"""Finalize citation/reference cross-linking and AQ comments at export time.

The reference validator (`app/processing/legacy/validation_core.py`,
`Referencenumvalidation.py`) already knows which citations in the body match
entries in the reference list and which do not. What was missing: turning that
knowledge into changes that survive into the downloaded DOCX.

This module is the single "finalizer" the export path calls before handing
the DOCX to the user. For each chapter it:

1.  Re-runs the validator on the DOCX so decisions are always based on the
    current file state (not on a stale editor cache).
2.  For every **matched** citation → the bookmark/hyperlink stamped by the
    editor is left alone; if a match exists but no bookmark was stamped yet
    (e.g. save happened before the reference-review panel was opened) a Word
    comment is *not* added — the reference is genuinely in the list, so the
    export is correct.
3.  For every **unmatched citation** ("cited in text, not in list") →
    inserts a Word comment on the paragraph carrying that citation with the
    AQ text template from the spec.
4.  For every **unused reference** ("in list, not cited") → inserts a Word
    comment on that reference paragraph with the corresponding AQ text.

Multi-citation blocks like ``(Smith, 2020; Jones, 2021; Lee, 2019)`` are
handled per-work: the paragraph gets one AQ comment per unmatched author-year
segment, not a single comment for the whole block. Splitting mirrors the
frontend helper in `CitationCandidatePanel.tsx::splitCitationBlock` so the
two paths agree on what a "single citation" is.

The finalizer is idempotent by comment text — if the same AQ comment is
already present on a paragraph we don't duplicate it. This means calling it
repeatedly on the same DOCX (e.g. multiple exports without editing) never
grows the comment list.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from docx import Document
from docx.oxml.ns import qn

logger = logging.getLogger(__name__)


# AQ message templates — exactly as specified by the product team.
AQ_MISSING_CITATION_TEMPLATE = (
    'AQ: The reference "{citation}" is cited in the text but not given in '
    "the list. Please provide complete publication details of this reference "
    "in the list or delete the citation from the text."
)
AQ_UNUSED_REFERENCE_TEMPLATE = (
    'AQ: The reference "{reference}" is given in the list but not cited in '
    "the text. Please cite the reference in the text or delete from the list."
)


# ─── Multi-citation splitting ────────────────────────────────────────────────

_YEAR_TOKEN_RE = re.compile(r"^\s*(19|20)\d{2}[a-z]?\s*$")
_ND_TOKEN_RE = re.compile(r"\bn\.\s*d\.?\b", re.IGNORECASE)
_IN_PRESS_RE = re.compile(r"\bin\s+press\b", re.IGNORECASE)


def _looks_like_year(s: str) -> bool:
    s = s.strip()
    return bool(_YEAR_TOKEN_RE.match(s) or _ND_TOKEN_RE.search(s) or _IN_PRESS_RE.search(s))


def split_citation_block(text: str) -> List[str]:
    """Split ``(Smith, 2020; Jones, 2021; Lee, n.d.)`` into individual works.

    Mirrors the frontend `splitCitationBlock` so backend AQ decisions match
    what the reference-review panel would show. Semicolon-separated is the
    common APA form; comma-separated with year tokens is a fallback for
    inputs like ``"IHI, 2017, CMS, n.d."`` that some authors produce.
    """
    if not text:
        return []
    clean = text.strip()
    clean = re.sub(r"^[\s(\[]+", "", clean)
    clean = re.sub(r"[\s)\]]+$", "", clean)
    if not clean:
        return []

    if ";" in clean:
        return [s.strip() for s in clean.split(";") if s.strip()]

    # No semicolons — try comma-grouping where each group ends at a year token.
    parts = [p.strip() for p in clean.split(",") if p.strip()]
    citations: List[str] = []
    current = ""
    for part in parts:
        current = part if not current else f"{current}, {part}"
        if _looks_like_year(part):
            citations.append(current)
            current = ""
    if current:
        citations.append(current)
    return citations or [clean]


# ─── Comment insertion helper (idempotent) ──────────────────────────────────


_AQ_MISSING_KEY_RE = re.compile(
    r'AQ:\s*The reference\s*[“"\']([^"”\']+)[”"\']\s*is cited in the text but not given',
    re.IGNORECASE,
)
_AQ_UNUSED_KEY_RE = re.compile(
    r'AQ:\s*The reference\s*[“"\']([^"”\']+)[”"\']\s*is given in the list but not cited',
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r'(19|20)\d{2}[a-z]?|n\.\s*d\.', re.IGNORECASE)
_SURNAME_RE = re.compile(r'[A-Z][A-Za-zÀ-ſ\'\-]{1,}')


def _aq_signature(text: str) -> Optional[Tuple[str, str, str]]:
    """Reduce an AQ comment to (kind, surname_key, year_key) so different
    phrasings of the same issue collapse.

    S4C emits shorthand like ``AQ: The reference "Capobianco et al., 2025" is
    given in the list but not cited...``, while Reference Validator emits the
    full raw ref ``"Capobianco, M., Puzzo, C., ... (2025). Current virtual
    reality..."``. Both should count as duplicates for the same underlying
    issue. We key by the FIRST capitalised surname + the YEAR — enough to
    disambiguate between references without over-collapsing.
    """
    if not text:
        return None
    for kind, rx in (("missing", _AQ_MISSING_KEY_RE), ("unused", _AQ_UNUSED_KEY_RE)):
        m = rx.search(text)
        if not m:
            continue
        payload = m.group(1)
        y = _YEAR_RE.search(payload)
        year_key = (y.group(0) if y else "").lower().replace(".", "").replace(" ", "")
        s = _SURNAME_RE.search(payload)
        surname_key = (s.group(0) if s else "").lower()
        if not surname_key and not year_key:
            return None
        return (kind, surname_key, year_key)
    return None


def _collect_paragraph_comment_texts(para) -> List[str]:
    doc = getattr(para.part, "document", None) or para._parent
    part = None
    try:
        from docx.opc.constants import RELATIONSHIP_TYPE as RT
        for rel in doc.part.rels.values():
            if rel.reltype == RT.COMMENTS:
                part = rel.target_part
                break
    except Exception:
        part = None
    if part is None:
        return []
    try:
        from lxml import etree
        comments_root = etree.fromstring(part.blob)
    except Exception:
        return []
    text_by_id: Dict[str, str] = {}
    for cmt in comments_root.findall(qn("w:comment")):
        cid = cmt.get(qn("w:id"))
        if cid is None:
            continue
        body = "".join((t.text or "") for t in cmt.iter(qn("w:t"))).strip()
        text_by_id[cid] = body
    out: List[str] = []
    for ref in para._element.iter(qn("w:commentReference")):
        cid = ref.get(qn("w:id"))
        if cid is not None and cid in text_by_id:
            out.append(text_by_id[cid])
    return out


def _paragraph_has_comment_text(para, text: str) -> bool:
    """True if the paragraph already carries an equivalent AQ comment.

    Exact text match takes precedence; if `text` looks like an AQ, we also
    accept any existing comment whose AQ signature (kind, surname, year)
    matches — this catches S4C↔Reference Validator phrasing differences for
    the same issue.
    """
    existing = _collect_paragraph_comment_texts(para)
    if not existing:
        return False
    stripped = text.strip()
    for body in existing:
        if body.strip() == stripped:
            return True
    sig = _aq_signature(text)
    if sig is None:
        return False
    for body in existing:
        if _aq_signature(body) == sig:
            return True
    return False


def _find_citation_anchor_runs(para, citation_text: str) -> List[Any]:
    """Return the `<w:r>` runs in `para` that together spell `citation_text`.

    Used to scope a "missing citation" AQ to the exact citation string in the
    paragraph rather than the whole paragraph. Match is whitespace-insensitive
    and considers only citation-styled runs (`citebib` character style) or
    runs already inside a `bib_*` bookmark — that keeps the anchor tight and
    avoids grabbing surrounding narrative text.
    """
    if not citation_text:
        return []

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip().lower())

    needle = _norm(citation_text.strip("()[]"))
    if not needle:
        return []

    p_el = para._element
    # Identify runs sitting inside a bib_N bookmark so we can prefer those.
    bib_ids: set = set()
    for bs in p_el.iter(_W + "bookmarkStart"):
        name = bs.get(_W + "name") or ""
        if _BIB_LOWER_RE.match(name):
            bid = bs.get(_W + "id")
            if bid:
                bib_ids.add(bid)

    runs: List[Any] = []
    inside_bib: List[bool] = []
    open_bib: set = set()
    for el in p_el.iter():
        if el is p_el:
            continue
        tag = el.tag
        if tag == _W + "bookmarkStart":
            bid = el.get(_W + "id")
            if bid in bib_ids:
                open_bib.add(bid)
        elif tag == _W + "bookmarkEnd":
            bid = el.get(_W + "id")
            if bid in bib_ids:
                open_bib.discard(bid)
        elif tag == _W + "r":
            runs.append(el)
            inside_bib.append(bool(open_bib))

    if not runs:
        return []

    def _run_text_of(r) -> str:
        return "".join((t.text or "") for t in r.findall(_W + "t"))

    # Sliding window over runs — find the shortest span whose concatenated
    # text (normalised) contains the citation. Prefer a window whose runs are
    # mostly citation-styled / inside bib_N.
    best: Optional[Tuple[int, int]] = None
    for i in range(len(runs)):
        acc = ""
        for j in range(i, len(runs)):
            acc += _run_text_of(runs[j])
            if len(_norm(acc)) < len(needle):
                continue
            if needle in _norm(acc):
                if best is None or (j - i) < (best[1] - best[0]):
                    best = (i, j)
                break

    if best is None:
        return []
    i, j = best
    return runs[i:j + 1]


def _find_reference_anchor_runs(para) -> List[Any]:
    """Return a short anchor for an "unused reference" AQ.

    Uses the first content run of the reference paragraph (typically the
    `bib_surname` run, e.g. "Capobianco"). Falls back to the first run when
    no styled surname run is present.
    """
    p_el = para._element
    first_run = None
    for r in p_el.iter(_W + "r"):
        first_run = first_run or r
        rpr = r.find(_W + "rPr")
        if rpr is None:
            continue
        rst = rpr.find(_W + "rStyle")
        if rst is None:
            continue
        val = (rst.get(_W + "val") or "").lower()
        if val in ("bibsurname", "bib_surname"):
            return [r]
    return [first_run] if first_run is not None else []


def _add_aq_comment(
    doc,
    para,
    text: str,
    author: str = "Reference Validator",
    *,
    anchor_runs: Optional[List[Any]] = None,
) -> bool:
    """Add an AQ comment to `para` unless an equivalent AQ is already there.

    When `anchor_runs` is provided the comment range wraps exactly those runs;
    otherwise it is inserted as a zero-length point comment. Full-paragraph
    ranges are never used — Word renders them as full-paragraph shading, which
    is a visible defect in the delivered DOCX.
    """
    if _paragraph_has_comment_text(para, text):
        return False
    from app.docx_pipeline.utils.docx_helpers import add_comment_to_paragraph
    add_comment_to_paragraph(
        doc, para, text=text, author=author,
        anchor_runs=anchor_runs,
        range_mode="point",
    )
    return True


# ─── Paragraph indexing ──────────────────────────────────────────────────────


def _body_paragraphs(doc) -> List[Any]:
    """Every <w:p> reachable from the document body, including inside tables
    and SDTs. Order matches how the validators number `para_idx`."""
    from docx.text.paragraph import Paragraph
    return [Paragraph(p, doc) for p in doc.element.body.iter(qn("w:p"))]


# ─── Export-time DOCX cleanup ───────────────────────────────────────────────


# WYSIWYG editor round-trip bookmarks. Every paragraph/run/table/cell gets
# a `<prefix><hex-suffix>` bookmark so the delta engine can locate edits; those
# tracking bookmarks are not meaningful in the delivered DOCX and must be
# stripped before hand-off. Keep this list in sync with the generators in
# `app/processing/docx_to_xhtml_runs.py` and `xhtml_to_docx_delta.py`.
_EDITOR_TRACKING_PREFIXES: Tuple[str, ...] = (
    "r_bm_",
    "p_bm_",
    "tbl_bm_",
    "cell_bm_",
    "fnpara_bm_",
    "enpara_bm_",
)

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W = "{" + _W_NS + "}"

_REF_UPPER_RE = re.compile(r"^REF(\d+)$")
_BIB_LOWER_RE = re.compile(r"^bib_(\d+)(?:_\d+)?$")


def _rpr_of(r_elem):
    """Return the `<w:rPr>` child of a `<w:r>`, creating it (as the first
    child, per OOXML schema) if absent."""
    from lxml import etree as _etree
    rPr = r_elem.find(_W + "rPr")
    if rPr is None:
        rPr = _etree.Element(_W + "rPr")
        r_elem.insert(0, rPr)
    return rPr


def _run_char_style(r_elem):
    rPr = r_elem.find(_W + "rPr")
    if rPr is None:
        return None
    rst = rPr.find(_W + "rStyle")
    return rst.get(_W + "val") if rst is not None else None


def _add_highlight(r_elem, color: str) -> bool:
    """Add `<w:highlight w:val="{color}"/>` to a run's rPr. Skips if the run
    already has a highlight (respecting whatever colour is there). Returns
    True when a highlight was added."""
    from lxml import etree as _etree
    rPr = _rpr_of(r_elem)
    if rPr.find(_W + "highlight") is not None:
        return False
    hl = _etree.Element(_W + "highlight")
    hl.set(_W + "val", color)
    rPr.append(hl)
    return True


def _apply_citation_highlights(root) -> int:
    """Highlight citation clusters green (matched) or yellow (unmatched).

    A *citation cluster* is a contiguous span of runs where every run is
    either ``citebib``-styled OR sits inside a ``bib_N``/``bib_N_M``
    bookmark. Any non-citation run breaks the cluster. Once a cluster
    ends, all its runs are highlighted the same colour:

    * **green** when at least one run in the cluster is inside a ``bib_N``
      bookmark (the citation resolved to a reference entry).
    * **yellow** when no run in the cluster is inside any ``bib_N``
      (the citation is unmatched — an AQ comment likely flags the
      paragraph).

    Runs are located by pre-order traversal of the paragraph, so runs
    nested inside a ``<w:hyperlink>`` are still picked up. Respects any
    existing ``<w:highlight>`` — never overrides an author or upstream
    decision. Idempotent.
    """
    added = 0
    for p in root.iter(_W + "p"):
        bib_ids: set = set()
        for bs in p.iter(_W + "bookmarkStart"):
            name = bs.get(_W + "name") or ""
            if _BIB_LOWER_RE.match(name):
                bid = bs.get(_W + "id")
                if bid:
                    bib_ids.add(bid)

        open_bib: set = set()
        cluster_runs: list = []  # runs in the current cluster
        cluster_any_in_bib = False

        def _flush():
            nonlocal added, cluster_any_in_bib
            if not cluster_runs:
                return
            color = "green" if cluster_any_in_bib else "yellow"
            for r in cluster_runs:
                if _add_highlight(r, color):
                    added += 1
            cluster_runs.clear()
            cluster_any_in_bib = False

        for el in p.iter():
            if el is p:
                continue
            tag = el.tag
            if tag == _W + "bookmarkStart":
                bid = el.get(_W + "id")
                if bid in bib_ids:
                    open_bib.add(bid)
            elif tag == _W + "bookmarkEnd":
                bid = el.get(_W + "id")
                if bid in bib_ids:
                    open_bib.discard(bid)
            elif tag == _W + "r":
                is_citebib = _run_char_style(el) == "citebib"
                is_in_bib = bool(open_bib)
                if is_citebib or is_in_bib:
                    cluster_runs.append(el)
                    if is_in_bib:
                        cluster_any_in_bib = True
                else:
                    _flush()
        _flush()
    return added


def _wrap_bib_citations_with_hyperlinks(root) -> int:
    """For every ``bib_N`` / ``bib_N_M`` bookmark, wrap the runs it spans in
    ``<w:hyperlink w:anchor="ref_N"/>`` so citations are clickable in Word.

    Only wraps when a matching ``ref_N`` bookmark exists in the same document,
    so Word never renders a dangling link. Runs already inside a
    ``<w:hyperlink>`` are skipped — the pass is idempotent and safe on
    docs whose citations already carry external URL hyperlinks.

    Returns the count of citations wrapped (0 if nothing changed).
    """
    from lxml import etree as _etree

    existing_refs: set[str] = set()
    for bs in root.iter(_W + "bookmarkStart"):
        name = bs.get(_W + "name") or ""
        if re.fullmatch(r"ref_\d+", name):
            existing_refs.add(name)
    if not existing_refs:
        return 0

    bib_starts = [
        bs for bs in root.iter(_W + "bookmarkStart")
        if _BIB_LOWER_RE.match(bs.get(_W + "name") or "")
    ]

    wrapped = 0
    for bs in bib_starts:
        m = _BIB_LOWER_RE.match(bs.get(_W + "name") or "")
        if not m:
            continue
        target = f"ref_{m.group(1)}"
        if target not in existing_refs:
            continue
        parent = bs.getparent()
        if parent is None or parent.tag != _W + "p":
            continue
        bid = bs.get(_W + "id")
        be = None
        for cand in parent.iter(_W + "bookmarkEnd"):
            if cand.get(_W + "id") == bid:
                be = cand
                break
        if be is None:
            continue
        sibs = list(parent)
        try:
            si = sibs.index(bs)
            ei = sibs.index(be)
        except ValueError:
            continue
        if ei <= si + 1:
            continue
        spanned = sibs[si + 1: ei]
        runs = [el for el in spanned if el.tag == _W + "r"]
        if not runs:
            continue
        if any(r.getparent().tag == _W + "hyperlink" for r in runs):
            continue

        hl = _etree.Element(_W + "hyperlink")
        hl.set(_W + "anchor", target)
        hl.set(_W + "history", "1")
        first_r_idx = list(parent).index(runs[0])
        parent.insert(first_r_idx, hl)
        for r in runs:
            parent.remove(r)
            hl.append(r)
        wrapped += 1

    return wrapped


def _strip_editor_tracking_bookmarks(root) -> int:
    """Remove `w:bookmarkStart`/`w:bookmarkEnd` pairs whose name starts with
    any of the editor tracking prefixes.

    The tracking-bookmark id space overlaps with the legit `bib_N`/`ref_N` id
    space (both generators seed from max+1 independently). Matching a
    bookmarkEnd by id alone would collapse legit ends too. Instead we walk
    the document in order and pair each bookmarkEnd with the most recent
    bookmarkStart that shares its id — remove the end only when its paired
    start is a tracking bookmark.

    Returns the number of bookmarkStart elements removed.
    """
    open_stack_by_id: Dict[str, List[Any]] = {}
    to_remove: List[Any] = []
    for el in root.iter():
        tag = el.tag
        if tag == _W + "bookmarkStart":
            bid = el.get(_W + "id")
            if bid is None:
                continue
            name = el.get(_W + "name") or ""
            is_tracking = any(name.startswith(p) for p in _EDITOR_TRACKING_PREFIXES)
            open_stack_by_id.setdefault(bid, []).append((el, is_tracking))
        elif tag == _W + "bookmarkEnd":
            bid = el.get(_W + "id")
            if bid is None:
                continue
            stack = open_stack_by_id.get(bid)
            if not stack:
                # Orphan end (no matching open start) — leave it alone.
                continue
            start_el, is_tracking = stack.pop()
            if is_tracking:
                to_remove.append(start_el)
                to_remove.append(el)

    # Any still-open tracking starts (no matching end reached) — also drop.
    for stack in open_stack_by_id.values():
        for start_el, is_tracking in stack:
            if is_tracking:
                to_remove.append(start_el)

    removed_starts = 0
    for el in to_remove:
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
            if el.tag == _W + "bookmarkStart":
                removed_starts += 1
    return removed_starts


def _repair_orphan_bookmark_starts(root) -> int:
    """Insert a zero-length `<w:bookmarkEnd>` right after any `<w:bookmarkStart>`
    that has no matching end in the doc. Word ignores bookmarks whose end is
    missing, so unclosed starts (a not-uncommon upstream artefact — e.g.
    `_GoBack` in some template flows) would otherwise hide the bookmark from
    Word's Bookmark dialog and any cross-reference features.
    """
    from lxml import etree
    seen_ends: set[str] = {be.get(_W + "id") for be in root.iter(_W + "bookmarkEnd")}
    repaired = 0
    for bs in list(root.iter(_W + "bookmarkStart")):
        bid = bs.get(_W + "id")
        if bid is None or bid in seen_ends:
            continue
        parent = bs.getparent()
        if parent is None:
            continue
        end = etree.SubElement(parent, _W + "bookmarkEnd")
        # SubElement appends at parent end — move it to sit right after bs
        parent.remove(end)
        idx = list(parent).index(bs)
        parent.insert(idx + 1, end)
        end.set(_W + "id", bid)
        seen_ends.add(bid)
        repaired += 1
    return repaired


def _rename_ref_uppercase_bookmarks(root) -> int:
    """Rename `REF{n}` (uppercase, no underscore — Reference Review stamp
    from the frontend) to the PPH-standard `ref_{n}` (lowercase). Preserves
    the bookmark id and any nested content.

    When `ref_{n}` already exists at another position (both anchors point at
    reference entry N), the redundant `REF{n}` bookmarkStart AND its matching
    bookmarkEnd are removed so the delivered file carries only the canonical
    `ref_{n}` scheme.

    Returns the total number of `REF{n}` bookmarks removed or renamed.
    """
    renamed = 0
    existing_names = {
        (bs.get(_W + "name") or "") for bs in root.iter(_W + "bookmarkStart")
    }
    to_remove_ids: set[str] = set()
    for bs in root.iter(_W + "bookmarkStart"):
        name = bs.get(_W + "name") or ""
        m = _REF_UPPER_RE.match(name)
        if not m:
            continue
        new_name = f"ref_{m.group(1)}"
        bid = bs.get(_W + "id")
        if new_name in existing_names and new_name != name:
            # `ref_{n}` already anchors reference N somewhere else — drop this
            # `REF{n}` duplicate entirely so the delivered file matches the
            # PPH bookmark scheme exactly.
            if bid is not None:
                to_remove_ids.add(bid)
            parent = bs.getparent()
            if parent is not None:
                parent.remove(bs)
            renamed += 1
            continue
        bs.set(_W + "name", new_name)
        existing_names.add(new_name)
        renamed += 1

    if to_remove_ids:
        for be in list(root.iter(_W + "bookmarkEnd")):
            if be.get(_W + "id") in to_remove_ids:
                parent = be.getparent()
                if parent is not None:
                    parent.remove(be)

    return renamed


def _dedupe_comments(root, comments_root) -> int:
    """Remove duplicate comments on the SAME paragraph.

    A duplicate is any comment whose (normalised text) matches an earlier
    comment on the same paragraph, OR whose AQ signature (kind, surname,
    year) matches an earlier AQ — this collapses S4C's shorthand and
    Reference Validator's full-text phrasings of the same "unused reference"
    / "missing citation" issue. Comments on different paragraphs are kept.
    """
    if comments_root is None:
        return 0
    text_by_id: Dict[str, Tuple[str, str]] = {}
    sig_by_id: Dict[str, Optional[Tuple[str, str, str]]] = {}
    for cmt in comments_root.findall(_W + "comment"):
        cid = cmt.get(_W + "id")
        if cid is None:
            continue
        author = cmt.get(_W + "author") or ""
        body = "".join((t.text or "") for t in cmt.iter(_W + "t")).strip()
        text_by_id[cid] = (author, body)
        sig_by_id[cid] = _aq_signature(body)

    removed_ids: set[str] = set()
    # Doc-wide pass, but SCOPED to Reference Validator only: if S4C (or any
    # other earlier author) already produced an AQ with the same signature,
    # drop the Reference Validator dup even if it anchored to a different
    # paragraph. Reference Validator is a strict fallback; it should never
    # add on top of an existing S4C AQ.
    seen_sig_global: Dict[Tuple[str, str, str], str] = {}
    for cmt in comments_root.findall(_W + "comment"):
        cid = cmt.get(_W + "id")
        if cid is None:
            continue
        sig = sig_by_id.get(cid)
        if sig is None:
            continue
        author = text_by_id.get(cid, ("", ""))[0]
        if sig in seen_sig_global:
            # Later occurrence — drop only if it's authored by the fallback.
            if author == "Reference Validator":
                removed_ids.add(cid)
        else:
            seen_sig_global[sig] = cid

    for para in root.iter(_W + "p"):
        seen_text: set[Tuple[str, str]] = set()
        seen_sigs: set[Tuple[str, str, str]] = set()
        # A comment anchors to a paragraph via `commentRangeStart`, and its
        # inline marker is `commentReference`. Upstream pipeline stages
        # sometimes emit the range without a reference (or vice-versa), so we
        # union both markers when deciding which ids belong to this paragraph.
        # Walking in document order lets us keep the FIRST anchor and drop
        # every later duplicate.
        seen_ids_here: List[str] = []
        for anchor in para.iter():
            if anchor.tag == _W + "commentRangeStart" or anchor.tag == _W + "commentReference":
                cid = anchor.get(_W + "id")
                if cid is not None and cid not in seen_ids_here:
                    seen_ids_here.append(cid)
        for cid in seen_ids_here:
            key = text_by_id.get(cid)
            if key is None:
                continue
            sig = sig_by_id.get(cid)
            if key in seen_text:
                removed_ids.add(cid)
                continue
            if sig is not None and sig in seen_sigs:
                # e.g. Reference Validator's full-text AQ dup of an earlier
                # S4C shorthand AQ on the same paragraph.
                removed_ids.add(cid)
                continue
            seen_text.add(key)
            if sig is not None:
                seen_sigs.add(sig)

    if not removed_ids:
        return 0

    # Drop the duplicate comment definitions.
    for cmt in list(comments_root.findall(_W + "comment")):
        if cmt.get(_W + "id") in removed_ids:
            comments_root.remove(cmt)

    # Drop the paragraph-level markers (start/end/reference) for those ids.
    def _drop(tag: str) -> None:
        for el in list(root.iter(_W + tag)):
            if el.get(_W + "id") in removed_ids:
                parent = el.getparent()
                if parent is not None:
                    parent.remove(el)

    _drop("commentRangeStart")
    _drop("commentRangeEnd")
    # commentReference lives inside a w:r; drop the surrounding run if the
    # reference was its only meaningful child.
    for r in list(root.iter(_W + "r")):
        for cr in list(r.findall(_W + "commentReference")):
            if cr.get(_W + "id") in removed_ids:
                r.remove(cr)
        # Empty run left behind (only rPr) → remove.
        remaining = [c for c in r if c.tag != _W + "rPr"]
        if not remaining:
            parent = r.getparent()
            if parent is not None:
                parent.remove(r)

    return len(removed_ids)


_REF_PARA_STYLES: Tuple[str, ...] = (
    "REF-U", "REF-N", "REF-OPEN", "Reference", "Bibliography",
    "BIB", "BIBH1", "BIBH2", "REFERENCE",
)
_HYPERLINK_BLUE_HEXES: Tuple[str, ...] = ("0563C1", "0000FF")


def _shrink_paragraph_wide_comment_ranges(root) -> int:
    """Shrink any `<w:commentRangeStart>` / `<w:commentRangeEnd>` pair whose
    range covers essentially an entire paragraph down to a zero-length point
    range placed right after `<w:pPr>`.

    Word renders paragraph-wide comment ranges as full-paragraph shading — a
    visible defect. The AQ workflow used to insert every comment as
    paragraph-wide because `add_comment_to_paragraph` had no anchor-runs
    support. Newly emitted comments now anchor to specific runs or use a
    point range, but historical DOCX files re-exported through this finalizer
    may still carry legacy paragraph-wide ranges. This pass rewrites them so
    the delivered file looks like the golden.

    A range is considered "paragraph-wide" when its start and end are in the
    same paragraph AND the concatenated text between them equals the whole
    paragraph's text (whitespace-collapsed). Ranges narrower than that (e.g.
    already anchored to a citation) are left alone. Idempotent.
    """
    shrunk = 0
    starts: Dict[str, Any] = {}
    ends: Dict[str, Any] = {}
    for cs in root.iter(_W + "commentRangeStart"):
        cid = cs.get(_W + "id")
        if cid is not None:
            starts[cid] = cs
    for ce in root.iter(_W + "commentRangeEnd"):
        cid = ce.get(_W + "id")
        if cid is not None:
            ends[cid] = ce

    def _paragraph_of(el):
        p = el
        while p is not None and p.tag != _W + "p":
            p = p.getparent()
        return p

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").strip())

    for cid, cs in list(starts.items()):
        ce = ends.get(cid)
        if ce is None:
            continue
        ps = _paragraph_of(cs)
        pe = _paragraph_of(ce)
        if ps is None or ps is not pe:
            # Multi-paragraph range — never touched by the AQ workflow; leave.
            continue

        full_text = _norm(
            "".join(t.text or "" for t in ps.iter(_W + "t"))
        )
        if not full_text:
            continue

        collect = False
        inside: List[str] = []
        for el in ps.iter():
            if el is cs:
                collect = True
                continue
            if el is ce:
                collect = False
                break
            if collect and el.tag == _W + "t":
                inside.append(el.text or "")
        span_text = _norm("".join(inside))

        # Only shrink when the range covers the whole paragraph. A one-char
        # tolerance handles occasional trailing whitespace / paragraph mark.
        if span_text != full_text and abs(len(span_text) - len(full_text)) > 1:
            continue

        # Move the end to sit immediately after the start (zero-length range).
        parent = cs.getparent()
        if parent is None:
            continue
        if ce.getparent() is not None:
            ce.getparent().remove(ce)
        start_idx = list(parent).index(cs)
        parent.insert(start_idx + 1, ce)
        shrunk += 1

    return shrunk


def _strip_reference_run_fake_hyperlinks(root) -> int:
    """Strip direct `<w:u>` and hyperlink-blue `<w:color>` from runs that
    represent reference/citation content — matches the golden DOCX shape.

    Two categories of runs are cleaned:

    1. Every run inside a paragraph whose `pStyle` is a known reference style
       (REF-U / REF-N / Bibliography). Separator runs (", "), page-number
       runs, DOIs, etc. all live in these paragraphs and shouldn't look like
       hyperlinks.
    2. Every run whose character style is a `bib_*` / `cite_*` style, wherever
       it lives. Body-text citations (`citebib`) fall here — Word's Hyperlink
       character style still auto-applies when the run sits inside a real
       `<w:hyperlink>` wrapper, so this cleanup is visually a no-op for
       genuinely clickable citations while removing the hard-coded styling
       from citations that were stamped by editor round-trips.

    Other rPr children (`rStyle`, `highlight`, bold, italic, fonts…) are
    preserved. Idempotent.
    """
    stripped = 0

    def _clean_run(r) -> bool:
        rPr = r.find(_W + "rPr")
        if rPr is None:
            return False
        changed = False
        u = rPr.find(_W + "u")
        if u is not None:
            rPr.remove(u)
            changed = True
        color = rPr.find(_W + "color")
        if color is not None:
            cv = (color.get(_W + "val") or "").upper()
            if cv in _HYPERLINK_BLUE_HEXES:
                rPr.remove(color)
                changed = True
        return changed

    def _rstyle_of(r) -> str:
        rPr = r.find(_W + "rPr")
        if rPr is None:
            return ""
        rst = rPr.find(_W + "rStyle")
        return (rst.get(_W + "val") if rst is not None else "") or ""

    for p in root.iter(_W + "p"):
        pPr = p.find(_W + "pPr")
        pStyle = pPr.find(_W + "pStyle") if pPr is not None else None
        style_val = (pStyle.get(_W + "val") or "") if pStyle is not None else ""
        para_is_ref = style_val in _REF_PARA_STYLES

        for r in p.iter(_W + "r"):
            rstyle = _rstyle_of(r).lower()
            run_is_bib_cite = (
                rstyle.startswith("bib_")
                or rstyle.startswith("cite_")
                or rstyle in {"bibsurname", "bibfname", "bibyear", "bibtitle",
                              "bibjournal", "bibvolume", "bibissue", "bibfpage",
                              "biblpage", "bibdoi", "bibpublisher", "biborganization",
                              "bibbook", "bibeditionno", "biburl", "bibchaptertitle",
                              "bibinstitution", "bibarticle", "citebib"}
            )
            if not (para_is_ref or run_is_bib_cite):
                continue
            if _clean_run(r):
                stripped += 1
    return stripped


def finalize_docx_for_export(docx_path: str) -> Dict[str, int]:
    """Post-process a DOCX to strip editor round-trip artefacts before it is
    handed to the user.

    * Removes `r_bm_*`, `p_bm_*`, `tbl_bm_*`, `cell_bm_*`, `fnpara_bm_*`,
      `enpara_bm_*` bookmarks (editor internal tracking anchors).
    * Renames `REF{n}` → `ref_{n}` so the delivered file matches the PPH
      reference-bookmark scheme (`ref_N` on entries, `bib_N` on citations).
    * Wraps each `bib_N` citation in a `<w:hyperlink w:anchor="ref_N"/>` so
      clicking the citation in Word jumps to the reference entry.
    * Applies green highlight to matched citations (runs inside a `bib_N`)
      and yellow to unmatched `citebib`-styled runs (no matching reference).
    * Deduplicates comments that appear twice on the same paragraph with the
      same author + text.

    Returns counts for logging; a no-op call rewrites nothing.
    """
    import zipfile
    from lxml import etree

    path = Path(docx_path)
    if not path.exists():
        return {
            "tracking_bookmarks_removed": 0,
            "ref_bookmarks_renamed": 0,
            "duplicate_comments_removed": 0,
            "citation_hyperlinks_wrapped": 0,
            "citation_highlights_added": 0,
            "reference_run_fake_links_cleaned": 0,
            "paragraph_wide_comment_ranges_shrunk": 0,
        }

    with zipfile.ZipFile(path, "r") as z:
        doc_xml = z.read("word/document.xml")
        try:
            comments_xml = z.read("word/comments.xml")
        except KeyError:
            comments_xml = None
        names = z.namelist()

    root = etree.fromstring(doc_xml)
    comments_root = etree.fromstring(comments_xml) if comments_xml else None

    removed_bm = _strip_editor_tracking_bookmarks(root)
    renamed = _rename_ref_uppercase_bookmarks(root)
    orphaned_starts_repaired = _repair_orphan_bookmark_starts(root)
    removed_c = _dedupe_comments(root, comments_root)
    wrapped_hl = _wrap_bib_citations_with_hyperlinks(root)
    highlighted = _apply_citation_highlights(root)
    ref_runs_cleaned = _strip_reference_run_fake_hyperlinks(root)
    comment_ranges_shrunk = _shrink_paragraph_wide_comment_ranges(root)

    stats = {
        "tracking_bookmarks_removed": removed_bm,
        "ref_bookmarks_renamed": renamed,
        "orphan_bookmark_ends_added": orphaned_starts_repaired,
        "duplicate_comments_removed": removed_c,
        "citation_hyperlinks_wrapped": wrapped_hl,
        "citation_highlights_added": highlighted,
        "reference_run_fake_links_cleaned": ref_runs_cleaned,
        "paragraph_wide_comment_ranges_shrunk": comment_ranges_shrunk,
    }

    if not any(stats.values()):
        return stats

    new_doc = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    new_comments = (
        etree.tostring(comments_root, xml_declaration=True, encoding="UTF-8", standalone=True)
        if comments_root is not None else None
    )

    tmp = path.with_suffix(path.suffix + ".finalize-tmp")
    with zipfile.ZipFile(path, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            if item.filename == "word/document.xml":
                zout.writestr(item, new_doc)
            elif item.filename == "word/comments.xml" and new_comments is not None:
                zout.writestr(item, new_comments)
            else:
                zout.writestr(item, zin.read(item.filename))
    tmp.replace(path)

    logger.info("Finalized %s: %s", path.name, stats)
    return stats


# ─── Main entry point ───────────────────────────────────────────────────────


def apply_reference_workflow(
    docx_path: str,
    validation_logs: Optional[Dict[str, Any]] = None,
    *,
    author: str = "Reference Validator",
) -> Dict[str, int]:
    """Apply the citation/reference AQ workflow to `docx_path` in place.

    Args:
        docx_path: Path to the DOCX to finalize (will be modified in place).
        validation_logs: Optional pre-computed validation logs (as returned by
            `_run_validation_on_doc`). If not provided, the validator is run
            fresh against the DOCX.
        author: Word comment author string for the inserted AQ comments.

    Returns:
        A summary dict with counts (missing_citation_aqs, unused_reference_aqs,
        multi_citation_splits, skipped_duplicate_aqs).
    """
    if not Path(docx_path).exists():
        raise RuntimeError(f"DOCX not found for citation finalization: {docx_path}")

    if validation_logs is None:
        validation_logs = _run_validator(docx_path)

    citation_pairs: Sequence[Dict[str, Any]] = validation_logs.get("citation_pairs") or []
    reference_entries: Sequence[Dict[str, Any]] = validation_logs.get("reference_entries") or []

    doc = Document(docx_path)
    paras = _body_paragraphs(doc)
    n_paras = len(paras)

    summary = {
        "missing_citation_aqs": 0,
        "unused_reference_aqs": 0,
        "multi_citation_splits": 0,
        "skipped_duplicate_aqs": 0,
    }

    # 1) AQ for citations that are in the text but have no matching reference.
    for pair in citation_pairs:
        status = (pair.get("status") or "").lower()
        if status != "missing":
            continue
        para_idx = pair.get("para_idx", -1)
        if not (0 <= para_idx < n_paras):
            continue
        para = paras[para_idx]

        # Handle multi-citation blocks per-work.
        raw_citation = (pair.get("citation") or pair.get("raw") or "").strip()
        segments = split_citation_block(raw_citation) if raw_citation else []
        if len(segments) > 1:
            summary["multi_citation_splits"] += 1
        elif not segments:
            segments = [raw_citation] if raw_citation else []

        for seg in segments:
            aq = AQ_MISSING_CITATION_TEMPLATE.format(citation=seg)
            anchor = _find_citation_anchor_runs(para, seg)
            added = _add_aq_comment(doc, para, aq, author=author, anchor_runs=anchor)
            if added:
                summary["missing_citation_aqs"] += 1
            else:
                summary["skipped_duplicate_aqs"] += 1

    # 2) AQ for references that are in the list but never cited in the text.
    for entry in reference_entries:
        if entry.get("is_cited"):
            continue
        para_idx = entry.get("para_idx", -1)
        if not (0 <= para_idx < n_paras):
            continue
        para = paras[para_idx]
        ref_text = (entry.get("text") or "").strip()
        if not ref_text:
            continue
        aq = AQ_UNUSED_REFERENCE_TEMPLATE.format(reference=ref_text)
        anchor = _find_reference_anchor_runs(para)
        added = _add_aq_comment(doc, para, aq, author=author, anchor_runs=anchor)
        if added:
            summary["unused_reference_aqs"] += 1
        else:
            summary["skipped_duplicate_aqs"] += 1

    if any(summary[k] for k in ("missing_citation_aqs", "unused_reference_aqs")):
        doc.save(docx_path)
        logger.info(
            "Reference workflow applied to %s: %s",
            docx_path, summary,
        )
    else:
        logger.info(
            "Reference workflow: no AQ comments to add for %s (summary=%s)",
            docx_path, summary,
        )

    # Strip editor round-trip artefacts and normalise bookmark naming for the
    # delivered file. Runs even when no AQs were added — a re-export of a
    # previously-exported file might still carry tracking bookmarks or
    # `REF{n}` names from a stampBookmarks pass.
    try:
        finalize_stats = finalize_docx_for_export(docx_path)
        summary.update(finalize_stats)
    except Exception as e:
        logger.warning("finalize_docx_for_export failed on %s: %s", docx_path, e, exc_info=True)

    return summary


def _run_validator(docx_path: str) -> Dict[str, Any]:
    """Detect style (AMA vs APA) and return validation_logs.

    We deliberately avoid importing from `app.domains.review.service` to keep
    this module usable from Celery tasks and one-off scripts without dragging
    in the whole HTTP layer. Style detection mirrors the logic in
    `_run_validation_on_doc`.
    """
    doc = Document(docx_path)
    is_ama = False
    is_apa = False
    for para in doc.paragraphs:
        name = (para.style.name if para.style else "") or ""
        if name.startswith("REF-N"):
            is_ama = True
        if name.startswith("REF-U") or name.startswith("ref-open") or name == "REF-U":
            is_apa = True
        for r in para.runs:
            if getattr(r, "text", None) and "<ref-open>" in r.text.lower():
                is_apa = True

    if is_ama and not is_apa:
        style = "AMA"
    else:
        style = "APA"  # default when both / neither — matches _run_validation_on_doc

    logs: Dict[str, Any] = {
        "citation_pairs": [],
        "reference_entries": [],
        "detected_style": style,
    }

    if style == "AMA":
        try:
            from app.processing.legacy.Referencenumvalidation import ReferenceProcessor
        except Exception as e:
            logger.warning("Could not import ReferenceProcessor for AMA path: %s", e)
            return logs
        try:
            proc = ReferenceProcessor(docx_path)
            proc.run()
            # ReferenceProcessor stores results on itself; harvest into the
            # same shape as _run_validation_on_doc would.
            _harvest_ama_results(proc, doc, logs)
        except Exception as e:
            logger.warning("AMA validation failed on %s: %s", docx_path, e, exc_info=True)
    else:
        try:
            from app.processing.legacy.validation_core import CitationProcessor
        except Exception as e:
            logger.warning("Could not import CitationProcessor for APA path: %s", e)
            return logs
        try:
            cite_proc = CitationProcessor(docx_path)
            cite_proc.run()
            _harvest_apa_results(cite_proc, logs)
        except Exception as e:
            logger.warning("APA validation failed on %s: %s", docx_path, e, exc_info=True)

    return logs


def _harvest_ama_results(proc, doc, logs: Dict[str, Any]) -> None:
    """Extract citation_pairs / reference_entries from an AMA ReferenceProcessor."""
    para_index_map: Dict[Any, int] = {p._element: i for i, p in enumerate(doc.paragraphs)}

    appearance_order = getattr(proc, "appearance_order", []) or []
    references = getattr(proc, "references", {}) or {}
    citation_pairs: List[Dict[str, Any]] = []
    for cite in appearance_order:
        num = cite.get("number") if isinstance(cite, dict) else None
        if num is None:
            continue
        ref = references.get(num) or {}
        ref_text = ref.get("text") or ref.get("raw") or ""
        status = "ok" if ref else "missing"
        citation_pairs.append({
            "citation": f"[{num}]",
            "ref_number": num,
            "ref_text": ref_text,
            "status": status,
            "para_idx": cite.get("para_idx", -1),
        })

    reference_entries: List[Dict[str, Any]] = []
    cited_numbers = {c.get("number") for c in appearance_order if isinstance(c, dict)}
    for num, ref in references.items():
        text = ref.get("text") or ref.get("raw") or ""
        para = ref.get("para")
        para_idx = para_index_map.get(getattr(para, "_element", None), -1) if para is not None else ref.get("para_idx", -1)
        reference_entries.append({
            "number": num,
            "text": text,
            "style": "REF-N",
            "is_cited": num in cited_numbers,
            "para_idx": para_idx,
        })

    logs["citation_pairs"] = citation_pairs
    logs["reference_entries"] = reference_entries


def _harvest_apa_results(cite_proc, logs: Dict[str, Any]) -> None:
    """Extract citation_pairs / reference_entries from an APA CitationProcessor."""
    bib_items = list(getattr(cite_proc, "_bib_ordered", []) or cite_proc.bibliography.values())

    citation_pairs: List[Dict[str, Any]] = []
    for entry in bib_items:
        status = "ok" if entry.get("cited") else "unused"
        raw_cite = f"({entry.get('display', '')}, {entry.get('year', '')})"
        citation_pairs.append({
            "citation": raw_cite,
            "author": entry.get("display", ""),
            "year": entry.get("year", ""),
            "ref_text": entry.get("raw", ""),
            "status": status,
            "para_idx": entry.get("para_idx", -1),
        })

    for issue in getattr(cite_proc, "issues", []) or []:
        if issue.get("type") == "missing":
            citation_pairs.append({
                "citation": issue.get("raw", issue.get("citation", "")),
                "author": "",
                "year": "",
                "ref_text": "",
                "status": "missing",
                "para_idx": issue.get("para_idx", -1),
            })

    reference_entries: List[Dict[str, Any]] = []
    for entry in bib_items:
        reference_entries.append({
            "number": None,
            "text": entry.get("raw", ""),
            "style": "REF-U",
            "is_cited": entry.get("cited", False),
            "para_idx": entry.get("para_idx", -1),
        })

    logs["citation_pairs"] = citation_pairs
    logs["reference_entries"] = reference_entries
