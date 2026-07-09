"""Extract organized metadata from image files for the Image Editor's
Metadata panel.

Returns a dict shaped as:

    {
      "sections": {
        "file_information":     {...},
        "image_properties":     {...},
        "color_profile":        {...} | None,
        "tiff_information":     {...} | None,
        "photoshop_information":{...} | None,
        "exif_xmp":             {...} | None,
      },
      "raw": {...}
    }

Every leaf value is either a JSON-serializable primitive or `None` (the
frontend renders `None` as "Not Available"). The `raw` dict holds the full
decoded EXIF/TIFF/info dump for the "View Raw Metadata" toggle — heavy
fields (thumbnails, ICC blobs, transfer functions) are replaced with a size
hint so the response stays manageable.
"""

from __future__ import annotations

import io
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageCms, TiffImagePlugin
from PIL.ExifTags import TAGS as EXIF_TAG_NAMES

logger = logging.getLogger("app.domains.files.image_metadata_service")


# Fields that carry very large payloads and are hidden from the raw dump.
# Users can still infer their presence from a "<bytes: N>" placeholder.
_HEAVY_INFO_KEYS = {
    "icc_profile",
    "exif",
    "photoshop",
    "xmp",
    "XML:com.adobe.xmp",
    "PrintStyle",
    "PrintInfo",
    "BackgroundColor",
    "Thumbnail",
    "ThumbnailData",
    "CaptionDigest",
    "TransferFunction",
}

# Photoshop IRB (Image Resource Block) IDs relevant to the panel.
# Reference: Adobe Photoshop File Formats Specification.
_IRB_VERSION = 0x0421
_IRB_PRINT_SETTINGS = 0x0412
_IRB_PRINT_SCALE = 0x0426
_IRB_SLICES = 0x041A
_IRB_GRID_GUIDES = 0x0408
_IRB_PIXEL_ASPECT = 0x0428


def _fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / (1024 * 1024):.2f} MB"
    return f"{n / (1024 * 1024 * 1024):.2f} GB"


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts).isoformat(timespec="seconds")
    except (OSError, ValueError):
        return None


