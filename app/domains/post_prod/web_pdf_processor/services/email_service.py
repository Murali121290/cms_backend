"""
Email Hyperlinking Service for PDF Post-Production.

Scans all pages for plain-text email addresses, checks if they are already
hyperlinked as mailto: links in the PDF, and optionally converts them to
active email hyperlinks.
"""
import re
import os
import fitz  # PyMuPDF
import logging
from app.domains.post_prod.web_pdf_processor.services.stream_color_utils import recolor_url_in_stream, recolor_text_in_stream

logger = logging.getLogger(__name__)

# Regex to detect email addresses
EMAIL_PATTERN = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
    re.IGNORECASE
)


def _clean_invisible(text: str) -> str:
    """Strip zero-width spaces and soft hyphens commonly inserted in PDF emails."""
    return re.sub(r'[\u200b\u200c\u200d\ufeff\xad]', '', text)


def _extract_page_emails_and_rects(page):
    """
    Extracts emails from a page, properly handling line wrapping across line breaks,
    and returns list of (clean_email, [fitz.Rect, ...], [seg_text, ...]).
    """
    words = page.get_text('words')
    found = []
    used_word_indices = set()
    email_tlds = (
        '.com', '.org', '.edu', '.gov', '.net', '.io', '.co.uk', '.uk',
        '.ca', '.au', '.de', '.fr', '.in'
    )
    
    i = 0
    while i < len(words):
        if i in used_word_indices:
            i += 1
            continue
            
        w_raw = words[i][4]
        w_clean = _clean_invisible(w_raw).lstrip('([<{\'\"“‘')
        if '@' in w_clean or w_clean.endswith('@'):
            accum_clean = w_clean
            matched_words = [words[i]]
            matched_indices = [i]
            
            j = i + 1
            while j < len(words):
                w_prev = words[j - 1]
                w_curr = words[j]
                same_block = (w_curr[5] == w_prev[5])
                consecutive_line = (w_curr[6] == w_prev[6] + 1) and (w_curr[7] == 0)
                same_line = (w_curr[6] == w_prev[6])
                if not (same_line or (same_block and consecutive_line)):
                    break
                next_clean = _clean_invisible(w_curr[4])
                if re.match(r'^(?:[•\*]|\d+[\.\t]|[A-Z][a-z]+ [A-Z])', next_clean):
                    break
                    
                # If current already ends with valid domain extension (ignoring trailing punctuation), it is complete
                base_clean = accum_clean.rstrip('.,;:!?()[]{}')
                if any(base_clean.endswith(ext) for ext in email_tlds):
                    break
                    
                is_cont = False
                if accum_clean.endswith('@') or accum_clean.endswith('.'):
                    is_cont = True
                elif next_clean.startswith('@') or next_clean.startswith('.'):
                    is_cont = True
                elif '@' in accum_clean:
                    if re.match(r'^[a-zA-Z0-9_\-\.]+$', next_clean):
                        is_cont = True
                        
                if is_cont:
                    accum_clean += next_clean
                    matched_words.append(w_curr)
                    matched_indices.append(j)
                    j += 1
                else:
                    break
                    
            clean_email = accum_clean.rstrip('.,;:!?()[]{}')
            if re.match(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$', clean_email):
                rects = [fitz.Rect(mw[:4]) for mw in matched_words]
                segs = [mw[4] for mw in matched_words]
                used_word_indices.update(matched_indices)
                found.append((clean_email, rects, segs))
                i = j
            else:
                i += 1
        else:
            i += 1
            
    return found


def find_emails_in_pdf(pdf_path: str, analyze_only: bool = True, color_emails: bool = False) -> dict:
    """
    Scan PDF for plain-text email addresses.
    - Checks if each email is already hyperlinked as a mailto: link in the PDF.
    - If analyze_only=False, converts unlinked emails to active mailto: hyperlinks across all wrapped rects.
    Returns a report with per-email details.
    """
    doc = fitz.open(pdf_path)
    raw_entries = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1

        # Collect existing mailto: hyperlinks on this page
        existing_emails_raw = set()
        existing_link_rects = []
        for link in page.get_links():
            if link.get('kind') == fitz.LINK_URI:
                uri = link.get('uri', '')
                if uri.startswith('mailto:'):
                    # Extract email from mailto: link
                    email = uri.replace('mailto:', '').split('?')[0].lower()
                    existing_emails_raw.add(email)
                    rect = link.get('from')
                    if rect:
                        existing_link_rects.append((rect, email))

        # Structured multi-line email extraction
        page_emails_info = _extract_page_emails_and_rects(page)

        for raw_email, matched_rects, segs in page_emails_info:
            email_lower = raw_email.lower()

            # Check if already linked
            already_linked = email_lower in existing_emails_raw

            # If not found by URI match, check spatial overlap
            if not already_linked and matched_rects:
                for link_rect, link_email in existing_link_rects:
                    if any(_rects_overlap(r, link_rect) for r in matched_rects):
                        already_linked = True
                        break

            primary_rect = matched_rects[0] if matched_rects else None
            email_entry = {
                "email": raw_email,
                "email_lower": email_lower,
                "page": physical_page,
                "is_linked": already_linked,
                "rect": list(primary_rect) if primary_rect else None,
                "all_rects": [list(r) for r in matched_rects],
                "segments": segs,
                "page_idx": page_idx,
            }

            if not email_entry["is_linked"]:
                if not analyze_only and matched_rects:
                    mailto_uri = f"mailto:{email_entry['email']}"
                    existing_links = page.get_links()
                    for target_rect in matched_rects:
                        already_has_link = any(
                            target_rect.intersects(fitz.Rect(ex["from"])) and
                            target_rect.intersect(fitz.Rect(ex["from"])).get_area() / target_rect.get_area() > 0.6
                            for ex in existing_links
                        )
                        if not already_has_link:
                            page.insert_link({
                                "kind": fitz.LINK_URI,
                                "from": target_rect,
                                "uri": mailto_uri,
                            })
                    
                    if color_emails:
                        try:
                            tgt_segs = email_entry.get("segments") or [email_entry.get("email")]
                            for xref in page.get_contents():
                                stream = page.parent.xref_stream(xref).decode('latin1', errors='ignore')
                                new_stream = recolor_url_in_stream(stream, tgt_segs, color_rgb=(0.06, 0.45, 0.75))
                                if new_stream != stream:
                                    page.parent.update_stream(xref, new_stream.encode('latin1'))
                        except Exception as ex_color:
                            logger.debug(f"Stream text recolor failed for email: {ex_color}")
                    
                    email_entry["is_linked"] = True
            else:
                if not analyze_only and matched_rects and color_emails:
                    try:
                        tgt_segs = email_entry.get("segments") or [email_entry.get("email")]
                        for xref in page.get_contents():
                            stream = page.parent.xref_stream(xref).decode('latin1', errors='ignore')
                            new_stream = recolor_url_in_stream(stream, tgt_segs, color_rgb=(0.06, 0.45, 0.75))
                            if new_stream != stream:
                                page.parent.update_stream(xref, new_stream.encode('latin1'))
                    except Exception as ex_color:
                        logger.debug(f"Stream text recolor failed for email: {ex_color}")

            raw_entries.append(email_entry)

    # Build details list
    details = []
    linked_count = 0
    not_linked_count = 0

    for entry in raw_entries:
        if entry["is_linked"]:
            linked_count += 1
        else:
            not_linked_count += 1

        details.append({
            "email": entry["email"],
            "page": entry["page"],
            "is_linked": entry["is_linked"],
            "rect": entry["rect"],
            "all_rects": entry.get("all_rects", []),
            "segments": entry.get("segments", []),
        })

    if not analyze_only:
        linked_count = sum(1 for d in details if d["is_linked"])
        not_linked_count = sum(1 for d in details if not d["is_linked"])
        if details:
            temp_path = pdf_path.replace('.pdf', '_temp.pdf')
            doc.save(temp_path, incremental=False, garbage=0, deflate=True)
            doc.close()
            os.replace(temp_path, pdf_path)
        else:
            doc.close()
    else:
        doc.close()

    return {
        "total_emails": len(details),
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

    base = text.split('@')[0]
    if base != text:
        rects = page.search_for(base)
        if rects:
            return rects[0]

    return None


def _recolor_text_exact_blue(page, text_str: str, rects: list, color=(0.06, 0.45, 0.75)):
    """
    Transparent redaction and font re-insertion is disabled because PyMuPDF's
    apply_redactions rewrites the page contents stream, corrupting relative text
    matrices (Tm / Td / T*) in surrounding content (such as tables).
    Native PDF link annotations alone provide full clickable hyperlinking without
    distorting underlying page layouts.
    """
    return
