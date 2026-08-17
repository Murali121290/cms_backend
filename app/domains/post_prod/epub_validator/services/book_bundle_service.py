"""Cache EpubBundle and PdfDoc per upload folder.

Building these is expensive (PDF parsing especially), so we cache them
keyed by folder name + source-file mtime. A re-upload of the same folder
name with a different PDF/EPUB transparently invalidates the cache.
"""

from __future__ import annotations

import glob
import os
from typing import Optional, Tuple

from ..vendor.pdf_epub_validator import EpubExtractor, PdfParser
from ..vendor.pdf_epub_validator.epub_extractor import EpubBundle
from ..vendor.pdf_epub_validator.pdf_parser import PdfDoc


_PDF_CACHE: dict = {}    # folder_name -> (mtime, PdfDoc)
_EPUB_CACHE: dict = {}   # folder_name -> (mtime, EpubBundle)
from .upload_service import UPLOAD_DIR


def _find_source(folder_name: str, ext: str) -> Optional[str]:
    """Locate the original .epub or .pdf file the user uploaded."""
    pattern = os.path.join(UPLOAD_DIR, folder_name, "extract", f"*.{ext}")
    matches = [m for m in glob.glob(pattern) if "_pg-" not in os.path.basename(m)]
    if matches:
        return matches[0]
    # Fall back to anywhere under the upload folder
    pattern = os.path.join(UPLOAD_DIR, folder_name, "**", f"*.{ext}")
    matches = [m for m in sorted(glob.glob(pattern, recursive=True), key=len) if "_pg-" not in os.path.basename(m)]
    return matches[0] if matches else None


def _epub_extract_dir(folder_name: str) -> Optional[str]:
    """Return the pre-extracted EPUB directory if it exists."""
    path = os.path.join(UPLOAD_DIR, folder_name, "extract", "epub")
    return path if os.path.isdir(path) else None


def _epub_dir_mtime(epub_dir: str) -> float:
    """Return the newest mtime among all files in the extracted EPUB dir."""
    try:
        mtimes = [
            os.path.getmtime(f)
            for f in glob.glob(os.path.join(epub_dir, "**", "*"), recursive=True)
            if os.path.isfile(f)
        ]
        return max(mtimes) if mtimes else 0.0
    except Exception:
        return 0.0


def get_epub_bundle(folder_name: str) -> Optional[EpubBundle]:
    epub_dir = _epub_extract_dir(folder_name)
    if epub_dir:
        mtime = _epub_dir_mtime(epub_dir)
        cached = _EPUB_CACHE.get(folder_name)
        if cached and cached[0] == mtime:
            print(f"[bundle] EpubBundle cache HIT for {folder_name}", flush=True)
            return cached[1]
        print(f"[bundle] EpubBundle MISS — parsing {epub_dir}", flush=True)
        bundle = EpubExtractor().parse_dir(epub_dir)
        _EPUB_CACHE[folder_name] = (mtime, bundle)
        return bundle

    # Fallback: extract from the .epub zip (original behaviour)
    epub_path = _find_source(folder_name, "epub")
    if not epub_path or not os.path.isfile(epub_path):
        return None
    mtime = os.path.getmtime(epub_path)
    cached = _EPUB_CACHE.get(folder_name)
    if cached and cached[0] == mtime:
        print(f"[bundle] EpubBundle cache HIT for {folder_name}", flush=True)
        return cached[1]
    print(f"[bundle] EpubBundle MISS — parsing {epub_path}", flush=True)
    # Note: do NOT use context manager — we keep the tmpdir alive for
    # the lifetime of the cached bundle. Extractor's __exit__ would wipe it.
    extractor = EpubExtractor(epub_path)
    bundle = extractor.extract()
    _EPUB_CACHE[folder_name] = (mtime, bundle)
    return bundle


def get_pdf_doc(folder_name: str, max_pages: Optional[int] = None) -> Optional[PdfDoc]:
    pdf_path = _find_source(folder_name, "pdf")
    if not pdf_path or not os.path.isfile(pdf_path):
        return None
    mtime = os.path.getmtime(pdf_path)
    cached = _PDF_CACHE.get(folder_name)
    if cached and cached[0] == mtime:
        print(f"[bundle] PdfDoc cache HIT for {folder_name}", flush=True)
        return cached[1]
    print(f"[bundle] PdfDoc MISS — parsing {pdf_path}", flush=True)
    pdf = PdfParser(pdf_path).parse(max_pages=max_pages)
    _PDF_CACHE[folder_name] = (mtime, pdf)
    return pdf


def get_paths(folder_name: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (epub_path, pdf_path) for the given folder."""
    return _find_source(folder_name, "epub"), _find_source(folder_name, "pdf")
