"""
Post-process PPH-generated DOCX files to ensure bib_* and cite_* character styles exist.

PPH applies paragraph-level structure but does not apply individual character styles to runs.
This module ensures all expected character styles are defined in the DOCX template so they're
available in Word's Style picker and can be manually applied or configured in future PPH versions.
"""

import logging
from pathlib import Path
from docx import Document
from docx.enum.style import WD_STYLE_TYPE

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

# Reference paragraph styles that contain bibliography content
REFERENCE_PARAGRAPH_STYLES = {
    "BIB", "BIBH1", "BIBH2", "REF-N", "REF-OPEN", "Reference",
    "Bib", "Bibliography", "REFERENCE"
}


def _ensure_char_style(doc: Document, style_name: str) -> None:
    """Ensure a character style exists in the document, creating it if necessary."""
    if style_name not in doc.styles:
        try:
            doc.styles.add_style(style_name, WD_STYLE_TYPE.CHARACTER)
            logger.debug(f"Created character style: {style_name}")
        except Exception as e:
            logger.warning(f"Failed to create character style '{style_name}': {e}")


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

        # Ensure all character styles exist
        for style_name in REFERENCE_CHAR_STYLES:
            _ensure_char_style(doc, style_name)

        # Save the document
        doc.save(docx_path)
        logger.info(f"Applied reference character styles to: {docx_path}")
    except Exception as e:
        logger.error(f"Failed to apply reference character styles to '{docx_path}': {e}", exc_info=True)
