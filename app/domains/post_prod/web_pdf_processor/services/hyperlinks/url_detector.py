"""
PDF URL Detection & Multi-line Reconstruction Module.

Detects plain-text URLs on PDF pages, accurately detecting and reconstructing
URLs that wrap across line breaks or columns without joining unrelated text.
Uses modern pymupdf (PyMuPDF) APIs.
"""
import re
import unicodedata
from typing import List, Tuple, Optional, Set
import pymupdf

from .models import DetectedUrl

# Common top-level domains for detecting URLs without http/https or www
COMMON_TLDS = {
    'com', 'org', 'edu', 'gov', 'net', 'io', 'co', 'info', 'ai', 'ca',
    'uk', 'de', 'au', 'fr', 'in', 'eu', 'me', 'app', 'dev', 'online',
    'site', 'store', 'tech', 'xyz', 'us', 'ch', 'nl', 'se', 'no', 'es',
    'it', 'ru', 'br', 'jp', 'kr', 'cn', 'mil', 'int', 'pub', 'cc', 'tv'
}

# Recognized file/path extensions at the end of URLs
URL_EXTENSIONS = (
    '.html', '.htm', '.pdf', '.php', '.aspx', '.asp', '.jsp', '.xml',
    '.json', '.zip', '.txt', '.csv', '.png', '.jpg', '.jpeg', '.svg'
)

# Leading and trailing noise characters to strip from around extracted URLs
LEADING_PUNCT = '([<{\'\"“‘\u201c\u2018'
TRAILING_PUNCT = ')]}>\'"”’\u201d\u2019.,;:!?'

# Regex to detect standard starting tokens of URLs (including split scheme like 'https:')
URL_PREFIX_PATTERN = re.compile(r'^(?:https?://|https?:$|http:$|www\.)', re.IGNORECASE)


def clean_invisible_chars(text: str) -> str:
    """Strip zero-width spaces, byte-order marks, and control characters from URL text."""
    if not text:
        return ""
    # Strip zero-width chars and soft-hyphens
    cleaned = re.sub(r'[\u200b\u200c\u200d\ufeff\xad]', '', text)
    # Replace non-breaking spaces with standard space
    cleaned = cleaned.replace('\xa0', ' ').replace('\u2002', ' ').replace('\u2003', ' ')
    return cleaned


def is_url_start(token: str) -> bool:
    """
    Check if a word token marks the beginning of a URL:
    - Explicit scheme: http://, https://, or line-ending 'https:', 'http:'
    - Explicit subdomain: www.
    - Bare domain with path or query: e.g. radarwithcode.com/doc or doi.org/10.1000
    - Protocol-relative starting with '//'
    """
    clean = clean_invisible_chars(token).lstrip(LEADING_PUNCT)
    if not clean:
        return False
    
    # 1. Direct prefix match
    if URL_PREFIX_PATTERN.match(clean) or clean.lower() in ('https:', 'http:', '//'):
        return True
    
    # 2. Check for bare domain + path (e.g. 'example.com/books' or 'doi.org/10...')
    if '/' in clean:
        parts = clean.split('/', 1)
        domain = parts[0].lower().rstrip(':8080').rstrip(':443').rstrip(':80')
        if '.' in domain:
            tld = domain.rsplit('.', 1)[-1]
            if tld in COMMON_TLDS and len(domain.split('.')[0]) >= 2:
                # Ensure left side is a valid hostname label
                if re.match(r'^[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?$', domain.split('.')[0]):
                    return True

    return False


