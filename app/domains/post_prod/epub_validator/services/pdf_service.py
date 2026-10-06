import glob
import os
import re
import pymupdf as fitz
from bs4 import BeautifulSoup


from .upload_service import UPLOAD_DIR, EXTRACT_DIR


def _check_chapter_cache(folder_name: str, xhtml_filename: str):
    """Look for a previously cut chapter PDF named ``{stem}_pg-{start}-{end}.pdf``.

    Returns ``(path, start, end)`` on hit, ``None`` on miss.
    """
    stem        = os.path.splitext(xhtml_filename)[0]
    extract_dir = os.path.join(UPLOAD_DIR, folder_name, EXTRACT_DIR)
    matches     = glob.glob(os.path.join(extract_dir, f"{stem}_pg-*-*.pdf"))
    if not matches:
        return None
    path  = matches[0]
    fname = os.path.basename(path)                      # 08_Contents_pg-42-45.pdf
    pg    = fname[len(stem) + 4:-4]                     # "42-45"
    parts = pg.split("-")
    if len(parts) == 2:
        try:
            return path, int(parts[0]), int(parts[1])
        except ValueError:
            pass
    return None


def _find_xhtml_path(folder_name: str, xhtml_filename: str) -> str | None:
    epub_folder = os.path.join(UPLOAD_DIR, folder_name, EXTRACT_DIR, "epub")
    for root, _, files in os.walk(epub_folder):
        if xhtml_filename in files:
            return os.path.join(root, xhtml_filename)
    return None


