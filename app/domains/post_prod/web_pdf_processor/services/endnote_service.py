"""
Endnote Hyperlinking Service for PDF Post-Production.

Detects superscript note references in text and endnotes/references, creating
bidirectional links between them (reference -> endnote and endnote -> reference).
Handles chapter-based endnote organization: each chapter's superscript numbers
reset at 1, and the references section organises entries under "Chapter N" headings.
"""
import re
import os
import fitz  # PyMuPDF
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def find_endnotes_in_pdf(pdf_path: str, analyze_only: bool = True) -> dict:
    """
    Scan PDF for superscript note references and chapter-based endnotes/references.

    Strategy
    --------
    1. Use PDF bookmarks (TOC) to identify chapter page ranges and the
       references/notes section start page. Fall back to text scanning when
       no bookmarks exist.
    2. Collect all superscript digit spans in the body text, grouped by their
       owning chapter. Expand bounding boxes slightly so hover/click hits reliably.
    3. Parse the references section. Detect chapter / section subheadings that
       restart numbering, and assign each numbered entry to a (chapter, num) pair.
    4. Match each in-body reference to the correct definition by chapter.
    5. Optionally insert bidirectional LINK_GOTO annotations cleanly.
    """
    doc = fitz.open(pdf_path)

    # ------------------------------------------------------------------
    # Step 1 – Locate notes/references section and chapter boundaries
    # ------------------------------------------------------------------
    chapter_page_ranges = _get_chapter_ranges_from_toc(doc)
    notes_section_start = _find_notes_section_start(doc, chapter_page_ranges)

    if notes_section_start is None:
        logger.debug("No notes/references section found in PDF")
        doc.close()
        return {"total_notes": 0, "linked": 0, "not_linked": 0, "details": []}

    logger.debug(f"Notes/references section starts at page {notes_section_start + 1}")

    # Determine body-text page range (everything before the notes section)
    body_end_page = notes_section_start - 1

    # Detect end of notes section (e.g. where Index starts, if any)
    notes_section_end = len(doc)
    try:
        for _lvl, title, page_1based in doc.get_toc():
            if re.search(r'\bIndex\b', title, re.IGNORECASE):
                p_idx = page_1based - 1
                if p_idx > notes_section_start:
                    notes_section_end = p_idx
                    break
    except Exception:
        pass

    # ------------------------------------------------------------------
    # Step 2 – Collect note references in body text
    # Supports:
    #   (a) Superscript digit spans (e.g. ^1, ^2)
    #   (b) Bracketed/parenthesized citation callouts (e.g. (19), (12, 17), (1-3), [4])
    # ------------------------------------------------------------------
    note_references: dict[tuple, list] = defaultdict(list)

    for page_idx in range(body_end_page + 1):
        page = doc[page_idx]
        chapter_num = _page_to_chapter(page_idx, chapter_page_ranges)

        page_blocks = page.get_text("dict")["blocks"]
        for block in page_blocks:
            if block["type"] != 0:
                continue
            for line in block.get("lines", []):
                # (a) Check superscript spans
                for span in line.get("spans", []):
                    flags = span.get("flags", 0)
                    text = span.get("text", "").strip()
                    is_superscript = bool(flags & 1)

                    if is_superscript and re.match(r'^\d{1,4}$', text):
                        note_num = int(text)
                        key = (chapter_num, note_num)
                        r = fitz.Rect(span["bbox"])
                        # Expand bbox slightly (+1.5 pt all around) so it is easy to hover and click
                        r_click = fitz.Rect(r.x0 - 1.5, r.y0 - 1.5, r.x1 + 1.5, r.y1 + 1.5)
                        note_references[key].append({
                            "page_idx": page_idx,
                            "page": page_idx + 1,
                            "rect": r_click,
                            "chapter_num": chapter_num,
                        })

                # (b) Check bracketed/parenthesized citations: (19), (12, 17), (1-3), [19]
                line_text = "".join(s.get("text", "") for s in line.get("spans", []))
                for m in re.finditer(r'[\(\[]([0-9]+(?:[\s,\–\-]+[0-9]+)*)[\)\]]', line_text):
                    bracket_str = m.group(0) # e.g. "(12, 17)" or "(1-3)"
                    content = m.group(1).strip()
                    # Skip 4-digit years like (1998) or (2020)
                    if re.match(r'^(?:19|20)\d{2}$', content):
                        continue

                    # Search for the exact bracket string within this line's bounding box
                    line_rect = fitz.Rect(line["bbox"])
                    bracket_rects = page.search_for(bracket_str, clip=line_rect)
                    if not bracket_rects:
                        bracket_rects = page.search_for(bracket_str)
                    if not bracket_rects:
                        continue

                    target_bracket_rect = bracket_rects[0]

                    # Parse individual note numbers or ranges (e.g. "12, 17" or "1-3")
                    # Use rawdict within target_bracket_rect to locate exact character bboxes
                    raw_clip = page.get_text("rawdict", clip=target_bracket_rect)
                    clip_chars = []
                    for cb in raw_clip.get("blocks", []):
                        for cl in cb.get("lines", []):
                            for cs in cl.get("spans", []):
                                clip_chars.extend(cs.get("chars", []))

                    if not clip_chars:
                        continue

                    # Group contiguous digit characters
                    c_idx = 0
                    parsed_items = []  # list of (number_int, rect, separator_after)
                    while c_idx < len(clip_chars):
                        ch = clip_chars[c_idx]
                        if ch.get("c", "").isdigit():
                            digit_chars = [ch]
                            c_idx += 1
                            while c_idx < len(clip_chars) and clip_chars[c_idx].get("c", "").isdigit():
                                digit_chars.append(clip_chars[c_idx])
                                c_idx += 1
                            num_val = int("".join(dc["c"] for dc in digit_chars))
                            num_rect = fitz.Rect(digit_chars[0]["bbox"])
                            for dc in digit_chars[1:]:
                                num_rect |= fitz.Rect(dc["bbox"])

                            # Look ahead for hyphen/en-dash indicating a range
                            sep = ""
                            temp_idx = c_idx
                            while temp_idx < len(clip_chars) and clip_chars[temp_idx].get("c", " ") in " \t":
                                temp_idx += 1
                            if temp_idx < len(clip_chars) and clip_chars[temp_idx].get("c", "") in "-–—":
                                sep = "-"

                            parsed_items.append((num_val, num_rect, sep))
                        else:
                            c_idx += 1

                    # Handle range expansion: if item i has sep='-', range is [val_i .. val_i+1]
                    item_idx = 0
                    while item_idx < len(parsed_items):
                        val, r_box, sep = parsed_items[item_idx]
                        if val >= 1900:  # Skip 4-digit years
                            item_idx += 1
                            continue

                        r_click = fitz.Rect(r_box.x0 - 1.5, r_box.y0 - 1.5, r_box.x1 + 1.5, r_box.y1 + 1.5)

                        if sep == "-" and item_idx + 1 < len(parsed_items):
                            next_val, next_r_box, _ = parsed_items[item_idx + 1]
                            if 0 < next_val - val <= 10:
                                # First number in range links to val
                                key = (chapter_num, val)
                                note_references[key].append({
                                    "page_idx": page_idx,
                                    "page": page_idx + 1,
                                    "rect": r_click,
                                    "chapter_num": chapter_num,
                                })
                                # Last number in range links to next_val
                                next_r_click = fitz.Rect(next_r_box.x0 - 1.5, next_r_box.y0 - 1.5, next_r_box.x1 + 1.5, next_r_box.y1 + 1.5)
                                next_key = (chapter_num, next_val)
                                note_references[next_key].append({
                                    "page_idx": page_idx,
                                    "page": page_idx + 1,
                                    "rect": next_r_click,
                                    "chapter_num": chapter_num,
                                })
                                item_idx += 2
                                continue

                        key = (chapter_num, val)
                        note_references[key].append({
                            "page_idx": page_idx,
                            "page": page_idx + 1,
                            "rect": r_click,
                            "chapter_num": chapter_num,
                        })
                        item_idx += 1

    logger.debug(f"Found {sum(len(v) for v in note_references.values())} note refs "
                 f"across {len(note_references)} (chapter, num) keys")

    # ------------------------------------------------------------------
    # Step 3 – Parse note definitions from the references/notes section
    # ------------------------------------------------------------------
    note_definitions: dict[tuple, list] = defaultdict(list)
    curr_chapter_num = 0

    for page_idx in range(notes_section_start, notes_section_end):
        page = doc[page_idx]
        raw_blocks = [b for b in page.get_text("dict")["blocks"] if b["type"] == 0]
        # Skip header (<45 pt) and footer (>740 pt)
        content_blocks = [b for b in raw_blocks if not (b["bbox"][1] < 45 or b["bbox"][1] > 740)]
        # Sort blocks multi-column aware (x-column first, then y-coordinate)
        sorted_blocks = sorted(content_blocks, key=lambda b: (round(b["bbox"][0] / 200.0), b["bbox"][1]))

        for block in sorted_blocks:
            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                if not line_text:
                    continue

                # Detect headings that switch chapter context
                # Must be standalone headings, e.g. "^Introduction$" or "^Chapter \d+$"
                if re.match(r'^(?:Introduction(?::.*)?|The Wolf of Time and \(Hi\)story)$', line_text, re.IGNORECASE):
                    curr_chapter_num = 0
                    continue
                m_chap = re.match(r'^(?:Chapter|CHAPTER)\s+(\d{1,3})(?:\s*[:\-–].*)?$', line_text, re.IGNORECASE)
                if m_chap:
                    curr_chapter_num = int(m_chap.group(1))
                    continue
                if re.match(r'^(?:Postscript(?::.*)?)$', line_text, re.IGNORECASE):
                    curr_chapter_num = 99
                    continue

                # Match numbered note definitions: "1.", "1.\t", "1) ", "10.\t Marvin..."
                defn_match = re.match(r'^(\d{1,4})[\.\)\:\-](?:\t|\s+|$)', line_text)
                if defn_match and line.get("spans"):
                    span = line["spans"][0]
                    # Filter out hanging indent false positives (e.g. publication years like "1995." that wrap to line start)
                    # Numbered citations start on hanging indent margins: x0 < 85 (left column) or 250 < x0 < 336 (right column)
                    x0 = span["bbox"][0]
                    is_valid_margin = (x0 < 85) or (250 < x0 < 336)
                    if not is_valid_margin:
                        continue

                    note_num = int(defn_match.group(1))
                    r_span = fitz.Rect(span["bbox"])
                    r_line = fitz.Rect(line["bbox"])
                    # Make rect generous enough to hover and click (e.g. width at least 35pt)
                    r_click = fitz.Rect(r_span.x0 - 1.0, r_span.y0 - 1.0, max(r_span.x0 + 35.0, min(r_span.x1 + 10.0, r_line.x1)), r_span.y1 + 1.0)

                    key = (curr_chapter_num, note_num)
                    note_definitions[key].append({
                        "page_idx": page_idx,
                        "page": page_idx + 1,
                        "rect": r_click,
                    })

    logger.debug(f"Found definitions for {len(note_definitions)} (chapter, num) keys")

    # ------------------------------------------------------------------
    # Step 4 – Match references to definitions
    # ------------------------------------------------------------------
    reference_to_definition: dict[tuple, dict] = {}

    for key, refs in note_references.items():
        chapter_num, note_num = key

        # Prefer exact chapter match, fall back to chapter=0 (global section)
        defs = note_definitions.get(key) or note_definitions.get((0, note_num)) or []

        if not defs:
            continue

        defs_sorted = sorted(defs, key=lambda d: d["page_idx"])

        if len(refs) == len(defs_sorted):
            # Counts match → map 1-to-1 sorted by page position
            refs_sorted = sorted(enumerate(refs), key=lambda x: x[1]["page_idx"])
            for rank, (orig_idx, _ref) in enumerate(refs_sorted):
                reference_to_definition[(chapter_num, note_num, orig_idx)] = defs_sorted[rank]
        else:
            # Counts differ → map each ref to the definition in the appropriate range
            for ref_idx, ref in enumerate(refs):
                after = [d for d in defs_sorted if d["page_idx"] >= ref["page_idx"]]
                best_def = after[0] if after else min(
                    defs_sorted, key=lambda d: abs(d["page_idx"] - ref["page_idx"]))
                reference_to_definition[(chapter_num, note_num, ref_idx)] = best_def

    # ------------------------------------------------------------------
    # Step 5 – Build report and (optionally) insert links
    # ------------------------------------------------------------------
    note_entries = []

    # If applying links, first clear existing inaccurate/corrupt endnote links
    if not analyze_only:
        _clear_existing_endnote_links(doc, notes_section_start, notes_section_end)

    all_keys = set(note_references.keys()) | set(
        (chap, num) for chap, num in note_definitions.keys())

    for chap, note_num in sorted(all_keys):
        refs = note_references.get((chap, note_num), [])
        has_refs = bool(refs)
        has_defs = bool(note_definitions.get((chap, note_num)) or
                        note_definitions.get((0, note_num)))

        if has_refs and has_defs:
            for ref_idx, ref in enumerate(refs):
                def_info = reference_to_definition.get((chap, note_num, ref_idx))
                if def_info is None:
                    note_entries.append({
                        "note_number": note_num,
                        "chapter": chap,
                        "reference_page": ref["page"],
                        "definition_page": None,
                        "is_linked": False,
                        "status": "missing_definition",
                    })
                    continue

                if not analyze_only:
                    _create_endnote_link(doc, ref["page_idx"], ref["rect"],
                                         def_info["page_idx"], note_num)
                    _create_reference_link(doc, def_info["page_idx"], def_info["rect"],
                                           ref["page_idx"], note_num)
                    both_linked = True
                else:
                    ref_linked = _check_link_exists(doc, ref["page_idx"], ref["rect"])
                    def_linked = _check_link_exists(doc, def_info["page_idx"], def_info["rect"])
                    both_linked = ref_linked and def_linked

                note_entries.append({
                    "note_number": note_num,
                    "chapter": chap,
                    "reference_page": ref["page"],
                    "definition_page": def_info["page"],
                    "is_linked": both_linked,
                    "reference_count": len(refs),
                })

        elif has_refs:
            for ref in refs:
                note_entries.append({
                    "note_number": note_num,
                    "chapter": chap,
                    "reference_page": ref["page"],
                    "definition_page": None,
                    "is_linked": False,
                    "status": "missing_definition",
                    "reference_count": len(refs),
                })
        elif has_defs:
            for def_info in (note_definitions.get((chap, note_num)) or []):
                note_entries.append({
                    "note_number": note_num,
                    "chapter": chap,
                    "reference_page": None,
                    "definition_page": def_info["page"],
                    "is_linked": False,
                    "status": "missing_reference",
                    "reference_count": 0,
                })

    # ------------------------------------------------------------------
    # Save PDF if links were inserted
    # ------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Helper: clean existing endnote links before re-applying
