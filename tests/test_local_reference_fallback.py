"""Unit tests for `split_compound_bib_bookmarks` and the local reference fallback.

Builds minimal DOCX zips in-memory so tests don't depend on PPH, python-docx
styles, or upload/processing plumbing.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pytest
from lxml import etree

from app.processing.local_reference_fallback import (
    apply_local_bookmarks,
    split_compound_bib_bookmarks,
    strip_citation_semicolon_styling,
)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{" + W_NS + "}"

_CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

_ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""


def _make_docx(tmp_path: Path, body_inner_xml: str, name: str = "sample.docx") -> Path:
    """Assemble a minimal DOCX from a body-inner XML fragment."""
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}">'
        f'<w:body>{body_inner_xml}</w:body>'
        '</w:document>'
    )
    path = tmp_path / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _ROOT_RELS)
        z.writestr("word/document.xml", document_xml)
    return path


def _read_document_xml(path: Path) -> etree._Element:
    with zipfile.ZipFile(path, "r") as z:
        return etree.fromstring(z.read("word/document.xml"))


def _bib_bookmarks_by_paragraph(root) -> list[list[dict]]:
    """For each paragraph, return the list of bib_* bookmarks with the text
    each one spans. Preserves document order."""
    out = []
    for p in root.find(W + "body").findall(W + "p"):
        children = list(p)
        bookmarks: list[dict] = []
        open_stack: dict[str, dict] = {}
        for el in children:
            if el.tag == W + "bookmarkStart":
                name = el.get(W + "name") or ""
                if not name.startswith("bib_"):
                    continue
                open_stack[el.get(W + "id")] = {"name": name, "text": ""}
            elif el.tag == W + "bookmarkEnd":
                bid = el.get(W + "id")
                if bid in open_stack:
                    bookmarks.append(open_stack.pop(bid))
            elif el.tag == W + "r":
                run_text = "".join((t.text or "") for t in el.findall(W + "t"))
                for bm in open_stack.values():
                    bm["text"] += run_text
        out.append(bookmarks)
    return out


# ---------- fixture builders ----------

def _ref_paragraph(text: str) -> str:
    return (
        '<w:p>'
        '<w:pPr><w:pStyle w:val="REF-U"/></w:pPr>'
        f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'
        '</w:p>'
    )


def _citation_paragraph_one_run(prose_before: str, compound: str, prose_after: str,
                                bookmark_name: str, bookmark_id: int) -> str:
    """Paragraph with a single citebib run wrapped in one bib_ bookmark —
    the shape PPH tends to emit for compound citations."""
    return (
        '<w:p>'
        f'<w:r><w:t xml:space="preserve">{prose_before}(</w:t></w:r>'
        f'<w:bookmarkStart w:id="{bookmark_id}" w:name="{bookmark_name}"/>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/></w:rPr>'
        f'<w:t xml:space="preserve">{compound}</w:t></w:r>'
        f'<w:bookmarkEnd w:id="{bookmark_id}"/>'
        f'<w:r><w:t xml:space="preserve">){prose_after}</w:t></w:r>'
        '</w:p>'
    )


def _citation_paragraph_split_runs(prose_before: str, parts: list[str], prose_after: str,
                                   bookmark_name: str, bookmark_id: int) -> str:
    """Paragraph with multiple citebib runs separated by ``; `` connectors,
    all wrapped in ONE bib_ bookmark."""
    inner_runs = []
    for i, part in enumerate(parts):
        inner_runs.append(
            '<w:r><w:rPr><w:rStyle w:val="citebib"/></w:rPr>'
            f'<w:t xml:space="preserve">{part}</w:t></w:r>'
        )
        if i < len(parts) - 1:
            inner_runs.append('<w:r><w:t xml:space="preserve">; </w:t></w:r>')
    return (
        '<w:p>'
        f'<w:r><w:t xml:space="preserve">{prose_before}(</w:t></w:r>'
        f'<w:bookmarkStart w:id="{bookmark_id}" w:name="{bookmark_name}"/>'
        + "".join(inner_runs) +
        f'<w:bookmarkEnd w:id="{bookmark_id}"/>'
        f'<w:r><w:t xml:space="preserve">){prose_after}</w:t></w:r>'
        '</w:p>'
    )


REF_PARAS = [
    _ref_paragraph("AlRasheed, A. B., &amp; Doe, J. (2022). Learning disability policy. Journal of Ed, 12, 1–10."),
    _ref_paragraph("Centers for Medicare &amp; Medicaid Services. (2020). Telehealth reimbursement guidance."),
    _ref_paragraph("U.S. Department of Justice. (2023). ADA compliance report."),
    _ref_paragraph("Newman, R., Adams, K., &amp; Song, L. (2021). Post-secondary transition. Ed Weekly, 5, 20–30."),
]


# ---------- tests: single (unaffected) ----------

def test_single_citation_no_semicolon_is_unchanged(tmp_path):
    """A plain single-reference bookmark must not be touched."""
    body = _citation_paragraph_one_run(
        "Some prose ",
        "Newman et al., 2021",
        " continues.",
        bookmark_name="bib_4",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    original_xml = docx.read_bytes()
    stats = split_compound_bib_bookmarks(docx)

    assert stats == {"split_bookmarks": 0, "new_bookmarks": 0, "unmatched_parts": 0}
    # File should not have been rewritten when nothing changed.
    assert docx.read_bytes() == original_xml

    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(docx))
    assert bookmarks[0] == [{"name": "bib_4", "text": "Newman et al., 2021"}]


def test_doc_without_semicolons_is_no_op(tmp_path):
    """Multiple single-ref bookmarks, no ; anywhere — no rewrite."""
    body = (
        _citation_paragraph_one_run("Prose ", "AlRasheed et al., 2022", ".",
                                    bookmark_name="bib_1", bookmark_id=1)
        + _citation_paragraph_one_run("More ", "Newman et al., 2021", ".",
                                      bookmark_name="bib_4", bookmark_id=2)
        + "".join(REF_PARAS)
    )
    docx = _make_docx(tmp_path, body)
    stats = split_compound_bib_bookmarks(docx)
    assert stats["split_bookmarks"] == 0
    assert stats["new_bookmarks"] == 0


# ---------- tests: compound (split) ----------

def test_compound_citation_single_run_splits_into_three(tmp_path):
    """The PPH-style shape: one citebib run holds the whole compound. Each
    ;-separated sub-citation must become its own bib_ bookmark, pointing to
    the right reference."""
    body = _citation_paragraph_one_run(
        "Text before ",
        "AlRasheed et al., 2022; CMS, 2020; U.S. Department of Justice, 2023",
        " and after.",
        bookmark_name="bib_1",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    stats = split_compound_bib_bookmarks(docx)

    assert stats["split_bookmarks"] == 1
    assert stats["new_bookmarks"] == 3
    assert stats["unmatched_parts"] == 0

    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(docx))[0]
    names = [bm["name"] for bm in bookmarks]
    assert names == ["bib_1", "bib_2", "bib_3"]

    # Each bookmark spans exactly its own sub-citation — `;` separators must
    # NOT be swallowed by any bib_N bookmark so they render as plain text
    # between the per-citation indicators.
    assert all(";" not in bm["text"] for bm in bookmarks)
    assert bookmarks[0]["text"].strip() == "AlRasheed et al., 2022"
    assert bookmarks[1]["text"].strip() == "CMS, 2020"
    assert bookmarks[2]["text"].strip() == "U.S. Department of Justice, 2023"


def test_semicolons_survive_as_plain_text_between_bookmarks(tmp_path):
    """After splitting, every `;` must still exist in the paragraph — just
    outside the bib_N bookmarks so it renders as a plain separator."""
    body = _citation_paragraph_one_run(
        "Prose ",
        "AlRasheed et al., 2022; CMS, 2020; U.S. Department of Justice, 2023",
        ".",
        bookmark_name="bib_1",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    split_compound_bib_bookmarks(docx)
    root = _read_document_xml(docx)

    paragraph = root.find(W + "body").find(W + "p")
    paragraph_text = "".join(
        (t.text or "") for t in paragraph.iter(W + "t")
    )
    # Both original semicolons must still be present in the paragraph.
    assert paragraph_text.count(";") == 2
    # The text between the two bookmarks must include the semicolon.
    assert "2022; CMS" in paragraph_text
    assert "2020; U.S." in paragraph_text

    # Each `;` sits in its own <w:r> and must carry NO <w:rPr> — no citebib
    # style, no character formatting, nothing a downstream renderer could
    # pick up and turn into a bookmark-like indicator.
    semicolon_runs = [
        r for r in paragraph.iter(W + "r")
        if "".join((t.text or "") for t in r.findall(W + "t")).strip() == ";"
    ]
    assert len(semicolon_runs) == 2
    for r in semicolon_runs:
        assert r.find(W + "rPr") is None, (
            "Semicolon separator run must be plain text with no rPr"
        )


def test_compound_citation_multiple_runs_splits_into_three(tmp_path):
    """Same expected outcome when the source encodes each sub-citation as its
    own citebib run and ``; `` sits in plain connector runs."""
    body = _citation_paragraph_split_runs(
        "Text before ",
        ["AlRasheed et al., 2022", "CMS, 2020", "U.S. Department of Justice, 2023"],
        " and after.",
        bookmark_name="bib_1",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    stats = split_compound_bib_bookmarks(docx)

    assert stats["split_bookmarks"] == 1
    assert stats["new_bookmarks"] == 3
    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(docx))[0]
    names = [bm["name"] for bm in bookmarks]
    assert names == ["bib_1", "bib_2", "bib_3"]


def test_repeat_reference_gets_suffixed_name(tmp_path):
    """If the second sub-citation matches a ref already bookmarked earlier in
    the doc, it gets a `_2` suffix — no duplicate bookmark names."""
    # First a single Newman citation (bib_4), then a compound (Newman; CMS).
    body = (
        _citation_paragraph_one_run("Prose ", "Newman et al., 2021", ".",
                                    bookmark_name="bib_4", bookmark_id=10)
        + _citation_paragraph_one_run(
            "More ",
            "AlRasheed et al., 2022; Newman et al., 2021",
            ".",
            bookmark_name="bib_1", bookmark_id=11,
        )
        + "".join(REF_PARAS)
    )
    docx = _make_docx(tmp_path, body)

    stats = split_compound_bib_bookmarks(docx)
    assert stats["split_bookmarks"] == 1
    assert stats["new_bookmarks"] == 2

    all_bibs = [
        bs.get(W + "name")
        for bs in _read_document_xml(docx).iter(W + "bookmarkStart")
        if (bs.get(W + "name") or "").startswith("bib_")
    ]
    # No duplicate names allowed in a DOCX.
    assert len(all_bibs) == len(set(all_bibs)), all_bibs
    # The second Newman citation is the compound's tail → bib_4_2.
    assert "bib_4" in all_bibs
    assert "bib_4_2" in all_bibs
    assert "bib_1" in all_bibs


def test_unmatched_sub_citation_is_skipped(tmp_path):
    """Sub-citations that can't be matched to any reference contribute to
    `unmatched_parts` and get no bookmark — the matched ones still do."""
    body = _citation_paragraph_one_run(
        "Prose ",
        "AlRasheed et al., 2022; NoSuchAuthor, 1899",
        ".",
        bookmark_name="bib_1",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    stats = split_compound_bib_bookmarks(docx)
    assert stats["split_bookmarks"] == 1
    assert stats["new_bookmarks"] == 1
    assert stats["unmatched_parts"] == 1

    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(docx))[0]
    assert [bm["name"] for bm in bookmarks] == ["bib_1"]
    assert "AlRasheed" in bookmarks[0]["text"]


def test_split_is_idempotent(tmp_path):
    """Running the splitter twice must not change the result of the first run."""
    body = _citation_paragraph_one_run(
        "Prose ",
        "AlRasheed et al., 2022; CMS, 2020",
        ".",
        bookmark_name="bib_1",
        bookmark_id=1,
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    split_compound_bib_bookmarks(docx)
    after_first = docx.read_bytes()

    stats2 = split_compound_bib_bookmarks(docx)
    assert stats2 == {"split_bookmarks": 0, "new_bookmarks": 0, "unmatched_parts": 0}
    assert docx.read_bytes() == after_first


def test_missing_references_section_is_no_op(tmp_path):
    """Without a References list we can't match sub-citations — the doc must
    be left untouched rather than dropping the compound bookmark."""
    body = _citation_paragraph_one_run(
        "Prose ",
        "AlRasheed et al., 2022; CMS, 2020",
        ".",
        bookmark_name="bib_1",
        bookmark_id=1,
    )  # no REF_PARAS
    docx = _make_docx(tmp_path, body)
    original_xml = docx.read_bytes()

    stats = split_compound_bib_bookmarks(docx)
    assert stats == {"split_bookmarks": 0, "new_bookmarks": 0, "unmatched_parts": 0}
    assert docx.read_bytes() == original_xml


# ---------- strip_citation_semicolon_styling ----------

def _hyperlink_styled_compound_paragraph() -> str:
    """PPH-style paragraph where each citebib run AND each `; ` separator run
    inherit `<w:u/>` underline and blue `<w:color>` (Word's hyperlink
    formatting). This is the exact shape that leaks visual "bookmark-like"
    indicators onto the semicolons in the editor."""
    return (
        '<w:p>'
        '<w:r><w:t xml:space="preserve">Prose (</w:t></w:r>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t>AlRasheed et al., 2022</w:t></w:r>'
        '<w:r><w:rPr>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t xml:space="preserve">; </w:t></w:r>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t>CMS, 2020</w:t></w:r>'
        '<w:r><w:rPr>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t xml:space="preserve">; </w:t></w:r>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t>U.S. Department of Justice, 2022</w:t></w:r>'
        '<w:r><w:t xml:space="preserve">).</w:t></w:r>'
        '</w:p>'
    )


def _semicolon_run_rprs(root):
    """Return the `<w:rPr>` element (or None) for every `; `-only run in the
    document, in order."""
    out = []
    for r in root.iter(W + "r"):
        text = "".join((t.text or "") for t in r.findall(W + "t"))
        if text.strip() == ";":
            out.append(r.find(W + "rPr"))
    return out


def test_strip_semicolon_styling_removes_hyperlink_formatting(tmp_path):
    """Underline + colour on citation-separator `;` runs must be stripped, so
    the semicolon renders as plain text in the editor."""
    body = _hyperlink_styled_compound_paragraph() + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)

    cleaned = strip_citation_semicolon_styling(docx)
    assert cleaned == 2

    root = _read_document_xml(docx)
    for rpr in _semicolon_run_rprs(root):
        # After stripping, either the rPr is gone entirely, or it exists but
        # carries no <w:u>/<w:color>.
        if rpr is None:
            continue
        assert rpr.find(W + "u") is None
        assert rpr.find(W + "color") is None


def test_strip_semicolon_styling_is_idempotent(tmp_path):
    """Running the stripper twice should not further modify a cleaned file."""
    body = _hyperlink_styled_compound_paragraph() + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)
    strip_citation_semicolon_styling(docx)
    after_first = docx.read_bytes()

    cleaned2 = strip_citation_semicolon_styling(docx)
    assert cleaned2 == 0
    assert docx.read_bytes() == after_first


def test_strip_semicolon_styling_leaves_non_citation_semicolons_alone(tmp_path):
    """A `;` in prose (with no adjacent citebib runs) must NOT have its
    formatting touched — we're only cleaning citation separators."""
    body = (
        '<w:p>'
        '<w:r><w:rPr>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t xml:space="preserve">Note; see appendix.</w:t></w:r>'
        '</w:p>'
        '<w:p>'
        '<w:r><w:rPr>'
        '<w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr>'
        '<w:t xml:space="preserve">;</w:t></w:r>'
        '</w:p>'
    ) + "".join(REF_PARAS)
    docx = _make_docx(tmp_path, body)
    original_xml = docx.read_bytes()

    cleaned = strip_citation_semicolon_styling(docx)
    assert cleaned == 0
    # File must be untouched when nothing qualifies.
    assert docx.read_bytes() == original_xml


