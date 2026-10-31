import glob
import os

from bs4 import BeautifulSoup
from PIL import Image

from ..engine.registry import rule


def _find_cover(epub_folder: str) -> str | None:
    for candidate in glob.glob(os.path.join(epub_folder, "**", "cover.*"), recursive=True):
        bname = os.path.basename(candidate).lower()
        if bname.startswith("cover.") and os.path.isfile(candidate):
            return candidate
    return None


@rule("ASP-COV-001")
def validate_cover_filename(target, rule_config=None):
    """Cover image must be named cover.jpg."""
    if isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
    elif isinstance(target, dict) and target.get("file_path"):
        cover_path = target["file_path"]
        epub = target.get("epub_root") or os.path.dirname(cover_path)
    else:
        epub = str(target) if target else ""

    if not epub or not os.path.exists(epub):
        return {"issues_count": 0, "issues": []}

    issues = []
    images_dirs = glob.glob(os.path.join(epub, "**", "images"), recursive=True)
    found_cover = False
    for d in images_dirs:
        for f in os.listdir(d):
            low = f.lower()
            if low == "cover.jpg":
                found_cover = True
                if f != "cover.jpg":
                    issues.append({
                        "type": "cover_filename_case",
                        "message": f"Cover image should be named exactly 'cover.jpg' (found '{f}')",
                        "category": "Warning",
                        "file_path": os.path.relpath(os.path.join(d, f), epub),
                    })
            elif low.startswith("cover."):
                issues.append({
                    "type": "cover_wrong_format",
                    "message": f"Cover file '{f}' should be named 'cover.jpg'",
                    "category": "Error",
                    "file_path": os.path.relpath(os.path.join(d, f), epub),
                })
    if not found_cover and images_dirs:
        issues.append({
            "type": "cover_missing",
            "message": "No 'cover.jpg' found under an images/ directory",
            "category": "Error",
        })
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-COV-002")
def validate_cover_height(target, rule_config=None):
    """Cover height must equal expected_height configured in rule_config."""
    expected_height = None
    if rule_config and "rule_config" in rule_config:
        expected_height = rule_config["rule_config"].get("expected_height")

    if expected_height is None:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'expected_height'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or (os.path.dirname(cover) if cover else "")
    elif isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
        cover = _find_cover(epub)
    else:
        cover = str(target) if target else None
        epub = ""

    if not cover or not os.path.exists(cover):
        return {"issues_count": 0, "issues": []}
    try:
        with Image.open(cover) as img:
            _, height = img.size
    except Exception as e:  # noqa: BLE001
        return {"issues_count": 1, "issues": [{
            "type": "cover_read_failed",
            "message": f"Could not open cover image: {e}",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    if height != expected_height:
        return {"issues_count": 1, "issues": [{
            "type": "cover_wrong_height",
            "message": f"Cover height is {height}px; expected {expected_height}px",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-COV-003")
@rule("BOD-COV-003")
def validate_cover_dpi(target, rule_config=None):
    """Cover must be 300 DPI."""
    expected_dpi = None
    if rule_config and "rule_config" in rule_config:
        expected_dpi = rule_config["rule_config"].get("expected_dpi")
    
    if expected_dpi is None:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'expected_dpi'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or (os.path.dirname(cover) if cover else "")
    elif isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
        cover = _find_cover(epub)
    else:
        cover = str(target) if target else None
        epub = ""

    if not cover or not os.path.exists(cover):
        return {"issues_count": 0, "issues": []}
    try:
        with Image.open(cover) as img:
            dpi = img.info.get("dpi")
    except Exception as e:  # noqa: BLE001
        return {"issues_count": 1, "issues": [{
            "type": "cover_read_failed",
            "message": f"Could not open cover image: {e}",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    if dpi is None:
        return {"issues_count": 1, "issues": [{
            "type": "cover_dpi_unknown",
            "message": f"Cover image has no DPI metadata; cannot confirm exact {expected_dpi} DPI",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    x_dpi, y_dpi = dpi[0], dpi[1]
    if round(x_dpi) != expected_dpi or round(y_dpi) != expected_dpi:
        return {"issues_count": 1, "issues": [{
            "type": "cover_invalid_dpi",
            "message": f"Cover DPI is {x_dpi}x{y_dpi}; required exact resolution is {expected_dpi} DPI",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("BOD-COV-001")
def validate_cover_is_jpg(target, rule_config=None):
    """The cover image must have an allowed extension and valid image format configured in rule_config."""
    # Extract allowed_extensions from rule_config
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    raw_exts = cfg.get("allowed_extensions") or cfg.get("expected_format")

    if not raw_exts:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'allowed_extensions'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(raw_exts, str):
        allowed_exts = [e.strip().lstrip(".").lower() for e in raw_exts.split(",") if e.strip()]
    else:
        allowed_exts = [str(e).strip().lstrip(".").lower() for e in raw_exts if str(e).strip()]

    if not allowed_exts:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration has empty 'allowed_extensions'. Please configure valid extensions in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    # If invoked with file-scope (file_details)
    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover_path = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or os.path.dirname(cover_path)
        if not cover_path or not os.path.exists(cover_path):
            return {"issues_count": 0, "issues": []}

        ext = os.path.splitext(cover_path)[1].lstrip(".").lower()
        rel_path = os.path.relpath(cover_path, epub) if epub else cover_path
        filename = os.path.basename(cover_path)
        display_allowed = ", ".join(f".{e}" for e in allowed_exts)

        if ext not in allowed_exts:
            return {"issues_count": 1, "issues": [{
                "type": "cover_wrong_format",
                "message": f"Cover image '{filename}' has extension '.{ext}'; allowed extension(s): {display_allowed}.",
                "category": "Error",
                "file_path": rel_path,
            }]}
        return {"issues_count": 0, "issues": []}

    # Otherwise invoked with book-scope
    epub = target.get("epub_path", "") if isinstance(target, dict) else str(target or "")
    if not epub or not os.path.exists(epub):
        return {"issues_count": 0, "issues": []}

    issues = []
    images_dirs = glob.glob(os.path.join(epub, "**", "images"), recursive=True)
    found_cover = False
    display_allowed = ", ".join(f".{e}" for e in allowed_exts)

    for d in images_dirs:
        for f in os.listdir(d):
            low = f.lower()
            if low.startswith("cover."):
                found_cover = True
                full_img_path = os.path.join(d, f)
                rel_path = os.path.relpath(full_img_path, epub)
                ext = os.path.splitext(f)[1].lstrip(".").lower()

                if ext not in allowed_exts:
                    issues.append({
                        "type": "cover_wrong_format",
                        "message": f"Cover image '{f}' has extension '.{ext}'; allowed extension(s): {display_allowed}.",
                        "category": "Error",
                        "file_path": rel_path,
                    })

    if not found_cover and images_dirs:
        issues.append({
            "type": "cover_missing",
            "message": f"No cover image found under images/ directory (expected {display_allowed}).",
            "category": "Error",
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-004")
def validate_cover_dimensions(target, rule_config=None):
    """Cover image must meet minimum dimension requirements (e.g., shortest axis / width >= min_dimension)."""
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    min_shortest_axis = cfg.get("min_shortest_axis") or cfg.get("min_width")

    if min_shortest_axis is None:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'min_shortest_axis' or 'min_width'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or (os.path.dirname(cover) if cover else "")
    elif isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
        cover = _find_cover(epub)
    else:
        cover = str(target) if target else None
        epub = ""

    if not cover or not os.path.exists(cover):
        return {"issues_count": 0, "issues": []}

    rel_path = os.path.relpath(cover, epub) if epub else cover
    issues = []
    try:
        with Image.open(cover) as img:
            w, h = img.size
            shortest = min(w, h)
            if shortest < min_shortest_axis:
                issues.append({
                    "type": "cover_dimension_too_small",
                    "message": (
                        f"Cover image dimensions are {w}x{h} px. The shortest axis is {shortest} px, "
                        f"which is less than the required minimum of {min_shortest_axis} px."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                })
    except Exception as e:
        issues.append({
            "type": "cover_read_failed",
            "message": f"Could not read cover image dimensions: {e}",
            "category": "Warning",
            "file_path": rel_path,
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-006")
def validate_cover_file_size(target, rule_config=None):
    """Cover image must not exceed max file size in MB (e.g. 5 MB)."""
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    max_file_size_mb = cfg.get("max_file_size_mb")

    if max_file_size_mb is None:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'max_file_size_mb'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or (os.path.dirname(cover) if cover else "")
    elif isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
        cover = _find_cover(epub)
    else:
        cover = str(target) if target else None
        epub = ""

    if not cover or not os.path.exists(cover):
        return {"issues_count": 0, "issues": []}

    rel_path = os.path.relpath(cover, epub) if epub else cover
    issues = []

    try:
        size_bytes = os.path.getsize(cover)
        max_bytes = max_file_size_mb * 1024 * 1024
        if size_bytes > max_bytes:
            actual_mb = size_bytes / (1024 * 1024)
            issues.append({
                "type": "cover_file_size_exceeded",
                "message": f"Cover image size is {actual_mb:.2f} MB, which exceeds the maximum allowed limit of {max_file_size_mb} MB.",
                "category": "Error",
                "file_path": rel_path,
            })
    except Exception as e:
        issues.append({
            "type": "cover_stat_failed",
            "message": f"Could not determine cover file size: {e}",
            "category": "Warning",
            "file_path": rel_path,
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-005")
def validate_cover_total_pixels(target, rule_config=None):
    """Cover image must not exceed max total pixels (e.g. 3,200,000 px)."""
    cfg = (rule_config.get("rule_config") if rule_config and isinstance(rule_config, dict) and "rule_config" in rule_config else rule_config) or {}
    max_total_pixels = cfg.get("max_total_pixels")

    if max_total_pixels is None:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'max_total_pixels'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": str(target) if target else "",
        }]}

    if isinstance(target, dict) and (target.get("full_path") or target.get("file_path")):
        cover = target.get("full_path") or target.get("file_path")
        epub = target.get("epub_root") or target.get("epub_path") or (os.path.dirname(cover) if cover else "")
    elif isinstance(target, dict) and target.get("epub_path"):
        epub = target["epub_path"]
        cover = _find_cover(epub)
    else:
        cover = str(target) if target else None
        epub = ""

    if not cover or not os.path.exists(cover):
        return {"issues_count": 0, "issues": []}

    rel_path = os.path.relpath(cover, epub) if epub else cover
    issues = []

    try:
        with Image.open(cover) as img:
            w, h = img.size
            total_pixels = w * h
            if total_pixels > max_total_pixels:
                issues.append({
                    "type": "cover_pixel_budget_exceeded",
                    "message": (
                        f"Cover image is {w}x{h} ({total_pixels:,} pixels), "
                        f"which exceeds the maximum allowed budget of {max_total_pixels:,} pixels (3.2 Mio)."
                    ),
                    "category": "Error",
                    "file_path": rel_path,
                })
    except Exception as e:
        issues.append({
            "type": "cover_read_failed",
            "message": f"Could not read cover image pixels: {e}",
            "category": "Warning",
            "file_path": rel_path,
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-007")
def validate_cover_alt_tag(file_details, rule_config=None):
    """Cover image in cover XHTML (specifically <img id='coverimage'>) must have a non-empty alt attribute."""
    full_path = file_details.get("full_path") or file_details.get("file_path")
    if not full_path or not os.path.exists(full_path):
        return {"issues_count": 0, "issues": []}

    rel_path = file_details.get("relative_path") or os.path.basename(full_path)
    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"issues_count": 1, "issues": [{
            "type": "read_error",
            "message": f"Could not read XHTML file: {e}",
            "category": "Error",
            "file_path": rel_path,
        }]}

    soup = BeautifulSoup(content, "html.parser")
    lines = content.splitlines()

    # Find the cover image: look for id="coverimage", id="cover-page", src containing "cover", or simply any <img> in this cover file
    img = (
        soup.find("img", id=lambda i: i and "cover" in i.lower())
        or soup.find("img", src=lambda s: s and "cover" in s.lower())
        or soup.find("img")
    )
    if not img:
        return {"issues_count": 1, "issues": [{
            "type": "cover_image_not_found",
            "message": f"No cover <img> found in '{os.path.basename(full_path)}'.",
            "category": "Error",
            "file_path": rel_path,
        }]}

    alt = img.get("alt")
    src = img.get("src", "")
    line_num = getattr(img, "sourceline", None)

    if not line_num:
        for idx, line in enumerate(lines, 1):
            if src and src in line:
                line_num = idx
                break

    # 1. Missing alt attribute
    if alt is None:
        issues.append({
            "type": "cover_missing_alt",
            "message": f"Cover image (<img src='{src}'>) is missing the 'alt' attribute.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_num,
            "href": src,
        })
    # 2. Empty alt attribute (alt="")
    elif not alt.strip():
        issues.append({
            "type": "cover_empty_alt",
            "message": f"Cover image (<img src='{src}'>) has an empty alt attribute (alt=\"\").",
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_num,
            "href": src,
        })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-008")
def validate_opf_cover_metadata(file_details, rule_config=None):
    """The cover file must be declared correctly in OPF metadata: <meta name='cover' content='cover-image' /> or item id."""
    full_path = file_details.get("full_path") or file_details.get("file_path")
    if not full_path or not os.path.exists(full_path):
        return {"issues_count": 0, "issues": []}

    rel_path = file_details.get("relative_path") or os.path.basename(full_path)
    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"issues_count": 1, "issues": [{
            "type": "read_error",
            "message": f"Could not read OPF file: {e}",
            "category": "Error",
            "file_path": rel_path,
        }]}

    soup = BeautifulSoup(content, "html.parser")
    lines = content.splitlines()

    metadata = soup.find("metadata")
    if not metadata:
        return {"issues_count": 1, "issues": [{
            "type": "missing_metadata",
            "message": "No <metadata> section found in OPF file.",
            "category": "Error",
            "file_path": rel_path,
        }]}

    # Look for <meta name="cover" content="...">
    cover_meta = metadata.find("meta", attrs={"name": lambda n: n and n.lower() == "cover"})
    if not cover_meta:
        # Check line number of <metadata> tag for accurate error reporting
        line_num = getattr(metadata, "sourceline", None)
        if not line_num:
            for idx, line in enumerate(lines, 1):
                if "<metadata" in line:
                    line_num = idx
                    break

        return {"issues_count": 1, "issues": [{
            "type": "cover_metadata_missing",
            "message": "Missing required cover declaration in OPF metadata: <meta name=\"cover\" content=\"cover-image\" />.",
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_num,
        }]}

    content_val = (cover_meta.get("content") or "").strip()
    line_num = getattr(cover_meta, "sourceline", None)
    if not line_num:
        for idx, line in enumerate(lines, 1):
            if 'name="cover"' in line or "name='cover'" in line:
                line_num = idx
                break

    if not content_val:
        return {"issues_count": 1, "issues": [{
            "type": "cover_metadata_empty",
            "message": "The <meta name=\"cover\" /> tag has an empty content attribute. Expected content=\"cover-image\".",
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_num,
        }]}

    # Verify that the referenced content id exists in the manifest
    manifest = soup.find("manifest")
    if manifest:
        matching_item = manifest.find("item", id=content_val)
        if not matching_item:
            issues.append({
                "type": "cover_manifest_item_missing",
                "message": (
                    f"Cover metadata <meta name=\"cover\" content=\"{content_val}\" /> references id '{content_val}', "
                    f"but no corresponding <item id=\"{content_val}\" .../> was found in <manifest>."
                ),
                "category": "Error",
                "file_path": rel_path,
                "line_number": line_num,
            })

    return {"issues_count": len(issues), "issues": issues}


@rule("BOD-COV-002")
def validate_cover_first_in_spine(file_details, rule_config=None):
    """The cover file must be included as the first file in the ePub reading order (<spine>)."""
    full_path = file_details.get("full_path") or file_details.get("file_path")
    if not full_path or not os.path.exists(full_path):
        return {"issues_count": 0, "issues": []}

    rel_path = file_details.get("relative_path") or os.path.basename(full_path)
    issues = []

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"issues_count": 1, "issues": [{
            "type": "read_error",
            "message": f"Could not read OPF file: {e}",
            "category": "Error",
            "file_path": rel_path,
        }]}

    soup = BeautifulSoup(content, "html.parser")
    lines = content.splitlines()

    spine = soup.find("spine")
    if not spine:
        return {"issues_count": 1, "issues": [{
            "type": "missing_spine",
            "message": "No <spine> element found in OPF file.",
            "category": "Error",
            "file_path": rel_path,
        }]}

    itemrefs = spine.find_all("itemref")
    if not itemrefs:
        return {"issues_count": 1, "issues": [{
            "type": "empty_spine",
            "message": "<spine> contains no <itemref> elements.",
            "category": "Error",
            "file_path": rel_path,
        }]}

    first_itemref = itemrefs[0]
    first_idref = (first_itemref.get("idref") or "").strip()
    line_num = getattr(first_itemref, "sourceline", None)
    if not line_num:
        for idx, line in enumerate(lines, 1):
            if f'idref="{first_idref}"' in line or f"idref='{first_idref}'" in line:
                line_num = idx
                break

    # Find the corresponding item in the manifest to check its href / properties
    manifest = soup.find("manifest")
    first_item = manifest.find("item", id=first_idref) if manifest else None
    first_href = (first_item.get("href") or "").lower() if first_item else ""
    first_props = (first_item.get("properties") or "").lower() if first_item else ""

    # Check if first item is the cover (by idref, href, or properties)
    is_cover = (
        "cover" in first_idref.lower()
        or "cover" in first_href
        or "cover" in first_props
    )

    if not is_cover:
        issues.append({
            "type": "cover_not_first_in_spine",
            "message": (
                f"The cover file must be the first item in the EPUB spine reading order. "
                f"Found '{first_idref}' ({first_href or 'unknown file'}) as the first item."
            ),
            "category": "Error",
            "file_path": rel_path,
            "line_number": line_num,
        })

    return {"issues_count": len(issues), "issues": issues}






