"""Simple WebDAV endpoints for MS Word desktop integration.

Routes: /files/{file_id}/{mode}/{filename}
Supports: OPTIONS, HEAD, GET, PROPFIND, PUT, LOCK, UNLOCK
"""
import os
import re
import logging
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from email.utils import formatdate

from fastapi import APIRouter, Request, Response, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app import database, models
from app.core.config import get_settings
from app.integrations.wopi import service as wopi_service
from app.integrations.wopi.router import _regen_xhtml_background
from app.integrations.webdav.config import WEBDAV_TOKEN_EXPIRE_MINUTES

settings = get_settings()
router = APIRouter()
logger = logging.getLogger("app.routers.webdav")


def _decode_token(token: str | None):
    if not token:
        return None
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def _extract_lock_token_from_headers(request: Request):
    # Look for Lock-Token header or the If header containing urn:uuid
    lock_token = request.headers.get("Lock-Token")
    if lock_token:
        return lock_token.strip().strip("<>")
    if_header = request.headers.get("If") or request.headers.get("if")
    if if_header:
        m = re.search(r"urn:uuid:([0-9a-fA-F\-]+)", if_header)
        if m:
            return f"urn:uuid:{m.group(1)}"
    return None


@router.options("/files/{file_id}/{mode}/")
@router.options("/files/{file_id}/{mode}")
async def webdav_options_dir(file_id: int, mode: str):
    headers = {
        "DAV": "1,2",
        "MS-Author-Via": "DAV",
        "Allow": "OPTIONS, GET, HEAD, PROPFIND, PUT, LOCK, UNLOCK",
    }
    return Response(status_code=200, headers=headers)


@router.options("/files/{file_id}/{mode}/{filename}")
async def webdav_options(file_id: int, mode: str, filename: str):
    headers = {
        "DAV": "1,2",
        "MS-Author-Via": "DAV",
        "Allow": "OPTIONS, GET, HEAD, PROPFIND, PUT, LOCK, UNLOCK",
    }
    return Response(status_code=200, headers=headers)


def _backfill_lock_owner(file_id: int, token: str | None, db: Session):
    """Word sends the JWT token on HEAD/GET but not on LOCK — backfill owner_user_id here."""
    payload = _decode_token(token)
    if not payload:
        return
    sub = payload.get("sub")
    if not sub:
        return
    user = db.query(models.User).filter(models.User.username == sub).first()
    if not user:
        return
    unowned = (
        db.query(models.WebDAVLock)
        .filter(
            models.WebDAVLock.file_id == file_id,
            models.WebDAVLock.owner_user_id.is_(None),
        )
        .first()
    )
    if unowned:
        unowned.owner_user_id = user.id
        db.commit()


@router.head("/files/{file_id}/{mode}/{filename}")
async def webdav_head(file_id: int, mode: str, filename: str, request: Request, db: Session = Depends(database.get_db)):
    _backfill_lock_owner(file_id, request.query_params.get("token"), db)
    file_record = wopi_service.get_file_record(db, file_id=file_id)
    file_path, fname = wopi_service.get_target_path(file_record, mode=mode)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    stat = os.stat(file_path)
    headers = {
        "Content-Length": str(stat.st_size),
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }
    return Response(status_code=200, headers=headers)