# ---------- end-to-end: apply_local_bookmarks + splitter ----------

def test_apply_local_bookmarks_still_works_for_single_citations(tmp_path):
    """`apply_local_bookmarks` must not regress after the refactor that
    extracted `_find_reference_layout` — one citebib run per paragraph should
    still get a single bib_N bookmark."""
    body = (
        '<w:p>'
        '<w:r><w:t xml:space="preserve">Prose before (</w:t></w:r>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/></w:rPr>'
        '<w:t xml:space="preserve">Newman et al., 2021</w:t></w:r>'
        '<w:r><w:t xml:space="preserve">).</w:t></w:r>'
        '</w:p>'
    ) + "".join(REF_PARAS)
    input_docx = _make_docx(tmp_path, body, name="in.docx")
    output_docx = tmp_path / "out.docx"

    stats = apply_local_bookmarks(input_docx, output_docx)
    assert stats["ref_count"] == 4
    assert stats["bib_matched"] == 1
    assert stats["bib_unmatched"] == 0

    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(output_docx))[0]
    assert len(bookmarks) == 1
    assert bookmarks[0]["name"] == "bib_4"  # Newman is the 4th reference


def test_apply_local_bookmarks_then_split_handles_compound(tmp_path):
    """The full local-fallback flow (as `_run_local_fallback` invokes it):
    apply_local_bookmarks → split_compound_bib_bookmarks. A compound written
    into a single citebib run should end up with per-sub-citation bookmarks."""
    body = (
        '<w:p>'
        '<w:r><w:t xml:space="preserve">Prose (</w:t></w:r>'
        '<w:r><w:rPr><w:rStyle w:val="citebib"/></w:rPr>'
        '<w:t xml:space="preserve">AlRasheed et al., 2022; CMS, 2020; U.S. Department of Justice, 2023</w:t></w:r>'
        '<w:r><w:t xml:space="preserve">).</w:t></w:r>'
        '</w:p>'
    ) + "".join(REF_PARAS)
    input_docx = _make_docx(tmp_path, body, name="in.docx")
    output_docx = tmp_path / "out.docx"

    apply_local_bookmarks(input_docx, output_docx)
    split_stats = split_compound_bib_bookmarks(output_docx)

    assert split_stats["split_bookmarks"] == 1
    assert split_stats["new_bookmarks"] == 3

    bookmarks = _bib_bookmarks_by_paragraph(_read_document_xml(output_docx))[0]
    names = [bm["name"] for bm in bookmarks]
    assert names == ["bib_1", "bib_2", "bib_3"]
