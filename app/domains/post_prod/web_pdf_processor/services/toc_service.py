import fitz
import re
import collections
import os
import traceback
import unicodedata

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
        area1 = r1.get_area()
        area2 = r2.get_area()
        smaller_area = min(area1, area2)
        if smaller_area <= 0:
            return False
        return (intersection.get_area() / smaller_area) >= threshold
    except Exception:
        return False

def get_bookmarks_from_pdf(pdf_path: str) -> list:
    try:
        doc = fitz.open(pdf_path)
        toc = doc.get_toc()
        doc.close()
        return [{"level": item[0], "title": item[1], "page": item[2]} for item in toc]
    except Exception as e:
        return []

def update_bookmarks_in_pdf(pdf_path: str, bookmarks: list) -> bool:
    try:
        doc = fitz.open(pdf_path)
        sanitized_toc = []
        prev_level = 0
        for item in bookmarks:
            lvl = int(item.get('level', 1))
            title = str(item.get('title', '')).strip()
            page = int(item.get('page', 1))
            if not sanitized_toc:
                lvl = 1
            else:
                if lvl > prev_level + 1:
                    lvl = prev_level + 1
                if lvl < 1:
                    lvl = 1
            sanitized_toc.append([lvl, title, page])
            prev_level = lvl

        doc.set_toc(sanitized_toc)
        # Use clean save with garbage=0 to preserve all link annotations
        temp_path = pdf_path + ".tmp.pdf"
        doc.save(temp_path, incremental=False, garbage=0, deflate=True)
        doc.close()
        os.replace(temp_path, pdf_path)
        return True
    except Exception as e:
        print(f"Error updating bookmarks: {e}")
        return False

def roman_to_int(s):
    """Convert a Roman numeral string to integer, or return None if invalid."""
    s = s.lower().strip()
    vals = {'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100, 'd': 500, 'm': 1000}
    if not s or not all(c in vals for c in s):
        return None
    result = 0
    prev = 0
    for ch in reversed(s):
        cur = vals[ch]
        if cur < prev:
            result -= cur
        else:
            result += cur
        prev = cur
    return result if result > 0 else None

def build_page_map(doc, toc_pages=None):
    """
    Builds a dictionary mapping printed page numbers (arabic) to physical page indices
    by calculating the most common offset. Also adds Roman numeral front-matter pages.
    """
    if toc_pages is None:
        toc_pages = []
    offsets = []
    roman_map = {}  # roman numeral printed string / int -> physical idx
    
    for p_idx in range(len(doc)):
        page = doc[p_idx]
        text = page.get_text()
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        if not lines: continue
        
        candidates = lines[:3] + lines[-3:]
        for line in candidates:
            num = None
            if line.isdigit():
                num = int(line)
            else:
                match = re.search(r'\s+(\d+)$', line)
                if match:
                    num = int(match.group(1))
                else:
                    match = re.match(r'^(\d+)\s+', line)
                    if match:
                        num = int(match.group(1))
            
            if num is not None and 0 < num < 3000:
                offsets.append(p_idx - num)
            else:
                # Check for Roman numeral page labels in front matter
                # Supports bare roman numeral ('xiii') or running header/footer ('xiv Preface', 'Contributors xix')
                rv = roman_to_int(line)
                cand_rom_str = line.lower()
                if rv is None:
                    m_rom = re.match(r'^([ivxlcdm]+)\s+', line, re.IGNORECASE) or re.search(r'\s+([ivxlcdm]+)$', line, re.IGNORECASE)
                    if m_rom:
                        cand_rom_str = m_rom.group(1).lower()
                        rv = roman_to_int(cand_rom_str)

                if rv is not None and rv < 100 and p_idx < 60:
                    # Give priority to body front matter outside of TOC pages
                    if p_idx not in toc_pages:
                        roman_map[rv] = p_idx
                        roman_map[cand_rom_str] = p_idx
                    elif rv not in roman_map:
                        roman_map[rv] = p_idx
                        roman_map[cand_rom_str] = p_idx
                            
    page_map = {}
    if offsets:
        counter = collections.Counter(offsets)
        most_common_offset = counter.most_common(1)[0][0]
        
        for p_idx in range(len(doc)):
            printed_page = p_idx - most_common_offset
            if printed_page > 0:
                page_map[printed_page] = p_idx
    
    # Also store roman numeral mappings
    page_map['_roman'] = roman_map
    return page_map

def clean_toc_title(raw_title: str) -> str:
    """
    Cleans up Table of Contents title strings by removing printed dot leaders
    (e.g., '. . . . . . . .', '· · · · · ·', '_______') and excessive trailing punctuation.
    """
    if not raw_title:
        return ""
    # Strip soft hyphens, zero-width spaces, and control characters (e.g. \x07, \x00-\x1f)
    cleaned = raw_title.replace('\xad', '').replace('\u00ad', '').replace('\u200b', '')
    cleaned = re.sub(r'[\x00-\x1f\x7f]', ' ', cleaned)
    # Strip sequences of dots / bullets / underscores separated by spaces
    cleaned = re.sub(r'(\s*\.\s*){2,}', ' ', cleaned)
    cleaned = re.sub(r'(\s*·\s*){2,}', ' ', cleaned)
    cleaned = re.sub(r'(\s*_\s*){2,}', ' ', cleaned)
    # Strip space before colons (e.g. 'Conclusion : From' -> 'Conclusion: From')
    cleaned = re.sub(r'\s+:\s*', ': ', cleaned)
    # Strip any remaining trailing dots, dashes, or whitespace
    cleaned = re.sub(r'[\s\.\-_]+$', '', cleaned)
    return re.sub(r'\s+', ' ', cleaned).strip()

def get_page_visual_lines(page):
    """
    Reconstructs page lines in visual reading order (top-to-bottom, left-to-right)
    with column awareness: detects multi-column layouts (e.g. 2-column TOC pages)
    and processes columns sequentially to prevent left and right column lines from
    interleaving into garbled text. Also normalizes x0 relative to column base.
    """
    blocks = page.get_text("dict")['blocks']
    text_blocks = [b for b in blocks if b.get('type') == 0]
    if not text_blocks:
        return []

    # Detect multi-column layout by checking block boundaries relative to midline
    page_w = page.rect.width
    mid_x = page_w / 2.0
    left_blocks = [b for b in text_blocks if b['bbox'][2] <= mid_x + 15]
    right_blocks = [b for b in text_blocks if b['bbox'][0] >= mid_x - 15]
    full_width_blocks = [b for b in text_blocks if b not in left_blocks and b not in right_blocks]
    is_multi_col = len(left_blocks) >= 2 and len(right_blocks) >= 2

    def blocks_to_lines(b_list, col_offset=0):
        spans = []
        for b in b_list:
            for l in b['lines']:
                for s in l['spans']:
                    t = s['text'].strip()
                    if t:
                        spans.append({'text': t, 'bbox': s['bbox'], 'font': s['font'], 'size': s['size']})
        if not spans:
            return []
        spans.sort(key=lambda s: (s['bbox'][1], s['bbox'][0]))
        rows = []
        for s in spans:
            placed = False
            for row in rows:
                if abs(row['y'] - s['bbox'][1]) < 3.5:
                    row['spans'].append(s)
                    placed = True
                    break
            if not placed:
                rows.append({'y': s['bbox'][1], 'spans': [s]})

        lines = []
        for row in rows:
            row['spans'].sort(key=lambda s: s['bbox'][0])
            full_text = ' '.join(s['text'] for s in row['spans'])
            full_text = full_text.replace('\xa0', ' ').replace('\u2002', ' ').replace('\u2003', ' ')
            full_text = full_text.replace('\xad', '').replace('\u00ad', '').replace('\u200b', '')
            full_text = re.sub(r'[\x00-\x1f\x7f]', ' ', full_text)
            # Only collapse spaces between single capitalized letters if ALL text spans in the row were single characters
            # (e.g. tracking spaced words 'C H A P T E R', 'C O N T E N T S')
            letter_spans = [s['text'].strip() for s in row['spans'] if not s['text'].strip().isdigit()]
            if len(letter_spans) > 1 and all(len(t) == 1 and t.isupper() for t in letter_spans):
                full_text = re.sub(r'(?<=[A-Z]) (?=[A-Z])', '', full_text)
                full_text = re.sub(r'(?<=[A-Z])  (?=\d)', ' ', full_text)
            full_text = re.sub(r'\s+', ' ', full_text).strip()
            raw_x0 = min(s['bbox'][0] for s in row['spans'])
            norm_x0 = raw_x0 - col_offset
            y0 = min(s['bbox'][1] for s in row['spans'])
            x1 = max(s['bbox'][2] for s in row['spans'])
            y1 = max(s['bbox'][3] for s in row['spans'])
            lines.append({
                'text': full_text,
                'rect': fitz.Rect(raw_x0, y0, x1, y1),
                'x0': norm_x0,
                'y0': y0,
                'spans': row['spans']
            })
        return lines

    if is_multi_col:
        top_blocks = [b for b in full_width_blocks if b['bbox'][3] <= min(left_blocks[0]['bbox'][1], right_blocks[0]['bbox'][1]) + 10]
        bottom_blocks = [b for b in full_width_blocks if b not in top_blocks]
        left_blocks.sort(key=lambda b: b['bbox'][1])
        right_blocks.sort(key=lambda b: b['bbox'][1])
        left_base_x = min(b['bbox'][0] for b in left_blocks)
        right_base_x = min(b['bbox'][0] for b in right_blocks)
        return (blocks_to_lines(top_blocks, col_offset=0) +
                blocks_to_lines(left_blocks, col_offset=left_base_x) +
                blocks_to_lines(right_blocks, col_offset=right_base_x) +
                blocks_to_lines(bottom_blocks, col_offset=0))
    else:
        return blocks_to_lines(text_blocks, col_offset=0)

def get_toc_page_indices(doc) -> list[int]:
    """
    Identifies all physical page indices (0-based) that belong to the Table of Contents.
    Scans the first 15% of the book using visual line reconstruction and cleanly detects
    the contiguous multi-page TOC block starting at the very first Contents page.
    """
    scan_limit = max(10, int(len(doc) * 0.15))
    toc_pages = []
    in_contents = False

    for p_idx in range(scan_limit):
        page = doc[p_idx]
        lines_info = get_page_visual_lines(page)
        lines = [l['text'].strip() for l in lines_info if l['text'].strip()]
        if not lines:
            continue

        first_few_lines = lines[:4]
        # Match standalone 'contents', 'table of contents', 'brief contents', 'detailed contents'
        has_contents_header = any(
            re.match(r'^(contents|table of contents|brief contents|detailed contents)\b', l, re.IGNORECASE) or
            re.match(r'^[ivxlcdm\d]+\s+(contents|table of contents)\b', l, re.IGNORECASE) or
            re.match(r'^(contents|table of contents)\s+[ivxlcdm\d]+\b', l, re.IGNORECASE)
            for l in first_few_lines
        )

        dot_leaders = sum(1 for l in lines if re.search(r'(?:\s*[\.·_]){2,}\s*([ivxlcdm]+|\d+)$', l, re.IGNORECASE))
        standalone_digits = sum(1 for l in lines if re.match(r'^\d+$', l))
        toc_end_numbers = sum(1 for l in lines if re.search(r'\s+([ivxlcdm]+|\d+)$', l, re.IGNORECASE))
        numbered_sections = sum(1 for l in lines if re.match(r'^\d+(\.\d+)+\b', l))
        chapter_headings = sum(1 for l in lines if re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm]+)\b', l, re.IGNORECASE))

        is_toc_pattern = (
            dot_leaders >= 3 or
            (standalone_digits >= 3 and chapter_headings >= 1) or
            (standalone_digits >= 5) or
            (numbered_sections >= 3 and toc_end_numbers >= 3)
        )

        if not in_contents:
            if has_contents_header or is_toc_pattern:
                in_contents = True
                toc_pages.append(p_idx)
        else:
            # We are inside the Table of Contents. Continue across contiguous pages.
            if is_toc_pattern or has_contents_header or (toc_end_numbers >= 4):
                toc_pages.append(p_idx)
            else:
                break

    return toc_pages

ROMAN_NUMS_SET = {
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
    'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'
}

WORD_NUMBERS_SET = {
    'one', 'two', 'tree', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'tirteen', 'thirteen', 'fourteen', 'fifeen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-tree',
    'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight',
    'twenty-nine', 'thirty'
}

