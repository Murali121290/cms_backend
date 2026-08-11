"""EPS rendering via Ghostscript for high-quality raster and vector output.

Pillow's EpsImagePlugin drives Ghostscript indirectly via a coarse `scale`
multiplier on ~100 DPI, which either under-resolves small EPS files or
over-resolves large ones. This module invokes the `gs` binary directly:

- ``eps_to_pdf``  produces a single-page vector PDF (used by Figure PDF for
  lossless embedding via ``page.show_pdf_page``).
- ``eps_to_png``  rasterizes to PNG at a DPI computed from the EPS bounding
  box and a target long-edge pixel count, so the output lands close to the
  intended display size without upscale artefacts or wasteful oversampling.

The `ghostscript` binary is installed in the backend image.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger("app.domains.files.eps_service")

_BBOX_RE = re.compile(
    rb"^%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)",
    re.MULTILINE,
)
_HIRES_BBOX_RE = re.compile(
    rb"^%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)",
    re.MULTILINE,
)

# DPI bounds. 1200 caps memory for pathological small bboxes (a 0.1" bbox
# targeting 3000px would otherwise ask for 30000 DPI); 72 keeps large EPS
# from producing thumbnail-sized rasters.
_MIN_DPI = 72
_MAX_DPI = 1200
_DEFAULT_DPI = 300

_GS_TIMEOUT_SECONDS = 120


def _gs_binary() -> str:
    gs = shutil.which("gs")
    if not gs:
        raise RuntimeError("Ghostscript (gs) is not installed on PATH.")
    return gs


def read_bbox_points(eps_path: Path) -> Optional[Tuple[float, float]]:
    """Return ``(width_pt, height_pt)`` from the EPS bounding box, or None."""
    with open(eps_path, "rb") as f:
        header = f.read(32768)
    match = _HIRES_BBOX_RE.search(header) or _BBOX_RE.search(header)
    if not match:
        return None
    try:
        x1, y1, x2, y2 = (float(match.group(i)) for i in range(1, 5))
    except ValueError:
        return None
    w = x2 - x1
    h = y2 - y1
    if w <= 0 or h <= 0:
        return None
    return (w, h)


def dpi_for_edge(eps_path: Path, target_px_edge: int) -> int:
    """DPI that renders the EPS's long edge at approximately ``target_px_edge`` px."""
    bbox = read_bbox_points(eps_path)
    if bbox is None:
        return _DEFAULT_DPI
    long_edge_in = max(bbox) / 72.0
    if long_edge_in <= 0:
        return _DEFAULT_DPI
    dpi = int(round(target_px_edge / long_edge_in))
    return max(_MIN_DPI, min(_MAX_DPI, dpi))


def eps_to_pdf(eps_path: Path, out_path: Path) -> Path:
    """Convert EPS to a single-page vector PDF via Ghostscript.

    ``-dEPSCrop`` sizes the page to the EPS bounding box (no letterbox). No
    rasterization occurs — vector strokes/fills survive intact.
    """
    cmd = [
        _gs_binary(),
        "-q",
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        "-sDEVICE=pdfwrite",
        "-dEPSCrop",
        "-dPDFSETTINGS=/prepress",
        f"-sOutputFile={out_path}",
        str(eps_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=_GS_TIMEOUT_SECONDS)
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        stderr = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Ghostscript EPS→PDF failed: {stderr}")
    return out_path


def eps_to_png(
    eps_path: Path,
    out_path: Path,
    *,
    target_px_edge: int = 2400,
    dpi: Optional[int] = None,
) -> Path:
    """Rasterize EPS to PNG via Ghostscript at a target long-edge pixel size.

    When ``dpi`` is provided it overrides the bbox-derived DPI. Otherwise the
    DPI is computed so the long edge lands close to ``target_px_edge`` px.
    """
    render_dpi = dpi if dpi is not None else dpi_for_edge(eps_path, target_px_edge)
    cmd = [
        _gs_binary(),
        "-q",
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        "-sDEVICE=png16m",
        "-dEPSCrop",
        "-dTextAlphaBits=4",
        "-dGraphicsAlphaBits=4",
        f"-r{render_dpi}",
        f"-sOutputFile={out_path}",
        str(eps_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=_GS_TIMEOUT_SECONDS)
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        stderr = proc.stderr.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Ghostscript EPS→PNG at {render_dpi} DPI failed: {stderr}")
    return out_path
