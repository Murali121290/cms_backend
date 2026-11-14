import os
import re

from bs4 import BeautifulSoup

from app.core.config import get_settings

from ..engine.registry import rule

from ._common import find_opf

_PRINTED_RE = re.compile(r"\bprinted\b", re.IGNORECASE)
_EISBN_DIGITS_RE = re.compile(r"\d[\d\-\s]{10,}\d")


def _extract_eisbn(epub_folder: str) -> str | None:
    opf = find_opf(epub_folder)
    if not opf:
        return None
    try:
        with open(opf, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "xml")
    except Exception:
        return None
    for ident in soup.find_all("dc:identifier"):
        id_attr = (ident.get("id") or "").lower()
        text = ident.get_text(strip=True)
        if "epub" in id_attr or "eisbn" in text.lower():
            digits = "".join(ch for ch in text if ch.isdigit())
            return digits or None
    ident = soup.find("dc:identifier")
    if ident:
        digits = "".join(ch for ch in ident.get_text(strip=True) if ch.isdigit())
        return digits or None
    return None


@rule("ASP-COPY-001")
def validate_no_printed_word(file_details, rule_config=None):
    """The word "Printed" must not appear on the copyright page."""
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        text = f.read()
        soup = BeautifulSoup(text, "html.parser")
    body_text = soup.get_text(" ", strip=True)
    m = _PRINTED_RE.search(text)
    if m:
        line_num = text[:m.start()].count("\n") + 1
        return {"issues_count": 1, "issues": [{
            "type": "printed_word_present",
            "message": f'Line {line_num}: Copyright page contains the forbidden word "Printed"',
            "category": "Error",
            "line_number": line_num,
        }]}
    return {"issues_count": 0, "issues": []}



@rule("ASP-COPY-002")
def validate_eisbn_in_copyright(file_details, rule_config=None):
    """The eISBN (from OPF) must appear on the copyright page."""
    eisbn = _extract_eisbn(file_details["epub_root"])
    if not eisbn:
        return {"issues_count": 1, "issues": [{
            "type": "eisbn_unknown",
            "message": "Could not extract eISBN from OPF to check copyright page",
            "category": "Warning",
        }]}
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        text = f.read()
    body_digits = "".join(ch for ch in text if ch.isdigit())
    if eisbn not in body_digits:
        return {"issues_count": 1, "issues": [{
            "type": "eisbn_missing_from_copyright",
            "message": f"Copyright page does not contain the eISBN {eisbn}",
            "category": "Error",
        }]}
    return {"issues_count": 0, "issues": []}


