import os
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule


@rule("STRUCT001")
def validate_epub_layout(book_details):
    """Root of extracted EPUB must contain META-INF/, OEBPS/, and a mimetype file
    with value 'application/epub+zip'.
    """
    epub = book_details["epub_path"]
    issues = []

    meta_inf = os.path.join(epub, "META-INF")
    if not os.path.isdir(meta_inf):
        issues.append({
            "type": "missing_meta_inf",
            "message": "Required folder 'META-INF/' is missing at EPUB root.",
            "category": "Error",
        })

    oebps = os.path.join(epub, "OEBPS")
    if not os.path.isdir(oebps):
        issues.append({
            "type": "missing_oebps",
            "message": "Required folder 'OEBPS/' is missing at EPUB root.",
            "category": "Error",
        })

    mimetype_path = os.path.join(epub, "mimetype")
    if not os.path.isfile(mimetype_path):
        issues.append({
            "type": "missing_mimetype",
            "message": "Required file 'mimetype' is missing at EPUB root.",
            "category": "Error",
        })
    else:
        try:
            with open(mimetype_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content != "application/epub+zip":
                issues.append({
                    "type": "wrong_mimetype",
                    "message": f"'mimetype' must contain exactly 'application/epub+zip' (found: {content!r}).",
                    "category": "Error",
                    "file_path": "mimetype",
                })
        except Exception as e:  # noqa: BLE001
            issues.append({
                "type": "mimetype_read_failed",
                "message": f"Could not read 'mimetype': {e}",
                "category": "Warning",
                "file_path": "mimetype",
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("STRUCT002")
def validate_container_xml(book_details):
    """META-INF/container.xml must exist and reference at least one OPF rootfile."""
    epub = book_details["epub_path"]
    container = os.path.join(epub, "META-INF", "container.xml")
    if not os.path.isfile(container):
        return {"issues_count": 1, "issues": [{
            "type": "missing_container_xml",
            "message": "'META-INF/container.xml' is missing.",
            "category": "Error",
        }]}

    try:
        with open(container, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "xml")
    except Exception as e:  # noqa: BLE001
        return {"issues_count": 1, "issues": [{
            "type": "container_xml_read_failed",
            "message": f"Could not parse container.xml: {e}",
            "category": "Error",
            "file_path": "META-INF/container.xml",
        }]}

    rootfiles = soup.find_all("rootfile")
    if not rootfiles:
        return {"issues_count": 1, "issues": [{
            "type": "container_xml_no_rootfile",
            "message": "container.xml has no <rootfile> element.",
            "category": "Error",
            "file_path": "META-INF/container.xml",
        }]}

    issues = []
    for rf in rootfiles:
        full_path = rf.get("full-path")
        if not full_path:
            issues.append({
                "type": "container_xml_missing_full_path",
                "message": "<rootfile> is missing the 'full-path' attribute.",
                "category": "Error",
                "file_path": "META-INF/container.xml",
            })
            continue
        target = os.path.join(epub, full_path)
        if not os.path.isfile(target):
            issues.append({
                "type": "container_xml_rootfile_missing",
                "message": f"container.xml points to '{full_path}' but that file does not exist.",
                "category": "Error",
                "file_path": "META-INF/container.xml",
            })
    return {"issues_count": len(issues), "issues": issues}


def _find_opf(epub: str) -> str | None:
    for root, _dirs, files in os.walk(epub):
        for f in files:
            if f.lower().endswith(".opf"):
                return os.path.join(root, f)
    return None


@rule("STRUCT003")
def validate_oebps_contents(book_details, rule_config=None):
    """OEBPS/ must contain the configured artefacts based on rule_config."""
    epub = book_details["epub_path"]
    folder_name = book_details.get("folder_name", "")
    issues = []

    # Enforce configuration
    inner_config = rule_config.get("rule_config") if rule_config else None
    if not inner_config:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "STRUCT003 requires a 'rule_config' in customer.json.",
            "category": "Error"
        }]}

    required_keys = ["opf_name", "css_folder", "css_file", "xhtml_folder", "images_folder", "nav_file", "toc_file"]
    missing = [k for k in required_keys if k not in inner_config]
    if missing:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": f"STRUCT003 rule_config is missing required keys: {', '.join(missing)}",
            "category": "Error"
        }]}

    opf_name_config = inner_config["opf_name"]
    css_folder_name = inner_config["css_folder"]
    css_file_name = inner_config["css_file"]
    xhtml_folder_name = inner_config["xhtml_folder"]
    images_folder_name = inner_config["images_folder"]
    nav_file_name = inner_config["nav_file"]
    toc_file_name = inner_config["toc_file"]
    fonts_folder_name = inner_config.get("fonts_folder")

    oebps = os.path.join(epub, "OEBPS")
    if not os.path.isdir(oebps):
        # Already reported by STRUCT001, but guard here
        return {"issues_count": 0, "issues": []}

    # 1. Check OPF file
    opf_path = _find_opf(epub)
    if opf_path is None:
        issues.append({
            "type": "missing_opf",
            "message": "No .opf file found in OEBPS/.",
            "category": "Error",
            "file_path": "OEBPS",
        })
    else:
        opf_filename = os.path.basename(opf_path)
        if opf_name_config.lower() == "isbn":
            # Verify OPF filename matches 10/13-digit ISBN pattern or folder_name
            isbn_pattern = re.compile(r"^\d{10,13}\.opf$", re.IGNORECASE)
            if not isbn_pattern.match(opf_filename) and not (folder_name and opf_filename.lower() == f"{folder_name.lower()}.opf"):
                issues.append({
                    "type": "opf_name_not_isbn",
                    "message": f"OPF file should be named '[ISBN].opf' (found '{opf_filename}').",
                    "category": "Warning",
                    "file_path": f"OEBPS/{opf_filename}",
                })
        else:
            if opf_filename.lower() != opf_name_config.lower():
                issues.append({
                    "type": "opf_name_mismatch",
                    "message": f"OPF file should be named '{opf_name_config}' (found '{opf_filename}').",
                    "category": "Error",
                    "file_path": f"OEBPS/{opf_filename}",
                })

    # 2. Check OEBPS/[toc_file]
    toc_ncx = os.path.join(oebps, toc_file_name)
    if not os.path.isfile(toc_ncx):
        issues.append({
            "type": "missing_ncx",
            "message": f"Required file 'OEBPS/{toc_file_name}' is missing.",
            "category": "Warning",
            "file_path": f"OEBPS/{toc_file_name}",
        })

    # 3. Check OEBPS/[nav_file]
    nav_xhtml = os.path.join(oebps, nav_file_name)
    if not os.path.isfile(nav_xhtml):
        issues.append({
            "type": "missing_nav",
            "message": f"Required file 'OEBPS/{nav_file_name}' is missing.",
            "category": "Error",
            "file_path": f"OEBPS/{nav_file_name}",
        })

    # 4. Check CSS folder & file
    css_dir = os.path.join(oebps, css_folder_name)
    if not os.path.isdir(css_dir):
        issues.append({
            "type": "missing_css_folder",
            "message": f"Required folder 'OEBPS/{css_folder_name}/' is missing.",
            "category": "Error",
            "file_path": f"OEBPS/{css_folder_name}",
        })
    else:
        epub_css = os.path.join(css_dir, css_file_name)
        if not os.path.isfile(epub_css):
            issues.append({
                "type": "missing_epub_css",
                "message": f"Required stylesheet 'OEBPS/{css_folder_name}/{css_file_name}' is missing.",
                "category": "Error",
                "file_path": f"OEBPS/{css_folder_name}/{css_file_name}",
            })

    # 5. Check XHTML folder
    xhtml_dir = os.path.join(oebps, xhtml_folder_name)
    if not os.path.isdir(xhtml_dir):
        issues.append({
            "type": "missing_xhtml_folder",
            "message": f"Required folder 'OEBPS/{xhtml_folder_name}/' is missing.",
            "category": "Error",
            "file_path": f"OEBPS/{xhtml_folder_name}",
        })

    # 6. Check Images folder
    images_dir = os.path.join(oebps, images_folder_name)
    if not os.path.isdir(images_dir):
        issues.append({
            "type": "missing_images_folder",
            "message": f"Required folder 'OEBPS/{images_folder_name}/' is missing.",
            "category": "Warning",
            "file_path": f"OEBPS/{images_folder_name}",
        })

    # 7. Check Fonts folder (optional)
    if fonts_folder_name:
        fonts_dir = os.path.join(oebps, fonts_folder_name)
        if not os.path.isdir(fonts_dir):
            issues.append({
                "type": "missing_fonts_folder",
                "message": f"Required folder 'OEBPS/{fonts_folder_name}/' is missing.",
                "category": "Warning",
                "file_path": f"OEBPS/{fonts_folder_name}",
            })

    return {"issues_count": len(issues), "issues": issues}


