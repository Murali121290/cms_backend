"""Strict XHTML parse-time validation.

Each xhtml file must parse as well-formed XML. Reports syntax errors
(unclosed tags, missing quotes, unknown entities, disallowed characters).
This complements NAV001 which does higher-level semantic checks.
"""

import os

from lxml import etree

from ..engine.registry import rule


_PARSER = etree.XMLParser(recover=True, resolve_entities=False, load_dtd=False, no_network=True)


@rule("XHTML001")
def validate_xhtml_well_formed(file_details, rule_config=None):
    """xhtml files must be well-formed XML (parses without errors)."""
    file_path = file_details["full_path"]
    issues = []

    try:
        parser = etree.XMLParser(recover=True, resolve_entities=False, load_dtd=False, no_network=True)
        with open(file_path, "rb") as f:
            etree.fromstring(f.read(), parser=parser)

        import re as _re
        for err in parser.error_log:
            line_num = err.line
            # If error is a tag mismatch like "Opening and ending tag mismatch: h1 line 10 and body",
            # extract the actual opening line number (10) for easier user navigation.
            match = _re.search(r"line\s+(\d+)", err.message, _re.IGNORECASE)
            if match and "mismatch" in err.message.lower():
                line_num = int(match.group(1))

            issues.append({
                "type": "xhtml_syntax_error",
                "message": f"Line {line_num}: XHTML syntax error: {err.message}",
                "category": "Error",
                "line_number": line_num,
                "file_path": file_details.get("relative_path"),
            })

    except Exception as e:  # noqa: BLE001
        issues.append({
            "type": "xhtml_parse_failed",
            "message": f"Could not parse XHTML: {e}",
            "category": "Warning",
            "file_path": file_details.get("relative_path"),
        })


    # Also flag disallowed constructs — unclosed <br>, <img> without self-close.
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
    for tag in ("br", "hr", "img", "meta", "link"):

        # Search for opens that are not self-closing.
        import re as _re
        for m in _re.finditer(fr"<{tag}\b([^>/]*)(?<!/)>", text, _re.IGNORECASE):
            attrs = m.group(1)
            if "/" not in attrs:
                line_num = text[:m.start()].count("\n") + 1
                snippet_start = max(0, m.start() - 30)
                snippet_end = min(len(text), m.end() + 30)
                issues.append({
                    "type": "xhtml_void_tag_not_self_closed",
                    "message": f"Line {line_num}: <{tag}> is a void element and must be self-closed in XHTML.",
                    "category": "Warning",
                    "line_number": line_num,
                    "snippet": text[snippet_start:snippet_end],
                    "file_path": file_details.get("relative_path"),
                })

                if len(issues) >= 10:
                    break
        if len(issues) >= 10:
            break

    return {"issues_count": len(issues), "issues": issues}


