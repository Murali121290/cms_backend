import glob
import os

from bs4 import BeautifulSoup
from PIL import Image

from ....engine.registry import rule
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