def get_toc_entry_level(title: str, is_roman: bool = False, prev_letter: str = None) -> int:
    """
    Determines logical hierarchical level based on standard book styling:
    - Numbered sections (e.g. 1.1 -> Level 2, 4.2.4 -> Level 3, 4.2.4.1 -> Level 4)
    - Chapters (CHAPTER 1 ..., 1 Introduction, 5 ‘Enlightenment’...) -> Level 1 (H1)
    - Front/back matter (Preface, Foreword, Contents, References, Index, Author/Subject Index,
      About the Author, Continuing Education Credits, Appendix, Glossary, Bibliography) -> Level 1 (H1)
    - Roman numeral sections (I. ..., II. ..., III. ...) -> Level 2 (H2)
    - Capital lettered subsections (A. ..., B. ..., C. ...) -> Level 3 (H3)
    - Numbered sub-items (1. ..., 2. ..., 3. ...) -> Level 4 (H4)
    - Lowercase lettered sub-items (a. ..., b. ..., c. ...) -> Level 5 (H5)
    """
    tl = title.lower().strip()
    ts = title.strip()

    # 1. Decimal numbered sections (e.g., 4.2 -> Level 2, 4.2.4 -> Level 3, 4.2.4.1 -> Level 4)
    # Must run FIRST so titles containing words like "indexing", "reference", "about" aren't misclassified as Level 1
    m_sec = re.match(r'^(\d+(?:\.\d+)+)', ts)
    if m_sec:
        return min(6, m_sec.group(1).count('.') + 1)

    # 2. Numbered chapters with word "CHAPTER" or "PART", or chapter-level features like "POETIC INTERRUPTION"
    if re.match(r'^(?:chapter\s+\d+|part\s+[ivxlcdm]+|poetic interruption\b)\b', tl):
        return 1

    # 3. Roman numerals at start of title: "I. Statutory...", "II. History...", "III. Purpose..." -> Level 2 (H2)
    m_rom = re.match(r'^([IVXLCDM]+)\.\s+', ts)
    if m_rom and m_rom.group(1).upper() in ROMAN_NUMS_SET:
        cand = m_rom.group(1).upper()
        # If cand is 'I' or 'V' and immediately follows alphabetical predecessor (e.g. H. -> I.), treat as letter (H3)
        if not (prev_letter and ((cand == 'I' and prev_letter in ['G', 'H']) or (cand == 'V' and prev_letter in ['T', 'U']))):
            return 2

    # 4. Capital letter subsections: "A. Overview", "B. Enforcement Actors", "C. Application..." -> Level 3 (H3)
    if re.match(r'^[A-Z]\.\s+', ts):
        return 3

    # 5. Numbered sub-items: "1. The Commissioner...", "2. Statutory Exemptions..." -> Level 4 (H4)
    if re.match(r'^\d+\.\s+', ts):
        return 4

    # 6. Lowercase letter subsections: "a. Something", "b. Something" -> Level 5 (H5)
    if re.match(r'^[a-z]\.\s+', ts):
        return 5

    # 7. Unpunctuated numbered chapters e.g. "1 Overview of Competition...", "2 Investigations...", "10 Nutrition...",
    # or spelled-out word chapters e.g. "One Meet...", "Two You Can...", "Tree Clear...", "Twenty-Two Te..."
    m_ch_num = re.match(r'^\d+\s+[^\s\d]', ts)
    if m_ch_num and not re.match(r'^\d+\.\d+', ts):
        return 1

    first_word = tl.split()[0] if tl.split() else ''
    if first_word in WORD_NUMBERS_SET:
        return 1

    # 8. Front matter / back matter
    if is_roman or any(tl.startswith(h) for h in [
        'preface', 'acknowledg', 'foreword', 'contents', 'table of contents', 'introduction',
        'table of cases', 'notes and references', 'annex', 'conclusion', 'afterword', 'epilogue',
        'list of abbreviations', 'abbreviations', 'list of figures', 'list of tables', 'list of illustrations'
    ]):
        return 1

    # Lettered appendix titles without dot (e.g. 'A Software Installation and Execution', 'B Selected Proofs')
    if re.match(r'^(?:appendix\b|[A-Z]\s+[A-Z][a-z])', ts):
        return 1

    # Standalone Notes / Endnotes
    if tl in ['notes', 'endnotes', 'chapter notes']:
        return 1

    # End-of-chapter items: 'references', 'reference', 'problems', 'exercises', 'review questions'
    # Default to Level 2 (child of chapter) if appearing inside a chapter.
    # Note: If it's a single standalone back-matter bibliography at the end of the entire book,
    # find_toc_entries adjusts it to Level 1.
    if any(re.search(rf'^{re.escape(k)}$', tl) for k in [
        'reference', 'references', 'problems', 'exercises', 'further reading', 'review questions'
    ]):
        return 2

    # Exact keyword or word-boundary matches for standalone back matter / end matter
    if any(re.search(rf'\b{re.escape(k)}\b', tl) for k in [
        'index', 'author index', 'subject index', 'name index', 'general index',
        'about the author', 'about the authors',
        'continuing education', 'education credits', 'education units',
        'appendix', 'appendices', 'glossary', 'bibliography', 'epilogue', 'postscript',
        'conclusion', 'afterword', 'endnotes'
    ]) or tl.startswith('about '):
        return 1

    return 2

