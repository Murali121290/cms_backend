import logging
from datetime import datetime
from app.database import SessionLocal
from app.domains.post_prod.xml_conversion.models import PostProdXMLConversionHistory
from app.domains.post_prod.xml_conversion.engine.pdf_to_s4c import extract_pdf_to_s4c
from app.domains.post_prod.xml_conversion.engine.format_mapper import convert_s4c_to_target
from app.domains.post_prod.xml_conversion.validators.dtd_validator import validate_xml
from app.domains.post_prod.xml_conversion.validators.customer_rules import run_customer_checks

logger = logging.getLogger(__name__)

def run_xml_conversion_pipeline(history_id: int):
    """
    Core pipeline function that runs the extraction, conversion, and validation.
    Designed to be called by a Celery worker.
    """
    db = SessionLocal()
    try:
        history = db.query(PostProdXMLConversionHistory).filter(PostProdXMLConversionHistory.id == history_id).first()
        if not history:
            logger.error(f"History record {history_id} not found.")
            return
            
        history.conversion_status = "Processing"
        db.commit()
        
        # 1. PDF to S4C XML
        s4c_xml = extract_pdf_to_s4c(history.filepath)
        
        # 2. Map to target format
        target_format = history.project.target_format or "JATS"
        final_xml = convert_s4c_to_target(s4c_xml, target_format)
        
        # Save output XML to disk
        out_path = history.filepath.rsplit('.', 1)[0] + f".{target_format.lower()}.xml"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(final_xml)
            
        history.result_filepath = out_path
        
        # 3. Validate
        dtd_errors = validate_xml(out_path, target_format)
        custom_errors = run_customer_checks(out_path, history.project.client_code)
        all_errors = dtd_errors + custom_errors
        
        history.validation_errors = all_errors
        if all_errors:
            history.conversion_status = "Failed"
            history.error_message = f"Validation failed with {len(all_errors)} errors."
        else:
            history.conversion_status = "Completed"
            
        db.commit()
        logger.info(f"XML conversion for history {history_id} completed successfully.")
        
    except Exception as e:
        logger.exception("XML Conversion Failed")
        try:
            if history:
                history.conversion_status = "Failed"
                history.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
