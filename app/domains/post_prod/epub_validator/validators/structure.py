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
def validate_oebps_contents(book_details):
    """OEBPS/ must contain the exact expected artefacts:
    - [ISBN].opf (e.g. 9798894107530.opf)
    - toc.ncx
    - nav.xhtml
    - css/ folder and css/epub.css file
    - xhtml/ folder
    - images/ folder
    """
    epub = book_details["epub_path"]
    folder_name = book_details.get("folder_name", "")
    issues = []

    oebps = os.path.join(epub, "OEBPS")
    if not os.path.isdir(oebps):
        # Already reported by STRUCT001, but guard here
        return {"issues_count": 0, "issues": []}

    # 1. Check OPF file & ISBN naming (e.g. OEBPS/9798894107530.opf or any 10-13 digit ISBN .opf)
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
        # Verify OPF filename matches 10/13-digit ISBN pattern or folder_name
        isbn_pattern = re.compile(r"^\d{10,13}\.opf$", re.IGNORECASE)
        if not isbn_pattern.match(opf_filename) and not (folder_name and opf_filename.lower() == f"{folder_name.lower()}.opf"):
            issues.append({
                "type": "opf_name_not_isbn",
                "message": f"OPF file should be named '[ISBN].opf' (found '{opf_filename}').",
                "category": "Warning",
                "file_path": f"OEBPS/{opf_filename}",
            })

    # 2. Check OEBPS/toc.ncx
    toc_ncx = os.path.join(oebps, "toc.ncx")
    if not os.path.isfile(toc_ncx):
        issues.append({
            "type": "missing_ncx",
            "message": "Required file 'OEBPS/toc.ncx' is missing.",
            "category": "Warning",
            "file_path": "OEBPS/toc.ncx",
        })

    # 3. Check OEBPS/nav.xhtml
    nav_xhtml = os.path.join(oebps, "nav.xhtml")
    if not os.path.isfile(nav_xhtml):
        issues.append({
            "type": "missing_nav",
            "message": "Required file 'OEBPS/nav.xhtml' is missing.",
            "category": "Error",
            "file_path": "OEBPS/nav.xhtml",
        })

    # 4. Check OEBPS/css folder & OEBPS/css/epub.css
    css_dir = os.path.join(oebps, "css")
    if not os.path.isdir(css_dir):
        issues.append({
            "type": "missing_css_folder",
            "message": "Required folder 'OEBPS/css/' is missing.",
            "category": "Error",
            "file_path": "OEBPS/css",
        })
    else:
        epub_css = os.path.join(css_dir, "epub.css")
        if not os.path.isfile(epub_css):
            issues.append({
                "type": "missing_epub_css",
                "message": "Required stylesheet 'OEBPS/css/epub.css' is missing.",
                "category": "Error",
                "file_path": "OEBPS/css/epub.css",
            })

    # 5. Check OEBPS/xhtml folder
    xhtml_dir = os.path.join(oebps, "xhtml")
    if not os.path.isdir(xhtml_dir):
        issues.append({
            "type": "missing_xhtml_folder",
            "message": "Required folder 'OEBPS/xhtml/' is missing.",
            "category": "Error",
            "file_path": "OEBPS/xhtml",
        })

    # 6. Check OEBPS/images folder
    images_dir = os.path.join(oebps, "images")
    if not os.path.isdir(images_dir):
        issues.append({
            "type": "missing_images_folder",
            "message": "Required folder 'OEBPS/images/' is missing.",
            "category": "Warning",
            "file_path": "OEBPS/images",
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