def find_toc_entries(doc):
    """
    Extracts Table of Contents entries across all detected Table of Contents pages
    using visual reading order and robust pattern recognition.
    """
    toc_entries = []
    toc_page_indices = get_toc_page_indices(doc)

    # Detect if document has both Brief Contents and Detailed Contents
    brief_toc_pages = set()
    detailed_toc_pages = set()
    for p_i in toc_page_indices:
        pg = doc[p_i]
        full_text = pg.get_text().upper()
        if 'BRIEF CONTENTS' in full_text:
            brief_toc_pages.add(p_i)
        elif any(w in full_text for w in ['CONTENTS', 'TABLE OF CONTENTS', 'DETAILED CONTENTS']):
            detailed_toc_pages.add(p_i)
    has_brief_and_detailed = bool(brief_toc_pages and detailed_toc_pages)
    last_title = ""
    last_letter = None
    last_entry = None
    stop_author_re = re.compile(
        r'^(?:chapter\b|part\b|section\b|introduction\b|preface\b|foreword\b|acknowledg|conclusion\b|epilogue\b|afterword\b|appendix\b|index\b|notes\b|references\b|glossary\b|poetic interruption\b|\d{1,3}[\.\s]|\d+\s+[A-Za-z]|[IVXLCDM]+[\.\s])',
        re.IGNORECASE
    )
    
    for p_idx in toc_page_indices:
        page = doc[p_idx]
        lines = get_page_visual_lines(page)
        is_brief = p_idx in brief_toc_pages
            
        i = 0
        while i < len(lines):
            lt = lines[i]['text']
            rect = lines[i]['rect']
            x0 = lines[i]['x0']
            
            # Skip standalone headers or bare page folios
            cln_lt = re.sub(r'[\s•·\-\–—|]+', ' ', lt).strip().lower()
            is_top_running_header = (
                rect.y0 <= 55
                and not re.search(r'\s+([ivxlcdm]+|\d+)$', lt.strip(), re.IGNORECASE)
                and (
                    bool(re.match(r'^(?:[ivxlcdm]+)\s+[A-Za-z]', lt.strip(), re.IGNORECASE))
                    or bool(re.search(r'\b(?:contents|table of contents)\b', lt.strip(), re.IGNORECASE))
                )
            )
            if (
                cln_lt == 'contents'
                or re.match(r'^[ivxlcdm\d]+\s+contents$', cln_lt)
                or re.match(r'^contents\s+[ivxlcdm\d]+$', cln_lt)
                or (re.match(r'^[ivxlcdm\d]+$', cln_lt) and len(cln_lt) < 5)
                or re.search(r'A\s*Technical\s*Guide\s*to', lt, re.IGNORECASE)
                or is_top_running_header
            ):
                i += 1
                continue

            # SECTION / PART heading: e.g. 'SECTION I: FOUNDATIONS OF EVALUATION', 'PART I: FOUNDATION...', or 'I. IMPROVEMENT AND LEADERSHIP IN NURSING'
            # Also supports multi-line PART headings where title wraps to the next line with or without page number:
            # line 1: 'PART I: STORYING HISTORICAL EXPERIENCES'
            # line 2: 'OF PRECARITY 11'
            m_sec_header = re.match(r'^(?:(?:SECTION|PART)\s*([IVXLCDM\d]+[:\s\-–—]?)\s*(.*)|([IVXLCDM]+)\.\s+([A-Z\s,\-–—\(\)]+))$', lt, re.IGNORECASE)
            m_has_trailing_pg = bool(re.search(r'(?:(?:\s*[\.·_]){2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', lt, re.IGNORECASE))
            if m_sec_header and not m_has_trailing_pg:
                # Check if the PART heading wraps onto line i+1
                comb_sec_rect = rect
                clean_sec_title = clean_toc_title(lt)
                sec_printed_page = -1
                is_roman = False
                lines_consumed = 1

                # Assemble multi-line Part / Section titles (including centered / indented lines)
                while i + lines_consumed < len(lines):
                    nxt_obj = lines[i + lines_consumed]
                    nxt_line = nxt_obj['text'].strip()
                    nxt_rect = nxt_obj['rect']
                    if nxt_rect.y0 - comb_sec_rect.y1 > 25:
                        break
                    # Stop if next line is a new chapter/part/author heading
                    if re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm]+|section\b|\d{1,3}[\.\s]|[ivxlcdm]+\.\s+[A-Z]|appendix\b|index\b)', nxt_line, re.IGNORECASE):
                        break
                    m_nxt_pg = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', nxt_line, re.IGNORECASE)
                    if m_nxt_pg:
                        nxt_rem = m_nxt_pg.group(1).strip()
                        clean_sec_title = clean_toc_title(clean_sec_title + ' ' + nxt_rem)
                        pg_str = m_nxt_pg.group(2).strip()
                        is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                        sec_printed_page = roman_to_int(pg_str) if is_roman else int(pg_str)
                        comb_sec_rect |= nxt_rect
                        lines_consumed += 1
                        break
                    elif (nxt_rect.y0 - comb_sec_rect.y1 <= 25) and (abs(nxt_rect.x0 - x0) <= 80 or nxt_rect.x0 >= x0 - 15):
                        # Skip if it is an author line with credentials
                        if any(re.search(r'\b(PhD|EdD|ATC|LAT|MS|RDN|MD|PT|RRT|RCP|FAARC|MAACVPR)\b', s['text']) for s in nxt_obj.get('spans', [])):
                            break
                        clean_sec_title = clean_toc_title(clean_sec_title + ' ' + nxt_line)
                        comb_sec_rect |= nxt_rect
                        lines_consumed += 1
                        if lines_consumed >= 4:
                            break
                    else:
                        break

                last_title = clean_sec_title
                last_letter = None
                last_entry = {
                    'title': clean_sec_title,
                    'printed_page': sec_printed_page,
                    'source_page': p_idx,
                    'rect': comb_sec_rect,
                    'x0': x0,
                    'is_part': True,
                    'is_roman': is_roman,
                    'level': 1
                }
                toc_entries.append(last_entry)
                i += lines_consumed
                author_skip_count = 0
                while i < len(lines) and author_skip_count < 2:
                    nxt_author = lines[i]['text'].strip()
                    if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_author, re.IGNORECASE) and not stop_author_re.match(nxt_author):
                        i += 1
                        author_skip_count += 1
                    else:
                        break
                continue

            # Numbered chapter heading with or without dot:
            # e.g. '1. Evaluation and Advanced Nursing Practice: The Mandate' or '1 Shifting Landscapes, Shifting Footprints'
            # Only treat as a top-level chapter heading if NOT preceded by lettered (A., B.) or Roman outline sections (level >= 2)
            m_num_dot = re.match(r'^(\d{1,3})(?:[\.\s])\s*([A-Za-z].*)$', lt)
            if m_num_dot and not re.match(r'^\d+\.\d+', lt) and not ((not last_entry or not last_entry.get('is_part')) and (last_entry and last_entry.get('level', 1) >= 2)):
                ch_num_str = m_num_dot.group(1)
                rem_text = m_num_dot.group(2).strip()
                comb_rect = rect

                # Check if page number is inline at end of this line
                m_end_pg = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', rem_text, re.IGNORECASE)
                if m_end_pg:
                    clean_ch_title = clean_toc_title(ch_num_str + ' ' + m_end_pg.group(1).strip())
                    pg_str = m_end_pg.group(2)
                    is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                    pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                    lvl = 1  # Top-level chapter
                    last_title = clean_ch_title
                    last_letter = None
                    last_entry = {
                        'title': clean_ch_title,
                        'printed_page': pg,
                        'source_page': p_idx,
                        'rect': comb_rect,
                        'x0': x0,
                        'is_part': False,
                        'is_roman': is_roman,
                        'level': lvl
                    }
                    toc_entries.append(last_entry)
                    i += 1
                    # Skip author line(s)
                    author_skip_count = 0
                    while i < len(lines) and author_skip_count < 2:
                        nxt_t = lines[i]['text'].strip()
                        if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_t, re.IGNORECASE) and not stop_author_re.match(nxt_t):
                            i += 1
                            author_skip_count += 1
                        else:
                            break
                    continue
                else:
                    # Page number is on line i+1 (e.g. line 1: '1 Shifting Landscapes...', line 2: 'Lemmerman and Robert Geary 13')
                    if i + 1 < len(lines):
                        nxt_line = lines[i+1]['text'].strip()
                        nxt_rect = lines[i+1]['rect']
                        m_next_end_pg = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', nxt_line, re.IGNORECASE)
                        if m_next_end_pg and not re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm]+|section\b|\d{1,3}[\.\s])', nxt_line, re.IGNORECASE):
                            clean_ch_title = clean_toc_title(ch_num_str + ' ' + rem_text + ' ' + m_next_end_pg.group(1).strip())
                            pg_str = m_next_end_pg.group(2)
                            is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                            pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                            lvl = 1  # Top-level chapter
                            last_title = clean_ch_title
                            last_letter = None
                            last_entry = {
                                'title': clean_ch_title,
                                'printed_page': pg,
                                'source_page': p_idx,
                                'rect': comb_rect | nxt_rect,
                                'x0': x0,
                                'is_part': False,
                                'is_roman': is_roman,
                                'level': lvl
                            }
                            toc_entries.append(last_entry)
                            i += 2
                            # Skip author line(s)
                            author_skip_count = 0
                            while i < len(lines) and author_skip_count < 2:
                                nxt_author = lines[i]['text'].strip()
                                if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_author, re.IGNORECASE) and not stop_author_re.match(nxt_author):
                                    i += 1
                                    author_skip_count += 1
                                else:
                                    break
                            continue
            
            # 1. Standalone chapter header: '1 Introduction', '2 Preliminaries'
            m_stand = re.match(r'^(\d+)\s+([A-Z][a-zA-Z\s,\-]+)$', lt)
            if m_stand and not re.search(r'\d+$', m_stand.group(2)):
                ch_title = clean_toc_title(lt)
                next_pg = None
                for j in range(i+1, min(i+4, len(lines))):
                    m_sub = re.search(r'\s+(\d+)$', lines[j]['text'])
                    if m_sub:
                        next_pg = max(1, int(m_sub.group(1)) - 1)
                        break
                lvl = get_toc_entry_level(ch_title, is_roman=False)
                toc_entries.append({
                    'title': ch_title,
                    'printed_page': next_pg if next_pg else 1,
                    'source_page': p_idx,
                    'rect': rect,
                    'x0': x0,
                    'is_part': False,
                    'is_roman': False,
                    'level': lvl
                })
                i += 1
                continue

            # 2. Numbered section with page number: '1.1 Why a Systems View Is Needed 2'
            # Also handle multi-line numbered sections: line 1: '8.13 Closing Note...', line 2: 'Composition 230'
            m_sec_start = re.match(r'^(\d+(?:\.\d+)+)\s+(.*)$', lt)
            if m_sec_start:
                sec_no = m_sec_start.group(1)
                rem = m_sec_start.group(2).strip()
                m_sec_end = re.search(r'^(.*?)\s+([ivxlcdm]+|\d+)$', rem, re.IGNORECASE)
                if m_sec_end:
                    clean_title = clean_toc_title(sec_no + ' ' + m_sec_end.group(1).strip())
                    pg_str = m_sec_end.group(2)
                    is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                    pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                    lvl = get_toc_entry_level(clean_title, is_roman=is_roman)
                    toc_entries.append({
                        'title': clean_title,
                        'printed_page': pg,
                        'source_page': p_idx,
                        'rect': rect,
                        'x0': x0,
                        'is_part': False,
                        'is_roman': is_roman,
                        'level': lvl
                    })
                    i += 1
                    continue
                elif i + 1 < len(lines):
                    next_lt = lines[i+1]['text']
                    next_rect = lines[i+1]['rect']
                    m_next_end = re.search(r'^(.*?)\s+([ivxlcdm]+|\d+)$', next_lt, re.IGNORECASE)
                    if m_next_end:
                        clean_title = clean_toc_title(sec_no + ' ' + rem + ' ' + m_next_end.group(1).strip())
                        pg_str = m_next_end.group(2)
                        is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                        pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                        lvl = get_toc_entry_level(clean_title, is_roman=is_roman)
                        toc_entries.append({
                            'title': clean_title,
                            'printed_page': pg,
                            'source_page': p_idx,
                            'rect': rect | next_rect,
                            'x0': x0,
                            'is_part': False,
                            'is_roman': is_roman,
                            'level': lvl
                        })
                        i += 2
                        continue

            # 3. CHAPTER, PART, SECTION, or APPENDIX heading (supports single or multi-line)
            m_ch = re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm\d]+|section\s+[ivxlcdm\d]+|appendix(?:\s+[a-z\d]+)?|annex(?:\s+[a-z\d]+)?)\b(.*)$', lt, re.IGNORECASE)
            if m_ch:
                raw_prefix = m_ch.group(1).strip()
                if raw_prefix.upper().startswith(('CHAPTER', 'PART')):
                    ch_prefix = raw_prefix.upper()
                else:
                    ch_prefix = raw_prefix.title()
                rem = m_ch.group(2).strip()
                comb_rect = rect
                m_end_pg = re.search(r'^(.*?)(?:(?:\s*[\.·_]){2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', rem, re.IGNORECASE)
                if m_end_pg:
                    clean_title = clean_toc_title(ch_prefix + ' ' + m_end_pg.group(1).strip())
                    pg_str = m_end_pg.group(2)
                    is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                    found_page = roman_to_int(pg_str) if is_roman else int(pg_str)
                    i += 1
                else:
                    title_parts = [rem] if rem else []
                    j = i + 1
                    found_page = None
                    is_roman = False
                    while j < len(lines):
                        next_text = lines[j]['text'].strip()
                        next_rect = lines[j]['rect']
                        # Do NOT swallow the next Chapter, Part, Section, Poetic Interruption, or major heading
                        if re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm\d]+|section\s+[ivxlcdm\d]+|poetic interruption\b|appendix\b|index\b)', next_text, re.IGNORECASE):
                            break
                        if re.match(r'^\d+$', next_text):
                            found_page = int(next_text)
                            comb_rect |= next_rect
                            j += 1
                            break
                        m_end_next = re.search(r'^(.*?)(?:(?:\s*[\.·_]){2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', next_text, re.IGNORECASE)
                        if m_end_next:
                            title_parts.append(m_end_next.group(1).strip())
                            pg_str = m_end_next.group(2)
                            is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                            found_page = roman_to_int(pg_str) if is_roman else int(pg_str)
                            comb_rect |= next_rect
                            j += 1
                            break
                        title_parts.append(next_text)
                        comb_rect |= next_rect
                        j += 1
                        if j - i > 6: break
                    clean_title = clean_toc_title(ch_prefix + ' ' + ' '.join(title_parts))
                    i = j

                # Skip author / contributor line immediately following a chapter heading
                author_skip_count = 0
                while i < len(lines) and author_skip_count < 2:
                    nxt_author = lines[i]['text'].strip()
                    # If this line has no page number and isn't a new chapter/section/part heading
                    if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_author, re.IGNORECASE) and not stop_author_re.match(nxt_author):
                        i += 1
                        author_skip_count += 1
                    else:
                        break

                lvl = get_toc_entry_level(clean_title, is_roman=is_roman)
                is_part_entry = ch_prefix.upper().startswith(('PART', 'SECTION'))
                if is_part_entry:
                    lvl = 1
                toc_entries.append({
                    'title': clean_title,
                    'printed_page': found_page if found_page is not None else -1,
                    'source_page': p_idx,
                    'rect': comb_rect,
                    'x0': x0,
                    'is_part': is_part_entry,
                    'is_roman': is_roman,
                    'level': lvl
                })
                continue

            # 3.5. Bullet-separated sub-topics within a chapter block
            # e.g., 'Chapter Objectives 3 • Becoming an Athletic Trainer 5 • Interprofessional Approach...'
            if '•' in lt or (i + 1 < len(lines) and '•' in lines[i+1]['text']):
                # Accumulate consecutive visual lines that form this bullet-delimited paragraph
                bullet_lines = [lines[i]]
                k = i + 1
                while k < len(lines):
                    next_txt = lines[k]['text'].strip()
                    # If next line starts a new chapter, section, or part, stop
                    if re.match(r'^(chapter\s+\d+|part\s+[ivxlcdm]+|\d{1,3}\.|\d+\s+[A-Z])\b', next_txt, re.IGNORECASE):
                        break
                    # If this line has bullets, or is a continuation line of the bullet paragraph
                    if '•' in next_txt or ('•' in bullet_lines[-1]['text'] and not re.search(r'\s+([ivxlcdm]+|\d+)$', next_txt)):
                        bullet_lines.append(lines[k])
                        k += 1
                    elif bullet_lines and '•' in bullet_lines[-1]['text'] and re.search(r'\s+\d+$', next_txt):
                        # Final line of bullet paragraph ending with a page number
                        bullet_lines.append(lines[k])
                        k += 1
                        break
                    else:
                        break

                combined_bullet_text = ' '.join(bl['text'] for bl in bullet_lines)
                if '•' in combined_bullet_text:
                    y_min = min(bl['rect'].y0 for bl in bullet_lines)
                    y_max = max(bl['rect'].y1 for bl in bullet_lines)
                    page_words = page.get_text('words')
                    
                    def _get_sub_topic_rects(raw_title):
                        # Extract clean alpha-numeric words for precise matching
                        t_words = [w.lower().replace('\u2002', '').strip() for w in re.findall(r'[a-zA-Z0-9]+', raw_title)]
                        if not t_words:
                            return []
                        cands = [w for w in page_words if y_min - 4 <= w[1] <= y_max + 4]
                        matched = []
                        idx_w = 0
                        for w in cands:
                            # Tokenize hyphenated words like 'Evidence-Based' or 'Soft-Tissue' into subwords
                            w_sub = [sw.lower() for sw in re.findall(r'[a-zA-Z0-9]+', w[4])]
                            if not w_sub:
                                continue
                            if t_words[idx_w : idx_w + len(w_sub)] == w_sub:
                                matched.append(w)
                                idx_w += len(w_sub)
                                if idx_w == len(t_words):
                                    break
                            else:
                                if idx_w > 0 and t_words[:len(w_sub)] == w_sub:
                                    matched = [w]
                                    idx_w = len(w_sub)
                                else:
                                    matched = []
                                    idx_w = 0

                        if idx_w != len(t_words):
                            # Fallback: search_for on page within the vertical slice
                            clean_s = re.sub(r'[\xad\u00ad\u200b]', '', raw_title).strip()
                            s_cands = page.search_for(clean_s, clip=fitz.Rect(0, y_min - 4, page.rect.width, y_max + 4))
                            return s_cands if s_cands else []

                        # Group matched words by visual line to avoid multi-line union boxes
                        lines_dict = {}
                        for mw in matched:
                            found_line = False
                            for l_y in lines_dict:
                                if abs(mw[1] - l_y) < 4:
                                    lines_dict[l_y].append(mw)
                                    found_line = True
                                    break
                            if not found_line:
                                lines_dict[mw[1]] = [mw]

                        rects = []
                        for l_y, words_on_line in sorted(lines_dict.items(), key=lambda item: item[0]):
                            r = fitz.Rect(words_on_line[0][:4])
                            for w in words_on_line[1:]:
                                r |= fitz.Rect(w[:4])
                            rects.append(r)
                        return rects

                    raw_parts = combined_bullet_text.split('•')
                    for p_part in raw_parts:
                        clean_part = ' '.join(p_part.split()).replace('\u2002', '').strip()
                        m_part = re.search(r'^(.*?)\s+(\d+)$', clean_part)
                        if m_part:
                            sub_title = clean_part[:m_part.start(2)].strip()
                            sub_page = int(m_part.group(2))
                            # Clean up leading numbers or unwanted words if any
                            sub_title = re.sub(r'^\d+\s+', '', sub_title).strip()
                            # If first bullet part contains author names before 'Chapter Objectives', extract 'Chapter Objectives'
                            m_obj = re.search(r'\b(Chapter\s+Objectives|Objectives)\b', sub_title, re.IGNORECASE)
                            if m_obj:
                                sub_title = sub_title[m_obj.start():].strip()
                            if len(sub_title) >= 3:
                                sub_rects = _get_sub_topic_rects(sub_title)
                                for sub_r in sub_rects:
                                    toc_entries.append({
                                        'title': clean_toc_title(sub_title),
                                        'printed_page': sub_page,
                                        'source_page': p_idx,
                                        'rect': sub_r,
                                        'x0': sub_r.x0,
                                        'is_part': False,
                                        'is_roman': False,
                                        'level': 2
                                    })
                    i = k
                    continue

            # 4. Front/back matter or standard title with inline roman or arabic page number
            # e.g., "Preface   vii", "Acknowledgments   ix", "References   227", "Author Index   301",
            # or Roman section e.g. "I. Statutory ... 2", "A. Overview ... 2", "1. Regulated Conduct ... 8"
            # Also supports multi-line titles where title wraps across lines before page number:
            # line 1: "A. An Act for the Prevention and Suppression of Combinations"
            # line 2: "in Restraint of Trade . . . . . . . . . 12"
            # or unnumbered subheading wraps:
            # line 1: "Appropriate Interventions for Managing Stress"
            # line 2: "in Healthcare Providers 301"
            # Check if this line ends with a valid page number
            # Ignore false page numbers that are actually calendar years (e.g. '1996' in 'Act of 1996') exceeding doc length
            doc_len = len(doc)
            m_inline = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', lt, re.IGNORECASE)
            if m_inline and m_inline.group(2).isdigit() and int(m_inline.group(2)) > doc_len and 1900 <= int(m_inline.group(2)) <= 2099:
                m_inline = None

            # Check if this line is part of a multi-line wrapped title without a page number
            if not m_inline and i + 1 < len(lines) and not re.match(r'^(chapter|part|appendix|annex)\b', lt, re.IGNORECASE):
                # Look ahead up to 3 lines to assemble wrapped titles
                accum_title = lt.strip()
                accum_rect = rect
                consumed = 1
                found_wrap = False
                for k in range(1, 4):
                    if i + k >= len(lines):
                        break
                    nxt_line = lines[i+k]
                    nxt_lt = nxt_line['text'].strip()
                    nxt_rect = nxt_line['rect']
                    if re.match(r'^(chapter|part|appendix|annex)\b', nxt_lt, re.IGNORECASE):
                        break
                    y_dist = nxt_rect.y0 - accum_rect.y1
                    if y_dist > 25:
                        break
                    m_nxt_pg = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', nxt_lt, re.IGNORECASE)
                    if m_nxt_pg and m_nxt_pg.group(2).isdigit() and int(m_nxt_pg.group(2)) > doc_len and 1900 <= int(m_nxt_pg.group(2)) <= 2099:
                        m_nxt_pg = None

                    if m_nxt_pg:
                        accum_title = accum_title + ' ' + m_nxt_pg.group(1).strip()
                        accum_rect = accum_rect | nxt_rect
                        pg_str = m_nxt_pg.group(2).strip()
                        consumed = k + 1
                        found_wrap = True
                        break
                    else:
                        accum_title = accum_title + ' ' + nxt_lt
                        accum_rect = accum_rect | nxt_rect

                if found_wrap:
                    comb_title = clean_toc_title(accum_title)
                    allow_contents = bool(has_brief_and_detailed and is_brief and comb_title.lower() == 'contents')
                    if (comb_title.lower() != 'contents' or allow_contents) and len(comb_title) > 2:
                        is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                        pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                        lvl = get_toc_entry_level(comb_title, is_roman=is_roman, prev_letter=last_letter)
                        m_let = re.match(r'^([A-Z])\.\s+', comb_title)
                        if m_let:
                            last_letter = m_let.group(1)
                        elif re.match(r'^\d+\s+[A-Z]', comb_title) or re.match(r'^(?:chapter|part)\b', comb_title, re.IGNORECASE):
                            last_letter = None
                        last_title = comb_title
                        last_entry = {
                            'title': comb_title,
                            'printed_page': pg,
                            'source_page': p_idx,
                            'rect': accum_rect,
                            'x0': x0,
                            'is_part': False,
                            'is_roman': is_roman,
                            'level': lvl
                        }
                        toc_entries.append(last_entry)
                        i += consumed
                        # Skip author / contributor line if any
                        author_skip_count = 0
                        while i < len(lines) and author_skip_count < 2:
                            nxt_author = lines[i]['text'].strip()
                            if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_author, re.IGNORECASE) and not stop_author_re.match(nxt_author):
                                i += 1
                                author_skip_count += 1
                            else:
                                break
                        continue

            if m_inline and not re.match(r'^(chapter|part|appendix|annex)\b', lt, re.IGNORECASE):
                title = clean_toc_title(m_inline.group(1))
                pg_str = m_inline.group(2).strip()
                allow_contents = bool(has_brief_and_detailed and is_brief and title.lower() == 'contents')
                if (title.lower() != 'contents' or allow_contents) and len(title) > 2:
                    is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                    pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                    lvl = get_toc_entry_level(title, is_roman=is_roman, prev_letter=last_letter)
                    m_let = re.match(r'^([A-Z])\.\s+', title)
                    if m_let:
                        last_letter = m_let.group(1)
                    elif re.match(r'^\d+\s+[A-Z]', title) or re.match(r'^(?:chapter|part)\b', title, re.IGNORECASE):
                        last_letter = None
                    last_title = title
                    last_entry = {
                        'title': title,
                        'printed_page': pg,
                        'source_page': p_idx,
                        'rect': rect,
                        'x0': x0,
                        'is_part': False,
                        'is_roman': is_roman,
                        'level': lvl
                    }
                    toc_entries.append(last_entry)
                    i += 1
                    # Skip author / contributor line immediately following this entry
                    author_skip_count = 0
                    while i < len(lines) and author_skip_count < 2:
                        nxt_author = lines[i]['text'].strip()
                        if not re.search(r'\s+([ivxlcdm]+|\d+)$', nxt_author, re.IGNORECASE) and not stop_author_re.match(nxt_author):
                            i += 1
                            author_skip_count += 1
                        else:
                            break
                    continue
            elif not re.match(r'^(chapter|part|appendix|annex)\b', lt, re.IGNORECASE) and (
                re.match(r'^[IVXLCDM]+\.\s+', lt.strip())
                or re.match(r'^[A-Z]\.\s+', lt.strip())
                or re.match(r'^\d+\.\s+', lt.strip())
                or re.match(r'^[a-z]\.\s+', lt.strip())
            ):
                # Multi-line title starting with outline marker where page number is on next line
                if i + 1 < len(lines):
                    nxt_lt = lines[i+1]['text'].strip()
                    nxt_rect = lines[i+1]['rect']
                    m_nxt_end_pg = re.search(r'^(.*?)(?:\s*\.{2,}|\s{2,}|\s+)([ivxlcdm]+|\d+)$', nxt_lt, re.IGNORECASE)
                    if m_nxt_end_pg:
                        comb_title = lt.strip() + ' ' + m_nxt_end_pg.group(1).strip()
                        comb_title = clean_toc_title(comb_title)
                        pg_str = m_nxt_end_pg.group(2).strip()
                        is_roman = bool(re.match(r'^[ivxlcdm]+$', pg_str.lower()))
                        pg = roman_to_int(pg_str) if is_roman else int(pg_str)
                        lvl = get_toc_entry_level(comb_title, is_roman=is_roman, prev_letter=last_letter)
                        m_let = re.match(r'^([A-Z])\.\s+', comb_title)
                        if m_let:
                            last_letter = m_let.group(1)
                        elif re.match(r'^\d+\s+[A-Z]', comb_title) or re.match(r'^(?:chapter|part)\b', comb_title, re.IGNORECASE):
                            last_letter = None
                        last_title = comb_title
                        last_entry = {
                            'title': comb_title,
                            'printed_page': pg,
                            'source_page': p_idx,
                            'rect': rect | nxt_rect,
                            'x0': x0,
                            'is_part': False,
                            'is_roman': is_roman,
                            'level': lvl
                        }
                        toc_entries.append(last_entry)
                        i += 2
                        continue
            
            # 5. Chapter Sub-headings: 'Title' followed on next line by page digits
            if i + 1 < len(lines):
                next_text = lines[i+1]['text']
                next_rect = lines[i+1]['rect']
                if re.match(r'^\d+$', next_text) and not re.match(r'^\d+$', lt):
                    clean_t = clean_toc_title(lt)
                    if clean_t.lower() != 'contents' and len(clean_t) > 2:
                        lvl = get_toc_entry_level(clean_t, is_roman=False)
                        toc_entries.append({
                            'title': clean_t,
                            'printed_page': int(next_text),
                            'source_page': p_idx,
                            'rect': rect | next_rect,
                            'x0': x0,
                            'is_part': False,
                            'is_roman': False,
                            'level': lvl
                        })
                        i += 2
                        continue

            i += 1
            
    # Promote standalone end-of-book References / Bibliography / Endnotes to Level 1
    # If 'references' occurs multiple times or is followed by subsequent chapters,
    # it belongs inside the chapter (Level 2). But if it occurs only once as back matter
    # after the last chapter, promote it to Level 1.
    last_chapter_idx = -1
    for idx, e in enumerate(toc_entries):
        tl = e.get('title', '').lower()
        if re.match(r'^(?:chapter\s+\d+|part\s+[ivxlcdm]+|\d+\s+[^\s\d])\b', tl):
            last_chapter_idx = idx

    ref_indices = [idx for idx, e in enumerate(toc_entries) if e.get('title', '').strip().lower() in ['references', 'reference']]
    if len(ref_indices) == 1 and ref_indices[0] > last_chapter_idx:
        toc_entries[ref_indices[0]]['level'] = 1

        # In books where individual chapters start with an unnumbered section named "Introduction"
    # (e.g. Chapter 1 Children Around the World -> Introduction), Demote Introduction to Level 2
    # so it nests inside the Chapter instead of becoming an independent top-level root item.
    for idx, e in enumerate(toc_entries):
        if e.get('title', '').strip().lower() == 'introduction' and idx > 0:
            prev_t = toc_entries[idx - 1].get('title', '').strip().lower()
            if re.match(r'^(?:chapter\s+\d+|\d+\s+[^\s\d])\b', prev_t):
                e['level'] = 2

    # Find the index of the first chapter or part in TOC
    first_ch_idx = next((i for i, e in enumerate(toc_entries) if re.match(r'^(?:chapter\s+\d+|part\s+[ivxlcdm\d]+|section\s+[ivxlcdm\d]+|\d+\s+[^\s\d])\b', e.get('title', '').lower())), None)

    # In books with chapter headings, demote accidental Level 1 entries (such as subheadings
    # starting with 'Introduction to...', 'A Model...', or 'A Feminist...') to Level 2.
    # Also detect multi-level indentation columns for subheadings (e.g. Level 2 at x=0, Level 3 at x=18).
    # Note: Front matter with roman numerals (e.g. 'Preface', 'Reviewers') must stay Level 1.
    if first_ch_idx is not None:
        sub_entries = [
            e for e in toc_entries[first_ch_idx + 1:]
            if not e.get('is_roman')
            and not re.match(r'^(?:chapter\s+\d+|part\s+[ivxlcdm\d]+|section\s+[ivxlcdm\d]+|appendix)\b', e.get('title', '').strip(), re.IGNORECASE)
            and not re.match(r'^\d{1,3}[\.\s]+[A-Za-z]', e.get('title', '').strip())
            and not any(bm in e.get('title', '').lower() for bm in [
                'glossary', 'index', 'bibliography', 'references', 'preface', 'foreword',
                'acknowledg', 'reviewers', 'conclusion', 'notes', 'endnotes', 'abbreviation',
                'afterword', 'epilogue'
            ])
        ]
        # Any body sub-heading after chapter 1 that was marked Level 1 must be at least Level 2
        for s in sub_entries:
            if s.get('level', 1) == 1:
                s['level'] = 2

        # In books where subheadings are formatted in visual indentation columns
        # (e.g., Level 2 at x=0/base, Level 3 at x=18, or Level 2 at x=146, Level 3 at x=158),
        # detect prominent indentation columns and assign hierarchical levels automatically.
        has_explicit_sub_levels = any(e.get('level', 1) >= 3 for e in toc_entries)
        if not has_explicit_sub_levels and len(sub_entries) >= 15:
            raw_x0 = [s.get('x0', 0) for s in sub_entries]
            clusters = []
            for x in sorted(raw_x0):
                matched = False
                for c in clusters:
                    if abs(x - (sum(c) / len(c))) <= 6.0:
                        c.append(x)
                        matched = True
                        break
                if not matched:
                    clusters.append([x])

            valid_clusters = sorted([sum(c) / len(c) for c in clusters if len(c) >= 10])
            if len(valid_clusters) >= 2:
                for s in sub_entries:
                    sx = s.get('x0', 0)
                    for l_idx, center in enumerate(valid_clusters):
                        if abs(sx - center) <= 6.0:
                            s['level'] = l_idx + 2
                            break

    return toc_entries

