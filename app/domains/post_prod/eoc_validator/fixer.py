"""Apply safe, mechanical corrections to an EOC/EOL assessment Word file as
Word *tracked changes* (reviewers Accept/Reject them in Word).

Only fixes whose correct result is fully determined by the rules are applied:

* Shuffle line: added / removed per the shuffle rules, normalised to
  ``Shuffle: True`` and moved directly after the options.
* ``Learning Outcome:`` spacing / separator normalisation (value unchanged).
* Reference IDs rebuilt as ``<prefix><CC>_<QQQ>``.
* ``Title:`` prefix spacing, and titles regenerated from the question text when
  they clearly don't match it (italic/bold runs from the question are kept).
  A title that differs from the question by only a character or two is a
  typo in one of them and is left for a human.
* Blank paragraphs removed.

Anything needing human judgement (missing correct-answer asterisk, empty
Learning Outcome, image-only questions, numeric options to review, question
numbering) is left untouched and reported by the validator.

Files that already contain tracked changes are not modified: their pending
revisions must be accepted/rejected in Word first.
"""

from __future__ import annotations

import copy
import io
import re
from dataclasses import asdict, dataclass
from typing import Optional

import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from .parser import QUESTION_RE, parse_docx
from .rules import ERROR, LO_VALUE_RE, check_title, normalize_blanks, shuffle_decision, title_looks_like_typo
from .tracked import Tracker, _run_text, has_tracked_changes, make_run

TITLE_MAX = 60
ELLIPSIS = " …"  # shortened titles end with a space + the ellipsis character
DEFAULT_AUTHOR = "EOC Validator"


class AlreadyTrackedError(ValueError):
    """The input already contains tracked changes."""


@dataclass
class Fix:
    file: str
    question: Optional[int]
    rule: str
    action: str
    before: str
    after: str

    def to_dict(self) -> dict:
        return asdict(self)


def _norm(s: str) -> str:
    return normalize_blanks(
        s.strip().replace("’", "'").replace("‘", "'")
        .replace("“", '"').replace("”", '"').replace(" ", " ")
    )


def make_title(stem: str) -> str:
    """Title rule: full question if it fits in 60 characters; otherwise the
    longest start of the question ending at a full word such that the whole
    title, including the ending ' …', is at most 60 characters."""
    s = normalize_blanks(stem.strip())
    if len(s) <= TITLE_MAX:
        return s
    limit = TITLE_MAX - len(ELLIPSIS)  # room for the text before ' …'
    cut = s[:limit + 1]
    sp = cut.rfind(" ")
    body = (cut[:sp] if sp > 0 else s[:limit]).rstrip(" ,;:—–-")
    return body + ELLIPSIS


def _title_runs(tpara: Paragraph, qpara: Paragraph, title: str) -> Optional[list]:
    """Runs for the full new title line: a plain 'Title: ' run (formatting of
    the existing title's first run) + clones of the question's runs so italics
    carry over. None if the question runs can't be mapped cleanly."""
    want = title[: -len(ELLIPSIS)] if title.endswith(ELLIPSIS) else title
    full = qpara.text
    m = QUESTION_RE.match(full) or re.match(r"^(\d+\.)(?:\t|\s+)(.*)$", full)
    if not m:
        return None
    stem_raw = m.group(2)
    skip = (len(full) - len(stem_raw)) + (len(stem_raw) - len(stem_raw.lstrip()))
    out, pos, consumed = [], 0, 0
    for r in qpara._p.findall(qn("w:r")):
        t = _run_text(r)
        start, end = pos, pos + len(t)
        pos = end
        if end <= skip or consumed >= len(want):
            continue
        piece = t[max(0, skip - start):][: len(want) - consumed]
        if not piece:
            continue
        nr = copy.deepcopy(r)
        for child in list(nr):
            if child.tag != qn("w:rPr"):
                nr.remove(child)
        tmp = make_run(piece)
        nr.append(tmp.find(qn("w:t")))
        out.append(nr)
        consumed += len(piece)
    if "".join(_run_text(r) for r in out) != want:
        return None
    if title.endswith(ELLIPSIS):
        last_t = out[-1].find(qn("w:t"))
        last_t.text = last_t.text.rstrip() + ELLIPSIS
    first = tpara._p.find(qn("w:r"))
    rpr = copy.deepcopy(first.find(qn("w:rPr"))) if first is not None and first.find(qn("w:rPr")) is not None else None
    return [make_run("Title: ", rpr)] + out


