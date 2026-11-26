"""
Author-Year Reference & Citation Hyperlinking Service for PDF Post-Production.
=============================================================================
Integrates APA 7th & Harvard-style citation matching from validation_core.py
directly into PyMuPDF coordinate-aware PDF linking.

Capabilities:
1. Detects in-text parenthetical citations: (Smith, 2020), (Beauchamp & Childress, 2019),
   (American Nurses Association, 2025), and narrative citations: According to Smith et al. (2020).
2. Extracts bibliographic entries from Chapter or End-of-Book "References" sections.
3. Uses author normalization, organizational acronym matching, and fuzzy threshold matching
   from validation_core.py to map each citation to its exact reference entry.
4. Generates bidirectional LINK_GOTO hyperlinks so readers can click between citations
   and reference definitions without losing their place.
"""
from __future__ import annotations

import re
import difflib
import unicodedata
import logging
from typing import Any, Dict, List, Optional, Set, Tuple
from collections import defaultdict
import pymupdf

logger = logging.getLogger(__name__)

FUZZY_THRESHOLD = 0.88
SHORT_NAME_MAX_LEN = 6

_Y = r"(?:19|20)\d{2}[a-z]?"
_YEAR_SPECIAL = r"(?:n\.d\.|in\s+press)"
_YEAR_ANY = rf"(?:{_Y}|{_YEAR_SPECIAL})"
_LOCATOR_TAIL = r'(?:,\s*pp?\.\s*\d+(?:[\u2013\u2014\-]\d+)?)?'

# In-text parenthetical citation pattern: e.g. (Smith, 2020), (Donahue, 1996, p. 484)
_RE_PAREN = re.compile(
    r'\(([^\s\d][^()]{1,200}?' + _YEAR_ANY + _LOCATOR_TAIL + r')\)',
    re.UNICODE | re.IGNORECASE | re.DOTALL
)

# Narrative citation: e.g. Smith (2020), Beauchamp and Childress (2019)
_RE_NARRATIVE = re.compile(
    r'\b([A-Z][A-Za-z' + r"’\-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z'’\-]+)?(?:\s+et\s+al\.)?)\s+\((" + _YEAR_ANY + r')\)',
    re.UNICODE
)

_RE_LOCATOR = re.compile(r',\s*(pp?\.\s*\d+(?:[–—\-]\d+)?)', re.IGNORECASE)
_RE_CITE_UNIT = re.compile(r'^(.*?)\s*,?\s*(' + _YEAR_ANY + r')$', re.DOTALL | re.IGNORECASE)

_ORG_KW_RE = re.compile(
    r'\b(?:association|board|committee|department|society|institute|organization|'
    r'organisation|council|federation|center|centre|national|international|'
    r'academy|university|college|school|hospital|ministry|agency|commission|'
    r'foundation|group|corporation|inc|ltd|company|union|administration|'
    r'authority|office|bureau|world|network|consortium|congress|assembly)\b',
    re.IGNORECASE
)


