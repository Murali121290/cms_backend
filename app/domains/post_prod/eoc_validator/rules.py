"""Rule checks for EOC/EOL assessment Word files (report only)."""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from fractions import Fraction
from typing import Optional

from .parser import (
    ChapterFile,
    LOOSE_OPTION_RE,
    LOOSE_QUESTION_RE,
    Question,
)

ERROR, WARNING, INFO = "error", "warning", "info"

RULE_TITLES = {
    "F1": "Chapter number / file set",
    "F2": "Plain-text formatting",
    "F3": "Images / equations need manual review",
    "F4": "Garbled characters",
    "IMG1": "Image Alt text",
    "Q1": "Question numbering",
    "Q2": "Question text",
    "O1": "Option letters",
    "O2": "Correct-answer asterisk",
    "O3": "True/False options",
    "O4": "Option content",
    "SH1": "Shuffle line format",
    "SH2": "Shuffle line position",
    "SH3": "Shuffle decision",
    "T1": "Title",
    "L1": "Learning Outcome",
    "R1": "Reference ID",
    "R2": "Line order",
    "X1": "Unrecognised line",
}


@dataclass
class Issue:
    file: str
    chapter: Optional[int]
    question: Optional[int]
    rule: str
    severity: str
    message: str
    text: str = ""
    line: Optional[int] = None  # 1-based paragraph number

    def to_dict(self) -> dict:
        d = asdict(self)
        d["rule_title"] = RULE_TITLES.get(self.rule, self.rule)
        return d


# ── Shuffle decision helpers ────────────────────────────────────────────────

NO_SHUFFLE_PATTERNS = [
    (re.compile(r"\ball\s+(of\s+the\s+)?(above|are\s+correct|of\s+these|the\s+above)\b", re.I), "an “All of the above / All are correct” option"),
    (re.compile(r"\bnone\s+(of\s+the\s+)?(above|are\s+correct|of\s+these|the\s+above)\b", re.I), "a “None of the above / None are correct” option"),
    (re.compile(r"\bboth\s+(?:[A-H]|answers?|options?|choices?)\b.*\band\b", re.I), "a “Both A and B” option"),
    (re.compile(r"\bneither\b.*\bnor\b", re.I), "a “Neither … nor …” option"),
    (re.compile(r"\b[A-H]\s*(?:,\s*[A-H]\s*)*(?:and|or|&)\s*[A-H]\b(?!\w)"), "an option that refers to other option letters"),
]

YEAR_RE = re.compile(r"^(?:c\.\s*)?(1\d{3}|20\d{2})s?\.?$")
ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]
_NUM_RE = re.compile(
    r"^[−\-+]?\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?|\.\d+)"
)


def _numeric_value(text: str) -> Optional[float]:
    """Leading numeric value of an option (handles 1/8″, 1 1/2", 0.005, 25%)."""
    t = text.strip().replace(" ", " ").replace(" ", " ")
    m = _NUM_RE.match(t)
    if not m:
        return None
    raw = m.group(1).replace(",", "")
    neg = t.lstrip().startswith(("-", "−"))
    try:
        if " " in raw and "/" in raw:
            whole, frac = raw.split()
            val = float(int(whole) + Fraction(frac))
        elif "/" in raw:
            val = float(Fraction(raw))
        else:
            val = float(raw)
    except (ValueError, ZeroDivisionError):
        return None
    return -val if neg else val


def shuffle_decision(q: Question) -> tuple[Optional[bool], str, bool]:
    """Return (should_shuffle, reason, needs_review).

    should_shuffle is None when the question has no options to judge.
    """
    if q.kind == "TF":
        return False, "True/False question", False
    if q.kind == "ORDER":
        return None, "ordering question", True
    texts = [o.text for o in q.options]
    if len(texts) < 2:
        return None, "no options", False
    for opt in texts:
        for rx, label in NO_SHUFFLE_PATTERNS:
            if rx.search(opt):
                return False, f"has {label}: “{opt}”", False
    low = [t.lower().strip(" .") for t in texts]
    if all(t in ORDINALS for t in low):
        idx = [ORDINALS.index(t) for t in low]
        if idx == sorted(idx) or idx == sorted(idx, reverse=True):
            return False, "options are ordinal and in sequence", False
    nums = [_numeric_value(t) for t in texts]
    if all(n is not None for n in nums):
        in_order = nums == sorted(nums) or nums == sorted(nums, reverse=True)
        if in_order and all(YEAR_RE.match(t.strip()) for t in texts):
            # "Chronological dates" is named in the shuffle instruction.
            return False, "options are years in chronological order", False
        if in_order:
            # Amounts listed by size: house-style order, not clearly a "sequence"
            # — flag for a person to confirm, never changed automatically.
            return False, "options are numbers listed by size (ascending/descending) — confirm whether they should shuffle", True
        # Numbers in mixed order: not checked, never changed.
        return None, "numeric options in mixed order (not checked)", False
    return True, "independent options", False


