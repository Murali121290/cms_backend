"""
Glossary Hyperlinking Service for PDF Post-Production.

Detects defined headwords in the Glossary section of a book (e.g. bold terms followed
by an em-dash, en-dash, hyphen, or colon) and locates their occurrences in the body
text chapters. Creates internal LINK_GOTO hyperlinks so clicking a term in the body
navigates directly to its definition in the Glossary.
"""
import fitz
import re
import os
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


def _rects_overlap(rect1, rect2, threshold: float = 0.5) -> bool:
    """Check if two rectangles overlap significantly."""
    if rect1 is None or rect2 is None:
        return False
    try:
        r1 = fitz.Rect(rect1)
        r2 = fitz.Rect(rect2)
        intersection = r1 & r2
        if intersection.is_empty:
            return False
        smaller_area = min(r1.get_area(), r2.get_area())
        if smaller_area <= 0:
            return False
        return (intersection.get_area() / smaller_area) >= threshold
    except Exception:
        return False


def find_glossary_pages(doc) -> tuple[int, int]:
    """
    Find start and end page indices (0-based) of the Glossary section.
    Checks bookmarks (TOC) first, then scans back-of-book pages.
    """
    start_p = None
    end_p = None

    # 1. Bookmark TOC check
    try:
        toc = doc.get_toc(False)
        for idx, item in enumerate(toc):
            title = item[1].strip()
            if re.match(r'^(glossary|glossary\s+of\s+terms)$', title, re.IGNORECASE):
                start_p = max(0, item[2] - 1)
                # Next section determines end
                for next_idx in range(idx + 1, len(toc)):
                    next_p = max(0, toc[next_idx][2] - 1)
                    if next_p > start_p:
                        end_p = next_p
                        break
                if end_p is None:
                    end_p = len(doc)
                return start_p, end_p
    except Exception as e:
        logger.debug(f"Glossary TOC check error: {e}")

    # 2. Text scan fallback
    scan_start = max(0, len(doc) - 60)
    for p_idx in range(scan_start, len(doc)):
        text = doc[p_idx].get_text()
        first_lines = [l.strip().lower() for l in text.split('\n')[:5] if l.strip()]
        if any(re.match(r'^(glossary|glossary\s+of\s+terms)$', l) for l in first_lines):
            start_p = p_idx
            break

    if start_p is not None:
        # Scan until next section heading or empty pages
        for p_idx in range(start_p + 1, len(doc)):
            p_text = doc[p_idx].get_text()
            first_lines = [l.strip().lower() for l in p_text.split('\n')[:5] if l.strip()]
            if any(re.match(r'^(references|bibliography|index|about\s+the\s+author|appendix)', l) for l in first_lines):
                end_p = p_idx
                break
            if len(p_text.strip()) < 20:
                end_p = p_idx
                break
        if end_p is None:
            end_p = len(doc)
        return start_p, end_p

    return None, None


def extract_glossary_definitions(doc, start_p: int, end_p: int) -> dict:
    """
    Extract headwords defined in the Glossary section.
    Returns: dict mapping lowercase term to {
        'term': str (original casing),
        'page_idx': int,
        'page': int (1-based),
        'rect': fitz.Rect,
        'point': fitz.Point
    }
    """
    definitions = {}

    for page_idx in range(start_p, end_p):
        page = doc[page_idx]
        blocks = [b for b in page.get_text('dict')['blocks'] if b['type'] == 0]
        # Ignore top running header and bottom footer
        content_blocks = [b for b in blocks if not (b['bbox'][1] < 45 or b['bbox'][1] > 740)]

        for b in content_blocks:
            for l in b.get('lines', []):
                for s in l.get('spans', []):
                    txt = s.get('text', '').strip()
                    font = s.get('font', '').lower()
                    is_bold = 'bold' in font or 'heavy' in font or 'black' in font or (s.get('flags', 0) & 16)

                    # Look for bold headwords ending in dash or colon
                    if is_bold and any(txt.endswith(d) for d in ['—', '–', '-', ':']):
                        clean_term = txt.rstrip('—–-:').strip()
                        if clean_term and 2 <= len(clean_term) < 70 and not clean_term.isdigit():
                            norm_key = clean_term.lower()
                            if norm_key not in definitions:
                                r = fitz.Rect(s['bbox'])
                                definitions[norm_key] = {
                                    'term': clean_term,
                                    'page_idx': page_idx,
                                    'page': page_idx + 1,
                                    'rect': r,
                                    'point': fitz.Point(max(0, r.x0 - 10), max(0, r.y0 - 20))
                                }

    return definitions


