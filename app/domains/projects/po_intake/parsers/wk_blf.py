"""Parser for the Wolters Kluwer Book Launch Form (BLF) Excel workbook.

WK uses this workbook (e.g. Hashemi5e_9781975297992_BLF_kj.xlsx) as a project intake
and specification sheet across Editorial, Production, Design, Manufacturing, and Digital.
"""
from __future__ import annotations

import re
import openpyxl

from app.domains.projects.po_intake import normalize as n


def _find_cell_value(ws, label_pattern: str | re.Pattern, max_col_offset: int = 3) -> object:
    """Find a cell matching label_pattern and return the first non-empty neighbor value to its right."""
    pattern = re.compile(label_pattern, re.IGNORECASE) if isinstance(label_pattern, str) else label_pattern
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and pattern.search(cell.value.strip()):
                for offset in range(1, max_col_offset + 1):
                    neighbor = ws.cell(row=cell.row, column=cell.column + offset).value
                    if neighbor is not None and str(neighbor).strip() != "":
                        return neighbor
    return None


def _find_cell_exact_label(ws, label: str, max_col_offset: int = 3) -> object:
    target = label.strip().casefold()
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip().casefold() == target:
                for offset in range(1, max_col_offset + 1):
                    neighbor = ws.cell(row=cell.row, column=cell.column + offset).value
                    if neighbor is not None and str(neighbor).strip() != "":
                        return neighbor
    return None


def _extract_authors_and_team(ws) -> tuple[list[str], dict[str, str | None], list[dict], str | None]:
    """Extract authors, editors, production team members, and author notes."""
    author_names: list[str] = []
    author_table: list[dict] = []
    author_notes: str | None = None

    # Check top Authors/Editors cell first (take primary/first author name only)
    top_authors = _find_cell_exact_label(ws, "Authors/Editors")
    if top_authors and isinstance(top_authors, str):
        # Pick the first author before comma or semicolon
        first_author = re.split(r"[,;]", top_authors)[0]
        cleaned = n.clean(first_author)
        if cleaned:
            author_names.append(cleaned)

    # Find the Author/Editor table under Team section (keep detailed table in author_details)
    table_start_row = None
    name_col = None
    email_col = None
    title_col = None

    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip().lower() == "author/editor name":
                table_start_row = cell.row
                name_col = cell.column
                if cell.column > 1:
                    left_val = ws.cell(row=cell.row, column=cell.column - 1).value
                    if left_val and "title" in str(left_val).lower():
                        title_col = cell.column - 1
                right_val = ws.cell(row=cell.row, column=cell.column + 1).value
                if right_val and "email" in str(right_val).lower():
                    email_col = cell.column + 1
                break
        if table_start_row:
            break

    if table_start_row and name_col:
        for r in range(table_start_row + 1, table_start_row + 10):
            # Check if this row hits a section header or label
            row_header = ws.cell(row=r, column=title_col if title_col else name_col - 1).value
            if row_header and isinstance(row_header, str):
                header_clean = row_header.strip().lower()
                if "notes on author" in header_clean or "other author" in header_clean or "# of contributor" in header_clean:
                    break

            val = ws.cell(row=r, column=name_col).value
            name = n.clean(val)
            if not name:
                continue

            title = n.clean(ws.cell(row=r, column=title_col).value) if title_col else None
            email = n.clean(ws.cell(row=r, column=email_col).value) if email_col else None

            author_table.append({
                "title": title,
                "name": name,
                "email": email,
            })
            if not author_names:
                author_names.append(name)

    author_notes = n.clean(_find_cell_exact_label(ws, "Notes on author hierarchy/relationship"))

    # Roles
    team_roles = {
        "acquisitions_editor": n.clean(_find_cell_exact_label(ws, "Acquisitions Editor")),
        "development_editor": n.clean(_find_cell_exact_label(ws, "Development Editor")),
        "editorial_coordinator": n.clean(_find_cell_exact_label(ws, "Editorial Coordinator")),
        "marketing_manager": n.clean(_find_cell_exact_label(ws, "Marketing Manager")),
        "manufacturing_coordinator": n.clean(_find_cell_exact_label(ws, "Manufacturing Coordinator")),
        "design_coordinator": n.clean(_find_cell_exact_label(ws, "Design Coordinator")),
        "prepress_vendor": n.clean(_find_cell_exact_label(ws, "Prepress Vendor (PPM)")),
        "production_product_manager": n.clean(_find_cell_exact_label(ws, "Production Product Manager (PPM)")),
    }

    return author_names, team_roles, author_table, author_notes