def fix_docx(
    data: bytes,
    filename: str,
    reference_prefix: str,
    author: str = DEFAULT_AUTHOR,
    assessment_type: str = "auto",
) -> tuple[bytes, list[Fix]]:
    d = docx.Document(io.BytesIO(data))
    body = d.element.body
    if has_tracked_changes(body):
        raise AlreadyTrackedError(
            "File already contains tracked changes — accept or reject them in Word, then run the correction again."
        )
    cf = parse_docx(data, filename)
    if assessment_type == "sa":
        for q in cf.questions:
            if q.kind != "EMPTY":
                q.kind = "SA"
    elif assessment_type == "mc":
        for q in cf.questions:
            if q.kind == "SA":
                q.kind = "MC"

    paras = list(d.paragraphs)  # same order/indices as the parser (no revisions present)
    tr = Tracker(body, author=author)
    fixes: list[Fix] = []
    ch = cf.chapter_no

    def P(idx: int) -> Paragraph:
        return paras[idx]

    # Line removals/additions are queued and applied bottom-up so paragraph
    # indices stay valid (tracked deletions keep the paragraph in place, but
    # insertions add new ones).
    removals: set[int] = set()
    inserts: list[tuple[int, str, Optional[int]]] = []

    for q in cf.questions:
        # ── Question numbering tab fix
        if q.has_tab_error:
            qp = P(q.idx)
            raw_q = q.raw
            m_loose = re.match(r"^(\d+\.)\s+(.*)$", raw_q)
            if m_loose:
                new_q = f"{m_loose.group(1)}\t{m_loose.group(2)}"
                if tr.replace_text(qp, new_q):
                    fixes.append(Fix(filename, q.number, "Q1", "replaced space with tab after question number", raw_q, new_q))

        # ── Stray tag lines left after the question's Reference line
        if q.ref_line is not None:
            for role, l in q.extra_lines:
                if l.idx > q.ref_line.idx:
                    removals.add(l.idx)
                    fixes.append(Fix(filename, q.number, "R2", "removed stray line after the Reference", l.text, ""))

        # ── Shuffle
        if q.kind == "SA":
            if q.shuffle_line is not None:
                removals.add(q.shuffle_line.idx)
                fixes.append(Fix(filename, q.number, "SH3", "removed Shuffle line from short-answer question", q.shuffle_line.text, ""))
        else:
            should, reason, review = shuffle_decision(q)
            if q.kind == "EMPTY" or review:
                should = None  # not decidable automatically
            sh = q.shuffle_line
            last_opt_idx = max((o.idx for o in q.options), default=None)
            well_placed = False
            if sh is not None:
                roles = [r for r, _ in q.body]
                si = roles.index("shuffle")
                well_placed = si > 0 and roles[si - 1] in ("option", "tf", "order") and si + 1 < len(roles) and roles[si + 1] == "title"
            if should is True and last_opt_idx is not None:
                if sh is None:
                    inserts.append((last_opt_idx, "Shuffle: True", q.title_line.idx if q.title_line else None))
                    fixes.append(Fix(filename, q.number, "SH3", f"added Shuffle line ({reason})", "", "Shuffle: True"))
                elif not well_placed:
                    removals.add(sh.idx)
                    inserts.append((last_opt_idx, "Shuffle: True", sh.idx))
                    fixes.append(Fix(filename, q.number, "SH2", "moved Shuffle line directly after the options", sh.text, "Shuffle: True"))
                elif sh.text != "Shuffle: True":
                    tr.replace_text(P(sh.idx), "Shuffle: True")
                    fixes.append(Fix(filename, q.number, "SH1", "normalised Shuffle line", sh.text, "Shuffle: True"))
            elif should is False and sh is not None:
                removals.add(sh.idx)
                fixes.append(Fix(filename, q.number, "SH3", f"removed Shuffle line ({reason})", sh.text, ""))
            elif should is None and sh is not None and sh.text != "Shuffle: True" \
                    and re.fullmatch(r"\s*shuffle\s*:\s*true\s*", sh.text, re.I):
                tr.replace_text(P(sh.idx), "Shuffle: True")
                fixes.append(Fix(filename, q.number, "SH1", "normalised Shuffle line", sh.text, "Shuffle: True"))

        # ── Title
        if q.title_line is not None and q.kind != "EMPTY":
            raw = q.title_line.text
            val = re.sub(r"^Title\s*:\s*", "", raw, flags=re.I)
            has_error = any(sev == ERROR for sev, _ in check_title(q, val))
            tp = P(q.title_line.idx)
            # Shortened title ending in '...', '..' or '…' without a space →
            # space + ellipsis ' …'. Only the ending changes — and only when the
            # title is then fully correct (right text, right length); otherwise
            # the whole title is rebuilt from the question below.
            dots = re.search(r"(\.{2,3}|…)\s*$", val)
            body_d = val[:dots.start()].rstrip() if dots else ""
            good_end = val.rstrip().endswith(ELLIPSIS) and not val.rstrip().endswith("  …")
            ending_fix_ok = bool(dots and body_d and not good_end
                                 and _norm(q.stem).startswith(_norm(body_d))
                                 and not any(sev == ERROR for sev, _ in check_title(q, body_d + ELLIPSIS)))
            if ending_fix_ok:
                new = raw[: len(raw.rstrip()) - len(dots.group(0).rstrip())].rstrip() + ELLIPSIS
                if tr.replace_text(tp, new):
                    ending = dots.group(0).strip()
                    what = "added a space before the ellipsis" if ending == "…" else f"replaced '{ending}' with ' …'"
                    fixes.append(Fix(filename, q.number, "T1", f"{what} in the Title", raw, new))
            elif has_error and not title_looks_like_typo(q.stem, val):
                new_title = make_title(q.stem)
                runs = _title_runs(tp, P(q.idx), new_title)
                tr.replace_text(tp, "Title: " + new_title, new_runs=runs)
                fixes.append(Fix(filename, q.number, "T1", "regenerated Title from the question", raw, "Title: " + new_title))
            elif not has_error and (not raw.startswith("Title: ") or raw.startswith("Title:  ")):
                new = "Title: " + val.strip()
                tr.replace_text(tp, new)
                fixes.append(Fix(filename, q.number, "T1", "fixed 'Title: ' spacing", raw, new))

        # ── Learning Outcome (spacing/separators only; the value is kept)
        if q.lo_line is not None:
            raw = q.lo_line.text
            val = re.sub(r"^Learning\s*Outcome\s*:\s*", "", raw, flags=re.I).strip()
            hy = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", val)
            if hy and ch is not None and int(hy.group(1)) == ch:
                val = f"{hy.group(1)}.{hy.group(2)}"  # '5-1' typed for '5.1'
            if val and LO_VALUE_RE.match(val):
                new = "Learning Outcome: " + ", ".join(v.strip() for v in val.split(","))
                if raw != new and tr.replace_text(P(q.lo_line.idx), new):
                    what = "fixed Learning Outcome format ('-' → '.')" if hy else "fixed Learning Outcome spacing"
                    fixes.append(Fix(filename, q.number, "L1", what, raw, new))

        # ── Reference
        if q.ref_line is not None and ch is not None:
            raw = q.ref_line.text
            new = f"Reference: {reference_prefix}{ch:02d}_{q.number:03d}"
            if raw != new and tr.replace_text(P(q.ref_line.idx), new):
                fixes.append(Fix(filename, q.number, "R1", "rebuilt Reference ID", raw, new))

    # ── Blank paragraphs (keep ones that hold an image)
    for ln in cf.lines:
        if ln.is_blank and P(ln.idx)._p.find(".//" + qn("w:drawing")) is None:
            removals.add(ln.idx)
            fixes.append(Fix(filename, None, "F2", "removed blank line", "", ""))

    ops: list[tuple[int, int, tuple]] = [(idx, 0, ("remove", idx)) for idx in removals]
    ops += [(after, 1, ("insert", after, text, style)) for after, text, style in inserts]
    for _, _, op in sorted(ops, key=lambda o: (o[0], o[1]), reverse=True):
        if op[0] == "remove":
            tr.delete_paragraph(P(op[1]))
        else:
            _, after, text, style = op
            tr.insert_paragraph_after(P(after), text, P(style) if style is not None else None)

    out = io.BytesIO()
    d.save(out)
    return out.getvalue(), fixes
