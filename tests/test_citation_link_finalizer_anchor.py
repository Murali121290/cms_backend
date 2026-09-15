"""Locks in the AQ comment-range anchor placement produced by
`citation_link_finalizer._anchor_comment_ranges_to_citation`.

The bug this guards against: earlier revisions of the finalizer produced
paragraph-wide (or zero-length) `<w:commentRangeStart>` / `<w:commentRangeEnd>`
pairs, so Word visually attached every AQ comment to the whole paragraph. The
anchor pass rewrites the range so it wraps the citation text runs — this test
builds a minimal DOCX with the offending shapes (paragraph-wide, zero-length,
citation split across multiple runs, citation embedded inside a larger
narrative run) and asserts each range span ends up wrapping only the
citation.
"""

from __future__ import annotations

import io
import re
import zipfile

import pytest
from docx import Document

from app.processing.citation_link_finalizer import (
    _anchor_comment_ranges_to_citation,
    _extract_aq_target,
    _find_citation_runs_by_text,
    _locate_citation_in_text,
    _tighten_citation_runs,
)


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _aq_missing(citation: str) -> str:
    return (
        f'AQ: The reference "{citation}" is cited in the text but not given '
        "in the list. Please provide complete publication details of this "
        "reference in the list or delete the citation from the text."
    )


def _span_text_between(doc_xml: str, cid: str) -> str:
    """Return the plain text sitting between commentRangeStart and
    commentRangeEnd for `cid`."""
    sm = re.search(rf'<w:commentRangeStart[^>/]*w:id="{cid}"[^>/]*/>', doc_xml)
    em = re.search(rf'<w:commentRangeEnd[^>/]*w:id="{cid}"[^>/]*/>', doc_xml)
    assert sm and em, f"range markers missing for id={cid}"
    span_xml = doc_xml[sm.end() : em.start()]
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", span_xml))


def _yellow_count(doc_xml: str) -> int:
    return doc_xml.count('<w:highlight w:val="yellow"/>')


def test_locate_citation_flexible_punctuation():
    # Paragraph carries `(Name, Year)`; AQ body carries `Name (Year)`.
    para = "some text (Smith, 2020) here"
    loc = _locate_citation_in_text(para, "Smith (2020)")
    assert loc is not None
    start, end = loc
    assert para[start:end] == "(Smith, 2020)"


def test_extract_aq_target_handles_missing_opening_quote():
    body = 'AQ: The reference Education for All Handicapped Children Act (1975)” is cited in the text but not given in the list.'
    kind, targets = _extract_aq_target(body)
    assert kind == "missing"
    assert targets == ["Education for All Handicapped Children Act (1975)"]


def _build_docx_with_paragraph_wide_range() -> bytes:
    """Build a DOCX whose only paragraph carries a paragraph-wide AQ comment
    range spanning ``80% of diagnoses (International Dyslexia Association,
    2020).`` — the shape the older AQ path used to emit."""
    doc = Document()
    p = doc.add_paragraph()
    p.add_run("80% of diagnoses ")
    p.add_run("(")
    p.add_run("International Dyslexia Association, ")
    p.add_run("2020")
    p.add_run(")")
    p.add_run(".")

    # Attach a raw paragraph-wide comment range via python-docx's add_comment.
    doc.add_comment(
        runs=[p.runs[0], p.runs[-1]],
        text=_aq_missing("International Dyslexia Association (2020)"),
        author="Reference Validator",
    )

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _run_anchor_pass(docx_bytes: bytes) -> str:
    """Round-trip `docx_bytes` through `_anchor_comment_ranges_to_citation`
    and return the rewritten document.xml as a string."""
    from lxml import etree

    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as z:
        doc_xml = z.read("word/document.xml")
        comm_xml = z.read("word/comments.xml")
    root = etree.fromstring(doc_xml)
    comments_root = etree.fromstring(comm_xml)
    _anchor_comment_ranges_to_citation(root, comments_root)
    return etree.tostring(root, encoding="unicode")


def test_paragraph_wide_range_shrinks_to_citation_runs():
    docx = _build_docx_with_paragraph_wide_range()
    new_doc_xml = _run_anchor_pass(docx)
    # Comment id is 0 (python-docx starts at 0 for new comments).
    span = _span_text_between(new_doc_xml, "0")
    assert span == "(International Dyslexia Association, 2020)", (
        f"expected the range to wrap only the citation; got {span!r}"
    )
    # And the citation runs should now carry a yellow highlight.
    assert _yellow_count(new_doc_xml) >= 1


