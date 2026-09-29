import logging
import traceback
from typing import List, Dict

logger = logging.getLogger(__name__)

def validate_xml(xml_path: str, format: str) -> List[Dict]:
    """
    Validates the generated XML against official DTDs.
    
    Args:
        xml_path: Path to the generated XML.
        format: Target format (JATS or BITS).
        
    Returns:
        A list of dictionaries representing validation errors.
        E.g. [{"line_number": 10, "error_type": "DTD", "message": "Missing required element <title>"}]
    """
    errors = []
    logger.info(f"Validating {xml_path} against {format} DTD")
    
    try:
        # 1. Parse XML using lxml
        from lxml import etree
        try:
            doc = etree.parse(xml_path)
        except etree.XMLSyntaxError as e:
            return [{"line_number": e.lineno or 0, "error_type": "XMLSyntax", "message": str(e)}]
        
        # 2. DTD Validation
        import os
        base_dir = os.path.dirname(__file__)
        if format.upper() == "BITS":
            dtd_path = os.path.join(base_dir, "..", "..", "..", "processing", "legacy", "wordtoxml", "BITS-Book-1.0-DTD", "BITS-book1.dtd")
        else:
            dtd_path = os.path.join(base_dir, "..", "dtd", "JATS-Archiving-1-4-MathML3-DTD", "JATS-archivearticle1-4-mathml3.dtd")
            
        dtd_path = os.path.abspath(dtd_path)
        
        if os.path.exists(dtd_path):
            dtd = etree.DTD(file=dtd_path)
            if not dtd.validate(doc):
                for error in dtd.error_log:
                    errors.append({
                        "line_number": error.line,
                        "error_type": "DTD",
                        "message": error.message
                    })
        else:
            errors.append({"line_number": 0, "error_type": "System", "message": f"DTD file not found at {dtd_path}"})
            
    except Exception as e:
        logger.error(f"Failed to run DTD validation: {traceback.format_exc()}")
        errors.append({"line_number": 0, "error_type": "System", "message": f"Validation engine failure: {str(e)}"})
        
    return errors
