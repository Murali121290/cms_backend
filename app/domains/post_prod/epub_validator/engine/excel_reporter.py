import json
import os
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from datetime import datetime

def generate_gwp_report(validation_result: dict, template_path: str, output_xlsx_path: str):
    """Generates an Excel report matching the GWP template from the validation result."""
    
    with open(template_path, "r") as f:
        template = json.load(f)
        
    wb = Workbook()
    ws = wb.active
    ws.title = "QA Checklist"
    
    # 1. Title
    ws.append([template.get("title", "")])
    ws.cell(row=1, column=1).font = Font(bold=True, size=14)
    
    # 2. Metadata row (e.g. Date file rec'd...)
    metadata_row = template.get("metadata_row", [])
    # Optionally dynamically update the date
    metadata_row[1] = f"Date file review complete: {datetime.now().strftime('%m/%d/%y')}"
    ws.append(metadata_row)
    
    # 3. Headers
    # The actual headers are usually the first criteria in the 'Uncategorized' category.
    # But let's check if there's a headers array
    
    current_row = 3
    
    # Map rule_id -> issues from validation_result
    # The result has "files": [{ "rule_id": "...", "result": {"issues_count": N, "issues": [...] } }]
    rule_issues = {}
    for f in validation_result.get("files", []):
        rid = f.get("rule_id")
        res = f.get("result", {})
        issues = res.get("issues", [])
        if rid:
            if rid not in rule_issues:
                rule_issues[rid] = []
            
            # Format the issues to include the file path
            file_name = f.get("file_details", {}).get("file_name", "")
            for i in issues:
                msg = i.get("message", "")
                if file_name and file_name != "[book-level]":
                    rule_issues[rid].append(f"[{file_name}] {msg}")
                else:
                    rule_issues[rid].append(msg)
                    
    # Helper to evaluate status based on mapped rules
    def evaluate_criteria(criteria):
        rule_ids = criteria.get("rule_ids", [])
        if not rule_ids:
            return criteria.get("default_status", ""), criteria.get("default_notes", "")
            
        all_issues = []
        rules_executed = False
        
        for rid in rule_ids:
            if rid in rule_issues:
                rules_executed = True
                all_issues.extend(rule_issues[rid])
                
        if not rules_executed:
            # The rules were not enabled or run, fallback to default
            return criteria.get("default_status", ""), criteria.get("default_notes", "")
            
        if all_issues:
            # Issues found, mark as Fail
            notes = "\n\n".join(all_issues)
            return "Fail", notes
        else:
            return "Pass", ""

    # Build the rows
    for category in template.get("structure", []):
        cat_name = category.get("category_name")
        if cat_name != "Uncategorized":
            # Write Category header
            ws.append([cat_name])
            ws.cell(row=current_row, column=1).font = Font(bold=True)
            ws.cell(row=current_row, column=1).fill = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
            current_row += 1
            
        for criteria in category.get("criteria", []):
            name = criteria.get("name", "")
            resources = criteria.get("resources", "")
            
            # If it's the actual header row (Criteria, Pass/Fail, Notes)
            if name == "Criteria":
                ws.append([name, criteria.get("default_status", ""), criteria.get("default_notes", ""), resources])
                for col in range(1, 5):
                    ws.cell(row=current_row, column=col).font = Font(bold=True)
            else:
                status, notes = evaluate_criteria(criteria)
                ws.append([name, status, notes, resources])
                
            # Alignment for all cells in this row
            for col in range(1, 5):
                ws.cell(row=current_row, column=col).alignment = Alignment(wrap_text=True, vertical="top")
                
            current_row += 1
            
    # Set column widths
    ws.column_dimensions["A"].width = 50
    ws.column_dimensions["B"].width = 15
    ws.column_dimensions["C"].width = 50
    ws.column_dimensions["D"].width = 50
    
    ws.sheet_view.showGridLines = True
    
    # Make sure output directory exists
    os.makedirs(os.path.dirname(output_xlsx_path), exist_ok=True)
    wb.save(output_xlsx_path)
    return output_xlsx_path