def find_front_matter_page(doc, title: str, scan_limit: int = 50) -> int | None:
    """
    Finds the physical page index (0-based) for a front-matter or back-matter heading
    (e.g. 'Acknowledgements', 'Preface', 'Foreword', 'About the Author', 'Earn Continuing Education Credits')
    whose printed page has no folio digit printed on it (common in publishing for the first page of a section)
    or where the printed page is outside the main numbering scheme / unfolioed.
    """
    clean_target = re.sub(r'[^a-zA-Z0-9]', '', title).lower()
    if not clean_target:
        return None

    try:
        toc_indices = set(get_toc_page_indices(doc))
    except Exception:
        toc_indices = set()

    # Front-matter candidates (first scan_limit pages) and Back-matter candidates (last 35 pages)
    front_pages = [p for p in range(min(scan_limit, len(doc))) if p not in toc_indices]
    back_pages = [p for p in range(max(0, len(doc) - 35), len(doc)) if p not in toc_indices]
    
    # Priority order: if title looks like back matter, check back pages first
    tl = title.lower()
    is_back_candidate = any(k in tl for k in [
        'author', 'credit', 'continuing', 'education', 'advertis', 'subscribe',
        'companion', 'series', 'order', 'also by', 'index', 'about the'
    ])
    
    pages_to_check = (back_pages + front_pages) if is_back_candidate else (front_pages + back_pages)
    # Deduplicate while preserving order
    seen_pages = set()
    ordered_pages = []
    for p in pages_to_check:
        if p not in seen_pages:
            seen_pages.add(p)
            ordered_pages.append(p)

    # 1. Exact or heading match in blocks or lines
    for p_idx in ordered_pages:
        try:
            page = doc[p_idx]
            # Fast check: lines
            text = page.get_text('text')
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            for l in lines[:10]:
                clean_l = re.sub(r'[^a-zA-Z0-9]', '', l).lower()
                if clean_l and (clean_l == clean_target or clean_target in clean_l or clean_l in clean_target):
                    if len(clean_l) >= 6:
                        return p_idx

            # Check blocks
            blocks = page.get_text('blocks')
            for b in blocks:
                for l in b[4].split('\n'):
                    clean_l = re.sub(r'[^a-zA-Z0-9]', '', l).lower()
                    if clean_l and (clean_l == clean_target or clean_target in clean_l or clean_l in clean_target):
                        if len(clean_l) >= 6:
                            return p_idx
        except Exception:
            continue

    # 2. Key phrases in full page text for unfolioed back-matter promo/credits pages
    # e.g., 'Earn Continuing Education Credits/Units' -> check for 'continuing' and 'education'
    tokens = [w for w in re.findall(r'[a-zA-Z0-9]+', title.lower()) if len(w) > 3]
    if len(tokens) >= 2 and is_back_candidate:
        for p_idx in back_pages:
            try:
                p_txt = doc[p_idx].get_text().lower()
                if all(t in p_txt for t in tokens[:2]):
                    return p_idx
            except Exception:
                continue

    return None

