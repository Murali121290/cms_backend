import os
import logging
import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

def extract_pdf_to_s4c(pdf_path: str) -> str:
    """
    Extracts text and layout information from a PDF and 
    wraps it into the baseline S4C XML format.
    
    Args:
        pdf_path: Absolute path to the source PDF file.
        
    Returns:
        A string containing the generated S4C XML.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")
    
    logger.info(f"Extracting PDF to S4C XML: {pdf_path}")
    
    # Basic scaffolding using PyMuPDF
    doc = fitz.open(pdf_path)
    
    s4c_xml = ["<?xml version='1.0' encoding='UTF-8'?>", "<s4c_document>"]
    s4c_xml.append("<metadata>")
    s4c_xml.append(f"<title>{doc.metadata.get('title', 'Unknown')}</title>")
    s4c_xml.append(f"<author>{doc.metadata.get('author', 'Unknown')}</author>")
    s4c_xml.append(f"<pages>{doc.page_count}</pages>")
    s4c_xml.append("</metadata>")
    
    s4c_xml.append("<body>")
    for page_num in range(doc.page_count):
        page = doc.load_page(page_num)
        text = page.get_text("text").strip()
        # Very basic escaping
        text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        
        s4c_xml.append(f"<page number='{page_num + 1}'>")
        if text:
            s4c_xml.append(f"<content>{text}</content>")
        s4c_xml.append("</page>")
        
    s4c_xml.append("</body>")
    s4c_xml.append("</s4c_document>")
    
    doc.close()
    
    return "\n".join(s4c_xml)