def _extract_pagebreaks(xhtml_path: str) -> list[str]:
    """Return sorted list of page numbers from epub:type="pagebreak" spans."""
    with open(xhtml_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    pages = []
    for span in soup.find_all("span"):
        role = span.get("role") or ""
        epub_type = span.get("epub:type") or ""
        # Check attrs keys directly since namespace attributes can be formatted differently
        is_pb = (role == "doc-pagebreak" or 
                 epub_type == "pagebreak" or 
                 any("pagebreak" in str(v) for v in span.attrs.values()))
        if is_pb:
            label = span.get("aria-label") or span.get("id", "")
            # e.g. "page 103" -> "103"
            label = label.replace("page", "").replace("_", "").replace("-", "").strip()
            if label:
                pages.append(label)
    return pages


def _pdf_path(folder_name: str) -> str:
    extract_dir = os.path.join(UPLOAD_DIR, folder_name, EXTRACT_DIR)
    exact = os.path.join(extract_dir, f"{folder_name}.pdf")
    if os.path.exists(exact):
        return exact
    
    # Identify the main full PDF by looking for ISBN name or large file size or not starting with numbers like "13_Chapter_" or "24_Chapter_"
    candidates = []
    for f in glob.glob(os.path.join(extract_dir, "*.pdf")):
        base = os.path.basename(f)
        if "_pg-" in base:
            continue
        # Exclude cut chapter PDFs that start with digits and "Chapter_"
        if re.match(r"^\d+_[Cc]hapter", base):
            continue
        candidates.append(f)
        
    if candidates:
        # Prefer the one matching folder_name if available, else largest file size
        for c in candidates:
            if folder_name in os.path.basename(c):
                return c
        candidates.sort(key=os.path.getsize, reverse=True)
        return candidates[0]
        
    return exact


def find_pdf_page(folder_name: str, xhtml_filename: str) -> dict:
    pdf_file = _pdf_path(folder_name)

    # ── Fast path: page range already encoded in cached filename ────────────
    cached = _check_chapter_cache(folder_name, xhtml_filename)
    if cached:
        _, start, end = cached
        total = len(fitz.open(pdf_file)) if os.path.exists(pdf_file) else end
        return {"page": start, "end_page": end, "total_pages": total}

    # ── Slow path: parse XHTML pagebreaks and scan PDF labels ───────────────
    total = 1
    if os.path.exists(pdf_file):
        doc = fitz.open(pdf_file)
        total = len(doc)

        xhtml_path = _find_xhtml_path(folder_name, xhtml_filename)
        if not xhtml_path:
            return {"page": 1, "end_page": 1, "total_pages": total}

        pages = _extract_pagebreaks(xhtml_path)

        start_page = None
        end_page = None

        if pages:
            for page in doc:
                label = page.get_label()
                if label == pages[0]:
                    start_page = page.number + 1
                if label == pages[-1]:
                    end_page = page.number + 1

            doc.close()

            if start_page is not None and end_page is not None:
                return {
                    "page": start_page,
                    "end_page": end_page,
                    "total_pages": total
                }

            # ── Fallback path: Use bookmarks/TOC matching ────────────────────
            def roman_to_int(s):
                if not s:
                    return None
                s = s.lower().strip()
                if not re.match(r'^[ivxlcdm]+$', s):
                    return None
                roman_values = {'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100, 'd': 500, 'm': 1000}
                total_val = 0
                prev_value = 0
                for char in reversed(s):
                    value = roman_values.get(char, 0)
                    if value < prev_value:
                        total_val -= value
                    else:
                        total_val += value
                    prev_value = value
                return total_val if total_val > 0 else None

            def parse_page_val(p_str):
                if not p_str:
                    return None, False
                if p_str.isdigit():
                    return int(p_str), False
                roman_val = roman_to_int(p_str)
                if roman_val is not None:
                    return roman_val, True
                return None, False

            def parse_chapter_num(filename):
                m = re.search(r'Ch(?:apter)?[_\s-]*(\d+)', filename, re.IGNORECASE)
                if m:
                    return int(m.group(1))
                m_rom = re.search(r'Ch(?:apter)?[_\s-]*([IVXLCDM]+)\b', filename, re.IGNORECASE)
                if m_rom:
                    return roman_to_int(m_rom.group(1))
                return None

            chapter_num = parse_chapter_num(xhtml_filename)
            p_start_val, start_is_roman = parse_page_val(pages[0])
            p_end_val, end_is_roman = parse_page_val(pages[-1])

            doc = fitz.open(pdf_file)
            toc = doc.get_toc()

            bookmarks = []
            for level, title, pdf_page in toc:
                is_fm = bool(re.search(r'\bFM\b|Front\s*Matter', title, re.IGNORECASE))
                ch_start, ch_end = None, None
                if not is_fm:
                    ch_m = re.search(r'Ch(?:apter)?[_\s]*(\d+)(?:[_\s-]*Ch(?:apter)?[_\s]*(\d+))?', title, re.IGNORECASE)
                    if ch_m:
                        ch_start = int(ch_m.group(1))
                        ch_end = int(ch_m.group(2)) if ch_m.group(2) else ch_start
                    else:
                        ch_m_rom = re.search(r'Ch(?:apter)?[_\s]*([IVXLCDM]+)\b', title, re.IGNORECASE)
                        if ch_m_rom:
                            r_val = roman_to_int(ch_m_rom.group(1))
                            if r_val:
                                ch_start, ch_end = r_val, r_val

                p_start, s_is_rom = None, False
                p_end, e_is_rom = None, False

                p_m = re.search(r'\b(?:p|FM_p)?([ivxlcdm\d]+)[_\s-]+([ivxlcdm\d]+)\b', title, re.IGNORECASE)
                if not p_m:
                    p_m = re.search(r'[_\s]p[_\s]*([ivxlcdm\d]+)[_\s-]+([ivxlcdm\d]+)', title, re.IGNORECASE)
                if p_m:
                    p_start, s_is_rom = parse_page_val(p_m.group(1))
                    p_end, e_is_rom = parse_page_val(p_m.group(2))

                bookmarks.append({
                    'title': title,
                    'pdf_page': pdf_page,
                    'is_fm': is_fm,
                    'ch_range': (ch_start, ch_end) if ch_start is not None else None,
                    'page_range': (p_start, p_end) if p_start is not None else None,
                    'is_roman': s_is_rom
                })

            doc.close()

            best_bookmark = None

            # Strategy 1: Page Range matching with matching roman/digit type & total bounds check
            if p_start_val is not None and p_end_val is not None:
                for b in bookmarks:
                    if b['page_range'] and b['page_range'][0] is not None and b['page_range'][1] is not None:
                        ls, le = b['page_range']
                        if b['is_roman'] == start_is_roman and ls <= p_start_val and p_end_val <= le:
                            off = b['pdf_page'] - ls
                            if 1 <= (p_start_val + off) <= total:
                                best_bookmark = b
                                break

            # Strategy 2: Match Chapter Number
            if not best_bookmark and chapter_num is not None:
                for b in bookmarks:
                    if b['ch_range'] and b['ch_range'][0] <= chapter_num <= b['ch_range'][1]:
                        best_bookmark = b
                        break

            # Strategy 3: Match Front Matter
            if not best_bookmark and start_is_roman:
                for b in bookmarks:
                    if b['is_fm']:
                        best_bookmark = b
                        break

            if best_bookmark:
                if best_bookmark['page_range'] and best_bookmark['page_range'][0] is not None and p_start_val is not None:
                    offset = best_bookmark['pdf_page'] - best_bookmark['page_range'][0]
                    pdf_s = max(1, p_start_val + offset)
                    pdf_e = min(total, (p_end_val + offset) if p_end_val else pdf_s)
                    return {
                        "page": pdf_s,
                        "end_page": pdf_e,
                        "total_pages": total
                    }
                else:
                    return {
                        "page": max(1, best_bookmark['pdf_page']),
                        "end_page": min(total, best_bookmark['pdf_page'] + 10),
                        "total_pages": total
                    }

            return {
                "page": 1,
                "end_page": total,
                "total_pages": total
            }

        return {
            "page": 1,
            "end_page": total,
            "total_pages": total
        }


def get_chapter_pdf(folder_name: str, xhtml_filename: str) -> str:
    """Return path to a chapter-scoped PDF, cutting and caching on first call.

    Filename format: ``{stem}_pg-{start}-{end}.pdf``
    Cache check is a single glob — no XHTML read, no PDF label scan.
    """
    # ── Cache hit ────────────────────────────────────────────────────────────
    cached = _check_chapter_cache(folder_name, xhtml_filename)
    if cached:
        return cached[0]

    # ── Resolve page range (slow path, runs only once per chapter) ───────────
    full_pdf = _pdf_path(folder_name)
    if not os.path.exists(full_pdf):
        raise FileNotFoundError("Full PDF not found")

    info  = find_pdf_page(folder_name, xhtml_filename)
    start = info["page"]
    end   = info["end_page"]

    # Full-book chapter — serve original PDF, save a zero-byte marker so the
    # cache check succeeds on the next call without re-running detection.
    stem        = os.path.splitext(xhtml_filename)[0]
    extract_dir = os.path.join(UPLOAD_DIR, folder_name, EXTRACT_DIR)
    if start == 1 and end == info["total_pages"]:
        marker = os.path.join(extract_dir, f"{stem}_pg-{start}-{end}.pdf")
        open(marker, "wb").close()          # zero-byte marker
        return full_pdf

    # ── Cut and save ─────────────────────────────────────────────────────────
    chapter_pdf_path = os.path.join(extract_dir, f"{stem}_pg-{start}-{end}.pdf")
    src = fitz.open(full_pdf)
    out = fitz.open()
    out.insert_pdf(src, from_page=start - 1, to_page=end - 1)
    out.save(chapter_pdf_path)
    out.close()
    src.close()

    return chapter_pdf_path


def render_pdf_page(folder_name: str, page: int) -> bytes:
    """Render a single PDF page to PNG bytes at 2× resolution."""
    pdf_file = _pdf_path(folder_name)
    if not os.path.exists(pdf_file):
        raise FileNotFoundError("PDF not found")

    doc = fitz.open(pdf_file)
    if page < 1 or page > len(doc):
        page = 1

    pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(2, 2))
    data = pix.tobytes("png")
    doc.close()
    return data