def find_glossary_terms_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scans the PDF for Glossary definitions and finds all bold/key term occurrences
    in the chapter body text. Creates links from body terms to their glossary definitions.
    """
    doc = fitz.open(pdf_path)
    start_p, end_p = find_glossary_pages(doc)

    if start_p is None:
        doc.close()
        return {
            "total_terms": 0,
            "linked": 0,
            "not_linked": 0,
            "details": [],
            "glossary_pages": []
        }

    definitions = extract_glossary_definitions(doc, start_p, end_p)
    logger.debug(f"Found {len(definitions)} glossary definitions on pages {start_p + 1} to {end_p}")

    details = []
    linked_count = 0
    not_linked_count = 0

    # Scan body pages (from chapter start up to glossary start)
    # Typically chapters start after front-matter (e.g. page index 5+)
    for page_idx in range(start_p):
        page = doc[page_idx]
        existing_links = page.get_links()

        blocks = [b for b in page.get_text('dict')['blocks'] if b['type'] == 0]
        content_blocks = [b for b in blocks if not (b['bbox'][1] < 45 or b['bbox'][1] > 740)]

        for b in content_blocks:
            for l in b.get('lines', []):
                for s in l.get('spans', []):
                    font = s.get('font', '').lower()
                    is_bold = 'bold' in font or 'heavy' in font or 'black' in font or (s.get('flags', 0) & 16)
                    if not is_bold:
                        continue

                    # Clean candidate text
                    candidate = s.get('text', '').strip().rstrip('.,;:!?')
                    if not candidate or len(candidate) < 2 or candidate.isdigit():
                        continue

                    norm_key = candidate.lower()
                    if norm_key in definitions:
                        defn = definitions[norm_key]
                        term_rect = fitz.Rect(s['bbox'])

                        # Expand clickable rect slightly (+1.5pt)
                        r_click = fitz.Rect(term_rect.x0 - 1.5, term_rect.y0 - 1.5, term_rect.x1 + 1.5, term_rect.y1 + 1.5)

                        # Check if already linked to the glossary page
                        already_linked = any(
                            l.get('kind') == fitz.LINK_GOTO and
                            l.get('page') == defn['page_idx'] and
                            _rects_overlap(r_click, fitz.Rect(l.get('from')), threshold=0.5)
                            for l in existing_links
                        )

                        if already_linked:
                            linked_count += 1
                        else:
                            not_linked_count += 1
                            if not analyze_only:
                                page.insert_link({
                                    "kind": fitz.LINK_GOTO,
                                    "from": r_click,
                                    "page": defn['page_idx'],
                                    "to": defn['point']
                                })
                                already_linked = True

                        details.append({
                            "term": defn['term'],
                            "body_term": candidate,
                            "body_page": page_idx + 1,
                            "glossary_page": defn['page'],
                            "is_linked": already_linked,
                            "rect": [r_click.x0, r_click.y0, r_click.x1, r_click.y1]
                        })

    if not analyze_only and (not_linked_count > 0 or details):
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=3, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
    else:
        doc.close()

    return {
        "total_terms": len(details),
        "linked": linked_count if analyze_only else len(details),
        "not_linked": not_linked_count if analyze_only else 0,
        "details": details,
        "glossary_pages": list(range(start_p + 1, end_p + 1))
    }

