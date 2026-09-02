"""Per-reference edit for the Reference Review UI.

Locates a reference paragraph by its `ref_N` bookmark (or via multi-tiered
paragraph fallback) and swaps its text with tracked-changes markup (`w:del` for
old runs, `w:ins` for new runs), so Word shows the edit as a review-tracked
change. If the bookmark was missing, it is automatically restored/created so
downstream bib_/ref_ mapping keeps working.
"""
from __future__ import annotations

import datetime as dt
import logging
import shutil
import zipfile
from copy import deepcopy
from pathlib import Path

from lxml import etree

logger = logging.getLogger(__name__)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{" + W_NS + "}"


def _iso_now() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _next_revision_id(root) -> int:
    max_id = 0
    for el in root.iter():
        v = el.get(W + "id")
        if v and v.isdigit():
            max_id = max(max_id, int(v))
    return max_id + 1


def _paragraph_plain_text(p) -> str:
    return "".join(t.text or "" for t in p.iter(W + "t"))


def _ensure_bookmark_around_paragraph(p, root, ref_number: int):
    """Ensure paragraph `p` is wrapped with bookmark `ref_{ref_number}`."""
    name = f"ref_{ref_number}"
    body = root.find(W + "body")
    if body is not None:
        for bs in body.iter(W + "bookmarkStart"):
            if bs.get(W + "name") == name:
                return bs

    max_id = 0
    for el in root.iter():
        v = el.get(W + "id")
        if v and v.isdigit():
            max_id = max(max_id, int(v))
    new_id = str(max_id + 1)

    bmk_start = etree.Element(W + "bookmarkStart")
    bmk_start.set(W + "id", new_id)
    bmk_start.set(W + "name", name)

    bmk_end = etree.Element(W + "bookmarkEnd")
    bmk_end.set(W + "id", new_id)

    p.insert(0, bmk_start)
    p.append(bmk_end)
    return bmk_start


def _find_ref_paragraph(root, ref_number: int):
    """Return (paragraph, bookmark_start, bookmark_end) for `ref_{ref_number}` with multi-tier fallback."""
    body = root.find(W + "body")
    if body is None:
        return None, None, None

    target_names = {
        f"ref_{ref_number}",
        f"ref_{ref_number:02d}",
        f"ref_{ref_number:03d}",
        f"ref{ref_number}",
        f"ref-{ref_number}",
        f"REF_{ref_number}",
        f"REF_{ref_number:02d}",
    }

    bookmark_start = None
    for bs in body.iter(W + "bookmarkStart"):
        bname = (bs.get(W + "name") or "").strip()
        if bname in target_names or bname.lower() in {t.lower() for t in target_names}:
            bookmark_start = bs
            break

    if bookmark_start is not None:
        p = bookmark_start
        while p is not None and p.tag != W + "p":
            p = p.getparent()
        if p is not None:
            bid = bookmark_start.get(W + "id")
            bookmark_end = None
            for be in body.iter(W + "bookmarkEnd"):
                if be.get(W + "id") == bid:
                    bookmark_end = be
                    break
            return p, bookmark_start, bookmark_end

    num_patterns = [
        f"[{ref_number}]",
        f"{ref_number}.",
        f"{ref_number} ",
    ]
    ref_paragraphs = []
    for p in body.findall(W + "p"):
        style = ""
        pPr = p.find(W + "pPr")
        if pPr is not None:
            pStyle = pPr.find(W + "pStyle")
            if pStyle is not None:
                style = (pStyle.get(W + "val") or "").upper()

        text = _paragraph_plain_text(p).strip()
        is_ref_style = "REF" in style or "REFERENCE" in style or style.startswith("BIB_")
        starts_with_num = any(text.startswith(pat) for pat in num_patterns)

        if is_ref_style or starts_with_num:
            ref_paragraphs.append((p, starts_with_num))

    for p, starts_with_num in ref_paragraphs:
        if starts_with_num:
            bmk_start = _ensure_bookmark_around_paragraph(p, root, ref_number)
            return p, bmk_start, None

    if 1 <= ref_number <= len(ref_paragraphs):
        p = ref_paragraphs[ref_number - 1][0]
        bmk_start = _ensure_bookmark_around_paragraph(p, root, ref_number)
        return p, bmk_start, None

    all_paras = [p for p in body.findall(W + "p") if _paragraph_plain_text(p).strip()]
    if 1 <= ref_number <= len(all_paras):
        p = all_paras[ref_number - 1]
        bmk_start = _ensure_bookmark_around_paragraph(p, root, ref_number)
        return p, bmk_start, None

    return None, None, None


