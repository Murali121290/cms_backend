"""Table structure validation."""

from ..engine.registry import rule


@rule("GWP-XHTML-003")
def validate_gwp_table_structure(file_details, rule_config=None):
    """GWP000: Validate proper HTML markup for tables including scope on headers and proper structural tags."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception:
        return {"issues_count": 0, "issues": []}

    def get_element_info(el):
        line = getattr(el, 'sourceline', None)
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        if not line:
            import re
            masked_html = re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), html_text, flags=re.DOTALL)
            all_tags = soup.find_all(el.name)
            try:
                tag_index = next(i for i, tag in enumerate(all_tags) if tag is el)
                pattern = re.compile(rf"<{el.name}\b", re.IGNORECASE)
                matches = list(pattern.finditer(masked_html))
                if tag_index < len(matches):
                    idx = matches[tag_index].start()
                    line = masked_html.count('\n', 0, idx) + 1
            except StopIteration:
                pass
                
            if not line:
                idx = masked_html.find(extract)
                if idx != -1:
                    line = masked_html.count('\n', 0, idx) + 1
                        
        if len(extract) > 150:
            extract = extract[:150] + "..."
        return line, extract

    tables = soup.find_all("table")
    for table in tables:
        # Check for <tbody> (Error if missing)
        if not table.find("tbody"):
            line, extract = get_element_info(table)
            issue = {
                "type": "table_missing_tbody",
                "rule_name": rule_config.get("name", "Table Structure Check") if rule_config else "Table Structure Check",
                "message": "The <table> tag is missing a <tbody> element. Proper HTML markup requires <tbody>.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

        # Check for <caption> (Warning if missing)
        if not table.find("caption"):
            line, extract = get_element_info(table)
            issue = {
                "type": "table_missing_caption",
                "rule_name": rule_config.get("name", "Table Structure Check") if rule_config else "Table Structure Check",
                "message": "The <table> tag does not have a <caption>. Ensure a caption is provided where appropriate.",
                "category": "Warning",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

        # Check all <th> elements for proper scope based on their location
        ths = table.find_all("th")
        for th in ths:
            scope = (th.get("scope") or "").lower()
            in_thead = th.find_parent("thead") is not None
            in_tbody = th.find_parent("tbody") is not None
            
            if not scope:
                line, extract = get_element_info(th)
                issue = {
                    "type": "th_missing_scope",
                    "rule_name": "th missing scope",
                    "message": "The <th> tag is missing a 'scope' attribute.",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)
            elif in_thead and scope not in ["col", "colgroup"]:
                line, extract = get_element_info(th)
                issue = {
                    "type": "th_invalid_scope_thead",
                    "rule_name": "th invalid scope thead",
                    "message": f"A <th> tag inside <thead> should typically have scope=\"col\", found scope=\"{scope}\".",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)
            elif in_tbody and scope not in ["row", "rowgroup"]:
                line, extract = get_element_info(th)
                issue = {
                    "type": "th_invalid_scope_tbody",
                    "rule_name": "th invalid scope tbody",
                    "message": f"A <th> tag inside <tbody> should typically have scope=\"row\", found scope=\"{scope}\".",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-XHTML-004")
def validate_gwp_table_columns(file_details, rule_config=None):
    """GWP000: Warning if table exceeds 4 columns."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception:
        return {"issues_count": 0, "issues": []}

    def get_element_info(el):
        line = getattr(el, 'sourceline', None)
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        if not line:
            import re
            masked_html = re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), html_text, flags=re.DOTALL)
            all_tags = soup.find_all(el.name)
            try:
                tag_index = next(i for i, tag in enumerate(all_tags) if tag is el)
                pattern = re.compile(rf"<{el.name}\b", re.IGNORECASE)
                matches = list(pattern.finditer(masked_html))
                if tag_index < len(matches):
                    idx = matches[tag_index].start()
                    line = masked_html.count('\n', 0, idx) + 1
            except StopIteration:
                pass
                
            if not line:
                idx = masked_html.find(extract)
                if idx != -1:
                    line = masked_html.count('\n', 0, idx) + 1
                        
        if len(extract) > 150:
            extract = extract[:150] + "..."
        return line, extract

    max_allowed = rule_config.get("max_columns", 4) if rule_config else 4
    
    tables = soup.find_all("table")
    for table in tables:
        max_cols = 0
        for tr in table.find_all("tr"):
            col_count = 0
            for cell in tr.find_all(["td", "th"]):
                colspan = cell.get("colspan", "1")
                try:
                    col_count += int(colspan)
                except ValueError:
                    col_count += 1
            max_cols = max(max_cols, col_count)
            
        if max_cols > max_allowed:
            line, extract = get_element_info(table)
            issue = {
                "type": "table_exceeds_max_columns",
                "rule_name": rule_config.get("name", "Table Column Count Check") if rule_config else "Table Column Count Check",
                "message": f"Table has {max_cols} columns (exceeds {max_allowed}). Tables exceeding four columns should be captured as an image and data captured as long alt text placed on the Extended Description page.",
                "category": "Warning",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-XHTML-006")
def validate_gwp_presentational_tables(file_details, rule_config=None):
    """GWP000: Warn if tables are used for presentational purposes."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception:
        return {"issues_count": 0, "issues": []}

    def get_element_info(el):
        line = getattr(el, 'sourceline', None)
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        if not line:
            import re
            masked_html = re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), html_text, flags=re.DOTALL)
            all_tags = soup.find_all(el.name)
            try:
                tag_index = next(i for i, tag in enumerate(all_tags) if tag is el)
                pattern = re.compile(rf"<{el.name}\b", re.IGNORECASE)
                matches = list(pattern.finditer(masked_html))
                if tag_index < len(matches):
                    idx = matches[tag_index].start()
                    line = masked_html.count('\n', 0, idx) + 1
                    raw_end = html_text.find('>', idx)
                    if raw_end != -1:
                        extract = html_text[idx:raw_end+1]
            except StopIteration:
                pass
                
            if not line:
                idx = masked_html.find(extract)
                if idx != -1:
                    line = masked_html.count('\n', 0, idx) + 1
                        
        if len(extract) > 150:
            extract = extract[:150] + "..."
        return line, extract

    tables = soup.find_all("table")
    for table in tables:
        in_figure = table.find_parent("figure") is not None
        has_th = table.find("th") is not None
        
        if in_figure:
            line, extract = get_element_info(table)
            issue = {
                "type": "table_inside_figure",
                "message": "Do not use tables for presentational purposes that could be achieved with CSS (e.g. placing a table inside a <figure> for layout).",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)
        elif not has_th:
            line, extract = get_element_info(table)
            issue = {
                "type": "presentational_table_warning",
                "rule_name": rule_config.get("name", "Presentational Table Check") if rule_config else "Presentational Table Check",
                "message": "Table contains no header (<th>) elements. Do not use tables for presentational purposes (like layout) that could be achieved with CSS.",
                "category": "Warning",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}
