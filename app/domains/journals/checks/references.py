"""Stage 1 reference validation: numbered (Vancouver-style) citations against the reference list."""
import re
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from typing import Callable, Dict, List, Optional

from app.domains.journals.checks.base import CheckResult, IssueDraft, JournalCheck, register
from app.domains.journals.checks.structuring import active_stylesheet
from app.domains.journals.manuscript import heading_level, load_blocks, resolve_manuscript_path, snippet

REF_HEADINGS = {"references", "reference list", "bibliography", "literature cited", "works cited"}
CITATION = re.compile(r"\[(\d+(?:\s*[-–,]\s*\d+)*)\]")
# Numbered citations in parentheses, e.g. "(1)", "(2, 3)", "(4–6)". Up to 3 digits so years like (2019) don't match.
PAREN_CITATION = re.compile(r"\((\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\)")


def citation_pattern(texts) -> "re.Pattern":
    """The manuscript's numbered citation style: [n] or (n), whichever occurs more in the body text."""
    brackets = parens = 0
    for t in texts:
        brackets += len(CITATION.findall(t))
        parens += len(PAREN_CITATION.findall(t))
    return PAREN_CITATION if parens > brackets else CITATION


def cite_label(pattern, n) -> str:
    return f"({n})" if pattern is PAREN_CITATION else f"[{n}]"
REF_NUMBER = re.compile(r"^\[?(\d{1,4})[\].)]?\s+")
YEAR = re.compile(r"\b(1[89]\d{2}|20\d{2})[a-z]?\b")
DOI = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+?)[.,;]?(?=\s|$)")
RULES = ("REF-X01", "REF-C01", "REF-O01", "REF-F03", "REF-D01", "REF-D02", "REF-D03")
MATCH_THRESHOLD = 0.9
MAX_LOOKUPS = 60


def default_crossref_lookup(title: str, year: Optional[str]) -> List[dict]:
    from app.domains.review.reference_search_service import search_crossref
    return search_crossref(title, year=year, max_results=3)


# Tests replace this to avoid network calls.
crossref_lookup: Callable[[str, Optional[str]], List[dict]] = default_crossref_lookup


def expand(group: str) -> List[int]:
    nums = []
    for part in re.split(r"\s*,\s*", group):
        if re.search(r"[-–]", part):
            a, b = [int(x) for x in re.split(r"\s*[-–]\s*", part)]
            nums.extend(range(a, b + 1) if b >= a and b - a < 200 else [a, b])
        elif part:
            nums.append(int(part))
    return nums


def guess_title(ref_text: str) -> str:
    """Vancouver order is 'Authors. Title. Source. Year;...' — take the second sentence."""
    parts = [p.strip() for p in re.split(r"\.\s+", ref_text) if p.strip()]
    return parts[1] if len(parts) >= 3 else (parts[0] if parts else ref_text)


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()


ZONE_MARKER = re.compile(r"^\s*</?[\w-]+>\s*$")  # structuring_lib's "<ref-open>" / "<ref-close>" paragraphs


REF_OPEN = re.compile(r"^\s*<ref-open>\s*$", re.I)
REF_CLOSE = re.compile(r"^\s*<ref-close>\s*$", re.I)


# Back matter that follows the reference list; structuring can tag it REF-U when there is no <ref-close>.
_ZONE_END = re.compile(
    r"^\s*(?:abbreviations|acknowledge?ments?|conflicts? of interest|competing interests|funding|"
    r"authors?'? contributions|data availability|multimedia appendix|supplementary material|appendix)\s*:?\s*$"
    r"|^\s*(?:edited by|please cite as)\b", re.I)


def _ends_reference_zone(text: str) -> bool:
    return bool(_ZONE_END.match(text or ""))


def _is_numbered_style(style: str) -> bool:
    s = (style or "").lower()
    return s.startswith("ref-n") or "numbered" in s


def _is_reference_entry(b) -> bool:
    """A REF-N / REF-U paragraph (or the tag set's name for them, e.g. Reference-Numbered)."""
    return b.category == "References" and bool(b.text) and not heading_level(b.category) and not ZONE_MARKER.match(b.text)


