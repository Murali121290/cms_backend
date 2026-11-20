"""
PDF Hyperlink Annotation Extraction & Correlation Module.

Inspects PDF internal link annotations, correlates them with detected visible text,
and identifies missing annotations, destination mismatches, malformed targets,
and duplicate annotations.
"""
from typing import List, Dict, Tuple, Optional, Set
import pymupdf

from .models import LinkAnnotationInfo, DetectedUrl, ProcessedHyperlinkItem


def rects_overlap(rect1, rect2, threshold: float = 0.3) -> bool:
    """
    Checks if two rectangles overlap significantly.
    threshold: minimum ratio of intersection area to smaller rect's area.
    """
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


def normalize_url_for_comparison(url: Optional[str]) -> str:
    """Strip protocol and trailing slashes for semantic comparison (http == https)."""
    if not url:
        return ""
    u = url.strip().rstrip('/')
    for prefix in ('https://', 'http://'):
        if u.lower().startswith(prefix):
            u = u[len(prefix):]
            break
    if u.lower().startswith('www.'):
        u = u[4:]
    return u.lower()


def extract_page_link_annotations(page: pymupdf.Page) -> List[LinkAnnotationInfo]:
    """
    Extracts all hyperlink annotations from a single page with their destinations,
    rectangles, and underlying visible text.
    """
    annotations: List[LinkAnnotationInfo] = []
    links = page.get_links()
    page_num = page.number + 1

    for link in links:
        kind = link.get('kind', 0)
        from_rect = link.get('from')
        rect_list = list(from_rect) if from_rect else None
        
        # Determine destination
        uri = link.get('uri')
        target_page = link.get('page')
        is_external = (kind == pymupdf.LINK_URI)
        
        kind_names = {
            pymupdf.LINK_NONE: 'NONE',
            pymupdf.LINK_GOTO: 'GOTO',
            pymupdf.LINK_URI: 'URI',
            pymupdf.LINK_LAUNCH: 'LAUNCH',
            pymupdf.LINK_NAMED: 'NAMED',
            pymupdf.LINK_GOTOR: 'GOTOR'
        }
        kind_name = kind_names.get(kind, f'KIND_{kind}')

        # Extract visible text within annotation rectangle
        visible_text = ""
        if from_rect:
            visible_text = page.get_text('text', clip=from_rect).strip()

        # Check for malformed URI
        is_malformed = False
        if is_external:
            if not uri or uri.isspace():
                is_malformed = True
            elif not uri.startswith(('http://', 'https://', 'ftp://', 'mailto:')):
                # Missing or broken scheme
                is_malformed = True

        annot_info = LinkAnnotationInfo(
            page=page_num,
            page_idx=page.number,
            kind=kind,
            kind_name=kind_name,
            uri=uri,
            target_page=target_page,
            rect=rect_list,
            visible_text=visible_text,
            is_external=is_external,
            is_malformed=is_malformed,
            xref=link.get('xref'),
            link_id=link.get('id')
        )
        annotations.append(annot_info)

    return annotations


