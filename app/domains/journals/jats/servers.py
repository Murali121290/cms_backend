"""Clients for the Windows XSLT server (XML Conversion) and the InDesign server (Generate InDesign to View Proof).

Neither server's journal contract exists in this repo yet, so the request and
response shapes assumed here are documented on each client. Both return ZIP or
raw bytes and raise JournalServerError on any failure.
"""
import io
import os
import time
import zipfile
from typing import Dict, Iterable, Optional

import requests

from app.core.config import get_settings


class JournalServerError(Exception):
    pass


def _unzip(data: bytes) -> Dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {os.path.basename(n): zf.read(n) for n in zf.namelist() if not n.endswith("/") and not os.path.basename(n).startswith(".")}


class JatsXsltClient:
    """POST {JATS_XSLT_URL}/convert or /journal/docx-to-xml, multipart field "file" = DOCX.

    The response is either the JATS XML itself or a ZIP containing one .xml file.
    If the server is unavailable or fails, caller falls back to local converter.
    """

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[int] = None):
        s = get_settings()
        url = base_url if base_url is not None else (s.JATS_XSLT_URL or s.INDESIGN_SERVER_URL or "")
        self.base_url = url.rstrip("/")
        self.xslt = s.JATS_XSLT_NAME
        self.timeout = timeout or s.JATS_XSLT_TIMEOUT_SECONDS

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def convert(self, docx_path: str) -> bytes:
        if not self.base_url:
            raise JournalServerError("XSLT / Conversion server URL is not configured")

        endpoints = ["/journal/docx-to-xml", "/convert-docx-to-xml", "/convert"]
        last_error = None
        for ep in endpoints:
            try:
                with open(docx_path, "rb") as fh:
                    r = requests.post(f"{self.base_url}{ep}", files={"file": (os.path.basename(docx_path), fh)},
                                      data={"xslt": self.xslt}, timeout=(15, self.timeout))
                if r.status_code < 400:
                    body = r.content
                    if body[:2] == b"PK":
                        xml = [v for k, v in _unzip(body).items() if k.lower().endswith(".xml")]
                        if not xml:
                            raise JournalServerError("XSLT server ZIP contained no .xml file")
                        return xml[0]
                    if b"<article" in body[:4000] or b"<?xml" in body[:4000]:
                        return body
                else:
                    last_error = f"HTTP {r.status_code}: {r.text[:200]}"
            except requests.RequestException as e:
                last_error = str(e)
                continue

        raise JournalServerError(f"Word-to-XML Windows conversion server unreachable or failed: {last_error}")



class JournalInDesignClient:
    """POST {INDESIGN_SERVER_URL}{JOURNAL_INDESIGN_ENDPOINT}?client=<code>&type=journal

    Multipart field "file" = ZIP of article.xml, template/<template>, artfile/<images>.
    The response is a ZIP; this pipeline reads .indd, .idml, .pdf and an optional
    preflight.json ({"overset_frames": n, "missing_fonts": [...], "low_res_images": [...]}).
    Calls are serialised with the book pipeline through the shared Redis lock.
    """

    LOCK_NAME = "indesign_conversion_lock"

    def __init__(self):
        s = get_settings()
        self.base_url = (s.INDESIGN_SERVER_URL or "").rstrip("/")
        self.endpoint = s.JOURNAL_INDESIGN_ENDPOINT
        self.redis_url = s.REDIS_URL

    def _lock(self):
        import redis
        return redis.from_url(self.redis_url).lock(self.LOCK_NAME, timeout=1200)

    def generate(self, xml_path: str, template_path: str, art_paths: Iterable[str], client_code: str,
                 wait_seconds: int = 1800, design_files: Optional[Iterable[str]] = None) -> Dict[str, bytes]:
        if not self.base_url:
            raise JournalServerError("INDESIGN_SERVER_URL is not configured")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(xml_path, "article.xml")
            zf.write(template_path, f"template/{os.path.basename(template_path)}")
            for d in design_files or []:  # fonts and libraries from the journal design pack
                if os.path.exists(d):
                    zf.write(d, f"template/{'fonts/' if d.lower().endswith(('.otf', '.ttf', '.ttc')) else ''}{os.path.basename(d)}")
            for a in art_paths:
                if os.path.exists(a):
                    zf.write(a, f"artfile/{os.path.basename(a)}")

        lock = self._lock()
        deadline = time.monotonic() + wait_seconds
        while not lock.acquire(blocking=False):
            if time.monotonic() > deadline:
                raise JournalServerError("Timed out waiting for the InDesign server (another job holds the lock)")
            time.sleep(2)
        try:
            r = requests.post(f"{self.base_url}{self.endpoint}", params={"client": client_code, "type": "journal"},
                              files={"file": ("package.zip", buf.getvalue(), "application/zip")}, timeout=(30, 900))
        except requests.RequestException as e:
            raise JournalServerError(f"InDesign server unreachable: {e}") from e
        finally:
            try:
                lock.release()
            except Exception:
                pass
        if r.status_code >= 400:
            raise JournalServerError(f"InDesign server returned HTTP {r.status_code}: {r.text[:300]}")
        if r.content[:2] != b"PK":
            raise JournalServerError("InDesign server did not return a ZIP")
        return _unzip(r.content)

    def export_final(self, indd_path: str, art_paths: Optional[Iterable[str]] = None,
                     client_code: Optional[str] = None) -> Dict[str, bytes]:
        """Process 3: Send .indd layout package to /journal/indesign-to-final and return final delivery outputs."""
        if not self.base_url:
            raise JournalServerError("INDESIGN_SERVER_URL is not configured")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(indd_path, os.path.basename(indd_path))
            for a in art_paths or []:
                if os.path.exists(a):
                    zf.write(a, f"artfile/{os.path.basename(a)}")
        try:
            r = requests.post(f"{self.base_url}/journal/indesign-to-final",
                              params={"client": client_code or "default"},
                              files={"file": ("package.zip", buf.getvalue(), "application/zip")},
                              timeout=(30, 900))
        except requests.RequestException as e:
            raise JournalServerError(f"InDesign server unreachable: {e}") from e
        if r.status_code >= 400:
            raise JournalServerError(f"InDesign server returned HTTP {r.status_code}: {r.text[:300]}")
        if r.content[:2] != b"PK":
            raise JournalServerError("InDesign server did not return a ZIP")
        return _unzip(r.content)


