"""
URL Hyperlinking Service for PDF Post-Production.

Scans all pages for plain-text URLs, checks if they are hyperlinked in the PDF,
and verifies whether the URLs are actually reachable (HTTP status).
"""
import re
import os
import fitz  # PyMuPDF
import requests
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.domains.post_prod.web_pdf_processor.services.stream_color_utils import recolor_url_in_stream, recolor_text_in_stream

logger = logging.getLogger(__name__)

# Regex to detect URLs in plain text
URL_PATTERN = re.compile(
    r'https?://[^\s\)\]\}\"\'<>]+|'
    r'www\.[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}[^\s\)\]\}\"\'<>]*',
    re.IGNORECASE
)


def _check_url_status(href: str):
    """
    Check if a URL is reachable. Returns (status_code, description).
    Uses HEAD first, falls back to GET if HEAD fails (405).
    """
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (compatible; PDF-LinkChecker/1.0)'}
        resp = requests.head(href, allow_redirects=True, timeout=2.5, headers=headers)
        if resp.status_code == 405:
            resp = requests.get(href, allow_redirects=True, timeout=2.5, headers=headers, stream=True)
        return resp.status_code, _status_description(resp.status_code)
    except requests.exceptions.SSLError:
        return None, 'SSL Error'
    except requests.exceptions.ConnectionError:
        return None, 'Connection Error'
    except requests.exceptions.Timeout:
        return None, 'Timeout'
    except Exception as e:
        return None, f'Error: {str(e)}'


def _status_description(code: int) -> str:
    descriptions = {
        200: 'OK', 201: 'Created', 204: 'No Content',
        301: 'Moved Permanently', 302: 'Found', 307: 'Redirect', 308: 'Redirect',
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
        404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone',
        500: 'Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
    }
    return descriptions.get(code, f'HTTP {code}')


def _clean_invisible(text: str) -> str:
    """Strip zero-width spaces and soft hyphens commonly inserted in PDF URLs."""
    return re.sub(r'[\u200b\u200c\u200d\ufeff\xad]', '', text)


def _extract_page_urls_and_rects(page):
    """
    Extracts URLs from a page, properly detecting and stitching multi-line URLs
    that wrap across line breaks, and returns (clean_url, [fitz.Rect, ...], [seg_text, ...]).
    """
    words = page.get_text('words')
    found = []
    used_word_indices = set()
    domain_exts = (
        '.html', '.htm', '.pdf', '.php', '.aspx', '.org', '.com', '.edu',
        '.gov', '.io', '.net', '.au', '.uk', '.ca', '.de', '.fr', '.in'
    )
    
    i = 0
    while i < len(words):
        if i in used_word_indices:
            i += 1
            continue
            
        w_raw = words[i][4]
        w_clean = _clean_invisible(w_raw).lstrip('([<{\'\"“‘')
        if re.match(r'^(?:https?://|www\.)', w_clean, re.I):
            accum_clean = w_clean
            matched_words = [words[i]]
            matched_indices = [i]
            
            j = i + 1
            while j < len(words):
                w_prev = words[j - 1]
                w_curr = words[j]
                
                # Check block/line continuity: w[5] = block_no, w[6] = line_no, w[7] = word_no
                same_block = (w_curr[5] == w_prev[5])
                consecutive_line = same_block and (w_curr[6] == w_prev[6] + 1) and (w_curr[7] == 0)
                same_line = same_block and (w_curr[6] == w_prev[6])
                
                if not (same_line or (same_block and consecutive_line)):
                    break
                    
                next_clean = _clean_invisible(w_curr[4])
                
                # Avoid breaking into list bullets or numbered items
                if re.match(r'^(?:[•\*]|\d+[\.\t]|[A-Z][a-z]+ [A-Z])', next_clean):
                    break
                if next_clean.startswith('-') and not ('/' in next_clean or any(accum_clean.endswith(c) for c in ['/', '.'])):
                    break
                    
                is_cont = False
                if any(accum_clean.endswith(ch) for ch in ['/', '.', '-', '=', '?', '&', ':']):
                    is_cont = True
                elif any(next_clean.startswith(ch) for ch in ['/', '.', '-', '=', '?', '&']):
                    is_cont = True
                elif ('/' in accum_clean or accum_clean.count('.') >= 1) and not any(accum_clean.endswith(ext) for ext in domain_exts):
                    if re.match(r'^[a-zA-Z0-9_\-\.\/\?\=\&\#\%]+$', next_clean):
                        is_cont = True
                        
                if is_cont:
                    accum_clean += next_clean
                    matched_words.append(w_curr)
                    matched_indices.append(j)
                    j += 1
                else:
                    break
                    
            clean_url = accum_clean.rstrip('.,;:!?()[]{}')
            clean_url = re.sub(r'(?<=[a-zA-Z0-9])\.\d+$', '', clean_url)
            
            rects = [fitz.Rect(mw[:4]) for mw in matched_words]
            segs = [mw[4] for mw in matched_words]
            used_word_indices.update(matched_indices)
            found.append((clean_url, rects, segs))
            i = j
        else:
            i += 1
            
    return found


