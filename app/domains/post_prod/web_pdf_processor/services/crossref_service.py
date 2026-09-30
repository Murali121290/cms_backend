"""
Cross-Reference Hyperlinking Service for PDF Post-Production.

Detects and links cross-references for Figures, Tables, Chapters, Pages, etc.
Examples: "Figure 3.2", "Table 5.1", "Chapter 4", "page 42", "pp. 100-105"
"""
import re
import os
import fitz  # PyMuPDF
import logging

logger = logging.getLogger(__name__)


def find_crossrefs_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scan PDF for cross-reference text and create links to targets.
    Detects: Figures, Tables, Chapters, Pages (only in main body text, not in bibliography/notes)
    """
    doc = fitz.open(pdf_path)
    ref_entries = []

    # Step 0: Identify which pages are part of bibliography/notes/references sections
    bibliography_pages = _identify_bibliography_sections(doc)

    # Step 1: Extract all potential reference targets (figures, tables, chapters, pages)
    targets = _find_targets(doc)

    # Step 2: Find cross-reference text that mentions these targets (excluding bibliography pages)
    references = _find_references(doc, targets, bibliography_pages)

    # Step 3: Match references to targets and create links
    matched_count = 0
    for ref in references:
        target = ref.get("target_info")
        if target:
            # Check if link already exists
            linked = _check_link_exists(doc, ref["page_idx"], ref["rect"])

            # Create link if needed
            if not analyze_only and not linked:
                _create_crossref_link(
                    doc,
                    ref["page_idx"],
                    ref["rect"],
                    target["page_idx"],
                    ref.get("text", "")
                )
                linked = True

            if linked:
                matched_count += 1

            ref_entries.append({
                "type": ref.get("type", "unknown"),  # figure, table, chapter, page
                "reference_text": ref.get("text", ""),
                "reference_page": ref.get("page"),
                "target_type": target.get("type", ""),
                "target_identifier": target.get("identifier", ""),
                "target_page": target.get("page"),
                "is_linked": linked,
            })

    # Save if applying changes
    if not analyze_only and matched_count > 0:
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=3, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
        logger.debug(f"Cross-reference links created and PDF saved")
    else:
        doc.close()

    linked_count = sum(1 for n in ref_entries if n.get("is_linked", False))
    not_linked_count = len(ref_entries) - linked_count

    return {
        "total_references": len(ref_entries),
        "linked": linked_count,
        "not_linked": not_linked_count,
        "details": ref_entries,
    }


def _identify_bibliography_sections(doc) -> set:
    """
    Identify pages that are part of bibliography/notes/references sections.
    Returns set of page indices that should be excluded from page reference linking.
    """
    bibliography_pages = set()
    in_bibliography = False

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text()

        # Detect start of bibliography/notes/references section
        if re.search(
            r'(Bibliography|Notes\s+and\s+References|References|Works\s+Cited|'
            r'Further\s+Reading|Endnotes|Notes|Appendix)',
            text,
            re.IGNORECASE
        ):
            in_bibliography = True

        if in_bibliography:
            bibliography_pages.add(page_idx)
            logger.debug(f"Page {page_idx + 1} identified as bibliography/references section")

    return bibliography_pages


def _find_targets(doc) -> dict:
    """
    Find link targets: figure captions, table titles, chapters.
    Matches captions at line start (avoids mid-sentence mentions).
    Returns: {identifier -> {"page_idx": idx, "page": physical_page, "type": type}}
    """
    targets = {}

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block["type"] != 0:
                continue

            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()

                # Match figure captions at line start: "Figure 3.2" or "Figure 3.2:"
                # This avoids matching "See Figure 3.2" in the middle of text
                fig_match = re.match(r'(?:Figure|Fig\.?)\s+(\d+(?:\.\d+)?)', line_text, re.IGNORECASE)
                if fig_match:
                    fig_id = f"figure_{fig_match.group(1)}"
                    if fig_id not in targets:
                        targets[fig_id] = {
                            "page_idx": page_idx,
                            "page": physical_page,
                            "type": "figure",
                            "identifier": fig_match.group(1),
                        }
                        logger.debug(f"Found figure target {fig_id} on page {physical_page}")

                # Match table titles at line start: "Table 5.1" or "Table 5.1:"
                table_match = re.match(r'(?:Table|Tab\.?)\s+(\d+(?:\.\d+)?)', line_text, re.IGNORECASE)
                if table_match:
                    table_id = f"table_{table_match.group(1)}"
                    if table_id not in targets:
                        targets[table_id] = {
                            "page_idx": page_idx,
                            "page": physical_page,
                            "type": "table",
                            "identifier": table_match.group(1),
                        }
                        logger.debug(f"Found table target {table_id} on page {physical_page}")

                # Detect chapter headers: "Chapter 4", "CHAPTER 4", "Ch. 4"
                chapter_match = re.search(r'(?:Chapter|Ch\.?|CHAPTER|CH\.?)\s+(\d+)', line_text, re.IGNORECASE)
                if chapter_match:
                    ch_id = f"chapter_{chapter_match.group(1)}"
                    if ch_id not in targets:
                        targets[ch_id] = {
                            "page_idx": page_idx,
                            "page": physical_page,
                            "type": "chapter",
                            "identifier": chapter_match.group(1),
                        }
                        logger.debug(f"Found chapter target {ch_id} on page {physical_page}")

    return targets


def _find_references(doc, targets: dict, bibliography_pages: set) -> list:
    """
    Find cross-reference text that mentions the targets.
    Excludes references found in bibliography/notes/references sections.
    Returns list of {page_idx, page, rect, type, text, target_info}
    """
    references = []

    for page_idx in range(len(doc)):
        # Skip bibliography/notes/references pages (external references)
        skip_external_refs = page_idx in bibliography_pages

        page = doc[page_idx]
        physical_page = page_idx + 1
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block["type"] != 0:
                continue

            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()

                # Find figure references in text (skip in bibliography/notes sections)
                if not skip_external_refs:
                    for fig_match in re.finditer(r'\b(?:see|See|refer\s+to|Refer\s+to|look\s+at|Look\s+at)?\s*(?:Figure|Fig\.?|FIGURE|FIG\.?)\s+(\d+(?:\.\d+)?)', line_text, re.IGNORECASE):
                        fig_id = f"figure_{fig_match.group(1)}"
                        if fig_id in targets:
                            if line.get("spans"):
                                rect = fitz.Rect(line["spans"][0]["bbox"])
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": rect,
                                    "type": "figure",
                                    "text": fig_match.group(0),
                                    "target_info": targets[fig_id],
                                })

                # Find table references in text (skip in bibliography/notes sections)
                if not skip_external_refs:
                    for table_match in re.finditer(r'\b(?:see|See|refer\s+to|Refer\s+to|look\s+at|Look\s+at)?\s*(?:Table|Tab\.?|TABLE|TAB\.?)\s+(\d+(?:\.\d+)?)', line_text, re.IGNORECASE):
                        table_id = f"table_{table_match.group(1)}"
                        if table_id in targets:
                            if line.get("spans"):
                                rect = fitz.Rect(line["spans"][0]["bbox"])
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": rect,
                                    "type": "table",
                                    "text": table_match.group(0),
                                    "target_info": targets[table_id],
                                })

                # Find chapter references in text
                for ch_match in re.finditer(r'\b(?:see|See|refer\s+to|Refer\s+to|read|Read)?\s*(?:Chapter|Ch\.?|CHAPTER|CH\.?)\s+(\d+)', line_text, re.IGNORECASE):
                    ch_id = f"chapter_{ch_match.group(1)}"
                    if ch_id in targets:
                        if line.get("spans"):
                            rect = fitz.Rect(line["spans"][0]["bbox"])
                            references.append({
                                "page_idx": page_idx,
                                "page": physical_page,
                                "rect": rect,
                                "type": "chapter",
                                "text": ch_match.group(0),
                                "target_info": targets[ch_id],
                            })

                # Find page references: "page 42", "p. 42", "pp. 100-105"
                # Skip page references in bibliography/notes/references sections (external references)
                if not skip_external_refs:
                    for page_match in re.finditer(r'\b(?:page|p\.?|pages|pp\.?)\s+(\d+(?:\s*[-–]\s*\d+)?)', line_text, re.IGNORECASE):
                        page_ref = page_match.group(1).split()[0]  # Get first page number
                        try:
                            target_page = int(page_ref) - 1  # Convert to 0-indexed
                            if 0 <= target_page < len(doc):
                                if line.get("spans"):
                                    rect = fitz.Rect(line["spans"][0]["bbox"])
                                    references.append({
                                        "page_idx": page_idx,
                                        "page": physical_page,
                                        "rect": rect,
                                        "type": "page",
                                        "text": page_match.group(0),
                                        "target_info": {
                                            "page_idx": target_page,
                                            "page": int(page_ref),
                                            "type": "page",
                                            "identifier": page_ref,
                                        },
                                    })
                        except (ValueError, IndexError):
                            pass

    return references


def _check_link_exists(doc, page_idx: int, rect) -> bool:
    """Check if a link already exists in the given area."""
    try:
        page = doc[page_idx]
        rect = fitz.Rect(rect)
        for link in page.get_links():
            is_link = link.get('kind') in (fitz.LINK_URI, fitz.LINK_GOTO)
            if is_link:
                link_rect = link.get('from')
                if link_rect and fitz.Rect(link_rect).intersects(rect):
                    return True
    except Exception:
        pass
    return False


def _create_crossref_link(doc, ref_page_idx: int, ref_rect, target_page_idx: int, ref_text: str):
    """Create a link from a cross-reference to its target."""
    try:
        page = doc[ref_page_idx]
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": fitz.Rect(ref_rect),
            "page": target_page_idx,
        })
        logger.debug(f"Created cross-reference link for '{ref_text}' to page {target_page_idx + 1}")
    except Exception as e:
        logger.error(f"Failed to create cross-reference link: {e}")
