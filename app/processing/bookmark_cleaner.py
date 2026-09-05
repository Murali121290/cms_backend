"""
Bookmark Cleaner Utility
------------------------
Strips synthetic tracking bookmarks (p_bm_*, r_bm_*, tbl_bm_*, cell_bm_*, fnpara_bm_*, enpara_bm_*)
from Word DOCX files while preserving authentic user & reference bookmarks (bib_*, ref_*, etc.).
"""

import logging
import os
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn

logger = logging.getLogger("app.processing.bookmark_cleaner")


def strip_synthetic_bookmarks(doc: Document) -> int:
    """Remove synthetic tracking bookmarks (r_bm_*, p_bm_*, tbl_bm_*, etc.) from a Document object.

    Args:
        doc: The python-docx Document object to clean in-place.

    Returns:
        The total number of bookmarkStart XML nodes removed.
    """
    count = 0
    synthetic_ids = set()
    prefixes = ("p_bm_", "r_bm_", "tbl_bm_", "cell_bm_", "fnpara_bm_", "enpara_bm_")

    # Pass 1: Remove bookmarkStart/bookmarkEnd elements inside paragraphs
    for p_elem in doc.element.body.iter(qn("w:p")):
        for child in list(p_elem):
            if child.tag == qn("w:bookmarkStart"):
                name = child.get(qn("w:name"), "")
                bm_id = child.get(qn("w:id"))
                if any(name.startswith(pfx) for pfx in prefixes):
                    synthetic_ids.add(bm_id)
                    p_elem.remove(child)
                    count += 1
            elif child.tag == qn("w:bookmarkEnd"):
                bm_id = child.get(qn("w:id"))
                if bm_id in synthetic_ids:
                    p_elem.remove(child)
                    count += 1

    # Pass 2: Remove direct body container bookmark elements (e.g. tbl_bm_)
    for elem in list(doc.element.body):
        if elem.tag == qn("w:bookmarkStart"):
            name = elem.get(qn("w:name"), "")
            bm_id = elem.get(qn("w:id"))
            if any(name.startswith(pfx) for pfx in prefixes):
                synthetic_ids.add(bm_id)
                doc.element.body.remove(elem)
                count += 1
        elif elem.tag == qn("w:bookmarkEnd"):
            bm_id = elem.get(qn("w:id"))
            if bm_id in synthetic_ids:
                doc.element.body.remove(elem)
                count += 1

    # Pass 3: Remove bookmarks in related parts (footnotes, endnotes, headers, footers)
    for rel_id, part in doc.part.related_parts.items():
        if hasattr(part, "_element") and part._element is not None:
            for p_elem in part._element.findall(f".//{qn('w:p')}"):
                for child in list(p_elem):
                    if child.tag == qn("w:bookmarkStart"):
                        name = child.get(qn("w:name"), "")
                        bm_id = child.get(qn("w:id"))
                        if any(name.startswith(pfx) for pfx in prefixes):
                            synthetic_ids.add(bm_id)
                            p_elem.remove(child)
                            count += 1
                    elif child.tag == qn("w:bookmarkEnd"):
                        bm_id = child.get(qn("w:id"))
                        if bm_id in synthetic_ids:
                            p_elem.remove(child)
                            count += 1

    return count


def clean_docx_bookmarks(input_path: str, output_path: str = None) -> str:
    """Clean synthetic bookmarks from a DOCX file on disk.

    Args:
        input_path: Absolute path to input DOCX file.
        output_path: Optional path for output file. Overwrites input if None.

    Returns:
        Path to the cleaned DOCX file.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"DOCX file not found: {input_path}")

    if output_path is None:
        output_path = input_path

    doc = Document(input_path)
    removed_count = strip_synthetic_bookmarks(doc)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    doc.save(output_path)

    logger.info(f"Cleaned {removed_count} synthetic bookmark XML tags from {input_path} -> {output_path}")
    return output_path
