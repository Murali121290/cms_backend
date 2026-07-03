"""Convert images between formats (EPS/TIFF/PNG/JPG) via Pillow + Ghostscript.

Supports two write modes:
  - "copy":     writes a new file record next to the original with the target
                extension; the original remains untouched (default).
  - "in_place": overwrites the source file, archives the previous version via
                the same versioning path used by uploads, and updates the
                file record's extension + file_type.

EPS input requires Ghostscript at runtime (Pillow's EpsImagePlugin shells out).
The `ghostscript` binary is installed in the backend image.
"""

from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app import models
from app.domains.files import version_service
from app.utils.timezone import now_ist_naive

logger = logging.getLogger("app.domains.files.image_convert_service")

TargetFormat = Literal["png", "jpg", "jpeg", "tiff", "tif"]
WriteMode = Literal["copy", "in_place"]

_PIL_FORMAT_BY_EXT = {
    "png": "PNG",
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "tif": "TIFF",
    "tiff": "TIFF",
}

# Max source dimensions we're willing to load. Guards against a 500 MP TIFF
# blowing memory. If an image exceeds this, we reject with a clear error.
_MAX_SOURCE_PIXELS = 100_000_000  # 100 MP


def _normalize_ext(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    if ext == "jpeg":
        return "jpg"
    if ext == "tiff":
        return "tif"
    return ext


def convert_image(
    db: Session,
    *,
    file_record: models.File,
    target_format: TargetFormat,
    mode: WriteMode = "copy",
    uploaded_by_id: int | None = None,
) -> models.File:
    """Transcode `file_record` to `target_format` and persist.

    Returns the resulting `File` — either the same record (in_place) or a new
    record for the copy. Raises `RuntimeError` on decode failure and
    `ValueError` on unsupported target format.
    """
    if target_format not in _PIL_FORMAT_BY_EXT:
        raise ValueError(f"Unsupported target format: {target_format}")

    pil_format = _PIL_FORMAT_BY_EXT[target_format]
    normalized_ext = _normalize_ext(target_format)

    src_path = Path(file_record.path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source file missing on disk: {src_path}")

    with Image.open(src_path) as img:
        if img.width * img.height > _MAX_SOURCE_PIXELS:
            raise RuntimeError(
                f"Source image is too large to convert "
                f"({img.width}×{img.height}); limit is 100 MP."
            )

        img = ImageOps.exif_transpose(img) or img

        # JPEG can't hold alpha; flatten onto white so the result matches
        # what a user would expect from a Save As in an image editor.
        if pil_format == "JPEG":
            if img.mode in ("RGBA", "LA"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img, mask=img.split()[-1])
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
        else:
            if img.mode == "P":
                img = img.convert("RGBA" if pil_format == "PNG" else "RGB")

        # Encode to a buffer first so we can write atomically.
        buf = io.BytesIO()
        try:
            if pil_format == "JPEG":
                img.save(buf, format="JPEG", quality=92, optimize=True)
            elif pil_format == "PNG":
                img.save(buf, format="PNG", optimize=True)
            elif pil_format == "TIFF":
                img.save(buf, format="TIFF", compression="tiff_lzw")
        except (OSError, UnidentifiedImageError) as e:
            raise RuntimeError(f"Failed to encode target: {e}") from e

    encoded = buf.getvalue()

    if mode == "in_place":
        return _write_in_place(db, file_record, encoded, normalized_ext, uploaded_by_id)
    return _write_copy(db, file_record, encoded, normalized_ext, uploaded_by_id)


def _swap_ext(filename: str, new_ext: str) -> str:
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    return f"{stem}.{new_ext}"


def _write_in_place(
    db: Session,
    file_record: models.File,
    encoded: bytes,
    new_ext: str,
    uploaded_by_id: int | None,
) -> models.File:
    """Overwrite the source file; archive the prior version."""
    base_path = os.path.dirname(file_record.path)
    version_service.archive_existing_file(
        db, existing_file=file_record, base_path=base_path, uploaded_by_id=uploaded_by_id
    )

    new_filename = _swap_ext(file_record.filename, new_ext)
    new_path = os.path.join(base_path, new_filename)

    tmp_path = new_path + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(encoded)
    os.replace(tmp_path, new_path)

    # If the extension changed, drop the old file on disk.
    if new_path != file_record.path and os.path.exists(file_record.path):
        try:
            os.remove(file_record.path)
        except OSError as e:
            logger.warning(f"Could not remove old source at {file_record.path}: {e}")

    file_record.path = new_path
    file_record.filename = new_filename
    file_record.file_type = new_ext
    file_record.version = (file_record.version or 0) + 1
    file_record.uploaded_at = now_ist_naive()
    db.commit()
    db.refresh(file_record)
    return file_record


def _write_copy(
    db: Session,
    file_record: models.File,
    encoded: bytes,
    new_ext: str,
    uploaded_by_id: int | None,
) -> models.File:
    """Write a new file record next to the original with the target extension.

    If a file with the target filename already exists in the same folder we
    disambiguate with a numeric suffix so nothing is silently overwritten.
    """
    base_path = os.path.dirname(file_record.path)
    target_name = _swap_ext(file_record.filename, new_ext)
    target_path = os.path.join(base_path, target_name)

    # Disambiguate against on-disk collisions.
    if os.path.exists(target_path):
        stem = target_name.rsplit(".", 1)[0]
        n = 1
        while True:
            candidate = f"{stem}-{n}.{new_ext}"
            candidate_path = os.path.join(base_path, candidate)
            if not os.path.exists(candidate_path):
                target_name = candidate
                target_path = candidate_path
                break
            n += 1

    tmp_path = target_path + ".tmp"
    with open(tmp_path, "wb") as f:
        f.write(encoded)
    os.replace(tmp_path, target_path)

    new_record = models.File(
        project_id=file_record.project_id,
        chapter_id=file_record.chapter_id,
        filename=target_name,
        path=target_path,
        file_type=new_ext,
        category=file_record.category,
        version=1,
        uploaded_at=now_ist_naive(),
    )
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return new_record
