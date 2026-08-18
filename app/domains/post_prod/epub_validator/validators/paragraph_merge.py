"""Merged-paragraph detector.

Compares PDF paragraphs (ground truth) against XHTML ``<p>`` elements to
detect cases where two or more consecutive PDF paragraphs have been
incorrectly merged into a single ``<p>`` in the XHTML.

Rule: PARA-MERGE-001 (book-scope)
"""

from __future__ import annotations

import html
import os
import re
from typing import List, Optional, Set

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ..services import book_bundle_service as _bundle
from ..vendor.pdf_epub_validator.epub_extractor import line_number_of
from ._common import _cli_issue_to_web, _drop_pass_issues


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_tag_line(doc_lines: list[str], raw_text: str) -> Optional[int]:
    """Find line number of a paragraph by searching lines for its starting signature."""
    words = [w for w in re.split(r'\s+', raw_text) if w]
    if not words:
        return None
    for w_count in (5, 4, 3):
        if len(words) < w_count:
            continue
        sig = " ".join(words[:w_count]).lower()
        for i, line in enumerate(doc_lines, 1):
            line_clean = html.unescape(line)
            line_clean = re.sub(r"<[^>]+>", " ", line_clean).lower()
            line_clean = re.sub(r"\s+", " ", line_clean)
            if sig in line_clean:
                return i
    return None

def _normalize(text: str) -> str:
    """Collapse whitespace, strip, lowercase, and clean hyphens/ligatures."""
    text = (text or "").lower()
    # Strip soft hyphens and any space immediately following them
    text = re.sub(r"\xad\s*", "", text)
    # Collapse multiple spaces
    return re.sub(r"\s+", " ", text).strip()


def _word_count(text: str) -> int:
    return len(text.split())


def _extract_list_marker(text: str) -> Optional[str]:
    """Extract numbered/lettered list marker (e.g., '1.', 'a.', 'i.') from start of text.

    Returns the marker (e.g., '1', 'a', 'i') or None if not a list item.
    """
    # Match patterns like "1.", "a.", "i.", etc.
    match = re.match(r'^([0-9]+|[a-zA-Z]|[ivxlcdm]+)\s*[.)\-]', text)
    if match:
        return match.group(1).lower()
    return None


_NAV_COVER_RE = re.compile(
    r"(^|[_.-])(nav|navigation|cover|title|titlepage|copyright|toc|contents)\b", re.IGNORECASE,
)


def _is_content_xhtml(rel_path: str) -> bool:
    """Return True for body-content XHTML files (skip nav, cover, etc.)."""
    basename = os.path.basename(rel_path).lower()
    if not basename.endswith((".xhtml", ".html", ".htm")):
        return False
    return not _NAV_COVER_RE.search(basename)


def _has_pagebreak_in_range(p_tag, start_text: str, end_text: str) -> bool:
    """Check if a <p> element contains a page break marker between start_text and end_text."""
    for span in p_tag.find_all("span"):
        role = span.get("role") or ""
        epub_type = span.get("epub:type") or ""
        is_pb = (role == "doc-pagebreak" or
                 epub_type == "pagebreak" or
                 any("pagebreak" in str(v) for v in span.attrs.values()))
        if is_pb:
            # Found a pagebreak — verify it's between our merge boundaries
            p_text = p_tag.get_text(" ")
            pb_pos = p_text.find(span.get_text())
            start_pos = p_text.find(start_text)
            end_pos = p_text.find(end_text)
            if start_pos >= 0 and end_pos >= 0 and pb_pos >= 0:
                if start_pos < pb_pos < end_pos:
                    return True
    return False


def _extract_p_texts(soup: BeautifulSoup) -> list[dict]:
    """Extract all <p> elements with their normalized text and source info."""
    body = soup.find("body") or soup
    results = []
    for p in body.find_all("p"):
        raw = p.get_text(" ", strip=True)
        if not raw or len(raw) < 20:
            continue
        results.append({
            "raw": raw,
            "norm": _normalize(raw),
            "word_count": _word_count(raw),
            "line": getattr(p, "sourceline", None),
            "tag": p,
        })
    return results


