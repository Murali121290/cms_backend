import os
import zipfile
import io
import shutil
import re
from pathlib import Path
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.processing.manuscript_core.analyzer import analyze_manuscript
from app.processing.manuscript_core.fixer import apply_fixes_targeted, apply_te_highlights_to_docx

class TechnicalEngine:
    def process_document(self, file_path: str) -> list[str]:
        """
        Runs Technical Editing (Highlighting) on the document.
        Generates a new file with technical highlights.
        Offloads to PPH Server if PPH_ENABLED is configured.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        settings = get_settings()
        folder = os.path.dirname(file_path)
        base = os.path.splitext(os.path.basename(file_path))[0]
        # Standardize naming convention to _TechEdited.docx for unified versioning
        output_filename = f"{base}_TechEdited.docx"
        output_path = os.path.join(folder, output_filename)

        if settings.PPH_ENABLED:
            client = PPHClient()
            with open(file_path, "rb") as f:
                # Flask router expects word_files[]
                files = {
                    "word_files[]": (
                        os.path.basename(file_path),
                        f.read(),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    )
                }
            
            zip_bytes = client.submit_and_wait(
                endpoint="/technical",
                files=files,
                data={"run_technical_editing": "1"},
                file_field="word_files[]"
            )
            
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                # Find docx file inside ZIP and copy to output_path
                docx_files = [name for name in z.namelist() if name.endswith(".docx")]
                if docx_files:
                    with open(output_path, "wb") as out_f:
                        out_f.write(z.read(docx_files[0]))
                    return [output_path]
                else:
                    raise FileNotFoundError("Processed DOCX report not found in PPH response ZIP.")

        # Local fallback using modern manuscript_core engine
        try:
            chapters = [
                {
                    "index": 1,
                    "filename": os.path.basename(file_path),
                    "path": file_path,
                    "client_name": "DefaultClient",
                    "project_name": "DefaultProject",
                    "role": "PM",
                    "ia_mapping_path": ""
                }
            ]
            findings_dict = analyze_manuscript(chapters)
            findings = findings_dict.get("findings", [])
            
            selected_findings = []
            highlight_findings = []
            
            for f in findings:
                payload_item = {
                    "para_index": f.get("para_index"),
                    "match_start": f.get("match_start"),
                    "surface": f.get("surface"),
                    "replacement": f.get("replacement") or "",
                    "source": f.get("source") or "body",
                    "region": f.get("region") or "body",
                    "rule_id": f.get("rule_id")
                }
                if payload_item["replacement"]:
                    selected_findings.append(payload_item)
                else:
                    highlight_findings.append(payload_item)

            # Apply fixes targeted first
            if selected_findings:
                apply_fixes_targeted(Path(file_path), Path(output_path), selected_findings)
            else:
                shutil.copy2(file_path, output_path)

            # Apply highlights next
            if highlight_findings:
                hl_texts = []
                seen = set()
                for hf in highlight_findings:
                    pat_str = hf.get("search_pattern")
                    if not pat_str:
                        surface = hf.get("surface", "")
                        if not surface:
                            continue
                        pat_str = r'\b' + re.escape(surface) + r'\b'
                    key = (pat_str, hf.get("region", "body"), hf.get("source", "body"))
                    if key not in seen:
                        seen.add(key)
                        hl_texts.append({
                            "pattern":       re.compile(pat_str, re.IGNORECASE),
                            "region":        hf.get("region", "body"),
                            "source_filter": hf.get("source", "body"),
                            "rule_id":       hf.get("rule_id", ""),
                            "surface":       hf.get("surface", ""),
                        })
                
                if hl_texts:
                    apply_te_highlights_to_docx(output_path, output_path, hl_texts)

            if os.path.exists(output_path):
                return [output_path]
            else:
                raise RuntimeError("Technical processing failed to generate output file.")
        except Exception as e:
            print(f"Technical Engine Error: {e}")
            raise e
