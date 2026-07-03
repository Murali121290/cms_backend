"""Rasterize source images to browser-safe PNG/JPG previews.

Browsers can't render TIFF or EPS natively, and even browser-safe formats can
be too large to send to a canvas-based editor. This service transcodes source
images to a cached preview file and returns its path. Cache invalidation is
mtime-based on the source file, so an in-place save automatically produces a
fresh preview on the next request.

EPS handling delegates to Ghostscript (which Pillow's EpsImagePlugin invokes
via subprocess). The `ghostscript` binary is installed in the backend image.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger("app.domains.files.image_preview_service")


PreviewFormat = Literal["png", "jpg"]

# Cache root — sits under runtime so it shares the bind-mounted volume.
_CACHE_ROOT_ENV = "CMS_RUNTIME_ROOT"
_CACHE_SUBDIR = "previews"

# Maximum preview dimension. Filerobot handles resize internally but shipping a
# 30 MP raw scan to the browser is wasteful; downscale on preview.
_MAX_PREVIEW_EDGE = 2400

# Formats that browsers render natively. Everything else must be transcoded.
_BROWSER_SAFE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}

_MIME_BY_FMT = {
    "png": "image/png",
    "jpg": "image/jpeg",
}


def _cache_root() -> Path:
    root = os.environ.get(_CACHE_ROOT_ENV, "/opt/cms_runtime")
    p = Path(root) / _CACHE_SUBDIR
    p.mkdir(parents=True, exist_ok=True)
    return p


def _cache_path(file_id: int, fmt: PreviewFormat, source_mtime_ns: int) -> Path:
    # Mtime in the filename keys the cache to the source file's exact revision.
    # Stale entries linger but are cheap; a periodic sweeper can prune them.
    return _cache_root() / f"{file_id}.{source_mtime_ns}.{fmt}"


def source_needs_transcoding(filename: str) -> bool:
    ext = _ext(filename)
    return ext not in _BROWSER_SAFE_EXTS


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def preview_mime(fmt: PreviewFormat) -> str:
    return _MIME_BY_FMT[fmt]


def get_or_build_preview(
    source_path: str,
    file_id: int,
    fmt: PreviewFormat = "png",
) -> Path:
    """Return the path to a browser-safe preview of `source_path`.

    Cached results are reused when the source's mtime matches; otherwise a
    fresh preview is transcoded. Raises `FileNotFoundError` if the source is
    missing and `RuntimeError` if transcoding fails (typically because
    Ghostscript is unavailable for an EPS input).
    """
    src = Path(source_path)
    if not src.exists():
        raise FileNotFoundError(source_path)

    mtime_ns = src.stat().st_mtime_ns
    cached = _cache_path(file_id, fmt, mtime_ns)
    if cached.exists() and cached.stat().st_size > 0:
        return cached

    try:
        with Image.open(src) as img:
            img = ImageOps.exif_transpose(img) or img
            # Downscale for the browser — filerobot fits it to the viewport
            # anyway, and a full-resolution scan makes the editor sluggish.
            img.thumbnail((_MAX_PREVIEW_EDGE, _MAX_PREVIEW_EDGE), Image.LANCZOS)

            if fmt == "jpg":
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(cached, format="JPEG", quality=88, optimize=True)
            else:
                # PNG preserves transparency for line art / logos.
                if img.mode not in ("RGB", "RGBA", "L", "LA"):
                    img = img.convert("RGBA")
                img.save(cached, format="PNG", optimize=True)
    except UnidentifiedImageError as e:
        raise RuntimeError(f"Could not decode image: {e}") from e
    except OSError as e:
        # Pillow raises OSError for Ghostscript failures on EPS. Surface it.
        raise RuntimeError(f"Failed to render preview: {e}") from e

    return cached
