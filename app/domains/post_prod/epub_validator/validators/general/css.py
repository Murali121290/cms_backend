import os

import requests
from bs4 import BeautifulSoup

from ...engine.registry import rule
from ._common import _call_w3c_css_validator


@rule("CSS001")
@rule("CSS002")
def validate_css_w3c(file_details):
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
        try:
            issues = _call_w3c_css_validator(css_content, css_label)
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

    validated_css: dict[str, list] = {}
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

        if css_path in validated_css:
            for issue in validated_css[css_path]:
                issues.append(dict(issue, css_file=href))
            continue

        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()

        if not css_content.strip():
            validated_css[css_path] = []
            continue

        try:
            css_file_issues = _call_w3c_css_validator(css_content, href)
            validated_css[css_path] = css_file_issues
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
