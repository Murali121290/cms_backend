
import os
import logging
from typing import List, Optional
from app.processing.structuring_lib.styler import process_docx

# Configure specialised logger
logger = logging.getLogger("app.processing.structuring")

class StructuringEngine:
    """
    Wrapper engine for Book Styler integration.
    Allows running 'structuring' process on documents.
    """
    
    def process_document(self, file_path: str, mode: str = "style") -> List[str]:
        """
        Run structuring process on a DOCX file.
        
        Args:
            file_path: Absolute path to the input .docx file
            mode: "style" (Apply Styles & Validate) or "tag" (Add Tags Only)
            
        Returns:
            List of generated file paths (usually just one processed file)
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Input file not found: {file_path}")
            
        # Determine output path
        # We'll use a standard naming convention: original_name_Processed.docx
        dir_name = os.path.dirname(file_path)
        base_name = os.path.basename(file_path)
        name_only = os.path.splitext(base_name)[0]
        
        output_filename = f"{name_only}_Processed.docx"
        output_path = os.path.join(dir_name, output_filename)
        
        logger.info(f"Starting structuring (mode={mode}) for: {base_name}")
        
        try:
            # Call the migrated library function
            result = process_docx(
                input_path=file_path,
                output_path=output_path,
                mode=mode
            )
            
            if not result["success"]:
                 error_msg = "; ".join(result.get("errors", ["Unknown structuring error"]))
                 logger.error(f"Structuring failed: {error_msg}")
                 raise Exception(f"Structuring failed: {error_msg}")
                 
            logger.info(f"Structuring successful. Processed {result.get('paragraphs_processed')} paragraphs.")
            
            return [output_path]
            
        except Exception as e:
            logger.error(f"Error in StructuringEngine: {e}", exc_info=True)
            raise e