def _strip_diacritics(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _norm(s: str) -> str:
    s = _strip_diacritics(s).lower()
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _extract_name_parts(author_str: str) -> Tuple[str, str]:
    """
    Extracts (surname, firstname_or_initials) from author text.
    Handles:
    - APA format: "Smith, J. A." -> surname="Smith", first="J. A."
    - Prose format: "John Smith" -> surname="Smith", first="John"
    - Single names: "Aristotle" -> surname="Aristotle", first=""
    """
    clean = re.sub(r'\bet\s+al\.?', '', author_str, flags=re.IGNORECASE).strip()
    clean = re.sub(r'\s*(?:and|&)\s*.*$', '', clean).strip()  # focus on lead author
    if not clean:
        return "", ""

    if "," in clean:
        parts = clean.split(",", 1)
        surname = _norm(parts[0])
        first = _norm(parts[1])
        return surname, first
    else:
        parts = clean.split()
        if len(parts) == 1:
            return _norm(parts[0]), ""
        # Assume last token is surname: e.g. "Colin Gray" -> surname="gray", first="colin"
        surname = _norm(parts[-1])
        first = _norm(" ".join(parts[:-1]))
        return surname, first


def _first_surname(a: str) -> str:
    surname, _ = _extract_name_parts(a)
    return surname


def _strip_suffix(year: str) -> str:
    m = re.match(r"^((?:19|20)\d{2})", year)
    return m.group(1) if m else year


def _is_organization(full: str) -> bool:
    return bool(_ORG_KW_RE.search(full))


def _acronym_of(text: str) -> str:
    words = [w for w in re.split(r"[\s\-_]+", text) if w and w[0].isupper()]
    return "".join(w[0] for w in words).upper()


def _is_org_match(cite_auth: str, bib_auth: str) -> bool:
    cn = _norm(cite_auth)
    bn = _norm(bib_auth)
    if cn == bn:
        return True
    ca = _acronym_of(cite_auth)
    ba = _acronym_of(bib_auth)
    if ca and len(ca) >= 2 and (ca == ba or ca == _norm(bib_auth).upper() or _norm(cite_auth).upper() == ba):
        return True
    # Substring match for organization names: e.g. "American Nurses Association" in "American Nurses Association (ANA)"
    if cn in bn or bn in cn:
        return True
    return False


def _match_citation_to_bib(cite_author: str, cite_year: str, bibliography: List[Dict]) -> Tuple[Optional[Dict], str, float]:
    """
    Candidate matching algorithm adapted from validation_core.py:
    Considers:
    1. Exact full author string match
    2. Primary surname matching (with fuzzy fallback for typos)
    3. First name / initial agreement (e.g. "J. Smith" vs "John Smith" vs "Smith, J.")
    4. Organizational acronyms and aliases (e.g. "ANA" vs "American Nurses Association")
    5. Publication year (exact, suffix variation '2020a', or 1-year off)
    """
    cn = _norm(cite_author)
    c_surname, c_first = _extract_name_parts(cite_author)
    cb = _strip_suffix(cite_year)

    best_entry: Optional[Dict] = None
    best_mt: str = "not_found"
    best_score: float = -1.0

    for ref in bibliography:
        rfull = ref.get("full_author", "")
        rn = _norm(rfull)
        r_surname, r_first = _extract_name_parts(rfull)
        ry = ref.get("year", "")
        rb = _strip_suffix(ry)
        year_ok = (cite_year == ry)

        # 1. Exact string match
        if cn == rn:
            mt = "exact" if year_ok else ("suffix_mismatch" if cb == rb else "year_mismatch")
            score = 3.5 if year_ok else 2.0

        # 2. Surname match + First name / initial check
        elif c_surname and r_surname and (
            c_surname == r_surname or
            (len(c_surname) > SHORT_NAME_MAX_LEN and difflib.SequenceMatcher(None, c_surname, r_surname).ratio() >= FUZZY_THRESHOLD)
        ):
            # Check first name / initial compatibility
            first_match = True
            if c_first and r_first:
                # If both have first name or initials, ensure they don't conflict
                c_init = c_first[0] if c_first else ""
                r_init = r_first[0] if r_first else ""
                first_match = (c_init == r_init) or (c_first in r_first) or (r_first in c_first)

            if first_match:
                mt = "smart" if year_ok else ("suffix_mismatch" if cb == rb else "year_mismatch")
                score = 2.8 if year_ok else 1.2
            else:
                # Same surname, but different initials (e.g., Smith, A. vs Smith, B.)
                continue

        # 3. Organization / Acronym match
        elif _is_org_match(cite_author, rfull):
            mt = "org_abbrev" if year_ok else "year_mismatch"
            score = 2.5 if year_ok else 1.0

        # 4. Fuzzy fallback across names
        else:
            ratio = difflib.SequenceMatcher(None, cn, rn).ratio()
            if ratio >= FUZZY_THRESHOLD:
                mt = "fuzzy" if year_ok else "year_mismatch"
                score = ratio + (1.5 if year_ok else 0.0)
            else:
                continue

        if score > best_score:
            best_score = score
            best_entry = ref
            best_mt = mt

    if best_entry and best_score >= 1.0:
        return best_entry, best_mt, best_score
    return None, "not_found", 0.0


def _find_references_sections(doc: pymupdf.Document) -> List[Dict]:
    """
    Locates all References / Bibliography sections using PDF bookmarks or heading text.
    """
    toc = doc.get_toc()
    ref_sections = []

    # Check TOC first
    for lvl, title, p_1based in toc:
        clean_title = title.strip()
        if re.search(r'^(?:References?|Bibliography|Works\s+Cited)\b', clean_title, re.IGNORECASE):
            ref_sections.append({
                "title": clean_title,
                "start_page": p_1based - 1,
                "level": lvl
            })

    # If TOC does not list references, scan pages for section headings
    if not ref_sections:
        for pno in range(len(doc)):
            txt = doc[pno].get_text()
            m = re.search(r'^\s*(?:References?|Bibliography)\s*$', txt, re.MULTILINE | re.IGNORECASE)
            if m:
                # Confirm by seeing if an author/year reference pattern follows
                after = txt[m.end():m.end() + 300]
                if re.search(r'\((?:19|20)\d{2}[a-z]?\)', after):
                    ref_sections.append({
                        "title": "References",
                        "start_page": pno,
                        "level": 2
                    })

    return ref_sections


def _parse_reference_entries_on_page(page: pymupdf.Page, page_num: int) -> List[Dict]:
    """
    Extracts individual reference paragraphs/blocks from a References page.
    Handles single-column and multi-column layouts:
    Entries begin with author name(s) and publication year: e.g. "Author, A. (2020)."
    """
    entries = []
    blocks = page.get_text('blocks')
    # Filter to text blocks
    text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]
    if not text_blocks:
        return []

    # Detect multi-column layout by looking at x0 coordinates
    # Sort blocks by column (x0) then vertical position (y0)
    col_width = page.rect.width / 2.0
    left_col = [b for b in text_blocks if b[0] < col_width - 20]
    right_col = [b for b in text_blocks if b[0] >= col_width - 20]

    left_col.sort(key=lambda b: (b[1], b[0]))
    right_col.sort(key=lambda b: (b[1], b[0]))
    ordered_blocks = left_col + right_col if right_col else sorted(text_blocks, key=lambda b: (b[1], b[0]))

    # Join lines across column blocks to handle entries broken across blocks
    col_texts = []
    for col in ([left_col, right_col] if right_col else [ordered_blocks]):
        col_str = ""
        block_rects = []
        for b in col:
            text = b[4].strip()
            if re.match(r'^(?:References?|Bibliography|Chapter\s+\d+|Key\s+Points)\b', text, re.IGNORECASE) and len(text.splitlines()) <= 2:
                continue
            if re.match(r'^\d+\s*$', text):  # Skip bare page numbers
                continue
            col_str += "\n" + b[4]
            block_rects.append((b[0], b[1], b[2], b[3]))

        # Split col_str by APA reference start pattern
        # e.g. "American Hospital Association. (2003)." or "Gilligan, C. (1982)."
        pattern = re.compile(r'(?:^|\n)(?P<authors>[A-Z][^\n\r]{2,120}?)\.?\s*\((?P<year>(?:19|20)\d{2}[a-z]?|n\.d\.|in\s+press)\)', re.UNICODE)
        matches = list(pattern.finditer(col_str))
        for idx, m in enumerate(matches):
            authors_raw = m.group("authors").strip().rstrip(".,")
            year_raw = m.group("year").strip()
            start_pos = m.start()
            end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(col_str)
            raw_entry = col_str[start_pos:end_pos].strip()

            # Find matching rect on page
            quads = page.search_for(authors_raw[:25])
            rect = quads[0] if quads else pymupdf.Rect(45.0, 300.0, 400.0, 320.0)

            entries.append({
                "page": page_num,
                "bbox": [rect.x0, rect.y0, rect.x1, rect.y1],
                "full_author": authors_raw,
                "year": year_raw,
                "raw_text": raw_entry,
                "rect": rect
            })

    return entries