def find_part_or_section_page(doc, title: str, start_page: int = 0, end_page: int = None, page_texts_cache: dict = None):
    """
    Finds the divider page in the PDF for a Part or Section title without a printed page number.
    Uses cached short-page texts or limits search to the window between previous
    and next known chapter pages to run in milliseconds even on 1,000+ page books.
    """
    if not title:
        return None

    is_part_sec = bool(re.search(r'^(?:(?:part|section|unit|module)\b|[ivxlcdm]+\.\s+)', title.strip(), re.I))
    if not is_part_sec:
        return None

    # Exclude Table of Contents pages from being matched as a divider page
    try:
        toc_indices = set(get_toc_page_indices(doc))
    except Exception:
        toc_indices = set()

    if end_page is None or end_page > len(doc):
        end_page = len(doc)
    start_page = max(0, start_page)

    clean_t = re.sub(r'[^a-zA-Z0-9]', '', title).lower()
    m_split = re.match(r'^(?:(?:part|section|unit|module)\s+)?([ivxlcdm\d]+)[:\.\s\-–—]+\s*(.*)$', title.strip(), re.I)
    p_num = None
    sub_title = title.strip()
    if m_split:
        p_num = m_split.group(1).lower()
        sub_title = m_split.group(2).strip()
    clean_sub = re.sub(r'[^a-zA-Z0-9]', '', sub_title).lower()

    for p_idx in range(start_page, end_page):
        if p_idx in toc_indices:
            continue
        try:
            if page_texts_cache is not None and p_idx in page_texts_cache:
                clean_page_text, raw_text = page_texts_cache[p_idx]
            else:
                page = doc[p_idx]
                raw_text = page.get_text()
                if not raw_text or len(raw_text.strip()) > 3000:
                    clean_page_text = ""
                else:
                    clean_page_text = re.sub(r'[^a-zA-Z0-9]', '', raw_text).lower()
                if page_texts_cache is not None:
                    page_texts_cache[p_idx] = (clean_page_text, raw_text)

            if clean_page_text:
                if clean_t in clean_page_text:
                    return p_idx
                if clean_sub and len(clean_sub) > 5 and clean_sub in clean_page_text:
                    if not p_num or re.search(rf'\b{p_num}\b', raw_text, re.I):
                        return p_idx
        except Exception:
            continue

    # 2. Strict label + number matching with subtitle keyword scoring
    # (e.g. 'PART V: THERAPEUTIC AND MEDICAL INTERVENTIONS' matching divider page where
    # 'PART V' and 'Therapeutic and Medical Interventions' appear)
    m = re.search(r'^(part|section|unit|module)\s+([ivxlcdm0-9]+)[:\s\-]*(.*)', title.strip(), re.I)
    if m:
        p_type, p_num, p_sub = m.group(1), m.group(2), m.group(3).strip()
        pattern = rf'\b{p_type}\s+{p_num}\b'
        sub_words = [re.sub(r'[^a-zA-Z0-9]', '', w).lower() for w in p_sub.split() if len(w) > 3]

        candidates = []
        for p_idx in range(start_page, end_page):
            if p_idx in toc_indices:
                continue
            try:
                page = doc[p_idx]
                text = page.get_text()
                if not text or len(text.strip()) > 3000:
                    continue
                if re.search(pattern, text, re.I):
                    clean_text = re.sub(r'[^a-zA-Z0-9]', '', text).lower()
                    match_score = sum(1 for w in sub_words if w in clean_text)
                    candidates.append((p_idx, match_score, len(text.strip())))
            except Exception:
                continue

        if candidates:
            # Sort by match_score desc, then shortest text length
            candidates.sort(key=lambda x: (-x[1], x[2]))
            return candidates[0][0]

    return None

def find_title_on_page(page, title):
    """
    Locates the title / chapter heading on a target page so that a back-link
    can be placed directly on the printed heading (linking back to the TOC).
    Searches exclusively in the top 40% of the page to avoid accidentally matching
    body text, footnotes, or sub-content.
    """
    words = title.split()
    if not words: return None
    
    page_height = page.rect.height
    header_clip = fitz.Rect(0, 0, page.rect.width, page_height * 0.55)
    norm_title = re.sub(r'\s+', ' ', title).strip()

    # 1. Direct search for full title (PyMuPDF search_for returns a rect list for multi-line wraps)
    rects = page.search_for(norm_title, clip=header_clip)
    if not rects:
        # Colons/dashes in TOC (e.g. "Title: Subtitle") often correspond to line breaks without colon on the page
        clean_colons = re.sub(r'[:\-\–—]', ' ', norm_title)
        clean_colons = re.sub(r'\s+', ' ', clean_colons).strip()
        rects = page.search_for(clean_colons, clip=header_clip)
    if not rects:
        # Try stripping leading label/prefix like 'Introduction: ', 'Postscript: ', 'CHAPTER 1. ', 'Appendix D '
        clean_title = re.sub(r'^(?:(?:chapter|part|section|appendix)\s+)?(?:\d+|[ivxlcdm]+|[a-z]\b)[\.:\s\-–—\x00-\x1f]+\s*', '', norm_title, flags=re.I).strip()
        if not clean_title or clean_title == norm_title:
            clean_title = re.sub(r'^(?:introduction|foreword|preface|postscript|appendix|contents):\s*', '', norm_title, flags=re.I).strip()
        if clean_title and clean_title != norm_title:
            rects = page.search_for(clean_title, clip=header_clip)

    if rects:
        # PyMuPDF search_for returns all occurrences on the page.
        # Group returned rects into contiguous vertical clusters (gap <= 20pt) representing distinct occurrences/wrapped headings.
        # This prevents unioning heading text with body text mentions lower on the page (e.g. Part II description).
        sorted_rects = sorted(rects, key=lambda r: (r.y0, r.x0))
        clusters = [[sorted_rects[0]]]
        for r in sorted_rects[1:]:
            gap = r.y0 - clusters[-1][-1].y1
            y0_diff = r.y0 - clusters[-1][-1].y0
            if -45 <= gap <= 45 and y0_diff >= 0:
                clusters[-1].append(r)
            else:
                clusters.append([r])

        cluster_rects = []
        for c in clusters:
            cr = fitz.Rect(c[0])
            for r in c[1:]:
                cr |= r
            cluster_rects.append(cr)

        # Pick the cluster with the largest font size (dominant heading style) near the top of the page
        def _score_cluster(cr):
            spans_in_cr = []
            for b in page.get_text('dict')['blocks']:
                if b.get('type') == 0:
                    for l in b['lines']:
                        for s in l['spans']:
                            if fitz.Rect(s['bbox']).intersects(cr):
                                spans_in_cr.append(s)
            max_size = max((s['size'] for s in spans_in_cr), default=0)
            is_top = cr.y0 < page_height * 0.35
            return (round(max_size, 1), is_top, -cr.y0)

        res = max(cluster_rects, key=_score_cluster)

        # Check if page has a separate CHAPTER / PART / SECTION label and number adjacent to this title
        # (e.g. 'CHAPTER\n1' graphic block placed next to the chapter title)
        ch_match = re.search(r'\b(chapter|part|section|appendix|unit)\s*([ivxlcdm0-9]+)\b', norm_title, re.I)
        label = ch_match.group(1).upper() if ch_match else None
        num = ch_match.group(2) if ch_match else None
        if not ch_match:
            m_num = re.match(r'^\s*([ivxlcdm0-9]+)\b', norm_title, re.I)
            if m_num:
                label = 'CHAPTER'
                num = m_num.group(1)

        if num and not res.is_empty:
            label_pats = [label, label.capitalize()] if label else ['CHAPTER', 'Chapter']
            cands = []
            for lp in label_pats:
                cands.extend(page.search_for(lp, clip=header_clip))
            cands.extend(page.search_for(num, clip=header_clip))
            int_to_word = {
                1: 'ONE', 2: 'TWO', 3: 'THREE', 4: 'FOUR', 5: 'FIVE',
                6: 'SIX', 7: 'SEVEN', 8: 'EIGHT', 9: 'NINE', 10: 'TEN',
                11: 'ELEVEN', 12: 'TWELVE', 13: 'THIRTEEN', 14: 'FOURTEEN',
                15: 'FIFTEEN', 16: 'SIXTEEN', 17: 'SEVENTEEN', 18: 'EIGHTEEN',
                19: 'NINETEEN', 20: 'TWENTY'
            }
            if num.isdigit() and int(num) in int_to_word:
                w = int_to_word[int(num)]
                cands.extend(page.search_for(w, clip=header_clip))
                cands.extend(page.search_for(w.capitalize(), clip=header_clip))
            for r_cand in cands:
                # Merge if placed to the left or above the main title within reasonable distance
                if (res.y0 - 80 <= r_cand.y1 <= res.y0 + 25) or (abs(r_cand.y0 - res.y0) < 40 and r_cand.x1 <= res.x0 + 40):
                    res |= r_cand

        return res

    # 2. Multi-line / Chapter block matching in header area
    # Unites CHAPTER {N} banner and wrapped chapter title lines, stopping before author credentials
    try:
        blocks = page.get_text('dict')['blocks']
        norm_title_nfkd = unicodedata.normalize('NFKD', norm_title)
        clean_title = re.sub(r'^(?:(?:chapter|part|section|appendix)\s+)?(?:\d+|[ivxlcdm]+|[a-z]\b)[\.:\s\-–—\x00-\x1f]+\s*', '', norm_title, flags=re.I).strip()
        clean_words = set(re.findall(r'[a-zA-Z0-9]+', clean_title.lower()))
        title_words = set(re.findall(r'[a-zA-Z0-9]+', norm_title_nfkd.lower()))
        m_ch_num = re.search(r'\b(?:CHAPTER|PART|SECTION|APPENDIX)?\s*(\d+|[IVXLCDM]+|[A-Z])\b', norm_title_nfkd, re.IGNORECASE)
        if m_ch_num:
            title_words.add(m_ch_num.group(1).lower())
        title_words.add('chapter')
        title_words.add('appendix')

        matching_rects = []
        for b in blocks:
            if b.get('bbox')[1] > page_height * 0.55:
                continue
            for l in b.get('lines', []):
                raw_line = ''.join(s['text'] for s in l.get('spans', []))
                raw_line = raw_line.replace('\xad', '').replace('\u00ad', '').replace('\u200b', '')
                raw_line = re.sub(r'[\x00-\x1f\x7f]', ' ', raw_line)
                line_text = unicodedata.normalize('NFKD', raw_line).strip()
                if not line_text:
                    continue
                line_words = set(re.findall(r'[a-zA-Z0-9]+', line_text.lower()))
                if not line_words:
                    continue
                if len(line_words) == 1 and len(line_text) == 1:
                    continue
                if any(re.search(r'\b(PhD|EdD|ATC|LAT|MS|RDN|MD|PT|RRT|RCP|FAARC|MAACVPR)\b', s['text']) for s in l.get('spans', [])):
                    continue
                if line_words and line_words.issubset(title_words):
                    spans = l.get('spans', [])
                    max_s = max((s.get('size', 0) for s in spans), default=0)
                    is_label = bool(re.match(r'^(?:chapter|part|section|appendix|postscript|introduction|preface|foreword|acknowledgements|contents|index)\b', line_text, re.I))
                    if max_s >= 12.0 or is_label or (clean_words and line_words.issubset(clean_words)):
                        matching_rects.append(fitz.Rect(l['bbox']))

        if matching_rects:
            # Sort by vertical position and merge only strictly contiguous lines (gap <= 45pt, allowing slight bbox overlap)
            # Never union across body text gaps!
            matching_rects.sort(key=lambda r: r.y0)
            res = fitz.Rect(matching_rects[0])
            for extra in matching_rects[1:]:
                if -45 <= (extra.y0 - res.y1) <= 45 and extra.y0 >= res.y0 and (res | extra).height <= 220.0:
                    res |= extra
                elif extra.y0 > res.y1 + 45:
                    # Gap between lines means body text or footnote -> stop merging!
                    break
            if res.height <= 220.0:
                return res
    except Exception:
        pass

    def _merge_contiguous(r_list):
        if not r_list: return None
        res = fitz.Rect(r_list[0])
        for extra in r_list[1:]:
            if -45 <= (extra.y0 - res.y1) <= 45 and extra.y0 >= res.y0 and abs(extra.x0 - res.x0) < 60:
                res |= extra
        return res

    # 1. Direct text search of full title in header area
    rects = page.search_for(norm_title, clip=header_clip)
    if rects:
        return _merge_contiguous(rects)

    # 2. Section / Part matching: e.g. 'SECTION I: FOUNDATIONS OF EVALUATION'
    m_sec = re.match(r'^(SECTION|PART)\s*([IVXLCDM\d]+)[:\s\.\-]?\s*(.*)$', norm_title, re.IGNORECASE)
    if m_sec:
        sec_type = m_sec.group(1).upper()
        sec_num = m_sec.group(2).rstrip(':.- ')
        sec_prefix = f"{sec_type} {sec_num}"
        sec_name = m_sec.group(3).strip()

        r_prefix = page.search_for(sec_prefix, clip=header_clip)
        r_name = []
        if sec_name:
            r_name = page.search_for(sec_name, clip=header_clip)
            if not r_name:
                w_sec = sec_name.split()
                if len(w_sec) >= 2:
                    r_name = page.search_for(' '.join(w_sec[:2]), clip=header_clip)

        if r_prefix or r_name:
            combined_sec = fitz.Rect()
            for r_item in (r_prefix or []) + (r_name or []):
                combined_sec |= r_item
            if not combined_sec.is_empty:
                return combined_sec

    # 3. Extract chapter number / title parts (e.g. 'CHAPTER 1 Athletic Training...', '17. Answers to Case Study Questions')
    m_ch = re.match(r'^(?:CHAPTER\s+)?(\d+)[\.\s\:\-–—]+(.*)$', norm_title, re.IGNORECASE)
    ch_num = m_ch.group(1) if m_ch else None
    ch_name = m_ch.group(2).strip().lstrip('.:-–— ') if m_ch else norm_title

    # Search for chapter name and number in header area
    r_name_list = []
    if ch_name and len(ch_name) > 2:
        r_name_list = page.search_for(ch_name, clip=header_clip)
        if not r_name_list:
            w = ch_name.split()
            if len(w) >= 3:
                r_name_list = page.search_for(' '.join(w[:3]), clip=header_clip)
            elif len(w) >= 2:
                r_name_list = page.search_for(' '.join(w[:2]), clip=header_clip)

    r_num_list = []
    if ch_num:
        for ch_pattern in [f'CHAPTER {ch_num}', f'CHAPTER{ch_num}', f'Chapter {ch_num}', ch_num]:
            matches = page.search_for(ch_pattern, clip=header_clip)
            if matches:
                r_num_list = matches
                break

    if r_name_list or r_num_list:
        combined_ch = fitz.Rect()
        for r_item in (r_name_list or []) + (r_num_list or []):
            combined_ch |= r_item
        if not combined_ch.is_empty:
            return combined_ch

    # 4. Large font heading detection in top 35% of page
    header_spans = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0 or b['bbox'][1] > page_height * 0.35: continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if len(t) > 0 and not re.search(r'\b(PhD|EdD|ATC|LAT|MS|RDN|MD|PT)\b', t):
                    header_spans.append(s)
    if header_spans:
        header_spans.sort(key=lambda s: s['size'], reverse=True)
        max_size = header_spans[0]['size']
        if max_size >= 16.0:
            title_spans = [s for s in header_spans if s['size'] >= max_size - 4.0]
            r = fitz.Rect(title_spans[0]['bbox'])
            for s in title_spans[1:]: r |= fitz.Rect(s['bbox'])
            return r

    return None

