import os

import requests
from bs4 import BeautifulSoup

from ..engine.registry import rule
from ._common import _call_w3c_css_validator


_CSS_CACHE: dict[str, list] = {}


@rule("CSS001")
@rule("CSS002")
def validate_css_w3c(file_details, rule_config=None):
    """CSS001 (xhtml → linked css) and CSS002 (direct .css) share one function.

    Registering it twice matches the legacy behaviour where two rule entries
    both mapped to the same function name.
    """
    file_path = file_details["full_path"]
    issues = []

    if file_path.endswith(".css"):
        with open(file_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        if not css_content.strip():
            return {"issues_count": 0, "issues": []}
        css_label = file_details["file_name"]

        if file_path in _CSS_CACHE:
            return {"issues_count": len(_CSS_CACHE[file_path]), "issues": _CSS_CACHE[file_path]}

        try:
            issues = _call_w3c_css_validator(css_content, css_label)
            _CSS_CACHE[file_path] = issues
        except requests.exceptions.Timeout:
            issues = [{
                "type": "css_validation_failed",
                "css_file": css_label,
                "message": "W3C CSS Validator request timed out",
                "category": "Warning",
            }]
        except requests.exceptions.ConnectionError:
            issues = [{
                "type": "css_validation_failed",
                "css_file": css_label,
                "message": "Could not reach W3C CSS Validator",
                "category": "Warning",
            }]
        except Exception as e:  # noqa: BLE001
            issues = [{
                "type": "css_validation_failed",
                "css_file": css_label,
                "message": f"CSS validation error: {str(e)}",
                "category": "Warning",
            }]
        return {"issues_count": len(issues), "issues": issues}

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    css_links = soup.find_all("link", rel=lambda r: r and "stylesheet" in r)

    for link_tag in css_links:
        href = (link_tag.get("href") or "").strip()
        if not href or href.startswith("http"):
            continue

        current_dir = os.path.dirname(file_path)
        css_path = os.path.normpath(os.path.join(current_dir, href))

        if not os.path.exists(css_path):
            issues.append({
                "type": "css_file_missing",
                "css_file": href,
                "message": f"Linked CSS file not found: {href}",
                "category": "Error",
            })
            continue

        if css_path in _CSS_CACHE:
            for issue in _CSS_CACHE[css_path]:
                issues.append(dict(issue, css_file=href))
            continue

        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()

        if not css_content.strip():
            _CSS_CACHE[css_path] = []
            continue

        try:
            css_file_issues = _call_w3c_css_validator(css_content, href)
            _CSS_CACHE[css_path] = css_file_issues
            issues.extend(css_file_issues)
        except requests.exceptions.Timeout:
            issues.append({
                "type": "css_validation_failed",
                "css_file": href,
                "message": "W3C CSS Validator request timed out",
                "category": "Warning",
            })
        except requests.exceptions.ConnectionError:
            issues.append({
                "type": "css_validation_failed",
                "css_file": href,
                "message": "Could not reach W3C CSS Validator",
                "category": "Warning",
            })
        except Exception as e:  # noqa: BLE001
            issues.append({
                "type": "css_validation_failed",
                "css_file": href,
                "message": f"CSS validation error: {str(e)}",
                "category": "Warning",
            })

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-CSS-001")
def validate_gwp_inline_css(file_details, rule_config=None):
    """GWP000: Ensure CSS is in a separate file, not inline or embedded."""
    file_path = file_details["full_path"]
    issues = []
    
    # We only want to run this check on XHTML files, not CSS files
    if not file_path.lower().endswith(".xhtml") and not file_path.lower().endswith(".html"):
        return {"issues_count": 0, "issues": []}
    
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

    # Check for <style> tags
    style_tags = soup.find_all("style")
    for tag in style_tags:
        line, extract = get_element_info(tag)
        issue = {
            "type": "embedded_style_tag",
            "rule_name": "Embedded style tag",
            "message": "CSS is in a separate file, not inline. Remove <style> tags. See http://kb.daisy.org/publishing/docs/html/separation.html",
            "category": "Error",
            "file_path": file_details.get("relative_path"),
            "extract": extract
        }
        if line: issue["line_number"] = line
        issues.append(issue)

    # Check for inline style attributes
    for tag in soup.find_all(style=True):
        line, extract = get_element_info(tag)
        issue = {
            "type": "inline_style_attribute",
            "rule_name": "Inline style attribute",
            "message": "CSS is in a separate file, not inline. Remove 'style' attribute. See http://kb.daisy.org/publishing/docs/html/separation.html",
            "category": "Error",
            "file_path": file_details.get("relative_path"),
            "extract": extract
        }
        if line: issue["line_number"] = line
        issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-CSS-002")
def validate_meta_viewport(file_details, rule_config=None):
    """GWP001: Include meta viewport on all pages."""
    file_path = file_details["full_path"]
    issues = []
    
    # We only want to run this check on XHTML/HTML files
    if not file_path.lower().endswith(".xhtml") and not file_path.lower().endswith(".html"):
        return {"issues_count": 0, "issues": []}
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception:
        return {"issues_count": 0, "issues": []}

    viewport_meta = soup.find("meta", attrs={"name": "viewport"})
    expected_content = "width=device-width, initial-scale=1"
    
    if not viewport_meta or viewport_meta.get("content") != expected_content:
        import re
        # Find the <head> tag to attach the error to, or default to line 1
        head_tag = soup.find("head")
        line = 1
        extract = "<head>"
        
        if head_tag:
            line = getattr(head_tag, 'sourceline', 1)
            extract_end = str(head_tag).find('>')
            extract = str(head_tag)[:extract_end+1] if extract_end != -1 else "<head>"
            
            if not getattr(head_tag, 'sourceline', None):
                masked_html = re.sub(r'<!--.*?-->', lambda m: ' ' * len(m.group(0)), html_text, flags=re.DOTALL)
                idx = masked_html.find("<head")
                if idx != -1:
                    line = masked_html.count('\n', 0, idx) + 1
                    raw_end = html_text.find('>', idx)
                    if raw_end != -1:
                        extract = html_text[idx:raw_end+1]

        issue = {
            "type": "missing_meta_viewport",
            "message": 'Include meta viewport on all pages: <meta content="width=device-width, initial-scale=1" name="viewport"/>',
            "category": "Error",
            "file_path": file_details.get("relative_path"),
            "extract": extract,
            "line_number": line
        }
        issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-CSS-003")
def validate_relative_units(file_details, rule_config=None):
    """GWP000: Font-size and line-height should be defined in relative units (em, %, or rem)"""
    file_path = file_details["full_path"]
    issues = []
    
    if not file_path.lower().endswith(".css"):
        return {"issues_count": 0, "issues": []}
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            lines = content.split('\n')
    except Exception:
        return {"issues_count": 0, "issues": []}

    import re
    # Matches font-size or line-height declarations
    pattern = re.compile(r'(font-size|line-height)\s*:\s*([^;}]+)', re.IGNORECASE)
    # Matches absolute units
    absolute_pattern = re.compile(r'\b([\d\.]+)\s*(px|pt|cm|mm|in|pc)\b', re.IGNORECASE)
    
    for i, line in enumerate(lines):
        for prop_match in pattern.finditer(line):
            prop_name = prop_match.group(1).lower()
            prop_val = prop_match.group(2)
            
            for abs_match in absolute_pattern.finditer(prop_val):
                val = abs_match.group(1)
                unit = abs_match.group(2).lower()
                
                extract = line.strip()
                if len(extract) > 150:
                    extract = extract[:150] + "..."
                    
                issues.append({
                    "type": "absolute_unit_used",
                    "message": f"{prop_name} should be defined in relative units (em, %, or rem) for proper scaling. Found {val}{unit}.",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract,
                    "line_number": i + 1
                })

    return {"issues_count": len(issues), "issues": issues}

@rule("GWP-CSS-004")
def validate_font_size(file_details, rule_config=None):
    """GWP000: No font sizes smaller than 10px, 7.5pt, 0.625em, 62.5%"""
    file_path = file_details["full_path"]
    issues = []
    
    if not file_path.lower().endswith(".css"):
        return {"issues_count": 0, "issues": []}
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            lines = content.split('\n')
    except Exception:
        return {"issues_count": 0, "issues": []}

    import re
    # Matches font-size: <number><unit>
    pattern = re.compile(r'font-size\s*:\s*([\d\.]+)\s*(px|pt|em|%)', re.IGNORECASE)
    
    inner_config = rule_config.get("rule_config", {}) if rule_config else {}
    if not inner_config or "thresholds" not in inner_config:
        issues.append({
            "type": "missing_rule_config",
            "rule_name": rule_config.get("name", "Font Size Check") if rule_config else "Font Size Check",
            "message": "Rule configuration for GWP-CSS-004 must include 'thresholds'.",
            "category": "Error",
            "file_path": file_details.get("relative_path")
        })
        return {"issues_count": len(issues), "issues": issues}
        
    thresholds = inner_config["thresholds"]
    
    for i, line in enumerate(lines):
        for match in pattern.finditer(line):
            val_str = match.group(1)
            unit = match.group(2).lower()
            
            try:
                val = float(val_str)
            except ValueError:
                continue
                
            if val < thresholds.get(unit, 0):
                extract = line.strip()
                if len(extract) > 150:
                    extract = extract[:150] + "..."
                    
                issues.append({
                    "type": "small_font_size",
                    "message": f"Font size {val}{unit} is too small. Minimum allowed is {thresholds[unit]}{unit}.",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract,
                    "line_number": i + 1
                })

    return {"issues_count": len(issues), "issues": issues}