def _wrap_runs_as_deletion(runs, author: str, date: str, rev_id: int) -> etree._Element:
    """Wrap a list of runs into a single `w:del` element with `w:delText` children."""
    del_el = etree.SubElement(etree.Element(W + "tmp"), W + "del")
    del_el.set(W + "id", str(rev_id))
    del_el.set(W + "author", author)
    del_el.set(W + "date", date)
    for r in runs:
        r_copy = deepcopy(r)
        for t in list(r_copy.findall(W + "t")):
            del_t = etree.SubElement(r_copy, W + "delText")
            del_t.text = t.text or ""
            if t.get("{http://www.w3.org/XML/1998/namespace}space"):
                del_t.set(
                    "{http://www.w3.org/XML/1998/namespace}space",
                    t.get("{http://www.w3.org/XML/1998/namespace}space"),
                )
            r_copy.remove(t)
            r_copy.append(del_t)
        del_el.append(r_copy)
    return del_el


def _make_ins_run(text: str, sample_run, author: str, date: str, rev_id: int) -> etree._Element:
    """Build a `w:ins` element containing a single new `w:r`/`w:t` with formatting copied from `sample_run`."""
    ins_el = etree.Element(W + "ins")
    ins_el.set(W + "id", str(rev_id))
    ins_el.set(W + "author", author)
    ins_el.set(W + "date", date)

    r_el = etree.SubElement(ins_el, W + "r")
    if sample_run is not None:
        rpr = sample_run.find(W + "rPr")
        if rpr is not None:
            r_el.append(deepcopy(rpr))
    t_el = etree.SubElement(r_el, W + "t")
    t_el.text = text
    t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return ins_el


def apply_reference_edit(
    docx_path: str | Path,
    ref_number: int,
    new_text: str,
    *,
    author: str = "reviewer",
    track_changes: bool = True,
) -> dict:
    """Edit the paragraph carrying bookmark `ref_{ref_number}` (with multi-tier fallback)."""
    docx_path = Path(docx_path)
    new_text = (new_text or "").strip()

    with zipfile.ZipFile(docx_path, "r") as z:
        doc_xml = z.read("word/document.xml")
    root = etree.fromstring(doc_xml)

    p, bmk_start, bmk_end = _find_ref_paragraph(root, ref_number)
    if p is None:
        raise ValueError(f"Bookmark ref_{ref_number} not found in document")

    old_text = _paragraph_plain_text(p).strip()
    if old_text == new_text:
        return {
            "ref_number": ref_number,
            "old_text": old_text,
            "new_text": new_text,
            "changed": False,
        }

    runs = list(p.findall(W + "r"))
    sample_run = runs[0] if runs else None
    now = _iso_now()
    rev_id = _next_revision_id(root)

    if track_changes and runs:
        del_el = _wrap_runs_as_deletion(runs, author, now, rev_id)
        first_run_idx = list(p).index(runs[0])
        for r in runs:
            p.remove(r)
        ins_el = _make_ins_run(new_text, sample_run, author, now, rev_id + 1)
        p.insert(first_run_idx, del_el)
        p.insert(first_run_idx + 1, ins_el)
    else:
        first_run_idx = list(p).index(runs[0]) if runs else None
        for r in runs:
            p.remove(r)
        new_r = etree.Element(W + "r")
        if sample_run is not None:
            rpr = sample_run.find(W + "rPr")
            if rpr is not None:
                new_r.append(deepcopy(rpr))
        new_t = etree.SubElement(new_r, W + "t")
        new_t.text = new_text
        new_t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        if first_run_idx is not None:
            p.insert(first_run_idx, new_r)
        else:
            p.append(new_r)

    new_doc = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    tmp_path = docx_path.with_suffix(docx_path.suffix + ".tmp")
    with zipfile.ZipFile(docx_path, "r") as zin, \
         zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename) if item.filename != "word/document.xml" else new_doc
            zout.writestr(item, data)
    shutil.move(str(tmp_path), str(docx_path))

    logger.info(
        "Applied reference edit to %s: ref_%d (%s tracking)",
        docx_path.name,
        ref_number,
        "with" if track_changes else "without",
    )
    return {
        "ref_number": ref_number,
        "old_text": old_text,
        "new_text": new_text,
        "changed": True,
    }
