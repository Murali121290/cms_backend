"""
Endnote Hyperlinking Service for PDF Post-Production.

Detects superscript note references in text and endnotes, creating bidirectional
links between them (reference -> endnote and endnote -> reference).
Handles chapter-based endnote organization by intelligently matching references
to the correct chapter's endnote section.
"""
import re
import os
import fitz  # PyMuPDF
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


def find_endnotes_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scan PDF for superscript note references and chapter-based endnotes.
    Intelligently matches references to definitions, handling PDFs where each
    chapter has its own numbered endnote section.
    """
    doc = fitz.open(pdf_path)
    note_entries = []

    # Step 1: Analyze PDF structure to identify chapter sections
    chapter_ranges = _identify_chapter_ranges(doc)

    # Step 2: Find superscript references in main text
    note_references = {}  # note_number -> [(page_idx, rect, chapter_id), ...]
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1
        chapter_id = _get_chapter_id(page_idx, chapter_ranges)

        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            if block["type"] != 0:
                continue

            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    flags = span.get("flags", 0)
                    rect = fitz.Rect(span["bbox"])

                    is_superscript = bool(flags & 1)
                    note_match = re.match(r'^(\d{1,3})$', text.strip())

                    if note_match and is_superscript:
                        note_num = int(note_match.group(1))
                        if note_num not in note_references:
                            note_references[note_num] = []
                        note_references[note_num].append({
                            "page_idx": page_idx,
                            "page": physical_page,
                            "rect": rect,
                            "chapter_id": chapter_id
                        })
                        logger.debug(f"Found superscript note {note_num} on page {physical_page}, chapter {chapter_id}")

    # Step 3: Find endnote definitions (ALL occurrences for multi-definition notes)
    note_definitions_all = defaultdict(list)  # note_number -> list of definitions

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block["type"] != 0:
                continue

            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                # Match endnotes like "1.", "2)", "3:" but avoid page headers
                # Reject if number followed by 2+ spaces (page header format like "220    Wolf Land")
                if re.match(r'^(\d{1,3})\s{2,}', line_text):
                    endnote_match = None
                else:
                    endnote_match = re.match(r'^(\d{1,3})[\.\):\-]', line_text)

                if endnote_match and line.get("spans"):
                    note_num = int(endnote_match.group(1))
                    span = line["spans"][0]
                    rect = fitz.Rect(span["bbox"])
                    note_definitions_all[note_num].append({
                        "page_idx": page_idx,
                        "page": physical_page,
                        "rect": rect,
                    })
                    logger.debug(f"Found endnote {note_num} on page {physical_page}")

    # Step 4: Build best-match for each reference to each definition
    # Handle chapter-based endnotes by matching references to definitions by position
    reference_to_definition = {}  # (note_num, ref_index) -> def_info

    for note_num, refs in note_references.items():
        if note_num in note_definitions_all:
            defs = sorted(note_definitions_all[note_num], key=lambda x: x["page_idx"])
            refs_sorted = sorted(enumerate(refs), key=lambda x: x[1]["page_idx"])

            # If counts match, match by position (1st ref to 1st def, etc.)
            if len(refs_sorted) == len(defs):
                for orig_idx, (sorted_idx, ref) in enumerate(refs_sorted):
                    reference_to_definition[(note_num, sorted_idx)] = defs[orig_idx]
            else:
                # Fallback: match each reference to closest definition after it
                for ref_idx, ref in enumerate(refs):
                    best_def = None
                    best_distance = float('inf')
                    ref_page = ref["page_idx"]

                    # Find closest definition after reference
                    for d in defs:
                        if d["page_idx"] >= ref_page:
                            distance = d["page_idx"] - ref_page
                            if distance < best_distance:
                                best_distance = distance
                                best_def = d

                    # Fallback: closest definition before
                    if not best_def:
                        for d in defs:
                            distance = ref_page - d["page_idx"]
                            if distance < best_distance:
                                best_distance = distance
                                best_def = d

                    if best_def:
                        reference_to_definition[(note_num, ref_idx)] = best_def

    # Step 5: Create report of matched notes
    all_note_nums = set(note_references.keys()) | set(note_definitions_all.keys())

    for note_num in sorted(all_note_nums):
        has_reference = note_num in note_references
        has_definitions = note_num in note_definitions_all

        if has_reference and has_definitions:
            refs = note_references[note_num]

            # For each reference, check if it has a matched definition
            for ref_idx, ref in enumerate(refs):
                if (note_num, ref_idx) in reference_to_definition:
                    def_info = reference_to_definition[(note_num, ref_idx)]

                    # Check for existing links
                    ref_linked = _check_link_exists(doc, ref["page_idx"], ref["rect"])
                    def_linked = _check_link_exists(doc, def_info["page_idx"], def_info["rect"])
                    both_linked = ref_linked and def_linked

                    # Create links if needed
                    if not analyze_only and not both_linked:
                        _create_endnote_link(
                            doc,
                            ref["page_idx"],
                            ref["rect"],
                            def_info["page_idx"],
                            note_num
                        )
                        _create_reference_link(
                            doc,
                            def_info["page_idx"],
                            def_info["rect"],
                            ref["page_idx"],
                            note_num
                        )
                        both_linked = True

                    note_entries.append({
                        "note_number": note_num,
                        "reference_page": ref["page"],
                        "definition_page": def_info["page"],
                        "is_linked": both_linked,
                        "reference_count": len(refs),
                    })
                else:
                    # Reference has no matched definition
                    note_entries.append({
                        "note_number": note_num,
                        "reference_page": ref["page"],
                        "definition_page": None,
                        "is_linked": False,
                        "status": "missing_definition",
                        "reference_count": len(refs),
                    })
        elif has_reference:
            refs = note_references[note_num]
            for ref in refs:
                note_entries.append({
                    "note_number": note_num,
                    "reference_page": ref["page"],
                    "definition_page": None,
                    "is_linked": False,
                    "status": "missing_definition",
                    "reference_count": len(refs),
                })
        elif has_definitions:
            defs = note_definitions_all[note_num]
            for def_info in defs:
                note_entries.append({
                    "note_number": note_num,
                    "reference_page": None,
                    "definition_page": def_info["page"],
                    "is_linked": False,
                    "status": "missing_reference",
                    "reference_count": 0,
                })

    # Save if applying changes
    if not analyze_only and note_entries:
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=3, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
        logger.debug("Endnote links created and PDF saved")
    else:
        doc.close()

    linked_count = sum(1 for n in note_entries if n.get("is_linked", False))
    not_linked_count = len(note_entries) - linked_count

    return {
        "total_notes": len(note_entries),
        "linked": linked_count,
        "not_linked": not_linked_count,
        "details": note_entries,
    }


def _identify_chapter_ranges(doc) -> list:
    """Identify main text vs endnote sections. Returns list of (start_page, end_page, type)."""
    ranges = []
    current_start = 0
    in_endnotes = False

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text()

        # Detect transition to endnotes section
        is_endnotes = bool(re.search(r'(Notes|Endnotes|References)\s*(to|Chapter|$)', text, re.IGNORECASE))

        if is_endnotes and not in_endnotes:
            if current_start < page_idx:
                ranges.append((current_start, page_idx - 1, "main"))
            current_start = page_idx
            in_endnotes = True
        elif not is_endnotes and in_endnotes:
            ranges.append((current_start, page_idx - 1, "endnotes"))
            current_start = page_idx
            in_endnotes = False

    # Add final range
    if current_start < len(doc):
        ranges.append((current_start, len(doc) - 1, "endnotes" if in_endnotes else "main"))

    return ranges


def _get_chapter_id(page_idx: int, chapter_ranges: list) -> int:
    """Get chapter/section ID for a page."""
    for i, (start, end, sect_type) in enumerate(chapter_ranges):
        if start <= page_idx <= end:
            return i
    return 0


def _check_link_exists(doc, page_idx: int, rect) -> bool:
    """Check if a link already exists in the given area."""
    try:
        page = doc[page_idx]
        rect = fitz.Rect(rect)
        for link in page.get_links():
            # Check for both URI links and internal GOTO links
            is_link = link.get('kind') in (fitz.LINK_URI, fitz.LINK_GOTO)
            if is_link:
                link_rect = link.get('from')
                if link_rect and fitz.Rect(link_rect).intersects(rect):
                    return True
    except Exception:
        pass
    return False


def _create_endnote_link(doc, ref_page_idx: int, ref_rect, def_page_idx: int, note_num: int):
    """Create a link from a note reference to its definition."""
    try:
        page = doc[ref_page_idx]
        # Create internal link to the endnote page (destination page)
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": fitz.Rect(ref_rect),
            "page": def_page_idx,
        })
        logger.debug(f"Created reference link for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create reference link: {e}")


def _create_reference_link(doc, def_page_idx: int, def_rect, ref_page_idx: int, note_num: int):
    """Create a link from a note definition back to its reference."""
    try:
        page = doc[def_page_idx]
        # Create internal link back to the reference
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": fitz.Rect(def_rect),
            "page": ref_page_idx,
        })
        logger.debug(f"Created backlink for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create backlink: {e}")
