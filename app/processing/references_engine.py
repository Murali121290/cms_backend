import os
import zipfile
import io
import shutil
from pathlib import Path
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.processing.reference_char_style_applicator import apply_reference_char_styles

# Legacy imports
try:
    from app.processing.legacy import ReferencesStructing
    from app.processing.legacy import Referencenumvalidation
    from app.processing.legacy import ReferenceAPAValidation
    LEGACY_AVAILABLE = True
except Exception as e:
    import logging
    logging.getLogger(__name__).warning(f"Legacy reference modules unavailable: {e}")
    LEGACY_AVAILABLE = False

class ReferencesEngine:
    def process_document(self, file_path: str,
                         run_structuring: bool = True,
                         run_num_validation: bool = True,
                         run_apa_validation: bool = True,
                         report_only: bool = False,
                         target_style: str = "Auto",
                         citation_format: str = "auto") -> list[str]:
        """
        Runs the Reference Structuring and Validation pipeline entirely by delegating to PPH.
        Granular control options (validation, structuring, format, and style conversion)
        are passed directly to the PPH API.
        """
        settings = get_settings()

        if not hasattr(settings, 'PPH_BASE_URL') or not settings.PPH_BASE_URL:
            raise RuntimeError("PPH_BASE_URL is not configured in settings. Reference processing is entirely offloaded to PPH.")
        if not getattr(settings, 'PPH_ENABLED', False):
            raise RuntimeError("PPH integration is disabled in settings. Reference processing is entirely offloaded to PPH.")

        client = PPHClient()
        with open(file_path, "rb") as f:
            files = {
                "files": (
                    os.path.basename(file_path),
                    f.read(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                )
            }
        
        # In PPH, Step 3 (Structuring & Conversion) triggers both Structuring and Conversion (process_conversion)
        run_gemini_val = "true" if run_structuring else "false"

        payload = {
            "report_only": "true" if report_only else "false",
            "run_validation": "true" if run_num_validation else "false",
            "run_structuring": "true" if run_structuring else "false",
            "run_name_year_validation": "true" if run_apa_validation else "false",
            "run_gemini": run_gemini_val,
            "target_style": target_style,
            "citation_format": citation_format
        }
        
        import logging
        engine_logger = logging.getLogger("app.processing.references_engine")
        engine_logger.info(f"Submitting unified reference job to PPH for: {os.path.basename(file_path)}")
        engine_logger.info(f"Payload: {payload}")

        zip_bytes = client.submit_and_wait(
            endpoint="/validate",
            files=files,
            data=payload
        )
        
        folder = os.path.dirname(file_path)
        generated_files = []
        
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            z.extractall(folder)
            for name in z.namelist():
                full_path = os.path.join(folder, name)
                if os.path.isfile(full_path):
                    generated_files.append(full_path)
                    # Apply character styles to processed DOCX files
                    if full_path.endswith("_Processed.docx"):
                        apply_reference_char_styles(full_path)

        return generated_files

