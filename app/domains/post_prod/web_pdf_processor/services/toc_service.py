import fitz
import re
import collections
import os
import traceback

def build_page_map(doc):
    """
    Builds a dictionary mapping printed page numbers to physical page indices
    by calculating the most common offset across the entire document.
    """
    offsets = []
    for p_idx in range(len(doc)):
        page = doc[p_idx]
        blocks = page.get_text("blocks")
        if not blocks: continue
        
        candidates = []
        if blocks:
            candidates.append(blocks[0][4].strip())
            candidates.append(blocks[-1][4].strip())
            
        for text in candidates:
            cleaned = text.split('\n')
            for line in cleaned:
                line = line.strip()
                if not line: continue
                
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
                            
                if num is not None:
                    offsets.append(p_idx - num)
                    
    page_map = {}
    if offsets:
        counter = collections.Counter(offsets)
        most_common_offset = counter.most_common(1)[0][0]
        
        for p_idx in range(len(doc)):
            printed_page = p_idx - most_common_offset
            if printed_page > 0:
                page_map[printed_page] = p_idx
                
    return page_map

def find_toc_entries(doc):
    """
    Scans the first 15% of the book for the Contents section and extracts TOC entries.
    """
    toc_entries = []
    scan_limit = max(5, int(len(doc) * 0.15))
    in_contents = False
    
    for p_idx in range(scan_limit):
        page = doc[p_idx]
        text_lines = page.get_text("dict")['blocks']
        
        toc_matches_on_page = 0
        page_lines = []
        for b in text_lines:
            if b['type'] != 0: continue
            for l in b['lines']:
                line_text = "".join(s['text'] for s in l['spans']).strip()
                rect = fitz.Rect(l['bbox'])
                if line_text:
                    page_lines.append((line_text, rect))
                    
        i = 0
        while i < len(page_lines):
            line_text, rect = page_lines[i]
            
            if not in_contents:
                if re.match(r'^contents\b', line_text.lower()):
                    in_contents = True
            
            if in_contents:
                if ".indd" in line_text.lower():
                    i += 1
                    continue
                
                if line_text.lower() in ('introduction', 'preface', 'foreword', 'prologue'):
                    if len(toc_entries) > 5:
                        in_contents = False
                        break
                        
                # 1. Part Title handling
                if re.match(r'^part\s+[ivxlcdm]+$', line_text.lower().strip()):
                    if i + 1 < len(page_lines):
                        nxt_text, nxt_rect = page_lines[i+1]
                        title = f"{line_text.strip()} {nxt_text.strip()}"
                        title = re.sub(r'\s+', ' ', title).strip()
                        
                        # See if next text has page number
                        match = re.search(r'^(.*?)\s+(?:[\.\s]+)?(\d+)$', nxt_text)
                        if match:
                            title = f"{line_text.strip()} {match.group(1).replace('. ', '').strip()}"
                            printed_page = int(match.group(2))
                            toc_entries.append({
                                'title': title,
                                'printed_page': printed_page,
                                'source_page': p_idx,
                                'rect': rect | nxt_rect,
                                'x0': rect.x0,
                                'is_part': True,
                                'linked': False
                            })
                            i += 2
                            continue
                        else:
                            # Part title spans two lines, maybe page number is on the 3rd line?
                            if i + 2 < len(page_lines):
                                nn_text, nn_rect = page_lines[i+2]
                                nn_match = re.search(r'^(.*?)\s+(?:[\.\s]+)?(\d+)$', nn_text)
                                if nn_match or nn_text.strip().isdigit():
                                    if nn_match:
                                        title = f"{title} {nn_match.group(1).replace('. ', '').strip()}"
                                        printed_page = int(nn_match.group(2))
                                    else:
                                        printed_page = int(nn_text.strip())
                                    toc_entries.append({
                                        'title': title,
                                        'printed_page': printed_page,
                                        'source_page': p_idx,
                                        'rect': rect | nxt_rect | nn_rect,
                                        'x0': rect.x0,
                                        'is_part': True,
                                        'linked': False
                                    })
                                    i += 3
                                    continue
                            
                            # If no page number found, just add it as a part with no page number
                            toc_entries.append({
                                'title': title,
                                'printed_page': -1,
                                'source_page': p_idx,
                                'rect': rect | nxt_rect,
                                'x0': rect.x0,
                                'is_part': True,
                                'linked': False
                            })
                            i += 2
                            continue
                
                # 2. Check for Chapter X on one line and Title on next
                if i + 1 < len(page_lines) and re.match(r'^chapter\s+\d+$', line_text.lower().strip()):
                    nxt_text, nxt_rect = page_lines[i+1]
                    nxt_match = re.search(r'^(.*?)\s+(?:[\.\s]+)?(\d+)$', nxt_text)
                    if nxt_match:
                        title = f"{line_text.strip()} {nxt_match.group(1).replace('. ', '').strip()}"
                        title = re.sub(r'\s+', ' ', title).strip()
                        printed_page = int(nxt_match.group(2))
                        toc_entries.append({
                            'title': title,
                            'printed_page': printed_page,
                            'source_page': p_idx,
                            'rect': rect | nxt_rect,
                            'x0': rect.x0,
                            'is_part': False,
                            'linked': False
                        })
                        toc_matches_on_page += 1
                        i += 2
                        continue
                        
                # 3. Normal line with page number at the end
                match = re.search(r'^(.*?)\s+(?:[\.\s]+)?(\d+)$', line_text)
                if match:
                    title = match.group(1).replace('. ', '').strip()
                    title = re.sub(r'\s+', ' ', title).strip()
                    
                    if title.lower() == 'contents':
                        i += 1
                        continue
                        
                    printed_page = int(match.group(2))
                    toc_entries.append({
                        'title': title,
                        'printed_page': printed_page,
                        'source_page': p_idx,
                        'rect': rect,
                        'x0': rect.x0,
                        'is_part': False,
                        'linked': False
                    })
                    toc_matches_on_page += 1
                else:
                    # 4. Look ahead for page number on next line
                    if i + 1 < len(page_lines):
                        nxt_text, nxt_rect = page_lines[i+1]
                        if re.match(r"^([ivxlcdm]+|\d+)$", nxt_text.lower()):
                            if not re.match(r"^\d+$", line_text) and len(line_text) > 3:
                                title = line_text.strip()
                                title = re.sub(r'\s+', ' ', title).strip()
                                if title.lower() == 'contents':
                                    i += 1
                                    continue
                                
                                if nxt_text.isdigit():
                                    printed_page = int(nxt_text)
                                    combined_rect = rect | nxt_rect
                                    
                                    toc_entries.append({
                                        'title': title,
                                        'printed_page': printed_page,
                                        'source_page': p_idx,
                                        'rect': combined_rect,
                                        'x0': rect.x0,
                                        'is_part': False,
                                        'linked': False
                                    })
                                    toc_matches_on_page += 1
            i += 1
                                    
        if in_contents and len(toc_entries) > 5 and toc_matches_on_page == 0:
            in_contents = False
            break
            
    return toc_entries

