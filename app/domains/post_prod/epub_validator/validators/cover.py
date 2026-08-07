import glob
import os

from PIL import Image

from ..engine.registry import rule


_EXPECTED_HEIGHT_PX = 1100
_EXPECTED_DPI = 300


def _find_cover(epub_folder: str) -> str | None:
    for candidate in glob.glob(os.path.join(epub_folder, "**", "cover.*"), recursive=True):
        if os.path.basename(candidate).lower().startswith("cover.") and \
           candidate.lower().endswith((".jpg", ".jpeg", ".png")):
            return candidate
    return None


@rule("ASP-COV-001")
def validate_cover_filename(book_details):
    """Cover image must be named cover.jpg."""
    epub = book_details["epub_path"]
    issues = []
    images_dirs = glob.glob(os.path.join(epub, "**", "images"), recursive=True)
    found_cover = False
    for d in images_dirs:
        for f in os.listdir(d):
            low = f.lower()
            if low in ("cover.jpg", "cover.jpeg"):
                found_cover = True
                if f != "cover.jpg":
                    issues.append({
                        "type": "cover_filename_case",
                        "message": f"Cover image should be named exactly 'cover.jpg' (found '{f}')",
                        "category": "Warning",
                        "file_path": os.path.relpath(os.path.join(d, f), epub),
                    })
            elif low.startswith("cover.") and low.rsplit(".", 1)[-1] in ("png", "gif", "webp"):
                issues.append({
                    "type": "cover_wrong_format",
                    "message": f"Cover file '{f}' should be JPEG (cover.jpg)",
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
def validate_cover_height(book_details):
    """Cover height must be 1100 pixels."""
    epub = book_details["epub_path"]
    cover = _find_cover(epub)
    if not cover:
        return {"issues_count": 0, "issues": []}
    try:
        with Image.open(cover) as img:
            _, height = img.size
    except Exception as e:  # noqa: BLE001
        return {"issues_count": 1, "issues": [{
            "type": "cover_read_failed",
            "message": f"Could not open cover image: {e}",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub),
        }]}
    if height != _EXPECTED_HEIGHT_PX:
        return {"issues_count": 1, "issues": [{
            "type": "cover_wrong_height",
            "message": f"Cover height is {height}px; expected {_EXPECTED_HEIGHT_PX}px",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub),
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-COV-003")
def validate_cover_dpi(book_details):
    """Cover must be 300 DPI."""
    epub = book_details["epub_path"]
    cover = _find_cover(epub)
    if not cover:
        return {"issues_count": 0, "issues": []}
    try:
        with Image.open(cover) as img:
            dpi = img.info.get("dpi")
    except Exception as e:  # noqa: BLE001
        return {"issues_count": 1, "issues": [{
            "type": "cover_read_failed",
            "message": f"Could not open cover image: {e}",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub),
        }]}
    if dpi is None:
        return {"issues_count": 1, "issues": [{
            "type": "cover_dpi_unknown",
            "message": "Cover image has no DPI metadata; cannot confirm 300 DPI",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub),
        }]}
    x_dpi, y_dpi = dpi[0], dpi[1]
    if round(x_dpi) < _EXPECTED_DPI or round(y_dpi) < _EXPECTED_DPI:
        return {"issues_count": 1, "issues": [{
            "type": "cover_low_dpi",
            "message": f"Cover DPI is {x_dpi}x{y_dpi}; expected at least {_EXPECTED_DPI} DPI",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub),
        }]}
    return {"issues_count": 0, "issues": []}
