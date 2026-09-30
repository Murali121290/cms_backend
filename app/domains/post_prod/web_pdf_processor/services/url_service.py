"""
URL Hyperlinking Service for PDF Post-Production.

Scans all pages for plain-text URLs, checks if they are hyperlinked in the PDF,
and verifies whether the URLs are actually reachable (HTTP status).
"""
import re
import os
import fitz  # PyMuPDF
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

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
        resp = requests.head(href, allow_redirects=True, timeout=8, headers=headers)
        if resp.status_code == 405:
            resp = requests.get(href, allow_redirects=True, timeout=8, headers=headers, stream=True)
        return resp.status_code, _status_description(resp.status_code)
    except requests.exceptions.SSLError:
        return None, 'SSL Error'
    except requests.exceptions.ConnectionError:
        return None, 'Connection Error'
    except requests.exceptions.Timeout:
        return None, 'Timeout'
    except Exception as e:
        return None, f'Error: {str(e)[:40]}'


def _status_description(code: int) -> str:
    descriptions = {
        200: 'OK', 201: 'Created', 204: 'No Content',
        301: 'Moved Permanently', 302: 'Found', 307: 'Redirect', 308: 'Redirect',
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
        404: 'Not Found', 405: 'Method Not Allowed', 410: 'Gone',
        500: 'Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
    }
    return descriptions.get(code, f'HTTP {code}')


def find_urls_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
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

        # Extract all text words with positions
        words = page.get_text("words")

        # Group words into lines by (block_no, line_no)
        lines: dict = {}
        for w in words:
            x0, y0, x1, y1, word, block_no, line_no, word_no = w
            key = (block_no, line_no)
            if key not in lines:
                lines[key] = []
            lines[key].append((x0, y0, x1, y1, word, word_no))

        for key, line_words in lines.items():
            line_words.sort(key=lambda w: w[5])
            line_text = " ".join(w[4] for w in line_words)

            for m in URL_PATTERN.finditer(line_text):
                raw_url = m.group(0).rstrip('.,;:!?')
                href = raw_url if raw_url.startswith('http') else f'https://{raw_url}'
                # Compare normalised (protocol-stripped) so http:// and https:// both match
                norm = _normalise_url(href)
                url_rect = _find_text_rect(page, raw_url)

                # Check if already linked by:
                # 1. Exact URI match (normalized or raw)
                # 2. Spatial overlap with existing link rectangles
                already_linked = (
                    norm in existing_uris_norm or
                    href.rstrip('/') in existing_uris_raw or
                    raw_url.rstrip('/') in existing_uris_raw
                )

                # If not found by URI match, check spatial overlap
                if not already_linked and url_rect:
                    for link_rect, link_uri in existing_link_rects:
                        if _rects_overlap(url_rect, link_rect):
                            already_linked = True
                            break

                raw_entries.append({
                    "url": href,
                    "display_text": raw_url,
                    "page": physical_page,
                    "is_linked": already_linked,
                    "rect": list(url_rect) if url_rect else None,
                    "page_idx": page_idx,
                })

    # Check HTTP reachability for each unique URL in parallel
    unique_hrefs = list({e["url"] for e in raw_entries})
    http_results: dict = {}

    if unique_hrefs:
        with ThreadPoolExecutor(max_workers=min(10, len(unique_hrefs))) as executor:
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

        if not entry["is_linked"]:
            not_linked_count += 1
            if not analyze_only and entry["rect"]:
                page = doc[entry["page_idx"]]
                page.insert_link({
                    "kind": fitz.LINK_URI,
                    "from": fitz.Rect(entry["rect"]),
                    "uri": href,
                })
                entry["is_linked"] = True
        else:
            linked_count += 1

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

    if not analyze_only:
        linked_count = sum(1 for d in details if d["is_linked"])
        not_linked_count = sum(1 for d in details if not d["is_linked"])
        if details:
            temp_path = pdf_path.replace('.pdf', '_temp.pdf')
            doc.save(temp_path, incremental=False, garbage=3, deflate=True)
            doc.close()
            os.replace(temp_path, pdf_path)
        else:
            doc.close()
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


def _find_text_rect(page, text: str):
    """Find the bounding rectangle of a given text string on the page."""
    rects = page.search_for(text)
    if rects:
        return rects[0]

    if len(text) > 40:
        rects = page.search_for(text[:40])
        if rects:
            return rects[0]

    base = text.split('/')[0]
    if base != text:
        rects = page.search_for(base)
        if rects:
            return rects[0]

    return None


def _normalise_url(url: str) -> str:
    """Strip protocol and trailing slash for comparison (http:// == https://)."""
    url = url.strip().rstrip('/')
    for prefix in ('https://', 'http://'):
        if url.lower().startswith(prefix):
            return url[len(prefix):].lower()
    return url.lower()
