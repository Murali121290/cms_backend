import glob
import os
import re

from bs4 import BeautifulSoup
from PIL import Image

from ..engine.registry import rule
from ._common import find_opf

_MAX_PIXELS = 4_000_000
_ALLOWED_EXT = {".jpg", ".jpeg"}


def _iter_manifest_images(opf_path: str):
    with open(opf_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "xml")
    for item in soup.find_all("item"):
        media = (item.get("media-type") or "").lower()
        href = (item.get("href") or "").strip()
        if not href:
            continue
        if media.startswith("image/") or href.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp")):
            yield href, media


@rule("ASP-IMG-001")
def validate_images_are_jpeg(file_details, rule_config=None):
    """All image files in OEBPS/images must match allowed extensions."""
    file_path = file_details.get("file_path", "")
    full_path = file_details.get("full_path", "")

    ext = os.path.splitext(file_path)[1].lower()

    # Get allowed extensions from rule config (default to .jpg, .jpeg)
    inner_config = rule_config.get("rule_config", {}) if rule_config else {}
    allowed_extensions = []
    if "allowed_extensions" in inner_config:
        allowed_extensions = [e.lower() for e in inner_config["allowed_extensions"]]
    if not allowed_extensions:
        return {"issues_count": 1, "issues": [{
            "type": "rule_configuration_error",
            "message": "Rule configuration is missing 'allowed_extensions'. Please configure it in customer.json.",
            "category": "Error",
            "file_path": file_path,
        }]}

    # Skip non-image files
    image_extensions = {
        ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".tiff", ".bmp", 
        ".ico", ".heic", ".heif", ".avif", ".jxl", ".eps", ".raw"
    }
    if ext not in image_extensions:
        return {"issues_count": 0, "issues": []}

    # Check if the image file has an allowed extension
    if ext not in allowed_extensions:
        return {"issues_count": 1, "issues": [{
            "type": "image_not_allowed_extension",
            "message": f"Image '{file_path}' has extension {ext}; allowed: {', '.join(allowed_extensions)}",
            "category": "Error",
            "file_path": file_path,
            "extract": ext,
        }]}

    return {"issues_count": 0, "issues": []}


@rule("ASP-IMG-002")
def validate_no_empty_alt(file_details, rule_config=None):
    """<img> elements must not have empty alt attributes."""
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        content = f.read()

    soup = BeautifulSoup(content, "html.parser")
    lines = content.splitlines()
    issues = []

    for img in soup.find_all("img"):
        alt = img.get("alt")
        if alt is None or alt.strip() == "":
            role = img.get("role", "")
            if isinstance(role, list):
                role = " ".join(role)
            if role.lower() == "presentation":
                continue

            src = img.get("src", "")
            line_num = None
            if hasattr(img, 'sourceline') and img.sourceline:
                line_num = img.sourceline
            else:
                img_str = str(img)
                for idx, line in enumerate(lines, 1):
                    if "src=" in line and src in line:
                        line_num = idx
                        break

            import re
            extract_text = str(img)
            if line_num and line_num <= len(lines):
                raw_line = lines[line_num - 1]
                img_match = re.search(r'<img[^>]*>', raw_line, re.IGNORECASE)
                if img_match:
                    img_tag = img_match.group(0)
                    alt_match = re.search(r'alt\s*=\s*["\'][^"\']*["\']|alt\b', img_tag, re.IGNORECASE)
                    extract_text = alt_match.group(0) if alt_match else img_tag

            issue = {
                "type": "empty_alt_text",
                "message": f"<img src='{src}'> has empty or missing alt attribute",
                "category": "Error",
                "href": src,
                "extract": extract_text,
            }
            if line_num:
                issue["line_number"] = line_num
            issues.append(issue)
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-IMG-003")
def validate_image_dimensions(file_details, rule_config=None):
    """No image may exceed 4,000,000 pixels (width × height), except cover.jpg."""
    file_path = file_details.get("file_path", "")
    full_path = file_details.get("full_path", "")

    # Skip cover.jpg
    if os.path.basename(file_path).lower() == "cover.jpg":
        return {"issues_count": 0, "issues": []}

    if not full_path or not os.path.exists(full_path):
        return {"issues_count": 0, "issues": []}

    issues = []
    try:
        with Image.open(full_path) as img:
            w, h = img.size
            if w * h > _MAX_PIXELS:
                issues.append({
                    "type": "image_over_pixel_budget",
                    "message": (
                        f"Image is {w}x{h} = {w*h:,} pixels; max allowed is {_MAX_PIXELS:,}"
                    ),
                    "category": "Warning",
                    "file_path": file_path,
                })
    except Exception:
        pass

    return {"issues_count": len(issues), "issues": issues}


_EXPECTED_BODY_DPI = 300


@rule("ASP-IMG-005")
def validate_body_image_dpi(file_details, rule_config=None):
    """Every body image (not just the cover) must be at least 300 DPI."""
    file_path = file_details.get("file_path", "")
    full_path = file_details.get("full_path", "")

    # Skip cover image - ASP-COV-003 handles cover DPI check
    if os.path.basename(file_path).lower() == "cover.jpg":
        return {"issues_count": 0, "issues": []}

    if not full_path or not os.path.exists(full_path):
        return {"issues_count": 0, "issues": []}

    issues = []
    try:
        with Image.open(full_path) as img:
            dpi = img.info.get("dpi")
    except Exception:
        return {"issues_count": 0, "issues": []}

    if dpi is None:
        return {"issues_count": 1, "issues": [{
            "type": "image_dpi_unknown",
            "message": "Image has no DPI metadata.",
            "category": "Warning",
            "file_path": file_path,
        }]}

    x_dpi, y_dpi = dpi[0], dpi[1]
    if round(x_dpi) < _EXPECTED_BODY_DPI or round(y_dpi) < _EXPECTED_BODY_DPI:
        return {"issues_count": 1, "issues": [{
            "type": "image_low_dpi",
            "message": f"Image is {x_dpi}x{y_dpi} DPI; required minimum is {_EXPECTED_BODY_DPI} DPI.",
            "category": "Error",
            "file_path": file_path,
        }]}

    return {"issues_count": 0, "issues": []}


