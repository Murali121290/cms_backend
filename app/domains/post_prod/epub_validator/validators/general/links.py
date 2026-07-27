import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from ...engine.registry import rule
from ...services import book_bundle_service as _bundle
from ._common import _check_single_url, _cli_issue_to_web, _drop_pass_issues, _make_session


@rule("URL001")
def validate_internal_xhtml_links(file_details):
    file_path = file_details["full_path"]
    issues = []

    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    links = soup.find_all("a", href=True)

    for link in links:
        href = link["href"].strip()
        if not href.split("#")[0].endswith(".xhtml"):
            continue
        parts = href.split("#")
        file_name = parts[0]
        anchor = parts[1] if len(parts) > 1 else None
        current_dir = os.path.dirname(file_path)
        target_file = os.path.normpath(os.path.join(current_dir, file_name))

        if not os.path.exists(target_file):
            issues.append({
                "rule_name": "Missing Internal File",
                "type": "missing_internal_file",
                "href": href,
                "message": "Referenced XHTML file not found",
                "category": "Error",
            })
            continue

        if anchor:
            with open(target_file, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f, "html.parser")
            element = soup.find(id=anchor)
            if not element:
                issues.append({
                    "rule_name": "Missing Anchor",
                    "type": "missing_anchor",
                    "href": href,
                    "message": "Referenced anchor not found in target file",
                    "category": "Error",
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("URL002")
def validate_external_urls(file_details):
    file_path = file_details["full_path"]
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    hrefs = [
        link["href"].strip()
        for link in soup.find_all("a", href=True, class_="url")
        if link["href"].strip().startswith(("http://", "https://"))
    ]

    if not hrefs:
        return {"issues_count": 0, "issues": []}

    session = _make_session()
    issues = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_check_single_url, href, session): href for href in hrefs}
        for future in as_completed(futures):
            result = future.result()
            if result:
                issues.append(result)

    return {"issues_count": len(issues), "issues": issues}


@rule("URL003")
def validate_url_text_match(file_details):
    file_path = file_details["full_path"]
    issues = []
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    links = soup.find_all("a", href=True, class_="url")
    for link in links:
        href = link["href"].strip()
        text = link.get_text(strip=True)
        if href != text:
            issues.append({
                "type": "url_text_mismatch",
                "href": href,
                "expected_text": href,
                "actual_text": text,
                "message": "Displayed URL text does not match href",
                "category": "warning",
            })
    return {"issues_count": len(issues), "issues": issues}


@rule("URL004")
def validate_pdf_link_checker(book_details):
    """Book-scope: broken anchors + missing-link patterns."""
    from ...vendor.pdf_epub_validator import LinkChecker

    folder = book_details["folder_name"]
    bundle = _bundle.get_epub_bundle(folder)
    if not bundle:
        return {"issues_count": 0, "issues": []}
    cli_issues = LinkChecker(bundle).run_all()
    issues = _drop_pass_issues([_cli_issue_to_web(i) for i in cli_issues])
    return {"issues_count": len(issues), "issues": issues}