def find_reference_blocks(blocks):
    """The reference entries: REF-N / REF-U paragraphs between <ref-open> and <ref-close>. Without
    those markers, the REF-N / REF-U paragraphs under the References heading (up to the next heading),
    so REF-styled paragraphs elsewhere, such as a mis-tagged abbreviation list, are left out."""
    opens = [i for i, b in enumerate(blocks) if REF_OPEN.match(b.text or "")]
    if opens:
        out = []
        for start in opens:
            for b in blocks[start + 1:]:
                if REF_CLOSE.match(b.text or "") or REF_OPEN.match(b.text or ""):
                    break
                if _is_reference_entry(b):
                    out.append(b)
        return out
    for i, b in enumerate(blocks):
        if b.text.strip().rstrip(":").lower() in REF_HEADINGS:
            tagged, numbered = [], False
            for nb in blocks[i + 1:]:
                if heading_level(nb.category) or nb.category == "Reference Heading" or _ends_reference_zone(nb.text):
                    break
                if _is_reference_entry(nb):
                    is_n = _is_numbered_style(nb.style)
                    if numbered and not is_n:
                        break  # an unnumbered REF-U after a numbered list is back matter, not a reference
                    numbered = numbered or is_n
                    tagged.append(nb)
            if tagged:
                return tagged
            break
    tagged = [b for b in blocks if _is_reference_entry(b)]
    if tagged:
        return tagged
    for i, b in enumerate(blocks):
        if b.text.strip().rstrip(":").lower() in REF_HEADINGS:
            out = []
            for nb in blocks[i + 1:]:
                if heading_level(nb.category) or nb.text.strip().rstrip(":").lower() in ("appendix", "supplementary material"):
                    break
                if nb.text:
                    out.append(nb)
            return out
    return []


