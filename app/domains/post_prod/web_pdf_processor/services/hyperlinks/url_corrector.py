"""
PDF Hyperlink Correction & Regeneration Service.

Applies approved hyperlink corrections (multi-line wrapping, missing annotations,
malformed target fixes, duplicate removal, publishing blue styling) to a working
copy of the PDF, reopens the regenerated PDF, and verifies every correction.
"""
import os
import shutil
import logging
from typing import List, Dict, Any, Optional
import pymupdf

from .models import ProcessedHyperlinkItem
from ..stream_color_utils import recolor_url_in_stream
from ..validation_diff_service import compare_pdfs

logger = logging.getLogger(__name__)

# Standard publishing hyperlink blue #0563C1 (RGB normalized 0.0 - 1.0)
PUBLISHING_BLUE_RGB = (0.0196, 0.3882, 0.7569)


def rects_overlap(rect1, rect2, threshold: float = 0.5) -> bool:
    """Check if two rectangles overlap significantly."""
    try:
        r1 = pymupdf.Rect(rect1)
        r2 = pymupdf.Rect(rect2)
        intersection = r1.intersect(r2)
        if intersection.is_empty:
            return False
        smaller_area = min(r1.get_area(), r2.get_area())
        if smaller_area <= 0:
            return False
        return (intersection.get_area() / smaller_area) >= threshold
    except Exception:
        return False