def is_valid_url_continuation(
    accumulated_url: str,
    next_token: str,
    prev_word: tuple,
    next_word: tuple
) -> Tuple[bool, str]:
    """
    Evaluates whether `next_token` (on the same visual line or next line L+1)
    is a genuine continuation of `accumulated_url`.
    Handles URLs broken by LaTeX / line breaking with separated slashes, hyphens, and paths.
    Returns (is_continuation, cleaned_continuation_token).
    """
    clean_next = clean_invisible_chars(next_token).strip()
    if not clean_next:
        return False, ""

    # Negative check 1: List bullets, numbered markers, or bibliography entry citations like '[30]'
    if re.match(r'^(?:\[\d+\]|[•\*\u2022\u25cf\u25cb]|\d+[\.\)\]\t]|[a-zA-Z][\.\)\t])', clean_next):
        return False, ""

    # Negative check 2: New scheme or separate URL (unless accumulated_url is just a scheme prefix like 'https://' or 'https:')
    accum_lower = accumulated_url.lower().strip()
    if URL_PREFIX_PATTERN.match(clean_next) and accum_lower not in ('https:', 'http:', 'https://', 'http://', '//'):
        return False, ""

    # Negative check 3: Standard sentence prose words that start with a capital
    common_prose_starters = {
        'the', 'this', 'that', 'these', 'those', 'for', 'from', 'with', 'about',
        'please', 'however', 'note', 'see', 'also', 'and', 'but', 'accessed',
        'retrieved', 'available', 'visit', 'chapter', 'section', 'table', 'figure'
    }
    first_word_lower = re.split(r'[\s/.,;:!?]', clean_next)[0].lower()
    if first_word_lower in common_prose_starters and not any(ch in clean_next for ch in ['/', '?', '=', '&', '#']) and accum_lower not in ('https:', 'http:', 'https://', 'http://'):
        return False, ""

    # Negative check 4: Illegal characters in URL path
    if any(ch in clean_next for ch in ['<', '>', '"', '`', '{', '}', '|', '\\', '^']):
        return False, ""

    # Proximity check using PyMuPDF word tuples:
    # word: (x0, y0, x1, y1, text, block_no, line_no, word_no)
    prev_height = prev_word[3] - prev_word[1]
    vertical_gap = next_word[1] - prev_word[3]
    max_vertical_gap = max(18.0, prev_height * 2.5)

    is_same_line = abs(next_word[1] - prev_word[1]) <= 5.0 and (-4.0 <= next_word[0] - prev_word[2] <= 24.0)
    is_next_line = (next_word[1] > prev_word[1] + 3.0) and (-4.0 <= vertical_gap <= max_vertical_gap)

    if not (is_same_line or is_next_line):
        return False, ""

    # Positive check: Valid URL character token (stripping trailing prose punctuation at boundary)
    clean_next_core = clean_next.rstrip(TRAILING_PUNCT)
    is_path_like = bool(re.match(r'^[a-zA-Z0-9_\-\.\/\?\=\&\#\%\:\~\+\@]+$', clean_next_core))
    if not is_path_like:
        return False, ""

    # Scheme continuation: e.g. 'https:' or 'https://' on line L followed by domain or path on line L or L+1
    if accum_lower in ('https:', 'http:', 'https', 'http'):
        if clean_next.startswith('//'):
            return True, clean_next
        if clean_next in ('/', '//') or clean_next.startswith('/'):
            return True, clean_next
        if '.' in clean_next:
            return True, '//' + clean_next
    elif accum_lower in ('https://', 'http://', '//'):
        if '.' in clean_next or '/' in clean_next or clean_next in ('www.',) or clean_next.startswith('www.'):
            return True, clean_next

    # Delimiters and path continuation
    trailing_delim = any(accumulated_url.endswith(ch) for ch in ['/', '.', '-', '_', '?', '=', '&', ':', '~', '%', '#'])
    leading_delim = any(clean_next.startswith(ch) for ch in ['/', '-', '_', '?', '=', '&', '#', '~', '%'])
    has_domain_and_path = ('/' in accumulated_url and not any(accumulated_url.lower().endswith(ext) for ext in URL_EXTENSIONS))

    # Same line continuation of URL tokens (e.g. slashes or hyphens separated by spaces in LaTeX typesetting)
    if is_same_line:
        if trailing_delim or leading_delim or clean_next in ('/', '-') or has_domain_and_path:
            return True, clean_next

    # Next line continuation
    if is_next_line:
        if accumulated_url.endswith('-') and is_path_like:
            return True, clean_next
        if (trailing_delim or leading_delim) and is_path_like:
            return True, clean_next
        if has_domain_and_path and is_path_like and (' ' not in clean_next):
            return True, clean_next

    return False, ""


