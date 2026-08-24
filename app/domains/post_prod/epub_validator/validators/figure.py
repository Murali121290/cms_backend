"""Figure structure validation."""

from ..engine.registry import rule


@rule("GWP-XHTML-002")
def validate_gwp_figure_structure(file_details, rule_config=None):
    """GWP000: Validate <figure> structure, IDs, and caption formatting."""
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

    import re
    figure_pattern = re.compile(r"^\s*Figure\s+[\dA-Za-z]+", re.IGNORECASE)

    # 1. Check all <figure> tags for IDs
    for fig in soup.find_all("figure"):
        if not fig.get("id"):
            line, extract = get_element_info(fig)
            issue = {
                "type": "figure_missing_id",
                "rule_name": "Figure missing id",
                "message": "The <figure> tag is missing an 'id' attribute.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    # 2. Check all <figcaption> tags for <b> tags around "Figure X"
    for figcap in soup.find_all("figcaption"):
        b_tags = figcap.find_all(["b", "strong"])
        has_b_figure = False
        for b in b_tags:
            if "figure" in b.get_text(strip=True).lower():
                has_b_figure = True
                break
        
        if not has_b_figure and "figure" in figcap.get_text(strip=True).lower():
            line, extract = get_element_info(figcap)
            issue = {
                "type": "figcaption_missing_b_tag",
                "rule_name": "figcaption missing b tag",
                "message": "Figure captions must use the <b> tag around the figure text and number.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    # 3. Catch orphaned captions (e.g. <p class="capt">Figure 1-1.</p> outside <figure>)
    for tag in soup.find_all(["p", "div"]):
        if tag.find_parent("figure"):
            continue
            
        class_attr = tag.get("class")
        classes = (" ".join(class_attr) if isinstance(class_attr, list) else str(class_attr or "")).lower()
        tag_id = (tag.get("id") or "").lower()
        text = tag.get_text(strip=True)
        
        if ("capt" in classes or "fig" in classes or "fig" in tag_id) and figure_pattern.match(text):
            line, extract = get_element_info(tag)
            issue = {
                "type": "orphaned_figure_caption",
                "rule_name": "orphaned figure caption",
                "message": "Possible orphaned figure caption found outside of a <figure> tag. Use <figure> and <figcaption> where appropriate.",
                "category": "Warning",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}