def find_subheading_on_page(page, title: str):
    """
    Locates a sub-topic / mini-content heading anywhere on a target page
    so that a back-link can be placed directly on the printed sub-heading back to the TOC.
    Differentiates true headings from body text mentions using font size, font weight,
    and line isolation so the link rect covers ONLY the actual subtitle.
    """
    if not title:
        return None
    norm_title = re.sub(r'\s+', ' ', title).strip()

    cands = page.search_for(norm_title)
    if not cands:
        clean_colons = re.sub(r'[:\-\–—]', ' ', norm_title)
        clean_colons = re.sub(r'\s+', ' ', clean_colons).strip()
        cands = page.search_for(clean_colons)
    if not cands:
        clean_hyphens = norm_title.replace('- ', '-').replace(' -', '-')
        cands = page.search_for(clean_hyphens)
    clean_title = re.sub(r'^(?:(?:chapter|part|section)\s+)?(?:\d+|[ivxlcdm]+)[\.:\s\-–—]+\s*', '', norm_title, flags=re.I).strip()
    if not cands and clean_title and clean_title != norm_title:
        cands = page.search_for(clean_title)
        if not cands:
            clean_hyphens = clean_title.replace('- ', '-').replace(' -', '-')
            cands = page.search_for(clean_hyphens)
    if not cands:
        search_base = clean_title if clean_title else norm_title
        words = [w for w in search_base.split() if len(w) > 2]
        if len(words) >= 3:
            cands = page.search_for(' '.join(words[:3]))
        elif len(words) >= 2:
            cands = page.search_for(' '.join(words[:2]))

    if not cands:
        return None

    best_size = None
    if len(cands) == 1:
        cand = fitz.Rect(cands[0])
        blocks = page.get_text('dict')['blocks']
        for b in blocks:
            if b.get('type') == 0:
                for l in b['lines']:
                    for s in l.get('spans', []):
                        if fitz.Rect(s['bbox']).intersects(cand):
                            best_size = s.get('size')
                            break
                    if best_size: break
            if best_size: break
    else:
        # Multiple candidates found (e.g. heading + body text mentions)
        # Score each candidate to identify the TRUE heading
        blocks = page.get_text('dict')['blocks']
        scored = []

        for r in cands:
            best_span = None
            is_standalone = False
            for b in blocks:
                if b.get('type') == 0:
                    for l in b['lines']:
                        line_txt = ''.join(s['text'] for s in l['spans']).strip()
                        for s in l['spans']:
                            sr = fitz.Rect(s['bbox'])
                            if sr.intersects(r) and (sr.intersect(r).get_area() / r.get_area() > 0.4):
                                best_span = s
                                if line_txt.lower() == norm_title.lower() or abs(len(line_txt) - len(norm_title)) < 10:
                                    is_standalone = True
                                break
                        if best_span: break
                if best_span: break

            font_size = best_span['size'] if best_span else 9.0
            font_name = best_span['font'].lower() if best_span else ''
            is_bold = any(k in font_name for k in ['bold', 'medium', 'heavy', 'black', 'semibold'])

            score = font_size
            if is_bold:
                score += 5.0
            if is_standalone:
                score += 10.0

            scored.append((score, r, is_standalone, font_size))

        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best_r, best_standalone, best_size = scored[0]

        # For multi-line subheadings, only merge candidate rects that have matching heading score/size
        # (NEVER merge body-text occurrences of the words into the heading link!)
        cand = fitz.Rect(best_r)
        for score, r, is_stand, size in scored[1:]:
            if score < best_score - 4.0 or size < best_size - 1.5:
                continue
            same_line = abs(r.y0 - cand.y0) < 8 and (abs(r.x0 - cand.x1) < 30 or abs(cand.x0 - r.x1) < 30)
            vertical_dist = r.y0 - cand.y1
            wrap_line = -15 <= vertical_dist < 25 and (abs(r.x0 - cand.x0) < 100 or abs(r.x1 - cand.x1) < 100)
            if same_line or wrap_line:
                cand |= r

    # Expand candidate to include continuation lines strictly belonging to multi-line headings
    target_words = set(re.findall(r'[a-zA-Z0-9]+', (clean_title or norm_title).lower()))
    if len(target_words) >= 2:
        blocks = page.get_text('dict')['blocks']
        for b in blocks:
            if b.get('type') == 0:
                for l in b['lines']:
                    lr = fitz.Rect(l['bbox'])
                    l_txt = ''.join(s['text'] for s in l['spans']).strip()
                    l_words = set(re.findall(r'[a-zA-Z0-9]+', l_txt.lower()))
                    if not l_words or not l_words.issubset(target_words):
                        continue
                    l_font_size = max((s.get('size', 0) for s in l.get('spans', [])), default=0)
                    if 'best_size' in locals() and best_size and l_font_size < best_size - 1.5:
                        continue
                    if lr.intersects(cand) or (0 <= lr.y0 - cand.y1 < 25 and abs(lr.x0 - cand.x0) < 100):
                        if (cand | lr).height <= 140.0:
                            cand |= lr

    if cand is not None and cand.height > 140.0:
        cand = fitz.Rect(cand.x0, cand.y0, cand.x1, min(cand.y1, cand.y0 + 120.0))

    return cand

def determine_hierarchy(toc_entries):
    """
    Use x0 indentation to determine levels for TOC entries.
    """
    if not toc_entries:
        return []
        
    # Find base x0
    x0_values = [e['x0'] for e in toc_entries if e.get('x0') is not None]
    if not x0_values:
        for e in toc_entries:
            e['level'] = 1
        return toc_entries
        
    # Tolerance for x0 matching
    tolerance = 15.0
    
    # Sort distinct x0s
    distinct_x0 = []
    for x in sorted(x0_values):
        if not distinct_x0 or x - distinct_x0[-1] > tolerance:
            distinct_x0.append(x)
            
    for entry in toc_entries:
        if entry.get('x0') is None:
            entry['level'] = 1
            continue
            
        # find matching level
        level = 1
        for i, bx in enumerate(distinct_x0):
            if abs(entry['x0'] - bx) <= tolerance:
                level = 1 + i
                break
        entry['level'] = level
        
    # Ensure parts are at least level 1 and push children down if necessary
    for entry in toc_entries:
        if entry.get('is_part'):
            entry['level'] = 1
            
        title_lower = entry.get('title', '').lower()
        if (
            entry.get('is_roman')
            or title_lower.startswith('chapter')
            or re.match(r'^\d+\s+[A-Z]', entry.get('title', ''))
            or any(bm in title_lower for bm in [
                'preface', 'acknowledgment', 'acknowledgement', 'foreword', 'introduction',
                'conclusion', 'about the author', 'about the authors', 'index', 'bibliography',
                'references', 'glossary', 'appendix', 'appendices', 'notes', 'list of abbreviations', 'abbreviations'
            ])
        ):
            entry['level'] = 1
            
    return toc_entries

def _detect_front_and_back_matter(doc, contents_page_1based: int) -> tuple[list, list | None]:
    """
    Detect standard front-matter pages (Half Title, About the Authors/Editors, Title Page,
    Copyright Page, Dedication) occurring before the Table of Contents, as well as
    Back Cover at the end of the document.
    """
    fm_items = []
    seen_kinds = set()

    # 1. Detect if Page 1 is an actual Cover image
    p1 = doc[0]
    p1_txt = p1.get_text('text').strip()
    p1_imgs = p1.get_images()
    has_cover_image = len(p1_imgs) > 0 and len(p1_txt.splitlines()) <= 2

    # Detect Document Title from metadata or copyright page
    doc_title = None
    m_title = (doc.metadata.get('title') or '').strip()
    if m_title and len(m_title) > 3 and not any(m_title.lower().endswith(ext) for ext in ['.indd', '.pdf', '.zip']):
        doc_title = m_title

    # Check copyright page for full title with subtitle (e.g. 'Wolf Land: The Lost Wolves...')
    if not doc_title:
        for p_idx in range(min(contents_page_1based - 1, 8)):
            txt = doc[p_idx].get_text('text')
            if 'copyright' in txt.lower():
                for l in txt.splitlines():
                    l_s = l.strip()
                    if l_s.lower().startswith('title:'):
                        t_val = l_s.split(':', 1)[1].strip()
                        t_val = t_val.split('/', 1)[0].strip()
                        if len(t_val) > 3:
                            doc_title = t_val
                            break
                if not doc_title:
                    for l in txt.splitlines():
                        l_s = l.strip()
                        if ':' in l_s and not any(k in l_s.lower() for k in [
                            'http', 'doi', 'published', 'isbn', 'representative', 'author', 'typeset', 'editor', 'compositor',
                            'publisher', 'permissions', 'coordinator', 'address', 'rights', 'reserved'
                        ]) and len(l_s) < 80:
                            doc_title = l_s
                            break
                if doc_title:
                    break

    # 2. Classify front-matter pages before Contents
    page_kinds = {}
    start_idx = 1 if has_cover_image else 0
    for p_idx in range(start_idx, contents_page_1based - 1):
        p = doc[p_idx]
        txt = p.get_text('text').strip()
        txt_lower = txt.lower()
        lines = [l.strip() for l in txt.splitlines() if l.strip()]

        if not lines:
            continue

        # Skip promotional / online access registration pages
        if any(k in txt_lower for k in ['register now', 'quick access', 'online access', 'scan here']):
            continue

        # Copyright Page
        if any(k in txt_lower for k in ['copyright', 'isbn', 'all rights reserved', 'british library', 'cip data', 'first published', 'library of congress']):
            if 'Copyright Page' not in seen_kinds:
                page_kinds[p_idx + 1] = 'Copyright Page'
                seen_kinds.add('Copyright Page')
                continue

        # Dedication
        if 'dedicate' in txt_lower or 'dedication' in txt_lower or (len(lines) <= 6 and txt_lower.startswith('for ') and any(w in txt_lower for w in ['memory', 'love', 'family', 'parents', 'wolves', 'children'])):
            if 'Dedication' not in seen_kinds:
                page_kinds[p_idx + 1] = 'Dedication'
                seen_kinds.add('Dedication')
                continue

        # About the Authors / Editors (author biographies before title page)
        has_bio_indicators = (
            bool(re.search(r'\b(is an? (?:associate |assistant |adjunct )?professor|she is|he is|received (?:her|his)|holds a|earned (?:her|his)|serves as|graduated from)\b', txt_lower))
            or 'about the author' in txt_lower or 'about the editor' in txt_lower
            or (len(lines) >= 15 and bool(re.search(r'\b(professor|dean|faculty|scholarship)\b', txt_lower)) and bool(re.search(r'\b(phd|dnp|md|rn|faan)\b', txt_lower)))
        )
        if has_bio_indicators:
            is_editor = 'editor' in txt_lower or 'editors' in txt_lower
            bio_label = 'About the Editors' if is_editor else 'About the Author'
            if 'About the Author' not in seen_kinds and 'About the Editors' not in seen_kinds:
                page_kinds[p_idx + 1] = bio_label
                seen_kinds.add(bio_label)
                continue

        # Half Title (usually page 1, 2, or 3 with 1-4 lines containing just book title without author / publisher)
        has_author_or_editor = bool(re.search(r'\b(author|editor|editors|by|edited by|phd|md|rn|faan|cne)\b', txt_lower))
        has_publisher = any(k in txt_lower for k in ['press', 'publishing', 'publishers', 'books', 'springer', 'pelagic', 'routledge', 'oxford', 'wiley', 'elsevier'])
        
        if p_idx < 4 and len(lines) <= 4 and not has_author_or_editor and not has_publisher:
            if 'Half Title' not in seen_kinds:
                page_kinds[p_idx + 1] = 'Half Title'
                seen_kinds.add('Half Title')
                if not doc_title and lines:
                    doc_title = lines[0]
                continue

        # Title Page (contains book title along with author(s), editor(s), or publisher)
        if has_author_or_editor or has_publisher or len(lines) >= 3:
            if 'Title Page' not in seen_kinds:
                page_kinds[p_idx + 1] = 'Title Page'
                seen_kinds.add('Title Page')
                if not doc_title and lines:
                    doc_title = lines[0]
                continue

    sorted_pages = sorted(page_kinds.keys())

    # Build front matter list: start with Cover if an image cover exists, otherwise start with Half Title
    if has_cover_image:
        fm_items.append([1, doc_title or 'Cover', 1])

    for p_num in sorted_pages:
        fm_items.append([1, page_kinds[p_num], p_num])

    # Check Back Cover on last page
    back_cover = None
    last_idx = len(doc) - 1
    if last_idx >= contents_page_1based:
        last_p = doc[last_idx]
        last_txt = last_p.get_text('text').strip()
        if len(last_p.get_images()) > 0 and len(last_txt) < 50:
            back_cover = [1, 'Back Cover', last_idx + 1]
        elif 'back cover' in last_txt.lower() and len(last_txt) < 200:
            back_cover = [1, 'Back Cover', last_idx + 1]

    return fm_items, back_cover


