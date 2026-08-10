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
