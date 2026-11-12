import os
import zipfile
import io
import shutil
import re
from pathlib import Path
from typing import Any
from app.core.config import get_settings
from app.integrations.pph.client import PPHClient
from app.processing.manuscript_core.analyzer import analyze_manuscript
from app.processing.manuscript_core.fixer import apply_fixes_targeted, apply_te_highlights_to_docx

class TechnicalEngine:
    def process_document(self, file_path: str, project_id: int | None = None, db: Any = None) -> list[str]:
        """
        Runs Technical Editing (Highlighting and Auto-fixes) on the document.
        Generates a new file with technical highlights and stylesheet-guided fixes.
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
            # Resolve real client, project, and active stylesheet
            active_ss = None
            client_name = "DefaultClient"
            project_name = "DefaultProject"
            if project_id and db:
                from app import models
                from app.services import stylesheet_service
                proj = db.query(models.Project).filter(models.Project.id == project_id).first()
                if proj:
                    project_name = proj.title or "DefaultProject"
                    client_name = proj.client_name or (proj.client.name if proj.client else "") or "DefaultClient"
                    active_ss = stylesheet_service.get_active_stylesheet_for_project(db, project_id=project_id)

            chapters = [
                {
                    "index": 1,
                    "filename": os.path.basename(file_path),
                    "path": file_path,
                    "client_name": client_name,
                    "project_name": project_name,
                    "role": "PM",
                    "ia_mapping_path": ""
                }
            ]
            findings_dict = analyze_manuscript(chapters)
            findings = findings_dict.get("findings", [])

            # Apply stylesheet or Springer rules to findings so replacements reflect house style
            from app.processing.manuscript_core.ia_selection import annotate_with_stylesheet
            if active_ss:
                import json
                from app.services import stylesheet_service
                try:
                    selected_rows = json.loads(active_ss.selected_ia_rows or "[]")
                except Exception:
                    selected_rows = []
                ce_rules = stylesheet_service.stylesheet_ce_rules(active_ss)
                annotate_with_stylesheet(findings, selected_rows, findings_dict.get("ia_report", {}).get("rule_id_to_ia"), ce_rules=ce_rules)
            elif "springer" in client_name.lower() or "spr" in client_name.lower():
                from app.processing.manuscript_core.rules.presets.springer import get_springer_preset
                spr = get_springer_preset()
                annotate_with_stylesheet(findings, spr["selected_ia_rows"], findings_dict.get("ia_report", {}).get("rule_id_to_ia"), ce_rules=spr["ce_rules"])
            
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
                    surface = hf.get("surface", "")
                    pat_str = hf.get("search_pattern")
                    if not pat_str or (surface and (not surface[0].isalnum() or not surface[-1].isalnum())):
                        if not surface:
                            continue
                        prefix = r'\b' if (surface[0].isalnum() or surface[0] == '_') else ''
                        suffix = r'\b' if (surface[-1].isalnum() or surface[-1] == '_') else ''
                        pat_str = prefix + re.escape(surface) + suffix
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
