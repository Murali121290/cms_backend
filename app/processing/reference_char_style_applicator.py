"""
Post-process PPH-generated DOCX files to ensure bib_* and cite_* character styles exist.

PPH applies paragraph-level structure but does not apply individual character styles to runs.
This module ensures all expected character styles are defined in the DOCX template so they're
available in Word's Style picker and can be manually applied or configured in future PPH versions.
"""

import logging
from pathlib import Path
from typing import Optional

from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

logger = logging.getLogger(__name__)

# All bibliography and citation character styles that should exist in reference documents
REFERENCE_CHAR_STYLES = [
    # Bibliography styles
    "bib_alt-year", "bib_article", "bib_base", "bib_book", "bib_chapterno",
    "bib_chaptertitle", "bib_comment", "bib_confacronym", "bib_confdate",
    "bib_conference", "bib_conflocation", "bib_confpaper", "bib_confproceedings",
    "bib_day", "bib_deg", "bib_doi", "bib_ed-etal", "bib_ed-fname",
    "bib_editionno", "bib_ed-organization", "bib_ed-suffix", "bib_ed-surname",
    "bib_etal", "bib_extlink", "bib_fname", "bib_fpage", "bib_institution",
    "bib_isbn", "bib_issue", "bib_journal", "bib_location", "bib_lpage",
    "bib_medline", "bib_month", "bib_number", "bib_organization", "bib_pagecount",
    "bib_papernumber", "bib_patent", "bib_publisher", "bib_reportnum", "bib_school",
    "bib_season", "bib_series", "bib_seriesno", "bib_suffix", "bib_suppl",
    "bib_surname", "bib_title", "bib_trans", "bib_unpubl", "bib_url",
    "bib_volcount", "bib_volume", "bib_year",
    # Citation styles
    "cite_app", "cite_base", "cite_bib", "cite_box", "cite_eq", "cite_fig",
    "cite_fn", "cite_sec", "cite_tbl", "cite_tfn"
]

# Highlight colors for reference character styles, mirroring the WYSIWYG editor's
# CSS palette (frontend/src/features/editor/WysiwygEditor.tsx). Hex values are
# uppercase and stripped of the leading '#' so they can be written straight into
# a <w:shd w:fill="..."> attribute. If a style is registered in the DOCX styles
# table without a shd fill (either because python-docx created it empty, or the
# PPH template shipped it bare), the exporter injects the color below so the
# downloaded Word file matches what the editor showed on screen.
REFERENCE_CHAR_STYLE_COLORS = {
    "bib_alt-year": "D8B4FE",
    "bib_article": "BAE6FD",
    "bib_book": "93C5FD",
    "bib_chapterno": "E5E7EB",
    "bib_chaptertitle": "FDBA74",
    "bib_comment": "C7D2FE",
    "bib_confacronym": "F472B6",
    "bib_confdate": "2DD4BF",
    "bib_conference": "60A5FA",
    "bib_conflocation": "F87171",
    "bib_confpaper": "86EFAC",
    "bib_confproceedings": "FBBF24",
    "bib_day": "FEF08A",
    "bib_doi": "FEF08A",
    "bib_ed-etal": "22D3EE",
    "bib_ed-fname": "FEF08A",
    "bib_editionno": "FACC15",
    "bib_ed-organization": "FBCFE8",
    "bib_ed-suffix": "A7F3D0",
    "bib_ed-surname": "FACC15",
    "bib_etal": "BEF264",
    "bib_extlink": "5EEAD4",
    "bib_fname": "FEF9C3",
    "bib_fpage": "FEF9C3",
    "bib_institution": "D1FAE5",
    "bib_isbn": "F3F4F6",
    "bib_issue": "BFDBFE",
    "bib_journal": "FFEDD5",
    "bib_location": "FECDD3",
    "bib_lpage": "E5E7EB",
    "bib_medline": "BAE6FD",
    "bib_month": "BEF264",
    "bib_number": "C084FC",
    "bib_organization": "D1FAE5",
    "bib_pagecount": "22C55E",
    "bib_papernumber": "FEF08A",
    "bib_patent": "38BDF8",
    "bib_publisher": "F472B6",
    "bib_reportnum": "818CF8",
    "bib_school": "FB923C",
    "bib_season": "EA580C",
    "bib_series": "FFEDD5",
    "bib_seriesno": "FEF08A",
    "bib_suffix": "FEF9C3",
    "bib_suppl": "FEF9C3",
    "bib_surname": "BEF264",
    "bib_title": "FBCFE8",
    "bib_trans": "BEF264",
    "bib_unpubl": "F3F4F6",
    "bib_url": "D9F99D",
    "bib_volcount": "22C55E",
    "bib_volume": "BAE6FD",
    "bib_year": "E9D5FF",
    "bib_base": "F3F4F6",
    # Citation styles
    "cite_app": "BEF264",
    "cite_base": "F3F4F6",
    "cite_bib": "CFFAFE",
    "cite_box": "E5E7EB",
    "cite_eq": "FDBA74",
    "cite_fig": "BBF7D0",
    "cite_fn": "FBCFE8",
    "cite_sec": "FECDD3",
    "cite_tbl": "FCA5A5",
    "cite_tfn": "FED7AA",
}

