"""
PDF URL & Hyperlink Detection, Reconstruction, Validation and Correction Package.
"""
from .models import (
    DetectedUrl,
    LinkAnnotationInfo,
    UrlValidationResult,
    ProcessedHyperlinkItem
)
from .url_detector import extract_page_urls, is_url_start, normalize_reconstructed_url
from .annotation_extractor import extract_page_link_annotations, correlate_detected_urls_with_annotations
from .url_validator import check_single_url_status, validate_urls_batch, is_ssrf_safe_url
from .url_corrector import apply_corrections_and_verify
from .report_generator import generate_hyperlink_report
from .hyperlink_service import process_pdf_hyperlinks, apply_pdf_hyperlink_corrections

__all__ = [
    "DetectedUrl",
    "LinkAnnotationInfo",
    "UrlValidationResult",
    "ProcessedHyperlinkItem",
    "extract_page_urls",
    "is_url_start",
    "normalize_reconstructed_url",
    "extract_page_link_annotations",
    "correlate_detected_urls_with_annotations",
    "check_single_url_status",
    "validate_urls_batch",
    "is_ssrf_safe_url",
    "apply_corrections_and_verify",
    "generate_hyperlink_report",
    "process_pdf_hyperlinks",
    "apply_pdf_hyperlink_corrections"
]