def normalize_reconstructed_url(raw_url: str) -> str:
    """
    Normalizes a reconstructed URL:
    - Strips surrounding brackets, quotes, and trailing prose punctuation.
    - Preserves internal query params, fragments, percent encoding, and meaningful hyphens.
    - Ensures valid protocol (prepends https:// if missing).
    """
    url = raw_url.strip()
    
    # Strip leading punctuation
    url = url.lstrip(LEADING_PUNCT)
    
    # Strip trailing punctuation, handling balanced parentheses
    # e.g. 'https://en.wikipedia.org/wiki/Radar_(disambiguation).' -> 'https://en.wikipedia.org/wiki/Radar_(disambiguation)'
    while url and url[-1] in TRAILING_PUNCT:
        if url[-1] == ')' and url.count('(') >= url.count(')'):
            # Preserves balanced closing parenthesis inside URL
            break
        if url[-1] == ']' and url.count('[') >= url.count(']'):
            break
        url = url[:-1]

    # Clean any internal soft hyphens or zero-width chars
    url = clean_invisible_chars(url)

    # Ensure protocol scheme is present
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+\-.]*://', url):
        url = f"https://{url}"

    return url


def extract_page_urls(page: pymupdf.Page) -> List[DetectedUrl]:
    """
    Scans a single PDF page and extracts all plain-text URLs,
    accurately detecting and reconstructing multi-line URLs.
    
    Returns a list of DetectedUrl objects with exact page coordinates,
    segments, and both raw and normalized values.
    """
    words = page.get_text('words')
    if not words:
        return []

    # Sort words primarily by block_no, line_no, word_no (visual reading order)
    # word: (x0, y0, x1, y1, text, block_no, line_no, word_no)
    words.sort(key=lambda w: (w[5], w[6], w[7]))

    detected_urls: List[DetectedUrl] = []
    used_word_indices: Set[int] = set()
    page_num = page.number + 1

    i = 0
    while i < len(words):
        if i in used_word_indices:
            i += 1
            continue

        w_raw = words[i][4]
        if is_url_start(w_raw):
            clean_first = clean_invisible_chars(w_raw).lstrip(LEADING_PUNCT)
            accum_raw = w_raw
            accum_clean = clean_first
            matched_words = [words[i]]
            matched_indices = [i]

            j = i + 1
            while j < len(words):
                w_prev = words[j - 1]
                w_curr = words[j]

                is_cont, next_clean = is_valid_url_continuation(
                    accumulated_url=accum_clean,
                    next_token=w_curr[4],
                    prev_word=w_prev,
                    next_word=w_curr
                )

                if is_cont:
                    accum_raw += " " + w_curr[4]
                    accum_clean += next_clean
                    matched_words.append(w_curr)
                    matched_indices.append(j)
                    j += 1
                else:
                    break

            # Reconstruct and normalize the URL
            final_reconstructed = normalize_reconstructed_url(accum_clean)
            
            # Discard incomplete scheme-only tokens that failed to find host continuation
            clean_rec = final_reconstructed.lower().strip().rstrip('/')
            if clean_rec in ('https:', 'http:', 'https', 'http', '', 'https:/', 'http:/'):
                i = j
                continue
            
            # Group matched words by visual lines to calculate line segments and rects
            line_groups: dict = {}
            for mw in matched_words:
                # Key by (block_no, line_no) or spatial row
                line_key = (mw[5], mw[6])
                if line_key not in line_groups:
                    line_groups[line_key] = []
                line_groups[line_key].append(mw)

            segment_rects: List[List[float]] = []
            segment_texts: List[str] = []
            for l_key, l_words in line_groups.items():
                seg_x0 = min(w[0] for w in l_words)
                seg_y0 = min(w[1] for w in l_words)
                seg_x1 = max(w[2] for w in l_words)
                seg_y1 = max(w[3] for w in l_words)
                seg_txt = "".join(w[4] for w in l_words)
                segment_rects.append([seg_x0, seg_y0, seg_x1, seg_y1])
                segment_texts.append(seg_txt)

            # Calculate primary enclosing bounding box
            if segment_rects:
                all_x0 = min(r[0] for r in segment_rects)
                all_y0 = min(r[1] for r in segment_rects)
                all_x1 = max(r[2] for r in segment_rects)
                all_y1 = max(r[3] for r in segment_rects)
                primary_rect = [all_x0, all_y0, all_x1, all_y1]
            else:
                primary_rect = None

            is_multiline = len(segment_rects) > 1

            detected = DetectedUrl(
                raw_text=accum_raw.strip(),
                reconstructed_url=final_reconstructed,
                page=page_num,
                page_idx=page.number,
                is_multiline=is_multiline,
                line_count=len(segment_rects),
                segments=segment_texts,
                rects=segment_rects,
                primary_rect=primary_rect
            )
            detected_urls.append(detected)
            used_word_indices.update(matched_indices)
            i = j
        else:
            i += 1

    return detected_urls