def _extract_batch_schedule(ws) -> list[dict]:
    """Extract rows from the Batch Delivery Schedule section if populated."""
    start_row = None
    batch_col = None
    items_col = None
    date_col = None

    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip().lower() == "batch #":
                start_row = cell.row
                batch_col = cell.column
                # Check neighbors
                for c in range(cell.column + 1, cell.column + 5):
                    cv = ws.cell(row=cell.row, column=c).value
                    if isinstance(cv, str):
                        c_lower = cv.strip().lower()
                        if "item" in c_lower and not items_col:
                            items_col = c
                        elif "date" in c_lower and not date_col:
                            date_col = c
                break
        if start_row:
            break

    if not start_row or not batch_col:
        return []

    items = []
    # Stop before next section (e.g. Design header at Col A/B)
    for r in range(start_row + 1, start_row + 15):
        # If column 1 has a section title like 'Design', stop
        c1 = ws.cell(row=r, column=1).value or ws.cell(row=r, column=2).value
        if c1 and any(s in str(c1).lower() for s in ("design", "manufacturing", "digital")):
            break

        batch_no = ws.cell(row=r, column=batch_col).value
        item_desc = ws.cell(row=r, column=items_col).value if items_col else None
        deliv_date = ws.cell(row=r, column=date_col).value if date_col else None

        if batch_no is None and item_desc is None and deliv_date is None:
            continue

        d_val, _ = n.parse_date_loose(deliv_date)
        items.append({
            "batch": str(batch_no).strip() if batch_no is not None else "",
            "items": n.clean(item_desc),
            "delivery_date": d_val or n.clean(deliv_date),
        })
    return items


def _extract_manuscript_info(ws) -> dict:
    """Extract comprehensive manuscript section data: counts, files, and elements."""
    ms_section_row = None
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip().casefold() == "manuscript":
                ms_section_row = cell.row
                break
        if ms_section_row:
            break

    if not ms_section_row:
        return {}

    # File & page counts breakdown (Chapters, Front Matter, Back Matter)
    breakdown = {}
    for r in range(ms_section_row, ms_section_row + 15):
        c2 = ws.cell(row=r, column=2).value
        if not c2 or not isinstance(c2, str):
            continue
        c2_clean = c2.strip().lower()
        if "# chapters" in c2_clean:
            breakdown["chapters"] = {
                "at_launch": {"count": ws.cell(row=r+1, column=2).value, "pages": ws.cell(row=r+1, column=3).value},
                "to_come": {"count": ws.cell(row=r+1, column=4).value, "pages": ws.cell(row=r+1, column=6).value},
                "total": {"count": ws.cell(row=r+1, column=7).value, "pages": ws.cell(row=r+1, column=8).value},
            }
        elif "# fm files" in c2_clean:
            breakdown["fm_files"] = {
                "at_launch": {"count": ws.cell(row=r+1, column=2).value, "pages": ws.cell(row=r+1, column=3).value},
                "to_come": {"count": ws.cell(row=r+1, column=4).value, "pages": ws.cell(row=r+1, column=6).value},
                "total": {"count": ws.cell(row=r+1, column=7).value, "pages": ws.cell(row=r+1, column=8).value},
            }
        elif "# bm files" in c2_clean:
            breakdown["bm_files"] = {
                "at_launch": {"count": ws.cell(row=r+1, column=2).value, "pages": ws.cell(row=r+1, column=3).value},
                "to_come": {"count": ws.cell(row=r+1, column=4).value, "pages": ws.cell(row=r+1, column=6).value},
                "total": {"count": ws.cell(row=r+1, column=7).value, "pages": ws.cell(row=r+1, column=8).value},
            }

    # Manuscript Elements (Col 2 & 3), FM Elements (Col 5 & 6), BM Elements (Col 7 & 8)
    manuscript_elements = {}
    fm_elements = {}
    bm_elements = {}
    index_details = {}
    toc_details = {}

    for r in range(ms_section_row + 10, ms_section_row + 35):
        # Stop if we reach next section like Art
        c1 = ws.cell(row=r, column=1).value or ws.cell(row=r, column=2).value
        if c1 and isinstance(c1, str) and any(s in c1.strip().lower() for s in ("art", "production", "design", "manufacturing")):
            break

        # Col 2: Manuscript Elements
        lbl_ms = ws.cell(row=r, column=2).value
        if lbl_ms and isinstance(lbl_ms, str):
            key = lbl_ms.strip().lstrip("-*• ")
            val = ws.cell(row=r, column=3).value
            if val is not None and key not in ("Manuscript Elements", "2 appendices") and not key.endswith("appendices"):
                manuscript_elements[key] = val

        # Col 5: FM Elements & TOC
        lbl_fm = ws.cell(row=r, column=5).value
        if lbl_fm and isinstance(lbl_fm, str):
            clean_lbl = lbl_fm.strip().lstrip("-*• ")
            val = ws.cell(row=r, column=6).value
            if "TOC" in clean_lbl:
                pass
            elif clean_lbl in ("Units/Parts/Sections", "Chapter Titles", "Chapter Authors/Section Editors", "H1", "H2"):
                if val is not None:
                    toc_details[clean_lbl] = val
            elif clean_lbl not in ("FM Elements",):
                if val is not None:
                    fm_elements[clean_lbl] = val

        # Col 7: BM Elements & Index
        lbl_bm = ws.cell(row=r, column=7).value
        if lbl_bm and isinstance(lbl_bm, str):
            clean_lbl = lbl_bm.strip().lstrip("-*• ")
            val = ws.cell(row=r, column=8).value
            if clean_lbl == "Index":
                if val is not None:
                    index_details["level"] = val
            elif clean_lbl in ("Prepared by", "Charge to", "Include drug names", "Follow previous edition", "Special instrux/concerns"):
                if val is not None:
                    index_details[clean_lbl.lower().replace(" ", "_")] = val
            elif clean_lbl not in ("BM Elements",):
                if val is not None:
                    bm_elements[clean_lbl] = val

    return {
        "file_and_page_breakdown": breakdown,
        "manuscript_elements": manuscript_elements,
        "fm_elements": fm_elements,
        "bm_elements": bm_elements,
        "toc_elements": toc_details,
        "index_details": index_details,
    }