def generate_bookmarks_for_pdf(pdf_path: str, output_path: str = None, include_subheadings: bool = True) -> dict:
    """
    Parses TOC, links it, and generates hierarchical bookmarks.
    """
    if not output_path:
        output_path = pdf_path.replace('.pdf', '_bookmarked.pdf')
        
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        return {"success": False, "error": f"Error opening PDF: {e}"}
        
    toc_pages = get_toc_page_indices(doc)
    page_map = build_page_map(doc, toc_pages)
    toc_entries = find_toc_entries(doc)
    
    linked_count = 0
    back_links_count = 0
    
    for entry in toc_entries:
        p_page = entry['printed_page']
        
        target_p_idx = None
        if entry.get('is_roman'):
            roman_map = page_map.get('_roman', {})
            cand = roman_map.get(p_page) if p_page in roman_map else (roman_map.get(str(p_page).lower()) if isinstance(p_page, str) else None)
            if cand in toc_pages:
                cand = None
            if cand is None and isinstance(p_page, int):
                for offset in range(-2, 3):
                    cand_p = p_page + offset
                    if cand_p in roman_map and roman_map[cand_p] not in toc_pages:
                        cand = roman_map[cand_p] - offset
                        break
            if cand is not None and cand not in toc_pages:
                target_p_idx = cand
            else:
                # Fallback: search for front-matter heading page in the PDF body (outside TOC)
                target_p_idx = find_front_matter_page(doc, entry.get('title', ''))
        elif p_page > 0:
            target_p_idx = page_map.get(p_page)
            if target_p_idx is None:
                for offset in range(-3, 4):
                    if (p_page + offset) in page_map:
                        target_p_idx = page_map[p_page + offset] - offset
                        break
            if target_p_idx is None:
                # Fallback: search for unfolioed heading page in the PDF body
                target_p_idx = find_front_matter_page(doc, entry.get('title', ''))
                        
        if target_p_idx is not None and 0 <= target_p_idx < len(doc):
            entry['linked'] = True
            entry['target_p_idx'] = target_p_idx
            linked_count += 1
            
            source_page = doc[entry['source_page']]
            link = {
                "kind": fitz.LINK_GOTO,
                "from": entry['rect'],
                "page": target_p_idx
            }
            source_page.insert_link(link)
            
            # Only create one-way links in generate_bookmarks_for_pdf.
            # Two-way back links are exclusively handled in create_links_in_pdf if user selects 'two_way'.
                
    # Fix unlinked entries (e.g. Parts / Sections with no page numbers)
    page_texts_cache = {}
    for idx, entry in enumerate(toc_entries):
        if not entry.get('linked') and entry.get('printed_page') == -1:
            # 1. First attempt: Search for the actual section divider page in the book body
            # We search between the previous known chapter page and next known chapter page if possible
            prev_p = 0
            for prev_entry in reversed(toc_entries[:idx]):
                if prev_entry.get('linked') and prev_entry.get('target_p_idx') is not None:
                    prev_p = max(0, prev_entry['target_p_idx'] - 5)
                    break
            next_p = len(doc)
            for next_entry in toc_entries[idx+1:]:
                if next_entry.get('linked') and next_entry.get('target_p_idx') is not None:
                    next_p = min(len(doc), next_entry['target_p_idx'] + 2)
                    break

            sec_p_idx = find_part_or_section_page(doc, entry.get('title', ''), start_page=prev_p, end_page=next_p, page_texts_cache=page_texts_cache)
            if sec_p_idx is None and (prev_p > 0 or next_p < len(doc)):
                # Broaden search to entire doc if localized window didn't match
                sec_p_idx = find_part_or_section_page(doc, entry.get('title', ''), start_page=0, end_page=len(doc), page_texts_cache=page_texts_cache)

            if sec_p_idx is not None and 0 <= sec_p_idx < len(doc):
                entry['linked'] = True
                entry['target_p_idx'] = sec_p_idx
                linked_count += 1
                source_page = doc[entry['source_page']]
                source_page.insert_link({
                    "kind": fitz.LINK_GOTO,
                    "from": entry['rect'],
                    "page": sec_p_idx
                })
                continue

            # 2. Fallback: find next linked entry
            for nxt in toc_entries[idx+1:]:
                if nxt.get('linked'):
                    entry['linked'] = True
                    entry['target_p_idx'] = nxt.get('target_p_idx')
                    break

    # ---------------------------------------------------------
    # Build Hierarchical Bookmarks directly from TOC
    # ---------------------------------------------------------
    final_bookmarks = []

    # When document contains both Brief Contents and Detailed Contents,
    # build bookmarks from the Detailed Contents (plus a single Brief Contents bookmark)
    # so we avoid duplicate chapter bookmarks at the root.
    bookmark_entries = toc_entries
    brief_pages = set()
    detailed_pages = set()
    for p_i in toc_pages:
        pg = doc[p_i]
        hb = [b for b in pg.get_text('blocks') if b[1] < pg.rect.height * 0.18 and b[4].strip()]
        hdr = ' '.join(b[4].strip() for b in hb).upper()
        if 'BRIEF CONTENTS' in hdr:
            brief_pages.add(p_i)
        elif 'CONTENTS' in hdr or 'DETAILED CONTENTS' in hdr:
            detailed_pages.add(p_i)

    has_both_contents = bool(brief_pages and detailed_pages)

    # Find the Contents / Table of Contents page
    contents_page_1based = None
    if has_both_contents:
        # In books with both Brief Contents and Detailed Contents,
        # "Contents" bookmark should take the user directly to the primary Detailed Contents page
        contents_page_1based = min(detailed_pages) + 1
    elif toc_entries:
        # First check the source page where TOC entries were detected
        contents_page_1based = toc_entries[0].get('source_page', 0) + 1

    if not contents_page_1based:
        for p_num in range(min(15, len(doc))):
            t_low = doc[p_num].get_text("text").lower()
            if "contents" in t_low or "table of contents" in t_low:
                contents_page_1based = p_num + 1
                break

    # Add detected Front Matter bookmarks (Document Title, Half Title, Title Page, Copyright Page)
    # For front-matter detection range, look before the very first TOC page (Brief or Detailed)
    earliest_toc_page_1based = min(toc_pages) + 1 if toc_pages else contents_page_1based
    if earliest_toc_page_1based:
        fm_items, back_cover = _detect_front_and_back_matter(doc, earliest_toc_page_1based)
        final_bookmarks.extend(fm_items)
        if not has_both_contents:
            final_bookmarks.append([1, "Contents", contents_page_1based])
    else:
        back_cover = None

    if has_both_contents:
        # Check if detailed_pages has entries
        detailed_entries = [e for e in toc_entries if e.get('source_page') in detailed_pages]
        if detailed_entries:
            # Add a single Brief Contents bookmark pointing to the start of Brief Contents
            brief_entry = {'title': 'Brief Contents', 'linked': True, 'target_p_idx': min(brief_pages), 'level': 1}
            filtered_bm_entries = [brief_entry]
            # Add a single Contents bookmark pointing to the start of Detailed Contents
            contents_entry = {'title': 'Contents', 'linked': True, 'target_p_idx': min(detailed_pages), 'level': 1}
            filtered_bm_entries.append(contents_entry)
            # Filter out redundant 'Brief Contents' or 'Contents' items inside detailed_entries
            for e in detailed_entries:
                tl = e.get('title', '').strip().lower()
                if tl not in ['brief contents', 'contents', 'table of contents']:
                    filtered_bm_entries.append(e)
            bookmark_entries = filtered_bm_entries

    # If document has PART or SECTION divider headers, nest subsequent chapters and their subheadings under them
    has_parts = any(e.get('is_part') for e in bookmark_entries)
    in_part = False

    for entry in bookmark_entries:
        if entry.get('linked') and entry.get('target_p_idx') is not None:
            level = entry.get('level', 1)
            if has_parts:
                if entry.get('is_part'):
                    level = 1
                    in_part = True
                elif in_part:
                    tl = entry.get('title', '').strip().lower()
                    # Check if this is a chapter-specific appendix (e.g. 'Appendix 2-A', 'Appendix 3 -A', 'Appendix 8-B')
                    # which belongs inside the part/chapter and should NOT reset in_part
                    is_chapter_appendix = bool(re.search(r'appendix\s+\d+', tl))
                    # Only reset in_part for true standalone back matter at the end of the entire book
                    # (e.g. Appendix, Glossary, References, Index, About the Authors, Contributors)
                    standalone_bm_keywords = [
                        'appendix', 'appendices', 'glossary', 'references', 'reference', 'bibliography',
                        'index', 'author index', 'subject index', 'name index', 'general index',
                        'conclusion', 'notes', 'foreword', 'list of abbreviations',
                        'about the author', 'about the authors', 'contributors'
                    ]
                    if not is_chapter_appendix and entry.get('level', 1) == 1 and (
                        any(bm in tl for bm in standalone_bm_keywords) or tl.startswith('about ')
                    ):
                        in_part = False
                        level = 1
                    else:
                        level = level + 1
            target_page_1based = entry['target_p_idx'] + 1
            if final_bookmarks and final_bookmarks[-1][1] == entry['title'] and final_bookmarks[-1][2] == target_page_1based:
                continue
            final_bookmarks.append([level, entry['title'], target_page_1based])

    if back_cover:
        final_bookmarks.append(back_cover)

    # Sanitize hierarchy to ensure standard PDF outline compliance (no missing parent levels)
    sanitized_bookmarks = []
    prev_level = 0
    for level, title, page in final_bookmarks:
        if not sanitized_bookmarks:
            level = 1
        else:
            if level > prev_level + 1:
                level = prev_level + 1
        sanitized_bookmarks.append([level, title, page])
        prev_level = level
        
    if sanitized_bookmarks:
        doc.set_toc(sanitized_bookmarks)

    # Save to temp file first, then replace original (avoids "save to original must be incremental" error)
    temp_path = output_path.replace('.pdf', '_temp.pdf')
    doc.save(temp_path, incremental=False, garbage=0, deflate=True)
    doc.close()
    os.replace(temp_path, output_path)
    
    return {
        "success": True,
        "toc_entries_detected": len(toc_entries),
        "linked_count": linked_count,
        "bookmarks_generated": len(sanitized_bookmarks),
        "output_path": output_path
    }

