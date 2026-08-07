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
def validate_images_are_jpeg(book_details):
    """All images referenced in the OPF manifest must be JPEG."""
    epub = book_details["epub_path"]
    opf = find_opf(epub)
    if not opf:
        return {"issues_count": 0, "issues": []}
    issues = []
    for href, media in _iter_manifest_images(opf):
        ext = os.path.splitext(href)[1].lower()
        if ext not in _ALLOWED_EXT or (media and media not in ("image/jpeg", "image/jpg")):
            issues.append({
                "type": "image_not_jpeg",
                "message": f"Image '{href}' is not JPEG (media-type='{media or 'unknown'}')",
                "category": "Error",
                "file_path": href,
            })
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-IMG-002")
def validate_no_empty_alt(file_details):
    """<img> elements must not have empty alt attributes."""
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    issues = []
    for img in soup.find_all("img"):
        alt = img.get("alt")
        if alt is None or alt.strip() == "":
            src = img.get("src", "")
            issues.append({
                "type": "empty_alt_text",
                "message": f"<img src='{src}'> has empty or missing alt attribute",
                "category": "Error",
                "href": src,
            })
    return {"issues_count": len(issues), "issues": issues}


@rule("ASP-IMG-003")
def validate_image_dimensions(book_details):
    """No image may exceed 4,000,000 pixels (width × height)."""
    epub = book_details["epub_path"]
    issues = []
    for path in glob.glob(os.path.join(epub, "**", "*.jp*g"), recursive=True):
        try:
            with Image.open(path) as img:
                w, h = img.size
        except Exception:
            continue
        if w * h > _MAX_PIXELS:
            issues.append({
                "type": "image_over_pixel_budget",
                "message": (
                    f"Image {os.path.relpath(path, epub)} is {w}x{h} = "
                    f"{w*h:,} pixels; max allowed is {_MAX_PIXELS:,}"
                ),
                "category": "Warning",
                "file_path": os.path.relpath(path, epub),
            })
    return {"issues_count": len(issues), "issues": issues}


_EXPECTED_BODY_DPI = 300


@rule("ASP-IMG-005")
def validate_body_image_dpi(book_details):
    """Every body image (not just the cover) must be at least 300 DPI."""
    epub = book_details["epub_path"]
    issues = []
    cover_names = {"cover.jpg", "cover.jpeg", "cover.png"}
    for path in glob.glob(os.path.join(epub, "**", "*.*"), recursive=True):
        base = os.path.basename(path).lower()
        if not base.endswith((".jpg", ".jpeg", ".png")):
            continue
        if base in cover_names:
            continue  # ASP-COV-003 owns the cover check
        try:
            with Image.open(path) as img:
                dpi = img.info.get("dpi")
        except Exception:  # noqa: BLE001
            continue
        if dpi is None:
            issues.append({
                "type": "image_dpi_unknown",
                "message": f"Image {os.path.relpath(path, epub)} has no DPI metadata.",
                "category": "Warning",
                "file_path": os.path.relpath(path, epub),
            })
            continue
        x_dpi, y_dpi = dpi[0], dpi[1]
        if round(x_dpi) < _EXPECTED_BODY_DPI or round(y_dpi) < _EXPECTED_BODY_DPI:
            issues.append({
                "type": "image_low_dpi",
                "message": (
                    f"Image {os.path.relpath(path, epub)} is {x_dpi}x{y_dpi} DPI; "
                    f"required minimum is {_EXPECTED_BODY_DPI} DPI."
                ),
                "category": "Error",
                "file_path": os.path.relpath(path, epub),
            })
    return {"issues_count": len(issues), "issues": issues}


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
def validate_image_center_alignment(file_details):
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
def validate_long_alt_hidden(file_details):
    """Long alt text (>150 chars) should be moved to a hidden container
    (aria-describedby, <figcaption class='hidden'>, or details/summary) rather
    than crammed into the alt attribute.
    """
    with open(file_details["full_path"], "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
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
        issues.append({
            "type": "long_alt_not_hidden",
            "message": (
                f"<img src='{src}'> has {len(alt)}-char alt text; long descriptions "
                f"should be in a hidden container (aria-describedby or hidden <figcaption>)."
            ),
            "category": "Warning",
            "href": src,
        })
    return {"issues_count": len(issues), "issues": issues}
