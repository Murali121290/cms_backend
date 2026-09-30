import logging

logger = logging.getLogger(__name__)

def convert_s4c_to_target(s4c_xml: str, target_format: str) -> str:
    """
    Maps S4C baseline XML to the requested target format (JATS, BITS).
    
    Args:
        s4c_xml: The source S4C XML string.
        target_format: The target format (e.g. 'JATS', 'BITS').
        
    Returns:
        The formatted XML string.
    """
    logger.info(f"Mapping S4C XML to {target_format} format")
    target = target_format.upper()
    
    if target == "JATS":
        return _convert_to_jats(s4c_xml)
    elif target == "BITS":
        return _convert_to_bits(s4c_xml)
    else:
        raise ValueError(f"Unsupported target format: {target_format}")

def _convert_to_jats(s4c_xml: str) -> str:
    # Scaffold for XSLT or manual mapping to JATS
    # E.g. replace <s4c_document> with <article xmlns:xlink="..." article-type="research-article">
    mapped_xml = s4c_xml.replace("<s4c_document>", '<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="research-article">')
    mapped_xml = mapped_xml.replace("</s4c_document>", "</article>")
    return mapped_xml

def _convert_to_bits(s4c_xml: str) -> str:
    # Scaffold for XSLT or manual mapping to BITS
    mapped_xml = s4c_xml.replace("<s4c_document>", '<book xmlns:xlink="http://www.w3.org/1999/xlink" book-type="monograph">')
    mapped_xml = mapped_xml.replace("</s4c_document>", "</book>")
    return mapped_xml
