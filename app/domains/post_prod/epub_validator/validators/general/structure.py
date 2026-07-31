import os
import re

from bs4 import BeautifulSoup

from ...engine.registry import rule


@rule("STRUCT001")
def validate_epub_layout(book_details):
    """Root of extracted EPUB must contain META-INF/, OEBPS/ (or an equivalent
    content folder), and a mimetype file with value 'application/epub+zip'.
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

    # OEBPS is the conventional content folder, but the spec only requires that
    # container.xml points at some content folder — accept anything with an OPF.
    oebps = os.path.join(epub, "OEBPS")
    if not os.path.isdir(oebps):
        has_opf_anywhere = any(
            f.lower().endswith(".opf")
            for _root, _dirs, files in os.walk(epub) for f in files
        )
        if not has_opf_anywhere:
            issues.append({
                "type": "missing_oebps",
                "message": "Required folder 'OEBPS/' (or an equivalent content folder with an .opf file) is missing.",
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
    """OEBPS/ (or content folder) must contain the expected artefacts:
    an .opf file, toc.ncx, nav.xhtml, at least one CSS, an xhtml folder, and
    an images folder.
    """
    epub = book_details["epub_path"]
    issues = []

    opf_path = _find_opf(epub)
    if opf_path is None:
        issues.append({
            "type": "missing_opf",
            "message": "No .opf file found anywhere under the EPUB.",
            "category": "Error",
        })
        content_root = os.path.join(epub, "OEBPS")
    else:
        content_root = os.path.dirname(opf_path)

    def _exists_named(name: str) -> bool:
        for root, _dirs, files in os.walk(content_root):
            for f in files:
                if f.lower() == name.lower():
                    return True
        return False

    def _has_folder(name: str) -> bool:
        path = os.path.join(content_root, name)
        return os.path.isdir(path)

    def _has_any_ext(ext: str) -> bool:
        for root, _dirs, files in os.walk(content_root):
            for f in files:
                if f.lower().endswith(ext.lower()):
                    return True
        return False

    if not _exists_named("toc.ncx"):
        issues.append({
            "type": "missing_ncx",
            "message": "Content folder is missing 'toc.ncx'.",
            "category": "Warning",
        })

    if not _exists_named("nav.xhtml"):
        issues.append({
            "type": "missing_nav",
            "message": "Content folder is missing 'nav.xhtml'.",
            "category": "Error",
        })

    if not _has_any_ext(".css"):
        issues.append({
            "type": "missing_css",
            "message": "Content folder has no .css stylesheet.",
            "category": "Warning",
        })

    if not _has_folder("xhtml") and not _has_any_ext(".xhtml"):
        issues.append({
            "type": "missing_xhtml_folder",
            "message": "Content folder has no 'xhtml/' folder and no .xhtml files.",
            "category": "Error",
        })

    if not _has_folder("images"):
        # Some EPUBs use 'Images', 'IMG', etc. — warn, don't error.
        has_alt_image_dir = any(
            d.lower() in ("images", "image", "img", "media", "assets")
            for d in os.listdir(content_root) if os.path.isdir(os.path.join(content_root, d))
        )
        if not has_alt_image_dir:
            issues.append({
                "type": "missing_images_folder",
                "message": "Content folder has no 'images/' folder.",
                "category": "Warning",
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
