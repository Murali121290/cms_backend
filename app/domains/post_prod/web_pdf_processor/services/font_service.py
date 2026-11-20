import logging
import os
import re
import shutil
import subprocess
try:
    import pymupdf as fitz
except ImportError:
    import fitz

logger = logging.getLogger(__name__)

def check_fonts_embedded(pdf_path: str) -> dict:
    """
    Analyzes a PDF to determine if all its fonts are fully embedded.
    Optimized for high-volume 1,000+ page books:
    - Scans font xrefs directly via get_page_fonts across pages without heavy full-page dict rendering.
    - Caches xref checks so unique fonts are only inspected once.
    """
    doc = fitz.open(pdf_path)
    all_fonts = set()
    embedded_fonts = set()
    missing_fonts = set()
    checked_xrefs = {}  # xref -> bool (is_embedded)

    # 1. Collect unique font xrefs across all pages (very fast: ~1.5s for 2,000 pages)
    for page_num in range(len(doc)):
        try:
            fonts = doc.get_page_fonts(page_num)
        except Exception as e:
            logger.warning(f"Error reading fonts on page {page_num}: {e}")
            continue

        for f in fonts:
            xref = f[0]
            basefont = f[3]
            font_name = basefont if basefont else f"Unknown Font (xref: {xref})"

            all_fonts.add(font_name)

            if font_name in embedded_fonts:
                continue

            # Check if this font xref was already analyzed
            if xref in checked_xrefs:
                if checked_xrefs[xref]:
                    embedded_fonts.add(font_name)
                    missing_fonts.discard(font_name)
                else:
                    if font_name not in embedded_fonts:
                        missing_fonts.add(font_name)
                continue

            try:
                # First check via PyMuPDF native font extractor (most reliable across all PDF standards)
                is_embedded = False
                try:
                    font_extracted = doc.extract_font(xref)
                    # font_extracted is a tuple: (name, ext, type, buffer)
                    if font_extracted and len(font_extracted) >= 4 and font_extracted[3]:
                        is_embedded = True
                except Exception:
                    is_embedded = False

                if not is_embedded:
                    font_dict_str = doc.xref_object(xref)

                    # 1. Direct FontDescriptor on the font object
                    fd_xrefs = []
                    m_direct = re.search(r'/FontDescriptor\s+(\d+)\s+0\s+R', font_dict_str)
                    if m_direct:
                        fd_xrefs.append(int(m_direct.group(1)))

                    # 2. Type0 composite font: FontDescriptor is inside DescendantFonts
                    # DescendantFonts can be an inline array: /DescendantFonts [ 2379 0 R ]
                    # or an indirect reference: /DescendantFonts 2378 0 R where 2378 is [ 2379 0 R ]
                    m_desc = re.search(r'/DescendantFonts\s*\[\s*(\d+)\s+0\s+R\s*\]', font_dict_str)
                    if m_desc:
                        desc_xref = int(m_desc.group(1))
                        desc_dict_str = doc.xref_object(desc_xref)
                        m_desc_fd = re.search(r'/FontDescriptor\s+(\d+)\s+0\s+R', desc_dict_str)
                        if m_desc_fd:
                            fd_xrefs.append(int(m_desc_fd.group(1)))
                    else:
                        m_desc_ref = re.search(r'/DescendantFonts\s+(\d+)\s+0\s+R', font_dict_str)
                        if m_desc_ref:
                            array_xref = int(m_desc_ref.group(1))
                            array_str = doc.xref_object(array_xref)
                            for m_elem in re.finditer(r'(\d+)\s+0\s+R', array_str):
                                desc_xref = int(m_elem.group(1))
                                desc_dict_str = doc.xref_object(desc_xref)
                                m_desc_fd = re.search(r'/FontDescriptor\s+(\d+)\s+0\s+R', desc_dict_str)
                                if m_desc_fd:
                                    fd_xrefs.append(int(m_desc_fd.group(1)))

                    # Check each referenced FontDescriptor for FontFile streams
                    for fd_xref in fd_xrefs:
                        fd_dict_str = doc.xref_object(fd_xref)
                        if any(k in fd_dict_str for k in ("FontFile", "FontFile2", "FontFile3")):
                            is_embedded = True
                            break

                checked_xrefs[xref] = is_embedded
                if is_embedded:
                    embedded_fonts.add(font_name)
                    missing_fonts.discard(font_name)
                else:
                    if font_name not in embedded_fonts:
                        missing_fonts.add(font_name)

            except Exception as e:
                logger.warning(f"Error parsing font xref {xref}: {e}")
                checked_xrefs[xref] = False
                if font_name not in embedded_fonts:
                    missing_fonts.add(font_name)

    doc.close()

    return {
        "all_embedded": len(missing_fonts) == 0,
        "missing_fonts": sorted(list(missing_fonts)),
        "embedded_fonts": sorted(list(embedded_fonts)),
        "total_fonts": len(all_fonts)
    }

def fix_embed_fonts(pdf_path: str, output_path: str = None) -> dict:
    """
    Embeds all missing and subset fonts in a PDF using Ghostscript prepress distillation.
    Replaces output_path (or original pdf_path) and returns updated font status.
    """
    if not output_path:
        output_path = pdf_path

    # First check if all rendered text fonts are already embedded
    current_status = check_fonts_embedded(pdf_path)
    if current_status.get("all_embedded"):
        logger.info("All fonts in rendered text are already embedded. Skipping Ghostscript to preserve ligatures.")
        if output_path != pdf_path:
            shutil.copy2(pdf_path, output_path)
        return {
            "success": True,
            "message": "All rendered text fonts are already embedded. Ghostscript re-distillation skipped.",
            "status": current_status
        }

    temp_out = pdf_path + ".embedded.tmp.pdf"

    # Find ghostscript binary across environments (Linux container or Windows)
    gs_cmd = None
    for candidate in ["gs", "gswin64c", "gswin32c"]:
        if shutil.which(candidate):
            gs_cmd = candidate
            break

    if not gs_cmd:
        logger.error("Ghostscript executable (gs) not found in system PATH.")
        return {
            "success": False,
            "error": "Ghostscript (gs) is not installed on the server. Please ensure Ghostscript is available.",
            "status": check_fonts_embedded(pdf_path)
        }

    cmd = [
        gs_cmd,
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        "-dPDFSETTINGS=/prepress",
        "-dEmbedAllFonts=true",
        "-dSubsetFonts=true",
        "-dAutoRotatePages=/None",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-sOutputFile={temp_out}",
        pdf_path
    ]

    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        if res.returncode != 0:
            err_msg = res.stderr or res.stdout or f"Ghostscript exited with code {res.returncode}"
            logger.error(f"Ghostscript font embedding failed: {err_msg}")
            if os.path.exists(temp_out):
                try:
                    os.remove(temp_out)
                except Exception:
                    pass
            return {
                "success": False,
                "error": err_msg,
                "status": check_fonts_embedded(pdf_path)
            }

        # Replace file safely
        if os.path.exists(temp_out):
            shutil.move(temp_out, output_path)

        # Re-check font status
        updated_status = check_fonts_embedded(output_path)
        return {
            "success": True,
            "error": None,
            "status": updated_status
        }
    except Exception as e:
        logger.error(f"Exception during font embedding: {e}")
        if os.path.exists(temp_out):
            try:
                os.remove(temp_out)
            except Exception:
                pass
        return {
            "success": False,
            "error": str(e),
            "status": check_fonts_embedded(pdf_path)
        }
