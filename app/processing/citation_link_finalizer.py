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


def _paragraph_has_comment_text(para, text: str) -> bool:
    """True if the paragraph already carries a Word comment with `text`.

    Comments live in a separate part (`word/comments.xml`), so we walk the
    paragraph for a `<w:commentReference>` and look each id up in the parent
    document's comment map. This is what makes the finalizer safe to call
    repeatedly.
    """
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
        return False

    try:
        from lxml import etree
        comments_root = etree.fromstring(part.blob)
    except Exception:
        return False

    text_by_id: Dict[str, str] = {}
    for cmt in comments_root.findall(qn("w:comment")):
        cid = cmt.get(qn("w:id"))
        if cid is None:
            continue
        # Concatenate every text node inside the comment.
        body = "".join((t.text or "") for t in cmt.iter(qn("w:t"))).strip()
        text_by_id[cid] = body

    p_el = para._element
    for ref in p_el.iter(qn("w:commentReference")):
        cid = ref.get(qn("w:id"))
        if cid is None:
            continue
        if text_by_id.get(cid, "").strip() == text.strip():
            return True
    return False


def _add_aq_comment(doc, para, text: str, author: str = "Reference Validator") -> bool:
    """Add an AQ comment to `para` unless the same text is already there."""
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