def correlate_detected_urls_with_annotations(
    detected_urls: List[DetectedUrl],
    annotations: List[LinkAnnotationInfo]
) -> List[ProcessedHyperlinkItem]:
    """
    Correlates detected plain-text URLs with actual PDF link annotations on the page.
    Identifies:
    - Visible URL without hyperlink annotation (missing_annotation)
    - Hyperlink annotation with matching visible URL (valid_linked)
    - Visible URL and annotation destination mismatch (mismatch)
    - Malformed annotation target (malformed_target)
    - Duplicate annotations
    - Anchor-text annotations (annotations where visible text is anchor text rather than URL)
    """
    items: List[ProcessedHyperlinkItem] = []
    matched_annotation_indices: Set[int] = set()

    # Step 1: Check detected plain-text URLs against annotations
    for d_url in detected_urls:
        overlapping_annots = []
        for a_idx, annot in enumerate(annotations):
            if not annot.is_external or not annot.rect:
                continue
            # Check overlap against any segment rectangle or primary rect
            matches_rect = False
            for r in d_url.rects:
                if rects_overlap(r, annot.rect, threshold=0.25):
                    matches_rect = True
                    break
            if not matches_rect and d_url.primary_rect:
                if rects_overlap(d_url.primary_rect, annot.rect, threshold=0.25):
                    matches_rect = True

            if matches_rect:
                overlapping_annots.append((a_idx, annot))

        if overlapping_annots:
            # Mark all overlapping annotations as matched so they are not treated as unmapped in Step 2
            for o_idx, _ in overlapping_annots:
                matched_annotation_indices.add(o_idx)

            a_idx, annot = overlapping_annots[0]

            norm_reconstructed = normalize_url_for_comparison(d_url.reconstructed_url)
            norm_dest = normalize_url_for_comparison(annot.uri)

            is_mismatch = (norm_reconstructed != norm_dest)
            is_malformed = annot.is_malformed
            is_dup = (len(overlapping_annots) > 1)

            issue_type = None
            correction_sugg = None
            if is_malformed:
                issue_type = "malformed_target"
                correction_sugg = f"Fix malformed target to {d_url.reconstructed_url}"
            elif is_mismatch:
                issue_type = "destination_mismatch"
                correction_sugg = f"Visible URL points to {d_url.reconstructed_url}, but annotation target is {annot.uri}"
            elif is_dup:
                issue_type = "duplicate_annotation"
                correction_sugg = "Remove redundant duplicate annotation"
            elif d_url.is_multiline:
                # Multi-line URL already linked - check if all segments are covered
                issue_type = None

            items.append(ProcessedHyperlinkItem(
                page=d_url.page,
                page_idx=d_url.page_idx,
                original_text=d_url.raw_text,
                reconstructed_url=d_url.reconstructed_url,
                annotation_dest=annot.uri,
                is_linked=True,
                is_multiline=d_url.is_multiline,
                line_count=d_url.line_count,
                rect=d_url.primary_rect,
                all_rects=d_url.rects,
                segments=d_url.segments,
                issue_type=issue_type,
                correction_suggestion=correction_sugg
            ))
        else:
            # Plain-text URL with no hyperlink annotation
            items.append(ProcessedHyperlinkItem(
                page=d_url.page,
                page_idx=d_url.page_idx,
                original_text=d_url.raw_text,
                reconstructed_url=d_url.reconstructed_url,
                annotation_dest=None,
                is_linked=False,
                is_multiline=d_url.is_multiline,
                line_count=d_url.line_count,
                rect=d_url.primary_rect,
                all_rects=d_url.rects,
                segments=d_url.segments,
                issue_type="missing_annotation",
                correction_suggestion=f"Add hyperlink annotation to {d_url.reconstructed_url}"
            ))

    # Step 2: Include remaining unassociated link annotations (anchor-text links, image links)
    for a_idx, annot in enumerate(annotations):
        if a_idx in matched_annotation_indices:
            continue
        if not annot.is_external or not annot.uri:
            continue

        annot_rect = annot.rect
        vis_text = annot.visible_text or annot.uri
        
        issue_type = None
        corr_sugg = None
        if annot.is_malformed:
            issue_type = "malformed_target"
            corr_sugg = "Annotation URI is malformed or missing scheme"

        items.append(ProcessedHyperlinkItem(
            page=annot.page,
            page_idx=annot.page_idx,
            original_text=vis_text,
            reconstructed_url=annot.uri,
            annotation_dest=annot.uri,
            is_linked=True,
            is_multiline=False,
            line_count=1,
            rect=annot_rect,
            all_rects=[annot_rect] if annot_rect else [],
            segments=[vis_text],
            issue_type=issue_type,
            correction_suggestion=corr_sugg
        ))

    return items