@register
class ReferencesCheck(JournalCheck):
    key = "references"
    name = "Reference validation"

    def run(self, article, db) -> CheckResult:
        path = resolve_manuscript_path(db, article)
        if not path:
            raise FileNotFoundError("No manuscript DOCX is attached to this article")
        sheet = active_stylesheet(db, article)
        ref_rules = ((sheet.style_rules if sheet else None) or {}).get("references") or {}
        use_crossref = bool(ref_rules.get("crossref_lookup", True))

        blocks = load_blocks(path)
        ref_blocks = find_reference_blocks(blocks)
        ref_ids = {b.idx for b in ref_blocks}
        issues: List[IssueDraft] = []

        if not ref_blocks:
            return CheckResult(issues=[IssueDraft(
                rule_id="REF-L00", severity="warning", title="No reference list found",
                message="No paragraph is tagged as a reference and no References heading was found.",
                fingerprint="REF-L00",
            )], rules_total=len(RULES) + 1)

        refs: Dict[int, object] = {}
        for pos, b in enumerate(ref_blocks, start=1):
            m = REF_NUMBER.match(b.text)
            refs[int(m.group(1)) if m else pos] = b

        # Citations in the body (everything outside the reference list), in [n] or (n) style.
        body = [b for b in blocks if b.idx not in ref_ids and b.text]
        form = ref_rules.get("citation_form", "auto")  # set in the journal style sheet
        pattern = CITATION if form == "brackets" else PAREN_CITATION if form == "parens" else citation_pattern(b.text for b in body)
        citations = []  # (number, block, start, match_text)
        for b in body:
            for m in pattern.finditer(b.text):
                for n in expand(m.group(1)):
                    citations.append((n, b, m.start(), m.group(0)))

        if not citations:
            issues.append(IssueDraft(
                rule_id="REF-S00", severity="info", title="No numbered citations found",
                message="The text has no [n] or (n) citations. Author–year citation matching is not supported yet, so citation checks were skipped.",
                fingerprint="REF-S00",
            ))
        else:
            cited = set()
            for n, b, start, text in citations:
                if n not in refs:
                    issues.append(IssueDraft(
                        rule_id="REF-X01", severity="error", title=f"Citation {cite_label(pattern, n)} has no matching reference",
                        message=f"The reference list has {len(refs)} entries and none is numbered {n}.",
                        location={"block_id": b.block_id, "para_idx": b.idx, "start": start, "end": start + len(text), "surface": text},
                        context_snippet=snippet(b.text, start, len(text)),
                        fingerprint=f"REF-X01:{b.block_id}:{start}:{n}",
                    ))
                cited.add(n)

            for n, rb in sorted(refs.items()):
                if n not in cited:
                    issues.append(IssueDraft(
                        rule_id="REF-C01", severity="warning", title=f"Reference {n} is never cited",
                        message="Query the author: add a citation in the text or delete the reference.",
                        location={"block_id": rb.block_id, "para_idx": rb.idx},
                        context_snippet=snippet(rb.text, 0, 0, 80), fingerprint=f"REF-C01:{n}",
                    ))

            order, seen = [], set()
            for n, b, start, text in citations:
                if n in refs and n not in seen:
                    seen.add(n)
                    order.append((n, b, start, text))
            expected = 1
            for n, b, start, text in order:
                if n > expected:
                    issues.append(IssueDraft(
                        rule_id="REF-O01", severity="warning", title=f"Reference {n} is cited before reference {expected}",
                        message="Numbered styles number references in order of first citation.",
                        location={"block_id": b.block_id, "para_idx": b.idx, "start": start, "end": start + len(text), "surface": text},
                        context_snippet=snippet(b.text, start, len(text)), fingerprint="REF-O01",
                    ))
                    break
                expected = max(expected, n + 1)

        lookups = []
        for n, rb in sorted(refs.items()):
            clean_text = (rb.text or "").replace("\xa0", " ").replace("\u200b", " ").replace("\ufeff", " ").replace("\u00ad", "")
            text = REF_NUMBER.sub("", clean_text)
            loc = {"block_id": rb.block_id, "para_idx": rb.idx}
            year = YEAR.search(text) or re.search(r"(1[89]\d{2}|20\d{2})", text)
            if not year and not re.search(r"in press|forthcoming|n\.d\.", text, re.I):
                issues.append(IssueDraft(
                    rule_id="REF-F03", severity="error", title=f"Reference {n} has no publication year",
                    message="Every reference needs a year, or “in press”.",
                    location=loc, context_snippet=snippet(text, 0, 0, 80), fingerprint=f"REF-F03:{n}",
                ))
            doi = DOI.search(text)
            if re.search(r"\bdoi\b", text, re.I) and not doi:
                issues.append(IssueDraft(
                    rule_id="REF-D01", severity="warning", title=f"Reference {n} has a malformed DOI",
                    message="A DOI starts with “10.” followed by a registrant code and a suffix, e.g. 10.1016/j.jais.2026.04.001.",
                    location=loc, context_snippet=snippet(text, 0, 0, 80), fingerprint=f"REF-D01:{n}",
                ))
            if use_crossref and len(lookups) < MAX_LOOKUPS:
                year_str = year.group(1) if (year and year.groups) else year.group(0) if year else None
                lookups.append((n, rb, text, guess_title(text), year_str, doi.group(1) if doi else None))

        unverified = 0

        def lookup(item):
            try:
                return item, crossref_lookup(item[3], item[4])
            except Exception:
                return item, None

        if lookups:
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lookup, lookups))
            for (n, rb, text, title, year, doi), found in results:
                if found is None:
                    unverified += 1
                    continue
                best = max(found, key=lambda r: SequenceMatcher(None, _norm(r.get("title")), _norm(title)).ratio(), default=None)
                if not best or not best.get("doi"):
                    continue
                score = SequenceMatcher(None, _norm(best.get("title")), _norm(title)).ratio()
                if score < MATCH_THRESHOLD:
                    continue
                loc = {"block_id": rb.block_id, "para_idx": rb.idx}
                if doi and doi.lower() != best["doi"].lower():
                    start = rb.text.find(doi)
                    issues.append(IssueDraft(
                        rule_id="REF-D02", severity="warning", title=f"Reference {n}: DOI does not match Crossref",
                        message=f"Crossref matches this title to {best['doi']} (title similarity {score:.0%}).",
                        location={**loc, "start": start, "end": start + len(doi), "surface": doi} if start >= 0 else loc,
                        context_snippet=snippet(rb.text, max(start, 0), len(doi)),
                        suggestion={"type": "replace", "from": doi, "to": best["doi"]}, fingerprint=f"REF-D02:{n}",
                    ))
                elif not doi:
                    issues.append(IssueDraft(
                        rule_id="REF-D03", severity="info", title=f"Reference {n}: DOI available from Crossref",
                        message=f"Crossref has {best['doi']} for this title (similarity {score:.0%}).",
                        location=loc, context_snippet=snippet(text, 0, 0, 80),
                        suggestion={"type": "append", "to": f" doi:{best['doi']}"}, fingerprint=f"REF-D03:{n}",
                    ))

        if unverified:
            issues.append(IssueDraft(
                rule_id="REF-D00", severity="info", title=f"Crossref lookup failed for {unverified} reference(s)",
                message="Crossref could not be reached. Run the check again to verify DOIs.", fingerprint="REF-D00",
            ))

        return CheckResult(issues=issues, rules_total=len(RULES), rule_set_version="Vancouver (numbered)")