# ── Title helper ────────────────────────────────────────────────────────────

def _norm_quotes(s: str) -> str:
    return (
        s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
        .replace(" ", " ")
    )


def title_looks_like_typo(stem: str, title: str) -> bool:
    """True when title and question differ by only a character or two —
    a typo in one of them, which a human must resolve (not auto-fixable)."""
    import difflib

    ns, nt = _norm_quotes(stem.strip()), _norm_quotes(title.strip())
    for tail in ("…", "..."):
        if nt.endswith(tail):
            nt = nt[: -len(tail)].rstrip()
            break
    seg = ns[: len(nt) + 3]
    if not nt or nt == seg[: len(nt)]:
        return False
    sm = difflib.SequenceMatcher(None, seg, nt)
    changed = sum(max(i2 - i1, j2 - j1) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal")
    return changed <= 3


SHORT_TITLE_MAX = 60


def check_title(q: Question, title: str) -> list[tuple[str, str]]:
    """Return a list of (severity, message).

    A title of 60 characters or fewer gets no warnings or info notes — only
    real errors (wrong text, wrong ending) are reported for it."""
    results = _check_title(q, title)
    if title_text_length(title) <= SHORT_TITLE_MAX:
        results = [(sev, msg) for sev, msg in results if sev == ERROR]
    return results


_TITLE_ENDING_RE = re.compile(r"\s*(…|\.{2,3})\s*$")
ELLIPSIS_END = " …"


def title_text_length(title: str) -> int:
    """Length of the title as it will be once its ending is correct.

    A shortened title is counted with the required ending ' …' (2 characters),
    whatever ending it has now ('...', '..', '…'), so the count never changes
    when the fixer corrects the ending. The 60-character limit applies to the
    whole title, ' …' included."""
    t = title.strip()
    body = _TITLE_ENDING_RE.sub("", t)
    return len(body) + len(ELLIPSIS_END) if body != t else len(t)


def _check_title(q: Question, title: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    stem = q.stem.strip()
    t = title.strip()
    if not t:
        return [(ERROR, "Title is empty")]
    if not stem:
        return out
    ns, nt = _norm_quotes(stem), _norm_quotes(t)
    if re.search(r"(?<!\.)\.\.$", nt):
        return [(ERROR, "Title ends with two dots '..' — a shortened title must end with a space and the ellipsis ' …'")]
    ellipsis = nt.endswith("…")
    three_dots = nt.endswith("...")
    body = nt[:-1] if ellipsis else (nt[:-3] if three_dots else nt)
    body = body.rstrip()

    if three_dots:
        out.append((ERROR, "Title ends with three dots '...' — must end with a space and the ellipsis ' …'"))
    elif ellipsis and not nt.endswith(" …"):
        out.append((ERROR, "No space before the ellipsis — must end with a space and the ellipsis ' …'"))

    if not (ellipsis or three_dots):
        # Full question expected.
        if nt == ns:
            return out
        if nt.rstrip(".") == ns.rstrip("."):
            out.append((INFO, "Title differs from the question only by a trailing period"))
            return out
        if ns.startswith(nt):
            out.append((ERROR, "Title is a shortened question but does not end with a space and the ellipsis ' …'"))
        else:
            out.append((ERROR, "Title does not match the question text"))
        return out

    # Truncated title
    if not ns.startswith(body):
        k = next((i for i, (a, b) in enumerate(zip(ns, body)) if a != b), min(len(ns), len(body)))
        lo = max(0, k - 15)
        out.append((ERROR, "Title text is not the beginning of the question — they differ at "
                    f"“…{ns[lo:k + 15]}…” (question) vs “…{body[lo:k + 15]}…” (title)"))
        return out
    omitted = ns[len(body):]
    if len(ns) <= 60 and re.search(r"[A-Za-z0-9]", omitted.replace("_", "")):
        out.append((ERROR, f"The question is only {len(ns)} characters — the Title must be the whole question, without an ellipsis"))
    nxt = ns[len(body):len(body) + 1]
    if nxt and nxt.isalnum() and body and body[-1].isalnum():
        out.append((ERROR, "Title is cut in the middle of a word"))
    # Lengths include the required ending ' …' (the whole title must be ≤ 60).
    full_len = len(body) + len(ELLIPSIS_END)
    if full_len > 60:
        out.append((ERROR, f"Title is {full_len} characters including ' …' — the whole title must be 60 characters or fewer"))
    elif len(ns) > 60:
        # "First approximately 50–60 characters, end at a full word": a title
        # under 50 is too short only if at least one more full word still fits in 60.
        rest = ns[len(body):].lstrip()
        next_word = rest.split(" ", 1)[0] if rest else ""
        if full_len < 50 and next_word and len(body) + 1 + len(next_word) + len(ELLIPSIS_END) <= 60:
            out.append((ERROR, f"Title is too short ({full_len} characters including ' …') — more of the question fits; "
                               "use about 50–60 characters ending at a full word"))
    return out


# ── Main per-file check ─────────────────────────────────────────────────────

MOJIBAKE_RE = re.compile("�|â€|Ã[\u0080-¿]")
LO_VALUE_RE = re.compile(r"^\d+\.\d+(\s*,\s*\d+\.\d+)*$")


def check_file(cf: ChapterFile, reference_prefix: str) -> list[Issue]:
    issues: list[Issue] = []
    fn, ch = cf.filename, cf.chapter_no

    def add(rule, sev, msg, q: Optional[Question] = None, text="", line_idx: Optional[int] = None):
        issues.append(Issue(fn, ch, q.number if q else None, rule, sev, msg, text, (line_idx + 1) if line_idx is not None else None))

    # F1 chapter number
    if ch is None:
        add("F1", ERROR, "Chapter number not found in the filename (expected …_chNN.docx); chapter-based checks skipped")

    # F2 formatting
    blank = [l for l in cf.lines if l.is_blank]
    for l in blank:
        add("F2", ERROR, "Blank line — no blank lines are allowed", line_idx=l.idx)
    if cf.table_count:
        add("F2", ERROR, f"Document contains {cf.table_count} table(s) — plain text only")
    for l in cf.lines:
        if l.is_blank:
            continue
        flags = [n for n, v in (("list numbering/bullets", l.has_numbering), ("indentation", l.has_indent), ("font colour", l.has_color), ("highlight/shading", l.has_highlight)) if v]
        if flags:
            add("F2", ERROR, "Formatting not allowed: " + ", ".join(flags), text=l.text, line_idx=l.idx)

    # F3 images / equations
    if cf.image_count or cf.equation_count:
        parts = []
        if cf.image_count:
            parts.append(f"{cf.image_count} image(s)")
        if cf.equation_count:
            parts.append(f"{cf.equation_count} equation(s)")
        add("F3", WARNING, f"Document contains {' and '.join(parts)} — review image rendering and layout manually")

    # IMG1 Alt text checks
    def _find_q(line_idx: int) -> Optional[Question]:
        for q in cf.questions:
            if q.idx == line_idx:
                return q
            for _, bl in q.body:
                if bl.idx == line_idx:
                    return q
            if any(o.idx == line_idx for o in q.options):
                return q
            for attr in ("shuffle_line", "title_line", "lo_line", "ref_line"):
                ln_attr = getattr(q, attr, None)
                if ln_attr is not None and ln_attr.idx == line_idx:
                    return q
        cand = [q for q in cf.questions if q.idx <= line_idx]
        return cand[-1] if cand else None

    for img in cf.images:
        q_target = _find_q(img.line_idx)
        alt = (img.alt_text or "").strip()
        title = (img.title or "").strip()
        has_alt = bool(alt or title) or img.is_decorative
        if not has_alt:
            add("IMG1", ERROR, f"Image '{img.name}' is missing Alt text — all assessment images require descriptive Alt text for accessibility", q_target, line_idx=img.line_idx)
        else:
            alt_display = alt or title or ("(Marked as decorative)" if img.is_decorative else "")
            short_alt = (alt_display[:77] + "…") if len(alt_display) > 80 else alt_display
            add("IMG1", INFO, f"Image '{img.name}' Alt text: “{short_alt}”", q_target, text=alt_display, line_idx=img.line_idx)

    # Check if identical Alt text is reused across multiple questions in the same file
    alt_to_qs: dict[str, list[tuple[int, int]]] = {}
    for img in cf.images:
        q_t = _find_q(img.line_idx)
        alt = (img.alt_text or img.title or "").strip()
        if alt and not img.is_decorative and q_t is not None:
            alt_to_qs.setdefault(alt, []).append((q_t.number, img.line_idx))

    for alt, occurrences in alt_to_qs.items():
        unique_qs = sorted({qn for qn, _ in occurrences})
        if len(unique_qs) > 1:
            qs_list = ", ".join(f"Q{n}" for n in unique_qs)
            for q_num, l_idx in occurrences:
                q_obj = next((x for x in cf.questions if x.number == q_num), None)
                add("IMG1", WARNING, f"Identical Alt text is reused across multiple questions ({qs_list}) — confirm this image has specific Alt text", q_obj, line_idx=l_idx)

    # F4 mojibake
    for l in cf.lines:
        if MOJIBAKE_RE.search(l.text):
            add("F4", ERROR, "Garbled / replacement characters found", text=l.text, line_idx=l.idx)

    # Stray lines before Q1
    for l in cf.stray_lines:
        if LOOSE_QUESTION_RE.match(l.text):
            add("Q1", ERROR, "Line looks like a question but is not in the form 'N.<TAB>text'", text=l.text, line_idx=l.idx)
        else:
            add("X1", WARNING, "Text before the first question that is not a chapter header or instruction", text=l.text, line_idx=l.idx)

    if not cf.questions:
        add("Q1", ERROR, "No questions found (expected lines like '1.<TAB>Question text')")
        return issues

    # Q1 numbering
    expected = 1
    seen: set[int] = set()
    for q in cf.questions:
        if q.number in seen:
            add("Q1", ERROR, f"Duplicate question number {q.number}", q, q.raw, q.idx)
        elif q.number != expected:
            add("Q1", ERROR, f"Question number {q.number} found where {expected} was expected (gap or out of order)", q, q.raw, q.idx)
        seen.add(q.number)
        expected = q.number + 1

    ref_mismatches: list[tuple[Question, str, str, Optional[str]]] = []

    for q in cf.questions:
        # Q2
        if q.kind == "EMPTY":
            add("Q2", ERROR if not cf.image_count else WARNING,
                "Question text is empty" + (" (image-based question? review manually)" if cf.image_count else ""), q, q.raw, q.idx)

        # Unrecognised lines inside the block
        for role, l in q.body:
            if role != "other":
                continue
            if LOOSE_OPTION_RE.match(l.text):
                add("O1", ERROR, "Line looks like an option but is not in the form 'A.<TAB>text' / '*A.<TAB>text' (asterisk must be immediately before the letter)", q, l.text, l.idx)
            else:
                add("X1", WARNING, "Unrecognised line inside the question block", q, l.text, l.idx)

        # Options
        if q.kind == "TF":
            vals = [o.text for o in q.options]
            if sorted(vals) != ["False", "True"]:
                add("O3", ERROR, f"True/False question must have exactly one 'True' and one 'False' line (found: {', '.join(vals)})", q, q.raw, q.idx)
            for o in q.options:
                if o.raw.strip().endswith("."):
                    add("O3", WARNING, "True/False option has a trailing period", q, o.raw, o.idx)
        elif q.kind == "MC":
            if len(q.options) < 2:
                add("O4", ERROR, f"Multiple-choice question has {len(q.options)} option(s)", q, q.raw, q.idx)
            letters = [o.letter for o in q.options]
            exp = [chr(ord("A") + i) for i in range(len(letters))]
            if letters != exp:
                add("O1", ERROR, f"Option letters are {', '.join(letters)} — expected {', '.join(exp)} in order", q, q.raw, q.idx)
            for o in q.options:
                if not o.text:
                    add("O4", ERROR, f"Option {o.letter} is empty", q, o.raw, o.idx)
        elif q.kind == "ORDER":
            n = len(q.options)
            if q.order_positions != list(range(1, n + 1)):
                add("O1", ERROR, f"Ordering positions are {', '.join(map(str, q.order_positions))} — expected 1–{n} in order", q, q.raw, q.idx)
            letters = [o.letter for o in q.options]
            exp = {chr(ord("A") + i) for i in range(n)}
            if sorted(letters) != sorted(exp):
                add("O1", ERROR, f"Ordering letters {', '.join(letters)} should use each of {', '.join(sorted(exp))} exactly once", q, q.raw, q.idx)
            add("SH3", WARNING, "Ordering question — confirm by hand whether 'Shuffle: True' is wanted (the rules don't cover this type)", q, q.raw, q.idx)
        if q.kind in ("MC", "TF") and q.options:
            n = q.starred_count
            if n == 0:
                add("O2", ERROR, "No correct answer marked with an asterisk", q, q.raw, q.idx)
            elif n > 1:
                add("O2", ERROR, f"{n} answers marked with an asterisk — exactly one expected", q, q.raw, q.idx)

        # Shuffle
        sh = q.shuffle_line
        if sh is not None and sh.text != "Shuffle: True":
            add("SH1", ERROR, f"Shuffle line must be exactly 'Shuffle: True' (found '{sh.text}')", q, sh.text, sh.idx)
        if sh is not None:
            roles = [r for r, _ in q.body]
            si = roles.index("shuffle")
            prev = roles[si - 1] if si > 0 else None
            nxt = roles[si + 1] if si + 1 < len(roles) else None
            if prev not in ("option", "tf", "order") or nxt != "title":
                add("SH2", ERROR, "Shuffle line must come directly after the last option and directly before the Title line", q, sh.text, sh.idx)
        should, reason, review = shuffle_decision(q)
        if q.kind == "EMPTY":
            should = None  # image-only question: can't judge, already flagged by Q2
        if should is not None:
            if should and sh is None:
                add("SH3", WARNING if review else ERROR, f"'Shuffle: True' is missing — {reason}", q, q.raw, q.idx)
            elif not should and sh is not None:
                if review:
                    add("SH3", WARNING, f"Check 'Shuffle: True' — {reason}", q, sh.text, sh.idx)
                else:
                    add("SH3", ERROR, f"'Shuffle: True' must not be used — {reason}", q, sh.text, sh.idx)
            elif should and review:
                add("SH3", WARNING, reason, q, q.raw, q.idx)

        # Title
        if q.title_line is None:
            add("T1", ERROR, "Title line is missing", q, q.raw, q.idx)
        else:
            raw = q.title_line.text
            if not raw.startswith("Title: "):
                add("T1", ERROR, "Title line must start with 'Title: ' (one space)", q, raw, q.title_line.idx)
            title_val = re.sub(r"^Title\s*:\s*", "", raw, flags=re.I)
            if q.kind != "EMPTY":  # empty (image-only) question is already flagged by Q2
                for sev, msg in check_title(q, title_val):
                    add("T1", sev, msg, q, raw, q.title_line.idx)

        # Learning Outcome
        if q.lo_line is None:
            add("L1", ERROR, "Learning Outcome line is missing", q, q.raw, q.idx)
        else:
            raw = q.lo_line.text
            val = re.sub(r"^Learning\s*Outcome\s*:\s*", "", raw, flags=re.I).strip()
            if not val:
                add("L1", ERROR, "Learning Outcome is empty", q, raw, q.lo_line.idx)
            else:
                if not raw.startswith("Learning Outcome: ") or raw.startswith("Learning Outcome:  "):
                    add("L1", ERROR, "Must be 'Learning Outcome: ' followed by the value (exactly one space)", q, raw, q.lo_line.idx)
                if not LO_VALUE_RE.match(val):
                    hint = f" — did you mean '{val.replace('-', '.').replace(chr(0x2013), '.')}'?" if re.fullmatch(r"\d+\s*[-–]\s*\d+", val) else ""
                    add("L1", ERROR, f"Learning Outcome '{val}' is not in the form N.N (or a comma-separated list){hint}", q, raw, q.lo_line.idx)
                elif ch is not None:
                    chapters = {int(v.split(".")[0]) for v in re.split(r"\s*,\s*", val)}
                    if chapters != {ch}:
                        add("L1", ERROR, f"Learning Outcome '{val}' does not belong to chapter {ch}", q, raw, q.lo_line.idx)

        # Reference (mismatches collected first so a file-wide pattern can be
        # reported once instead of on every question)
        if q.ref_line is None:
            add("R1", ERROR, "Reference line is missing", q, q.raw, q.idx)
        else:
            raw = q.ref_line.text
            val = re.sub(r"^Reference\s*:\s*", "", raw, flags=re.I).strip()
            if not raw.startswith("Reference: "):
                add("R1", ERROR, "Reference line must start with 'Reference: ' (one space)", q, raw, q.ref_line.idx)
            if ch is not None:
                expected_ref = f"{reference_prefix}{ch:02d}_{q.number:03d}"
                if val != expected_ref:
                    ref_mismatches.append((q, val, expected_ref, _ref_problem(val, reference_prefix, ch, q.number)))

        # Line order / duplicates
        label = {"title": "Title", "lo": "Learning Outcome", "ref": "Reference", "shuffle": "Shuffle"}
        for role, l in q.extra_lines:
            where = "after the Reference line" if q.ref_line is not None and l.idx > q.ref_line.idx else "in this question"
            add("R2", ERROR, f"Extra {label.get(role, role)} line {where} (stray/duplicate line)", q, l.text, l.idx)
        order = [r for r, _ in q.body if r not in ("other", "image")]
        expected_order = [r for r in order if r in ("option", "tf", "order")]
        if q.shuffle_line is not None:
            expected_order.append("shuffle")
        expected_order += [r for r in ("title", "lo", "ref") if getattr(q, {"title": "title_line", "lo": "lo_line", "ref": "ref_line"}[r]) is not None]
        dedup = []
        for r in order:
            if r in ("shuffle", "title", "lo", "ref") and r in dedup:
                continue
            dedup.append(r)
        if dedup != expected_order and not q.extra_lines:
            add("R2", ERROR, "Lines are out of order — expected: options → (Shuffle) → Title → Learning Outcome → Reference", q, q.raw, q.idx)

    # Reference mismatches: one file-level issue when every reference in the
    # file has the same single problem (e.g. the whole file uses another prefix).
    with_ref = [q for q in cf.questions if q.ref_line is not None]
    problems = {p for _, _, _, p in ref_mismatches}
    if ref_mismatches and len(ref_mismatches) == len(with_ref) and len(problems) == 1 and None not in problems:
        q0, v0, e0, p0 = ref_mismatches[0]
        add("R1", ERROR, f"All {len(ref_mismatches)} references in this file {p0} (e.g. '{v0}' — expected '{e0}')", text=q0.ref_line.text)
    else:
        for q, val, exp, _ in ref_mismatches:
            add("R1", ERROR, f"Reference '{val}' — expected '{exp}'", q, q.ref_line.text, q.ref_line.idx)

    return issues


_REF_PARTS_RE = re.compile(r"^(.*?)(\d{2,3})_(\d+)$")


def _ref_problem(val: str, prefix: str, ch: int, qn: int) -> Optional[str]:
    """Describe what is wrong with a reference in a question-independent way,
    or None if the problem is question-specific (e.g. wrong question number)."""
    m = _REF_PARTS_RE.match(val)
    if not m:
        return None
    p, c, n = m.groups()
    if int(n) != qn or len(n) != 3 or int(c) != ch:
        return None
    parts = []
    if p != prefix:
        parts.append(f"use the prefix '{p}' instead of '{prefix}'")
    if c != f"{ch:02d}":
        parts.append(f"use a {len(c)}-digit chapter number '{c}'")
    return " and ".join(parts) if parts else None


def check_run(files: list[ChapterFile], reference_prefix: str) -> list[Issue]:
    """Check every file plus cross-file rules (chapter gaps, duplicate references)."""
    issues: list[Issue] = []
    for cf in files:
        issues.extend(check_file(cf, reference_prefix))

    # Duplicate chapter numbers / gaps
    chapters = [cf.chapter_no for cf in files if cf.chapter_no is not None]
    dup_ch = {c for c in chapters if chapters.count(c) > 1}
    for c in sorted(dup_ch):
        names = ", ".join(cf.filename for cf in files if cf.chapter_no == c)
        issues.append(Issue("(run)", c, None, "F1", WARNING, f"Chapter {c} appears in more than one file: {names}"))
    if len(set(chapters)) > 1:
        full = set(range(min(chapters), max(chapters) + 1))
        missing = sorted(full - set(chapters))
        if missing:
            issues.append(Issue("(run)", None, None, "F1", INFO, "No file uploaded for chapter(s): " + ", ".join(map(str, missing))))

    # Duplicate reference IDs across the run
    seen: dict[str, str] = {}
    for cf in files:
        for q in cf.questions:
            if q.ref_line is None:
                continue
            val = re.sub(r"^Reference\s*:\s*", "", q.ref_line.text, flags=re.I).strip()
            if not val:
                continue
            where = f"{cf.filename} Q{q.number}"
            expected_ref = f"{reference_prefix}{cf.chapter_no:02d}_{q.number:03d}" if cf.chapter_no is not None else None
            if val in seen and val != expected_ref:
                pass  # already reported as "expected …" for this question
            elif val in seen:
                issues.append(Issue(cf.filename, cf.chapter_no, q.number, "R1", ERROR, f"Reference '{val}' is not unique (also used in {seen[val]})", q.ref_line.text, q.ref_line.idx + 1))
            else:
                seen[val] = where
    return issues


def check_alt_text_file(cf: ChapterFile) -> list[Issue]:
    """Check only image Alt text for any Word document (no EOC rules required)."""
    issues: list[Issue] = []
    fn, ch = cf.filename, cf.chapter_no

    def add(rule, sev, msg, text="", line_idx: Optional[int] = None):
        issues.append(Issue(fn, ch, None, rule, sev, msg, text, (line_idx + 1) if line_idx is not None else None))

    if not cf.images:
        add("IMG1", INFO, "No images found in this document")
        return issues

    for img in cf.images:
        alt = (img.alt_text or "").strip()
        title = (img.title or "").strip()
        has_alt = bool(alt or title) or img.is_decorative
        lbl = img.line_label or f"¶{img.line_idx + 1}"
        if not has_alt:
            ctx_hint = f" (near: “{img.context[:40]}…”)" if img.context else ""
            add("IMG1", ERROR, f"Image '{img.name}' ({lbl}){ctx_hint} is missing Alt text — all images require descriptive Alt text for accessibility", text=img.context, line_idx=img.line_idx)
        else:
            alt_display = alt or title or ("(Marked as decorative)" if img.is_decorative else "")
            short_alt = (alt_display[:77] + "…") if len(alt_display) > 80 else alt_display
            ctx_hint = f" (near: “{img.context[:30]}…”)" if img.context else ""
            add("IMG1", INFO, f"Image '{img.name}' ({lbl}){ctx_hint} Alt text: “{short_alt}”", text=alt_display, line_idx=img.line_idx)

    # Check duplicate alt text across images in this document
    alt_counts: dict[str, list[ImageMeta]] = {}
    for img in cf.images:
        alt = (img.alt_text or img.title or "").strip()
        if alt and not img.is_decorative:
            alt_counts.setdefault(alt, []).append(img)

    for alt, imgs in alt_counts.items():
        if len(imgs) > 1:
            lbls = ", ".join(im.line_label or f"¶{im.line_idx+1}" for im in imgs)
            for im in imgs:
                add("IMG1", WARNING, f"Identical Alt text is reused across multiple images ({lbls}) — confirm this image has specific Alt text", text=alt, line_idx=im.line_idx)

    return issues


def check_alt_text_run(files: list[ChapterFile]) -> list[Issue]:
    """Check image Alt text across all uploaded documents."""
    issues: list[Issue] = []
    for cf in files:
        issues.extend(check_alt_text_file(cf))
    return issues