def test_citation_embedded_in_narrative_run_gets_split():
    """When a single run holds ``... watershed came with the Education for
    All Handicapped Children Act (1975). More text...`` the anchor pass
    should split that run so only the citation text ends up between the
    range markers."""
    doc = Document()
    p = doc.add_paragraph()
    p.add_run(
        "A watershed came with the Education for All Handicapped Children "
        "Act (1975). More text continues after."
    )
    doc.add_comment(
        runs=p.runs[0],
        text=_aq_missing("Education for All Handicapped Children Act (1975)"),
        author="Reference Validator",
    )
    buf = io.BytesIO()
    doc.save(buf)
    new_doc_xml = _run_anchor_pass(buf.getvalue())
    span = _span_text_between(new_doc_xml, "0")
    assert span == "Education for All Handicapped Children Act (1975)", (
        f"expected the range to wrap only the citation; got {span!r}"
    )


def test_comment_reference_marker_follows_the_range_end():
    """Word paints the "comment selected" blue band from the
    `<w:commentReference/>` inline marker back to `<w:commentRangeStart>`.
    So if the reference marker is stranded at the end of the paragraph
    (typical S4C output) while the range end sits earlier at the citation,
    every character in between gets blue-highlighted — the tail of the
    paragraph.
    The anchor pass must pull the reference marker so it sits right after
    `<w:commentRangeEnd>` with no text between them.
    """
    from lxml import etree

    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

    doc = Document()
    p = doc.add_paragraph()
    p.add_run("Aligned with ")
    p.add_run("(CACREP) (2024)")
    p.add_run(" standards. Case Study 9.1 illustrates ...")

    # Add the comment; python-docx places the reference at the end of the
    # paragraph by default when we hand it the first run as anchor.
    doc.add_comment(
        runs=p.runs[0],
        text=_aq_missing("(CACREP) (2024)"),
        author="S4C",
    )
    # Also relocate the reference marker to the end of the paragraph so the
    # test mirrors the broken shape the S4C pipeline emits.
    ref_run = None
    for r in p._element.iter(W + "r"):
        for cr in r.findall(W + "commentReference"):
            if cr.get(W + "id") == "0":
                ref_run = r
                break
        if ref_run is not None:
            break
    assert ref_run is not None
    ref_run.getparent().remove(ref_run)
    p._element.append(ref_run)

    buf = io.BytesIO()
    doc.save(buf)
    new_doc_xml = _run_anchor_pass(buf.getvalue())

    # Locate the three markers for id=0 and check ordering / gap.
    m_start = re.search(r'<w:commentRangeStart[^>/]*w:id="0"[^>/]*/>', new_doc_xml)
    m_end = re.search(r'<w:commentRangeEnd[^>/]*w:id="0"[^>/]*/>', new_doc_xml)
    m_ref = re.search(r'<w:commentReference[^>/]*w:id="0"[^>/]*/>', new_doc_xml)
    assert m_start and m_end and m_ref
    assert m_start.start() < m_end.start() < m_ref.start()

    # No content text between end marker and reference marker.
    between = new_doc_xml[m_end.end():m_ref.start()]
    between_text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", between))
    assert between_text == "", (
        f"reference marker still stranded; text between end and ref = {between_text!r}"
    )


