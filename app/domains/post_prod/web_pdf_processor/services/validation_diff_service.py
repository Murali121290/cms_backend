"""
Validation Diff Service for PDF Post-Production.

Compares the baseline (original merged PDF) against the final processed PDF
to verify that text content, fonts, and layout alignment have not experienced
unexpected regressions or drifts across the workflow steps.
"""
import os
import re
import fitz  # PyMuPDF
import logging
from typing import Dict, Any, List, Optional
import unicodedata

logger = logging.getLogger(__name__)


def _normalize_text(text: str) -> str:
    """Normalize unicode and whitespace for comparison."""
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    return " ".join(normalized.split())


def _clean_comparable_tokens(text: str) -> List[str]:
    """
    Extract comparable normalized tokens.
    Normalizes punctuation spacing so hyperlinked spans (which may break
    around punctuation boundaries like 'domain.com.' vs 'domain.com' + '.')
    are compared accurately without false positive word splits.
    """
    if not text:
        return []
    norm = unicodedata.normalize("NFKD", text)
    # Remove whitespace adjacent to common punctuation
    norm = re.sub(r'\s*([.,;:!?/()\[\]{}–—\-])\s*', r'\1', norm)
    # Split into words/tokens
    return norm.split()


def _extract_page_descriptors(page) -> Dict[str, Any]:
    """
    Extract structured text blocks, spans, fonts, and bounding boxes for a page.
    """
    page_data = page.get_text("dict")
    text_pieces = []
    fonts_used = set()
    span_descriptors = []

    for block in page_data.get("blocks", []):
        if block.get("type") == 0:  # text block
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    span_text = span.get("text", "")
                    clean_span = _normalize_text(span_text)
                    if not clean_span:
                        continue

                    font_name = span.get("font", "")
                    font_size = round(span.get("size", 0), 1)
                    bbox = [round(c, 1) for c in span.get("bbox", (0, 0, 0, 0))]

                    fonts_used.add(f"{font_name} ({font_size}pt)")
                    text_pieces.append(clean_span)

                    span_descriptors.append({
                        "text": clean_span,
                        "font": font_name,
                        "size": font_size,
                        "bbox": bbox,
                    })

    full_text = " ".join(text_pieces)

    return {
        "full_text": full_text,
        "text_pieces": text_pieces,
        "fonts": sorted(list(fonts_used)),
        "spans": span_descriptors,
        "rect": [round(c, 1) for c in page.rect],
    }


def compare_pdfs(
    baseline_path: str,
    final_path: str,
    pages_to_check: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    Compare baseline PDF against the final PDF across:
    1. Text content fidelity (missing or altered words).
    2. Font fidelity (font family or size changes).
    3. Layout alignment (bounding box shift delta x, delta y).
    If pages_to_check is provided (0-indexed page list), only those pages are compared.
    """
    if not os.path.exists(baseline_path):
        return {
            "success": False,
            "error": "Baseline PDF not found.",
        }
    if not os.path.exists(final_path):
        return {
            "success": False,
            "error": "Final PDF not found.",
        }

    try:
        base_doc = fitz.open(baseline_path)
        final_doc = fitz.open(final_path)
    except Exception as e:
        return {"success": False, "error": f"Failed to open PDFs: {str(e)}"}

    base_page_count = len(base_doc)
    final_page_count = len(final_doc)

    page_count_match = (base_page_count == final_page_count)
    total_pages_to_check = min(base_page_count, final_page_count)

    text_discrepancies: List[Dict[str, Any]] = []
    font_discrepancies: List[Dict[str, Any]] = []
    alignment_drifts: List[Dict[str, Any]] = []

    if pages_to_check is not None:
        target_indices = [idx for idx in pages_to_check if 0 <= idx < total_pages_to_check]
    else:
        target_indices = list(range(total_pages_to_check))

    for page_idx in target_indices:
        page_num = page_idx + 1
        base_desc = _extract_page_descriptors(base_doc[page_idx])
        final_desc = _extract_page_descriptors(final_doc[page_idx])

        # 1. Text Content Comparison
        base_text = base_desc["full_text"]
        final_text = final_desc["full_text"]

        if base_text != final_text:
            base_tokens = _clean_comparable_tokens(base_text)
            final_tokens = _clean_comparable_tokens(final_text)
            if base_tokens != final_tokens:
                text_discrepancies.append({
                    "page": page_num,
                    "issue": "Text content differs",
                    "baseline_words": len(base_tokens),
                    "final_words": len(final_tokens),
                    "sample_baseline": base_text[:120] + "..." if len(base_text) > 120 else base_text,
                    "sample_final": final_text[:120] + "..." if len(final_text) > 120 else final_text,
                })

        # 2. Font Comparison
        base_fonts = set(base_desc["fonts"])
        final_fonts = set(final_desc["fonts"])
        if base_fonts != final_fonts:
            missing_fonts = list(base_fonts - final_fonts)
            new_fonts = list(final_fonts - base_fonts)
            if missing_fonts or new_fonts:
                font_discrepancies.append({
                    "page": page_num,
                    "issue": "Font set differences detected",
                    "missing_fonts": missing_fonts[:5],
                    "new_fonts": new_fonts[:5],
                })

        # 3. Alignment Drift Check (Word BBox shifts)
        # Account for page cropbox / trimbox translation offset
        base_crop = base_doc[page_idx].cropbox
        final_crop = final_doc[page_idx].cropbox
        crop_offset_x = final_crop.x0 - base_crop.x0
        crop_offset_y = final_crop.y0 - base_crop.y0

        b_words = base_doc[page_idx].get_text("words")
        f_words = final_doc[page_idx].get_text("words")

        min_words = min(len(b_words), len(f_words))
        significant_shifts = 0
        max_shift = 0.0

        for i in range(min_words):
            bw = b_words[i]
            fw = f_words[i]

            if bw[4] == fw[4]:
                dx = abs(bw[0] - (fw[0] + crop_offset_x))
                dy = abs(bw[1] - (fw[1] + crop_offset_y))
                shift = max(dx, dy)
                if shift > max_shift:
                    max_shift = shift
                # Allow minor tolerance (e.g., 2.5 points for rounding / kerning)
                if shift > 2.5:
                    significant_shifts += 1

        if significant_shifts > 0:
            alignment_drifts.append({
                "page": page_num,
                "issue": f"{significant_shifts} text elements shifted",
                "max_drift_pt": round(max_shift, 2),
            })

    base_doc.close()
    final_doc.close()

    # Calculate overall integrity score
    penalties = 0.0
    if not page_count_match:
        penalties += 30.0
    penalties += min(len(text_discrepancies) * 3.0, 30.0)
    penalties += min(len(font_discrepancies) * 1.5, 20.0)
    penalties += min(len(alignment_drifts) * 1.5, 20.0)

    integrity_score = max(0.0, round(100.0 - penalties, 1))

    if integrity_score >= 98.0 and page_count_match:
        status = "passed"
    elif integrity_score >= 80.0:
        status = "warnings"
    else:
        status = "failed"

    return {
        "success": True,
        "integrity_score": integrity_score,
        "status": status,
        "page_count_match": page_count_match,
        "base_page_count": base_page_count,
        "final_page_count": final_page_count,
        "total_pages_analyzed": total_pages_to_check,
        "text_discrepancies_count": len(text_discrepancies),
        "font_discrepancies_count": len(font_discrepancies),
        "alignment_drifts_count": len(alignment_drifts),
        "text_discrepancies": text_discrepancies,
        "font_discrepancies": font_discrepancies,
        "alignment_drifts": alignment_drifts,
    }
