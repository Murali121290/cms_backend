"""Figure PDF generation for the Art track.

For a given chapter, collect every figure — both images embedded in any DOCX
file in the chapter (in document order) and standalone image files in the
Art folder — and bundle them into a single PDF with one figure per page.
Each page carries a metadata table on top and the image centered below. The
resulting PDF is registered as a new ``category="Art"`` File so it appears
alongside the source figures.
"""
from __future__ import annotations

import io
import os
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

import fitz  # PyMuPDF
from lxml import etree as ET
from PIL import ExifTags, Image
from sqlalchemy.orm import Session

from app import models
from app.domains.projects.models import Project
from app.utils.timezone import now_ist_naive

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp"}
DOCX_EXTS = {".docx", ".docm"}

# US Letter, portrait — points (1 pt = 1/72 in)
PAGE_WIDTH = 612.0
PAGE_HEIGHT = 792.0
MARGIN = 36.0
TABLE_ROW_HEIGHT = 14.0
TABLE_LABEL_WIDTH = 140.0
IMAGE_TOP_PADDING = 12.0

_WML_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_WML_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s or "")]


def _fmt_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)} B" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"


def _fmt_ts(ts: Optional[float]) -> str:
    if ts is None:
        return "—"
    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "—"


class _ImageSource:
    """One figure to render — either loaded from disk or embedded in a DOCX."""

    __slots__ = ("filename", "data", "path", "source_label", "source_ts")

    def __init__(
        self,
        *,
        filename: str,
        data: Optional[bytes],
        path: Optional[str],
        source_label: str,
        source_ts: Optional[Tuple[float, float]],
    ):
        self.filename = filename
        self.data = data
        self.path = path
        self.source_label = source_label
        self.source_ts = source_ts

    def open_pil(self) -> Image.Image:
        if self.data is not None:
            return Image.open(io.BytesIO(self.data))
        return Image.open(self.path)  # type: ignore[arg-type]

    def bytes(self) -> bytes:
        if self.data is not None:
            return self.data
        with open(self.path, "rb") as f:  # type: ignore[arg-type]
            return f.read()

    def size_bytes(self) -> int:
        if self.data is not None:
            return len(self.data)
        return os.path.getsize(self.path)  # type: ignore[arg-type]


