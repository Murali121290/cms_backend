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


@rule("BOD-FN-001")
def validate_no_unicode_in_filenames(book_details, rule_config=None):
    """
    Ensure all files and directory names in the EPUB do not use non-ASCII / Unicode characters.
    """
    epub = book_details.get("epub_path") or ""
    issues = []

    if not epub or not os.path.isdir(epub):
        return {"issues_count": 0, "issues": []}

    for root, dirs, files in os.walk(epub):
        # Exclude hidden directories/files e.g. .DS_Store, __MACOSX
        dirs[:] = [d for d in dirs if not d.startswith(".") and not d.startswith("__")]

        for name in files:
            if name.startswith(".") or name.startswith("__"):
                continue

            # Check if filename contains non-ASCII characters
            if not name.isascii():
                full_item_path = os.path.join(root, name)
                rel_path = os.path.relpath(full_item_path, epub)
                non_ascii_chars = sorted(list(set(c for c in name if ord(c) > 127)))
                chars_display = ", ".join(f"'{c}' (U+{ord(c):04X})" for c in non_ascii_chars)
                issues.append({
                    "rule_name": "Do not use unicode in file names",
                    "type": "unicode_in_filename",
                    "message": f"Filename '{name}' contains non-ASCII/Unicode character(s): {chars_display}. Use only ASCII characters (a-z, A-Z, 0-9, _, -).",
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": 1,
                    "snippet": f"Filename: {name}",
                    "extract": f"Filename: {name}",
                })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-FN-002")
