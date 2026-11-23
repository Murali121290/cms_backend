"""Signed per-user access tokens for the document editors (Collabora/WOPI and OnlyOffice save callbacks).

Before this, the WOPI endpoints trusted every caller and always answered UserCanWrite=True, so anyone who could
reach the URL could overwrite a chapter file. Now the page that opens the editor (the user is logged in there)
issues a token naming the user and the file; saves are accepted only with a valid token whose user may write
the chapter right now (assignee, stage owner or Admin — app.domains.workflow.access.can_write_chapter).
"""
from __future__ import annotations

import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domains.auth.models import User

settings = get_settings()

TOKEN_HOURS = 12
_AUDIENCE = "cms-editor"


def can_write_file(db: Session, user: Optional[User], file_id: int) -> bool:
    from app.domains.workflow import access
    from app.models import File
    from app.domains.workflow.models import ChapterInfo

    rec = db.get(File, file_id)
    if rec is None or not rec.chapter_id:
        return user is not None or rec is None  # files outside chapters: unchanged behaviour
    chapter = db.get(ChapterInfo, rec.chapter_id)
    if chapter is not None and not chapter.stage_name and not chapter.current_assignee_name:
        return True                              # chapter outside the stage workflow: unchanged behaviour
    if user is None:
        return False
    return access.can_write_chapter(db, user, chapter)


def issue(db: Session, user: User, file_id: int) -> str:
    claims = {
        "sub": user.username,
        "fid": int(file_id),
        "aud": _AUDIENCE,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def read(db: Session, token: Optional[str], file_id: int) -> Optional[User]:
    """The user a token was issued to, if it is valid for this file; otherwise None."""
    if not token:
        return None
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], audience=_AUDIENCE)
    except JWTError:
        return None
    if claims.get("fid") != int(file_id):
        return None
    return db.query(User).filter(User.username == claims.get("sub")).first()


def with_token(url: str, token: Optional[str]) -> str:
    if not token:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}access_token={urllib.parse.quote(token, safe='')}"


def collabora_url(collabora_public_url: str, wopi_src: str, token: Optional[str]) -> str:
    """cool.html URL; the token rides both on WOPISrc and as access_token so Collabora sends it on every call."""
    src = urllib.parse.quote(with_token(wopi_src, token), safe="")
    url = f"{collabora_public_url}/browser/dist/cool.html?WOPISrc={src}&lang=en"
    return with_token(url, token)