def _extract_docx_images(docx_path: str) -> list[_ImageSource]:
    """Return every embedded image in `docx_path`.

    Primary path: walk ``document.xml`` (plus headers/footers/foot- & endnotes)
    for ``<a:blip>`` elements and resolve each ``r:embed`` against the matching
    ``*.rels`` file to look up the media entry. This preserves document
    (reading) order and handles both inline and anchored drawings.

    Fallback: when the reference walk finds nothing but ``word/media/`` has
    entries — as happens with DOCX files whose figures were dropped from the
    body but left orphaned in the zip — enumerate the media directory directly
    (natural filename order), so the user still gets every figure Word knows
    about.
    """
    st = os.stat(docx_path)
    source_ts = (getattr(st, "st_birthtime", None) or st.st_ctime, st.st_mtime)
    docx_name = os.path.basename(docx_path)

    images: list[_ImageSource] = []
    emitted_media_paths: set[str] = set()

    def _load_rels(z: zipfile.ZipFile, rels_name: str) -> dict[str, str]:
        try:
            with z.open(rels_name) as f:
                tree = ET.parse(f)
        except (KeyError, ET.XMLSyntaxError):
            return {}
        rels: dict[str, str] = {}
        for rel in tree.getroot():
            if rel.tag.rsplit("}", 1)[-1] != "Relationship":
                continue
            rid = rel.get("Id")
            target = rel.get("Target")
            if rid and target:
                rels[rid] = target
        return rels

    def _resolve_media(target: str, part_dir: str, names: set[str]) -> Optional[str]:
        # Relationship targets are relative to the part's folder; "../media/x"
        # from word/document.xml resolves to word/media/x, etc.
        raw = target.lstrip("/")
        candidate = os.path.normpath(f"{part_dir}/{raw}").replace(os.sep, "/")
        if candidate in names:
            return candidate
        alt = f"word/{raw}"
        return alt if alt in names else None

    try:
        with zipfile.ZipFile(docx_path) as z:
            names = set(z.namelist())

            # Every "story" part that can hold drawings and its matching rels.
            parts: list[tuple[str, str]] = []
            for part in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"):
                if part in names:
                    parts.append((part, f"word/_rels/{os.path.basename(part)}.rels"))
            for name in sorted(names):
                if (name.startswith("word/header") or name.startswith("word/footer")) and name.endswith(".xml"):
                    parts.append((name, f"word/_rels/{os.path.basename(name)}.rels"))

            for part_name, rels_name in parts:
                rels_map = _load_rels(z, rels_name)
                if not rels_map:
                    continue
                try:
                    with z.open(part_name) as f:
                        tree = ET.parse(f)
                except (KeyError, ET.XMLSyntaxError):
                    continue

                part_dir = os.path.dirname(part_name)
                for blip in tree.iter(f"{{{_WML_A}}}blip"):
                    rId = blip.get(f"{{{_WML_R}}}embed") or blip.get(f"{{{_WML_R}}}link")
                    if not rId:
                        continue
                    target = rels_map.get(rId)
                    if not target:
                        continue
                    media_path = _resolve_media(target, part_dir, names)
                    if not media_path:
                        continue
                    try:
                        with z.open(media_path) as mf:
                            data = mf.read()
                    except KeyError:
                        continue
                    images.append(_ImageSource(
                        filename=os.path.basename(media_path),
                        data=data,
                        path=None,
                        source_label=docx_name,
                        source_ts=source_ts,
                    ))
                    emitted_media_paths.add(media_path)

            # Fallback: any media entry not already emitted via a reference —
            # covers DOCX files whose figures are orphaned in the zip. Sorted
            # naturally so image1, image2, …, image10 stay in order.
            leftovers = sorted(
                (n for n in names if n.startswith("word/media/") and not n.endswith("/") and n not in emitted_media_paths),
                key=lambda n: _natural_key(os.path.basename(n)),
            )
            for media_path in leftovers:
                try:
                    with z.open(media_path) as mf:
                        data = mf.read()
                except KeyError:
                    continue
                images.append(_ImageSource(
                    filename=os.path.basename(media_path),
                    data=data,
                    path=None,
                    source_label=docx_name,
                    source_ts=source_ts,
                ))
    except zipfile.BadZipFile:
        return []

    return images


def _extract_metadata(src: _ImageSource, figure_number: int) -> list[tuple[str, str]]:
    width = height = dpi = None
    fmt = color_space = exif_dt = None
    try:
        with src.open_pil() as im:
            width, height = im.size
            fmt = im.format
            color_space = im.mode
            dpi_val = im.info.get("dpi")
            if dpi_val:
                try:
                    dpi = int(round(sum(dpi_val) / len(dpi_val)))
                except (TypeError, ZeroDivisionError):
                    dpi = None
            try:
                exif = im.getexif()
                if exif:
                    for tag_id, val in exif.items():
                        tag = ExifTags.TAGS.get(tag_id, tag_id)
                        if tag in ("DateTimeOriginal", "DateTime") and isinstance(val, str):
                            exif_dt = val
                            break
            except Exception:
                pass
    except Exception:
        pass

    ctime = mtime = None
    if src.source_ts:
        ctime, mtime = src.source_ts

    return [
        ("Figure Number", str(figure_number)),
        ("File Name", src.filename),
        ("Source", src.source_label),
        ("Image Format", fmt or (Path(src.filename).suffix.lstrip(".").upper() or "—")),
        ("Width", f"{width} px" if width else "—"),
        ("Height", f"{height} px" if height else "—"),
        ("Resolution (DPI)", str(dpi) if dpi else "—"),
        ("Color Space", color_space or "—"),
        ("File Size", _fmt_size(src.size_bytes())),
        ("Creation Date", exif_dt or _fmt_ts(ctime)),
        ("Last Modified Date", _fmt_ts(mtime)),
    ]