def test_range_spanning_two_paragraphs_gets_pulled_back_to_citation_paragraph():
    """S4C's editor pipeline sometimes emits a range whose end sits in the
    NEXT paragraph (an artefact of splitting the paragraph after the range
    was inserted). Word then visually highlights both paragraphs. The anchor
    pass must find the citation in the start paragraph and drag the end
    marker back so both markers sit in the citation paragraph.
    """
    from lxml import etree

    doc = Document()
    p1 = doc.add_paragraph()
    p1.add_run("This chapter is aligned with CACREP standards ")
    p1.add_run("(CACREP)")
    p1.add_run(" (2024)")
    p1.add_run(".")
    p2 = doc.add_paragraph()
    p2.add_run("Case Study 9.1 illustrates interdisciplinary collaboration.")

    # Manually place range markers so that start is in p1 (before the CACREP
    # citation) and end is at the end of p2 — the exact broken shape the
    # ticket screenshot shows.
    W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    doc.add_comment(
        runs=p1.runs[0],
        text=_aq_missing("(CACREP) (2024)"),
        author="S4C",
    )
    # Move the end marker from p1 into p2.
    end_el = None
    for el in p1._element.iter(W + "commentRangeEnd"):
        if el.get(W + "id") == "0":
            end_el = el
            break
    assert end_el is not None
    end_el.getparent().remove(end_el)
    p2._element.append(end_el)

    buf = io.BytesIO()
    doc.save(buf)
    new_doc_xml = _run_anchor_pass(buf.getvalue())
    span = _span_text_between(new_doc_xml, "0")
    assert "Case Study" not in span, (
        f"range still spans into next paragraph; span={span!r}"
    )
    # The span should now be just the CACREP citation.
    assert "CACREP" in span
    assert "2024" in span


def test_year_mismatch_aq_anchors_on_the_updated_citation():
    """Year-mismatch AQ (`"Name, 2021" has been changed to "Name, n.d."`) is
    neither missing nor unused, but it still names the citation(s) it's
    about. The anchor pass must find the citation actually present in the
    paragraph (typically the new one after auto-correction) and pull the
    range down onto it, rather than leaving the paragraph-wide range from
    the S4C editor.
    """
    doc = Document()
    p = doc.add_paragraph()
    p.add_run("Some earlier narrative. ")
    p.add_run("(U.S. Department of Education, n.d.)")
    p.add_run(".")

    body = (
        'AQ: Note that the citation of reference "U.S. Department of '
        'Education, 2021" has been changed to "U.S. Department of '
        'Education, n.d." to match with the reference list. Please confirm.'
    )
    doc.add_comment(
        runs=[p.runs[0], p.runs[-1]],
        text=body,
        author="S4C",
    )
    buf = io.BytesIO()
    doc.save(buf)
    new_doc_xml = _run_anchor_pass(buf.getvalue())
    span = _span_text_between(new_doc_xml, "0")
    assert span == "(U.S. Department of Education, n.d.)", (
        f"expected the range to wrap only the corrected citation; got {span!r}"
    )
    # Reference marker must sit right after range end.
    m_end = re.search(r'<w:commentRangeEnd[^>/]*w:id="0"[^>/]*/>', new_doc_xml)
    m_ref = re.search(r'<w:commentReference[^>/]*w:id="0"[^>/]*/>', new_doc_xml)
    assert m_end and m_ref
    between = new_doc_xml[m_end.end():m_ref.start()]
    between_text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", between))
    assert between_text == ""


def test_extract_aq_target_returns_all_quoted_citations():
    body = (
        'AQ: Note that the citation of reference "X, 2021" has been changed '
        'to "X, n.d." to match with the reference list. Please confirm.'
    )
    kind, targets = _extract_aq_target(body)
    assert kind == "citation"
    assert targets == ["X, 2021", "X, n.d."]


def test_extract_aq_target_ignores_non_aq_comments():
    """A stray reviewer comment with a quoted phrase isn't an AQ — the
    anchor pass must leave it alone rather than relocating its range."""
    body = 'Please add "an example" to this section.'
    assert _extract_aq_target(body) is None


def test_multiple_citations_one_missing_anchors_only_the_missing_one():
    """Paragraph with two citations, only one flagged. The AQ range must
    wrap only the flagged citation, not both."""
    doc = Document()
    p = doc.add_paragraph()
    p.add_run("Prior work ")
    p.add_run("(Smith, 2019)")
    p.add_run(" and ")
    p.add_run("(Jones, 2021)")
    p.add_run(" agree.")
    # Attach AQ only for Jones (2021). Anchor the raw comment to the whole
    # paragraph (range covers everything) so the anchor pass has to move it.
    doc.add_comment(
        runs=[p.runs[0], p.runs[-1]],
        text=_aq_missing("Jones (2021)"),
        author="Reference Validator",
    )
    buf = io.BytesIO()
    doc.save(buf)
    new_doc_xml = _run_anchor_pass(buf.getvalue())
    span = _span_text_between(new_doc_xml, "0")
    assert span == "(Jones, 2021)", f"got {span!r}"
    # Smith should not have been highlighted or wrapped.
    assert "Smith" not in span