# ---------------------------------------------------------------------------

def _clear_existing_endnote_links(doc, notes_section_start: int, notes_section_end: int):
    """Safely remove existing GOTO links between body pages and notes pages."""
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        links = page.get_links()
        for link in links:
            if link.get("kind") == fitz.LINK_GOTO:
                target_page = link.get("page")
                if target_page is not None:
                    # Link from body to notes section
                    if page_idx < notes_section_start and (notes_section_start <= target_page < notes_section_end):
                        page.delete_link(link)
                    # Link from notes section back to body
                    elif (notes_section_start <= page_idx < notes_section_end) and target_page < notes_section_start:
                        page.delete_link(link)


# ---------------------------------------------------------------------------
# Helper: locate notes / references section
# ---------------------------------------------------------------------------

def _find_notes_section_start(doc, chapter_page_ranges: list) -> int | None:
    """Return the page index where the notes / references section begins."""
    # 1. TOC-based detection (fast and reliable)
    try:
        toc = doc.get_toc()
        keywords = re.compile(
            r'\b(Notes?|Endnotes?|References?|Bibliography|Works\s+Cited)\b',
            re.IGNORECASE)
        for item in toc:
            _lvl, title, page_1based = item
            if keywords.search(title):
                page_idx = page_1based - 1
                if 0 <= page_idx < len(doc):
                    logger.debug(f"Notes section from TOC: '{title}' at page {page_1based}")
                    return page_idx
    except Exception as e:
        logger.debug(f"TOC-based detection failed: {e}")

    # 2. Text-scan fallback
    keywords_re = re.compile(
        r'^(Notes?|Endnotes?|Notes?\s+and\s+References?|Bibliography|Works\s+Cited)',
        re.IGNORECASE)
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        lines = [l.strip() for l in page.get_text().split('\n') if l.strip()]
        for line in lines:
            if re.match(r'^\d+$', line):
                continue
            if keywords_re.match(line):
                logger.debug(f"Notes section from text-scan at page {page_idx + 1}: '{line}'")
                return page_idx
            break

    return None


