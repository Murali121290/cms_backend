"""Parser for Springer Publishing Assignment Memo (.docx) files.

Extracts project metadata (Title, Authors, ISBN, Trim Size, Pages, Chapters, Dates, Color)
from tables in the Springer Assignment Memo Word document.
"""
from __future__ import annotations

import re
import docx

from app.domains.projects.po_intake import normalize as n


def parse(file_path: str) -> dict:
    doc = docx.Document(file_path)
    fields: dict[str, object] = {}
    extras: dict[str, object] = {}
    warnings: list[str] = []

    tables = doc.tables

    # 1. Parse Table 0: Project Info
    if len(tables) > 0:
        t0 = tables[0]
        for row in t0.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            if not cells:
                continue

            first_cell = cells[0].casefold()

            if "title / subtitle" in first_cell or "title/subtitle" in first_cell:
                if len(cells) > 1:
                    val = n.clean(cells[1])
                    if val:
                        fields["project_title"] = val

            elif "author(s)/editor(s)" in first_cell or "author/editor" in first_cell:
                if len(cells) > 1:
                    val = n.clean(cells[1])
                    if val:
                        fields["author_names"] = [val]

            elif "isbn (print)" in first_cell or "isbn" in first_cell:
                # E.g. ['ISBN (Print)', '978-0-8261-0044-3', 'Product Code', '00443']
                for idx, cell in enumerate(cells):
                    c_fold = cell.casefold()
                    if "isbn" in c_fold and idx + 1 < len(cells):
                        raw_isbn = cells[idx + 1]
                        isbn, w = n.normalize_isbn(raw_isbn)
                        if isbn:
                            fields["isbn_no"] = isbn
                        elif w:
                            warnings.append(w)
                    elif "product code" in c_fold and idx + 1 < len(cells):
                        p_code = n.clean(cells[idx + 1])
                        if p_code:
                            extras["product_code"] = p_code

            elif "imprint" in first_cell:
                if len(cells) > 1:
                    val = n.clean(cells[1])
                    if val:
                        extras["imprint"] = val

    # 2. Parse Table 1: Technical & Interior Color Specs
    if len(tables) > 1:
        t1 = tables[1]
        for row in t1.rows:
            cells = [c.text.strip().replace("\n", " ") for c in row.cells]
            if not cells:
                continue

            first_cell = cells[0].casefold()

            if "trim size" in first_cell:
                # E.g. ['Trim Size / BINDING', '8.5 X 11/SC', ..., 'Ms Pgs', '484', ..., 'Target bk pgs', '383']
                for idx, cell in enumerate(cells):
                    c_fold = cell.casefold()
                    if "trim size" in c_fold and idx + 1 < len(cells):
                        t_size = n.clean(cells[idx + 1])
                        if t_size:
                            fields["trim_size"] = t_size
                    elif ("ms pgs" in c_fold or "ms pages" in c_fold) and idx + 1 < len(cells):
                        pgs = n.to_int(cells[idx + 1])
                        if pgs and "estimated_pages" not in fields:
                            fields["estimated_pages"] = pgs
                    elif ("target bk pgs" in c_fold or "target book pgs" in c_fold) and idx + 1 < len(cells):
                        pgs = n.to_int(cells[idx + 1])
                        if pgs and "estimated_pages" not in fields:
                            fields["estimated_pages"] = pgs

            elif "no. of chaps" in first_cell or "no. of chapters" in first_cell:
                if len(cells) > 1:
                    ch_cnt = n.to_int(cells[1])
                    if ch_cnt:
                        fields["chapter_count"] = ch_cnt

            elif "interior colors" in first_cell:
                # Rows for Print interior colors (Black only, 2-color, 4-color throughout)
                row_str = " ".join(cells)
                if "X" in cells or "x" in cells:
                    # Determine which option is marked with X
                    if "4-color throughout" in row_str.casefold():
                        fields["color"] = "4-color throughout"
                    elif "black only" in row_str.casefold():
                        fields["color"] = "Black only"
                    elif "2-color" in row_str.casefold():
                        fields["color"] = "2-color"
                    elif "color in place" in row_str.casefold():
                        fields["color"] = "Color in Place"

    # 3. Parse Production Schedule Table (look for table with schedule keywords or Table 9)
    for table in tables:
        full_tbl_text = "".join(c.text for r in table.rows for c in r.cells).casefold()
        if "production schedule" in full_tbl_text or "ptr pdfs" in full_tbl_text:
            for row in table.rows:
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                if len(cells) < 2:
                    continue
                label_cell = cells[0].casefold()
                date_cell = cells[1]

                # Manuscript to compositor -> turnover_date / start_date
                if "manuscript to compositor" in label_cell and "turnover_date" not in fields:
                    raw_dt = date_cell.split("(")[0].strip()
                    iso_dt, w = n.parse_date_loose(raw_dt)
                    if iso_dt:
                        fields["turnover_date"] = iso_dt
                    elif w:
                        warnings.append(w)

                # PTR PDFs to printer -> due_date
                elif ("ptr pdfs" in label_cell and "printer" in label_cell) or ("ptr pdfs (text and cover) to printer" in label_cell):
                    if "due_date" not in fields:
                        iso_dt, w = n.parse_date_loose(date_cell)
                        if iso_dt:
                            fields["due_date"] = iso_dt
                        elif w:
                            warnings.append(w)

    return {
        "fields": fields,
        "extras": extras,
        "warnings": warnings,
    }
