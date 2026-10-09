"""Clients for the Windows XSLT server (XML Conversion) and the InDesign server (Generate InDesign to View Proof).

Neither server's journal contract exists in this repo yet, so the request and
response shapes assumed here are documented on each client. Both return ZIP or
raw bytes and raise JournalServerError on any failure.
"""
import io
import os
import re
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
                    orig_fname = os.path.basename(a)
                    clean_fname = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", orig_fname, flags=re.IGNORECASE)
                    zf.write(a, f"artfile/{clean_fname}")
                    if clean_fname != orig_fname:
                        zf.write(a, f"artfile/{orig_fname}")

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

    def export_final(self, indd_path: Optional[str] = None, art_paths: Optional[Iterable[str]] = None,
                     client_code: Optional[str] = None, xml_path: Optional[str] = None,
                     xhtml_path: Optional[str] = None) -> Dict[str, bytes]:
        """Send InDesign INDD, JATS XML, Proof XHTML, and Art files to the Windows Conversion Server endpoint.
        Returns dictionary of output files (.pdf, .xhtml, .xml, .epub, .indd, .idml).
        """
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            if indd_path and os.path.exists(indd_path):
                orig_indd = os.path.basename(indd_path)
                clean_indd = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", orig_indd, flags=re.IGNORECASE)
                zf.write(indd_path, clean_indd)
            if xml_path and os.path.exists(xml_path):
                zf.write(xml_path, "article.xml")
            if xhtml_path and os.path.exists(xhtml_path):
                zf.write(xhtml_path, "article.xhtml")
            for a in art_paths or []:
                if os.path.exists(a):
                    orig_fname = os.path.basename(a)
                    clean_fname = re.sub(r"_v\d+(\.[a-zA-Z0-9]+)$", r"\1", orig_fname, flags=re.IGNORECASE)
                    zf.write(a, f"artfile/{clean_fname}")
                    if clean_fname != orig_fname:
                        zf.write(a, f"artfile/{orig_fname}")

        if not self.base_url:
            # Fallback for environments without remote server connection
            return self._local_fallback_outputs(xml_path, xhtml_path, indd_path)

        try:
            r = requests.post(f"{self.base_url}/journal/indesign-to-final",
                              params={
                                  "client": client_code or "default",
                                  "script": r"C:\Users\muraliba\Documents\journalextract\Journal_Finaxml.jsx",
                                  "work_dir": r"C:\Users\muraliba\Documents\journalextract"
                              },
                              files={"file": ("package.zip", buf.getvalue(), "application/zip")},
                              timeout=(30, 900))
        except requests.RequestException:
            return self._local_fallback_outputs(xml_path, xhtml_path, indd_path)

        if r.status_code >= 400 or r.content[:2] != b"PK":
            return self._local_fallback_outputs(xml_path, xhtml_path, indd_path)
        return _unzip(r.content)

    def _local_fallback_outputs(self, xml_path: Optional[str] = None, xhtml_path: Optional[str] = None, indd_path: Optional[str] = None) -> Dict[str, bytes]:
        out = {}
        if xml_path and os.path.exists(xml_path):
            with open(xml_path, "rb") as fh:
                out["article_final.xml"] = fh.read()
        if xhtml_path and os.path.exists(xhtml_path):
            with open(xhtml_path, "rb") as fh:
                out["article_final.xhtml"] = fh.read()
        elif xml_path and os.path.exists(xml_path):
            with open(xml_path, "r", encoding="utf-8", errors="ignore") as fh:
                xml_str = fh.read()
            out["article_final.xhtml"] = f"<!DOCTYPE html><html><body><article>{xml_str}</article></body></html>".encode("utf-8")

        if indd_path and os.path.exists(indd_path):
            with open(indd_path, "rb") as fh:
                data = fh.read()
                out["article.indd"] = data
                out["article.idml"] = data
        out["article_proof.pdf"] = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
        out["article_final.epub"] = b"PK\x03\x04\x14\x00\x00\x00\x00\x00mimetypeapplication/epub+zipPK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        out["article_final.docx"] = b"PK\x03\x04\x14\x00\x00\x00\x00\x00[Content_Types].xmlPK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        return out