@rule("BOD-COPY-002")
def validate_copyright_top_alignment(file_details, rule_config=None):
    """
    Alignment of the copyright page should be top aligned (Control in CSS):
    - Validates that text elements (p, h1-h6) on the copyright page use only
      the allowed classes (e.g. cpytxt, cpytxt-top-space). Any element without a class
      or with an unauthorized class raises an error.
    - Validates that required classes (e.g. cpytxt-top-space) appear at least the specified
      minimum number of times (e.g. >= 1) on the copyright page as defined in rule_config.
    - Validates that no inline styles prevent top alignment.
    """
    import os

    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    allowed_classes = set(cfg.get("allowed_classes") or ["cpytxt", "cpytxt-top-space"])
    required_classes = cfg.get("required_classes") or ["cpytxt-top-space"]
    min_required_count = cfg.get("min_required_count") or {"cpytxt-top-space": 1}

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    body = soup.find("body")
    if not body:
        return {"issues_count": 0, "issues": []}

    # 1. Check for disallowed inline styles that push or align to bottom
    for el in body.find_all(True, style=True):
        style_val = (el.get("style") or "").lower()
        if "vertical-align: bottom" in style_val or "justify-content: flex-end" in style_val or "position: absolute; bottom" in style_val:
            line_no = getattr(el, "sourceline", None) or 1
            issues.append({
                "type": "invalid_copyright_alignment_style",
                "message": f"Inline style '{style_val}' on <{el.name}> prevents top alignment. Copyright page must be top aligned.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": line_no,
                "snippet": str(el)[:150],
                "extract": str(el)[:150],
            })

    # Track occurrences of classes across text elements
    class_occurrence_counts = {c: 0 for c in required_classes}

    # 2. Check text elements inside body (p, h1-h6) to ensure they use allowed classes
    text_elements = body.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6"])
    for el in text_elements:
        classes = el.get("class", [])
        if isinstance(classes, str):
            classes = classes.split()
        classes_set = set(classes)

        # Count occurrences of required classes
        for rc in required_classes:
            if rc in classes_set:
                class_occurrence_counts[rc] = class_occurrence_counts.get(rc, 0) + 1

        # Check if element has no class or has disallowed classes
        if not classes:
            # Without class
            line_no = getattr(el, "sourceline", None) or 1
            issues.append({
                "type": "missing_copyright_class",
                "message": f"Copyright page element <{el.name}> has no class. Elements on copyright page must have an allowed class ({', '.join(sorted(allowed_classes))}).",
                "category": "Error",
                "file_path": rel_path,
                "line_number": line_no,
                "snippet": str(el)[:150],
                "extract": str(el)[:150],
            })
        else:
            disallowed = classes_set - allowed_classes
            if disallowed or not (classes_set & allowed_classes):
                line_no = getattr(el, "sourceline", None) or 1
                issues.append({
                    "type": "unauthorized_copyright_class",
                    "message": f"Copyright page element <{el.name}> has unauthorized class(es) '{' '.join(classes)}'. Allowed classes: {', '.join(sorted(allowed_classes))}.",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": line_no,
                    "snippet": str(el)[:150],
                    "extract": str(el)[:150],
                })

    # 3. Check minimum required counts for classes (e.g. cpytxt-top-space >= 1)
    for rc in required_classes:
        min_count = min_required_count.get(rc, 1)
        actual_count = class_occurrence_counts.get(rc, 0)
        if actual_count < min_count:
            issues.append({
                "type": "missing_required_copyright_class",
                "message": f"Required class '{rc}' must be present at least {min_count} time(s) on copyright page, but found {actual_count}.",
                "category": "Error",
                "file_path": rel_path,
                "line_number": 10,
                "snippet": f"Expected at least {min_count} element(s) with class='{rc}', found {actual_count}",
                "extract": f"class='{rc}' count: {actual_count} (minimum required: {min_count})",
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-003")
def validate_copyright_single_page(file_details, rule_config=None):
    """
    Copyright should fit on one page:
    Validates that the pagebreak marker (<span epub:type="pagebreak" role="doc-pagebreak".../>)
    appears exactly 1 time (not multiple times) in the copyright file.
    Does not enforce specific id or aria-label attribute values.
    """
    import os

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # Find all pagebreak spans (checking epub:type="pagebreak" or role="doc-pagebreak")
    def is_pagebreak_span(tag):
        if tag.name != "span":
            return False
        epub_type = (tag.get("epub:type") or "").lower()
        role = (tag.get("role") or "").lower()
        return "pagebreak" in epub_type or role == "doc-pagebreak"

    pagebreak_tags = soup.find_all(is_pagebreak_span)
    pb_count = len(pagebreak_tags)

    if pb_count == 0:
        issues.append({
            "type": "copyright_pagebreak_missing",
            "message": f"Copyright page '{file_name}' is missing a pagebreak marker (<span epub:type=\"pagebreak\" role=\"doc-pagebreak\"/>). Exactly 1 pagebreak marker is required.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": f"File: {file_name}",
            "extract": f"File: {file_name}",
        })
    elif pb_count > 1:
        # Flag all extra pagebreak tags starting from the 2nd one
        for extra_pb in pagebreak_tags[1:]:
            line_no = getattr(extra_pb, "sourceline", None) or 1
            issues.append({
                "type": "copyright_multiple_pages",
                "message": (
                    f"Copyright page must fit on one page. Found {pb_count} pagebreak markers in '{file_name}'. "
                    f"Extra pagebreak marker found: {str(extra_pb)[:120]}"
                ),
                "category": "Error",
                "file_path": rel_path,
                "line_number": line_no,
                "snippet": str(extra_pb)[:150],
                "extract": str(extra_pb)[:150],
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-004")
def validate_copyright_statement_by_language(file_details, rule_config=None):
    """
    Validates that the copyright page contains the required legal statement based on language:
    - German (DE): "Die automatisierte Analyse des Werkes, um daraus Informationen insbesondere über Muster, Trends und Korrelationen gemäß § 44b UrhG („Text und Data Mining“) zu gewinnen, ist untersagt."
    - Swiss (CH): "Die automatisierte Analyse des Werkes, um daraus Informationen insbesondere über Muster, Trends und Korrelationen („Text und Data Mining“) zu gewinnen, ist untersagt."
    
    Language resolution follows BOD-AUT-001 pattern:
    1. Checks DB language from EvProject / BodJob
    2. Fallback to OPF dc:language
    3. Fallback to HTML lang / xml:lang
    """
    import os
    import glob
    import unicodedata

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # Determine language following the BOD-AUT-001 pattern
    detected_lang = (file_details.get("language") or "").strip().lower()

    # 1. First check DB language (EvProject.language or BodJob.pdf_language) if not passed directly
    folder_name = file_details.get("folder_name", "")
    if not detected_lang and folder_name:
        try:
            from app.core.database import SessionLocal
            from app.domains.post_prod.epub_validator.models import EvProject
            from app.domains.books_on_demand.models import BodJob
            db = SessionLocal()
            try:
                # Check EvProject table
                proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
                if proj and proj.language:
                    detected_lang = proj.language.strip().lower()

                # Also check BodJob table if not yet resolved
                if not detected_lang:
                    job = db.query(BodJob).filter(
                        (BodJob.project_name == folder_name) | (BodJob.pdf_filename.startswith(folder_name))
                    ).first()
                    if job and job.pdf_language:
                        detected_lang = job.pdf_language.strip().lower()
            finally:
                db.close()
        except Exception:
            pass

    # 2. Find OPF to extract dc:language if not found in DB
    epub_root = file_details.get("epub_root") or file_details.get("epub_path")
    if not epub_root and full_path:
        curr = os.path.dirname(os.path.abspath(full_path))
        while curr and curr != "/":
            if glob.glob(os.path.join(curr, "*.opf")) or os.path.exists(os.path.join(curr, "mimetype")):
                epub_root = curr
                break
            curr = os.path.dirname(curr)

    if not detected_lang and epub_root:
        opf_file = find_opf(epub_root)
        if opf_file and os.path.exists(opf_file):
            try:
                with open(opf_file, "r", encoding="utf-8") as opf_f:
                    opf_soup = BeautifulSoup(opf_f.read(), "xml")
                    lang_tag = opf_soup.find(["dc:language", "language"])
                    if lang_tag and lang_tag.get_text(strip=True):
                        detected_lang = lang_tag.get_text(strip=True).lower()
            except Exception:
                pass

    # 3. Fallback language to HTML lang / xml:lang
    if not detected_lang:
        html_tag = soup.find("html")
        if html_tag:
            detected_lang = (html_tag.get("xml:lang") or html_tag.get("lang") or "").lower()

    # Normalize language code (matching BOD-AUT-001)
    lang_key = detected_lang.strip().lower()
    if "-" in lang_key:
        lang_key = lang_key.split("-")[0]
    if "_" in lang_key:
        lang_key = lang_key.split("_")[0]

    lang_map = {
        "german": "de", "swiss": "ch", "danish": "da", "finnish": "fi", "french": "fr",
        "swedish": "sv", "norwegian": "no", "spanish": "es", "english": "en",
        "italian": "it", "portuguese": "pt", "dutch": "nl", "catalan": "ca",
        "valencian": "va"
    }
    if lang_key in lang_map:
        lang_key = lang_map[lang_key]

    # Read configuration from customer.json (expected_statement_by_language)
    config_dict = (rule_config or {}).get("rule_config", {})
    expected_by_lang = config_dict.get("expected_statement_by_language")
    if not expected_by_lang or not isinstance(expected_by_lang, dict):
        return {"issues_count": 1, "issues": [{
            "type": "configuration_error",
            "message": "Missing 'expected_statement_by_language' in rule configuration for BOD-COPY-004.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 0,
        }]}

    # Lookup directly in configuration dictionary using detected language
    expected_statement = expected_by_lang.get(lang_key) or expected_by_lang.get(detected_lang)

    # If this language has no statement configured in customer.json, this rule does not apply
    if not expected_statement:
        return {"issues_count": 0, "issues": []}

    def normalize_str(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        s = s.replace("„", '"').replace("“", '"').replace("”", '"').replace("»", '"').replace("«", '"')
        s = s.replace("’", "'").replace("‘", "'")
        s = re.sub(r"\s+", " ", s)
        return s.strip().lower()

    body = soup.find("body")
    page_text = body.get_text(" ", strip=True) if body else content
    norm_page_text = normalize_str(page_text)
    norm_expected = normalize_str(expected_statement)

    if norm_expected not in norm_page_text:
        issues.append({
            "type": "missing_copyright_statement",
            "message": "Copyright page is missing the required statement or expected statement is partially present",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": expected_statement,
            "expected_text":expected_statement,
            "extract": f"Expected: {expected_statement}",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-005")
def validate_copyright_publisher_by_language(file_details, rule_config=None):
    """
    Validates that the copyright page contains the required publisher sentence/label based on language
    (e.g., German (de): "Herstellung und Verlag:").
    
    Language resolution follows BOD-AUT-001 / BOD-COPY-004 pattern:
    1. Checks DB language from EvProject / BodJob
    2. Fallback to OPF dc:language
    3. Fallback to HTML lang / xml:lang
    """
    import os
    import glob
    import unicodedata

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # Determine language following the BOD-AUT-001 pattern
    detected_lang = (file_details.get("language") or "").strip().lower()

    # 1. First check DB language (EvProject.language or BodJob.pdf_language) if not passed directly
    folder_name = file_details.get("folder_name", "")
    if not detected_lang and folder_name:
        try:
            from app.core.database import SessionLocal
            from app.domains.post_prod.epub_validator.models import EvProject
            from app.domains.books_on_demand.models import BodJob
            db = SessionLocal()
            try:
                # Check EvProject table
                proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
                if proj and proj.language:
                    detected_lang = proj.language.strip().lower()

                # Also check BodJob table if not yet resolved
                if not detected_lang:
                    job = db.query(BodJob).filter(
                        (BodJob.project_name == folder_name) | (BodJob.pdf_filename.startswith(folder_name))
                    ).first()
                    if job and job.pdf_language:
                        detected_lang = job.pdf_language.strip().lower()
            finally:
                db.close()
        except Exception:
            pass

    # 2. Find OPF to extract dc:language if not found in DB
    epub_root = file_details.get("epub_root") or file_details.get("epub_path")
    if not epub_root and full_path:
        curr = os.path.dirname(os.path.abspath(full_path))
        while curr and curr != "/":
            if glob.glob(os.path.join(curr, "*.opf")) or os.path.exists(os.path.join(curr, "mimetype")):
                epub_root = curr
                break
            curr = os.path.dirname(curr)

    if not detected_lang and epub_root:
        opf_file = find_opf(epub_root)
        if opf_file and os.path.exists(opf_file):
            try:
                with open(opf_file, "r", encoding="utf-8") as opf_f:
                    opf_soup = BeautifulSoup(opf_f.read(), "xml")
                    lang_tag = opf_soup.find(["dc:language", "language"])
                    if lang_tag and lang_tag.get_text(strip=True):
                        detected_lang = lang_tag.get_text(strip=True).lower()
            except Exception:
                pass

    # 3. Fallback language to HTML lang / xml:lang
    if not detected_lang:
        html_tag = soup.find("html")
        if html_tag:
            detected_lang = (html_tag.get("xml:lang") or html_tag.get("lang") or "").lower()

    # Normalize language code (matching BOD-AUT-001)
    lang_key = detected_lang.strip().lower()
    if "-" in lang_key:
        lang_key = lang_key.split("-")[0]
    if "_" in lang_key:
        lang_key = lang_key.split("_")[0]

    lang_map = {
        "german": "de", "swiss": "ch", "danish": "da", "finnish": "fi", "french": "fr",
        "swedish": "sv", "norwegian": "no", "spanish": "es", "english": "en",
        "italian": "it", "portuguese": "pt", "dutch": "nl", "catalan": "ca",
        "valencian": "va"
    }
    if lang_key in lang_map:
        lang_key = lang_map[lang_key]

    # Read configuration from customer.json (expected_publisher_by_language)
    config_dict = (rule_config or {}).get("rule_config", {})
    expected_by_lang = config_dict.get("expected_publisher_by_language")
    if not expected_by_lang or not isinstance(expected_by_lang, dict):
        return {"issues_count": 1, "issues": [{
            "type": "configuration_error",
            "message": "Missing 'expected_publisher_by_language' in rule configuration for BOD-COPY-005.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 0,
        }]}

    # Lookup directly in configuration dictionary using detected language
    expected_statement = expected_by_lang.get(lang_key) or expected_by_lang.get(detected_lang)

    # If this language has no statement configured in customer.json, this rule does not apply
    if not expected_statement:
        return {"issues_count": 0, "issues": []}

    def normalize_str(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        s = s.replace("„", '"').replace("“", '"').replace("”", '"').replace("»", '"').replace("«", '"')
        s = s.replace("’", "'").replace("‘", "'")
        s = re.sub(r"\s+", " ", s)
        return s.strip().lower()

    body = soup.find("body")
    page_text = body.get_text(" ", strip=True) if body else content
    norm_page_text = normalize_str(page_text)
    norm_expected = normalize_str(expected_statement)

    if norm_expected not in norm_page_text:
        issues.append({
            "type": "missing_copyright_publisher",
            "message": "Copyright page is missing the required publisher sentence or expected sentence is partially present",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": expected_statement,
            "expected_text": expected_statement,
            "extract": f"Expected: {expected_statement}",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-006")
def validate_copyright_publisher_address_by_language(file_details, rule_config=None):
    """
    Validates that the copyright page contains the required publisher address and URL based on language:
    - German (DE/GE):
        Text: "BoD · Books on Demand GmbH, Überseering 33, 22297 Hamburg"
        URL:  "http://www.bod.de"
    - Swiss (CH):
        Text: "BoD · Books on Demand GmbH, Überseering 33, 22297 Hamburg, Deutschland"
        URL:  "http://www.bod.ch/"
    Expected tag: <p class="cpytxt"><a href="...">BoD · Books on Demand GmbH</a>, Überseering 33, 22297 Hamburg...</p>
    
    Language resolution follows BOD-AUT-001 / BOD-COPY-004 / BOD-COPY-005 pattern:
    1. Checks DB language from EvProject / BodJob
    2. Fallback to OPF dc:language
    3. Fallback to HTML lang / xml:lang
    """
    import os
    import glob
    import unicodedata

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # Determine language following the BOD-AUT-001 pattern
    detected_lang = (file_details.get("language") or "").strip().lower()

    # 1. First check DB language (EvProject.language or BodJob.pdf_language) if not passed directly
    folder_name = file_details.get("folder_name", "")
    if not detected_lang and folder_name:
        try:
            from app.core.database import SessionLocal
            from app.domains.post_prod.epub_validator.models import EvProject
            from app.domains.books_on_demand.models import BodJob
            db = SessionLocal()
            try:
                # Check EvProject table
                proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
                if proj and proj.language:
                    detected_lang = proj.language.strip().lower()

                # Also check BodJob table if not yet resolved
                if not detected_lang:
                    job = db.query(BodJob).filter(
                        (BodJob.project_name == folder_name) | (BodJob.pdf_filename.startswith(folder_name))
                    ).first()
                    if job and job.pdf_language:
                        detected_lang = job.pdf_language.strip().lower()
            finally:
                db.close()
        except Exception:
            pass

    # 2. Find OPF to extract dc:language if not found in DB
    epub_root = file_details.get("epub_root") or file_details.get("epub_path")
    if not epub_root and full_path:
        curr = os.path.dirname(os.path.abspath(full_path))
        while curr and curr != "/":
            if glob.glob(os.path.join(curr, "*.opf")) or os.path.exists(os.path.join(curr, "mimetype")):
                epub_root = curr
                break
            curr = os.path.dirname(curr)

    if not detected_lang and epub_root:
        opf_file = find_opf(epub_root)
        if opf_file and os.path.exists(opf_file):
            try:
                with open(opf_file, "r", encoding="utf-8") as opf_f:
                    opf_soup = BeautifulSoup(opf_f.read(), "xml")
                    lang_tag = opf_soup.find(["dc:language", "language"])
                    if lang_tag and lang_tag.get_text(strip=True):
                        detected_lang = lang_tag.get_text(strip=True).lower()
            except Exception:
                pass

    # 3. Fallback language to HTML lang / xml:lang
    if not detected_lang:
        html_tag = soup.find("html")
        if html_tag:
            detected_lang = (html_tag.get("xml:lang") or html_tag.get("lang") or "").lower()

    # Normalize language code (matching BOD-AUT-001)
    lang_key = detected_lang.strip().lower()
    if "-" in lang_key:
        lang_key = lang_key.split("-")[0]
    if "_" in lang_key:
        lang_key = lang_key.split("_")[0]

    lang_map = {
        "german": "de", "ge": "de", "swiss": "ch", "danish": "da", "finnish": "fi", "french": "fr",
        "swedish": "sv", "norwegian": "no", "spanish": "es", "english": "en",
        "italian": "it", "portuguese": "pt", "dutch": "nl", "catalan": "ca",
        "valencian": "va"
    }
    if lang_key in lang_map:
        lang_key = lang_map[lang_key]

    # Read configuration from customer.json (expected_publisher_address_by_language)
    config_dict = (rule_config or {}).get("rule_config", {})
    expected_by_lang = config_dict.get("expected_publisher_address_by_language")
    if not expected_by_lang or not isinstance(expected_by_lang, dict):
        return {"issues_count": 1, "issues": [{
            "type": "configuration_error",
            "message": "Missing 'expected_publisher_address_by_language' in rule configuration for BOD-COPY-006.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 0,
        }]}

    # Lookup directly in configuration dictionary using detected language
    cfg_entry = expected_by_lang.get(lang_key) or expected_by_lang.get(detected_lang)

    # If this language has no address configured in customer.json, this rule does not apply
    if not cfg_entry:
        return {"issues_count": 0, "issues": []}

    expected_address = ""
    expected_url = ""
    if isinstance(cfg_entry, dict):
        expected_address = cfg_entry.get("address", "").strip()
        expected_url = cfg_entry.get("url", "").strip()
    elif isinstance(cfg_entry, str):
        expected_address = cfg_entry.strip()

    def normalize_str(s: str) -> str:
        s = unicodedata.normalize("NFKC", s)
        s = s.replace("„", '"').replace("“", '"').replace("”", '"').replace("»", '"').replace("«", '"')
        s = s.replace("’", "'").replace("‘", "'")
        s = re.sub(r"[,;\.\s]+", " ", s)
        return s.strip().lower()

    def normalize_url(url: str) -> str:
        u = (url or "").strip().lower()
        u = re.sub(r"^https?://", "", u)
        return u.rstrip("/")

    norm_expected_address = normalize_str(expected_address)
    norm_expected_url = normalize_url(expected_url)

    # Search for matching paragraph on copyright page
    # First look at <p class="cpytxt">, then fallback to any <p> on copyright page
    p_tags = soup.find_all("p")
    matched = False
    found_address_without_url = False
    actual_url_found = ""

    for p in p_tags:
        p_text_norm = normalize_str(p.get_text(" ", strip=True))
        if norm_expected_address in p_text_norm:
            # Check link inside this paragraph
            a_tag = p.find("a")
            href = a_tag.get("href", "") if a_tag else ""
            actual_url_found = href
            if not expected_url or normalize_url(href) == norm_expected_url:
                matched = True
                break
            else:
                found_address_without_url = True

    if not matched:
        if found_address_without_url:
            msg = f"Copyright page publisher address URL is incorrect. Expected href='{expected_url}', but found href='{actual_url_found}'"
            snippet = f"<a href=\"{actual_url_found}\">...</a> (Expected: href=\"{expected_url}\")"
        else:
            msg = f"Copyright page is missing the required publisher address or expected address is partially present: \"{expected_address}\""
            snippet = f"{expected_address} (URL: {expected_url})" if expected_url else expected_address

        issues.append({
            "type": "missing_copyright_publisher_address",
            "message": msg,
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": snippet,
            "expected_text": expected_address,
            "expected_url": expected_url,
            "extract": f"Expected: {snippet}",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-007")
def validate_copyright_isbn_from_db(file_details, rule_config=None):
    """
    Validates that the copyright page contains the correct 13-digit ISBN/eISBN:
    1. Fetches the expected eISBN from the database (BodJob.eisbn or EvProject.eisbn).
       Fallback to OPF <dc:identifier> if not set in DB.
    2. Verifies that the ISBN appears on the copyright page with a 13-digit pattern
       (e.g., <p class="cpytxt-top-space">ISBN: 9783696345518</p> or <p class="cpytxt">ISDN: 9783695720996</p>).
    """
    import os
    import re
    import glob

    full_path = file_details.get("full_path") or ""
    file_name = file_details.get("file_name") or os.path.basename(full_path)
    rel_path = file_details.get("relative_path") or file_name

    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # 1. Resolve expected eISBN from post_prod_ev_projects table
    expected_eisbn = None
    folder_name = file_details.get("folder_name", "")

    if folder_name:
        try:
            from app.core.database import SessionLocal
            from app.domains.post_prod.epub_validator.models import EvProject
            db = SessionLocal()
            try:
                proj = db.query(EvProject).filter(EvProject.folder_name == folder_name).first()
                if proj and proj.eisbn:
                    expected_eisbn = str(proj.eisbn).strip()
            finally:
                db.close()
        except Exception:
            pass

    # Normalize expected eISBN to digits only
    expected_digits = "".join(ch for ch in (expected_eisbn or "") if ch.isdigit())

    if not expected_digits:
        issues.append({
            "type": "eisbn_not_configured_in_db",
            "message": "eISBN value not given. Please update in BoD dashboard.",
            "category": "Warning",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": f"Folder: {folder_name}",
            "extract": f"Folder: {folder_name}",
        })
        return {"issues_count": len(issues), "issues": issues}

    # 2. Search for ISBN pattern on copyright page: strictly "ISBN: 9783696345518" (13 digits, no hyphens)
    isbn_pattern = re.compile(r'\bISBN\s*:\s*(\d{13})\b', re.IGNORECASE)

    found_isbns = []
    matched_exact = False

    for p in soup.find_all(["p", "div", "span"]):
        txt = p.get_text(" ", strip=True)
        m = isbn_pattern.search(txt)
        if m:
            digits = m.group(1)
            found_isbns.append((digits, txt, p))
            if digits == expected_digits:
                matched_exact = True
                break

    if not matched_exact:
        if found_isbns:
            found_str = ", ".join(f"'{f[0]}'" for f in found_isbns)
            msg = f"Copyright page ISBN does not match the expected eISBN '{expected_digits}'. Found: {found_str}"
            snippet = found_isbns[0][1]
        else:
            msg = f"Copyright page is missing the expected 13-digit eISBN with 'ISBN:' prefix '{expected_digits}' (e.g. 'ISBN: {expected_digits}')"
            snippet = f"Expected: ISBN: {expected_digits}"

        issues.append({
            "type": "copyright_isbn_mismatch",
            "message": msg,
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": snippet,
            "expected_text": f"ISBN: {expected_digits}",
            "extract": f"Expected eISBN: {expected_digits}",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COPY-008")
def validate_copyright_author_notice(file_details, rule_config=None):
    """
    BOD-COPY-008: Verifies copyright notice (© Year Author) on the copyright page.
    Extracts author from OPF <dc:creator> and year from OPF <dc:date>.
    Expected format: © {Year} {Author} (e.g. '© 2026 Terra Fox').
    """
    issues = []
    file_path = file_details.get("full_path", "")
    epub_root = file_details.get("epub_root", "")
    rel_path = file_details.get("relative_path", "")
    folder_name = file_details.get("folder_name", "")

    if not os.path.exists(file_path):
        return {"issues_count": 0, "issues": []}

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        soup = BeautifulSoup(content, "html.parser")
    except Exception:
        return {"issues_count": 0, "issues": []}

    # 1. Locate OPF and extract dc:creator and dc:date
    opf_path = find_opf(epub_root)
    if not opf_path and folder_name:
        settings = get_settings()
        for candidate_root in [
            os.path.join("/opt/cms_runtime/data/uploads", folder_name, "extract", "epub"),
            os.path.join(getattr(settings, "UPLOAD_FOLDER", "/opt/cms_runtime/data/uploads"), folder_name, "extract", "epub"),
            os.path.join(os.getcwd(), "uploads", folder_name, "extract", "epub"),
        ]:
            if os.path.isdir(candidate_root):
                opf_path = find_opf(candidate_root)
                if opf_path:
                    break

    author_name = None
    pub_year = None

    if opf_path and os.path.isfile(opf_path):
        try:
            with open(opf_path, "r", encoding="utf-8") as opf_file:
                opf_soup = BeautifulSoup(opf_file.read(), "xml")

            # Extract dc:creator (author)
            creator_tag = opf_soup.find(["dc:creator", "creator"])
            if creator_tag:
                author_name = creator_tag.get_text(" ", strip=True)

            # Extract dc:date (year)
            date_tag = opf_soup.find(["dc:date", "date"])
            if date_tag:
                date_val = date_tag.get_text(strip=True)
                m_year = re.search(r'\b(\d{4})\b', date_val)
                if m_year:
                    pub_year = m_year.group(1)
        except Exception:
            pass

    # Validate prerequisites from OPF
    if not author_name or not pub_year:
        missing_parts = []
        if not author_name:
            missing_parts.append("<dc:creator>")
        if not pub_year:
            missing_parts.append("<dc:date>")
        issues.append({
            "type": "copyright_metadata_missing",
            "message": f"Could not determine {' and '.join(missing_parts)} from OPF metadata for copyright statement check.",
            "category": "Warning",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": f"OPF: {os.path.basename(opf_path) if opf_path else 'Not found'}",
            "extract": "Metadata check",
        })
        return {"issues_count": len(issues), "issues": issues}

    expected_notice = f"© {pub_year} {author_name}"

    # 2. Check copyright file text for expected copyright notice
    # Normalize unicode spaces, non-breaking spaces, and (c) / ©
    def _normalize(txt: str) -> str:
        t = (txt or "").replace("\u00a0", " ").replace("&copy;", "©").replace("(c)", "©").replace("(C)", "©")
        return " ".join(t.split())

    norm_expected = _normalize(expected_notice).lower()

    # Search in paragraph / heading / div tags or full body
    matched = False
    matching_snippet = ""
    for elem in soup.find_all(["p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6"]):
        elem_text = elem.get_text(" ", strip=True)
        norm_elem = _normalize(elem_text).lower()
        if norm_expected in norm_elem:
            matched = True
            break
        # Also check with flexible whitespace between ©, year, and author
        esc_year = re.escape(pub_year)
        esc_author = re.escape(" ".join(author_name.split()))
        regex_pattern = re.compile(rf"(?:©|\(c\))\s*{esc_year}\s+{esc_author}", re.IGNORECASE)
        if regex_pattern.search(_normalize(elem_text)):
            matched = True
            break

    if not matched:
        full_text = soup.get_text(" ", strip=True)
        norm_full = _normalize(full_text).lower()
        if norm_expected in norm_full:
            matched = True
        else:
            esc_year = re.escape(pub_year)
            esc_author = re.escape(" ".join(author_name.split()))
            regex_pattern = re.compile(rf"(?:©|\(c\))\s*{esc_year}\s+{esc_author}", re.IGNORECASE)
            if regex_pattern.search(_normalize(full_text)):
                matched = True

    if not matched:
        body_snippet = soup.get_text(" ", strip=True)[:150]
        issues.append({
            "type": "copyright_author_notice_missing",
            "message": f"Copyright notice '{expected_notice}' is missing or incorrect in copyright page.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": 1,
            "snippet": body_snippet or f"Expected: {expected_notice}",
            "expected_text": expected_notice,
            "extract": f"Expected: {expected_notice}",
        })

    return {"issues_count": len(issues), "issues": issues}





