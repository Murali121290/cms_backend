import logging
import requests
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
            
        history.project.conversion_status = "Processing"
        db.commit()
        
        # 1. PDF to S4C XML using external PDF2XML API
        url = "http://host.docker.internal:8080/convert"
        params = {
            "engine": "heuristic",
            "targets": "json,xml,jats,bits",
            "return_xml": "rawxml"
        }
        
        with open(history.project.filepath, 'rb') as f:
            files = {'file': (history.project.filepath.split('/')[-1], f, 'application/pdf')}
            response = requests.post(url, params=params, files=files)
            
        if response.status_code != 200:
            raise Exception(f"PDF2XML API Failed ({response.status_code}): {response.text}")
            
        s4c_xml = response.text
        
        # 2. Map to target format
        target_format = history.project.target_format or "JATS"
        final_xml = convert_s4c_to_target(s4c_xml, target_format)
        
        # Save output XML to disk
        out_path = history.project.filepath.rsplit('.', 1)[0] + f".{target_format.lower()}.xml"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(final_xml)
            
        history.project.result_filepath = out_path
        
        # 3. Validate
        dtd_errors = validate_xml(out_path, target_format)
        custom_errors = run_customer_checks(out_path, history.project.client_code)
        all_errors = dtd_errors + custom_errors
        
        # We can store validation errors in the project details if we add a column, or just leave it for now.
        if all_errors:
            history.project.conversion_status = "Failed"
            # history.project.error_message = f"Validation failed with {len(all_errors)} errors."
        else:
            history.project.conversion_status = "Completed"
            
        db.commit()
        logger.info(f"XML conversion for history {history_id} completed successfully.")
        
    except Exception as e:
        logger.exception("XML Conversion Failed")
        try:
            if history and history.project:
                history.project.conversion_status = "Failed"
                # history.project.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
