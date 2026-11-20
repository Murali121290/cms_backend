"""Word tracked-change (w:ins / w:del) helpers for the EOC fixer.

Every correction is written as a revision so reviewers can Accept / Reject it
in Word. Text replacements are character-level (only the differing middle part
is deleted/inserted); whole-line additions/removals also track the paragraph
mark so Accept/Reject leaves a clean document.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Optional

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
_REVISION_TAGS = ("ins", "del", "moveFrom", "moveTo", "rPrChange", "pPrChange")


def has_tracked_changes(body) -> bool:
    return any(True for t in _REVISION_TAGS for _ in body.iter(qn(f"w:{t}")))


def accept_all(body) -> None:
    """Accept every revision in-place (used to *read* a document as it will
    look once changes are accepted — never written back)."""
    for tag in ("w:del", "w:moveFrom"):
        for el in list(body.iter(qn(tag))):
            parent = el.getparent()
            if parent is None:
                continue
            if parent.tag == qn("w:rPr"):  # paragraph-mark deletion marker
                p = parent.getparent().getparent() if parent.getparent() is not None else None
                parent.remove(el)
                if p is not None and p.tag == qn("w:p") and not "".join(t.text or "" for t in p.iter(qn("w:t"))).strip() \
                        and p.find(".//" + qn("w:drawing")) is None and p.getparent() is not None:
                    p.getparent().remove(p)
            else:
                parent.remove(el)
    for tag in ("w:ins", "w:moveTo"):
        for el in list(body.iter(qn(tag))):
            parent = el.getparent()
            if parent is None:
                continue
            if parent.tag == qn("w:rPr"):
                parent.remove(el)
                continue
            idx = parent.index(el)
            for child in list(el):
                parent.insert(idx, child)
                idx += 1
            parent.remove(el)
    for tag in ("w:rPrChange", "w:pPrChange"):
        for el in list(body.iter(qn(tag))):
            el.getparent().remove(el)


class Tracker:
    def __init__(self, body, author: str = "EOC Validator", date: Optional[str] = None):
        self.author = author
        self.date = date or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        ids = [int(v) for el in body.iter() for k, v in el.attrib.items() if k == qn("w:id") and str(v).lstrip("-").isdigit()]
        self._next = max(ids, default=0) + 1

    def _rev(self, tag: str):
        el = OxmlElement(tag)
        el.set(qn("w:id"), str(self._next))
        el.set(qn("w:author"), self.author)
        el.set(qn("w:date"), self.date)
        self._next += 1
        return el

    # ── run-level ────────────────────────────────────────────────────────
    def delete_run(self, r) -> None:
        """Wrap an existing <w:r> in <w:del> (w:t → w:delText)."""
        for t in r.findall(qn("w:t")):
            t.tag = qn("w:delText")
        for t in r.findall(qn("w:instrText")):
            t.tag = qn("w:delInstrText")
        wrapper = self._rev("w:del")
        r.addprevious(wrapper)
        wrapper.append(r)

    def ins_wrap(self, runs: list) -> object:
        wrapper = self._rev("w:ins")
        for r in runs:
            wrapper.append(r)
        return wrapper

    # ── paragraph marks ──────────────────────────────────────────────────
    def _mark(self, p_el, tag: str) -> None:
        pPr = p_el.find(qn("w:pPr"))
        if pPr is None:
            pPr = OxmlElement("w:pPr")
            p_el.insert(0, pPr)
        rPr = pPr.find(qn("w:rPr"))
        if rPr is None:
            rPr = OxmlElement("w:rPr")
            anchor = pPr.find(qn("w:sectPr"))
            if anchor is None:
                anchor = pPr.find(qn("w:pPrChange"))
            if anchor is not None:
                anchor.addprevious(rPr)
            else:
                pPr.append(rPr)
        rPr.insert(0, self._rev(tag))

    # ── paragraph-level operations ───────────────────────────────────────
    def delete_paragraph(self, p: Paragraph) -> None:
        for r in list(p._p.findall(qn("w:r"))):
            self.delete_run(r)
        self._mark(p._p, "w:del")

    def insert_paragraph_after(self, anchor: Paragraph, text: str, style_from: Optional[Paragraph] = None) -> Paragraph:
        src = style_from or anchor
        new_p = OxmlElement("w:p")
        src_pPr = src._p.find(qn("w:pPr"))
        if src_pPr is not None:
            pPr = copy.deepcopy(src_pPr)
            for junk in pPr.findall(qn("w:rPr")) + pPr.findall(qn("w:pPrChange")):
                pPr.remove(junk)
            new_p.append(pPr)
        anchor._p.addnext(new_p)
        r = make_run(text, _plain_rpr(src))
        new_p.append(self.ins_wrap([r]))
        self._mark(new_p, "w:ins")
        return Paragraph(new_p, anchor._parent)

    def replace_text(self, p: Paragraph, new_text: str, new_runs: Optional[list] = None) -> bool:
        """Track-change the paragraph text to ``new_text`` touching only the
        differing middle part. ``new_runs`` (optional) are pre-built runs for
        the full new text (used to carry italics into regenerated titles).
        Returns False when nothing changed."""
        runs = p._p.findall(qn("w:r"))
        old_text = "".join(_run_text(r) for r in runs)
        if old_text == new_text:
            return False
        pre = 0
        while pre < min(len(old_text), len(new_text)) and old_text[pre] == new_text[pre]:
            pre += 1
        suf = 0
        while (suf < min(len(old_text), len(new_text)) - pre
               and old_text[len(old_text) - 1 - suf] == new_text[len(new_text) - 1 - suf]):
            suf += 1
        a, b = pre, len(old_text) - suf  # old [a, b) is replaced
        new_mid = new_text[pre:len(new_text) - suf]

        if not all(_simple_run(r) for r in runs):
            a, b, new_mid = 0, len(old_text), new_text  # fall back: whole line
            if new_runs is not None:
                pre = 0

        _split_runs_at(p._p, a)
        _split_runs_at(p._p, b)
        runs = p._p.findall(qn("w:r"))
        pos = 0
        doomed, before_anchor = [], None
        for r in runs:
            t = _run_text(r)
            start, end = pos, pos + len(t)
            pos = end
            if end <= a:
                before_anchor = r
            if start >= a and end <= b and end > start:
                doomed.append(r)
        style_run = doomed[0] if doomed else (before_anchor if before_anchor is not None else (runs[0] if runs else None))
        for r in doomed:
            self.delete_run(r)
        if new_mid:
            if new_runs is not None:
                ins_runs = _trim_runs(new_runs, pre, len(new_mid))
            else:
                rpr = style_run.find(qn("w:rPr")) if style_run is not None else None
                ins_runs = [make_run(new_mid, copy.deepcopy(rpr) if rpr is not None else None)]
            wrapper = self.ins_wrap(ins_runs)
            if doomed:
                doomed_parent = doomed[-1].getparent()  # the <w:del> wrapper
                doomed_parent.addnext(wrapper)
            elif before_anchor is not None:
                before_anchor.addnext(wrapper)
            else:
                pPr = p._p.find(qn("w:pPr"))
                if pPr is not None:
                    pPr.addnext(wrapper)
                else:
                    p._p.insert(0, wrapper)
        return True


# ── run utilities ───────────────────────────────────────────────────────────

def make_run(text: str, rPr=None):
    r = OxmlElement("w:r")
    if rPr is not None:
        r.append(rPr)
    t = OxmlElement("w:t")
    t.set(XML_SPACE, "preserve")
    t.text = text
    r.append(t)
    return r


def _plain_rpr(p: Paragraph):
    r = p._p.find(qn("w:r"))
    if r is None or r.find(qn("w:rPr")) is None:
        return None
    rpr = copy.deepcopy(r.find(qn("w:rPr")))
    for tag in ("w:b", "w:bCs", "w:i", "w:iCs", "w:u", "w:color", "w:highlight", "w:shd", "w:strike", "w:vertAlign", "w:rStyle"):
        for el in rpr.findall(qn(tag)):
            rpr.remove(el)
    return rpr


def _run_text(r) -> str:
    out = []
    for child in r:
        if child.tag == qn("w:t"):
            out.append(child.text or "")
        elif child.tag == qn("w:tab"):
            out.append("\t")
        elif child.tag in (qn("w:br"), qn("w:cr")):
            out.append("\n")
        elif child.tag == qn("w:noBreakHyphen"):
            out.append("-")
    return "".join(out)


def _simple_run(r) -> bool:
    return all(c.tag in (qn("w:rPr"), qn("w:t")) for c in r)


def _split_runs_at(p_el, offset: int) -> None:
    """Split the simple run spanning ``offset`` so a run boundary sits there."""
    pos = 0
    for r in p_el.findall(qn("w:r")):
        t = _run_text(r)
        start, end = pos, pos + len(t)
        pos = end
        if start < offset < end and _simple_run(r):
            k = offset - start
            left = copy.deepcopy(r)
            _set_run_text(left, t[:k])
            _set_run_text(r, t[k:])
            r.addprevious(left)
            return


def _set_run_text(r, text: str) -> None:
    for t in r.findall(qn("w:t")):
        r.remove(t)
    t = OxmlElement("w:t")
    t.set(XML_SPACE, "preserve")
    t.text = text
    r.append(t)


def _trim_runs(runs: list, skip: int, take: int) -> list:
    """Return copies of ``runs`` covering characters [skip, skip+take)."""
    out, pos = [], 0
    for r in runs:
        t = _run_text(r)
        start, end = pos, pos + len(t)
        pos = end
        lo, hi = max(start, skip), min(end, skip + take)
        if lo >= hi:
            continue
        nr = copy.deepcopy(r)
        _set_run_text(nr, t[lo - start:hi - start])
        out.append(nr)
    return out
