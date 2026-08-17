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
            # Try to extract chapter number from filename
            chapter_num = None
            ch_match = re.search(r'Chapter[_\s-]*(\d+)', xhtml_filename, re.IGNORECASE)
            if ch_match:
                chapter_num = int(ch_match.group(1))

            # Extract XHTML start & end page numbers from pagebreak list
            def roman_to_int(s):
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
                if p_str.isdigit():
                    return int(p_str), False
                roman_val = roman_to_int(p_str)
                if roman_val is not None:
                    return roman_val, True
                return None, False

            p_start_val, start_is_roman = parse_page_val(pages[0])
            p_end_val, end_is_roman = parse_page_val(pages[-1])

            if p_start_val is not None and p_end_val is not None:
                doc = fitz.open(pdf_file)
                toc = doc.get_toc()
                best_bookmark = None

                for item in toc:
                    level, title, pdf_page = item[0], item[1], item[2]

                    # Front matter
                    if chapter_num is None or not re.search(r'Ch(?:apter)?', title, re.IGNORECASE):
                        if start_is_roman and re.search(r'FM|Front\s*Matter', title, re.IGNORECASE):
                            page_match = re.search(r'[_\s]p[_\s]*([ivxlcdm]+)[_\s-]*([ivxlcdm]+)', title, re.IGNORECASE)
                            if page_match:
                                log_start = roman_to_int(page_match.group(1))
                                log_end = roman_to_int(page_match.group(2))
                                if log_start is not None and log_end is not None:
                                    if p_start_val >= log_start and p_end_val <= log_end:
                                        best_bookmark = bookmark = {"pdf_page": pdf_page, "logical_range": (log_start, log_end)}
                                        break
                        continue

                    # Chapters
                    chapter_match = re.search(r'Ch(?:apter)?[_\s]*(\d+)(?:[_\s-]*Ch(?:apter)?[_\s]*(\d+))?', title, re.IGNORECASE)
                    if chapter_match:
                        ch_start = int(chapter_match.group(1))
                        ch_end = int(chapter_match.group(2)) if chapter_match.group(2) else ch_start
                        if ch_start <= chapter_num <= ch_end:
                            page_match = re.search(r'[_\s]p(?:age)?[_\s]*(\d+)[_\s-]*(\d+)', title, re.IGNORECASE)
                            if page_match:
                                log_start = int(page_match.group(1))
                                log_end = int(page_match.group(2))
                                if p_start_val >= log_start and p_end_val <= log_end:
                                    best_bookmark = {"pdf_page": pdf_page, "logical_range": (log_start, log_end)}
                                    break
                            else:
                                best_bookmark = {"pdf_page": pdf_page, "logical_range": (None, None)}

                doc.close()

                if best_bookmark:
                    bookmark_pdf_start = best_bookmark["pdf_page"]
                    log_start, log_end = best_bookmark["logical_range"]
                    if log_start is not None:
                        offset = bookmark_pdf_start - log_start
                        pdf_start = p_start_val + offset
                        pdf_end = p_end_val + offset
                        return {
                            "page": max(1, pdf_start),
                            "end_page": min(total, pdf_end),
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
