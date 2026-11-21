"""Backlist Hub: EOC/EOL question-file validator (report only)."""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.domains.auth.rbac_config import has_post_prod_access
from app.domains.auth.security import get_current_user_from_cookie

from .parser import parse_docx
from .report import build_report, to_csv, to_xlsx
from .rules import ERROR, Issue

logger = logging.getLogger("app.post_prod.eoc_validator")

MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_FILES = 300
PREFIX_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

router = APIRouter(prefix="/eoc-validator", tags=["EOC Validator"])


def check_post_prod_access(user=Depends(get_current_user_from_cookie)):
    if not user or not has_post_prod_access(user):
        raise HTTPException(status_code=403, detail="Access denied to Post Production / Backlist.")
    return user


def _collect_docx(uploads: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    for name, data in uploads:
        low = name.lower()
        if low.endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    for info in z.infolist():
                        base = os.path.basename(info.filename)
                        if info.is_dir() or not base.lower().endswith(".docx") or base.startswith(("~$", ".")) or "__MACOSX" in info.filename:
                            continue
                        out.append((base, z.read(info)))
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail=f"'{name}' is not a valid ZIP file.")
        elif low.endswith(".docx"):
            if os.path.basename(name).startswith("~$"):
                continue
            out.append((os.path.basename(name), data))
        else:
            raise HTTPException(status_code=400, detail=f"'{name}' is not a .docx or .zip file.")
    return out


async def _read_request(files: list[UploadFile], reference_prefix: str, require_prefix: bool = True) -> tuple[str, list[tuple[str, bytes]]]:
    prefix = reference_prefix.strip()
    if require_prefix:
        if not prefix or not PREFIX_RE.match(prefix):
            raise HTTPException(status_code=400, detail="Reference prefix is required (letters, digits, '_' or '-' only), e.g. machfund2028_eoc.")
    elif not prefix or not PREFIX_RE.match(prefix):
        prefix = "alt_text"

    uploads: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Upload exceeds the 100 MB limit.")
        uploads.append((f.filename or "upload", data))

    docs = _collect_docx(uploads)
    if not docs:
        raise HTTPException(status_code=400, detail="No .docx files found in the upload.")
    if len(docs) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Too many files ({len(docs)}); the limit is {MAX_FILES}.")
    return prefix, docs


@router.post("/fix")
async def fix(
    files: list[UploadFile] = File(...),
    reference_prefix: str = Form(...),
    user=Depends(check_post_prod_access),
):
    """Validate, apply safe fixes as Word tracked changes, and re-validate.

    Returns the issues still open (on the corrected files, read as if the
    changes were accepted), the list of applied fixes, the before-fix totals,
    and a ZIP with the corrected .docx files + an Excel change log.
    Originals are never modified."""
    from .fixer import AlreadyTrackedError, fix_docx
    from .rules import check_run

    prefix, docs = await _read_request(files, reference_prefix)
    author = (getattr(user, "username", None) or "EOC Validator").strip() or "EOC Validator"

    before_parsed, parsed, fixes, skipped = [], [], [], []
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in docs:
            try:
                before_parsed.append(parse_docx(data, name))
            except Exception as exc:
                skipped.append(Issue(name, None, None, "F1", ERROR, f"File could not be read as a Word document: {exc}"))
                continue
            try:
                fixed, file_fixes = fix_docx(data, name, prefix, author=author)
            except AlreadyTrackedError as exc:
                skipped.append(Issue(name, None, None, "F1", ERROR, f"Not corrected: {exc}"))
                fixed, file_fixes = data, []
            except Exception as exc:
                logger.warning("EOC fixer could not process %s: %s", name, exc)
                skipped.append(Issue(name, None, None, "F1", ERROR, f"Not corrected (copied unchanged): {exc}"))
                fixed, file_fixes = data, []
            z.writestr(f"corrected/{name}", fixed)
            fixes.extend(f.to_dict() for f in file_fixes)
            parsed.append(parse_docx(fixed, name))
        before = build_report(before_parsed, check_run(before_parsed, prefix), prefix)
        remaining = check_run(parsed, prefix) + skipped
        report = build_report(parsed, remaining, prefix)
        fixes_by_file: dict[str, int] = {}
        for f in fixes:
            fixes_by_file[f["file"]] = fixes_by_file.get(f["file"], 0) + 1
        for row in report["files"]:
            row["fixes"] = fixes_by_file.get(row["file"], 0)
        z.writestr("EOC_Correction_Report.xlsx", to_xlsx(report, fixes))

    return JSONResponse({
        "mode": "fix",
        "report": report,
        "before_totals": before["totals"],
        "fixes": fixes,
        "author": author,
        "artifacts": {
            "csv": to_csv(report),
            "xlsx_base64": base64.b64encode(to_xlsx(report, fixes)).decode("ascii"),
            "zip_base64": base64.b64encode(zbuf.getvalue()).decode("ascii"),
            "zip_name": f"{re.sub(r'[^A-Za-z0-9_-]', '', prefix) or 'eoc'}_corrected.zip",
        },
    })


@router.post("/analyze")
async def analyze(
    files: list[UploadFile] = File(...),
    reference_prefix: str = Form(""),
    mode: str = Form("validate"),
    user=Depends(check_post_prod_access),
):
    from .rules import check_run, check_alt_text_run

    is_alt_text = (mode == "alt_text")
    prefix, docs = await _read_request(files, reference_prefix, require_prefix=not is_alt_text)

    parsed = []
    unreadable: list[Issue] = []
    for name, data in docs:
        try:
            parsed.append(parse_docx(data, name))
        except Exception as exc:  # corrupt / not really a docx
            logger.warning("EOC validator could not read %s: %s", name, exc)
            unreadable.append(Issue(name, None, None, "IMG1" if is_alt_text else "F1", ERROR, f"File could not be read as a Word document: {exc}"))

    if is_alt_text:
        issues = check_alt_text_run(parsed) + unreadable
        report = build_report(parsed, issues, prefix, mode="alt_text")
    else:
        issues = check_run(parsed, prefix) + unreadable
        report = build_report(parsed, issues, prefix, mode="validate")

    for i in unreadable:
        report["files"].append({
            "file": i.file,
            "chapter": None,
            "questions": 0,
            "mc": 0,
            "tf": 0,
            "shuffle_lines": 0,
            "images": 0,
            "has_alt": 0,
            "missing_alt": 0,
            "errors": 1,
            "warnings": 0,
            "info": 0,
            "status": "fail",
        })

    return JSONResponse({
        "mode": mode,
        "report": report,
        "artifacts": {
            "csv": to_csv(report),
            "xlsx_base64": base64.b64encode(to_xlsx(report)).decode("ascii"),
        },
    })
