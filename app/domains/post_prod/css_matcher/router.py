"""CSS Matcher router for EPUB CSS analysis and validation."""

import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse

from app.domains.auth.security import get_current_user_from_cookie
from . import load_epub, decode_bytes, build_report, to_html, to_csv

MAX_CSS_MATCHER_BYTES = 80 * 1024 * 1024  # 80 MB guard

router = APIRouter(prefix="/css-matcher", tags=["CSS Matcher"])


@router.post("/analyze")
async def analyze_css(
    epub: UploadFile = File(...),
    master_css: UploadFile = File(...),
    package_files: str = Form(""),          # comma/newline separated filenames in the delivery folder
    expected_sidecars: str = Form(""),
    user=Depends(get_current_user_from_cookie)
):
    """
    Analyze CSS inconsistencies in EPUB files.

    Compares EPUB stylesheets against a master CSS reference and generates
    detailed reports in JSON, HTML, and CSV formats.

    Args:
        epub: EPUB file to analyze
        master_css: Reference CSS file for comparison
        package_files: Expected delivery package files (comma/newline separated)
        expected_sidecars: Additional expected sidecar files
        user: Authenticated user

    Returns:
        JSON response with report and artifacts (HTML, CSV, JSON)
    """
    epub_bytes = await epub.read()
    css_bytes = await master_css.read()

    if not epub_bytes or not css_bytes:
        raise HTTPException(status_code=400, detail="Both an EPUB and a master CSS file are required.")
    if len(epub_bytes) > MAX_CSS_MATCHER_BYTES:
        raise HTTPException(status_code=413, detail="EPUB exceeds the 80 MB limit.")

    if not epub.filename.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="First file must be a .epub")

    try:
        epub_info = load_epub(epub_bytes)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read EPUB as a ZIP archive: {exc}")

    if not epub_info.stylesheets:
        raise HTTPException(status_code=422, detail="No .css stylesheet found inside the EPUB.")

    master_text, _, _ = decode_bytes(css_bytes)

    pkg = [p.strip() for p in package_files.replace(",", "\n").splitlines() if p.strip()]
    # the uploaded epub is itself part of the delivery package
    pkg.append(epub.filename)
    expected = [s.strip() for s in expected_sidecars.replace(",", "\n").splitlines() if s.strip()]

    report = build_report(
        epub_info,
        master_text,
        package_filenames=pkg,
        expected_sidecars=expected or None,
        epub_bytes=epub_bytes,
    )

    return JSONResponse(
        {
            "report": report,
            "artifacts": {
                "html": to_html(report),
                "csv": to_csv(report),
                "json": json.dumps(report, indent=2, ensure_ascii=False),
            },
        }
    )