def _find_consecutive_pdf_paras_in_html(
    html_norm: str,
    pdf_paras_norm: list[tuple[int, str, str]],
    min_match_len: int = 40,
) -> list[list[int]]:
    """Find groups of 2+ consecutive PDF paragraphs whose text appears
    sequentially inside a single HTML paragraph.

    ``pdf_paras_norm`` is a list of ``(index, normalized_text, raw_text)``.
    Returns a list of groups, where each group is a list of PDF paragraph
    indices that are merged inside the HTML paragraph.

    We require each PDF paragraph's normalized text (or a substantial prefix
    of it) to appear as a substring of the HTML paragraph, *and* the matches
    must appear in order without overlap.
    """
    if not html_norm or not pdf_paras_norm:
        return []

    groups: list[list[int]] = []
    used: Set[int] = set()

    i = 0
    while i < len(pdf_paras_norm):
        idx_i, norm_i, _ = pdf_paras_norm[i]
        if idx_i in used:
            i += 1
            continue

        # Resilient match: strip leading numbers/punctuation (like "5. " or "125. ")
        norm_i_clean = re.sub(r'^[^a-z]+', '', norm_i)
        search_text = norm_i_clean[:200] if len(norm_i_clean) > 200 else norm_i_clean
        if len(search_text) < min_match_len:
            i += 1
            continue

        pos = html_norm.find(search_text)
        if pos < 0:
            i += 1
            continue

        # Found the start of this PDF paragraph in the HTML paragraph.
        # Now look ahead for consecutive PDF paragraphs also present.
        current_group = [idx_i]
        search_from = pos + len(search_text)

        # Allow skipping up to 5 garbage/short PDF paragraph entries (like headers/footers)
        j = i + 1
        last_matched_j = i
        while j < len(pdf_paras_norm) and (j - last_matched_j) <= 5:
            idx_j, norm_j, _ = pdf_paras_norm[j]
            norm_j_clean = re.sub(r'^[^a-z]+', '', norm_j)
            next_search = norm_j_clean[:200] if len(norm_j_clean) > 200 else norm_j_clean
            if len(next_search) < min_match_len:
                j += 1
                continue

            next_pos = html_norm.find(next_search, max(0, search_from - 20))
            if next_pos >= 0:
                current_group.append(idx_j)
                search_from = next_pos + len(next_search)
                last_matched_j = j

            j += 1

        if len(current_group) >= 2:
            groups.append(current_group)
            used.update(current_group)
            i = last_matched_j + 1
        else:
            i += 1

    return groups


# ---------------------------------------------------------------------------
# Rule implementation
# ---------------------------------------------------------------------------

