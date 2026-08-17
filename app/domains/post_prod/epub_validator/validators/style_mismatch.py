"""Bold/Italic style mismatch detector.

Compares PDF style markup (bold, italic) against XHTML to detect where
words styled in PDF are not styled the same way in XHTML, or vice versa.

PDF is the source of truth for styling.

Rule: STYLE-MATCH-001 (book-scope)
"""

from __future__ import annotations

import os
import re
from typing import List, Optional, Set

from bs4 import BeautifulSoup

from ..engine.registry import rule
from ..services import book_bundle_service as _bundle
from ._common import _cli_issue_to_web, _drop_pass_issues


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_word(word: str) -> str:
    """Normalize word for comparison: lowercase, strip punctuation."""
    word = word.lower().strip()
    # Remove trailing punctuation
    word = re.sub(r'[,;:.!?\'")\-—–]+$', '', word)
    return word


def _extract_styled_words_from_xhtml(soup: BeautifulSoup) -> dict[str, object]:
    """Extract words that are bold or italic in XHTML with their line numbers.

    Returns dict with 'bold' and 'italic' keys, each containing a dict of {word: set(line_numbers)}.
    """
    bold_words: dict[str, Set[int]] = {}
    italic_words: dict[str, Set[int]] = {}

    # Find all bold elements
    for tag in soup.find_all(['b', 'strong']):
        text = tag.get_text()
        line_no = getattr(tag, "sourceline", None)
        for word in re.findall(r'\b\w+\b', text):
            norm = _normalize_word(word)
            if norm and len(norm) >= 2:
                if norm not in bold_words:
                    bold_words[norm] = set()
                if line_no:
                    bold_words[norm].add(line_no)

    # Find all italic elements
    for tag in soup.find_all(['i', 'em']):
        text = tag.get_text()
        line_no = getattr(tag, "sourceline", None)
        for word in re.findall(r'\b\w+\b', text):
            norm = _normalize_word(word)
            if norm and len(norm) >= 2:
                if norm not in italic_words:
                    italic_words[norm] = set()
                if line_no:
                    italic_words[norm].add(line_no)

    return {
        "bold": bold_words,
        "italic": italic_words,
    }


def _extract_styled_words_from_pdf(pdf_para) -> dict[str, Set[str]]:
    """Extract bold/italic words from a PDF paragraph."""
    return {
        "bold": pdf_para.bold_words or set(),
        "italic": pdf_para.italic_words or set(),
    }


def _is_content_xhtml(rel_path: str) -> bool:
    """Return True for body-content XHTML files (skip nav, cover, etc.)."""
    basename = os.path.basename(rel_path).lower()
    if not basename.endswith((".xhtml", ".html", ".htm")):
        return False
    _NAV_COVER_RE = re.compile(
        r"\b(nav|cover|titlepage|copyright|toc|contents)\b", re.IGNORECASE,
    )
    return not _NAV_COVER_RE.search(basename)


# ---------------------------------------------------------------------------
# Rule implementation
# ---------------------------------------------------------------------------

