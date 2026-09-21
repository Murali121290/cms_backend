import logging
import re
try:
    import pymupdf as fitz
except ImportError:
    import fitz

logger = logging.getLogger(__name__)

def check_fonts_embedded(pdf_path: str) -> dict:
    """
    Analyzes a PDF to determine if all its fonts are fully embedded.
    Returns a dict:
    {
        "all_embedded": bool,
        "missing_fonts": list of str,
        "embedded_fonts": list of str
    }
    """
    doc = fitz.open(pdf_path)
    all_fonts = set()
    embedded_fonts = set()
    missing_fonts = set()

    # Iterate through all pages
    for page_num in range(len(doc)):
        try:
            fonts = doc.get_page_fonts(page_num)
        except Exception as e:
            logger.warning(f"Error reading fonts on page {page_num}: {e}")
            continue

        for f in fonts:
            xref = f[0]
            basefont = f[3]
            
            # Use the basefont name as the unique identifier for user display
            font_name = basefont if basefont else f"Unknown Font (xref: {xref})"
            all_fonts.add(font_name)

            if font_name in embedded_fonts or font_name in missing_fonts:
                continue

            try:
                # Retrieve the font dictionary string
                font_dict_str = doc.xref_object(xref)
                
                is_embedded = False
                
                # Check for FontDescriptor
                if "/FontDescriptor" in font_dict_str:
                    match = re.search(r'/FontDescriptor\s+(\d+)\s+0\s+R', font_dict_str)
                    if match:
                        fd_xref = int(match.group(1))
                        fd_dict_str = doc.xref_object(fd_xref)
                        
                        # Check for FontFile, FontFile2, or FontFile3 in the descriptor
                        if "FontFile" in fd_dict_str or "FontFile2" in fd_dict_str or "FontFile3" in fd_dict_str:
                            is_embedded = True

                # Fallback / Exception for standard 14 fonts which may not need embedding,
                # but typically for print-ready PDFs, even standard fonts SHOULD be embedded.
                # If they are strictly not embedded, we record them as missing.
                
                if is_embedded:
                    embedded_fonts.add(font_name)
                else:
                    missing_fonts.add(font_name)
                    
            except Exception as e:
                logger.warning(f"Error parsing font xref {xref}: {e}")
                missing_fonts.add(font_name)
                
    doc.close()

    return {
        "all_embedded": len(missing_fonts) == 0,
        "missing_fonts": sorted(list(missing_fonts)),
        "embedded_fonts": sorted(list(embedded_fonts)),
        "total_fonts": len(all_fonts)
    }