def validate_xhtml_naming_convention(book_details, rule_config=None):
    """
    HTML / XHTML files must be named according to BoD naming rules:
    1. Front matter files must start with a single uppercase letter prefix: [A-Z]_<name>.xhtml
       (e.g., A_cover.xhtml, B_toc.xhtml, C_dedication.xhtml)
    2. Chapter files must start with consecutive 2-digit numbers: 01_<title>.xhtml, 02_<title>.xhtml, etc.
       (e.g., 01_XX.xhtml, 15_Wo_die_D_monen_sind.xhtml, or 01_chapter01.xhtml if no chapter name)
    3. The title portion of the filename is derived from the <title> tag inside the XHTML file,
       where whitespace, special characters, and non-ASCII characters (e.g., umlauts ä, ö, ü)
       are replaced with an underscore ('_').
    All standard front matter titles across languages are read dynamically from rule_config.
    """
    epub = book_details.get("epub_path") or ""
    issues = []

    if not epub or not os.path.isdir(epub):
        return {"issues_count": 0, "issues": []}

    # Helper to convert title string into underscore-separated ASCII slug (1-to-1 character replacement)
    def title_to_slug(title_str: str) -> str:
        chars = []
        for c in title_str:
            if (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9'):
                chars.append(c)
            else:
                chars.append('_')
        # Do not collapse consecutive underscores: e.g. 'ß ' -> '__'
        slug = ''.join(chars).strip('_')
        return slug

    # Read front matter titles dynamically from rule_config
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    frontmatter_dict = cfg.get("frontmatter_titles_by_language")

    if not frontmatter_dict or not isinstance(frontmatter_dict, dict):
        return {
            "issues_count": 1,
            "issues": [{
                "rule_name": "HTML files naming convention check",
                "type": "configuration_error",
                "message": "Missing required 'frontmatter_titles_by_language' in rule configuration for BOD-FN-002.",
                "category": "Error",
                "file_path": "OEBPS",
                "line_number": 0,
            }]
        }

    configured_fm_slugs = set()
    for _lang, titles in frontmatter_dict.items():
        if isinstance(titles, list):
            for t in titles:
                s = title_to_slug(t).lower()
                if s:
                    configured_fm_slugs.add(s)
        elif isinstance(titles, dict):
            for _k, t in titles.items():
                s = title_to_slug(t).lower()
                if s:
                    configured_fm_slugs.add(s)

    def is_frontmatter_slug(slug: str) -> bool:
        s = slug.lower().strip("_")
        for std in configured_fm_slugs:
            if s == std or s.startswith(std + "_") or std.startswith(s + "_"):
                return True
        return False

    # Find OPF reading order (spine) if available
    spine_files = []
    opf_path = _find_opf(epub)
    if opf_path and os.path.isfile(opf_path):
        try:
            with open(opf_path, "r", encoding="utf-8") as f:
                opf_soup = BeautifulSoup(f.read(), "xml")
            manifest = opf_soup.find("manifest")
            spine = opf_soup.find("spine")
            if manifest and spine:
                items = {}
                for it in manifest.find_all("item"):
                    iid = it.get("id", "").strip()
                    href = it.get("href", "").strip()
                    if iid and href:
                        items[iid] = href
                for ref in spine.find_all("itemref"):
                    idref = ref.get("idref", "").strip()
                    if idref in items:
                        target = items[idref].split("#")[0].strip()
                        if target.lower().endswith((".xhtml", ".html")):
                            spine_files.append(os.path.basename(target))
        except Exception:
            pass

    # Locate XHTML files inside OEBPS/xhtml or throughout epub
    xhtml_dir = os.path.join(epub, "OEBPS", "xhtml")
    if not os.path.isdir(xhtml_dir):
        xhtml_dir = os.path.join(epub, "OEBPS")
        if not os.path.isdir(xhtml_dir):
            xhtml_dir = epub

    xhtml_map = {}
    for root, _dirs, files in os.walk(xhtml_dir):
        for f in files:
            if f.lower().endswith((".xhtml", ".html")):
                full_fpath = os.path.join(root, f)
                rel_fpath = os.path.relpath(full_fpath, epub).replace("\\", "/")
                xhtml_map[f] = (full_fpath, rel_fpath)

    # Order files according to spine if available, otherwise sort naturally
    if spine_files:
        ordered_filenames = [fn for fn in spine_files if fn in xhtml_map]
        for fn in sorted(xhtml_map.keys()):
            if fn not in ordered_filenames:
                ordered_filenames.append(fn)
    else:
        ordered_filenames = sorted(xhtml_map.keys())

    expected_chapter_num = 1
    for filename in ordered_filenames:
        # Ignore nav.xhtml as it is a structural navigation document
        if filename.lower() in ("nav.xhtml", "nav.html", "toc.xhtml"):
            continue

        full_item_path, rel_path = xhtml_map[filename]
        stem, _ = os.path.splitext(filename)

        # Read <title> from XHTML file
        doc_title = ""
        try:
            with open(full_item_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            soup = BeautifulSoup(content, "html.parser")
            title_tag = soup.find("title")
            if title_tag:
                doc_title = title_tag.get_text(strip=True)
        except Exception:
            pass

        expected_slug = title_to_slug(doc_title) if doc_title else ""

        # Check if Front Matter pattern: ^[A-Z]_(.+)$
        fm_match = re.match(r"^([A-Z])_(.+)$", stem)
        # Check if Chapter pattern: ^(\d{2})_(.+)$
        ch_match = re.match(r"^(\d{2})_(.+)$", stem)

        if fm_match:
            # Front matter: [A-Z]_<name>
            prefix_letter = fm_match.group(1)
            name_part = fm_match.group(2)
            name_part_lower = name_part.lower()

            # Generic front matter files (e.g. fm, frontmatter) only need to start with an uppercase letter
            if name_part_lower in ("fm", "frontmatter", "front_matter", "front"):
                continue

            # Verify that this file is legitimately a front matter / impressum file
            is_fm = (
                is_frontmatter_slug(name_part_lower)
                or (expected_slug and is_frontmatter_slug(expected_slug))
            )

            # If it is NOT a front matter / impressum title, it is a chapter and must start with a 2-digit consecutive number!
            if not is_fm:
                issues.append({
                    "rule_name": "HTML file naming convention",
                    "type": "chapter_alphabetic_prefix",
                    "message": (
                        f"HTML file '{filename}' does not follow the required naming convention. "
                        f"Only front matter and impressum files can start with an uppercase letter prefix (e.g. 'A_cover.xhtml', 'B_impressum.xhtml'). "
                        f"Chapters must start with a 2-digit consecutive number (expected prefix: '{expected_chapter_num:02d}_')."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": 1,
                    "snippet": f"Filename: {filename}, <title>: {doc_title}",
                    "extract": f"Filename: {filename}, <title>: {doc_title}",
                })
                continue

            # Verify against doc_title or known front matter titles
            if expected_slug:
                match_exact = (name_part_lower == expected_slug.lower())
                match_prefix = expected_slug.lower().startswith(name_part_lower) or name_part_lower.startswith(expected_slug.lower())
                match_known = is_frontmatter_slug(name_part_lower) or is_frontmatter_slug(expected_slug)

                if not (match_exact or match_prefix or match_known):
                    issues.append({
                        "rule_name": "HTML file naming convention",
                        "type": "frontmatter_title_mismatch",
                        "message": (
                            f"Front matter file '{filename}' name part '{name_part}' does not match "
                            f"the document <title> '{doc_title}' (expected slug: '{expected_slug}')."
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": 1,
                        "snippet": f"Filename: {filename}, <title>: {doc_title}",
                        "extract": f"Filename: {filename}, <title>: {doc_title}",
                    })
        elif ch_match:
            # Chapter file: \d{2}_<title>
            num_str = ch_match.group(1)
            name_part = ch_match.group(2)
            num_val = int(num_str)

            # Check if this file is actually a front matter / end matter section (e.g. impressum, copyright, cover, toc)
            # that was incorrectly given a numeric prefix (like 00_impressum.xhtml) instead of an alphabetic prefix [A-Z]_
            is_fm = is_frontmatter_slug(name_part) or (expected_slug and is_frontmatter_slug(expected_slug))
            if is_fm:
                issues.append({
                    "rule_name": "HTML file naming convention",
                    "type": "frontmatter_numeric_prefix",
                    "message": (
                        f"HTML file '{filename}' does not follow the required naming convention. "
                        f"Front matter and impressum files must start with an uppercase letter prefix (e.g. 'A_cover.xhtml', 'B_{name_part}.xhtml'), "
                        f"while chapters must start with a 2-digit consecutive number (e.g. '01_<title>.xhtml')."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": 1,
                    "snippet": f"Filename: {filename}",
                    "extract": f"Filename: {filename}",
                })
                continue

            # 1. Consecutive numbering check
            expected_prefix = f"{expected_chapter_num:02d}_"
            if num_val != expected_chapter_num:
                issues.append({
                    "rule_name": "HTML file naming convention",
                    "type": "non_consecutive_chapter_numbering",
                    "message": (
                        f"Chapter file '{filename}' has number '{num_str}', but expected consecutive number "
                        f"'{expected_chapter_num:02d}' (expected prefix: '{expected_prefix}')."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                    "line_number": 1,
                    "snippet": f"Filename: {filename}",
                    "extract": f"Filename: {filename}",
                })

            expected_chapter_num += 1

            # 2. Title matching check
            if expected_slug:
                # If title slug doesn't match name_part
                # Allow fallback pattern e.g. chapter01 or ch01
                fallback_ch_names = {f"chapter{num_str}", f"chap{num_str}", f"kapitel{num_str}", f"ch{num_str}", "xx"}
                if name_part.lower() != expected_slug.lower() and name_part.lower() not in fallback_ch_names:
                    issues.append({
                        "rule_name": "HTML file naming convention",
                        "type": "chapter_title_mismatch",
                        "message": (
                            f"Chapter file '{filename}' name part '{name_part}' does not match the document <title> "
                            f"'{doc_title}' (expected: '{num_str}_{expected_slug}.xhtml')."
                        ),
                        "category": "Error",
                        "file_path": rel_path,
                        "line_number": 1,
                        "snippet": f"Filename: {filename}, <title>: {doc_title}",
                        "extract": f"Filename: {filename}, <title>: {doc_title}",
                    })
        else:
            # Filename matches neither [A-Z]_ nor \d{2}_ pattern
            issues.append({
                "rule_name": "HTML file naming convention",
                "type": "invalid_html_filename_format",
                "message": (
                    f"HTML file '{filename}' does not follow the required naming convention. "
                    f"Front matter must start with an uppercase letter (e.g. 'A_cover.xhtml', 'B_toc.xhtml') "
                    f"and chapters must start with a 2-digit consecutive number (e.g. '{expected_chapter_num:02d}_{expected_slug or 'chapter' + f'{expected_chapter_num:02d}'}.xhtml')."
                ),
                "category": "Error",
                "file_path": rel_path,
                "line_number": 1,
                "snippet": f"Filename: {filename}",
                "extract": f"Filename: {filename}",
            })

    return {"issues_count": len(issues), "issues": issues}