# ---------------------------------------------------------------------------
# Helper: chapter ranges from TOC
# ---------------------------------------------------------------------------

def _get_chapter_ranges_from_toc(doc) -> list:
    """
    Return a list of (chapter_num, start_page_idx, end_page_idx) tuples.
    Detects numbered chapters ("Chapter 1", "1 Wolves..."), "Introduction", and "Postscript".
    """
    chapter_ranges = []
    try:
        toc = doc.get_toc()
        notes_start = _find_notes_section_start(doc, [])
        sections = []

        for item in toc:
            _lvl, title, page_1based = item
            p_idx = page_1based - 1
            if notes_start is not None and p_idx >= notes_start:
                break
            t = title.strip()
            m_num = re.search(r'\b(?:Chapter|CHAPTER)\s+(\d+)\b', t, re.IGNORECASE) or re.search(r'^(\d+)\s+[\w\W]', t)
            if m_num:
                chap_num = int(m_num.group(1))
            elif re.search(r'\bIntroduction\b', t, re.IGNORECASE):
                chap_num = 0
            elif re.search(r'\bPostscript\b', t, re.IGNORECASE):
                chap_num = 99
            else:
                chap_num = None

            if chap_num is not None:
                sections.append((chap_num, p_idx))

        sections.sort(key=lambda x: x[1])
        for i, (chap_num, start_idx) in enumerate(sections):
            end_idx = sections[i + 1][1] - 1 if i + 1 < len(sections) else ((notes_start - 1) if notes_start else len(doc) - 1)
            chapter_ranges.append((chap_num, start_idx, end_idx))
    except Exception as e:
        logger.debug(f"Could not build chapter ranges from TOC: {e}")

    return chapter_ranges


