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


def _clean_invisible(text: str) -> str:
    """Strip zero-width spaces, soft hyphens, and non-breaking spaces commonly inserted in PDF glossary terms."""
    return re.sub(r'[\u200b\u200c\u200d\ufeff\xad]', '', text).replace('\xa0', ' ')


def extract_glossary_definitions(doc, start_p: int, end_p: int) -> dict:
    """
    Extract headwords defined in the Glossary section.
    Handles single-line and multi-line headwords.
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
            lines = b.get('lines', [])
            for l_idx, l in enumerate(lines):
                spans = l.get('spans', [])
                for s_idx, s in enumerate(spans):
                    font = s.get('font', '').lower()
                    is_bold = 'bold' in font or 'heavy' in font or 'black' in font or (s.get('flags', 0) & 16)
                    if not is_bold:
                        continue

                    txt = _clean_invisible(s.get('text', '')).strip()
                    # Check if bold headword ends with dash or colon on this span
                    matched_spans = [s]
                    accum_txt = txt

                    # If bold span doesn't end with dash/colon, check if next span or next line continues the bold headword
                    if not any(accum_txt.endswith(d) for d in ['—', '–', '-', ':']):
                        # Check subsequent bold spans on same line
                        for k in range(s_idx + 1, len(spans)):
                            ns = spans[k]
                            n_font = ns.get('font', '').lower()
                            n_bold = 'bold' in n_font or 'heavy' in n_font or 'black' in n_font or (ns.get('flags', 0) & 16)
                            if not n_bold:
                                break
                            n_txt = _clean_invisible(ns.get('text', '')).strip()
                            accum_txt += ' ' + n_txt
                            matched_spans.append(ns)
                            if any(accum_txt.endswith(d) for d in ['—', '–', '-', ':']):
                                break

                        # If still not ending with dash/colon and at line end, check start of next line
                        if not any(accum_txt.endswith(d) for d in ['—', '–', '-', ':']) and s_idx == len(spans) - 1 and l_idx + 1 < len(lines):
                            next_l = lines[l_idx + 1]
                            next_spans = next_l.get('spans', [])
                            if next_spans:
                                ns = next_spans[0]
                                n_font = ns.get('font', '').lower()
                                n_bold = 'bold' in n_font or 'heavy' in n_font or 'black' in n_font or (ns.get('flags', 0) & 16)
                                if n_bold:
                                    n_txt = _clean_invisible(ns.get('text', '')).strip()
                                    if accum_txt.endswith('-'):
                                        accum_txt = accum_txt[:-1] + n_txt
                                    else:
                                        accum_txt += ' ' + n_txt
                                    matched_spans.append(ns)

                    # Accept headword if:
                    # 1. Ends with dash or colon (e.g. "Term — Definition" or "Term: Definition")
                    # 2. Or is a bold start-of-line entry followed by non-bold definition (e.g. "Advocacy  Campaigning...")
                    has_punct = any(accum_txt.endswith(d) for d in ['—', '–', '-', ':'])
                    is_start_of_entry = (s_idx == 0 or (s_idx == 1 and not lines[l_idx]['spans'][0].get('text', '').strip()))
                    
                    if has_punct or (is_start_of_entry and len(matched_spans) < len(spans)):
                        clean_term = accum_txt.rstrip('—–-:\u2002\u2003\t ').strip()
                        # Exclude single letter alphabet headings like 'A', 'B', 'C'
                        if clean_term and 2 <= len(clean_term) < 90 and not clean_term.isdigit() and not re.match(r'^[A-Z]$', clean_term):
                            norm_key = clean_term.lower()
                            if norm_key not in definitions:
                                r = fitz.Rect(matched_spans[0]['bbox'])
                                for ms in matched_spans[1:]:
                                    r |= fitz.Rect(ms['bbox'])
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
    in the chapter body text (including multi-line wrapped bold terms).
    Creates links from body terms to their glossary definitions.
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
    for page_idx in range(start_p):
        page = doc[page_idx]
        existing_links = page.get_links()

        blocks = [b for b in page.get_text('dict')['blocks'] if b['type'] == 0]
        content_blocks = [b for b in blocks if not (b['bbox'][1] < 45 or b['bbox'][1] > 740)]

        for b in content_blocks:
            lines = b.get('lines', [])
            for l_idx, l in enumerate(lines):
                spans = l.get('spans', [])
                for s_idx, s in enumerate(spans):
                    font = s.get('font', '').lower()
                    is_bold = 'bold' in font or 'heavy' in font or 'black' in font or (s.get('flags', 0) & 16)
                    if not is_bold:
                        continue

                    # Clean candidate text
                    cand_raw = _clean_invisible(s.get('text', '')).strip().rstrip('.,;:!?')
                    if not cand_raw or len(cand_raw) < 2 or cand_raw.isdigit():
                        continue

                    candidates_to_try = [
                        (cand_raw, [fitz.Rect(s['bbox'])])
                    ]

                    # Multi-line wrapped bold term detection:
                    # If this span is at line end and next line starts with bold span
                    if s_idx == len(spans) - 1 and l_idx + 1 < len(lines):
                        next_l = lines[l_idx + 1]
                        next_spans = next_l.get('spans', [])
                        if next_spans:
                            ns = next_spans[0]
                            n_font = ns.get('font', '').lower()
                            n_bold = 'bold' in n_font or 'heavy' in n_font or 'black' in n_font or (ns.get('flags', 0) & 16)
                            if n_bold:
                                n_raw = _clean_invisible(ns.get('text', '')).strip().rstrip('.,;:!?')
                                if cand_raw.endswith('-'):
                                    stitched = cand_raw[:-1] + n_raw
                                else:
                                    stitched = cand_raw + ' ' + n_raw
                                candidates_to_try.insert(0, (stitched, [fitz.Rect(s['bbox']), fitz.Rect(ns['bbox'])]))

                    for candidate, rect_list in candidates_to_try:
                        norm_key = candidate.lower()
                        if norm_key in definitions:
                            defn = definitions[norm_key]

                            # Check if already linked to the glossary page
                            already_linked = any(
                                l.get('kind') == fitz.LINK_GOTO and
                                l.get('page') == defn['page_idx'] and
                                any(_rects_overlap(r, fitz.Rect(l.get('from')), threshold=0.4) for r in rect_list)
                                for l in existing_links
                            )

                            if already_linked:
                                linked_count += 1
                            else:
                                not_linked_count += 1
                                if not analyze_only:
                                    for r_click in rect_list:
                                        r_expanded = fitz.Rect(r_click.x0 - 1.5, r_click.y0 - 1.5, r_click.x1 + 1.5, r_click.y1 + 1.5)
                                        page.insert_link({
                                            "kind": fitz.LINK_GOTO,
                                            "from": r_expanded,
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
                                "rect": [rect_list[0].x0, rect_list[0].y0, rect_list[0].x1, rect_list[0].y1],
                                "all_rects": [[r.x0, r.y0, r.x1, r.y1] for r in rect_list]
                            })
                            break

    if not analyze_only and (not_linked_count > 0 or details):
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=0, deflate=True)
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