@rule("PARA-MERGE-001")
def validate_paragraph_merge(book_details):
    """Book-scope rule: detect XHTML paragraphs that incorrectly merge
    two or more consecutive PDF paragraphs into a single <p> element.

    The PDF is the ground truth. If a single XHTML <p> contains the text
    of 2+ consecutive PDF paragraphs, it is flagged as a merge error.
    """
    folder = book_details["folder_name"]
    epub_path = book_details["epub_path"]

    bundle = _bundle.get_epub_bundle(folder)
    if not bundle:
        return {"issues_count": 0, "issues": []}

    pdf_path = _bundle._find_source(folder, "pdf")
    if not pdf_path or not os.path.isfile(pdf_path):
        return {"issues_count": 0, "issues": []}

    from ..services.pdf_service import find_pdf_page
    from ..vendor.pdf_epub_validator import PdfParser

    issues: list[dict] = []
    max_issues = 100

    for doc in bundle.xhtml_docs:
        if not _is_content_xhtml(doc.rel_path):
            continue

        rel_path = doc.rel_path
        html_ps = _extract_p_texts(doc.soup)
        if not html_ps:
            continue

        # Find page range for this chapter to avoid parsing the whole PDF at once (OOM prevention)
        page_range = find_pdf_page(folder, os.path.basename(rel_path))
        start_page = page_range.get("page")
        end_page = page_range.get("end_page")
        if not start_page or not end_page:
            # Skip if we can't find/verify pages for this chapter
            continue

        page_indices = set(range(start_page - 1, end_page))
        try:
            pdf_doc = PdfParser(pdf_path).parse(page_indices=page_indices)
        except Exception:
            continue

        # Build ordered list of PDF paragraphs with normalized text
        pdf_paras: list[tuple[int, str, str]] = []
        for i, para in enumerate(pdf_doc.paragraphs):
            norm = _normalize(para.text)
            if norm and len(norm) >= 40:
                pdf_paras.append((i, norm, para.text))

        if not pdf_paras:
            continue

        for hp in html_ps:
            html_norm = hp["norm"]

            # Only check long-ish paragraphs — a merge produces unusually
            # large <p> elements.
            if hp["word_count"] < 80:
                continue

            groups = _find_consecutive_pdf_paras_in_html(
                html_norm, pdf_paras, min_match_len=40,
            )

            for group in groups:
                if len(issues) >= max_issues:
                    break

                # Check if this is a page-spanning merge (across consecutive pages).
                # But don't skip if they're distinct list items (different markers like "4." vs "5.")
                pdf_pages = sorted({pdf_doc.paragraphs[pidx].page for pidx in group})
                page_diff = max(pdf_pages) - min(pdf_pages)

                # Check if merged paragraphs have different list item markers
                has_different_markers = False
                if len(group) >= 2:
                    first_para_text = pdf_doc.paragraphs[group[0]].text
                    second_para_text = pdf_doc.paragraphs[group[1]].text
                    first_marker = _extract_list_marker(first_para_text)
                    second_marker = _extract_list_marker(second_para_text)
                    # If both have markers and they're different, it's a real merge error
                    if first_marker and second_marker and first_marker != second_marker:
                        has_different_markers = True

                # Skip only if natural page-spanning AND not different list items
                if page_diff <= 1 and not has_different_markers:
                    continue

                # Also skip if there's an actual page break marker in the XHTML
                if _has_pagebreak_in_range(hp["tag"], hp["raw"][:50], hp["raw"][-50:]):
                    continue

                # Gather details about the merged PDF paragraphs
                merged_pdf_texts = []
                total_pdf_words = 0
                for pidx in group:
                    raw = pdf_doc.paragraphs[pidx].text
                    merged_pdf_texts.append(raw)
                    total_pdf_words += _word_count(raw)

                # Build a snippet showing the merge boundary
                first_para_end = merged_pdf_texts[0][-60:] if len(merged_pdf_texts[0]) > 60 else merged_pdf_texts[0]
                second_para_start = merged_pdf_texts[1][:60] if len(merged_pdf_texts[1]) > 60 else merged_pdf_texts[1]
                snippet = f"...{first_para_end} ⏐ {second_para_start}..."

                # PDF page info
                page_str = ", ".join(str(p) for p in pdf_pages)

                # First 4 words of the last PDF paragraph in the group to guide the user on where to split
                last_para_words = [w for w in re.split(r'\s+', merged_pdf_texts[-1]) if w]
                split_start_text = " ".join(last_para_words[:4])

                issues.append({
                    "type": "merged_paragraph",
                    "rule_name": "Merged Paragraph",
                    "category": "Error",
                    "message": (
                        f"Paragraph merge detected. Consecutive PDF paragraphs from PDF page(s) {page_str} "
                        f"have been merged into a single paragraph in XHTML. "
                        f"Please split the XHTML paragraph at: '{split_start_text}'."
                    ),
                    "file_path": rel_path,
                    "line_number": _find_tag_line(doc.lines, hp["raw"]),
                    "snippet": snippet,
                    "pdf_context": (
                        f"PDF paragraphs {group[0]+1}–{group[-1]+1} "
                        f"(page(s) {page_str})"
                    ),
                })

            if len(issues) >= max_issues:
                break
        if len(issues) >= max_issues:
            break

    return {"issues_count": len(issues), "issues": issues}