def _extract_art_info(ws) -> dict:
    """Extract Art preparation settings and Figure Counts table."""
    art_prepared_by = n.clean(ws.cell(row=71, column=3).value)
    resizing_needed = n.clean(ws.cell(row=73, column=3).value)
    other_recs = n.clean(ws.cell(row=74, column=3).value)

    figure_counts = {}
    for r in range(73, 79):
        lbl = ws.cell(row=r, column=5).value
        if lbl and isinstance(lbl, str):
            key = lbl.strip()
            if key in ("1c line", "2c line", "4c line", "BW photo", "Color photo", "Total"):
                at_launch = ws.cell(row=r, column=6).value
                to_come = ws.cell(row=r, column=7).value
                total = ws.cell(row=r, column=8).value
                figure_counts[key] = {
                    "at_launch": at_launch,
                    "to_come": to_come,
                    "total": total,
                }

    return {
        "art_prepared_by": art_prepared_by,
        "resizing_needed": resizing_needed,
        "other_recommendations_or_concerns": other_recs,
        "figure_counts": figure_counts,
    }


def _extract_production_info(ws) -> dict:
    """Extract Production section: Copyediting, Page Proofs routing, and Batch Delivery Schedule."""
    ce_level = n.clean(_find_cell_exact_label(ws, "Level"))
    primary_style = n.clean(_find_cell_exact_label(ws, "Primary style"))
    secondary_style = n.clean(_find_cell_exact_label(ws, "Secondary style"))
    ref_style = n.clean(_find_cell_exact_label(ws, "Reference style"))
    double_number = n.clean(_find_cell_value(ws, r"Double\s+number\s+for\s+figures"))
    punctuation = n.clean(_find_cell_value(ws, r"punctuation\?"))
    ce_guidance_notes = n.clean(_find_cell_value(ws, r"Copyediting\s+guidance\s+notes"))
    authors_review_ce = n.clean(_find_cell_value(ws, r"Authors/editors\s+to\s+review\s+copyedited\s+MS"))

    # Page Proofs
    proofs_to = {}
    for r in range(91, 98):
        c2 = ws.cell(row=r, column=2).value
        if c2 and isinstance(c2, str):
            k = c2.strip().lstrip("-*• ")
            v = ws.cell(row=r, column=3).value
            if v is not None and k not in ("First-pass proofs to:",):
                proofs_to[k] = v

    corrections_from = n.clean(_find_cell_exact_label(ws, "Corrections to come from"))
    proof_instructions = n.clean(_find_cell_value(ws, r"Proof\s+routing\s+details"))
    ok_pagemajik = n.clean(_find_cell_value(ws, r"OK\s+to\s+send\s+via\s+PageMajik"))

    return {
        "copyediting": {
            "level": ce_level,
            "primary_style": primary_style,
            "secondary_style": secondary_style,
            "reference_style": ref_style,
            "double_number_figures_boxes_tables": double_number,
            "punctuation": punctuation,
            "guidance_notes": ce_guidance_notes,
            "authors_editors_to_review": authors_review_ce,
        },
        "page_proofs": {
            "first_pass_proofs_to": proofs_to,
            "corrections_to_come_from": corrections_from,
            "proof_routing_instructions": proof_instructions,
            "ok_to_send_via_pagemajik": ok_pagemajik,
        },
        "batch_delivery_schedule": _extract_batch_schedule(ws),
    }


