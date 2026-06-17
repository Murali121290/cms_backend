import os
import zipfile
import io
import shutil
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.processing.legacy import bias_scanner

class BiasEngine:
    def process_document(self, file_path: str) -> list[str]:
        """
        Runs the bias scanning logic on a document.
        Returns the generated files (DOCX, Excel, and a ZIP bundle).
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
                endpoint="/bias-scan",
                files=files
            )
            
            generated_files = []
            folder = os.path.dirname(file_path)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            
            output_dir = os.path.join(folder, "bias_output")
            os.makedirs(output_dir, exist_ok=True)
            
            # Save ZIP bundle
            zip_path = os.path.join(folder, f"{base_name}_BiasScan.zip")
            with open(zip_path, "wb") as zip_out:
                zip_out.write(zip_bytes)
            generated_files.append(zip_path)
            
            # Extract highlighted DOCX and Excel
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                # Extract all to output_dir
                z.extractall(output_dir)
                
                # Locate xlsx and docx
                for name in z.namelist():
                    full_extracted_path = os.path.join(output_dir, name)
                    if os.path.isfile(full_extracted_path):
                        if name.endswith(".xlsx"):
                            # Copy to expected excel path
                            excel_path = os.path.join(output_dir, f"{base_name}_BiasReport.xlsx")
                            if full_extracted_path != excel_path:
                                shutil.copy2(full_extracted_path, excel_path)
                            if excel_path not in generated_files:
                                generated_files.append(excel_path)
                        elif name.endswith(".docx"):
                            if full_extracted_path not in generated_files:
                                generated_files.append(full_extracted_path)
            
            return generated_files

        # Local fallback
        generated_files = []
        folder = os.path.dirname(file_path)
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        
        legacy_dir = os.path.join(os.path.dirname(__file__), 'legacy')
        csv_path = os.path.join(legacy_dir, 'bias_terms.csv')
        
        term_map, categories = bias_scanner.load_bias_terms(csv_path)
        if not term_map:
            raise ValueError(f"Bias terms could not be loaded from {csv_path}")
            
        output_dir = os.path.join(folder, "bias_output")
        os.makedirs(output_dir, exist_ok=True)
        
        highlighted_docx, report_rows = bias_scanner.scan_docx(file_path, term_map, output_dir)
        if highlighted_docx and os.path.exists(highlighted_docx):
            generated_files.append(highlighted_docx)
        
        excel_path = os.path.join(output_dir, f"{base_name}_BiasReport.xlsx")
        bias_scanner.write_excel(report_rows, excel_path)
        if os.path.exists(excel_path):
            generated_files.append(excel_path)
        
        zip_path = os.path.join(folder, f"{base_name}_BiasScan.zip")
        bias_scanner.create_zip(output_dir, excel_path, zip_path)
        if os.path.exists(zip_path):
            generated_files.append(zip_path)
        
        bias_scanner.cleanup_pdf_files()
        return generated_files