def find_title_on_page(page, title):
    words = title.split()
    if not words: return None
    
    rects = page.search_for(title)
    if rects: return rects[0]
    
    search_str = " ".join(words[:min(3, len(words))])
    rects = page.search_for(search_str)
    if rects: return rects[0]
    
    if len(words) >= 3:
        search_str = " ".join(words[1:3])
        rects = page.search_for(search_str)
        if rects: return rects[0]
        
    blocks = page.get_text("blocks")
    top_blocks = [b for b in blocks if b[4].strip() and b[1] < page.rect.height * 0.5]
    if top_blocks:
        top_blocks.sort(key=lambda b: (b[2]-b[0]) * (b[3]-b[1]), reverse=True)
        return fitz.Rect(top_blocks[0][:4])
        
    return None

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
            e['level'] = 2
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
            entry['level'] = 2
            continue
            
        # find matching level
        level = 2
        for i, bx in enumerate(distinct_x0):
            if abs(entry['x0'] - bx) <= tolerance:
                level = 2 + i
                break
        entry['level'] = level
        
    # Ensure parts are at least level 2 and push children down if necessary
    for entry in toc_entries:
        if entry.get('is_part'):
            entry['level'] = 2
            
    return toc_entries

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
        
    page_map = build_page_map(doc)
    toc_entries = find_toc_entries(doc)
    
    # Assign levels based on indentation
    toc_entries = determine_hierarchy(toc_entries)
    
    linked_count = 0
    back_links_count = 0
    
    for entry in toc_entries:
        p_page = entry['printed_page']
        
        target_p_idx = None
        if p_page > 0:
            target_p_idx = page_map.get(p_page)
            if target_p_idx is None:
                for offset in range(-3, 4):
                    if (p_page + offset) in page_map:
                        target_p_idx = page_map[p_page + offset] - offset
                        break
                        
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
            
            target_page = doc[target_p_idx]
            title_rect = find_title_on_page(target_page, entry['title'])
            
            if title_rect:
                back_link = {
                    "kind": fitz.LINK_GOTO,
                    "from": title_rect,
                    "page": entry['source_page']
                }
                target_page.insert_link(back_link)
                back_links_count += 1
                entry['back_linked'] = True
                
    # Fix unlinked entries (e.g. Parts with no page numbers)
    for idx, entry in enumerate(toc_entries):
        if not entry.get('linked') and entry.get('printed_page') == -1:
            # find next linked entry
            for nxt in toc_entries[idx+1:]:
                if nxt.get('linked'):
                    entry['linked'] = True
                    entry['target_p_idx'] = nxt.get('target_p_idx')
                    break

    # ---------------------------------------------------------
    # Build Hierarchical Bookmarks
    # ---------------------------------------------------------
    toc_bookmarks = []
    
    # Level 1: Document Title
    meta_title = doc.metadata.get('title')
    if not meta_title:
        for page_idx in range(min(2, len(doc))):
            page = doc[page_idx]
            blocks = page.get_text("dict").get("blocks", [])
            largest_text = None
            largest_size = 0
            for b in blocks:
                if b.get("type") == 0:
                    for l in b.get("lines", []):
                        for s in l.get("spans", []):
                            text = s.get("text", "").strip()
                            if len(text) > 3 and s.get("size", 0) > largest_size:
                                largest_size = s["size"]
                                largest_text = text
            if largest_text:
                meta_title = largest_text
                break
                
    if not meta_title:
        meta_title = "Book Title"
        
    toc_bookmarks.append((1, meta_title, 1))
    
    # Level 2: Front Matter
    fm_pages = {}
    for page_num in range(min(15, len(doc))):
        page = doc[page_num]
        text_lower = page.get_text("text").lower()
        if "half title" not in fm_pages and page_num < 3:
            fm_pages["Half Title"] = page_num + 1
        if "title page" not in fm_pages and ("contributing authors:" in text_lower or "dr. russell l. claxton" in text_lower or "a formula to help you" in text_lower):
            fm_pages["Title Page"] = page_num + 1
        if "copyright page" not in fm_pages and ("copyright" in text_lower or "isbn" in text_lower or "all rights reserved" in text_lower):
            fm_pages["Copyright Page"] = page_num + 1
        if "dedication" not in fm_pages and ("dedication" in text_lower or "dedicated to" in text_lower):
            fm_pages["Dedication"] = page_num + 1
        if "contents" not in fm_pages and "contents" in text_lower:
            fm_pages["Contents"] = page_num + 1
            
    fm_order = ["Half Title", "Title Page", "Copyright Page", "Dedication", "Contents", "Introduction"]
    
    # If Introduction is found in toc_entries, don't add it via FM
    has_intro_in_toc = any("introduction" in e['title'].lower() for e in toc_entries)
    if not has_intro_in_toc:
        for page_num in range(min(20, len(doc))):
            if "introduction" in doc[page_num].get_text("text").lower():
                fm_pages["Introduction"] = page_num + 1
                break

    for fm in fm_order:
        if fm in fm_pages:
            toc_bookmarks.append((2, fm, fm_pages[fm]))
            
    # Add TOC Entries
    for entry in toc_entries:
        if entry.get('linked'):
            level = entry.get('level', 2)
            toc_bookmarks.append((level, entry['title'], entry['target_p_idx'] + 1))
            
    # Subheadings (H3s)
    h3_headings = []
    ch1_start = next((b[2] for b in toc_bookmarks if "chapter 1" in b[1].lower() or "chapter one" in b[1].lower()), None)
    
    if include_subheadings and ch1_start is not None:
        for page_num in range(ch1_start - 1, len(doc)):
            page = doc[page_num]
            blocks = page.get_text("dict").get("blocks", [])
            for b in blocks:
                if b.get("type") == 0:
                    for l in b.get("lines", []):
                        for s in l.get("spans", []):
                            text = s.get("text", "").strip()
                            if not text: continue
                            font_lower = s.get("font", "").lower()
                            is_h3_font = "impactltstd" in font_lower or "timesltstd-bold" in font_lower
                            is_h3_size = 15.0 < s.get("size", 0) < 18.0
                            if is_h3_font and is_h3_size and text.isupper():
                                if text in ("SCHOOL ADMINISTRATION", "CONTENTS", "VISION: THE DRIVING FORCE", "INSTRUCTIONAL LEADERSHIP", "ORGANIZATIONAL MANAGEMENT", "ADVOCACY, NEGOTIATION, AND PARTNERSHIPS"):
                                    continue
                                h3_headings.append({'title': text, 'target_page': page_num})
                                
    # Merge H3s intelligently
    final_bookmarks = []
    
    all_items = []
    for b in toc_bookmarks:
        all_items.append({'type': 'toc', 'level': b[0], 'title': b[1], 'page': b[2]})
        
    for h in h3_headings:
        if any(abs(b[2] - (h['target_page'] + 1)) < 2 and b[1].lower() in h['title'].lower() for b in toc_bookmarks):
             continue
        all_items.append({'type': 'h3', 'title': h['title'], 'page': h['target_page'] + 1})
        
    all_items.sort(key=lambda x: (x['page'], 0 if x['type'] == 'toc' else 1))
    
    current_parent_level = 1
    for item in all_items:
        if item['type'] == 'toc':
            current_parent_level = item['level']
            final_bookmarks.append((item['level'], item['title'], item['page']))
        else:
            final_bookmarks.append((current_parent_level + 1, item['title'], item['page']))

    # Sanitize hierarchy to prevent jumps
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
    
    doc.save(output_path, garbage=3, deflate=True)
    doc.close()
    
    return {
        "success": True,
        "toc_entries_detected": len(toc_entries),
        "linked_count": linked_count,
        "bookmarks_generated": len(sanitized_bookmarks),
        "output_path": output_path
    }
