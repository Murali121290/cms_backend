import os
import zipfile
import io
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.processing.legacy.extractor_ai import extract_from_file_ai
from app.processing.legacy.extractor import write_permission_log

class AIExtractorEngine:
    def process_document(self, file_path: str) -> list[str]:
        """
        Extracts permission/credit lines using Gemini AI and writes them to an Excel log.
        Returns list of generated file paths.
        Offloads to PPH Server if PPH_ENABLED is configured.
        """
        settings = get_settings()
        if settings.PPH_ENABLED:
            client = PPHClient()
            with open(file_path, "rb") as f:
                files = {
                    "files": (
                        os.path.basename(file_path),
                        f.read(),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    )
                }
            
            zip_bytes = client.submit_and_wait(
                endpoint="/credit-extractor",
                files=files,
                data={"extraction_method": "ai"}
            )
            
            folder = os.path.dirname(file_path)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            excel_filename = f"{base_name}_AIPermissionsLog.xlsx"
            excel_path = os.path.join(folder, excel_filename)
            
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                xlsx_files = [name for name in z.namelist() if name.endswith(".xlsx")]
                if xlsx_files:
                    with open(excel_path, "wb") as out_f:
                        out_f.write(z.read(xlsx_files[0]))
                    return [excel_path]
                else:
                    raise ValueError("Credit/Permission log Excel report not found in PPH response zip.")
        
        # Local fallback
        results = extract_from_file_ai(file_path)
        if not results:
            raise ValueError("No permissions/credits found in document via AI")
            
        folder = os.path.dirname(file_path)
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        excel_filename = f"{base_name}_AIPermissionsLog.xlsx"
        excel_path = os.path.join(folder, excel_filename)
        
        write_permission_log(results, excel_path)
        return [excel_path]