_CENTER_HINTS_RE = re.compile(r"(?:^|\s)(center|centered|center-image|figure-center|img-center)(?:\s|$)", re.IGNORECASE)


def _css_center_declarations(epub: str) -> set[str]:
    """Return CSS class names whose ruleset makes children center-aligned."""
    centering_classes: set[str] = set()
    for css_path in glob.glob(os.path.join(epub, "**", "*.css"), recursive=True):
        try:
            with open(css_path, "r", encoding="utf-8") as f:
                css = f.read()
        except Exception:  # noqa: BLE001
            continue
        for m in re.finditer(r"\.([\w-]+)\s*\{([^{}]*)\}", css):
            cls = m.group(1)
            body = m.group(2).lower()
            if "text-align" in body and "center" in body:
                centering_classes.add(cls)
            elif "margin" in body and "auto" in body and "display" in body and "block" in body:
                centering_classes.add(cls)
    return centering_classes


@rule("ASP-IMG-006")
def validate_image_center_alignment(file_details, rule_config=None):
    """Body <img> elements should be center-aligned via a class or inline style,
    or wrapped in a <figure>/<div> whose class centers content.
    """
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")

    epub = file_details.get("epub_root")
    if not epub:
        # walk up to find EPUB root (contains OEBPS or META-INF)
        p = file_details["full_path"]
        for _ in range(8):
            p = os.path.dirname(p)
            if os.path.isdir(os.path.join(p, "META-INF")) or os.path.basename(p).lower() == "epub":
                epub = p if os.path.isdir(os.path.join(p, "META-INF")) else os.path.dirname(p)
                break
    css_centered_classes = _css_center_declarations(epub) if epub else set()

    def _is_centered(el) -> bool:
        classes = el.get("class") or []
        if any(_CENTER_HINTS_RE.search(c) for c in classes):
            return True
        if any(c in css_centered_classes for c in classes):
            return True
        style = (el.get("style") or "").lower().replace(" ", "")
        if "text-align:center" in style:
            return True
        if "margin:0auto" in style or "margin:auto" in style:
            return True
        return False

    issues = []
    for img in soup.find_all("img"):
        if _is_centered(img):
            continue
        parent = img.parent
        centered = False
        while parent is not None and parent.name != "body":
            if _is_centered(parent):
                centered = True
                break
            parent = parent.parent
        if not centered:
            src = img.get("src", "")
            issues.append({
                "type": "image_not_centered",
                "message": (
                    f"<img src='{src}'> is not center-aligned via class or inline style. "
                    "Aspen convention is center placement."
                ),
                "category": "Warning",
                "href": src,
            })
    return {"issues_count": len(issues), "issues": issues}


_LONG_ALT_THRESHOLD = 150


@rule("ASP-IMG-004")
def validate_long_alt_hidden(file_details, rule_config=None):
    """Long alt text (>150 chars) should be moved to a hidden container
    (aria-describedby, <figcaption class='hidden'>, or details/summary) rather
    than crammed into the alt attribute.
    """
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        content = f.read()

    soup = BeautifulSoup(content, "html.parser")
    lines = content.splitlines()
    issues = []

    for img in soup.find_all("img"):
        alt = (img.get("alt") or "").strip()
        if len(alt) <= _LONG_ALT_THRESHOLD:
            continue
        # Passing conditions: aria-describedby points to a real id, or the image
        # sits in a <figure> whose <figcaption> is marked hidden.
        aria_describedby = (img.get("aria-describedby") or "").strip()
        if aria_describedby:
            target = soup.find(id=aria_describedby)
            if target is not None:
                continue
        parent_fig = img.find_parent("figure")
        if parent_fig:
            cap = parent_fig.find("figcaption")
            if cap:
                classes = " ".join(cap.get("class") or [])
                style = (cap.get("style") or "").lower()
                if "hidden" in classes.lower() or "sr-only" in classes or "display:none" in style.replace(" ", ""):
                    continue
        src = img.get("src", "")

        line_num = None
        if hasattr(img, 'sourceline') and img.sourceline:
            line_num = img.sourceline
        else:
            img_str = str(img)
            for idx, line in enumerate(lines, 1):
                if "src=" in line and src in line:
                    line_num = idx
                    break

        issue = {
            "type": "long_alt_not_hidden",
            "message": (
                f"<img src='{src}'> has {len(alt)}-char alt text; long descriptions "
                f"should be in a hidden container (aria-describedby or hidden <figcaption>)."
            ),
            "category": "Warning",
            "href": src,
        }
        if line_num:
            issue["line_number"] = line_num
        issues.append(issue)
    return {"issues_count": len(issues), "issues": issues}


@rule("GWP-IMG-001")
def validate_gwp_image_filename_format(file_details, rule_config=None):
    """GWP000: Image file name format: Chapter and figure should be separated by a dash. Do not use a period."""
    file_path = file_details.get("file_path", "")
    filename = os.path.basename(file_path)
    stem, ext = os.path.splitext(filename)
    
    issues = []
    if "." in stem:
        issues.append({
            "type": "invalid_image_filename_format",
            "message": f"Image file name '{filename}' contains a period before the extension. Chapter and figure numbers should be separated by a dash.",
            "category": "Error",
            "file_path": file_path,
        })
    return {"issues_count": len(issues), "issues": issues}