# Reference paragraph styles that contain bibliography content
REFERENCE_PARAGRAPH_STYLES = {
    "BIB", "BIBH1", "BIBH2", "REF-N", "REF-OPEN", "Reference",
    "Bib", "Bibliography", "REFERENCE"
}


def _get_or_create_rPr(style_element):
    """Return the <w:rPr> child of a <w:style>, creating and inserting it if absent."""
    rPr = style_element.find(qn("w:rPr"))
    if rPr is None:
        rPr = OxmlElement("w:rPr")
        # <w:rPr> must come after <w:name>/<w:basedOn>/<w:next>/... — appending is safe.
        style_element.append(rPr)
    return rPr


def _ensure_shd_fill(style_element, fill_hex: str) -> bool:
    """Ensure the style's run-properties carry a <w:shd w:fill="fill_hex">.

    Word treats a character style's shading fill as the highlight color. If the
    style already declares a fill we leave it alone (respecting PPH template
    colors); if it declares w:shd with fill='auto'/missing we upgrade it; and if
    there is no w:shd at all we insert one. Returns True when the DOM was
    modified.
    """
    rPr = _get_or_create_rPr(style_element)
    shd = rPr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), fill_hex.upper())
        rPr.append(shd)
        return True

    existing_fill = (shd.get(qn("w:fill")) or "").strip().lower()
    if existing_fill and existing_fill != "auto":
        # Respect an explicit color from the PPH template / prior authoring.
        return False

    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex.upper())
    return True


def _ensure_char_style(doc: Document, style_name: str, fill_hex: Optional[str] = None) -> None:
    """Ensure a character style exists in the document, creating it if necessary.

    When ``fill_hex`` is provided the style's <w:shd> highlight is set to that
    color (only if the style has no explicit fill already), matching what the
    WYSIWYG editor renders in the browser.
    """
    style_obj = None
    if style_name not in doc.styles:
        try:
            style_obj = doc.styles.add_style(style_name, WD_STYLE_TYPE.CHARACTER)
            logger.debug(f"Created character style: {style_name}")
        except Exception as e:
            logger.warning(f"Failed to create character style '{style_name}': {e}")
            return
    else:
        try:
            style_obj = doc.styles[style_name]
        except Exception:
            style_obj = None

    if fill_hex and style_obj is not None:
        try:
            _ensure_shd_fill(style_obj.element, fill_hex)
        except Exception as e:
            logger.warning(f"Failed to apply highlight for style '{style_name}': {e}")


def ensure_reference_char_style_highlights(doc: Document) -> int:
    """Guarantee every reference character style is defined with a highlight fill.

    Operates on an already-open python-docx Document; the caller is responsible
    for saving. Returns the number of styles that were touched (created or had
    their highlight injected). Called at the end of every XHTML → DOCX export so
    citations authored in the editor render with the correct highlight color in
    the downloaded Word file even when the PPH template shipped an empty
    character style.
    """
    touched = 0
    for style_name in REFERENCE_CHAR_STYLES:
        fill_hex = REFERENCE_CHAR_STYLE_COLORS.get(style_name)
        before_exists = style_name in doc.styles
        _ensure_char_style(doc, style_name, fill_hex=fill_hex)
        if not before_exists or fill_hex:
            touched += 1
    return touched


def apply_reference_char_styles(docx_path: str) -> None:
    """
    Ensure all reference character styles exist in the DOCX document.

    This post-processes PPH-generated files to make the character styles available
    in Word's Style picker. PPH applies paragraph-level structure but does not apply
    individual run-level character styles; this ensures the styles are defined so they
    can be manually applied or will work once PPH is configured to apply them.

    Args:
        docx_path: Path to the DOCX file to process.
    """
    if not Path(docx_path).exists():
        logger.warning(f"DOCX file not found: {docx_path}")
        return

    try:
        doc = Document(docx_path)

        ensure_reference_char_style_highlights(doc)

        # Save the document
        doc.save(docx_path)
        logger.info(f"Applied reference character styles to: {docx_path}")
    except Exception as e:
        logger.error(f"Failed to apply reference character styles to '{docx_path}': {e}", exc_info=True)
