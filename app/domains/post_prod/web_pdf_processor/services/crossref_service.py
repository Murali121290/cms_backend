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


def _rects_overlap(rect1, rect2, threshold: float = 0.5) -> bool:
    """Check if two rectangles overlap significantly."""
    if rect1 is None or rect2 is None:
        return False
    try:
        r1 = fitz.Rect(rect1)
        r2 = fitz.Rect(rect2)
        intersection = r1 & r2
        if intersection.is_empty:
            return False
        smaller_area = min(r1.get_area(), r2.get_area())
        if smaller_area <= 0:
            return False
        return (intersection.get_area() / smaller_area) >= threshold
    except Exception:
        return False


def _any_rect_overlap(r_cand, existing_r, threshold: float = 0.5) -> bool:
    """Check if any rectangle in r_cand overlaps any rectangle in existing_r."""
    r_cands = r_cand if isinstance(r_cand, list) else [r_cand]
    existing_rs = existing_r if isinstance(existing_r, list) else [existing_r]
    for rc in r_cands:
        for er in existing_rs:
            if _rects_overlap(rc, er, threshold):
                return True
    return False


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
            # Check if link already exists pointing to the expected target page
            linked = _check_link_exists(doc, ref["page_idx"], ref["rect"], expected_page_idx=target["page_idx"])

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
        doc.save(temp_path, incremental=False, garbage=0, deflate=True)
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
    Uses TOC bookmarks first to accurately target only actual reference/bibliography pages,
    avoiding accidental exclusion of subsequent chapters!
    """
    bibliography_pages = set()

    # 1. First preference: TOC bookmark entries
    try:
        toc = doc.get_toc()
        for idx, item in enumerate(toc):
            title = item[1].strip().lower()
            if re.search(r'\b(?:references|bibliography|works\s+cited|notes\s+and\s+references)\b', title):
                start = max(0, item[2] - 1)
                # Next section determines end
                end = max(start + 1, toc[idx + 1][2] - 1) if idx + 1 < len(toc) else min(start + 15, len(doc))
                for p in range(start, min(end, len(doc))):
                    bibliography_pages.add(p)
        if bibliography_pages:
            logger.debug(f"Identified {len(bibliography_pages)} bibliography pages from TOC")
            return bibliography_pages
    except Exception as e:
        logger.debug(f"TOC check error in _identify_bibliography_sections: {e}")

    # 2. Text scan fallback (per-chapter aware: stops when a new chapter begins)
    in_ref = False
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        text = page.get_text()
        first_few = ' '.join([l.strip() for l in text.split('\n')[:4] if l.strip()])

        if re.search(r'^(?:CHAPTER|PART|APPENDIX)\s+\d+', first_few, re.I):
            in_ref = False
        elif re.search(r'^(?:References|Bibliography|Works\s+Cited|Notes\s+and\s+References)\b', first_few, re.I):
            in_ref = True

        if in_ref:
            bibliography_pages.add(page_idx)

    return bibliography_pages


_PROSE_AFTER_RE = re.compile(
    r'^(?:Figure|Fig\.?|Table|Tab\.?|Box|Case)\s+\d+(?:[\.\-–]\d+)?\s+'
    r'(?:illustrates?|provides?|shows?|demonstrates?|presents?|depicts?|summarizes?|'
    r'highlights?|compares?|lists?|describes?|details?|outlines?|gives?|contains?|'
    r'defines?|explains?|is|are|was|were|has|have|can|will|may|also|further)\b',
    re.IGNORECASE,
)


def _is_bold_line(line_dict: dict) -> bool:
    for sp in line_dict.get("spans", []):
        if not sp.get("text", "").strip():
            continue
        flags = sp.get("flags", 0)
        font = (sp.get("font") or "").lower()
        return bool(flags & 16) or any(k in font for k in ("bold", "semibold", "demi", "heavy", "black"))
    return False


def _is_caption_line(line_dict: dict, line_str: str) -> bool:
    """Return True if line_str looks like an actual Figure/Table/Box caption rather than body prose."""
    if _PROSE_AFTER_RE.match(line_str):
        return False
    if _is_bold_line(line_dict):
        return True
    return bool(re.match(r'^(?:Figure|Fig\.?|Table|Tab\.?|Box|Case)\s+\d+(?:[\.\-–]\d+)?\s*:', line_str, re.IGNORECASE))


def _find_targets(doc) -> dict:
    """
    Find link targets: figure captions, table titles, chapters.
    Matches captions at line start (avoids mid-sentence mentions).
    Returns: {identifier -> {"page_idx": idx, "page": physical_page, "type": type}}
    """
    targets = {}
    target_scores = {}

    def _consider_target(key: str, entry: dict, line_dict: dict, line_str: str):
        if _PROSE_AFTER_RE.match(line_str):
            return
        is_bold = _is_bold_line(line_dict)
        has_colon = bool(re.match(r'^(?:Figure|Fig\.?|Table|Tab\.?|Box|Case)\s+\d+(?:[\.\-–]\d+)?\s*:', line_str, re.IGNORECASE))
        score = (2 if is_bold else 0) + (1 if has_colon else 0)
        if key not in targets or score > target_scores.get(key, -1):
            targets[key] = entry
            target_scores[key] = score

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        physical_page = page_idx + 1
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block["type"] != 0:
                continue

            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()

                # Match figure captions at line start: "Figure 3.2" or "Figure 3.2:" or "Figure 3-2"
                fig_match = re.match(r'(?:Figure|Fig\.?)\s+(\d+(?:[\.\-–]\d+)?)', line_text, re.IGNORECASE)
                if fig_match:
                    norm_num = re.sub(r'[\-–]', '.', fig_match.group(1))
                    fig_id = f"figure_{norm_num}"
                    _consider_target(fig_id, {
                        "page_idx": page_idx,
                        "page": physical_page,
                        "type": "figure",
                        "identifier": fig_match.group(1),
                    }, line, line_text)

                # Match table titles at line start: "Table 5.1" or "Table 5.1:" or "Table 5-1"
                table_match = re.match(r'(?:Table|Tab\.?)\s+(\d+(?:[\.\-–]\d+)?)', line_text, re.IGNORECASE)
                if table_match:
                    norm_num = re.sub(r'[\-–]', '.', table_match.group(1))
                    table_id = f"table_{norm_num}"
                    _consider_target(table_id, {
                        "page_idx": page_idx,
                        "page": physical_page,
                        "type": "table",
                        "identifier": table_match.group(1),
                    }, line, line_text)

                # Match Box / Case titles at line start: "Box 11-2" or "Box 11.2:"
                box_match = re.match(r'(?:Box|Case)\s+(\d+(?:[\.\-–]\d+)?)', line_text, re.IGNORECASE)
                if box_match:
                    norm_num = re.sub(r'[\-–]', '.', box_match.group(1))
                    box_id = f"box_{norm_num}"
                    _consider_target(box_id, {
                        "page_idx": page_idx,
                        "page": physical_page,
                        "type": "box",
                        "identifier": box_match.group(1),
                    }, line, line_text)

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


def _get_exact_match_rect(page, match_text: str, line_bbox: fitz.Rect) -> fitz.Rect:
    """Find the exact bounding box for the match string within the visual line."""
    pad_clip = fitz.Rect(line_bbox.x0 - 2, line_bbox.y0 - 2, line_bbox.x1 + 2, line_bbox.y1 + 2)
    rects = page.search_for(match_text, clip=pad_clip)
    if rects:
        # If match spans multiple font fragments (e.g. "see" + "Box 11-2"), union them into one clickable box
        res = fitz.Rect()
        for r in rects:
            res |= r
        return res
    rects = page.search_for(match_text)
    if rects:
        closest = min(rects, key=lambda r: abs((r.y0 + r.y1)/2 - (line_bbox.y0 + line_bbox.y1)/2))
        return closest
    return line_bbox


def _resolve_match_rects(page, check_item: dict, matched_str: str, raw_id: str, keyword: str):
    """
    Returns a list of fitz.Rect covering the matched reference,
    handling single-line matches and multi-line / hyphenated line breaks.
    """
    if not check_item.get("is_split"):
        r = _get_exact_match_rect(page, matched_str, check_item["r_primary"])
        return [r] if r else [check_item["r_primary"]]

    line1_rect = check_item["r_primary"]
    line2_rect = check_item["r_secondary"]
    clip1 = fitz.Rect(line1_rect.x0 - 2, line1_rect.y0 - 2, line1_rect.x1 + 2, line1_rect.y1 + 2)
    clip2 = fitz.Rect(line2_rect.x0 - 2, line2_rect.y0 - 2, line2_rect.x1 + 2, line2_rect.y1 + 2)

    # If the match already fits completely on line 1 or line 2, don't treat it as a split-line match
    if page.search_for(matched_str.strip(), clip=clip1):
        r = _get_exact_match_rect(page, matched_str, line1_rect)
        return [r] if r else [line1_rect]
    if page.search_for(matched_str.strip(), clip=clip2):
        r = _get_exact_match_rect(page, matched_str, line2_rect)
        return [r] if r else [line2_rect]

    if check_item.get("is_hyphenated"):
        part1 = check_item.get("part1", "")
        r1 = page.search_for(part1 + "-", clip=clip1) or page.search_for(part1, clip=clip1)
        next_text = check_item.get("next_text", "")
        m_p2 = re.match(r'^([A-Za-z]+\s+' + re.escape(raw_id) + r')', next_text)
        p2_text = m_p2.group(1) if m_p2 else raw_id
        r2 = page.search_for(p2_text, clip=clip2) or page.search_for(raw_id, clip=clip2)
        res = []
        if r1:
            res.append(r1[0])
        if r2:
            res.append(r2[0])
        return res if res else [line1_rect, line2_rect]
    else:
        # Space split (e.g. "Table" on line 1, "1.1" on line 2)
        r1 = page.search_for(keyword, clip=clip1)
        r2 = page.search_for(raw_id, clip=clip2)
        res = []
        if r1:
            res.append(r1[0])
        if r2:
            res.append(r2[0])
        return res if res else [line1_rect, line2_rect]


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

        # Find cross-references in text (including broken multi-line references)
        if not skip_external_refs:
            lines = []
            for block in blocks:
                if block["type"] != 0:
                    continue
                for l in block.get("lines", []):
                    spans = l.get("spans", [])
                    if not spans:
                        continue
                    l_text = "".join(s.get("text", "") for s in spans).strip()
                    l_rect = fitz.Rect(l["bbox"]) if "bbox" in l else fitz.Rect(spans[0]["bbox"])
                    lines.append({
                        "text": l_text,
                        "rect": l_rect,
                        "spans": spans,
                        "block_no": block.get("number", 0)
                    })

            for i in range(len(lines)):
                curr_l = lines[i]
                line_text = curr_l["text"]
                line_rect = curr_l["rect"]

                # Candidate texts to check: single line and stitched across consecutive lines
                check_items = [
                    {
                        "text": line_text,
                        "r_primary": line_rect,
                        "r_secondary": None,
                        "is_split": False,
                        "is_hyphenated": False,
                    }
                ]
                if i + 1 < len(lines):
                    next_l = lines[i + 1]
                    # Check A: Hyphenated across lines (e.g. "Using Ta-" \n "ble 1.1")
                    m_hyphen = re.search(r'([A-Za-z]+)[-\u2010\u00ad\u2013]\s*$', line_text)
                    if m_hyphen:
                        part1 = m_hyphen.group(1)
                        stitched_dehyphen = re.sub(r'[-\u2010\u00ad\u2013]\s*$', '', line_text) + next_l["text"]
                        check_items.append({
                            "text": stitched_dehyphen,
                            "r_primary": line_rect,
                            "r_secondary": next_l["rect"],
                            "is_split": True,
                            "is_hyphenated": True,
                            "part1": part1,
                            "next_text": next_l["text"]
                        })

                    # Check B: Split at space across lines (e.g. "see Table" \n "1.1")
                    if re.search(r'\b(?:Figures?|Figs?\.?|Tables?|Tabs?\.?|Chapters?|Chs?\.?|Box(?:es)?|Cases?)\s*$', line_text, re.I):
                        stitched_space = line_text + " " + next_l["text"]
                        check_items.append({
                            "text": stitched_space,
                            "r_primary": line_rect,
                            "r_secondary": next_l["rect"],
                            "is_split": True,
                            "is_hyphenated": False,
                            "next_text": next_l["text"]
                        })

                def _collect_plural_refs(item_dict, kw_pat: str, ref_type: str, num_pat: str, require_long_line: bool = False):
                    if require_long_line and len(line_text) < 50:
                        return
                    full_pat = rf'\b(?:see|refer\s+to|read|look\s+at|in)?\s*(?:{kw_pat})\s+({num_pat}(?:\s*(?:,|and|&|through|to|-|–|—)\s*{num_pat})+)'
                    for list_match in re.finditer(full_pat, item_dict["text"], re.I):
                        list_str = list_match.group(1)
                        line_b = item_dict["r_primary"]
                        pad_line = fitz.Rect(line_b.x0 - 2, line_b.y0 - 2, line_b.x1 + 2, line_b.y1 + 2)
                        phrase_rects = page.search_for(list_match.group(0).strip(), clip=pad_line)
                        phrase_clip = fitz.Rect()
                        for pr in phrase_rects:
                            phrase_clip |= pr
                        if phrase_clip.is_empty:
                            phrase_clip = pad_line
                        for num_m in re.finditer(rf'\b({num_pat})\b', list_str):
                            raw_id = num_m.group(1)
                            norm_id = re.sub(r'[\-–]', '.', re.sub(r'[a-z]+$', '', raw_id))
                            t_id = f"{ref_type}_{norm_id}"
                            if t_id not in targets:
                                continue
                            tgt = targets[t_id]
                            if page_idx == tgt["page_idx"] and line_text.startswith(list_match.group(0).lstrip()):
                                continue
                            num_hits = page.search_for(raw_id, clip=phrase_clip)
                            exact_rect = [num_hits[0]] if num_hits else [line_b]
                            if not any(_any_rect_overlap(exact_rect, ex["rect"]) for ex in references if ex["page_idx"] == page_idx):
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": exact_rect,
                                    "type": ref_type,
                                    "text": f"{ref_type.title()} {raw_id}",
                                    "target_info": tgt,
                                })

                for item in check_items:
                    text_to_check = item["text"]
                    _collect_plural_refs(item, r'Figures|Figs\.?', "figure", r'\d+(?:[\.\-–]\d+)?[a-z]?')
                    _collect_plural_refs(item, r'Tables|Tabs\.?', "table", r'\d+(?:[\.\-–]\d+)?[a-z]?')
                    _collect_plural_refs(item, r'Chapters|Chs\.?', "chapter", r'\d+', require_long_line=True)
                    _collect_plural_refs(item, r'Boxes|Cases', "box", r'\d+(?:[\.\-–]\d+)?[a-z]?')

                    # 1. Figure references
                    for fig_match in re.finditer(r'\b(?:see|refer\s+to|look\s+at)?\s*(?:Figures?|Figs?\.?)\s+(\d+(?:[\.\-–]\d+)?[a-z]?)', text_to_check, re.I):
                        raw_id = fig_match.group(1)
                        norm_id = re.sub(r'[\-–]', '.', re.sub(r'[a-z]+$', '', raw_id))
                        fig_id = f"figure_{norm_id}"
                        if fig_id in targets:
                            if targets[fig_id]["page_idx"] == page_idx and line_text.startswith(fig_match.group(0).lstrip()) and _is_caption_line(curr_l, line_text):
                                continue
                            exact_rect = _resolve_match_rects(page, item, fig_match.group(0), raw_id, "Figure")
                            # Avoid duplicates
                            if not any(_any_rect_overlap(exact_rect, existing_ref["rect"]) for existing_ref in references if existing_ref["page_idx"] == page_idx):
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": exact_rect,
                                    "type": "figure",
                                    "text": fig_match.group(0).strip(),
                                    "target_info": targets[fig_id],
                                })

                    # 2. Table references
                    for table_match in re.finditer(r'\b(?:see|refer\s+to|look\s+at)?\s*(?:Tables?|Tabs?\.?)\s+(\d+(?:[\.\-–]\d+)?[a-z]?)', text_to_check, re.I):
                        raw_id = table_match.group(1)
                        norm_id = re.sub(r'[\-–]', '.', re.sub(r'[a-z]+$', '', raw_id))
                        table_id = f"table_{norm_id}"
                        if table_id in targets:
                            if targets[table_id]["page_idx"] == page_idx and line_text.startswith(table_match.group(0).lstrip()) and _is_caption_line(curr_l, line_text):
                                continue
                            exact_rect = _resolve_match_rects(page, item, table_match.group(0), raw_id, "Table")
                            if not any(_any_rect_overlap(exact_rect, existing_ref["rect"]) for existing_ref in references if existing_ref["page_idx"] == page_idx):
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": exact_rect,
                                    "type": "table",
                                    "text": table_match.group(0).strip(),
                                    "target_info": targets[table_id],
                                })

                    # 3. Single Chapter references: "Chapter 1", "Ch. 4"
                    for ch_match in re.finditer(r'\b(?:see|refer\s+to|read)?\s*(?:Chapters?|Chs?\.?)\s+(\d+)', text_to_check, re.I):
                        raw_id = ch_match.group(1)
                        ch_id = f"chapter_{raw_id}"
                        if ch_id in targets:
                            target_chapter = targets[ch_id]
                            is_chapter_header = (page_idx == target_chapter["page_idx"] and line_text.startswith(ch_match.group(0).lstrip()))
                            is_section_header = len(line_text) < 50
                            if not is_chapter_header and not is_section_header:
                                exact_rect = _resolve_match_rects(page, item, ch_match.group(0), raw_id, "Chapter")
                                if not any(_any_rect_overlap(exact_rect, existing_ref["rect"]) for existing_ref in references if existing_ref["page_idx"] == page_idx):
                                    references.append({
                                        "page_idx": page_idx,
                                        "page": physical_page,
                                        "rect": exact_rect,
                                        "type": "chapter",
                                        "text": ch_match.group(0).strip(),
                                        "target_info": target_chapter,
                                    })

                    # 4. Box / Case references: "see Box 11-2", "Box 11-2", "in Box 2-3", "Box 11.2"
                    for box_match in re.finditer(r'\b(?:see|refer\s+to|in|look\s+at)?\s*(?:Box|Case)\s+(\d+(?:[\.\-–]\d+)?[a-z]?)', text_to_check, re.I):
                        raw_id = box_match.group(1)
                        norm_id = re.sub(r'[\-–]', '.', re.sub(r'[a-z]+$', '', raw_id))
                        box_id = f"box_{norm_id}"
                        if box_id in targets:
                            # Don't create a link on the target caption itself
                            if targets[box_id]["page_idx"] == page_idx and line_text.startswith(box_match.group(0).lstrip()) and _is_caption_line(curr_l, line_text):
                                continue
                            exact_rect = _resolve_match_rects(page, item, box_match.group(0), raw_id, "Box")
                            if not any(_any_rect_overlap(exact_rect, existing_ref["rect"]) for existing_ref in references if existing_ref["page_idx"] == page_idx):
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": exact_rect,
                                    "type": "box",
                                    "text": box_match.group(0).strip(),
                                    "target_info": targets[box_id],
                                })

                # Find page references: "page 42", "p. 42", "pp. 100-105"
                # Skip page references in bibliography/notes/references sections (external references)
                if not skip_external_refs:
                    for page_match in re.finditer(r'\b(?:page|p\.?|pages|pp\.?)\s+(\d+(?:\s*[-–]\s*\d+)?)', line_text, re.IGNORECASE):
                        page_ref = page_match.group(1).split()[0]  # Get first page number
                        try:
                            target_page = int(page_ref) - 1  # Convert to 0-indexed
                            if 0 <= target_page < len(doc):
                                exact_rect = _get_exact_match_rect(page, page_match.group(0), line_rect)
                                references.append({
                                    "page_idx": page_idx,
                                    "page": physical_page,
                                    "rect": exact_rect,
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


def _check_link_exists(doc, page_idx: int, rect, expected_page_idx: int | None = None) -> bool:
    """Check if a link already exists in the given area (and matches expected_page_idx if given)."""
    try:
        page = doc[page_idx]
        rect_list = rect if isinstance(rect, list) else [rect]
        for link in page.get_links():
            kind = link.get('kind')
            if kind in (fitz.LINK_URI, fitz.LINK_GOTO):
                link_rect = link.get('from')
                if link_rect:
                    lr = fitz.Rect(link_rect)
                    for r in rect_list:
                        if lr.intersects(fitz.Rect(r)):
                            if expected_page_idx is not None and kind == fitz.LINK_GOTO:
                                if link.get('page') == expected_page_idx:
                                    return True
                            else:
                                return True
    except Exception:
        pass
    return False


def _create_crossref_link(doc, ref_page_idx: int, ref_rect, target_page_idx: int, ref_text: str):
    """Create a link from a cross-reference to its target, replacing any stale overlapping GOTO link."""
    try:
        page = doc[ref_page_idx]
        rect_list = ref_rect if isinstance(ref_rect, list) else [ref_rect]
        existing_links = page.get_links()
        for r in rect_list:
            rr = fitz.Rect(r)
            for l in existing_links:
                if l.get("kind") == fitz.LINK_GOTO and l.get("from"):
                    if fitz.Rect(l["from"]).intersects(rr):
                        page.delete_link(l)
            page.insert_link({
                "kind": fitz.LINK_GOTO,
                "from": rr,
                "page": target_page_idx,
            })
        logger.debug(f"Created cross-reference link for '{ref_text}' to page {target_page_idx + 1}")
    except Exception as e:
        logger.error(f"Failed to create cross-reference link: {e}")