def find_urls_in_pdf(pdf_path: str, analyze_only: bool = True, color_urls: bool = False) -> dict:
    """
    Scan PDF for plain-text URLs.
    - Checks if each URL is already hyperlinked in the PDF.
    - Checks if each URL is actually reachable via HTTP.
    If analyze_only=False, converts unlinked URLs to active LINK_URI hyperlinks.
    Returns a report with per-URL details.
    """
    doc = fitz.open(pdf_path)
    raw_entries = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1

        # Collect existing URI hyperlinks on this page with their rectangles
        existing_uris_raw = set()
        existing_uris_norm = set()
        existing_link_rects = []  # Store (rect, uri) tuples for spatial checking
        for link in page.get_links():
            if link.get('kind') == fitz.LINK_URI:
                uri = link.get('uri', '')
                rect = link.get('from')  # Get the rectangular region of the link
                existing_uris_raw.add(uri.rstrip('/'))
                # normalised form strips protocol for fuzzy matching
                existing_uris_norm.add(_normalise_url(uri))
                if rect:
                    existing_link_rects.append((rect, uri))

        # Extract structured word-based URLs including wrapped lines
        page_urls_info = _extract_page_urls_and_rects(page)
        used_rects = []

        for raw_url, matched_rects, segs in page_urls_info:
            href = raw_url if raw_url.startswith('http') else f'https://{raw_url}'
            norm = _normalise_url(href)

            if not matched_rects:
                continue

            # If all rects significantly overlap with already used rects, skip redundant duplicate substring
            if all(any(_rects_overlap(r, ur, threshold=0.6) for ur in used_rects) for r in matched_rects):
                continue

            primary_rect = matched_rects[0] if matched_rects else None

            # Check if already linked by:
            # 1. Exact URI match (normalized or raw)
            # 2. Spatial overlap with existing link rectangles
            already_linked = (
                norm in existing_uris_norm or
                href.rstrip('/') in existing_uris_raw or
                raw_url.rstrip('/') in existing_uris_raw
            )

            # If not found by URI match, check spatial overlap with existing links on page
            if not already_linked and matched_rects:
                for link_rect, link_uri in existing_link_rects:
                    if any(_rects_overlap(r, link_rect, threshold=0.3) for r in matched_rects):
                        already_linked = True
                        href = link_uri
                        break

            used_rects.extend(matched_rects)

            used_rects.extend(matched_rects)

            raw_entries.append({
                "url": href,
                "display_text": raw_url,
                "page": physical_page,
                "is_linked": already_linked,
                "rect": list(primary_rect) if primary_rect else None,
                "all_rects": [list(r) for r in matched_rects],
                "segments": segs,
                "page_idx": page_idx,
            })

    # Check HTTP reachability for each unique URL in parallel
    unique_hrefs = list({e["url"] for e in raw_entries})
    http_results: dict = {}

    if unique_hrefs:
        with ThreadPoolExecutor(max_workers=min(25, len(unique_hrefs))) as executor:
            future_map = {executor.submit(_check_url_status, href): href for href in unique_hrefs}
            for future in as_completed(future_map):
                href = future_map[future]
                try:
                    status_code, description = future.result()
                except Exception:
                    status_code, description = None, 'Error'
                http_results[href] = (status_code, description)

    # Build details list and optionally insert hyperlinks
    details = []
    linked_count = 0
    not_linked_count = 0

    for entry in raw_entries:
        href = entry["url"]
        status_code, description = http_results.get(href, (None, 'Unknown'))
        is_ok = status_code is not None and status_code < 400

        rect_list = [fitz.Rect(r) for r in entry.get("all_rects", [])]
        if not rect_list and entry.get("rect"):
            rect_list = [fitz.Rect(entry["rect"])]

        if not entry["is_linked"]:
            not_linked_count += 1
            if not analyze_only and rect_list:
                page = doc[entry["page_idx"]]
                existing_page_links = page.get_links()
                for link_rect in rect_list:
                    # Check for duplicate overlapping link
                    already_has_link = any(
                        _rects_overlap(link_rect, fitz.Rect(ex["from"]), threshold=0.6)
                        for ex in existing_page_links
                    )
                    if not already_has_link:
                        page.insert_link({
                            "kind": fitz.LINK_URI,
                            "from": link_rect,
                            "uri": href,
                        })
                
                # Recolor text in content streams directly to link blue only if requested
                if color_urls:
                    try:
                        segments = entry.get("segments") or [entry.get("display_text") or href]
                        for xref in page.get_contents():
                            stream = page.parent.xref_stream(xref).decode('latin1', errors='ignore')
                            new_stream = recolor_url_in_stream(stream, segments, color_rgb=(0.06, 0.45, 0.75))
                            if new_stream != stream:
                                page.parent.update_stream(xref, new_stream.encode('latin1'))
                    except Exception as ex_color:
                        logger.debug(f"Stream text recolor failed for {href}: {ex_color}")

                entry["is_linked"] = True
        else:
            linked_count += 1
            if not analyze_only and rect_list and color_urls:
                page = doc[entry["page_idx"]]
                try:
                    segments = entry.get("segments") or [entry.get("display_text") or href]
                    for xref in page.get_contents():
                        stream = page.parent.xref_stream(xref).decode('latin1', errors='ignore')
                        new_stream = recolor_url_in_stream(stream, segments, color_rgb=(0.06, 0.45, 0.75))
                        if new_stream != stream:
                            page.parent.update_stream(xref, new_stream.encode('latin1'))
                except Exception as ex_color:
                    logger.debug(f"Stream text recolor failed for {href}: {ex_color}")

        details.append({
            "url": href,
            "display_text": entry["display_text"],
            "page": entry["page"],
            "is_linked": entry["is_linked"],
            "rect": entry["rect"],
            "http_status": status_code,
            "http_description": description,
            "http_ok": is_ok,
        })

    # Save document if changes were made
    linked_count = sum(1 for d in details if d["is_linked"])
    not_linked_count = sum(1 for d in details if not d["is_linked"])
    if not analyze_only:
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False)
        doc.close()
        os.replace(temp_path, pdf_path)
    else:
        doc.close()

    return {
        "total_urls": len(details),
        "already_linked": linked_count,
        "not_linked": not_linked_count,
        "details": details,
    }


