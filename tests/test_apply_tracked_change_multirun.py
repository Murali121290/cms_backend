"""Multi-run DOCX tracked-change tests for Phase 4.

`paragraph.text` in python-docx concatenates only direct ``w:r`` children of
``w:p`` and ignores ``w:r`` elements nested inside ``w:ins`` / ``w:del`` —
i.e. it returns the "clean" author view *with tracked changes stripped*,
not the Word-accepted view. These tests therefore assert on:

  * the paragraph's surviving plain text  (= pre + post, no revision bodies)
  * the w:del content  (what Word shows struck through)
  * the w:ins content  (what Word adds on acceptance)
  * run-level ``w:rPr`` preservation across every deleted fragment

Coverage:
  * single-run (regression — pre-Phase-4 behaviour unchanged)
  * two-run span (hyphen on boundary) with distinct formatting per run
  * three-run span (first + middle + last)
  * empty replacement (pure delete)
  * two edits in one paragraph applied right-to-left as the export does
"""
from __future__ import annotations

from io import BytesIO
import pytest

docx = pytest.importorskip("docx")
from docx import Document
from docx.oxml.ns import qn

from app.processing.language_editing.docx_io import apply_tracked_change


# ─── helpers ─────────────────────────────────────────────────────────────

def _save_reopen(doc):
    """Save to an in-memory buffer and re-open to force a full lxml round-trip.
    Catches any case where our mutations only live in the Python object but
    don't survive serialisation."""
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return Document(buf)


def _paragraph_with_runs(doc, *fragments):
    """Build a paragraph where each `fragments[i]` is a (text, bold?) tuple.
    Bold stands in for any run-level formatting; we just need distinguishable
    rPr across runs."""
    p = doc.add_paragraph()
    for text, bold in fragments:
        r = p.add_run(text)
        if bold:
            r.bold = True
    return p


def _dels_inses(paragraph):
    body = paragraph._p
    return (body.findall(qn("w:del")), body.findall(qn("w:ins")))


def _text_in(el, tag):
    """Concatenate text content of every ``<tag>`` descendant under ``el``."""
    bits = []
    for t in el.iter(qn(tag)):
        bits.append(t.text or "")
    return "".join(bits)


def _is_bold_run(r):
    rPr = r.find(qn("w:rPr"))
    return rPr is not None and rPr.find(qn("w:b")) is not None


# ─── single-run (regression) ────────────────────────────────────────────

def test_single_run_change_preserves_pre_and_post():
    doc = Document()
    p = _paragraph_with_runs(doc, ("acid base balance was off.", False))
    apply_tracked_change(p, 0, 17, "acid-base balance")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # Surviving plain text = pre_first + post_last. pre is empty, post is " was off.".
    assert p2.text == " was off."
    dels, inses = _dels_inses(p2)
    assert len(dels) == 1 and len(inses) == 1
    assert _text_in(dels[0], "w:delText") == "acid base balance"
    assert _text_in(inses[0], "w:t") == "acid-base balance"


def test_single_run_leaves_prefix_and_suffix_intact():
    doc = Document()
    p = _paragraph_with_runs(doc, ("Hello world of health-care is bright.", False))
    apply_tracked_change(p, 15, 26, "health care")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # pre = "Hello world of ", post = " is bright."
    assert p2.text == "Hello world of  is bright."
    dels, inses = _dels_inses(p2)
    assert _text_in(dels[0], "w:delText") == "health-care"
    assert _text_in(inses[0], "w:t") == "health care"


# ─── two-run span (hyphen on boundary) ──────────────────────────────────

def test_span_crossing_two_runs_preserves_each_runs_rPr():
    """Compound "age related" where "age" is bold and " related" is plain.
    After replacement with "age-related":
      - w:del contains TWO w:r fragments: bold "age" + plain " related"
      - w:ins contains ONE w:r with the first-run (bold) rPr"""
    doc = Document()
    p = _paragraph_with_runs(doc, ("age", True), (" related complication.", False))
    assert p.text == "age related complication."

    apply_tracked_change(p, 0, 11, "age-related")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # Surviving plain text = "" + " complication." (pre_first empty, post_last after offset 11).
    assert p2.text == " complication."

    dels, inses = _dels_inses(p2)
    assert len(dels) == 1 and len(inses) == 1

    deleted_fragments = dels[0].findall(qn("w:r"))
    assert len(deleted_fragments) == 2
    # First fragment: "age" with bold rPr. Second: " related" without bold.
    assert deleted_fragments[0].find(qn("w:delText")).text == "age"
    assert _is_bold_run(deleted_fragments[0])
    assert deleted_fragments[1].find(qn("w:delText")).text == " related"
    assert not _is_bold_run(deleted_fragments[1])

    ins_runs = inses[0].findall(qn("w:r"))
    assert len(ins_runs) == 1
    assert ins_runs[0].find(qn("w:t")).text == "age-related"
    # Insertion carries the first run's rPr (bold).
    assert _is_bold_run(ins_runs[0])


