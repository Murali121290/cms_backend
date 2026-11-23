"""
High-Level PDF Hyperlink Orchestration Service.

Provides complete detection, multi-line reconstruction, annotation correlation,
safe URL validation, controlled correction, and regeneration verification.
"""
import logging
from typing import Dict, Any, List, Optional
import pymupdf

from .models import ProcessedHyperlinkItem
from .url_detector import extract_page_urls
from .annotation_extractor import extract_page_link_annotations, correlate_detected_urls_with_annotations
from .url_validator import validate_urls_batch
from .url_corrector import apply_corrections_and_verify
from .report_generator import generate_hyperlink_report

logger = logging.getLogger(__name__)


def process_pdf_hyperlinks(
    pdf_path: str,
    skip_network_validation: bool = False
) -> Dict[str, Any]:
    """
    Performs full analysis of all pages in a PDF:
    - Plain-text URL detection (including multi-line line-wrapping reconstruction).
    - Internal PDF link annotation extraction.
    - Correlation and issue identification (missing, mismatch, malformed, duplicate).
    - Safe parallel URL validation (SSRF protection, DNS resolution, HTTP reachability).
    - Comprehensive interactive report generation.
    """
    doc = pymupdf.open(pdf_path)
    all_processed_items: List[ProcessedHyperlinkItem] = []
    total_annotations_count = 0

    try:
        # Step 1: Process every page independently
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            
            # Plain-text detection with multi-line stitching
            detected_urls = extract_page_urls(page)
            
            # Annotation extraction
            annotations = extract_page_link_annotations(page)
            total_annotations_count += len(annotations)
            
            # Correlate detected URLs and annotations
            page_items = correlate_detected_urls_with_annotations(detected_urls, annotations)
            all_processed_items.extend(page_items)

        # Step 2: Validate URLs in parallel with caching (unless skipped)
        if not skip_network_validation:
            urls_to_validate = list({
                (it.annotation_dest or it.reconstructed_url)
                for it in all_processed_items
                if (it.annotation_dest or it.reconstructed_url)
            })

            validation_results = validate_urls_batch(urls_to_validate)

            # Assign validation results back to processed items
            for it in all_processed_items:
                target_url = it.annotation_dest or it.reconstructed_url
                res = validation_results.get(target_url)
                if res:
                    it.validation_status = res.status
                    it.http_status = res.http_status
                    it.http_description = res.http_description
                    it.http_ok = res.is_ok
                    it.final_url = res.final_url
                    if not res.is_valid and not it.error_description:
                        it.error_description = res.error_detail or res.http_description

        # Step 3: Generate detailed report
        report = generate_hyperlink_report(
            items=all_processed_items,
            total_annotations_count=total_annotations_count
        )
        return report

    finally:
        doc.close()


def apply_pdf_hyperlink_corrections(
    pdf_path: str,
    color_urls: bool = False,
    fix_multiline: bool = True,
    fix_missing: bool = True,
    fix_malformed: bool = True,
    remove_duplicates: bool = True,
    custom_details: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Applies approved hyperlink corrections to the PDF, verifies the regenerated
    PDF, and returns the updated validation report and verification status.
    If custom_details is provided (e.g. from user manual edits), those items and
    reconstructed URLs are applied.
    """
    items_to_correct = []
    if custom_details:
        for d in custom_details:
            page_idx = d.get('page_idx')
            if page_idx is None:
                page_idx = max(0, d.get('page', 1) - 1)
            target = d.get('reconstructed_url') or d.get('url') or ''
            is_user_edited = bool(d.get('is_edited'))
            dest = target if is_user_edited else d.get('annotation_dest')
            item = ProcessedHyperlinkItem(
                page=d.get('page', page_idx + 1),
                page_idx=page_idx,
                original_text=d.get('original_text') or d.get('display_text') or target,
                reconstructed_url=target,
                annotation_dest=dest,
                is_linked=d.get('is_linked', False),
                is_multiline=d.get('is_multiline', False),
                line_count=d.get('line_count', 1),
                rect=d.get('rect'),
                all_rects=d.get('all_rects', []),
                segments=d.get('segments', []),
                validation_status=d.get('validation_status', 'Pending'),
                http_status=d.get('http_status'),
                http_description=d.get('http_description', ''),
                http_ok=d.get('http_ok', False),
                final_url=d.get('final_url'),
                issue_type="user_edited" if d.get('is_edited') else d.get('issue_type'),
                correction_suggestion=d.get('correction_suggestion'),
                correction_status="edited" if d.get('is_edited') else "pending"
            )
            items_to_correct.append(item)
    else:
        # 1. Analyze existing state
        analysis = process_pdf_hyperlinks(pdf_path, skip_network_validation=False)
        
        # Convert details dicts back to ProcessedHyperlinkItem objects for correction
        for d in analysis.get('details', []):
            item = ProcessedHyperlinkItem(
                page=d['page'],
                page_idx=d['page_idx'],
                original_text=d['original_text'],
                reconstructed_url=d['reconstructed_url'],
                annotation_dest=d['annotation_dest'],
                is_linked=d['is_linked'],
                is_multiline=d['is_multiline'],
                line_count=d['line_count'],
                rect=d['rect'],
                all_rects=d['all_rects'],
                segments=d['segments'],
                validation_status=d['validation_status'],
                http_status=d['http_status'],
                http_description=d['http_description'],
                http_ok=d['http_ok'],
                final_url=d['final_url'],
                issue_type=d['issue_type'],
                correction_suggestion=d['correction_suggestion']
            )
            items_to_correct.append(item)

    # 2. Apply corrections and verify
    verification = apply_corrections_and_verify(
        pdf_path=pdf_path,
        items_to_correct=items_to_correct,
        color_urls=color_urls,
        fix_multiline=fix_multiline,
        fix_missing=fix_missing,
        fix_malformed=fix_malformed,
        remove_duplicates=remove_duplicates
    )

    # 3. Post-correction re-analysis of the regenerated PDF to verify the state
    post_analysis = process_pdf_hyperlinks(pdf_path, skip_network_validation=True)
    post_analysis['summary']['automatically_corrected'] = verification.get('corrected_count', 0)
    post_analysis['verification'] = verification

    return post_analysis