def _extract_design_info(ws) -> dict:
    """Extract Design section specifications."""
    trim_size = n.clean(ws.cell(row=109, column=3).value)
    binder_size = n.clean(ws.cell(row=110, column=3).value)
    binder_color = n.clean(ws.cell(row=111, column=3).value)
    num_columns = n.to_int(ws.cell(row=112, column=3).value)
    colors = n.clean(ws.cell(row=113, column=3).value)
    pms_number = n.clean(ws.cell(row=114, column=3).value)
    interior_complexity = n.clean(ws.cell(row=115, column=3).value)

    color_insert = n.clean(ws.cell(row=109, column=6).value)
    num_pieces = n.to_int(ws.cell(row=110, column=6).value)
    num_pages = n.to_int(ws.cell(row=111, column=6).value)
    placement = n.clean(ws.cell(row=112, column=6).value)
    back_cover_copy = n.clean(ws.cell(row=113, column=6).value)
    notes = n.clean(ws.cell(row=114, column=6).value)
    title_page_dependent = n.clean(ws.cell(row=109, column=8).value)

    return {
        "trim_size": trim_size,
        "binder_size": binder_size,
        "binder_color": binder_color,
        "number_of_columns": num_columns,
        "colors": colors,
        "pms_number": pms_number,
        "interior_complexity": interior_complexity,
        "color_insert": color_insert,
        "color_insert_pieces": num_pieces,
        "color_insert_pages": num_pages,
        "color_insert_placement": placement,
        "back_cover_copy_from_marketing": back_cover_copy,
        "title_page_dependent_on_cover_design": title_page_dependent,
        "notes": notes,
    }


def _extract_digital_and_ebook_info(ws) -> dict:
    """Extract Digital section: eBook platforms, formats, and notes."""
    standard_formats = n.clean(ws.cell(row=133, column=6).value)
    epub3 = n.clean(ws.cell(row=134, column=6).value)
    epub3_ie = n.clean(ws.cell(row=135, column=6).value)
    vst_standard = n.clean(ws.cell(row=136, column=6).value)
    e_only_content = n.clean(ws.cell(row=138, column=6).value)
    vst_design = n.clean(ws.cell(row=147, column=6).value)
    vst_series = n.clean(ws.cell(row=148, column=6).value)
    conversion_type = n.clean(ws.cell(row=150, column=6).value)

    # Platforms
    health_library = n.clean(ws.cell(row=133, column=8).value)
    cases = n.clean(ws.cell(row=134, column=8).value)
    quizzing = n.clean(ws.cell(row=135, column=8).value)
    videos = n.clean(ws.cell(row=136, column=8).value)
    supplemental = n.clean(ws.cell(row=137, column=8).value)
    the_point = n.clean(ws.cell(row=140, column=8).value)
    ovid = n.clean(ws.cell(row=143, column=8).value)
    lippincott_connect = n.clean(ws.cell(row=145, column=8).value)
    course_point = n.clean(ws.cell(row=147, column=8).value)

    # Notes under eBook Platforms and Formats (clarify any needs not specified)
    ebook_notes = n.clean(ws.cell(row=150, column=8).value)

    # Enhanced conversion options
    enhanced_features = {}
    for r in range(152, 165):
        lbl = ws.cell(row=r, column=5).value
        if lbl and isinstance(lbl, str):
            feat_name = lbl.strip().lstrip("-*• ")
            val = ws.cell(row=r, column=6).value
            if val is not None:
                enhanced_features[feat_name] = val

    return {
        "standard_formats": standard_formats,
        "epub3": epub3,
        "epub3_international": epub3_ie,
        "vst_standard": vst_standard,
        "e_only_content": e_only_content,
        "vst_ebook_design": vst_design,
        "vst_series": vst_series,
        "conversion_type": conversion_type,
        "platforms": {
            "health_library": health_library,
            "cases": cases,
            "quizzing": quizzing,
            "videos": videos,
            "supplemental": supplemental,
            "the_point": the_point,
            "ovid": ovid,
            "lippincott_connect": lippincott_connect,
            "course_point": course_point,
        },
        "enhanced_features": enhanced_features,
        "notes": ebook_notes,
    }


