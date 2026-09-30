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

logger = logging.getLogger(__name__)

# Regex to detect email addresses
EMAIL_PATTERN = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
    re.IGNORECASE
)


def find_emails_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scan PDF for plain-text email addresses.
    - Checks if each email is already hyperlinked as a mailto: link in the PDF.
    - If analyze_only=False, converts unlinked emails to active mailto: hyperlinks.
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

        # Extract all text at once
        page_text = page.get_text()

        # Normalize line breaks to preserve text across lines
        normalized_text = page_text.replace('\n', ' ').replace('\r', ' ')
        normalized_text = ' '.join(normalized_text.split())

        # Find all emails in the normalized page text
        found_emails = []
        for m in EMAIL_PATTERN.finditer(normalized_text):
            raw_email = m.group(0).rstrip('.,;:!?')
            email_lower = raw_email.lower()

            # Check if already linked
            already_linked = email_lower in existing_emails_raw

            # If not found by URI match, check spatial overlap
            if not already_linked:
                email_rect = _find_text_rect(page, raw_email)
                if email_rect:
                    for link_rect, link_email in existing_link_rects:
                        if _rects_overlap(email_rect, link_rect):
                            already_linked = True
                            break

            found_emails.append({
                "email": raw_email,
                "email_lower": email_lower,
                "page": physical_page,
                "is_linked": already_linked,
                "rect": _find_text_rect(page, raw_email),
                "page_idx": page_idx,
            })

            logger.debug(f"Found email on page {physical_page}: {raw_email} (linked: {already_linked})")

        # Process all found emails
        for email_entry in found_emails:
            email_rect = email_entry["rect"]

            if not email_entry["is_linked"]:
                if not analyze_only and email_rect:
                    page = doc[email_entry["page_idx"]]
                    # Create mailto: link
                    mailto_uri = f"mailto:{email_entry['email']}"
                    page.insert_link({
                        "kind": fitz.LINK_URI,
                        "from": fitz.Rect(email_rect),
                        "uri": mailto_uri,
                    })
                    email_entry["is_linked"] = True
                    logger.debug(f"Created mailto link for {email_entry['email']} on page {email_entry['page']}")

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
            "rect": [entry["rect"][0], entry["rect"][1], entry["rect"][2], entry["rect"][3]] if entry["rect"] else None,
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