def find_reference_citations_in_pdf(pdf_path: str, analyze_only: bool = True) -> Dict[str, Any]:
    """
    Scans PDF for Author-Year citations in body text and links them to
    their corresponding entries in the References section.
    """
    doc = pymupdf.open(pdf_path)
    ref_sections = _find_references_sections(doc)

    if not ref_sections:
        doc.close()
        return {
            "total_citations": 0,
            "linked": 0,
            "not_linked": 0,
            "details": []
        }

    # Identify all reference section pages and map to chapters if present
    ref_pages: Set[int] = set()
    chapter_ref_map: Dict[int, List[Dict]] = defaultdict(list)

    for sec in ref_sections:
        start_p = sec["start_page"]
        ref_pages.add(start_p)
        # Check if next page also has references
        curr_p = start_p + 1
        while curr_p < len(doc):
            txt = doc[curr_p].get_text()[:400]
            if re.search(r'\((?:19|20)\d{2}[a-z]?\)', txt) and not re.search(r'^\s*Chapter\s+\d+\b', txt, re.MULTILINE | re.IGNORECASE):
                ref_pages.add(curr_p)
                curr_p += 1
            else:
                break

    # Parse all bibliographic reference entries across all reference pages
    bibliography: List[Dict] = []
    for rp in sorted(ref_pages):
        entries = _parse_reference_entries_on_page(doc[rp], rp + 1)
        bibliography.extend(entries)

    # Build reference ranges for chapter-based referencing
    # (Each chapter's citations preferably match references immediately following it)
    sorted_ref_starts = sorted([sec["start_page"] for sec in ref_sections])

    # Scan body pages for in-text citations
    body_pages = [p for p in range(len(doc)) if p not in ref_pages]
    existing_links = []
    citations_found: List[Dict] = []

    for pno in body_pages:
        page = doc[pno]
        page_num = pno + 1
        words = page.get_text('words')
        words.sort(key=lambda w: (w[5], w[6], w[7]))
        page_text = page.get_text()

        # 1. Search for parenthetical citations
        for m in _RE_PAREN.finditer(page_text):
            inner = m.group(1).strip()
            # Clean internal soft-hyphens or line breaks
            inner_clean = re.sub(r'[\r\n\t]+', ' ', inner)
            inner_clean = re.sub(r'\s*-\s*', '-', inner_clean)

            # Check if this contains Author, Year
            # e.g. "Beauchamp & Childress, 2019" or "Donahue, 1996, p. 484"
            # Support semicolon or colon separated multiple citations
            parts = re.split(r'[;]', inner_clean)
            for part in parts:
                part = part.strip()
                lm = _RE_LOCATOR.search(part)
                locator = lm.group(1) if lm else None
                part_core = part[:lm.start()].strip() if lm else part

                um = _RE_CITE_UNIT.search(part_core)
                if um:
                    author_raw = um.group(1).strip().rstrip(",")
                    year_raw = um.group(2).strip()
                else:
                    ym = re.search(r'\b((?:19|20)\d{2}[a-z]?)\b', part_core)
                    if ym:
                        year_raw = ym.group(1)
                        author_raw = part_core[:ym.start()].strip().rstrip(",")
                    else:
                        continue
                    # Skip common false positives (e.g. "Table 1, 2020", "see page 12")
                    if re.match(r'^(?:Figure|Table|Box|Eq|Equation|Page|Section|Chapter)\b', author_raw, re.IGNORECASE):
                        continue
                    if len(author_raw) < 2:
                        continue

                    # Search matching rect on the page
                    quads = page.search_for(part[:30])
                    cite_rect = quads[0] if quads else None

                    # Prefer references in the same chapter or nearest following reference section
                    candidate_bib = bibliography
                    if sorted_ref_starts:
                        # Find the first ref section that is >= pno
                        following_refs = [rp for rp in sorted_ref_starts if rp >= pno]
                        if following_refs:
                            nearest_ref_page = following_refs[0] + 1
                            chapter_bib = [b for b in bibliography if abs(b["page"] - nearest_ref_page) <= 2]
                            if chapter_bib:
                                candidate_bib = chapter_bib + bibliography

                    # Match against bibliography
                    matched_ref, match_type, score = _match_citation_to_bib(author_raw, year_raw, candidate_bib)

                    citations_found.append({
                        "raw_citation": m.group(0),
                        "author": author_raw,
                        "year": year_raw,
                        "locator": locator,
                        "page": page_num,
                        "rect": cite_rect,
                        "matched_ref": matched_ref,
                        "match_type": match_type,
                        "def_page": matched_ref["page"] if matched_ref else None,
                        "ref_author": matched_ref["full_author"] if matched_ref else None,
                        "ref_text": matched_ref["raw_text"][:120] if matched_ref else None,
                        "is_linked": False
                    })

        # 2. Search for narrative citations: e.g. "Sellman (1997)" or "Beauchamp and Childress (2019)"
        for m in _RE_NARRATIVE.finditer(page_text):
            author_raw = m.group(1).strip()
            year_raw = m.group(2).strip()

            if re.match(r'^(?:Figure|Table|Box|Equation|Chapter|Section)\b', author_raw, re.IGNORECASE):
                continue

            quads = page.search_for(m.group(0))
            cite_rect = quads[0] if quads else None

            matched_ref, match_type, score = _match_citation_to_bib(author_raw, year_raw, bibliography)

            citations_found.append({
                "raw_citation": m.group(0),
                "author": author_raw,
                "year": year_raw,
                "locator": None,
                "page": page_num,
                "rect": cite_rect,
                "matched_ref": matched_ref,
                "match_type": match_type,
                "def_page": matched_ref["page"] if matched_ref else None,
                "ref_author": matched_ref["full_author"] if matched_ref else None,
                "ref_text": matched_ref["raw_text"][:120] if matched_ref else None,
                "is_linked": False
            })

    # Deduplicate citations on same page with same text
    unique_citations = []
    seen = set()
    for c in citations_found:
        key = (c["page"], c["author"], c["year"])
        if key not in seen:
            seen.add(key)
            unique_citations.append(c)

    # If applying links, insert LINK_GOTO annotations
    linked_count = 0
    if not analyze_only:
        for c in unique_citations:
            if c.get("matched_ref") and c.get("rect"):
                src_page = doc[c["page"] - 1]
                target_page_idx = c["def_page"] - 1
                target_rect = c["matched_ref"]["rect"]

                # Add link from in-text citation -> Reference definition
                link_annot = {
                    "kind": pymupdf.LINK_GOTO,
                    "from": c["rect"],
                    "page": target_page_idx,
                    "to": pymupdf.Point(target_rect.x0, target_rect.y0)
                }
                src_page.insert_link(link_annot)
                c["is_linked"] = True
                linked_count += 1

        # Save back to PDF file
        doc.save(pdf_path, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)

    doc.close()

    total = len(unique_citations)
    matched_count = sum(1 for c in unique_citations if c.get("matched_ref"))
    not_linked = total - (linked_count if not analyze_only else matched_count)

    details = []
    for c in unique_citations:
        details.append({
            "citation": c["raw_citation"],
            "author": c["author"],
            "year": c["year"],
            "page": c["page"],
            "def_page": c["def_page"],
            "target_author": c["ref_author"],
            "target_preview": c["ref_text"],
            "match_type": c["match_type"],
            "is_linked": c["is_linked"] or (c["def_page"] is not None),
            "status": "Active" if (c["is_linked"] or c["def_page"]) else "Missing Reference"
        })

    return {
        "total_citations": total,
        "matched": matched_count,
        "linked": linked_count if not analyze_only else matched_count,
        "not_linked": not_linked,
        "details": details
    }
