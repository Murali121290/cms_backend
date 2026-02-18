import os
from pathlib import Path

# Legacy imports
# These modules contain the core logic migrated from the Flask app
from app.processing.legacy import ReferencesStructing
from app.processing.legacy import Referencenumvalidation
from app.processing.legacy import ReferenceAPAValidation

class ReferencesEngine:
    def process_document(self, file_path: str, 
                         run_structuring: bool = True, 
                         run_num_validation: bool = True, 
                         run_apa_validation: bool = True,
                         report_only: bool = False) -> list[str]:
        """
        Runs the Reference Validation pipeline with granular control:
        1. Structuring (Header/Style cleanup)
        2. Numerical Validation (Sequence/Duplication checks)
        3. Name/Year Validation (APA style checks)
        
        report_only: If True, validation runs but changes might not be saved (logic dependent).
        
        Returns a list of generated file paths.
        """
        generated_files = []
        folder = os.path.dirname(file_path)
        current_path = file_path
        
        # ---------------------------------------------------------
        # 1. Structuring
        # ---------------------------------------------------------
        if run_structuring:
            try:
                # process_docx_file expects Path objects
                struct_res = ReferencesStructing.process_docx_file(Path(current_path), Path(folder))
                fixed_docx = struct_res.get('output_docx')
                
                if fixed_docx and os.path.exists(fixed_docx):
                    current_path = str(fixed_docx)
                    generated_files.append(current_path)
                    
                # Log file from structuring?
                log_file = struct_res.get('log_file')
                if log_file and os.path.exists(log_file):
                    generated_files.append(str(log_file))
                    
            except Exception as e:
                print(f"Structuring Error (Non-fatal): {e}")

        # ---------------------------------------------------------
        # 2. Numerical Validation
        # ---------------------------------------------------------
        if run_num_validation:
            try:
                # Returns: doc, before_stats, after_stats, mapping, status_msg
                doc, before, after, mapping, val_msg = Referencenumvalidation.process_document(current_path)
                
                # Save if modified or useful
                has_citations = bool(mapping)
                is_perfect = before.get('is_perfect', False)
                
                # We save the validation step output if there were citations to map or issues found
                # If report_only is True, we might skip saving the DOCX, but the legacy logic saves it.
                # Assuming report_only mainly applies to APA/Report generation or we just let it save Val.docx for review.
                if has_citations or (not is_perfect):
                    base = os.path.splitext(os.path.basename(current_path))[0]
                    val_path = os.path.join(folder, f"{base}_Val.docx")
                    doc.save(val_path)
                    
                    # Update chain
                    current_path = val_path
                    generated_files.append(current_path)
                
                # Generate Text Report for Numerical Validation
                base_orig = os.path.splitext(os.path.basename(file_path))[0]
                report_text = Referencenumvalidation.generate_report(before, after, mapping, val_msg, base_orig)
                report_path = os.path.join(folder, f"{base_orig}_ReferenceReport.txt")
                
                with open(report_path, "w", encoding="utf-8") as f:
                    f.write(report_text)
                generated_files.append(report_path)
                    
            except Exception as e:
                 print(f"Numerical Validation Error (Non-fatal): {e}")

        # ---------------------------------------------------------
        # 3. Name & Year Validation (APA)
        # ---------------------------------------------------------
        if run_apa_validation:
            try:
                 # Returns: dict of results
                 apa_results = ReferenceAPAValidation.validate_document_multi_style(current_path)
                 
                 if not report_only:
                     # Apply Formatting (Bold/Italic/Superscript)
                     formatted_count = ReferenceAPAValidation.apply_citation_formatting(current_path, apa_results)
                     
                     # Insert Comments for issues
                     annotated_doc, comment_count = ReferenceAPAValidation.insert_comments_in_document(
                         current_path,
                         apa_results,
                         apa_results['citation_locations'],
                         apa_results['reference_details']
                     )
                     
                     # Save Final Version (NY = Name Year)
                     if comment_count > 0 or formatted_count > 0:
                         base = os.path.splitext(os.path.basename(current_path))[0]
                         ny_path = os.path.join(folder, f"{base}_NY.docx")
                         annotated_doc.save(ny_path)
                         current_path = ny_path
                         generated_files.append(current_path)
                 
                 # Generate Text Report
                 base_orig = os.path.splitext(os.path.basename(file_path))[0]
                 report_text = ReferenceAPAValidation.generate_report(apa_results, base_orig)
                 report_path = os.path.join(folder, f"{base_orig}_ReferenceReport.txt")
                 
                 with open(report_path, "w", encoding="utf-8") as f:
                     f.write(report_text)
                 generated_files.append(report_path)

            except Exception as e:
                 print(f"Name/Year Validation Error: {e}")
                 import traceback
                 traceback.print_exc()

        return generated_files