@rule("XHTML002")
def validate_epub_type_semantics(file_details, rule_config=None):
    """Ensure proper use of epub:type for front matter, title page, part, chapter, etc.
    Enforces that specific files contain these tags based on file name or type.
    """
    file_path = file_details["full_path"]
    filename_lower = os.path.basename(file_path).lower()
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception as e:
        return {"issues_count": 0, "issues": []}

    body = soup.find("body")
    if not body:
        return {"issues_count": 0, "issues": []}

    body_epub_type = body.get("epub:type")

    config = rule_config.get("rule_config") if rule_config else None
    
    if not config or "file_heuristics" not in config or "global_pairings" not in config:
        return {
            "issues_count": 1,
            "issues": [{
                "type": "configuration_error",
                "message": "XHTML002 requires a 'rule_config' block with 'file_heuristics' and 'global_pairings' in customer.json.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
            }]
        }

    file_heuristics = config["file_heuristics"]
    global_pairings = config["global_pairings"]

    # Determine expected semantics based on filename
    expected_body = None
    expected_tag = None
    expected_epub_type = None
    expected_role = None

    for h in file_heuristics:
        patterns = h.get("patterns", [])
        if "pattern" in h and h["pattern"] not in patterns:
            patterns = patterns + [h["pattern"]]

        if any(p in filename_lower for p in patterns):
            expected_body = h.get("expected_body")
            expected_tag = h.get("expected_tag")
            expected_epub_type = h.get("expected_epub_type")
            expected_role = h.get("expected_role")
            break

    def get_element_info(el):
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        idx = html_text.find(extract)
        if idx != -1:
            line = html_text.count('\n', 0, idx) + 1
        else:
            # Fallback for when BeautifulSoup reorders attributes in extract
            tag_name = el.name
            etype = el.get("epub:type", "")
            lines = html_text.split('\n')
            line = getattr(el, "sourceline", None)
            tag_start = f"<{tag_name}"
            for i, l_text in enumerate(lines):
                if tag_start in l_text and f"epub:type=\"{etype}\"" in l_text:
                    line = i + 1
                    start_idx = l_text.find(tag_start)
                    end_idx = l_text.find('>', start_idx)
                    if start_idx != -1 and end_idx != -1:
                        extract = l_text[start_idx:end_idx+1]
                    break
            
        return line, extract

    if expected_body and body_epub_type != expected_body:
        line, extract = get_element_info(body)
        issue = {
            "type": "invalid_body_epub_type",
            "rule_name": "Invalid body epub:type",
            "message": f"<body> epub:type should be '{expected_body}' for this file type.",
            "category": "Error",
            "file_path": file_details.get("relative_path"),
            "extract": extract
        }
        if line: issue["line_number"] = line
        issues.append(issue)

    if expected_tag and expected_epub_type:
        # Check if the exact tag with epub:type exists
        element = soup.find(expected_tag, attrs={"epub:type": expected_epub_type})
        if not element:
            # Check if there's a tag with a partially matching or incorrect epub:type to give a better error
            wrong_element = soup.find(expected_tag, attrs={"epub:type": lambda x: x and expected_epub_type in x.split()})
            if not wrong_element:
                wrong_element = soup.find(expected_tag, attrs={"epub:type": True})
                
            if wrong_element:
                actual_epub_type = wrong_element.get("epub:type")
                line, extract = get_element_info(wrong_element)
                issue = {
                    "type": "invalid_epub_type_value",
                    "rule_name": "Invalid epub:type",
                    "message": f"<{expected_tag}> has epub:type=\"{actual_epub_type}\", but it must be exactly \"{expected_epub_type}\".",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)
            else:
                issues.append({
                    "type": "missing_required_epub_type",
                    "rule_name": "Missing epub:type",
                    "message": f"File requires <{expected_tag} epub:type=\"{expected_epub_type}\">.",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                })
        elif expected_role and element.get("role") != expected_role:
            line, extract = get_element_info(element)
            actual_role = element.get("role")
            msg = f"<{expected_tag} epub:type=\"{expected_epub_type}\"> has role=\"{actual_role}\", but must have role=\"{expected_role}\"." if actual_role else f"<{expected_tag} epub:type=\"{expected_epub_type}\"> is missing role=\"{expected_role}\"."
            issue = {
                "type": "invalid_epub_type_pairing",
                "rule_name": "Invalid role pairing",
                "message": msg,
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    # Generic check for all elements with epub:type to ensure proper roles
    for el in soup.find_all(attrs={"epub:type": True}):
        etype = el.get("epub:type")
        tag_name = el.name
        role = el.get("role")
        
        for pairing in global_pairings:
            if etype == pairing["epub_type"]:
                if "tag" in pairing and tag_name != pairing["tag"]:
                    continue
                req_role = pairing["required_role"]
                if role != req_role:
                    line, extract = get_element_info(el)
                    msg = f"<{tag_name} epub:type=\"{etype}\"> has role=\"{role}\", but must have role=\"{req_role}\"." if role else f"<{tag_name} epub:type=\"{etype}\"> is missing role=\"{req_role}\"."
                    issue = {
                        "type": "invalid_epub_type_pairing",
                        "rule_name": "Invalid role pairing",
                        "message": msg,
                        "category": "Error",
                        "file_path": file_details.get("relative_path"),
                        "extract": extract
                    }
                    if line: issue["line_number"] = line
                    issues.append(issue)

    # Deduplicate issues based on identical messages to prevent double-logging
    unique_issues = list({issue["message"]: issue for issue in issues}.values())

    return {"issues_count": len(unique_issues), "issues": unique_issues}

@rule("XHTML003")
def validate_html_language_declaration(file_details, rule_config=None):
    """Ensure HTML tag declares language (lang and xml:lang)."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception as e:
        return {"issues_count": 0, "issues": []}

    html_tag = soup.find("html")
    if not html_tag:
        return {"issues_count": 0, "issues": []}
        
    config = rule_config.get("rule_config") if rule_config else None
    expected_lang = "en"
    if config and "expected_lang" in config:
        expected_lang = config["expected_lang"]

    lang = html_tag.get("lang")
    xml_lang = html_tag.get("xml:lang")
    
    def get_element_info(el):
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        idx = html_text.find(extract)
        if idx != -1:
            line = html_text.count('\n', 0, idx) + 1
        else:
            tag_name = el.name
            lines = html_text.split('\n')
            line = getattr(el, "sourceline", None)
            tag_start = f"<{tag_name}"
            for i, l_text in enumerate(lines):
                if tag_start in l_text:
                    line = i + 1
                    start_idx = l_text.find(tag_start)
                    end_idx = l_text.find('>', start_idx)
                    if start_idx != -1 and end_idx != -1:
                        extract = l_text[start_idx:end_idx+1]
                    break
        return line, extract

    line, extract = get_element_info(html_tag)
    
    if not lang or not xml_lang:
        issue = {
            "type": "missing_language_declaration",
            "message": f"<html> must declare both lang=\"{expected_lang}\" and xml:lang=\"{expected_lang}\".",
            "category": "Error",
            "file_path": file_details.get("relative_path"),
            "extract": extract
        }
        if line: issue["line_number"] = line
        issues.append(issue)
    else:
        if lang != expected_lang or xml_lang != expected_lang:
            issue = {
                "type": "invalid_language_declaration",
                "message": f"<html> language must be \"{expected_lang}\". Found lang=\"{lang}\" and xml:lang=\"{xml_lang}\".",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("XHTML004")
def validate_title_element(book_details, rule_config=None):
    """Ensure exactly one non-empty <title> element exists per XHTML file, and its text is unique across all pages."""
    epub_path = book_details["epub_path"]
    issues = []
    
    # Locate XHTML files
    inner_config = rule_config.get("rule_config", {}) if rule_config else {}
    xhtml_folder_name = inner_config.get("xhtml_folder", "Text")
    
    xhtml_dir = os.path.join(epub_path, "OEBPS", xhtml_folder_name)
    if not os.path.isdir(xhtml_dir):
        return {"issues_count": 0, "issues": []}
        
    xhtml_files = [f for f in os.listdir(xhtml_dir) if f.lower().endswith(".xhtml")]
    xhtml_files.sort()
    
    seen_titles = {} # title_text -> relative_file_path
    
    def get_element_info(el, html_content):
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        idx = html_content.find(extract)
        if idx != -1:
            line = html_content.count('\n', 0, idx) + 1
        else:
            tag_name = el.name
            lines = html_content.split('\n')
            line = getattr(el, "sourceline", None)
            tag_start = f"<{tag_name}"
            for i, l_text in enumerate(lines):
                if tag_start in l_text:
                    line = i + 1
                    start_idx = l_text.find(tag_start)
                    end_idx = l_text.find('>', start_idx)
                    if start_idx != -1 and end_idx != -1:
                        extract = l_text[start_idx:end_idx+1]
                    break
        return line, extract

    from bs4 import BeautifulSoup
    for file_name in xhtml_files:
        file_path = os.path.join(xhtml_dir, file_name)
        rel_path = f"OEBPS/{xhtml_folder_name}/{file_name}"
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                html_text = f.read()
                soup = BeautifulSoup(html_text, "xml")
        except Exception:
            continue

        head = soup.find("head")
        if not head:
            issues.append({
                "type": "missing_head",
                "message": "File is missing a <head> element.",
                "category": "Error",
                "file_path": rel_path,
            })
            continue

        titles = head.find_all("title")
        
        if len(titles) == 0:
            issues.append({
                "type": "missing_title",
                "message": "File requires exactly one <title> element inside <head>.",
                "category": "Error",
                "file_path": rel_path,
            })
        elif len(titles) > 1:
            # Report only the extra titles to prevent duplicate error messages in the UI
            for t in titles[1:]:
                line, extract = get_element_info(t, html_text)
                issue = {
                    "type": "duplicate_title_element",
                    "message": "File contains multiple <title> elements. Only one is allowed",
                    "category": "Error",
                    "file_path": rel_path,
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)
        else:
            title = titles[0]
            title_text = title.text.strip() if title.text else ""
            
            if not title_text:
                line, extract = get_element_info(title, html_text)
                issue = {
                    "type": "empty_title",
                    "message": "<title> element cannot be empty.",
                    "category": "Error",
                    "file_path": rel_path,
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)
            else:
                if title_text in seen_titles:
                    line, extract = get_element_info(title, html_text)
                    issue = {
                        "type": "duplicate_title_text",
                        "message": f"Title text '{title_text}' is duplicated. It was already used in {seen_titles[title_text]}.",
                        "category": "Error",
                        "file_path": rel_path,
                        "extract": extract
                    }
                    if line: issue["line_number"] = line
                    issues.append(issue)
                else:
                    seen_titles[title_text] = rel_path
                    
    return {"issues_count": len(issues), "issues": issues}

@rule("XHTML005")
def validate_heading_line_breaks(file_details, rule_config=None):
    """Ensure no line break tags (<br/>) are placed within HTML headings."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception as e:
        return {"issues_count": 0, "issues": []}

    def get_element_info(el):
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        idx = html_text.find(extract)
        if idx != -1:
            line = html_text.count('\n', 0, idx) + 1
        else:
            tag_name = el.name
            lines = html_text.split('\n')
            line = getattr(el, "sourceline", None)
            tag_start = f"<{tag_name}"
            for i, l_text in enumerate(lines):
                if tag_start in l_text:
                    line = i + 1
                    start_idx = l_text.find(tag_start)
                    end_idx = l_text.find('>', start_idx)
                    if start_idx != -1 and end_idx != -1:
                        extract = l_text[start_idx:end_idx+1]
                    break
        return line, extract

    headings = soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
    for heading in headings:
        br_tags = heading.find_all("br")
        if br_tags:
            for br in br_tags:
                line, extract = get_element_info(br)
                issue = {
                    "type": "heading_contains_br",
                    "message": f"Do not place line break tags (<br/>) within <{heading.name}> headings to separate text. Use CSS to achieve the line break. Example:\nspan.O-ch-title::before{{\n  content: '\\A';\n  white-space: pre;\n}}",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}

@rule("XHTML006")
def validate_h1_count_and_adjacent_headings(file_details, rule_config=None):
    """Ensure exactly 1 <h1> per file and no adjacent heading tags."""
    file_path = file_details["full_path"]
    issues = []
    
    try:
        from bs4 import BeautifulSoup
        with open(file_path, "r", encoding="utf-8") as f:
            html_text = f.read()
            soup = BeautifulSoup(html_text, "xml")
    except Exception as e:
        return {"issues_count": 0, "issues": []}

    def get_element_info(el):
        line = getattr(el, "sourceline", None)
        s = str(el)
        end = s.find('>')
        extract = s[:end+1] if end != -1 else s
        
        if line is not None:
            return line, extract
            
        # Fallback to robust index matching for identical or empty tags
        all_same_tags = soup.find_all(el.name)
        occurrence_index = -1
        for i, tag in enumerate(all_same_tags):
            if tag is el:
                occurrence_index = i
                break
                
        if occurrence_index != -1:
            tag_start = f"<{el.name}"
            current_pos = 0
            for _ in range(occurrence_index + 1):
                current_pos = html_text.find(tag_start, current_pos)
                if current_pos == -1:
                    break
                current_pos += 1
                
            if current_pos != -1:
                start_idx = current_pos - 1
                line = html_text.count('\n', 0, start_idx) + 1
                end_idx = html_text.find('>', start_idx)
                if end_idx != -1:
                    extract = html_text[start_idx:end_idx+1]
                return line, extract

        idx = html_text.find(s)
        if idx != -1:
            line = html_text.count('\n', 0, idx) + 1
        else:
            line = 1
        return line, extract

    # 1) Check for maximum one <h1>
    h1_tags = soup.find_all("h1")
    if len(h1_tags) > 1:
        # Skip the first one because 1 is allowed
        for i, h1 in enumerate(h1_tags[1:], start=2):
            line, extract = get_element_info(h1)
            issue = {
                "type": "multiple_h1",
                "rule_name": "Multiple <h1> tags",
                "message": f"Use 1 <h1> per unit/chapter/lesson title. Found an extra <h1> tag (this is #{i}). Only one is allowed per page.",
                "category": "Error",
                "file_path": file_details.get("relative_path"),
                "extract": extract
            }
            if line: issue["line_number"] = line
            issues.append(issue)

    # 2) Check for adjacent heading tags
    headings = soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
    for heading in headings:
        next_sib = heading.find_next_sibling()
        if next_sib and next_sib.name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            # Check if there is any non-whitespace text between them
            has_text = False
            for node in heading.next_siblings:
                if node == next_sib:
                    break
                if node.name is None and str(node).strip():
                    has_text = True
                    break
            
            if not has_text:
                # Highlight the SECOND heading so the UI points to the offending adjacent tag
                line, extract = get_element_info(next_sib)
                issue = {
                    "type": "adjacent_headings",
                    "rule_name": "Adjacent heading tags",
                    "message": f"Do not place two heading tags immediately next to each other. Found <{next_sib.name}> immediately following <{heading.name}>.",
                    "category": "Error",
                    "file_path": file_details.get("relative_path"),
                    "extract": extract
                }
                if line: issue["line_number"] = line
                issues.append(issue)

    return {"issues_count": len(issues), "issues": issues}