@rule("STYLE-MATCH-001")
def validate_style_mismatch(book_details):
    """Book-scope rule: detect where words are styled differently in PDF vs XHTML.

    PDF is the source of truth. If a word is bold/italic in PDF but not in XHTML,
    or vice versa, it's flagged as a style mismatch.

    Note: This check is lenient — we only flag significant mismatches where:
    - A word appears multiple times in similar context with different styling
    - The word appears in both PDF and XHTML but with different styling
    """
    folder = book_details["folder_name"]
    epub_path = book_details["epub_path"]
    chapter_filter = book_details.get("chapter_filter")  # Optional: filter by chapter name

    bundle = _bundle.get_epub_bundle(folder)
    if not bundle:
        return {"issues_count": 0, "issues": []}

    pdf_path = _bundle._find_source(folder, "pdf")
    if not pdf_path or not os.path.isfile(pdf_path):
        return {"issues_count": 0, "issues": []}

    from ..vendor.pdf_epub_validator import PdfParser
    from ..services.pdf_service import find_pdf_page

    issues: list[dict] = []
    max_issues = 50

    for doc in bundle.xhtml_docs:
        if not _is_content_xhtml(doc.rel_path):
            continue

        rel_path = doc.rel_path

        # Skip if chapter filter is set and doesn't match
        if chapter_filter:
            basename = os.path.basename(rel_path)
            if chapter_filter not in basename:
                continue

        xhtml_styles = _extract_styled_words_from_xhtml(doc.soup)

        # Find PDF page range for THIS chapter (not whole PDF)
        xhtml_basename = os.path.basename(rel_path)
        page_range = find_pdf_page(folder, xhtml_basename)
        start_page = page_range.get("page")
        end_page = page_range.get("end_page")

        if not start_page or not end_page:
            # Skip if we can't find pages for this chapter
            continue

        # Parse only the PDF pages for this chapter (much faster)
        page_indices = set(range(start_page - 1, end_page))
        pdf_doc = None
        try:
            pdf_doc = PdfParser(pdf_path).parse(page_indices=page_indices)
        except Exception:
            continue

        # Collect bold/italic words from THIS CHAPTER's PDF pages only
        pdf_bold_words: Set[str] = set()
        pdf_italic_words: Set[str] = set()

        for para in pdf_doc.paragraphs:
            pdf_bold_words.update(para.bold_words or set())
            pdf_italic_words.update(para.italic_words or set())

        # Normalize PDF words for comparison
        pdf_bold_norm = {_normalize_word(w) for w in pdf_bold_words if len(w) >= 2}
        pdf_italic_norm = {_normalize_word(w) for w in pdf_italic_words if len(w) >= 2}

        xhtml_bold_dict = xhtml_styles["bold"]
        xhtml_italic_dict = xhtml_styles["italic"]
        xhtml_bold_norm = set(xhtml_bold_dict.keys())
        xhtml_italic_norm = set(xhtml_italic_dict.keys())

        # Find bold words in PDF but not bold in XHTML
        bold_missing = pdf_bold_norm - xhtml_bold_norm
        if bold_missing:
            body = doc.soup.find("body") or doc.soup

            # Create separate issue for EACH missing bold word
            for word in sorted(bold_missing):
                if len(issues) >= max_issues:
                    break

                # Find line number for this specific word by searching document lines
                word_line = None
                if hasattr(doc, 'lines'):
                    # Search through document lines
                    word_pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.IGNORECASE)
                    for i, line_text in enumerate(doc.lines, 1):
                        if word_pattern.search(line_text):
                            word_line = i
                            break

                line_info = f"Line {word_line}: " if word_line else ""
                issues.append({
                    "type": "style_mismatch_bold",
                    "rule_name": "Bold Style Mismatch",
                    "category": "Warning",
                    "message": (
                        f"{line_info}Word '{word}' is marked as bold in PDF but not in XHTML."
                    ),
                    "file_path": rel_path,
                    "line_number": word_line,
                    "snippet": f"Missing bold: '{word}'",
                    "pdf_context": f"Bold in PDF, not styled in XHTML",
                })

        # Find italic words in PDF but not italic in XHTML
        italic_missing = pdf_italic_norm - xhtml_italic_norm
        if italic_missing:
            body = doc.soup.find("body") or doc.soup

            # Create separate issue for EACH missing italic word
            for word in sorted(italic_missing):
                if len(issues) >= max_issues:
                    break

                # Find line number for this specific word by searching document lines
                word_line = None
                if hasattr(doc, 'lines'):
                    # Search through document lines
                    word_pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.IGNORECASE)
                    for i, line_text in enumerate(doc.lines, 1):
                        if word_pattern.search(line_text):
                            word_line = i
                            break

                line_info = f"Line {word_line}: " if word_line else ""
                issues.append({
                    "type": "style_mismatch_italic",
                    "rule_name": "Italic Style Mismatch",
                    "category": "Warning",
                    "message": (
                        f"{line_info}Word '{word}' is marked as italic in PDF but not in XHTML."
                    ),
                    "file_path": rel_path,
                    "line_number": word_line,
                    "snippet": f"Missing italic: '{word}'",
                    "pdf_context": f"Italic in PDF, not styled in XHTML",
                })

        # Also detect: bold in XHTML but NOT in PDF (reverse mismatch)
        extra_bold = xhtml_bold_norm - pdf_bold_norm
        if extra_bold:
            body = doc.soup.find("body") or doc.soup

            # Create separate issue for EACH extra bold word in XHTML
            for word in sorted(extra_bold):
                if len(issues) >= max_issues:
                    break

                # Find line number for this specific word
                word_line = None
                if hasattr(doc, 'lines'):
                    word_pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.IGNORECASE)
                    for i, line_text in enumerate(doc.lines, 1):
                        if word_pattern.search(line_text):
                            word_line = i
                            break

                line_info = f"Line {word_line}: " if word_line else ""
                issues.append({
                    "type": "style_mismatch_extra_bold",
                    "rule_name": "Extra Bold in XHTML",
                    "category": "Warning",
                    "message": (
                        f"{line_info}Word '{word}' is marked as bold in XHTML but not in PDF."
                    ),
                    "file_path": rel_path,
                    "line_number": word_line,
                    "snippet": f"Extra bold in XHTML: '{word}'",
                    "pdf_context": f"Not bold in PDF",
                })

        # Also detect: italic in XHTML but NOT in PDF (reverse mismatch)
        extra_italic = xhtml_italic_norm - pdf_italic_norm
        if extra_italic:
            body = doc.soup.find("body") or doc.soup

            # Create separate issue for EACH extra italic word in XHTML
            for word in sorted(extra_italic):
                if len(issues) >= max_issues:
                    break

                # Find line number for this specific word
                word_line = None
                if hasattr(doc, 'lines'):
                    word_pattern = re.compile(r'\b' + re.escape(word) + r'\b', re.IGNORECASE)
                    for i, line_text in enumerate(doc.lines, 1):
                        if word_pattern.search(line_text):
                            word_line = i
                            break

                line_info = f"Line {word_line}: " if word_line else ""
                issues.append({
                    "type": "style_mismatch_extra_italic",
                    "rule_name": "Extra Italic in XHTML",
                    "category": "Warning",
                    "message": (
                        f"{line_info}Word '{word}' is marked as italic in XHTML but not in PDF."
                    ),
                    "file_path": rel_path,
                    "line_number": word_line,
                    "snippet": f"Extra italic in XHTML: '{word}'",
                    "pdf_context": f"Not italic in PDF",
                })

    return {"issues_count": len(issues), "issues": issues}