def _draw_metadata_table(page: fitz.Page, rows: list[tuple[str, str]], top: float) -> float:
    left = MARGIN
    right = PAGE_WIDTH - MARGIN
    label_x = left + TABLE_LABEL_WIDTH
    bottom = top + TABLE_ROW_HEIGHT * len(rows)

    page.draw_rect(fitz.Rect(left, top, right, bottom), color=(0, 0, 0), width=0.6)
    page.draw_line(fitz.Point(label_x, top), fitz.Point(label_x, bottom), color=(0, 0, 0), width=0.4)

    for i, (label, value) in enumerate(rows):
        row_top = top + i * TABLE_ROW_HEIGHT
        if i > 0:
            page.draw_line(
                fitz.Point(left, row_top),
                fitz.Point(right, row_top),
                color=(0, 0, 0), width=0.25,
            )
        text_y = row_top + TABLE_ROW_HEIGHT - 4
        page.insert_text(fitz.Point(left + 4, text_y), label, fontsize=8, fontname="hebo")
        display = str(value)
        if len(display) > 140:
            display = display[:137] + "…"
        page.insert_text(fitz.Point(label_x + 4, text_y), display, fontsize=8, fontname="helv")

    return bottom


def _insert_image_centered(page: fitz.Page, src: _ImageSource, area: fitz.Rect) -> None:
    w = h = None
    try:
        with src.open_pil() as im:
            w, h = im.size
    except Exception:
        pass

    if w and h and w > 0 and h > 0:
        # Cap at 1.0: never upscale bitmaps beyond native pixel size, or a small
        # source (e.g. a 33x27 px icon) gets blown up to fill the page and looks
        # pixelated. Large figures still fit-to-page as before.
        scale = min((area.x1 - area.x0) / w, (area.y1 - area.y0) / h, 1.0)
        tw, th = w * scale, h * scale
        cx = (area.x0 + area.x1) / 2
        cy = (area.y0 + area.y1) / 2
        target = fitz.Rect(cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2)
    else:
        target = area

    data = src.bytes()
    try:
        page.insert_image(target, stream=data)
        return
    except Exception:
        pass

    # Fallback: PyMuPDF struggles with certain TIFFs/EPS — re-encode via Pillow.
    try:
        with src.open_pil() as im:
            if im.mode not in ("RGB", "RGBA", "L"):
                im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            page.insert_image(target, stream=buf.getvalue())
    except Exception:
        pass


def _collect_images_from_file(source: models.File) -> list[_ImageSource]:
    if not source.path or not os.path.exists(source.path):
        return []
    ext = Path(source.filename or source.path).suffix.lower()
    if ext in DOCX_EXTS:
        return _extract_docx_images(source.path)
    if ext in IMAGE_EXTS:
        try:
            st = os.stat(source.path)
            ts = (getattr(st, "st_birthtime", None) or st.st_ctime, st.st_mtime)
        except OSError:
            ts = None
        return [_ImageSource(
            filename=source.filename or os.path.basename(source.path),
            data=None,
            path=source.path,
            source_label=source.filename or os.path.basename(source.path),
            source_ts=ts,
        )]
    return []


