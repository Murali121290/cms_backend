"""
URL Hyperlinking Service for PDF Post-Production.

Comprehensive URL and hyperlink processing module:
- PDF URL detection (HTTP, HTTPS, www, domain-based, query params, fragments, special chars)
- Robust multi-line URL detection and reconstruction across line wrapping
- PDF hyperlink annotation extraction and visible text correlation
- Safe URL validation with SSRF protection (blocking localhost, private/internal IPs)
- Controlled automatic correction (multi-line annotations, missing annotations, duplicate removal)
- Content stream styling (publishing blue #0563C1)
- Regeneration and verification in the regenerated PDF.
"""
import logging
from typing import Dict, Any, Optional, List

from .hyperlinks import (
    process_pdf_hyperlinks,
    apply_pdf_hyperlink_corrections,
    extract_page_urls,
    extract_page_link_annotations,
    correlate_detected_urls_with_annotations,
    check_single_url_status,
    validate_urls_batch,
    is_ssrf_safe_url
)
from .stream_color_utils import recolor_url_in_stream, recolor_text_in_stream

logger = logging.getLogger(__name__)


def find_urls_in_pdf(
    pdf_path: str,
    analyze_only: bool = True,
    color_urls: bool = False,
    fix_multiline: bool = True,
    fix_missing: bool = True,
    fix_malformed: bool = True,
    remove_duplicates: bool = True,
    custom_details: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Main entry point for PDF URL processing:
    - If analyze_only=True: Performs non-destructive scan, multi-line reconstruction,
      annotation extraction, and safe network validation.
    - If analyze_only=False: Applies approved corrections to a working copy, saves,
      reopens the regenerated PDF, and verifies all applied links.
    Returns backward-compatible dictionary with enhanced detailed report.
    """
    if analyze_only:
        return process_pdf_hyperlinks(pdf_path, skip_network_validation=False)
    else:
        return apply_pdf_hyperlink_corrections(
            pdf_path=pdf_path,
            color_urls=color_urls,
            fix_multiline=fix_multiline,
            fix_missing=fix_missing,
            fix_malformed=fix_malformed,
            remove_duplicates=remove_duplicates,
            custom_details=custom_details
        )


# Backward-compatibility aliases for any existing internal calls
def _check_url_status(href: str):
    res = check_single_url_status(href)
    return res.http_status, res.http_description


def _normalise_url(url: str) -> str:
    url = url.strip().rstrip('/')
    for prefix in ('https://', 'http://'):
        if url.lower().startswith(prefix):
            return url[len(prefix):].lower()
    return url.lower()
