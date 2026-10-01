import logging
try:
    import pymupdf as fitz
except ImportError:
    import fitz

logger = logging.getLogger(__name__)

def check_pdf_security(pdf_path: str) -> dict:
    """
    Analyzes a PDF to determine if it has password protection or encryption.
    Returns a dict:
    {
        "is_free_of_protection": bool,
        "needs_pass": bool,
        "is_encrypted": bool
    }
    """
    try:
        doc = fitz.open(pdf_path)
        needs_pass = bool(doc.needs_pass)
        is_encrypted = bool(doc.is_encrypted)
        doc.close()
        
        return {
            "is_free_of_protection": not needs_pass and not is_encrypted,
            "needs_pass": needs_pass,
            "is_encrypted": is_encrypted
        }
    except Exception as e:
        logger.warning(f"Error checking PDF security for {pdf_path}: {e}")
        # Default to false on error so user is aware something failed
        return {
            "is_free_of_protection": False,
            "needs_pass": False,
            "is_encrypted": False,
            "error": str(e)
        }