def _page_to_chapter(page_idx: int, chapter_ranges: list) -> int:
    """Return the chapter number for a given page index (0 if unknown)."""
    for chap_num, start, end in chapter_ranges:
        if start <= page_idx <= end:
            return chap_num
    return 0


# ---------------------------------------------------------------------------
# Helper: link existence check
# ---------------------------------------------------------------------------

def _check_link_exists(doc, page_idx: int, rect) -> bool:
    """Return True if any GOTO link already covers rect on the page."""
    try:
        page = doc[page_idx]
        r = fitz.Rect(rect)
        for link in page.get_links():
            if link.get('kind') == fitz.LINK_GOTO:
                lr = link.get('from')
                if lr and fitz.Rect(lr).intersects(r):
                    return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Helper: link insertion
# ---------------------------------------------------------------------------

def _create_endnote_link(doc, ref_page_idx: int, ref_rect,
                          def_page_idx: int, note_num: int):
    """Insert a GOTO link from the in-body superscript to its definition."""
    try:
        doc[ref_page_idx].insert_link({
            "kind": fitz.LINK_GOTO,
            "from": fitz.Rect(ref_rect),
            "page": def_page_idx,
        })
        logger.debug(f"Created forward link for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create forward link for note {note_num}: {e}")


def _create_reference_link(doc, def_page_idx: int, def_rect,
                            ref_page_idx: int, note_num: int):
    """Insert a GOTO link from the definition back to the in-body superscript."""
    try:
        doc[def_page_idx].insert_link({
            "kind": fitz.LINK_GOTO,
            "from": fitz.Rect(def_rect),
            "page": ref_page_idx,
        })
        logger.debug(f"Created backlink for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create backlink for note {note_num}: {e}")
