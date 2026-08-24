import glob
import os

from PIL import Image

from ..engine.registry import rule


_EXPECTED_HEIGHT_PX = 1100


def _find_cover(epub_folder: str) -> str | None:
    for candidate in glob.glob(os.path.join(epub_folder, "**", "cover.*"), recursive=True):
        if os.path.basename(candidate).lower().startswith("cover.") and \
           candidate.lower().endswith(".jpg"):
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
    """Cover height must be 1100 pixels."""
    if isinstance(target, dict) and target.get("file_path"):
        cover = target["file_path"]
        epub = target.get("epub_path") or (os.path.dirname(cover) if cover else "")
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
    if height != _EXPECTED_HEIGHT_PX:
        return {"issues_count": 1, "issues": [{
            "type": "cover_wrong_height",
            "message": f"Cover height is {height}px; expected {_EXPECTED_HEIGHT_PX}px",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    return {"issues_count": 0, "issues": []}


@rule("ASP-COV-003")
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

    if isinstance(target, dict) and target.get("file_path"):
        cover = target["file_path"]
        epub = target.get("epub_path") or (os.path.dirname(cover) if cover else "")
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
            "message": f"Cover image has no DPI metadata; cannot confirm {expected_dpi} DPI",
            "category": "Warning",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    x_dpi, y_dpi = dpi[0], dpi[1]
    if round(x_dpi) < expected_dpi or round(y_dpi) < expected_dpi:
        return {"issues_count": 1, "issues": [{
            "type": "cover_low_dpi",
            "message": f"Cover DPI is {x_dpi}x{y_dpi}; expected at least {expected_dpi} DPI",
            "category": "Error",
            "file_path": os.path.relpath(cover, epub) if epub else cover,
        }]}
    return {"issues_count": 0, "issues": []}