# ─── three-run span ─────────────────────────────────────────────────────

def test_span_crossing_three_runs_captures_middle_fragment():
    doc = Document()
    r_plain1 = "She said "
    r_middle = "post COVID"
    r_plain2 = " recovery is slow."
    p = _paragraph_with_runs(
        doc, (r_plain1, False), (r_middle, True), (r_plain2, False),
    )
    full = p.text
    assert full == "She said post COVID recovery is slow."

    start = full.index("said")                 # 4
    end = full.index(" is slow.")               # 28
    apply_tracked_change(p, start, end, "said long COVID recovery")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # pre = "She ", post = " is slow."
    assert p2.text == "She  is slow."

    dels, inses = _dels_inses(p2)
    assert len(dels) == 1 and len(inses) == 1
    fragments = dels[0].findall(qn("w:r"))
    # First-run tail "said ", middle full "post COVID", last-run head " recovery".
    assert len(fragments) == 3
    assert fragments[0].find(qn("w:delText")).text == "said "
    assert fragments[1].find(qn("w:delText")).text == "post COVID"
    assert fragments[2].find(qn("w:delText")).text == " recovery"
    # Middle fragment keeps its own bold rPr.
    assert _is_bold_run(fragments[1])


# ─── empty replacement ──────────────────────────────────────────────────

def test_empty_replacement_only_emits_del():
    """Pure-delete must emit w:del and NO w:ins — matches Word's behaviour
    for a deletion with no replacement (e.g. the C01 soft-hyphen rule)."""
    doc = Document()
    p = _paragraph_with_runs(doc, ("Hello­world!", False))  # soft hyphen (U+00AD)
    apply_tracked_change(p, 5, 6, "")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # pre = "Hello", post = "world!" — soft hyphen moved into w:del.
    assert p2.text == "Helloworld!"
    dels, inses = _dels_inses(p2)
    assert len(dels) == 1 and len(inses) == 0
    assert _text_in(dels[0], "w:delText") == "­"


# ─── two edits in one paragraph, descending-offset (export order) ──────

def test_two_edits_descending_offset_in_one_paragraph():
    """The export loop sorts findings by ORDER BY start_offset DESC and
    applies in that order so earlier offsets stay valid. Two edits in one
    paragraph must both land correctly and leave the paragraph coherent."""
    doc = Document()
    text = "The age related acid base balance was off."
    p = _paragraph_with_runs(doc, (text, False))

    # Finding B at [16, 33]: "acid base balance" → "acid-base balance"
    # Finding A at [4, 15]:  "age related"       → "age-related"
    apply_tracked_change(p, 16, 33, "acid-base balance")
    apply_tracked_change(p, 4, 15, "age-related")

    doc2 = _save_reopen(doc)
    p2 = doc2.paragraphs[0]
    # Surviving plain text (w:ins/w:del stripped): the pre + untouched
    # middle (the single space at offset 15) + the single space at offset 33
    # + " was off." tail. Deletions are at [4, 15] and [16, 33], so what
    # remains is: "The " + " " + " was off." → "The   was off."
    assert p2.text == "The   was off."
    dels, inses = _dels_inses(p2)
    assert len(dels) == 2 and len(inses) == 2
    # Order of w:del elements in the body is governed by anchor + addnext;
    # confirm BOTH deletions are present with the right content regardless
    # of order.
    del_texts = {_text_in(d, "w:delText") for d in dels}
    assert del_texts == {"age related", "acid base balance"}
    ins_texts = {_text_in(i, "w:t") for i in inses}
    assert ins_texts == {"age-related", "acid-base balance"}