def _collect_images_from_chapter(db: Session, chapter_id: int) -> list[_ImageSource]:
    all_files = (
        db.query(models.File)
        .filter(models.File.chapter_id == chapter_id)
        .all()
    )

    sources: list[_ImageSource] = []

    # 1. Every DOCX in the chapter (any category) — contributes its embedded
    #    images in document order.
    docx_files = [
        f for f in all_files
        if f.path
        and os.path.exists(f.path)
        and Path(f.filename or f.path).suffix.lower() in DOCX_EXTS
    ]
    docx_files.sort(key=lambda f: _natural_key(f.filename or ""))
    for f in docx_files:
        sources.extend(_extract_docx_images(f.path))

    # 2. Standalone image files already in the Art folder — appended after
    #    DOCX-extracted figures.
    art_images = [
        f for f in all_files
        if f.category == "Art"
        and f.path
        and os.path.exists(f.path)
        and Path(f.filename or f.path).suffix.lower() in IMAGE_EXTS
    ]
    art_images.sort(key=lambda f: _natural_key(f.filename or ""))
    for f in art_images:
        try:
            st = os.stat(f.path)
            ts = (getattr(st, "st_birthtime", None) or st.st_ctime, st.st_mtime)
        except OSError:
            ts = None
        sources.append(_ImageSource(
            filename=f.filename or os.path.basename(f.path),
            data=None,
            path=f.path,
            source_label="Art folder",
            source_ts=ts,
        ))

    return sources


def generate_figure_pdf(
    db: Session,
    *,
    project_id: int,
    chapter_id: int,
    actor_user_id: Optional[int],
    upload_dir: str,
    source_file_id: Optional[int] = None,
) -> Tuple[Optional[models.File], int, Optional[str]]:
    """Generate a Figure PDF for the chapter.

    When ``source_file_id`` is provided, extract figures from that single
    chapter file and name the output after its stem so the Art track shows
    the source at a glance. Otherwise bundle every DOCX-embedded figure and
    standalone Art image in the chapter under a generic chapter-based name.

    Returns ``(file_record, figures_included, error_message)``.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    chapter = db.query(models.ChapterInfo).filter(models.ChapterInfo.id == chapter_id).first()
    if not project or not chapter:
        return None, 0, "Project or chapter not found."

    source_file: Optional[models.File] = None
    if source_file_id is not None:
        source_file = db.query(models.File).filter(
            models.File.id == source_file_id,
            models.File.chapter_id == chapter_id,
        ).first()
        if not source_file:
            return None, 0, "Source file not found in this chapter."
        sources = _collect_images_from_file(source_file)
        if not sources:
            return None, 0, (
                f"No figures found in {source_file.filename}. The file must be a DOCX "
                "with embedded images or an image file."
            )
    else:
        sources = _collect_images_from_chapter(db, chapter_id)
        if not sources:
            return None, 0, (
                "No figures found. Upload images to the Art folder or add a DOCX "
                "containing embedded figures to this chapter."
            )

    doc = fitz.open()
    try:
        for idx, src in enumerate(sources, start=1):
            page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
            rows = _extract_metadata(src, idx)
            table_bottom = _draw_metadata_table(page, rows, MARGIN)
            image_area = fitz.Rect(
                MARGIN,
                table_bottom + IMAGE_TOP_PADDING,
                PAGE_WIDTH - MARGIN,
                PAGE_HEIGHT - MARGIN,
            )
            _insert_image_centered(page, src, image_area)

        base_path = f"{upload_dir}/{project.code}/{chapter.chapters}/Art"
        os.makedirs(base_path, exist_ok=True)

        timestamp = now_ist_naive().strftime("%Y%m%d_%H%M%S")
        if source_file is not None:
            source_stem = Path(source_file.filename or "source").stem or "source"
            filename = f"{source_stem}_Figure_PDF_{timestamp}.pdf"
        else:
            filename = f"Figure_PDF_{chapter.chapters}_{timestamp}.pdf"
        out_path = os.path.join(base_path, filename)
        doc.save(out_path, garbage=4, deflate=True)
    finally:
        doc.close()

    db_file = models.File(
        project_id=project_id,
        chapter_id=chapter_id,
        filename=filename,
        file_type="pdf",
        category="Art",
        path=out_path,
        version=1,
        is_original=False,
        uploaded_by_id=actor_user_id,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file, len(sources), None