@router.get("/files/{file_id}/{mode}/{filename}")
async def webdav_get(file_id: int, mode: str, filename: str, request: Request, db: Session = Depends(database.get_db)):
    _backfill_lock_owner(file_id, request.query_params.get("token"), db)
    payload = wopi_service.build_file_response_payload(db, file_id=file_id, mode=mode)
    return FileResponse(
        path=payload["path"],
        filename=payload["filename"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.post("/files/{file_id}/{mode}/{filename}")
async def webdav_propfind(file_id: int, mode: str, filename: str, request: Request, db: Session = Depends(database.get_db)):
    return await _handle_propfind(file_id, mode, filename, db)


@router.api_route("/files/{file_id}/{mode}/{filename}", methods=["PROPFIND"])
async def webdav_propfind_explicit(file_id: int, mode: str, filename: str, db: Session = Depends(database.get_db)):
    return await _handle_propfind(file_id, mode, filename, db)


# Directory-level PROPFIND — Word walks up the tree before locking
@router.api_route("/files/{file_id}/{mode}/", methods=["PROPFIND"])
@router.api_route("/files/{file_id}/{mode}", methods=["PROPFIND"])
async def webdav_propfind_dir(file_id: int, mode: str):
    return _collection_propfind(f"/webdav/files/{file_id}/{mode}")


@router.api_route("/files/{file_id}/", methods=["PROPFIND"])
@router.api_route("/files/{file_id}", methods=["PROPFIND"])
async def webdav_propfind_file_root(file_id: int):
    return _collection_propfind(f"/webdav/files/{file_id}")


def _collection_propfind(href: str) -> Response:
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>{href}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>{href.rsplit("/", 1)[-1]}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
"""
    return Response(content=xml, media_type="application/xml", status_code=207)


async def _handle_propfind(file_id: int, mode: str, filename: str, db: Session):
    file_record = wopi_service.get_file_record(db, file_id=file_id)
    file_path, fname = wopi_service.get_target_path(file_record, mode=mode)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    stat = os.stat(file_path)
    rfc1123 = formatdate(stat.st_mtime, usegmt=True)
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/files/{file_id}/{mode}/{fname}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>{fname}</D:displayname>
        <D:getcontentlength>{stat.st_size}</D:getcontentlength>
        <D:getcontenttype>application/vnd.openxmlformats-officedocument.wordprocessingml.document</D:getcontenttype>
        <D:getlastmodified>{rfc1123}</D:getlastmodified>
        <D:resourcetype/>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
"""
    return Response(content=xml, media_type="application/xml", status_code=207)


@router.api_route("/files/{file_id}/{mode}/{filename}", methods=["PROPPATCH"])
async def webdav_proppatch(file_id: int, mode: str, filename: str):
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/webdav/files/{file_id}/{mode}/{filename}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
"""
    return Response(content=xml, media_type="application/xml", status_code=207)


@router.put("/files/{file_id}/{mode}/{filename}")
async def webdav_put(file_id: int, mode: str, filename: str, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(database.get_db)):
    # Authorization: either token query param JWT OR matching active lock
    token = request.query_params.get("token")
    token_payload = _decode_token(token)

    lock_token = _extract_lock_token_from_headers(request)

    allow = False
    if token_payload:
        allow = True
    else:
        if lock_token:
            lock = db.query(models.WebDAVLock).filter(models.WebDAVLock.lock_token == lock_token).first()
            if lock and (not lock.expires_at or lock.expires_at > datetime.now(timezone.utc)):
                allow = True

    if not allow:
        raise HTTPException(status_code=401, detail="Unauthorized WebDAV PUT")

    body = await request.body()
    result = wopi_service.write_file_bytes(
        db,
        file_id=file_id,
        mode=mode,
        body=body,
        logger=logger,
    )

    # Trigger XHTML regen if structuring
    if mode == "structuring" and body:
        background_tasks.add_task(_regen_xhtml_background, file_id=file_id)

    return result


@router.api_route("/files/{file_id}/{mode}/{filename}", methods=["LOCK"])
async def webdav_lock(file_id: int, mode: str, filename: str, request: Request, db: Session = Depends(database.get_db)):
    # Support lock refresh: if client provides existing lock token (If or Lock-Token header),
    # update the existing lock's expiration instead of creating a new lock.
    existing_token = _extract_lock_token_from_headers(request)
    query_token = request.query_params.get("token")
    payload = _decode_token(query_token)
    owner_id = None
    if payload:
        sub = payload.get("sub")
        if sub:
            user = db.query(models.User).filter(models.User.username == sub).first()
            if user:
                owner_id = user.id

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=WEBDAV_TOKEN_EXPIRE_MINUTES)

    if existing_token:
        # Attempt to refresh existing lock
        lock = db.query(models.WebDAVLock).filter(models.WebDAVLock.lock_token == existing_token).first()
        if lock:
            lock.expires_at = expires_at
            lock.last_refresh_at = datetime.now(timezone.utc)
            db.add(lock)
            db.commit()
            token_to_return = lock.lock_token
        else:
            # existing token provided but not found — create a new lock instead
            token_to_return = f"urn:uuid:{uuid4()}"
            lock = models.WebDAVLock(
                file_id=file_id,
                lock_token=token_to_return,
                owner_user_id=owner_id,
                expires_at=expires_at,
                user_agent=request.headers.get("User-Agent"),
                remote_addr=request.client.host if request.client else None,
            )
            db.add(lock)
            db.commit()
    else:
        # No existing token — create a fresh lock
        token_to_return = f"urn:uuid:{uuid4()}"
        lock = models.WebDAVLock(
            file_id=file_id,
            lock_token=token_to_return,
            owner_user_id=owner_id,
            expires_at=expires_at,
            user_agent=request.headers.get("User-Agent"),
            remote_addr=request.client.host if request.client else None,
        )
        db.add(lock)
        db.commit()

    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:timeout>Second-{WEBDAV_TOKEN_EXPIRE_MINUTES * 60}</D:timeout>
      <D:locktoken><D:href>{token_to_return}</D:href></D:locktoken>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>
"""
    return Response(
        content=xml,
        media_type="application/xml",
        status_code=200,
        headers={"Lock-Token": f"<{token_to_return}>"},
    )


@router.api_route("/files/{file_id}/{mode}/{filename}", methods=["UNLOCK"])
async def webdav_unlock(file_id: int, mode: str, filename: str, request: Request, db: Session = Depends(database.get_db)):
    lock_token = _extract_lock_token_from_headers(request)
    if not lock_token:
        # Try to parse body
        body = await request.body()
        m = re.search(rb"urn:uuid:([0-9a-fA-F\-]+)", body)
        if m:
            lock_token = f"urn:uuid:{m.group(1).decode('utf-8')}"

    if lock_token:
        lock = db.query(models.WebDAVLock).filter(models.WebDAVLock.lock_token == lock_token).first()
        if lock:
            db.delete(lock)
            db.commit()

    return Response(status_code=204)
