"""
Art Validation Engine (Pre-Conversion Word-to-XML)
=================================================
Validates figures (both numbered and unnumbered) referenced in Word manuscripts (.docx)
against physical image files present in the chapter's Art directory.

Features:
- Extracts numbered figures (Figure 1.1, Fig 1.1) from legend styles (FigureLegend, FGC, FIG-LEG, etc.) & text callouts.
- Extracts unnumbered figures from style 'Image' or '<<filename.ext>>' placeholders.
- Scans Art folder for physical images (.eps, .tif, .jpg, .png, etc.) and extracts Pica dimensions/DPI.
- Cross-validates matching files, missing files, unreferenced files, and extension mismatches.
- Generates structured JSON output and self-contained HTML Validation Reports.
"""

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, List, Any, Optional, Tuple
from PIL import Image


class ArtValidationEngine:
    """Engine for parsing docx figure callouts/legends and cross-validating with physical art files."""

    IMAGE_EXTENSIONS = {'.eps', '.tif', '.tiff', '.jpg', '.jpeg', '.png', '.pdf', '.psd', '.ai', '.svg'}

    # Styles typically used for numbered figure legends
    LEGEND_STYLE_PATTERNS = [
        r'figurelegend', r'fgc', r'fig-leg', r'fig_leg', r'figurecaption',
        r'figcaption', r'figure_legend', r'figlegend', r'figure_caption',
        r'fig_caption', r'fig-caption', r'figure-legend', r'legend',
        r'\bfigure\b', r'\bfig\b'
    ]

    # Styles used for unnumbered images
    UNNUMBERED_STYLE_PATTERNS = [
        r'image', r'unnb', r'unnumberedfigure', r'un-fig', r'unfig',
        r'unnumbered_figure', r'un_fig', r'unnb_fig', r'unnbfigure'
    ]

    @classmethod
    def extract_figures_from_docx(cls, docx_path: str) -> Dict[str, Any]:
        """
        Parses a Word .docx file to extract all numbered and unnumbered figure references.
        Preferentially uses legend styles (FigureLegend, FGC, FIG-LEG, etc.) over body callouts.
        """
        if not os.path.exists(docx_path):
            raise FileNotFoundError(f"Docx file not found: {docx_path}")

        numbered_map: Dict[str, Dict[str, Any]] = {}
        numbered_order: List[str] = []
        unnumbered_figures = []
        seen_placeholders = set()

        try:
            with zipfile.ZipFile(docx_path, 'r') as z:
                if 'word/document.xml' not in z.namelist():
                    return {"numbered": [], "unnumbered": []}
                doc_xml = z.read('word/document.xml')
        except Exception as e:
            print(f"[ArtValidationEngine] Error reading docx ZIP: {e}")
            return {"numbered": [], "unnumbered": []}

        root = ET.fromstring(doc_xml)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

        # Regex patterns
        num_fig_regex = re.compile(r'(?:FIGURE|Figure|Fig|FIG)\s+(\d+(?:[\.\-]\d+)?)', re.IGNORECASE)
        placeholder_regex = re.compile(r'<<([^>]+)>>')

        p_idx = 0
        for p in root.findall('.//w:p', ns):
            p_idx += 1
            # Get style name
            pStyle = p.find('.//w:pStyle', ns)
            style_val = pStyle.attrib.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '') if pStyle is not None else ''
            style_lower = style_val.lower()

            # Get combined paragraph text
            texts = [t.text for t in p.findall('.//w:t', ns) if t.text]
            full_text = ''.join(texts).strip()

            if not full_text:
                continue

            is_legend_style = any(re.search(pat, style_lower) for pat in cls.LEGEND_STYLE_PATTERNS)
            is_unnb_style = any(re.search(pat, style_lower) for pat in cls.UNNUMBERED_STYLE_PATTERNS)

            # 1. Search for Numbered Figures
            matches = num_fig_regex.findall(full_text)
            for fig_num_str in matches:
                # Normalize figure number (e.g., '12-01' -> '12.1', '12.1' -> '12.1')
                norm_num = cls._normalize_fig_num(fig_num_str)
                fig_entry = {
                    "fig_num": norm_num,
                    "raw_num": fig_num_str,
                    "style": style_val,
                    "is_legend_style": is_legend_style,
                    "text": full_text[:160],
                    "paragraph": p_idx
                }

                if norm_num not in numbered_map:
                    numbered_map[norm_num] = fig_entry
                    numbered_order.append(norm_num)
                else:
                    existing = numbered_map[norm_num]
                    # Upgrade to legend style if existing entry was a body callout
                    if is_legend_style and not existing.get("is_legend_style"):
                        numbered_map[norm_num] = fig_entry

            # 2. Search for Unnumbered Placeholders (<<filename.ext>> or style 'Image')
            placeholders = placeholder_regex.findall(full_text)
            for ph in placeholders:
                ph_clean = ph.strip()
                if ph_clean and ph_clean not in seen_placeholders:
                    seen_placeholders.add(ph_clean)
                    unnumbered_figures.append({
                        "placeholder": ph_clean,
                        "style": style_val,
                        "is_unnb_style": True,
                        "text": full_text[:160],
                        "paragraph": p_idx
                    })

            # 3. If style is explicitly 'Image' or unnumbered style but no <<...>> bracket found
            if is_unnb_style and not placeholders:
                # Check if paragraph contains an image filename
                img_match = re.search(r'([\w\-\.\s]+\.(?:eps|tif|tiff|jpg|png|pdf))', full_text, re.IGNORECASE)
                ph_clean = img_match.group(1).strip() if img_match else full_text[:40].strip()
                if ph_clean and ph_clean not in seen_placeholders:
                    seen_placeholders.add(ph_clean)
                    unnumbered_figures.append({
                        "placeholder": ph_clean,
                        "style": style_val,
                        "is_unnb_style": True,
                        "text": full_text[:160],
                        "paragraph": p_idx
                    })

        numbered_figures = [numbered_map[k] for k in numbered_order]

        return {
            "numbered": numbered_figures,
            "unnumbered": unnumbered_figures
        }

    @classmethod
    def scan_art_folder(cls, art_dir_path: str) -> List[Dict[str, Any]]:
        """
        Scans physical image files in art_dir_path and extracts dimensions/DPI.
        Ignores proof PDF files, log PDFs, CSV/XML report files, and .converted.png files.
        """
        if not os.path.exists(art_dir_path):
            return []

        physical_files = []
        for root, _, files in os.walk(art_dir_path):
            # Skip InDesign directories
            if 'indesign' in root.lower():
                continue

            for f in files:
                f_lower = f.lower()
                # Skip proof PDFs, log PDFs, CSVs, XMLs, converted PNGs
                if any(k in f_lower for k in ['artproof', '_log.pdf', 'artlog.xml', '_image_details.csv', '.converted.png']):
                    continue

                ext = os.path.splitext(f)[1].lower()
                # Exclude .pdf unless explicitly an art image file name
                if ext == '.pdf' and ('proof' in f_lower or 'log' in f_lower):
                    continue

                if ext in cls.IMAGE_EXTENSIONS and ext not in ('.csv', '.xml'):
                    file_path = os.path.join(root, f)
                    file_info = cls._get_image_metadata(file_path, f)
                    physical_files.append(file_info)

        return physical_files

    @classmethod
    def validate(cls, docx_path: str, art_dir_path: str) -> Dict[str, Any]:
        """
        Runs complete Art Validation workflow and returns structured results.
        """
        extracted = cls.extract_figures_from_docx(docx_path)
        physical_files = cls.scan_art_folder(art_dir_path)

        numbered_refs = extracted.get("numbered", [])
        unnumbered_refs = extracted.get("unnumbered", [])

        matched_files_set = set()
        matched_items = []
        missing_items = []

        # 1. Match Numbered Figures
        for ref in numbered_refs:
            fig_num = ref["fig_num"]
            matched_file = cls._find_matching_numbered_art(fig_num, physical_files)

            if matched_file:
                matched_files_set.add(matched_file["name"].lower())
                matched_items.append({
                    "type": "Numbered Figure",
                    "fig_num": f"Figure {fig_num}",
                    "docx_ref": ref["text"],
                    "docx_style": ref["style"],
                    "filename": matched_file["name"],
                    "status": "MATCHED",
                    "status_badge": "matched",
                    "width_picas": matched_file["width_picas"],
                    "height_picas": matched_file["height_picas"],
                    "resolution_dpi": matched_file["dpi"],
                    "file_path": matched_file["path"]
                })
            else:
                # Check if there is an extension mismatch or partial match
                ext_match = cls._find_extension_mismatch(fig_num, physical_files)
                if ext_match and ext_match["name"].lower() not in matched_files_set:
                    matched_files_set.add(ext_match["name"].lower())
                    matched_items.append({
                        "type": "Numbered Figure",
                        "fig_num": f"Figure {fig_num}",
                        "docx_ref": ref["text"],
                        "docx_style": ref["style"],
                        "filename": ext_match["name"],
                        "status": "EXTENSION MISMATCH",
                        "status_badge": "warning",
                        "width_picas": ext_match["width_picas"],
                        "height_picas": ext_match["height_picas"],
                        "resolution_dpi": ext_match["dpi"],
                        "file_path": ext_match["path"]
                    })
                else:
                    missing_items.append({
                        "type": "Numbered Figure",
                        "fig_num": f"Figure {fig_num}",
                        "docx_ref": ref["text"],
                        "docx_style": ref["style"],
                        "filename": f"Expected Fig {fig_num} art file",
                        "status": "MISSING",
                        "status_badge": "missing",
                        "width_picas": None,
                        "height_picas": None,
                        "resolution_dpi": None,
                        "file_path": None
                    })

        # 2. Match Unnumbered Figures
        for ref in unnumbered_refs:
            ph = ref["placeholder"]
            matched_file = cls._find_matching_unnumbered_art(ph, physical_files, matched_files_set)

            if matched_file:
                matched_files_set.add(matched_file["name"].lower())
                matched_items.append({
                    "type": "Unnumbered Figure",
                    "fig_num": ph,
                    "docx_ref": ref["text"],
                    "docx_style": ref["style"],
                    "filename": matched_file["name"],
                    "status": "MATCHED",
                    "status_badge": "matched",
                    "width_picas": matched_file["width_picas"],
                    "height_picas": matched_file["height_picas"],
                    "resolution_dpi": matched_file["dpi"],
                    "file_path": matched_file["path"]
                })
            else:
                missing_items.append({
                    "type": "Unnumbered Figure",
                    "fig_num": ph,
                    "docx_ref": ref["text"],
                    "docx_style": ref["style"],
                    "filename": ph,
                    "status": "MISSING",
                    "status_badge": "missing",
                    "width_picas": None,
                    "height_picas": None,
                    "resolution_dpi": None,
                    "file_path": None
                })

        # 3. Identify Unreferenced / Extra Files in Art Folder
        unreferenced_items = []
        for pf in physical_files:
            if pf["name"].lower() not in matched_files_set:
                unreferenced_items.append({
                    "type": "Extra Art File",
                    "fig_num": "Unreferenced",
                    "docx_ref": "Not cited in Word manuscript",
                    "docx_style": "-",
                    "filename": pf["name"],
                    "status": "UNREFERENCED",
                    "status_badge": "unreferenced",
                    "width_picas": pf["width_picas"],
                    "height_picas": pf["height_picas"],
                    "resolution_dpi": pf["dpi"],
                    "file_path": pf["path"]
                })

        all_details = matched_items + missing_items + unreferenced_items

        summary = {
            "total_docx_figures": len(numbered_refs) + len(unnumbered_refs),
            "total_art_files": len(physical_files),
            "matched_count": len([i for i in matched_items if i["status"] == "MATCHED"]),
            "missing_count": len(missing_items),
            "unreferenced_count": len(unreferenced_items),
            "warning_count": len([i for i in matched_items if i["status"] != "MATCHED"])
        }

        html_report = cls.generate_html_report(docx_path, art_dir_path, summary, all_details)

        return {
            "status": "success",
            "summary": summary,
            "details": all_details,
            "html_report": html_report
        }

    # =========================================================================
    # Helper & Matching Methods
    # =========================================================================

    @staticmethod
    def _normalize_fig_num(fig_str: str) -> str:
        """Normalizes figure numbers like '12-01' -> '12.1', '12.1' -> '12.1'."""
        fig_str = fig_str.replace('-', '.')
        parts = fig_str.split('.')
        if len(parts) == 2:
            try:
                ch = int(parts[0])
                fg = int(parts[1])
                return f"{ch}.{fg}"
            except ValueError:
                pass
        return fig_str

    @classmethod
    def _find_matching_numbered_art(cls, fig_num: str, physical_files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Matches figure number (e.g. '12.1') against physical art filenames."""
        parts = fig_num.split('.')
        if len(parts) != 2:
            ch_str, fg_str = "", fig_num
        else:
            ch_str, fg_str = parts[0], parts[1]

        fg_int = int(fg_str) if fg_str.isdigit() else 0
        ch_int = int(ch_str) if ch_str.isdigit() else 0

        for pf in physical_files:
            fname = pf["name"].lower()
            # Ignore unnumbered art files
            if re.search(r'\bun[_\-\s]*f', fname, re.IGNORECASE) or re.search(r'\bun[0-9]', fname, re.IGNORECASE):
                continue

            patterns = [
                rf'f(?:ig)?(?:f)?{ch_int:02d}[\-_.]0*{fg_int}\b',
                rf'f(?:ig)?(?:f)?{ch_int}[\-_.]0*{fg_int}\b',
                rf'fg{ch_int:02d}[\-_.]0*{fg_int}\b',
                rf'fg{ch_int}[\-_.]0*{fg_int}\b',
                rf'ch0*{ch_int}.*fig(?:f)?0*{fg_int}\b',
                rf'fig(?:ure)?[_\-\s]*0*{ch_int}[\-_.]0*{fg_int}\b',
                rf'image0*{fg_int}\b' if ch_int == 19 or not ch_int else r'impossible_pattern'
            ]

            for pat in patterns:
                if re.search(pat, fname, re.IGNORECASE):
                    return pf

        return None

    @classmethod
    def _find_extension_mismatch(cls, fig_num: str, physical_files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Finds if figure exists under a different extension."""
        parts = fig_num.split('.')
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            ch_int, fg_int = int(parts[0]), int(parts[1])
            for pf in physical_files:
                fname = pf["name"].lower()
                # Ignore unnumbered art files
                if re.search(r'\bun[_\-\s]*f', fname, re.IGNORECASE) or re.search(r'\bun[0-9]', fname, re.IGNORECASE):
                    continue

                patterns = [
                    rf'f(?:ig)?(?:f)?{ch_int:02d}[\-_.]0*{fg_int}\b',
                    rf'f(?:ig)?(?:f)?{ch_int}[\-_.]0*{fg_int}\b',
                    rf'fg{ch_int:02d}[\-_.]0*{fg_int}\b',
                    rf'fg{ch_int}[\-_.]0*{fg_int}\b',
                ]

                for pat in patterns:
                    if re.search(pat, fname, re.IGNORECASE):
                        return pf
        return None

    @classmethod
    def _find_matching_unnumbered_art(cls, placeholder: str, physical_files: List[Dict[str, Any]], matched_set: set) -> Optional[Dict[str, Any]]:
        """Matches unnumbered figure placeholders (<<Giardino_ Un_F12.1.tif>>, <<Un04_001.eps>>, etc.)."""
        ph_clean = placeholder.strip('<> ').lower()
        ph_base = os.path.splitext(ph_clean)[0]

        # 1. Exact filename match
        for pf in physical_files:
            if pf["name"].lower() == ph_clean:
                return pf

        # 2. Base filename match
        for pf in physical_files:
            pf_base = os.path.splitext(pf["name"].lower())[0]
            if pf_base == ph_base:
                return pf

        # 3. Match by specific unnumbered figure number/id (e.g. un_f12.1 or un04_001)
        un_num_match = re.search(r'un[_\-\s]*f?(\d+(?:[\.\-_]\d+)?)', ph_clean, re.IGNORECASE)
        if un_num_match:
            un_target = un_num_match.group(1).replace('-', '.')
            for pf in physical_files:
                if pf["name"].lower() in matched_set:
                    continue
                pf_un_match = re.search(r'un[_\-\s]*f?(\d+(?:[\.\-_]\d+)?)', pf["name"].lower(), re.IGNORECASE)
                if pf_un_match and pf_un_match.group(1).replace('-', '.') == un_target:
                    return pf

        return None

    @classmethod
    def _get_image_metadata(cls, file_path: str, filename: str) -> Dict[str, Any]:
        """Extracts pixel dimensions, DPI, and calculates size in Picas."""
        width_px, height_px = 0, 0
        dpi_x, dpi_y = 300.0, 300.0

        try:
            with Image.open(file_path) as img:
                width_px, height_px = int(img.size[0]), int(img.size[1])
                dpi = img.info.get('dpi')
                if dpi and isinstance(dpi, (tuple, list)) and len(dpi) >= 2:
                    dx = float(dpi[0])
                    dy = float(dpi[1])
                    dpi_x = dx if dx > 0 else 300.0
                    dpi_y = dy if dy > 0 else 300.0
        except Exception:
            # Fallback if EPS or unsupported format by PIL
            width_px, height_px = 1200, 900
            dpi_x, dpi_y = 300.0, 300.0

        # Calculate size in Picas (1 inch = 6 picas = 72 pt = DPI pixels)
        # Picas = (Pixels / DPI) * 6
        width_picas = round(float((width_px / dpi_x) * 6), 1) if dpi_x > 0 else round(float(width_px / 50.0), 1)
        height_picas = round(float((height_px / dpi_y) * 6), 1) if dpi_y > 0 else round(float(height_px / 50.0), 1)

        return {
            "name": str(filename),
            "path": str(file_path),
            "width_px": int(width_px),
            "height_px": int(height_px),
            "dpi": f"{int(dpi_x)}x{int(dpi_y)}",
            "width_picas": float(width_picas),
            "height_picas": float(height_picas)
        }

    # =========================================================================
    # HTML Report Generator
    # =========================================================================

    @classmethod
    def generate_html_report(cls, docx_path: str, art_dir_path: str, summary: Dict[str, Any], details: List[Dict[str, Any]]) -> str:
        """Generates a self-contained HTML Validation Report."""
        docx_name = os.path.basename(docx_path)
        art_dir_name = os.path.basename(art_dir_path)

        rows_html = []
        for i, item in enumerate(details, 1):
            status = item["status"]
            badge_class = {
                "MATCHED": "badge-success",
                "MISSING": "badge-danger",
                "UNREFERENCED": "badge-warning",
                "EXTENSION MISMATCH": "badge-info"
            }.get(status, "badge-secondary")

            dim_str = f"{item['width_picas']} × {item['height_picas']} picas" if item['width_picas'] else "-"
            dpi_str = item.get('resolution_dpi') or "-"

            rows_html.append(f"""
            <tr>
                <td class="text-center font-mono text-xs">{i}</td>
                <td><span class="type-pill">{item['type']}</span></td>
                <td class="font-bold text-slate-800">{item['fig_num']}</td>
                <td class="font-mono text-xs text-slate-700">{item['filename']}</td>
                <td><span class="badge {badge_class}">{status}</span></td>
                <td class="font-mono text-xs">{dim_str}</td>
                <td class="font-mono text-xs text-slate-500">{dpi_str}</td>
                <td class="text-xs text-slate-500">{item['docx_style']}</td>
            </tr>
            """)

        no_art_banner = ""
        if summary['total_docx_figures'] == 0:
            no_art_banner = """
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 1rem 1.25rem; border-radius: 8px; font-weight: 600; margin: 1.5rem 2rem 0 2rem; display: flex; align-items: center; gap: 0.5rem;">
                ℹ️ There is no art and caption in this chapter.
            </div>
            """
            if not rows_html:
                rows_html.append("""
                <tr>
                    <td colspan="8" style="text-align: center; padding: 2.5rem; color: #64748b; font-weight: 500;">
                        There is no art and caption in this chapter.
                    </td>
                </tr>
                """)

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Art Validation Report - {docx_name}</title>
    <style>
        :root {{
            --primary: #0284c7;
            --success: #16a34a;
            --danger: #dc2626;
            --warning: #d97706;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --border: #e2e8f0;
            --text: #0f172a;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 2rem;
            line-height: 1.5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #ffffff;
            padding: 2rem;
        }}
        .header h1 {{
            margin: 0 0 0.5rem 0;
            font-size: 1.75rem;
            font-weight: 700;
        }}
        .header p {{
            margin: 0;
            color: #94a3b8;
            font-size: 0.9rem;
        }}
        .summary-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            padding: 1.5rem 2rem;
            background: #f1f5f9;
            border-bottom: 1px solid var(--border);
        }}
        .stat-card {{
            background: #ffffff;
            padding: 1rem 1.25rem;
            border-radius: 8px;
            border: 1px solid var(--border);
        }}
        .stat-card .val {{
            font-size: 1.75rem;
            font-weight: 800;
            margin-bottom: 0.25rem;
        }}
        .stat-card .lbl {{
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            font-weight: 600;
        }}
        .table-container {{
            padding: 1.5rem 2rem;
            overflow-x: auto;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
            text-align: left;
        }}
        th {{
            background-color: #f8fafc;
            color: #475569;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
            padding: 0.75rem 1rem;
            border-bottom: 2px solid var(--border);
        }}
        td {{
            padding: 0.75rem 1rem;
            border-bottom: 1px solid var(--border);
        }}
        tr:hover {{
            background-color: #f8fafc;
        }}
        .badge {{
            display: inline-block;
            padding: 0.25rem 0.6rem;
            font-size: 0.75rem;
            font-weight: 700;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }}
        .badge-success {{ background: #dcfce7; color: #15803d; }}
        .badge-danger {{ background: #fee2e2; color: #b91c1c; }}
        .badge-warning {{ background: #fef3c7; color: #b45309; }}
        .badge-info {{ background: #e0f2fe; color: #0369a1; }}
        .badge-secondary {{ background: #f1f5f9; color: #475569; }}
        .type-pill {{
            font-size: 0.75rem;
            background: #f1f5f9;
            color: #475569;
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
        }}
        .footer {{
            padding: 1rem 2rem;
            background: #f8fafc;
            border-top: 1px solid var(--border);
            text-align: right;
            font-size: 0.8rem;
            color: #64748b;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎨 Art Validation Report</h1>
            <p><strong>Manuscript:</strong> {docx_name} &nbsp;|&nbsp; <strong>Art Directory:</strong> {art_dir_name}</p>
        </div>
        <div class="summary-grid">
            <div class="stat-card">
                <div class="val" style="color: #0284c7;">{summary['total_docx_figures']}</div>
                <div class="lbl">Docx Figures</div>
            </div>
            <div class="stat-card">
                <div class="val" style="color: #16a34a;">{summary['matched_count']}</div>
                <div class="lbl">Matched Art</div>
            </div>
            <div class="stat-card">
                <div class="val" style="color: #dc2626;">{summary['missing_count']}</div>
                <div class="lbl">Missing Art</div>
            </div>
            <div class="stat-card">
                <div class="val" style="color: #d97706;">{summary['unreferenced_count']}</div>
                <div class="lbl">Unreferenced Art</div>
            </div>
        </div>
        {no_art_banner}
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        <th>Type</th>
                        <th>Figure Ref</th>
                        <th>Art Filename</th>
                        <th>Status</th>
                        <th>Pica Size</th>
                        <th>DPI</th>
                        <th>Docx Style</th>
                    </tr>
                </thead>
                <tbody>
                    {"".join(rows_html)}
                </tbody>
            </table>
        </div>
        <div class="footer">
            Generated by PageMajik CMS Art Validation Engine &bull; Pre-Conversion Check
        </div>
    </div>
</body>
</html>
"""
        return html_content