def _rects_overlap(rect1, rect2, threshold: float = 0.5) -> bool:
    """
    Check if two rectangles overlap significantly.
    threshold: minimum ratio of overlap area to smaller rect's area (0.0-1.0).
    """
    try:
        r1 = fitz.Rect(rect1)
        r2 = fitz.Rect(rect2)
        intersection = r1.intersect(r2)
        if intersection.is_empty:
            return False

        # Calculate overlap area relative to the smaller rectangle
        smaller_area = min(r1.get_area(), r2.get_area())
        overlap_area = intersection.get_area()

        if smaller_area == 0:
            return False

        overlap_ratio = overlap_area / smaller_area
        return overlap_ratio >= threshold
    except Exception:
        return False


def _find_all_text_rects_and_segments(page, text: str, used_rects: list = None):
    """
    Find all bounding rectangles and corresponding text segments for a text string,
    including multi-line URLs where words/characters span across lines.
    """
    clean_text = text.strip()
    if not clean_text:
        return [], []

    if used_rects is None:
        used_rects = []

    def overlaps_used(r):
        return any(fitz.Rect(r).intersects(u) and fitz.Rect(r).intersect(u).get_area() / fitz.Rect(r).get_area() > 0.5 for u in used_rects)

    # 1. Single-line exact match
    raw_rects = page.search_for(clean_text)
    avail_rects = [r for r in raw_rects if not overlaps_used(r)]
    if avail_rects:
        return avail_rects, [clean_text] * len(avail_rects)

    # 2. Multi-line match by searching consecutive words on page
    words = page.get_text('words')
    LEADING_TRIM = '([<{\'"“‘'
    TRAILING_TRIM = ')]}>\'"”’.,;:!?'

    for i in range(len(words)):
        w_first = words[i][4].lstrip(LEADING_TRIM)
        for strip_trail in (False, True):
            cand = w_first.rstrip(TRAILING_TRIM) if strip_trail else w_first
            if cand and clean_text.startswith(cand):
                accum = cand
                segments = [cand]
                matched_rects = []
                w_rect = fitz.Rect(words[i][:4])
                sr = [r for r in page.search_for(cand) if not overlaps_used(r)]
                if sr:
                    best_r = min(sr, key=lambda r: abs(r.y0 - w_rect.y0) + abs(r.x0 - w_rect.x0))
                    matched_rects.append(best_r)
                else:
                    matched_rects.append(w_rect)

                if accum == clean_text:
                    return matched_rects, segments

                for j in range(i + 1, min(i + 15, len(words))):
                    w_next = words[j][4]
                    rem = clean_text[len(accum):]
                    matched_step = False
                    for st in (False, True):
                        w_cand = w_next.rstrip(TRAILING_TRIM) if st else w_next
                        if w_cand and (rem.startswith(w_cand) or rem == w_cand):
                            accum += w_cand
                            segments.append(w_cand)
                            sr_j = [r for r in page.search_for(w_cand) if not overlaps_used(r)]
                            w_rect_j = fitz.Rect(words[j][:4])
                            if sr_j:
                                best_r = min(sr_j, key=lambda r: abs(r.y0 - w_rect_j.y0) + abs(r.x0 - w_rect_j.x0))
                                matched_rects.append(best_r)
                            else:
                                matched_rects.append(w_rect_j)
                            matched_step = True
                            break
                    if matched_step:
                        if accum == clean_text:
                            return matched_rects, segments
                    else:
                        break

    # 3. Fallback: search for long prefix (first line)
    if len(clean_text) > 30:
        for prefix_len in range(len(clean_text) - 5, 20, -5):
            prefix = clean_text[:prefix_len]
            sr = [r for r in page.search_for(prefix) if not overlaps_used(r)]
            if sr:
                remainder = clean_text[prefix_len:]
                matched_rects = [sr[0]]
                segments = [prefix]
                if remainder:
                    sr_rem = [r for r in page.search_for(remainder) if not overlaps_used(r)]
                    if sr_rem:
                        below_rects = [r for r in sr_rem if r.y0 >= sr[0].y0 - 2]
                        if below_rects:
                            best_rem = min(below_rects, key=lambda r: r.y0 - sr[0].y0)
                            matched_rects.append(best_rem)
                            segments.append(remainder)
                return matched_rects, segments

    base = clean_text.split('/')[0]
    if base != clean_text:
        base_rects = [r for r in page.search_for(base) if not overlaps_used(r)]
        if base_rects:
            return base_rects, [base] * len(base_rects)

    return [], []


def _find_all_text_rects(page, text: str, used_rects: list = None):
    """
    Find all bounding rectangles for a text string, including multi-line URLs
    where words/characters span across lines.
    """
    rects, _ = _find_all_text_rects_and_segments(page, text, used_rects=used_rects)
    return rects


def _find_text_rect(page, text: str):
    """Find the bounding rectangle of a given text string on the page."""
    rects = _find_all_text_rects(page, text)
    return rects[0] if rects else None


def _normalise_url(url: str) -> str:
    """Strip protocol and trailing slash for comparison (http:// == https://)."""
    url = url.strip().rstrip('/')
    for prefix in ('https://', 'http://'):
        if url.lower().startswith(prefix):
            return url[len(prefix):].lower()
    return url.lower()


def _recolor_text_exact_blue(page, text_str: str, rects: list, color=(0.06, 0.45, 0.75), segments: list = None):
    """
    Transparent redaction and font re-insertion is disabled because PyMuPDF's
    apply_redactions rewrites the page contents stream, corrupting relative text
    matrices (Tm / Td / T*) in surrounding content (such as tables).
    Native PDF link annotations alone provide full clickable hyperlinking without
    distorting underlying page layouts.
    """
    return


