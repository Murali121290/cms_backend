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


def _add_aq_comment(doc, para, text: str, author: str = "Reference Validator") -> bool:
    """Add an AQ comment to `para` unless an equivalent AQ is already there."""
    if _paragraph_has_comment_text(para, text):
        return False
    from app.docx_pipeline.utils.docx_helpers import add_comment_to_paragraph
    add_comment_to_paragraph(doc, para, text=text, author=author)
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
    the bookmark id and any nested content."""
    renamed = 0
    existing_names = {
        (bs.get(_W + "name") or "") for bs in root.iter(_W + "bookmarkStart")
    }
    for bs in root.iter(_W + "bookmarkStart"):
        name = bs.get(_W + "name") or ""
        m = _REF_UPPER_RE.match(name)
        if not m:
            continue
        new_name = f"ref_{m.group(1)}"
        if new_name in existing_names and new_name != name:
            # Someone else already owns the target name — drop this REF{n} so
            # we don't create a duplicate. The bookmarkEnd matched by id will
            # be cleaned up by the tracking-bookmark pass if it has no start.
            continue
        bs.set(_W + "name", new_name)
        existing_names.add(new_name)
        renamed += 1
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


def finalize_docx_for_export(docx_path: str) -> Dict[str, int]:
    """Post-process a DOCX to strip editor round-trip artefacts before it is
    handed to the user.

    * Removes `r_bm_*`, `p_bm_*`, `tbl_bm_*`, `cell_bm_*`, `fnpara_bm_*`,
      `enpara_bm_*` bookmarks (editor internal tracking anchors).
    * Renames `REF{n}` → `ref_{n}` so the delivered file matches the PPH
      reference-bookmark scheme (`ref_N` on entries, `bib_N` on citations).
    * Deduplicates comments that appear twice on the same paragraph with the
      same author + text.

    Returns counts for logging; a no-op call rewrites nothing.
    """
    import zipfile
    from lxml import etree

    path = Path(docx_path)
    if not path.exists():
        return {"tracking_bookmarks_removed": 0, "ref_bookmarks_renamed": 0, "duplicate_comments_removed": 0}

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

    stats = {
        "tracking_bookmarks_removed": removed_bm,
        "ref_bookmarks_renamed": renamed,
        "orphan_bookmark_ends_added": orphaned_starts_repaired,
        "duplicate_comments_removed": removed_c,
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
            added = _add_aq_comment(doc, para, aq, author=author)
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
        added = _add_aq_comment(doc, para, aq, author=author)
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
