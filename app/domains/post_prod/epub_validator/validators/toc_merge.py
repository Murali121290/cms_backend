"""Table of Contents merge detector.

Rule: TOC-MERGE-001 (book-scope)
"""

from __future__ import annotations

import html
import os
import re
import difflib

import fitz

from ..engine.registry import rule
from ..services import book_bundle_service as _bundle

def get_xhtml_lines(xhtml_file):
    with open(xhtml_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find all <p> and <h1>...<h6> tags using finditer to track position
    elements = re.finditer(r'<(p|h[1-6])[^>]*>(.*?)</\1>', content, re.DOTALL | re.IGNORECASE)
    
    xhtml_lines = []
    for match in elements:
        inner_html = match.group(2)
        # Remove formatting tags that shouldn't break words (like Post-<i>Chaplinsky</i>) and anchors
        inner_html = re.sub(r'</?(i|em|b|strong|a)\b[^>]*>', '', inner_html, flags=re.IGNORECASE)
        # Unwrap Smallcaps spans specifically without adding spaces (e.g. S<span class="Smallcaps">ummary</span>)
        inner_html = re.sub(r'<span\b[^>]*class=["\'][^"\']*\bSmallcaps\b[^"\']*["\'][^>]*>(.*?)</span\s*>', r'\1', inner_html, flags=re.IGNORECASE | re.DOTALL)
        # Unwrap spans containing only punctuation (e.g. <span class="C1947">.</span>) without adding spaces
        inner_html = re.sub(r'<span\b[^>]*>([.,;:!?\-–—’"]+)</span>', r'\1', inner_html, flags=re.IGNORECASE)
        # Replace all other tags (like other spans, anchors) with a space to preserve intended spacing between elements
        text = re.sub(r'<[^>]+>', ' ', inner_html)
        text = html.unescape(text)
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            line_no = content.count('\n', 0, match.start()) + 1
            xhtml_lines.append((text, line_no))
            
    return xhtml_lines

def get_pdf_text_by_visual_lines(pdf_file):
    doc = fitz.open(pdf_file)
    pdf_lines = []
    
    for page in doc:
        words = page.get_text("words")
        # words is a list of (x0, y0, x1, y1, "word", block_no, line_no, word_no)
        # Sort words by approximate vertical position (y0), then horizontal (x0)
        # We'll use the vertical center of the word bounding box for grouping
        words_with_center = [(w, (w[1] + w[3]) / 2) for w in words]
        words_with_center.sort(key=lambda x: x[1])
        
        current_line_words = []
        current_y_center = -100
        
        for w, y_center in words_with_center:
            # If the vertical center is within 4 points, consider it the same visual line
            if abs(y_center - current_y_center) > 4:
                if current_line_words:
                    # Sort the current line left-to-right by x0
                    current_line_words.sort(key=lambda cw: cw[0])
                    pdf_lines.append(" ".join([cw[4] for cw in current_line_words]))
                current_line_words = [w]
                current_y_center = y_center
            else:
                current_line_words.append(w)
                
        if current_line_words:
            current_line_words.sort(key=lambda cw: cw[0])
            pdf_lines.append(" ".join([cw[4] for cw in current_line_words]))
            
    return "\n".join(pdf_lines)

@rule("TOC-MERGE-001")
def validate_toc_merge(file_details, rule_config=None):
    folder = file_details.get("folder_name")
    if not folder:
        return {"issues_count": 0, "issues": []}

    xhtml_file = file_details["full_path"]
    xhtml_filename = file_details["file_name"]
    rel_path = file_details.get("rel_path", xhtml_filename)

    from ..services.pdf_service import get_chapter_pdf
    
    try:
        pdf_path = get_chapter_pdf(folder, xhtml_filename)
    except Exception:
        return {"issues_count": 0, "issues": []}

    if not pdf_path or not os.path.isfile(pdf_path):
        return {"issues_count": 0, "issues": []}

    issues = []
    
    # Load PDF text once for this chapter's PDF
    pdf_text = get_pdf_text_by_visual_lines(pdf_path)
    pdf_raw_lines = [line.strip() for line in pdf_text.split('\n')]
    
    xhtml_lines = get_xhtml_lines(xhtml_file)
    
    for i, (x_line_raw, line_no) in enumerate(xhtml_lines):
        x_line_norm = re.sub(r'\s+', ' ', x_line_raw).strip()
        if not x_line_norm:
            continue
            
        found_as_single_line = False
        for p_line in pdf_raw_lines:
            words = x_line_norm.split()
            if not words: continue
            
            escaped_words = [re.escape(w).replace(r'\-', r'-\s*') for w in words]
            pattern_str = r'\s+'.join(escaped_words)
            
            if re.search(pattern_str, p_line, re.IGNORECASE):
                found_as_single_line = True
                break
                
        if not found_as_single_line:
            words = x_line_norm.split()
            if len(words) < 3:
                continue
                
            escaped_words = [re.escape(w).replace(r'\-', r'-\s*') for w in words]
            
            pattern_wrap = r'\s+'.join(escaped_words)
            if re.search(pattern_wrap, pdf_text, re.IGNORECASE):
                continue
                
            pattern_merge = r'\s+(?:[0-9a-zA-Z]{1,3}\s+)?'.join(escaped_words)
            
            try:
                match = re.search(pattern_merge, pdf_text, re.IGNORECASE | re.DOTALL)
                if match:
                    matched_text = match.group(0)
                    if '\n' in matched_text:
                        lines = [L.strip() for L in matched_text.strip().split('\n') if L.strip()]
                        if len(lines) >= 2:
                            first_part = lines[0][-40:] if len(lines[0]) > 40 else lines[0]
                            second_part = lines[1][:40] if len(lines[1]) > 40 else lines[1]
                            snippet = f"...{first_part} ⏐ {second_part}..."
                            last_para_words = [w for w in re.split(r'\s+', lines[-1]) if w]
                            split_start_text = " ".join(last_para_words[:4])
                            msg = f"TOC entries incorrectly merged. (Expected is PDF, Actual is XHTML). Please split the XHTML paragraph at: '{split_start_text}'."
                        else:
                            snippet = matched_text.strip()
                            msg = f"TOC entries incorrectly merged. (Expected is PDF, Actual is XHTML). XHTML: '{x_line_norm}' corresponds to multiple lines in PDF."

                        issues.append({
                            "rule_name": "TOC Line Merge",
                            "type": "toc_merge_issue",
                            "message": msg,
                            "category": "Error",
                            "line_number": line_no,
                            "extract": x_line_norm,
                            "expected_text": matched_text.strip(),
                            "actual_text": x_line_norm,
                        })
                else:
                    closest_matches = difflib.get_close_matches(x_line_norm, pdf_raw_lines, n=1, cutoff=0.3)
                    closest_text = closest_matches[0] if closest_matches else "Not found in PDF"

                    issues.append({
                        "rule_name": "TOC Line Mismatch",
                        "type": "toc_mismatch_issue",
                        "message": f"TOC entry '{x_line_norm}' missing or mismatched in PDF. (Expected is PDF, Actual is XHTML)",
                        "category": "Warning",
                        "line_number": line_no,
                        "extract": x_line_norm,
                        "expected_text": closest_text,
                        "actual_text": x_line_norm,
                    })
            except re.error:
                pass

    return {"issues_count": len(issues), "issues": issues}