def create_links_in_pdf(pdf_path: str, link_type: str = "one_way", analyze_only: bool = False, preserve_existing: bool = True) -> dict:
    """
    Creates internal links based on the Table of Contents.
    link_type: "one_way" (TOC -> Chapter) or "two_way" (TOC <-> Chapter)
    preserve_existing: If True, keeps existing valid links and only generates missing links.
    Returns a dict with link counts.
    """
    doc = fitz.open(pdf_path)
    toc_pages = get_toc_page_indices(doc)
    page_map = build_page_map(doc, toc_pages)
    toc_entries = find_toc_entries(doc)
    
    one_way_count = 0
    two_way_count = 0
    existing_preserved_count = 0
    link_details = []
    
    toc_page_set = set(toc_pages)
    
    # Detect if document has both Brief Contents and Detailed Contents
    brief_toc_pages = set()
    detailed_toc_pages = set()
    for p_i in toc_pages:
        pg = doc[p_i]
        h = pg.rect.height
        hb = [b for b in pg.get_text('blocks') if b[1] < h * 0.18 and b[4].strip()]
        hdr = ' '.join(b[4].strip() for b in hb).upper()
        if 'BRIEF CONTENTS' in hdr:
            brief_toc_pages.add(p_i)
        elif 'CONTENTS' in hdr or 'TABLE OF CONTENTS' in hdr or 'DETAILED CONTENTS' in hdr:
            detailed_toc_pages.add(p_i)
    has_brief_and_detailed = bool(brief_toc_pages and detailed_toc_pages)
    primary_toc_pages = detailed_toc_pages if has_brief_and_detailed else toc_page_set

    if not analyze_only and not preserve_existing:
        # Clean up existing TOC links and back-links ONLY if not preserving existing
        for p_idx in range(len(doc)):
            p = doc[p_idx]
            for l in p.get_links():
                if l.get('kind') == fitz.LINK_GOTO:
                    # On body pages: delete backlinks to TOC
                    if p_idx not in toc_page_set and l.get('page') in toc_page_set:
                        p.delete_link(l)
                    # On TOC pages: delete outgoing links to body pages
                    elif p_idx in toc_page_set and l.get('page') not in toc_page_set:
                        p.delete_link(l)
    
    for idx, entry in enumerate(toc_entries):
        target_page_idx = None

        if entry['printed_page'] == -1:
            # Unnumbered entries (e.g. Part / Section divider pages)
            prev_p = 0
            for prev_entry in reversed(toc_entries[:idx]):
                if prev_entry.get('printed_page') != -1:
                    pp = prev_entry['printed_page']
                    p_idx = page_map.get('_roman', {}).get(pp) if prev_entry.get('is_roman') else page_map.get(pp)
                    if p_idx is not None:
                        prev_p = p_idx
                        break
            next_p = len(doc)
            for next_entry in toc_entries[idx+1:]:
                if next_entry.get('printed_page') != -1:
                    pp = next_entry['printed_page']
                    p_idx = page_map.get('_roman', {}).get(pp) if next_entry.get('is_roman') else page_map.get(pp)
                    if p_idx is not None:
                        next_p = p_idx
                        break

            search_start = min(prev_p, next_p)
            search_end = max(prev_p, next_p) + 2
            sec_p_idx = find_part_or_section_page(doc, entry.get('title', ''), start_page=search_start, end_page=search_end)
            if sec_p_idx is None:
                sec_p_idx = find_part_or_section_page(doc, entry.get('title', ''), start_page=0, end_page=len(doc))

            if sec_p_idx is not None and 0 <= sec_p_idx < len(doc):
                target_page_idx = sec_p_idx
            else:
                continue
        elif entry.get('is_roman'):
            # Handle Roman numeral pages (front-matter like Introduction v, Preface iii)
            printed_page = entry['printed_page']
            roman_map = page_map.get('_roman', {})
            cand = roman_map.get(printed_page) if printed_page in roman_map else (roman_map.get(str(printed_page).lower()) if isinstance(printed_page, str) else None)
            if cand is not None and cand not in toc_page_set:
                target_page_idx = cand
            else:
                # Fallback: search for front-matter heading page in the PDF body (outside TOC)
                target_page_idx = find_front_matter_page(doc, entry.get('title', ''))
                if target_page_idx is None:
                    continue
        elif entry['printed_page'] not in page_map:
            # Fallback: search for unfolioed heading page in the PDF body
            target_page_idx = find_front_matter_page(doc, entry.get('title', ''))
            if target_page_idx is None:
                continue
        else:
            target_page_idx = page_map[entry['printed_page']]
        source_page_idx = entry['source_page']
        rect = entry['rect']
        
        # 1. One-way link: TOC -> Chapter
        source_page = doc[source_page_idx]
        
        # Check if one-way link already exists (same target page)
        existing_links = source_page.get_links()
        old_one_way = [l for l in existing_links if l.get('kind') == fitz.LINK_GOTO and l.get('page') == target_page_idx]
        one_way_exists = len(old_one_way) > 0
        
        if not analyze_only:
            # If preserve_existing is requested and a link already exists, keep it as-is!
            if preserve_existing and one_way_exists:
                existing_preserved_count += 1
            else:
                for old_link in old_one_way:
                    source_page.delete_link(old_link)
                link_dict = {
                    "kind": fitz.LINK_GOTO,
                    "from": rect,
                    "page": target_page_idx
                }
                source_page.insert_link(link_dict)
        one_way_count += 1
        link_details.append({
            "type": "one_way",
            "title": entry['title'],
            "source_page": source_page_idx + 1,
            "target_page": target_page_idx + 1,
            "is_linked": one_way_exists or not analyze_only,
            "preserved": preserve_existing and one_way_exists
        })
        
        # 2. Two-way link: Chapter -> TOC
        target_page = doc[target_page_idx]
        existing_target_links = target_page.get_links()
        old_two_way = [l for l in existing_target_links if l.get('kind') == fitz.LINK_GOTO and l.get('page') == source_page_idx]
        two_way_exists = len(old_two_way) > 0

        # For cross-TOC links (e.g. Brief Contents <-> Detailed Contents), do not create back-links
        # (they are already linked directly to each other via one-way links)
        is_cross_toc = (
            has_brief_and_detailed
            and (
                (source_page_idx in brief_toc_pages and target_page_idx in detailed_toc_pages)
                or (source_page_idx in detailed_toc_pages and target_page_idx in brief_toc_pages)
            )
        )

        # When both Brief Contents and Detailed Contents exist, chapters and front-matter headings
        # should link back to the main/detailed Contents, NOT to Brief Contents.
        skip_brief_backlink = (has_brief_and_detailed and source_page_idx in brief_toc_pages)

        if link_type == "two_way" and not is_cross_toc and not skip_brief_backlink:
                word_num_pat = r'(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-[a-z]+)?)'
                is_chapter_title = bool(re.match(
                    rf'^(?:chapter\s+\d+|part\s+[ivxlcdm]+|appendix\b|index\b|conclusion\b|notes\b|bibliography\b|references\b|glossary\b|\d{{1,3}}[\.\s]|[IVXLCDM]+\.\s+[A-Z]|{word_num_pat}\b)',
                    entry['title'].strip(),
                    re.IGNORECASE
                ))
                # Distinguish major Chapter/Part/Section headings vs in-body subheadings
                is_subheading = not is_chapter_title and (
                    entry.get('level', 1) > 1
                    or bool(re.match(r'^\d+\.\d+', entry['title'].strip()))
                )
                is_major_heading = not is_subheading and (
                    entry.get('level') == 1
                    or entry.get('is_part', False)
                    or is_chapter_title
                    or bool(re.match(r'^(?:chapter|part|section|appendix|introduction|conclusion|bibliography|filmography|index|preface|foreword|glossary|\d+(?:\.|\s+)[A-Za-z]|[ivxlcdm]+[\.\s])\b', entry['title'].strip(), re.IGNORECASE))
                )
                
                if is_major_heading:
                    title_rect = find_title_on_page(target_page, entry['title'])
                    if title_rect is None:
                        title_rect = find_subheading_on_page(target_page, entry['title'])
                else:
                    # Sub-heading (e.g. "Values and Moral Reasoning", "1.1 History of Radar", "1.2.1 Frequency Band")
                    # Use find_subheading_on_page FIRST to avoid matching entire header text blocks!
                    title_rect = find_subheading_on_page(target_page, entry['title'])
                    if title_rect is None:
                        title_rect = find_title_on_page(target_page, entry['title'])

                # Height cap: a single sub-heading backlink rect shouldn't cover whole page column
                if not is_major_heading and title_rect is not None and title_rect.height > 140.0:
                    title_rect = fitz.Rect(title_rect.x0, title_rect.y0, title_rect.x1, min(title_rect.y1, title_rect.y0 + 120.0))
                elif is_major_heading and title_rect is not None and title_rect.height > 260.0:
                    title_rect = fitz.Rect(title_rect.x0, title_rect.y0, title_rect.x1, min(title_rect.y1, title_rect.y0 + 220.0))

                if title_rect is not None:
                    if is_major_heading:
                        # Expand title_rect upwards to also cover any associated CHAPTER / PART / SECTION banner
                        # (including spaced tracking letters 'C H A P T E R', 'PART I', 'CHAPTER ONE', or standalone numbers/labels)
                        # placed directly above the title within the top 50% of the page
                        target_page_height = target_page.rect.height
                        word_num_pat = r'(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)'
                        banner_re = re.compile(
                            rf'^(?:'
                            rf'c\s*h\s*a\s*p\s*t\s*e\s*r(?:\s*.*)?'
                            rf'|p\s*a\s*r\s*t(?:\s*.*)?'
                            rf'|s\s*e\s*c\s*t\s*i\s*o\s*n(?:\s*.*)?'
                            rf'|appendix(?:\s*.*)?'
                            rf'|{word_num_pat}'
                            rf'|(?:\d{{1,3}}\s*)+'
                            rf'|[ivxlcdm]+'
                            rf')$',
                            re.IGNORECASE
                        )
                        banner_cands = []
                        for b in target_page.get_text('blocks'):
                            if b[1] < title_rect.y0 and b[1] < target_page_height * 0.50:
                                b_text = re.sub(r'\s+', ' ', b[4]).strip()
                                clean_b = re.sub(r'(?<=\b[A-Za-z])\s+(?=[A-Za-z]\b)', '', b_text)
                                if banner_re.match(clean_b) or banner_re.match(b_text):
                                    banner_cands.append(b)

                        # Sort by bottom edge descending (closest to title first)
                        banner_cands.sort(key=lambda b: b[3], reverse=True)
                        curr_top = title_rect.y0
                        for b in banner_cands:
                            gap = curr_top - b[3]
                            if -45 <= gap <= 95:
                                title_rect = fitz.Rect(title_rect) | fitz.Rect(b[:4])
                                curr_top = min(curr_top, b[1])

                        # Also check if title_rect matched only the top banner (e.g. 'CHAPTER FIVE'),
                        # and expand downwards to include the chapter title below the banner
                        t_txt = re.sub(r'(?<=\b[A-Za-z])\s+(?=[A-Za-z]\b)', '', target_page.get_text('text', clip=title_rect).strip())
                        is_banner_only = bool(banner_re.match(t_txt))
                        if is_banner_only:
                            title_clean = re.sub(rf'^(?:chapter|part|section|appendix|{word_num_pat}|\d+)\s*', '', entry['title'].strip(), flags=re.I).strip()
                            title_clean_no_dots = re.sub(r'^[\s\.\u2026]+', '', title_clean).strip()
                            title_words = set(re.findall(r'[a-zA-Z0-9]+', title_clean_no_dots.lower()))
                            if title_words:
                                down_cands = []
                                for b in target_page.get_text('blocks'):
                                    if b[1] >= title_rect.y1 - 15 and b[1] < target_page_height * 0.55:
                                        b_words = set(re.findall(r'[a-zA-Z0-9]+', b[4].lower()))
                                        if b_words and b_words.issubset(title_words):
                                            down_cands.append(b)
                                down_cands.sort(key=lambda b: b[1])
                                curr_bottom = title_rect.y1
                                for b in down_cands:
                                    gap = b[1] - curr_bottom
                                    if -15 <= gap <= 95 and (title_rect | fitz.Rect(b[:4])).height <= 220.0:
                                        title_rect |= fitz.Rect(b[:4])
                                        curr_bottom = max(curr_bottom, b[3])
                    # Check if this chapter title already has a two-way link to a TOC page
                    # (we preserve the link to the first/primary TOC instead of overwriting it).
                    already_linked_to_prior_toc = False
                    for l in existing_target_links:
                        if l.get('kind') == fitz.LINK_GOTO:
                            l_rect = l.get('from')
                            # Check overlap with title_rect
                            if l_rect and _rects_overlap(l_rect, title_rect, threshold=0.5):
                                target_p = l.get('page')
                                # If it points to an earlier TOC page (or already points to a TOC), don't overwrite with a later TOC
                                if target_p is not None and target_p <= source_page_idx and target_p != source_page_idx:
                                    already_linked_to_prior_toc = True
                                    break

                    if not already_linked_to_prior_toc:
                        if not analyze_only:
                            # Remove any existing back link on this target page pointing to this TOC page
                            for old_l in old_two_way:
                                target_page.delete_link(old_l)
                            # Remove any existing back link overlapping this title rect before inserting
                            for l in existing_target_links:
                                if l.get('kind') == fitz.LINK_GOTO and _rects_overlap(l.get('from'), title_rect, threshold=0.5):
                                    target_page.delete_link(l)
                            back_link_dict = {
                                "kind": fitz.LINK_GOTO,
                                "from": title_rect,
                                "page": source_page_idx
                            }
                            target_page.insert_link(back_link_dict)
                            existing_target_links.append(back_link_dict)
                        two_way_count += 1
                        link_details.append({
                            "type": "two_way",
                            "title": entry['title'],
                            "source_page": target_page_idx + 1,
                            "target_page": source_page_idx + 1,
                            "is_linked": two_way_exists or not analyze_only,
                            "rect_found": True
                        })
                    else:
                        # Title already linked to the primary (earlier) TOC section
                        two_way_count += 1
                        link_details.append({
                            "type": "two_way",
                            "title": entry['title'],
                            "source_page": target_page_idx + 1,
                            "target_page": source_page_idx + 1,
                            "is_linked": True,
                            "rect_found": True,
                            "skipped_duplicate": True
                        })
                else:
                    # If no text found on target page, keep as one-way link
                    link_details.append({
                        "type": "two_way",
                        "title": entry['title'],
                        "source_page": target_page_idx + 1,
                        "target_page": source_page_idx + 1,
                        "is_linked": False,
                        "rect_found": False
                    })
        elif link_type == "one_way" and not analyze_only:
            # Remove any existing back links from chapter page back to TOC
            for old_link in old_two_way:
                target_page.delete_link(old_link)
    if not analyze_only and (one_way_count > 0 or two_way_count > 0):
        temp_path = pdf_path.replace('.pdf', '_temp.pdf')
        doc.save(temp_path, incremental=False, garbage=0, deflate=True)
        doc.close()
        import os
        os.replace(temp_path, pdf_path)
    else:
        doc.close()
        
    return {
        "one_way_links": one_way_count,
        "two_way_links": two_way_count,
        "existing_preserved": existing_preserved_count,
        "total_links": one_way_count + two_way_count,
        "details": link_details
    }

def create_manual_link(pdf_path: str, source_page: int, target_page: int) -> bool:
    """
    Manually creates a link at the top of source_page pointing to target_page.
    Pages are 1-indexed.
    """
    doc = fitz.open(pdf_path)
    source_idx = source_page - 1
    target_idx = target_page - 1
    
    if source_idx < 0 or source_idx >= len(doc) or target_idx < 0 or target_idx >= len(doc):
        doc.close()
        return False
        
    page = doc[source_idx]
    
    # Create a generic link at the top 15% of the page
    rect = fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.15)
    link_dict = {
        "kind": fitz.LINK_GOTO,
        "from": rect,
        "page": target_idx
    }
    page.insert_link(link_dict)
    
    temp_path = pdf_path.replace('.pdf', '_temp.pdf')
    doc.save(temp_path, incremental=False, garbage=0, deflate=True)
    doc.close()
    
    import os
    os.replace(temp_path, pdf_path)
    return True