def _extract_additional_notes(ws) -> str | None:
    """Extract content under 'Additional notes or special considerations'."""
    notes_parts: list[str] = []
    start_row = None
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "additional notes or special considerations" in cell.value.strip().lower():
                start_row = cell.row
                break
        if start_row:
            break

    if not start_row:
        return None

    # Collect any notes written in rows below start_row
    for r in range(start_row + 1, start_row + 15):
        for c in range(1, 10):
            val = ws.cell(row=r, column=c).value
            if val is not None and str(val).strip():
                cleaned = n.clean(val)
                if cleaned and cleaned not in notes_parts:
                    notes_parts.append(cleaned)

    return "\n".join(notes_parts) if notes_parts else None


def parse(xlsx_path: str) -> dict:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    warnings: list[str] = []

    ws = wb["BLF"] if "BLF" in wb.sheetnames else wb.worksheets[0]

    # --- Title & Subtitle ---
    title = n.clean(_find_cell_exact_label(ws, "Book title"))
    subtitle = n.clean(_find_cell_exact_label(ws, "Subtitle"))
    if title and subtitle:
        project_title = f"{title}: {subtitle}"
    else:
        project_title = title or subtitle

    # --- ISBN ---
    isbn_raw = _find_cell_value(ws, r"^ISBN(?:\s*13)?")
    isbn_no, isbn_warning = n.normalize_isbn(isbn_raw)
    if isbn_warning:
        warnings.append(isbn_warning)

    # VST eISBN / eBook ISBN
    vst_isbn_raw = _find_cell_value(ws, r"VST\s+eISBN")
    vst_isbn, _ = n.normalize_isbn(vst_isbn_raw)

    # --- Edition ---
    edition_raw = _find_cell_exact_label(ws, "Edition")
    edition = n.normalize_edition(edition_raw)

    # --- Category / Product Group ---
    product_group = n.clean(_find_cell_exact_label(ws, "Product group"))

    # --- Dates ---
    launch_date_raw = _find_cell_exact_label(ws, "Launch date")
    launch_date, l_warn = n.parse_date_loose(launch_date_raw)
    if l_warn:
        warnings.append(f"Launch date: {l_warn}")

    ftp_date_raw = _find_cell_value(ws, r"Scheduled\s+FTP\s+date")
    ftp_date, f_warn = n.parse_date_loose(ftp_date_raw)
    if f_warn and ftp_date_raw:
        warnings.append(f"Scheduled FTP date: {f_warn}")

    pub_date_raw = _find_cell_exact_label(ws, "Budgeted pub date")
    pub_date, p_warn = n.parse_date_loose(pub_date_raw)

    # Due date: only use Scheduled FTP date (PPM). If not present, leave empty (None).
    due_date = ftp_date

    # --- Team & Authors ---
    author_names, team_roles, author_details, author_notes = _extract_authors_and_team(ws)

    # Client Project Manager:
    # Prefer Production Product Manager (PPM) -> Editorial Coordinator (EC) -> Acquisitions Editor (AE)
    client_pm = team_roles.get("production_product_manager")

    # --- Manuscript & Page Counts ---
    ms_pages_raw = _find_cell_exact_label(ws, "Total manuscript pages")
    manuscript_pages = n.to_int(ms_pages_raw)

    budgeted_pages_raw = _find_cell_value(ws, r"Budgeted\s+Page\s+Count")
    estimated_pages_raw = _find_cell_value(ws, r"Estimated\s+Page\s+Count")
    estimated_pages = n.to_int(budgeted_pages_raw) or  n.to_int(estimated_pages_raw)

    # Chapter counts
    chapter_count = None
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and "# chapters" in cell.value.strip().lower():
                below_val = ws.cell(row=cell.row + 1, column=cell.column).value
                c_val = n.to_int(below_val)
                if c_val is not None:
                    chapter_count = c_val
                    break
        if chapter_count is not None:
            break

    # --- Design & Production Specs ---
    trim_size = n.clean(_find_cell_exact_label(ws, "Trim size"))
    colors = n.clean(_find_cell_exact_label(ws, "Colors"))
    columns = n.to_int(_find_cell_exact_label(ws, "Number of columns"))
    binding = n.clean(_find_cell_exact_label(ws, "Binding"))
    interior_complexity = n.clean(_find_cell_exact_label(ws, "Interior design complexity"))

    # Copyediting
    ce_level_raw = n.clean(_find_cell_exact_label(ws, "Level"))
    copyediting_level = "Level 1"
    if ce_level_raw:
        ce_lower = ce_level_raw.lower()
        if "level 2" in ce_lower or "offshore" in ce_lower:
            copyediting_level = "Level 2"
        elif "level 3" in ce_lower or "onshore" in ce_lower:
            copyediting_level = "Level 3"

    copyediting_style = n.clean(_find_cell_exact_label(ws, "Primary style"))

    # Copyright
    copyright_year = n.to_int(_find_cell_exact_label(ws, "Copyright year"))
    copyright_holder = n.clean(_find_cell_exact_label(ws, "Copyright holder"))

    description = n.clean(_find_cell_value(ws, r"Book description"))

    # Proof routing
    corrections_from = n.clean(_find_cell_exact_label(ws, "Corrections to come from"))
    proof_instructions = n.clean(_find_cell_value(ws, r"Proof\s+routing\s+details"))

    # Sample chapter for CE and Design
    sample_chapter = n.clean(_find_cell_value(ws, r"Sample\s+chapter(?:\(s\))?\s+for\s+CE\s+and\s+Design"))

    # Batch schedule
    batch_schedule = _extract_batch_schedule(ws)

    # Manuscript breakdown and elements
    manuscript_info = _extract_manuscript_info(ws)
    art_info = _extract_art_info(ws)
    production_info = _extract_production_info(ws)
    design_info = _extract_design_info(ws)
    digital_info = _extract_digital_and_ebook_info(ws)
    additional_notes = _extract_additional_notes(ws)

    fields = {
        "project_title": project_title,
        "isbn_no": isbn_no,
        "edition": edition,
        "due_date": due_date,
        "chapter_count": chapter_count,
        "manuscript_pages": manuscript_pages,
        "estimated_pages": estimated_pages,
        "color": colors,
        "trim_size": trim_size,
        "client_project_manager": client_pm,
        "copyediting_level": copyediting_level,
        "sample_chapter": sample_chapter,
        "billing_type": "full",
        "billing_location": "S4Carlisle Publishing Services-Singapore",
        "accessibility": "yes",
        "sales_person": "550",
    }

    extras = {
        "publisher": "Wolters Kluwer",
        "author_names": author_names,
        "author_details": author_details,
        "author_notes": author_notes,
        "ebook_isbn": vst_isbn,
        "description": description,
        "copyright_year": copyright_year,
        "copyright_holder": copyright_holder,
        "team": team_roles,
        "key_dates": {
            "launch_date": launch_date,
            "scheduled_ftp_date": ftp_date,
            "budgeted_pub_date": pub_date,
        },
        "production_specs": {
            "binding": binding,
            "number_of_columns": columns,
            "interior_complexity": interior_complexity,
            "copyediting_style": copyediting_style,
            "copyediting_level_raw": ce_level_raw,
            "corrections_to_come_from": corrections_from,
            "proof_instructions": proof_instructions,
        },
        "manuscript_info": manuscript_info,
        "art_info": art_info,
        "production_info": production_info,
        "design_info": design_info,
        "digital_info": digital_info,
        "additional_notes": additional_notes,
        "batch_schedule": batch_schedule,
    }

    return {"fields": fields, "extras": extras, "warnings": warnings}
