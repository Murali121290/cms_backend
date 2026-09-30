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

    # Step 0: Identify which pages to skip (TOC, bibliography, notes)
    toc_pages = _identify_toc_section(doc)
    bibliography_pages = _identify_bibliography_sections(doc)
    skip_pages = toc_pages | bibliography_pages  # Combine both sets

    # Step 1: Extract all potential reference targets (figures, tables, chapters, pages)
    targets = _find_targets(doc)

    # Step 2: Find cross-reference text that mentions these targets (excluding TOC/bibliography pages)
    references = _find_references(doc, targets, skip_pages)

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


def _identify_toc_section(doc) -> set:
    """
    Identify pages that are part of the Table of Contents.
    TOC pages list chapters/figures/tables but aren't actual content.
    Returns set of page indices to exclude from cross-reference detection.
    """
    toc_pages = set()
    toc_start = None

    # Find TOC start page
    for page_idx in range(min(20, len(doc))):  # TOC is usually in first 20 pages
        page = doc[page_idx]
        text = page.get_text()

        # Look for Table of Contents header
        if re.search(r'\b(Table\s+of\s+Contents|Contents|TOC)\b', text, re.IGNORECASE):
            toc_start = page_idx
            logger.debug(f"Table of Contents found at page {page_idx + 1}")
            break

    # If TOC found, mark pages until main content starts (usually first chapter)
    if toc_start is not None:
        for page_idx in range(toc_start, min(toc_start + 15, len(doc))):  # TOC typically 1-15 pages
            page = doc[page_idx]
            text = page.get_text()

            # Stop when we hit actual chapter content (Chapter 1, Chapter 2, etc. as main header)
            if re.match(r'^\s*(?:CHAPTER|Chapter)\s+1\b', text, re.IGNORECASE):
                break

            toc_pages.add(page_idx)

    return toc_pages


def _identify_bibliography_sections(doc) -> set:
    """
    Identify pages that are part of bibliography/notes/references sections.
    Only marks pages that are clearly after a Bibliography/References/Notes header.
    Returns set of page indices that should be excluded from cross-references.
    """
    bibliography_pages = set()

    # Find the page where bibliography section clearly starts (header at top of page)
    bibliography_start = None

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text()

        # Look for Bibliography/References/Notes header at START of page
        # Must be on the first line/header, not just anywhere in the text
        lines = text.split('\n')
        first_content = '\n'.join(lines[:3]).strip()  # First 3 lines

        if re.match(
            r'^.*\b(Bibliography|References|Works\s+Cited|Endnotes|Notes\s+and\s+References)\b',
            first_content,
            re.IGNORECASE | re.MULTILINE
        ):
            bibliography_start = page_idx
            logger.debug(f"Bibliography section header found at page {page_idx + 1}")
            break

    # Mark all pages from bibliography start onward
    if bibliography_start is not None:
        for page_idx in range(bibliography_start, len(doc)):
            bibliography_pages.add(page_idx)
            logger.debug(f"Page {page_idx + 1} marked as bibliography/references section")

    return bibliography_pages


def _find_targets(doc) -> dict:
    """
    Find link targets: figure captions, table titles, chapters.
    Matches captions at line start (avoids mid-sentence mentions).
    Excludes TOC and bibliography pages (only use actual chapter headers in body content).
    Returns: {identifier -> {"page_idx": idx, "page": physical_page, "type": type}}
    """
    targets = {}

    # Identify pages to skip (TOC, bibliography) so we don't match headers there
    toc_pages = _identify_toc_section(doc)
    bibliography_pages = _identify_bibliography_sections(doc)
    skip_pages = toc_pages | bibliography_pages

    for page_idx in range(len(doc)):
        # Skip TOC and bibliography pages when finding targets
        if page_idx in skip_pages:
            continue

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
                # Only match in body content, not in TOC/bibliography
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


def _find_references(doc, targets: dict, skip_pages: set) -> list:
    """
    Find cross-reference text that mentions the targets.
    Excludes references found in TOC, bibliography, or notes sections.
    Returns list of {page_idx, page, rect, type, text, target_info}
    """
    references = []

    for page_idx in range(len(doc)):
        # Skip TOC, bibliography, notes/references pages (not actual content)
        skip_external_refs = page_idx in skip_pages

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

                # Find chapter references in text (skip in bibliography/notes sections, section headers, only match body text)
                if not skip_external_refs:
                    for ch_match in re.finditer(r'\b(?:see|See|refer\s+to|Refer\s+to|read|Read)?\s*(?:Chapter|Ch\.?|CHAPTER|CH\.?)\s+(\d+)', line_text, re.IGNORECASE):
                        ch_id = f"chapter_{ch_match.group(1)}"
                        if ch_id in targets:
                            target_chapter = targets[ch_id]

                            # Skip if this looks like a chapter header or section header
                            # - Chapter header: on same page as target, starts the line
                            # - Section header: short line (< 50 chars), typically standalone
                            is_chapter_header = (page_idx == target_chapter["page_idx"] and
                                               line_text.startswith(ch_match.group(0).lstrip()))
                            is_section_header = len(line_text) < 50  # Section headers are short

                            if not is_chapter_header and not is_section_header and line.get("spans"):
                                rect = fitz.Rect(line["spans"][0]["bbox"])
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": rect,
                                    "type": "chapter",
                                    "text": ch_match.group(0),
                                    "target_info": target_chapter,
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
