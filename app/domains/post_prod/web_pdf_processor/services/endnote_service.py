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

def find_endnotes_in_pdf(pdf_path: str, analyze_only: bool = True, custom_details: list = None) -> dict:
    """
    Scan PDF for superscript note references and chapter-based endnotes/references.

    Strategy
    --------
    1. Use PDF bookmarks (TOC) to identify chapter page ranges and the
       references/notes section start page. Fall back to text scanning when
       no bookmarks exist.
    2. Collect all superscript digit spans and bracketed citations in body text,
       grouped by their owning chapter.
    3. Parse the references section. Detect chapter / section subheadings that
       restart numbering, and assign each numbered entry to a (chapter, num) pair.
    4. Match each in-body reference to the correct definition by chapter.
    5. Optionally insert bidirectional LINK_GOTO annotations cleanly.
    """
    doc = fitz.open(pdf_path)

    # ------------------------------------------------------------------
    # Step 1 – Locate notes/references section and chapter boundaries
    # ------------------------------------------------------------------
    toc = doc.get_toc()

    # Detect all endnote / references TOC entries (e.g. Chapter References / Endnotes)
    ref_toc_entries = []
    for lvl, title, page_1based in toc:
        if re.search(r'^(?:Notes?|Endnotes?|References?)(?:\s*[:\-–—].*)?$', title.strip(), re.IGNORECASE):
            ref_toc_entries.append((lvl, page_1based - 1))

    chapter_page_ranges = _get_chapter_ranges_from_toc(doc)

    # Check for in-text end-of-chapter Notes/References sections if TOC has no sub-entries
    in_text_notes_pages = []
    if not ref_toc_entries and chapter_page_ranges:
        for p_idx in range(len(doc)):
            page_text = doc[p_idx].get_text()
            if re.search(r'^(?:Notes?|Endnotes?|References?)\s*$', page_text, re.MULTILINE):
                for m in re.finditer(r'^(?:Notes?|Endnotes?|References?)\s*$', page_text, re.MULTILINE):
                    after = page_text[m.end():m.end()+250]
                    if re.search(r'^\s*(?:\[\d+\]|\d+[\.\)\t])', after, re.MULTILINE):
                        in_text_notes_pages.append((2, p_idx))
                        break

    all_ref_entries = ref_toc_entries or in_text_notes_pages
    is_chapter_based = len(all_ref_entries) > 1 or any(lvl > 1 for lvl, _ in all_ref_entries)

    ref_pages_set = set()
    if is_chapter_based:
        # Each chapter has its own references section page(s)
        for _, p_idx in all_ref_entries:
            ref_pages_set.add(p_idx)
        # Also check page following ref_start if it continues references
        for p_idx in list(ref_pages_set):
            if p_idx + 1 < len(doc) and p_idx + 1 not in [cr[1] for cr in chapter_page_ranges]:
                next_p = doc[p_idx + 1]
                t_sample = next_p.get_text()[:300]
                if re.search(r'^\s*(?:\[\d+\]|\d+[\.\)])', t_sample, re.MULTILINE):
                    ref_pages_set.add(p_idx + 1)
        body_pages = [p for p in range(len(doc)) if p not in ref_pages_set]
        ref_pages = sorted(ref_pages_set)
    else:
        notes_section_start = _find_notes_section_start(doc, chapter_page_ranges)
        if notes_section_start is None:
            logger.debug("No notes/references section found in PDF")
            doc.close()
            return {"total_notes": 0, "linked": 0, "not_linked": 0, "details": []}

        notes_section_end = len(doc)
        for _lvl, title, page_1based in toc:
            if re.search(r'^(?:Index|Bibliography|References|Works\s+Cited|Back\s+Cover)\b', title.strip(), re.IGNORECASE):
                p_idx = page_1based - 1
                if p_idx > notes_section_start:
                    notes_section_end = min(notes_section_end, p_idx)

        first_body_page = chapter_page_ranges[0][1] if chapter_page_ranges else 0
        body_pages = list(range(first_body_page, notes_section_start))
        ref_pages = list(range(notes_section_start, notes_section_end))
        ref_pages_set = set(ref_pages)

    # Detect if any ref_page starts mid-page with a Notes/References heading
    # so body text above that heading is still scanned for citations.
    ref_section_start_y: dict[int, float] = {}
    for p_idx in ref_pages_set:
        p_obj = doc[p_idx]
        p_h = p_obj.rect.height
        for b in p_obj.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            for l in b.get("lines", []):
                ly = l.get("bbox", [0, 0, 0, 0])[1]
                if ly < 45 or ly > p_h - 40:
                    continue
                lt = "".join(s.get("text", "") for s in l.get("spans", [])).strip()
                if re.match(r'^(?:Notes?|Endnotes?|References?)(?:\s*[:\-–—].*)?$', lt, re.IGNORECASE):
                    if p_idx not in ref_section_start_y or ly < ref_section_start_y[p_idx]:
                        ref_section_start_y[p_idx] = ly

    # ------------------------------------------------------------------
    # Step 2 – Collect note references in body text
    # Supports:
    #   (a) Superscript digit spans (e.g. ^1, ^2)
    #   (b) Bracketed/parenthesized citation callouts (e.g. (19), (12, 17), (1-3), [4])
    # ------------------------------------------------------------------
    note_references: dict[tuple, list] = defaultdict(list)

    body_scan_pages = sorted(set(body_pages) | set(ref_section_start_y.keys()))
    for page_idx in body_scan_pages:
        page = doc[page_idx]
        chapter_num = _page_to_chapter(page_idx, chapter_page_ranges)
        ref_y_limit = ref_section_start_y.get(page_idx)

        page_blocks = page.get_text("dict")["blocks"]
        for block in page_blocks:
            if block["type"] != 0:
                continue
            for line in block.get("lines", []):
                if ref_y_limit is not None and line.get("bbox", [0, 0, 0, 0])[1] >= ref_y_limit:
                    continue
                # (a) Check superscript spans (single digit or comma/hyphen separated like "1,2", "3-5")
                for span in line.get("spans", []):
                    flags = span.get("flags", 0)
                    text = span.get("text", "").strip()
                    is_superscript = bool(flags & 1) or (span.get("size", 10.0) < 7.0 and re.match(r'^\d+(?:[,\-–]\d+)*$', text))

                    if is_superscript and re.match(r'^\d+(?:[,\-–;]\d+)*$', text):
                        r = fitz.Rect(span["bbox"])
                        span_len = max(1, len(text))
                        for num_m in re.finditer(r'\d+', text):
                            note_num = int(num_m.group(0))
                            if note_num <= 0 or note_num >= 1900:
                                continue
                            if span_len == len(num_m.group(0)):
                                sub_r = r
                            else:
                                x0 = r.x0 + r.width * (num_m.start() / span_len)
                                x1 = r.x0 + r.width * (num_m.end() / span_len)
                                sub_r = fitz.Rect(x0, r.y0, x1, r.y1)
                            r_click = fitz.Rect(sub_r.x0 - 1.5, sub_r.y0 - 1.5, sub_r.x1 + 1.5, sub_r.y1 + 1.5)
                            key = (chapter_num, note_num)
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
                        bracket_rects = page.search_for(bracket_str, clip=fitz.Rect(line_rect.x0, line_rect.y0 - 2, line_rect.x1, line_rect.y1 + 2))
                    if not bracket_rects:
                        continue

                    target_bracket_rect = bracket_rects[0]

                    # Fast-path for single numbers like [1] or (2) without calling heavy rawdict
                    if content.isdigit():
                        val = int(content)
                        if val <= 0 or val >= 1900:  # Skip 0 and 4-digit years
                            continue
                        r_click = fitz.Rect(target_bracket_rect.x0 - 1.5, target_bracket_rect.y0 - 1.5, target_bracket_rect.x1 + 1.5, target_bracket_rect.y1 + 1.5)
                        key = (chapter_num, val)
                        note_references[key].append({
                            "page_idx": page_idx,
                            "page": page_idx + 1,
                            "rect": r_click,
                            "chapter_num": chapter_num,
                        })
                        continue

                    # Parse individual note numbers or ranges (e.g. "12, 17" or "1-3")
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
                        if val <= 0 or val >= 1900:  # Skip 0 and 4-digit years
                            item_idx += 1
                            continue

                        r_click = fitz.Rect(r_box.x0 - 1.5, r_box.y0 - 1.5, r_box.x1 + 1.5, r_box.y1 + 1.5)

                        if sep == "-" and item_idx + 1 < len(parsed_items):
                            next_val, next_r_box, _ = parsed_items[item_idx + 1]
                            if 0 < next_val - val <= 15:
                                # Expand full range so all numbers [val .. next_val] get mapped to the citation box
                                next_r_click = fitz.Rect(next_r_box.x0 - 1.5, next_r_box.y0 - 1.5, next_r_box.x1 + 1.5, next_r_box.y1 + 1.5)
                                full_range_box = r_click | next_r_click
                                for r_num in range(val, next_val + 1):
                                    key = (chapter_num, r_num)
                                    # First note links to its own click box, last to next_r_click, intermediate share full_range_box
                                    c_box = r_click if r_num == val else (next_r_click if r_num == next_val else full_range_box)
                                    note_references[key].append({
                                        "page_idx": page_idx,
                                        "page": page_idx + 1,
                                        "rect": c_box,
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
    # First pass: collect common left margins (x0) of potential numbered lines to distinguish
    # true note definition starts from wrapped citation lines (hanging indents)
    raw_x0_counts = defaultdict(int)
    for p_idx in ref_pages:
        p_obj = doc[p_idx]
        p_h = p_obj.rect.height
        ref_y_start = ref_section_start_y.get(p_idx)
        for b in p_obj.get_text("dict").get("blocks", []):
            if b.get("type") != 0:
                continue
            for l in b.get("lines", []):
                ly = l.get("bbox", [0, 0, 0, 0])[1]
                if ly < 45 or ly > p_h - 40:
                    continue
                if ref_y_start is not None and ly < ref_y_start:
                    continue
                lt = "".join(s.get("text", "") for s in l.get("spans", [])).strip()
                if re.match(r'^(?:\[\d{1,4}\]|\d{1,4}[\.\)\:\-]?)(\t|\s+|$)', lt) and l.get("spans"):
                    raw_x0_counts[round(l["spans"][0]["bbox"][0], 1)] += 1

    primary_note_margins = [m for m, cnt in raw_x0_counts.items() if cnt >= 5]
    if primary_note_margins and raw_x0_counts:
        max_cnt = max(raw_x0_counts.values())
        # Filter out hanging-indent false positives slightly right of a dominant column margin
        # (keep true multi-column margins separated by > 100pt or with substantial counts)
        filtered_margins = []
        for m in sorted(primary_note_margins):
            cnt = raw_x0_counts[m]
            is_hanging_indent = any(
                (5.0 < m - prev_m < 60.0) and cnt < raw_x0_counts[prev_m] * 0.25
                for prev_m in filtered_margins
            )
            if not is_hanging_indent and (cnt >= 5 or cnt >= max_cnt * 0.1):
                filtered_margins.append(m)
        primary_note_margins = filtered_margins

    note_definitions: dict[tuple, list] = defaultdict(list)
    curr_chapter_num = 0

    for page_idx in ref_pages:
        page = doc[page_idx]
        if is_chapter_based:
            curr_chapter_num = _page_to_chapter(page_idx, chapter_page_ranges)

        raw_blocks = [b for b in page.get_text("dict")["blocks"] if b["type"] == 0]
        # Skip header (<45 pt) and footer (> height - 40 pt)
        page_h = page.rect.height
        content_blocks = [b for b in raw_blocks if not (b["bbox"][1] < 45 or b["bbox"][1] > page_h - 40)]

        # Collect lines with their vertical coordinate to preserve natural reading order
        ref_y_start = ref_section_start_y.get(page_idx)
        page_lines = []
        for block in content_blocks:
            for line in block.get("lines", []):
                ly = line.get("bbox", [0, 0, 0, 0])[1]
                if ly < 45 or ly > page_h - 40:
                    continue
                if ref_y_start is not None and ly < ref_y_start:
                    continue
                page_lines.append(line)

        # Sort lines top-to-bottom within the page
        sorted_lines = sorted(page_lines, key=lambda l: l["bbox"][1])

        for line in sorted_lines:
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                if not line_text:
                    continue

                # Detect headings that switch chapter context
                # Must be standalone headings, e.g. "^Introduction$" or "^Chapter \d+$"
                if re.match(r'^(?:Introduction(?::.*)?|The Wolf of Time and \(Hi\)story)$', line_text, re.IGNORECASE):
                    curr_chapter_num = 0
                    continue
                m_chap = re.match(r'^(?:Chapter|CHAPTER)\s+(\d{1,3})(?:\s*[:\-–—].*)?$', line_text, re.IGNORECASE)
                if m_chap:
                    curr_chapter_num = int(m_chap.group(1))
                    continue
                if re.match(r'^(?:Conclusion(?:[:\-–—].*)?)$', line_text, re.IGNORECASE):
                    curr_chapter_num = 6
                    continue
                if re.match(r'^(?:Postscript(?::.*)?)$', line_text, re.IGNORECASE):
                    curr_chapter_num = 99
                    continue

                # Match numbered note definitions: "[1]", "1.", "1.\t", "1) ", "10.\t Marvin..."
                defn_match = re.match(r'^(?:\[(\d{1,4})\]|(\d{1,4})[\.\)\:\-]?)(\t|\s+|$)', line_text)
                if defn_match and line.get("spans"):
                    note_num = int(defn_match.group(1) or defn_match.group(2))
                    if note_num >= 1900:  # Skip years that wrap to line start
                        continue

                    span = line["spans"][0]
                    # Filter out hanging indent false positives
                    x0 = span["bbox"][0]
                    x0_round = round(x0, 1)
                    if primary_note_margins:
                        # Allow up to 12pt left shift for right-aligned 2-digit/3-digit note numbers (e.g. '10.', '100.')
                        is_valid_margin = any(-12.0 <= (x0_round - pm) <= 3.0 for pm in primary_note_margins)
                    else:
                        is_valid_margin = (x0 < 160) or (220 < x0 < 380)

                    if not is_valid_margin:
                        continue

                    r_span = fitz.Rect(span["bbox"])
                    num_prefix = defn_match.group(0).strip()
                    span_txt_stripped = span.get("text", "").strip()
                    if span_txt_stripped == num_prefix or len(span_txt_stripped) <= len(num_prefix) + 1:
                        # Span contains only the note number (e.g. "40\t" or "40.")
                        r_click = fitz.Rect(r_span.x0 - 1.0, r_span.y0 - 1.0, r_span.x1 + 1.5, r_span.y1 + 1.0)
                    else:
                        # Span includes both note number and following text; bound rect to the number prefix only
                        fsize = max(float(span.get("size", 9.0)), 6.0)
                        est_w = min(r_span.width, max(10.0, len(num_prefix) * fsize * 0.65))
                        r_click = fitz.Rect(r_span.x0 - 1.0, r_span.y0 - 1.0, r_span.x0 + est_w + 1.5, r_span.y1 + 1.0)

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

        # Prefer exact chapter match; only fall back to chapter 0 if no multi-chapter structure was detected
        defs = note_definitions.get(key)
        if not defs and not chapter_page_ranges:
            defs = note_definitions.get((0, note_num)) or []
        if not defs:
            defs = []

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
        _clear_existing_endnote_links(doc, ref_pages_set)

    # Filter active references if custom_details (user exclusions) provided
    active_ref_pairs = None
    if custom_details is not None:
        active_ref_pairs = set()
        for d in custom_details:
            rp = d.get("reference_page")
            nn = d.get("note_number")
            if rp is not None and nn is not None:
                active_ref_pairs.add((rp, nn))

    all_keys = set(note_references.keys()) | set(
        (chap, num) for chap, num in note_definitions.keys())

    for chap, note_num in sorted(all_keys):
        refs = note_references.get((chap, note_num), [])
        has_refs = bool(refs)
        has_defs = bool(note_definitions.get((chap, note_num)) or
                        note_definitions.get((0, note_num)))

        if has_refs and has_defs:
            for ref_idx, ref in enumerate(refs):
                # If excluded by user, skip it
                if active_ref_pairs is not None and (ref["page"], note_num) not in active_ref_pairs:
                    continue

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
                    # Always link back to the FIRST occurrence in the chapter
                    if ref_idx == 0:
                        _create_reference_link(doc, def_info['page_idx'], def_info['rect'],
                                               ref['page_idx'], note_num)
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
                if active_ref_pairs is not None and (ref["page"], note_num) not in active_ref_pairs:
                    continue
                note_entries.append({
                    "note_number": note_num,
                    "chapter": chap,
                    "reference_page": ref["page"],
                    "definition_page": None,
                    "is_linked": False,
                    "status": "missing_definition",
                    "reference_count": len(refs),
                })
        elif has_defs and not is_chapter_based:
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
        doc.save(temp_path, incremental=False, garbage=0, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
        logger.debug("Endnote links created and PDF saved")
    else:
        doc.close()

    linked_count = sum(1 for n in note_entries if n.get("is_linked", False))
    not_linked_count = len(note_entries) - linked_count
    valid_defs_count = sum(1 for n in note_entries if n.get("definition_page") is not None)

    # If numeric endnotes found genuine definitions (e.g. at least 5 or > 20% matched), it is a numeric book!
    # Otherwise, check for Author-Year (APA/Harvard) citations.
    if valid_defs_count >= 5 or (len(note_entries) > 0 and valid_defs_count / len(note_entries) > 0.2):
        return {
            "total_notes": len(note_entries),
            "linked": linked_count,
            "not_linked": not_linked_count,
            "ref_type": "numeric",
            "details": note_entries,
        }

    # Automatically scan for Author-Year (APA/Harvard) citations!
    try:
        from .reference_citation_service import find_reference_citations_in_pdf
        cite_res = find_reference_citations_in_pdf(pdf_path, analyze_only)
        if cite_res.get("matched", 0) > valid_defs_count:
            normalized_details = []
            for d in cite_res.get("details", []):
                normalized_details.append({
                    "note_number": d.get("citation"),
                    "chapter": 1,
                    "reference_page": d.get("page"),
                    "definition_page": d.get("def_page"),
                    "target_text": d.get("target_author") or d.get("target_preview") or "",
                    "is_linked": d.get("is_linked", False),
                    "status": d.get("status") or ("Active" if d.get("def_page") else "missing_definition"),
                    "is_author_year": True,
                })
            return {
                "total_notes": cite_res.get("total_citations", 0),
                "linked": cite_res.get("linked", 0),
                "not_linked": cite_res.get("not_linked", 0),
                "ref_type": "author_year",
                "details": normalized_details,
            }
    except Exception as e:
        logger.warning(f"Author-year fallback error: {e}")

    return {
        "total_notes": len(note_entries),
        "linked": linked_count,
        "not_linked": not_linked_count,
        "ref_type": "numeric",
        "details": note_entries,
    }


# ---------------------------------------------------------------------------
# Helper: clean existing endnote links before re-applying
# ---------------------------------------------------------------------------

def _identify_toc_pages(doc) -> set:
    """Identify page indices that belong to the Table of Contents."""
    toc_pages = set()
    try:
        # Check bookmarks first
        for lvl, title, page_1based in doc.get_toc():
            if re.match(r'^(?:Table of )?Contents$', title.strip(), re.IGNORECASE):
                toc_pages.add(page_1based - 1)
    except Exception:
        pass

    # Text search fallback in first 20 pages
    if not toc_pages:
        for p_idx in range(min(20, len(doc))):
            page_text = doc[p_idx].get_text()
            if re.search(r'\b(?:Table\s+of\s+Contents|^Contents\b)', page_text, re.IGNORECASE | re.MULTILINE):
                toc_pages.add(p_idx)

    # Expand to consecutive TOC pages if multi-page TOC
    if toc_pages:
        expanded = set(toc_pages)
        for tp in toc_pages:
            for next_p in range(tp + 1, min(tp + 6, len(doc))):
                text = doc[next_p].get_text()
                if re.search(r'\.{4,}|\b\d{1,4}\s*$', text, re.MULTILINE) and not re.search(r'^(?:CHAPTER|Chapter)\s+1\b', text, re.MULTILINE):
                    expanded.add(next_p)
                else:
                    break
        return expanded
    return toc_pages


def _clear_existing_endnote_links(doc, ref_pages_set: set):
    """
    Safely remove existing GOTO links between body pages and notes pages.
    PROTECTS:
      1. All links on TOC pages (TOC -> Chapter / Bibliography / Index)
      2. All links pointing to TOC pages (Two-Way Return Links from Chapter headings -> TOC)
      3. Wide links (TOC entries and chapter title banners are broad; endnote links are tiny superscripts)
    """
    toc_pages = _identify_toc_pages(doc)
    logger.debug(f"Endnote cleaner protecting TOC pages: {toc_pages}")

    for page_idx in range(len(doc)):
        # Never remove any links on Table of Contents pages!
        if page_idx in toc_pages:
            continue

        page = doc[page_idx]
        links = page.get_links()
        for link in links:
            if link.get("kind") == fitz.LINK_GOTO:
                target_page = link.get("page")
                if target_page is None:
                    continue

                # Never delete backlinks that return to the Table of Contents!
                if target_page in toc_pages:
                    continue

                # Check link bounding box: endnote superscripts and definition numbers are narrow (< 45 pt)
                # Two-way chapter title banners or section links are much wider.
                link_rect = fitz.Rect(link.get("from", [0, 0, 0, 0]))
                if link_rect.width > 60:
                    # Not an endnote link (probably a heading or banner link) -> protect it!
                    continue

                # Link between body and references pages
                if (page_idx not in ref_pages_set and target_page in ref_pages_set) or \
                   (page_idx in ref_pages_set and target_page not in ref_pages_set):
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
            r'^(?:Notes?|Endnotes?|References?|Bibliography|Works\s+Cited)(?:\s*[:\-–—].*)?$',
            re.IGNORECASE)
        for item in toc:
            _lvl, title, page_1based = item
            if keywords.match(title.strip()):
                page_idx = page_1based - 1
                if 0 <= page_idx < len(doc):
                    logger.debug(f"Notes section from TOC: '{title}' at page {page_1based}")
                    return page_idx
    except Exception as e:
        logger.debug(f"TOC-based detection failed: {e}")

    # 2. Text-scan fallback
    keywords_re = re.compile(
        r'^(?:Notes?|Endnotes?|Notes?\s+and\s+References?|Bibliography|Works\s+Cited)\s*$',
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
        sections = []

        for item in toc:
            lvl, title, page_1based = item
            p_idx = page_1based - 1
            t = title.strip()
            m_num = re.search(r'\b(?:Chapter|CHAPTER)\s+(\d+)\b', t, re.IGNORECASE) or re.search(r'^(\d+)\s+[\w\W]', t)
            if m_num and (lvl == 1 or m_num.group(1)):
                chap_num = int(m_num.group(1))
                sections.append((chap_num, p_idx))
            elif re.search(r'\bIntroduction\b', t, re.IGNORECASE) and lvl == 1:
                chap_num = 0
                sections.append((chap_num, p_idx))
            elif re.search(r'\bConclusion\b', t, re.IGNORECASE) and lvl == 1:
                chap_num = 6
                sections.append((chap_num, p_idx))
            elif re.search(r'\b(?:Notes?|References?|Bibliography|Index|Back\s+Cover)\b', t, re.IGNORECASE) and lvl == 1:
                sections.append((999, p_idx))
            elif re.search(r'\bPostscript\b', t, re.IGNORECASE) and lvl == 1:
                chap_num = 99
                sections.append((chap_num, p_idx))

        sections.sort(key=lambda x: x[1])
        for i, (chap_num, start_idx) in enumerate(sections):
            if chap_num == 999:
                break
            end_idx = sections[i + 1][1] - 1 if i + 1 < len(sections) else len(doc) - 1
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
    """Return True if any GOTO link significantly covers rect on the page."""
    try:
        page = doc[page_idx]
        r = fitz.Rect(rect)
        r_area = r.get_area()
        if r_area <= 0:
            return False
        for link in page.get_links():
            if link.get('kind') == fitz.LINK_GOTO:
                lr = link.get('from')
                if lr:
                    lr_rect = fitz.Rect(lr)
                    inter = lr_rect & r
                    if not inter.is_empty:
                        min_area = min(r_area, lr_rect.get_area())
                        if min_area > 0 and (inter.get_area() / min_area) >= 0.4:
                            return True
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Helper: link insertion
# ---------------------------------------------------------------------------

def _rects_significantly_overlap(r1: fitz.Rect, r2: fitz.Rect, threshold: float = 0.4) -> bool:
    inter = r1 & r2
    if inter.is_empty:
        return False
    min_area = min(r1.get_area(), r2.get_area())
    return min_area > 0 and (inter.get_area() / min_area) >= threshold


def _create_endnote_link(doc, ref_page_idx: int, ref_rect,
                          def_page_idx: int, note_num: int):
    """Insert a GOTO link from the in-body superscript to its definition."""
    try:
        page = doc[ref_page_idx]
        r = fitz.Rect(ref_rect)
        for l in page.get_links():
            if l.get("kind") == fitz.LINK_GOTO:
                lr = l.get("from")
                if lr and _rects_significantly_overlap(fitz.Rect(lr), r):
                    page.delete_link(l)
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": r,
            "page": def_page_idx,
        })
        logger.debug(f"Created forward link for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create forward link for note {note_num}: {e}")


def _create_reference_link(doc, def_page_idx: int, def_rect,
                            ref_page_idx: int, note_num: int):
    """Insert a GOTO link from the definition back to the in-body superscript."""
    try:
        page = doc[def_page_idx]
        r = fitz.Rect(def_rect)
        for l in page.get_links():
            if l.get("kind") == fitz.LINK_GOTO:
                lr = l.get("from")
                if lr and _rects_significantly_overlap(fitz.Rect(lr), r):
                    page.delete_link(l)
        page.insert_link({
            "kind": fitz.LINK_GOTO,
            "from": r,
            "page": ref_page_idx,
        })
        logger.debug(f"Created backlink for note {note_num}")
    except Exception as e:
        logger.error(f"Failed to create backlink for note {note_num}: {e}")