def _to_jsonable(value: Any) -> Any:
    """Coerce PIL/EXIF values into JSON-safe primitives."""
    if value is None:
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, bytes):
        return f"<bytes: {len(value)}>"
    if isinstance(value, TiffImagePlugin.IFDRational):
        try:
            return float(value)
        except (ZeroDivisionError, ValueError):
            return str(value)
    if isinstance(value, (list, tuple)):
        if len(value) > 32:
            return f"<array: {len(value)} items>"
        return [_to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    return str(value)


def _exif_dict(img: Image.Image) -> dict[str, Any]:
    """Return EXIF as a name-keyed dict. Empty if no EXIF present."""
    out: dict[str, Any] = {}
    try:
        exif = img.getexif()
    except Exception:
        return out
    if not exif:
        return out
    for tag_id, value in exif.items():
        name = EXIF_TAG_NAMES.get(tag_id, f"Tag{tag_id}")
        out[name] = value
    return out


def _photometric_label(v: int | None) -> str | None:
    labels = {
        0: "White is Zero",
        1: "Black is Zero",
        2: "RGB",
        3: "Palette",
        4: "Transparency Mask",
        5: "CMYK",
        6: "YCbCr",
        8: "CIELab",
    }
    if v is None:
        return None
    return labels.get(int(v), f"Unknown ({v})")


def _compression_label(v: Any) -> str | None:
    if v is None:
        return None
    labels = {
        1: "Uncompressed",
        2: "CCITT 1D",
        3: "CCITT Group 3",
        4: "CCITT Group 4",
        5: "LZW",
        6: "JPEG (old)",
        7: "JPEG",
        8: "Deflate",
        32773: "PackBits",
        32946: "Deflate (Adobe)",
    }
    if isinstance(v, str):
        return v
    try:
        iv = int(v)
        return labels.get(iv, f"Unknown ({iv})")
    except (TypeError, ValueError):
        return str(v)


def _orientation_label(v: int | None) -> str | None:
    if v is None:
        return None
    labels = {
        1: "Normal",
        2: "Mirrored horizontally",
        3: "Rotated 180°",
        4: "Mirrored vertically",
        5: "Mirrored horizontally, rotated 270° CW",
        6: "Rotated 90° CW",
        7: "Mirrored horizontally, rotated 90° CW",
        8: "Rotated 270° CW",
    }
    return labels.get(int(v), f"Unknown ({v})")


def _resolution_unit_label(v: Any) -> str | None:
    if v is None:
        return None
    labels = {1: "None", 2: "inches", 3: "cm"}
    try:
        return labels.get(int(v), f"Unknown ({v})")
    except (TypeError, ValueError):
        return str(v)


def _color_space_from_mode(mode: str | None) -> str | None:
    if not mode:
        return None
    map_ = {
        "1": "1-bit Bilevel",
        "L": "Grayscale",
        "LA": "Grayscale + Alpha",
        "P": "Palette",
        "PA": "Palette + Alpha",
        "RGB": "RGB",
        "RGBA": "RGBA",
        "CMYK": "CMYK",
        "YCbCr": "YCbCr",
        "LAB": "L*a*b*",
        "HSV": "HSV",
        "I": "32-bit Integer",
        "F": "32-bit Float",
    }
    return map_.get(mode, mode)


def _icc_section(img: Image.Image) -> dict[str, Any] | None:
    icc_bytes = img.info.get("icc_profile")
    if not icc_bytes:
        return None
    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
    except Exception as exc:
        logger.info("ICC profile present but could not be parsed: %s", exc)
        return {
            "ICC Profile Name": None,
            "Profile Description": None,
            "Profile Size": _fmt_size(len(icc_bytes)),
            "Color Space": None,
            "Device Manufacturer": None,
            "Media White Point": None,
        }

    def _safe(fn):
        try:
            return fn() or None
        except Exception:
            return None

    desc = _safe(lambda: ImageCms.getProfileDescription(profile).strip())
    mfg = _safe(lambda: ImageCms.getProfileManufacturer(profile).strip())
    cs = _safe(lambda: ImageCms.getProfileConnectionSpace(profile).strip())
    name = _safe(lambda: ImageCms.getProfileName(profile).strip())

    # Media white point — Pillow doesn't expose it directly, so probe the
    # underlying LittleCMS profile if present.
    white_point: str | None = None
    try:
        header = profile.profile
        wp = getattr(header, "media_white_point", None)
        if wp is not None:
            white_point = ", ".join(f"{float(c):.4f}" for c in wp)
    except Exception:
        white_point = None

    return {
        "ICC Profile Name": name,
        "Profile Description": desc,
        "Profile Size": _fmt_size(len(icc_bytes)),
        "Color Space": cs,
        "Device Manufacturer": mfg,
        "Media White Point": white_point,
    }


def _tiff_section(img: Image.Image) -> dict[str, Any] | None:
    if img.format != "TIFF":
        return None
    tags = getattr(img, "tag_v2", None)
    if not tags:
        return None

    def g(tag_id: int) -> Any:
        try:
            return tags.get(tag_id)
        except Exception:
            return None

    rows_per_strip = g(278)
    strip_offsets = g(273)
    strip_byte_counts = g(279)
    photometric = g(262)

    def _short(seq: Any) -> str | None:
        if seq is None:
            return None
        try:
            items = list(seq)
        except TypeError:
            return str(seq)
        if len(items) <= 6:
            return ", ".join(str(int(x)) for x in items)
        head = ", ".join(str(int(x)) for x in items[:3])
        return f"{head}, … ({len(items)} entries)"

    return {
        "Rows Per Strip": int(rows_per_strip) if rows_per_strip is not None else None,
        "Strip Offsets": _short(strip_offsets),
        "Strip Byte Counts": _short(strip_byte_counts),
        "Photometric Interpretation": _photometric_label(
            int(photometric) if photometric is not None else None
        ),
    }


def _photoshop_section(img: Image.Image) -> dict[str, Any] | None:
    ps = img.info.get("photoshop")
    if not ps:
        return None
    # Pillow returns a dict keyed by IRB resource ID.
    def _present(rid: int) -> str | None:
        return "Present" if rid in ps else None

    pixel_aspect: str | None = None
    if _IRB_PIXEL_ASPECT in ps:
        blob = ps[_IRB_PIXEL_ASPECT]
        # Layout: 4 bytes version + 8 bytes double aspect ratio.
        if isinstance(blob, (bytes, bytearray)) and len(blob) >= 12:
            import struct
            try:
                ratio = struct.unpack(">d", bytes(blob[4:12]))[0]
                pixel_aspect = f"{ratio:.4f}"
            except Exception:
                pixel_aspect = "Present"
        else:
            pixel_aspect = "Present"

    return {
        "Photoshop Version": _present(_IRB_VERSION),
        "Print Settings": _present(_IRB_PRINT_SETTINGS),
        "Print Scale": _present(_IRB_PRINT_SCALE),
        "Slices": _present(_IRB_SLICES),
        "Grid & Guides": _present(_IRB_GRID_GUIDES),
        "Pixel Aspect Ratio": pixel_aspect,
    }


def _exif_xmp_section(img: Image.Image, exif: dict[str, Any]) -> dict[str, Any] | None:
    xmp: dict[str, Any] | None = None
    try:
        # getxmp exists on Pillow >= 8.3 and returns a nested dict.
        if hasattr(img, "getxmp"):
            xmp = img.getxmp() or None  # type: ignore[attr-defined]
    except Exception:
        xmp = None

    make = exif.get("Make")
    model = exif.get("Model")
    lens = exif.get("LensModel")
    camera_parts = [str(p).strip() for p in (make, model, lens) if p]
    camera = " · ".join(camera_parts) if camera_parts else None

    copyright_ = exif.get("Copyright")
    artist = exif.get("Artist")
    description = exif.get("ImageDescription")

    keywords: str | None = None
    xmp_values: str | None = None
    if xmp:
        # Flatten a couple of well-known Dublin Core fields when present.
        dc = _find_nested(xmp, "dc")
        if isinstance(dc, dict):
            if not description:
                desc = dc.get("description")
                if isinstance(desc, list) and desc:
                    description = desc[0]
                elif isinstance(desc, str):
                    description = desc
            if not artist:
                creator = dc.get("creator")
                if isinstance(creator, list) and creator:
                    artist = ", ".join(str(c) for c in creator)
                elif isinstance(creator, str):
                    artist = creator
            if not copyright_:
                rights = dc.get("rights")
                if isinstance(rights, list) and rights:
                    copyright_ = rights[0]
                elif isinstance(rights, str):
                    copyright_ = rights
            subject = dc.get("subject")
            if isinstance(subject, list) and subject:
                keywords = ", ".join(str(s) for s in subject)
            elif isinstance(subject, str):
                keywords = subject

        # Summarize XMP root namespaces so the user sees something meaningful
        # without dumping the entire packet.
        try:
            root = next(iter(xmp.values()))
            if isinstance(root, dict):
                xmp_values = ", ".join(sorted(root.keys()))
        except StopIteration:
            xmp_values = None

    if not any([camera, xmp_values, copyright_, artist, description, keywords]):
        return None

    return {
        "Camera Information": camera,
        "XMP Values": xmp_values,
        "Copyright": _stringify(copyright_),
        "Author": _stringify(artist),
        "Description": _stringify(description),
        "Keywords": keywords,
    }


def _find_nested(d: Any, key: str) -> Any:
    """Depth-first search for the first dict value whose key equals `key`."""
    if not isinstance(d, dict):
        return None
    if key in d:
        return d[key]
    for v in d.values():
        found = _find_nested(v, key)
        if found is not None:
            return found
    return None


def _stringify(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8", errors="replace").strip() or None
        except Exception:
            return None
    s = str(v).strip()
    return s or None


def _raw_dump(img: Image.Image, exif: dict[str, Any]) -> dict[str, Any]:
    info = {}
    for k, v in img.info.items():
        if k in _HEAVY_INFO_KEYS:
            if isinstance(v, (bytes, bytearray)):
                info[k] = f"<bytes: {len(v)}>"
            elif isinstance(v, dict):
                info[k] = f"<dict: {len(v)} entries>"
            else:
                info[k] = "<hidden>"
            continue
        info[k] = _to_jsonable(v)

    dump: dict[str, Any] = {
        "info": info,
        "exif": {k: _to_jsonable(v) for k, v in exif.items()},
    }

    tags = getattr(img, "tag_v2", None)
    if tags:
        tif: dict[str, Any] = {}
        for tag_id, value in tags.items():
            name = TiffImagePlugin.TiffTags.lookup(tag_id).name if hasattr(TiffImagePlugin, "TiffTags") else str(tag_id)
            tif[f"{tag_id} ({name})"] = _to_jsonable(value)
        dump["tiff_tags"] = tif

    return dump


def extract_metadata(path: str | os.PathLike, filename: str) -> dict[str, Any]:
    """Open `path` and return an organized metadata dict.

    Raises FileNotFoundError if the file is missing. Any other error while
    decoding is captured and surfaced as an "unavailable" section so the panel
    still renders the file-system-level info.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(str(p))

    stat = p.stat()
    ext = p.suffix.lstrip(".").lower() or None

    file_information = {
        "File Name": filename,
        "File Type": ext.upper() if ext else None,
        "File Size": _fmt_size(stat.st_size),
        "Created Date": _iso(getattr(stat, "st_birthtime", None) or stat.st_ctime),
        "Modified Date": _iso(stat.st_mtime),
        "Software": None,
    }

    image_properties: dict[str, Any] = {
        "Width": None,
        "Height": None,
        "Resolution (X DPI)": None,
        "Resolution (Y DPI)": None,
        "Resolution Unit": None,
        "Orientation": None,
        "Color Space": None,
        "Bits Per Sample": None,
        "Samples Per Pixel": None,
        "Compression": None,
    }
    color_profile: dict[str, Any] | None = None
    tiff_information: dict[str, Any] | None = None
    photoshop_information: dict[str, Any] | None = None
    exif_xmp: dict[str, Any] | None = None
    raw: dict[str, Any] = {}

    try:
        with Image.open(p) as img:
            img.load()
            exif = _exif_dict(img)

            image_properties["Width"] = img.width
            image_properties["Height"] = img.height
            image_properties["Color Space"] = _color_space_from_mode(img.mode)

            dpi = img.info.get("dpi")
            if isinstance(dpi, tuple) and len(dpi) >= 2:
                try:
                    image_properties["Resolution (X DPI)"] = float(dpi[0])
                    image_properties["Resolution (Y DPI)"] = float(dpi[1])
                except (TypeError, ValueError):
                    pass

            tags = getattr(img, "tag_v2", None)
            if tags:
                x_res, y_res = tags.get(282), tags.get(283)
                if x_res and image_properties["Resolution (X DPI)"] is None:
                    try:
                        image_properties["Resolution (X DPI)"] = float(x_res)
                    except (TypeError, ValueError):
                        pass
                if y_res and image_properties["Resolution (Y DPI)"] is None:
                    try:
                        image_properties["Resolution (Y DPI)"] = float(y_res)
                    except (TypeError, ValueError):
                        pass
                image_properties["Resolution Unit"] = _resolution_unit_label(tags.get(296))
                bps = tags.get(258)
                if bps is not None:
                    if isinstance(bps, (tuple, list)):
                        image_properties["Bits Per Sample"] = ", ".join(str(int(x)) for x in bps)
                    else:
                        image_properties["Bits Per Sample"] = int(bps)
                spp = tags.get(277)
                if spp is not None:
                    try:
                        image_properties["Samples Per Pixel"] = int(spp)
                    except (TypeError, ValueError):
                        image_properties["Samples Per Pixel"] = str(spp)
                image_properties["Compression"] = _compression_label(tags.get(259))
            else:
                # Non-TIFF: derive samples/bits per sample from mode.
                mode_to_bps = {"1": 1, "L": 8, "LA": 8, "P": 8, "RGB": 8, "RGBA": 8, "CMYK": 8}
                mode_to_spp = {"1": 1, "L": 1, "LA": 2, "P": 1, "RGB": 3, "RGBA": 4, "CMYK": 4}
                if img.mode in mode_to_bps:
                    image_properties["Bits Per Sample"] = mode_to_bps[img.mode]
                    image_properties["Samples Per Pixel"] = mode_to_spp[img.mode]
                if img.format:
                    image_properties["Compression"] = img.format

            orient = exif.get("Orientation")
            if orient is not None:
                try:
                    image_properties["Orientation"] = _orientation_label(int(orient))
                except (TypeError, ValueError):
                    image_properties["Orientation"] = str(orient)

            if "Software" in exif:
                file_information["Software"] = _stringify(exif.get("Software"))

            color_profile = _icc_section(img)
            tiff_information = _tiff_section(img)
            photoshop_information = _photoshop_section(img)
            exif_xmp = _exif_xmp_section(img, exif)
            raw = _raw_dump(img, exif)
    except FileNotFoundError:
        raise
    except Exception as exc:
        logger.warning("Metadata extraction failed for %s: %s", p, exc)
        raw = {"error": str(exc)}

    return {
        "sections": {
            "file_information": file_information,
            "image_properties": image_properties,
            "color_profile": color_profile,
            "tiff_information": tiff_information,
            "photoshop_information": photoshop_information,
            "exif_xmp": exif_xmp,
        },
        "raw": raw,
    }