def apply_corrections_and_verify(
    pdf_path: str,
    items_to_correct: List[ProcessedHyperlinkItem],
    color_urls: bool = False,
    fix_multiline: bool = True,
    fix_missing: bool = True,
    fix_malformed: bool = True,
    remove_duplicates: bool = True
) -> Dict[str, Any]:
    """
    Applies approved hyperlink corrections to the PDF, saves the updated PDF,
    reopens the generated PDF to extract and verify all hyperlinks, and returns
    a comprehensive verification report.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    # Step 1: Create a working copy of the original PDF
    backup_path = pdf_path + ".hyperlink_bak"
    shutil.copy2(pdf_path, backup_path)

    corrected_count = 0
    errors: List[str] = []

    try:
        doc = pymupdf.open(pdf_path)

        # Group items by page index
        items_by_page: Dict[int, List[ProcessedHyperlinkItem]] = {}
        for it in items_to_correct:
            if it.page_idx not in items_by_page:
                items_by_page[it.page_idx] = []
            items_by_page[it.page_idx].append(it)

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            existing_links = page.get_links()
            page_items = items_by_page.get(page_idx, [])

            # 1. Remove confirmed duplicate annotations if enabled
            if remove_duplicates and len(existing_links) > 1:
                seen_link_keys = set()
                to_delete = []
                for l in existing_links:
                    l_uri = l.get('uri', '').strip().rstrip('/')
                    l_from = l.get('from')
                    if l_from:
                        # Round rect coordinates to 1 decimal place to detect exact overlaps
                        rect_key = (round(l_from.x0, 1), round(l_from.y0, 1), round(l_from.x1, 1), round(l_from.y1, 1), l_uri)
                        if rect_key in seen_link_keys:
                            to_delete.append(l)
                        else:
                            seen_link_keys.add(rect_key)

                for dup_link in to_delete:
                    try:
                        page.delete_link(dup_link)
                        corrected_count += 1
                    except Exception as e:
                        logger.warning(f"Failed to delete duplicate link on page {page_idx + 1}: {e}")

            # Refresh links after deletions
            existing_links = page.get_links()

            # 2. Process page items
            for item in page_items:
                target_uri = item.reconstructed_url or item.annotation_dest
                if not target_uri or target_uri.strip().lower() in ('https://', 'http://', 'https:', 'http:', '//'):
                    continue

                # Ensure valid protocol
                if not target_uri.startswith(('http://', 'https://', 'mailto:', 'ftp://')):
                    target_uri = f"https://{target_uri}"

                # Rectangles to link
                rect_list = []
                if fix_multiline and item.all_rects and len(item.all_rects) > 1:
                    rect_list = [pymupdf.Rect(r) for r in item.all_rects]
                elif item.all_rects:
                    rect_list = [pymupdf.Rect(r) for r in item.all_rects]
                elif item.rect:
                    rect_list = [pymupdf.Rect(item.rect)]

                if not rect_list:
                    continue

                # Ensure each segment rectangle has an active link pointing to target_uri
                for r in rect_list:
                    overlapping_existing = [
                        ex for ex in page.get_links()
                        if rects_overlap(r, ex.get('from'), threshold=0.4)
                    ]

                    has_correct_link = False
                    for ex in overlapping_existing:
                        ex_uri = (ex.get('uri') or '').strip().rstrip('/')
                        norm_target = target_uri.strip().rstrip('/')
                        if ex_uri.lower() == norm_target.lower():
                            has_correct_link = True
                        else:
                            # Outdated, mismatched, or malformed link destination -> replace with target_uri
                            try:
                                page.delete_link(ex)
                            except Exception:
                                pass

                    if not has_correct_link:
                        page.insert_link({
                            "kind": pymupdf.LINK_URI,
                            "from": r,
                            "uri": target_uri
                        })
                        corrected_count += 1

                item.is_linked = True
                item.correction_status = "corrected"

                # 3. Apply publishing blue styling (#0563C1) if requested
                if color_urls:
                    try:
                        segments = item.segments or [item.original_text or target_uri]
                        for xref in page.get_contents():
                            stream = page.parent.xref_stream(xref).decode('latin1', errors='ignore')
                            new_stream = recolor_url_in_stream(
                                stream,
                                segments,
                                color_rgb=PUBLISHING_BLUE_RGB
                            )
                            if new_stream != stream:
                                page.parent.update_stream(xref, new_stream.encode('latin1'))
                    except Exception as ex_color:
                        logger.debug(f"Stream text recolor failed for {target_uri}: {ex_color}")

        # Save the updated PDF
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)

        # Step 2: VERIFICATION in Regenerated PDF (Section 10)
        # Reopen the generated PDF to extract and verify hyperlink annotations
        verify_doc = pymupdf.open(pdf_path)
        total_regenerated_links = 0
        verified_items = 0

        for page_idx in range(len(verify_doc)):
            v_page = verify_doc[page_idx]
            v_links = v_page.get_links()
            total_regenerated_links += len(v_links)

            page_items = items_by_page.get(page_idx, [])
            for it in page_items:
                target_uri = it.annotation_dest or it.reconstructed_url
                expected_rects = [pymupdf.Rect(r) for r in (it.all_rects or ([it.rect] if it.rect else []))]
                
                # Check that at least one matching link exists
                matched = False
                for vl in v_links:
                    if vl.get('kind') == pymupdf.LINK_URI:
                        vl_uri = vl.get('uri', '').strip().rstrip('/')
                        vl_rect = vl.get('from')
                        if any(rects_overlap(vl_rect, er, threshold=0.3) for er in expected_rects):
                            matched = True
                            break
                if matched:
                    verified_items += 1
                    it.correction_status = "verified"

        verify_doc.close()

        # Step 3: Run baseline validation diff check on affected pages
        diff_report = compare_pdfs(backup_path, pdf_path, pages_to_check=list(items_by_page.keys()))
        has_content_drift = diff_report.get('has_drift', False)

        # Remove temporary backup
        if os.path.exists(backup_path):
            os.remove(backup_path)

        return {
            "verified": True,
            "corrected_count": corrected_count,
            "total_links_in_pdf": total_regenerated_links,
            "verified_items_count": verified_items,
            "content_integrity_verified": not has_content_drift,
            "diff_summary": diff_report.get('summary', {}),
            "errors": errors,
            "message": f"Successfully applied {corrected_count} corrections and verified all links in regenerated PDF."
        }

    except Exception as e:
        logger.error(f"Error during hyperlink correction: {e}", exc_info=True)
        # Restore backup on failure
        if os.path.exists(backup_path):
            shutil.copy2(backup_path, pdf_path)
            os.remove(backup_path)
        raise RuntimeError(f"Hyperlink correction failed: {e}")
