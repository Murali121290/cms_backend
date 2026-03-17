import hashlib
import os
import urllib.parse
from datetime import datetime

from fastapi import HTTPException, Response
from sqlalchemy.orm import Session

from app.models import File


def get_file_record(
    db: Session,
    *,
    file_id: int,
    detail: str | None = "File not found",
    bare_404: bool = False,
):
    file_record = db.query(File).filter(File.id == file_id).first()
    if not file_record:
        if bare_404:
            raise HTTPException(status_code=404)
        raise HTTPException(status_code=404, detail=detail)
    return file_record


def get_target_path(file_record: File, mode: str = "original"):
    """
    Return the path to edit based on mode.
    mode='original': Edit the file at file_record.path
    mode='structuring': Edit the _Processed.docx version
    """
    original_path = file_record.path

    if mode == "structuring":
        if original_path.endswith("_Processed.docx"):
            return original_path, os.path.basename(original_path)
        dir_name = os.path.dirname(original_path)
        base_name = os.path.basename(original_path)
        name_only = os.path.splitext(base_name)[0]
        processed_filename = f"{name_only}_Processed.docx"
        processed_path = os.path.join(dir_name, processed_filename)
        return processed_path, processed_filename

    return original_path, os.path.basename(original_path)


def build_editor_page_state(
    db: Session,
    *,
    file_id: int,
    collabora_public_url: str,
    wopi_base_url: str,
):
    file_record = get_file_record(db, file_id=file_id, detail="File not found")
    wopi_src = f"{wopi_base_url}/wopi/files/{file_id}"
    wopi_src_encoded = urllib.parse.quote(wopi_src, safe="")
    collabora_url = (
        f"{collabora_public_url}/browser/dist/cool.html"
        f"?WOPISrc={wopi_src_encoded}"
        f"&lang=en"
    )
    return {
        "file": file_record,
        "filename": os.path.basename(file_record.path),
        "collabora_url": collabora_url,
    }


def _ensure_target_exists(
    *,
    file_record: File,
    mode: str,
    missing_detail: str | None,
    bare_404: bool = False,
):
    file_path, filename = get_target_path(file_record, mode=mode)
    if not os.path.exists(file_path):
        if bare_404:
            raise HTTPException(status_code=404)
        raise HTTPException(status_code=404, detail=missing_detail)
    return file_path, filename


def build_check_file_info_payload(
    db: Session,
    *,
    file_id: int,
    mode: str,
):
    if mode == "structuring":
        file_record = get_file_record(db, file_id=file_id, detail=None, bare_404=True)
        file_path, filename = _ensure_target_exists(
            file_record=file_record,
            mode="structuring",
            missing_detail=None,
            bare_404=True,
        )
        stat = os.stat(file_path)
        with open(file_path, "rb") as handle:
            sha = hashlib.sha256(handle.read()).hexdigest()

        return {
            "BaseFileName": filename,
            "Size": stat.st_size,
            "LastModifiedTime": datetime.utcfromtimestamp(stat.st_mtime).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "Version": sha[:16],
            "OwnerId": str(file_record.project_id or "cms"),
            "UserId": "cms-user",
            "UserFriendlyName": "CMS User",
            "UserCanWrite": True,
            "SupportsUpdate": True,
        }

    file_record = get_file_record(db, file_id=file_id, detail="File not found")
    file_path, filename = _ensure_target_exists(
        file_record=file_record,
        mode="original",
        missing_detail="File not found on disk",
    )
    stat = os.stat(file_path)
    with open(file_path, "rb") as handle:
        sha = hashlib.sha256(handle.read()).hexdigest()

    return {
        "BaseFileName": filename,
        "Size": stat.st_size,
        "LastModifiedTime": datetime.utcfromtimestamp(stat.st_mtime).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "Version": sha[:16],
        "OwnerId": str(file_record.project_id or "cms"),
        "UserId": "cms-user",
        "UserFriendlyName": "CMS User",
        "UserCanWrite": True,
        "UserCanNotWriteRelative": True,
        "SupportsUpdate": True,
        "SupportsLocks": False,
        "DisableExport": False,
        "DisablePrint": False,
        "HideSaveOption": False,
    }


def build_file_response_payload(
    db: Session,
    *,
    file_id: int,
    mode: str,
):
    if mode == "structuring":
        file_record = get_file_record(db, file_id=file_id, detail=None, bare_404=True)
        file_path, filename = _ensure_target_exists(
            file_record=file_record,
            mode="structuring",
            missing_detail=None,
            bare_404=True,
        )
        return {"path": file_path, "filename": filename}

    file_record = get_file_record(db, file_id=file_id, detail="File not found")
    # Preserve current route behavior: original GetFile performs the lookup twice.
    file_record = get_file_record(db, file_id=file_id, detail="File not found")
    file_path, filename = _ensure_target_exists(
        file_record=file_record,
        mode="original",
        missing_detail="File not found",
    )
    return {"path": file_path, "filename": filename}


def write_file_bytes(
    db: Session,
    *,
    file_id: int,
    mode: str,
    body: bytes,
    logger,
):
    if mode == "structuring":
        file_record = get_file_record(db, file_id=file_id, detail=None, bare_404=True)
        file_path, filename = get_target_path(file_record, mode="structuring")

        if not body:
            return Response(status_code=200)

        try:
            with open(file_path, "wb") as handle:
                handle.write(body)
            logger.info(f"WOPI PutFile (Structuring): saved {filename}")
            return Response(status_code=200)
        except Exception as exc:
            logger.error(f"Error: {exc}")
            raise HTTPException(status_code=500, detail=str(exc))

    file_record = get_file_record(db, file_id=file_id, detail="File not found")
    file_path, filename = get_target_path(file_record, mode="original")

    if not body:
        return Response(status_code=200)

    try:
        with open(file_path, "wb") as handle:
            handle.write(body)
        logger.info(f"WOPI PutFile: saved {filename} ({len(body)} bytes)")
        return Response(status_code=200)
    except Exception as exc:
        logger.error(f"WOPI PutFile error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))