_LOWERCASE_EPUB_EXT = re.compile(r"\.epub$")


@rule("STRUCT004")
def validate_epub_extension_case(book_details):
    """The uploaded .epub file must use a lowercase '.epub' extension.

    The extract path uses the ZIP stem, so we inspect the actual file next to
    the extract folder rather than relying on the folder name alone.
    """
    epub = book_details["epub_path"]
    folder_name = book_details["folder_name"]

    extract_root = os.path.dirname(epub)
    expected = f"{folder_name}.epub"
    actual = None
    if os.path.isdir(extract_root):
        for entry in os.listdir(extract_root):
            if entry.lower() == expected.lower() and entry.lower().endswith(".epub"):
                actual = entry
                break

    if actual is None:
        # Nothing to check — the epub extract folder is the source of truth here.
        return {"issues_count": 0, "issues": []}

    if not actual.endswith(".epub"):
        return {"issues_count": 1, "issues": [{
            "type": "epub_extension_not_lowercase",
            "message": f"EPUB file extension must be lowercase '.epub' (found '{actual}').",
            "category": "Error",
            "file_path": actual,
        }]}

    return {"issues_count": 0, "issues": []}


@rule("STRUCT005")
def validate_sequential_xhtml_names(book_details, rule_config=None):
    """Ensure all XHTML files are numbered sequentially starting at 01_"""
    epub = book_details["epub_path"]
    inner_config = rule_config.get("rule_config", {}) if rule_config else {}
    xhtml_folder_name = inner_config.get("xhtml_folder", "Text")
    
    xhtml_dir = os.path.join(epub, "OEBPS", xhtml_folder_name)
    if not os.path.isdir(xhtml_dir):
        return {"issues_count": 0, "issues": []}
        
    issues = []
    
    # Get all .xhtml files in the folder
    xhtml_files = [f for f in os.listdir(xhtml_dir) if f.lower().endswith(".xhtml")]
    
    # Sort them alphabetically
    xhtml_files.sort()
    
    expected_num = inner_config.get("start_number", 1)
    for file_name in xhtml_files:
        expected_prefix = f"{expected_num:02d}_"
        if not file_name.startswith(expected_prefix):
            issues.append({
                "type": "non_sequential_xhtml",
                "message": f"XHTML file '{file_name}' does not match expected sequential prefix '{expected_prefix}'.",
                "category": "Error",
                "file_path": f"OEBPS/{xhtml_folder_name}/{file_name}",
            })
        expected_num += 1

    return {"issues_count": len(issues), "issues": issues}

@rule("STRUCT006")
def validate_no_cover_xhtml(book_details, rule_config=None):
    """Ensure cover.xhtml is removed from EPUB."""
    epub = book_details["epub_path"]
    issues = []
    
    for root, _dirs, files in os.walk(epub):
        for f in files:
            if f.lower() == "cover.xhtml":
                rel_path = os.path.relpath(os.path.join(root, f), epub)
                issues.append({
                    "rule_name": "Cover XHTML Check",
                    "type": "cover_xhtml_present",
                    "message": f"File 'cover.xhtml' found at '{rel_path}', but it should be removed.",
                    "category": "Error",
                    "file_path": rel_path,
                })
                
    return {"issues_count": len(issues), "issues": issues}
