"""
Hyperlink Validation & Audit Report Generator.

Aggregates page-level URL detections, annotation correlations, and validation
results into an interactive summary report.
"""
from typing import List, Dict, Any
from .models import ProcessedHyperlinkItem


def generate_hyperlink_report(
    items: List[ProcessedHyperlinkItem],
    total_annotations_count: int = 0,
    automatically_corrected_count: int = 0
) -> Dict[str, Any]:
    """
    Builds a comprehensive audit and validation report from processed hyperlink items.
    """
    total_urls = len(items)
    already_linked = sum(1 for it in items if it.is_linked)
    not_linked = sum(1 for it in items if not it.is_linked)
    multiline_count = sum(1 for it in items if it.is_multiline)

    valid_urls = sum(1 for it in items if it.validation_status == "Valid")
    broken_urls = sum(1 for it in items if it.validation_status == "Broken")
    redirected_urls = sum(1 for it in items if it.validation_status == "Redirected")
    invalid_urls = sum(1 for it in items if it.validation_status == "Invalid")
    access_restricted = sum(1 for it in items if it.validation_status == "Access Restricted")
    timeouts = sum(1 for it in items if it.validation_status == "Timeout")
    ssl_errors = sum(1 for it in items if it.validation_status == "SSL Error")
    manual_review = sum(1 for it in items if it.validation_status in ("Manual Review", "Unknown") or it.issue_type in ("destination_mismatch", "malformed_target"))

    missing_annotations = sum(1 for it in items if it.issue_type == "missing_annotation")
    mismatches = sum(1 for it in items if it.issue_type == "destination_mismatch")
    malformed = sum(1 for it in items if it.issue_type == "malformed_target")
    duplicates = sum(1 for it in items if it.issue_type == "duplicate_annotation")

    summary = {
        "total_urls": total_urls,
        "total_annotations": total_annotations_count,
        "already_linked": already_linked,
        "not_linked": not_linked,
        "multiline_reconstructed": multiline_count,
        "valid_urls": valid_urls,
        "broken_urls": broken_urls,
        "redirected_urls": redirected_urls,
        "invalid_urls": invalid_urls,
        "access_restricted": access_restricted,
        "timeouts": timeouts,
        "ssl_errors": ssl_errors,
        "missing_annotations": missing_annotations,
        "destination_mismatches": mismatches,
        "malformed_annotations": malformed,
        "duplicate_annotations": duplicates,
        "automatically_corrected": automatically_corrected_count,
        "needs_manual_review": manual_review,
    }

    details = [it.to_dict() for it in items]

    return {
        "success": True,
        # Legacy backward-compatible keys
        "total_urls": total_urls,
        "already_linked": already_linked,
        "not_linked": not_linked,
        "details": details,
        # Enhanced detailed report
        "summary": summary,
    }
