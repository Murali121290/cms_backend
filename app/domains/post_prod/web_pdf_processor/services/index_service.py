import fitz
import re
import os
import logging
from .toc_service import build_page_map

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
        area1 = r1.get_area()
        area2 = r2.get_area()
        smaller_area = min(area1, area2)
        if smaller_area <= 0:
            return False
        return (intersection.get_area() / smaller_area) >= threshold
    except Exception:
        return False

def find_index_pages(doc) -> list:
    """
    Identifies the index page indices (0-based) in the PDF document.
    Checks bookmarks first, then scans back-of-book pages for 'Index' headings.
    """
    index_pages = []
    
    # 1. Check bookmarks
    try:
        toc = doc.get_toc(False)
        for item in toc:
            title = item[1].strip()
            # Match 'Index', 'Author Index', 'Subject Index', etc.
            if re.match(r'^(index|author\s+index|subject\s+index)$', title, re.IGNORECASE):
                start_p = max(0, item[2] - 1)
                # Include pages from start_p to end of document, or until next major non-index section
                for p_idx in range(start_p, len(doc)):
                    p_text = doc[p_idx].get_text()
                    # If page is empty or only back cover, stop
                    if len(p_text.strip()) < 20 and p_idx > start_p:
                        break
                    # If another non-index section starts, stop
                    if p_idx > start_p:
                        first_line = p_text.strip().split('\n')[0].strip()
                        if re.match(r'^(back\s+cover|about\s+the\s+author|notes|advertisement)', first_line, re.IGNORECASE):
                            break
                    index_pages.append(p_idx)
                if index_pages:
                    return index_pages
    except Exception as e:
        logger.debug(f"Bookmark index search error: {e}")

    # 2. Back-of-book scan (last 40 pages)
    scan_start = max(0, len(doc) - 40)
    found_start = None
    for p_idx in range(scan_start, len(doc)):
        text = doc[p_idx].get_text()
        first_lines = [l.strip().lower() for l in text.split('\n')[:5] if l.strip()]
        if any(re.match(r'^(index|author\s+index|subject\s+index)$', l) for l in first_lines):
            found_start = p_idx
            break
            
    if found_start is not None:
        for p_idx in range(found_start, len(doc)):
            p_text = doc[p_idx].get_text()
            if len(p_text.strip()) < 20 and p_idx > found_start:
                break
            index_pages.append(p_idx)

    return index_pages

def find_index_links_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scans the Index section of the PDF for page references (e.g. 155, 157-8, 238n129).
    Resolves printed page numbers to physical PDF pages using build_page_map.
    If analyze_only=False, inserts clickable internal LINK_GOTO hyperlinks.
    """
    doc = fitz.open(pdf_path)
    index_pages = find_index_pages(doc)
    if not index_pages:
        doc.close()
        return {
            "total_references": 0,
            "linked": 0,
            "not_linked": 0,
            "details": [],
            "index_pages": []
        }

    page_map = build_page_map(doc)
    
    # Pattern to match page numbers, ranges, and note references
    # e.g. '157–8', '155', '238n129', '40–1'
    PAGE_REF_PAT = re.compile(r'^(\d+)(?:[–\-](\d+))?(?:n(\d+))?[,;]?$')

    details = []
    linked_count = 0
    not_linked_count = 0

    for p_idx in index_pages:
        page = doc[p_idx]
        words = page.get_text('words')
        existing_links = page.get_links()
        
        for i, w in enumerate(words):
            raw_token = w[4].rstrip('.,;:!?')
            m = PAGE_REF_PAT.match(raw_token)
            if not m:
                continue

            first_p_str = m.group(1)
            p_val = int(first_p_str)
            
            # Filter out years or numbers outside document range
            if p_val <= 0 or p_val >= len(doc):
                continue

            # Look up physical page index
            target_p_idx = page_map.get(p_val)
            if target_p_idx is None:
                continue

            word_rect = fitz.Rect(w[:4])
            
            # Determine term context (words preceding this page number on the entry line)
            term_words = []
            for prev_idx in range(max(0, i - 1), max(-1, i - 12), -1):
                prev_w = words[prev_idx]
                prev_txt = prev_w[4].strip()
                # Stop if we hit previous page number or another entry
                if re.search(r'\d+[,;]?$', prev_txt) or abs(prev_w[1] - w[1]) > 5:
                    if abs(prev_w[1] - w[1]) > 5 and term_words:
                        break
                    continue
                term_words.insert(0, prev_txt)
                if len(term_words) >= 5:
                    break

            entry_term = ' '.join(term_words).rstrip(',;') if term_words else raw_token

            # Check if this word rectangle already has an internal link to target_p_idx
            already_linked = any(
                l.get('kind') == fitz.LINK_GOTO and
                l.get('page') == target_p_idx and
                _rects_overlap(word_rect, fitz.Rect(l.get('from')), threshold=0.5)
                for l in existing_links
            )

            if already_linked:
                linked_count += 1
            else:
                not_linked_count += 1
                if not analyze_only:
                    page.insert_link({
                        "kind": fitz.LINK_GOTO,
                        "from": word_rect,
                        "page": target_p_idx,
                        "to": fitz.Point(72, 72)
                    })
                    already_linked = True

            details.append({
                "term": entry_term,
                "page_reference": raw_token,
                "printed_page": p_val,
                "source_page": p_idx + 1,
                "target_page": target_p_idx + 1,
                "is_linked": already_linked,
                "rect": [word_rect.x0, word_rect.y0, word_rect.x1, word_rect.y1]
            })

    if not analyze_only and (not_linked_count > 0 or details):
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=3, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
    else:
        doc.close()

    return {
        "total_references": len(details),
        "linked": linked_count if analyze_only else len(details),
        "not_linked": not_linked_count if analyze_only else 0,
        "details": details,
        "index_pages": [p + 1 for p in index_pages]
    }

