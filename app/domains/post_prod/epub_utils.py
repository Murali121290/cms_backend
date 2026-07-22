"""
epub_utils.py
-------------
Read-only helpers for pulling what we need out of an .epub (which is just a
ZIP): the embedded stylesheet(s), the list of packaged files, and the set of
class names actually referenced by the XHTML content.

Also implements the package-level checks that don't live inside the EPUB at
all - most importantly the "frontlist.csv" sidecar check (internal find #1).
"""

from __future__ import annotations

import io
import posixpath
import re
import zipfile
from dataclasses import dataclass, field


# --------------------------------------------------------------------------- #
# Encoding-aware text reading
# --------------------------------------------------------------------------- #

def decode_bytes(raw: bytes) -> tuple:
    """Return (text, encoding, is_utf8). Tries UTF-8 first, then CP1252/Latin-1.

    EPUB/HTML spec expects UTF-8. A stylesheet that only decodes as CP1252 is a
    real production defect (typically a stray en-dash/curly-quote byte) that
    breaks on strict readers, so we surface which encoding actually worked.
    """
    for enc in ("utf-8", "utf-8-sig"):
        try:
            return raw.decode(enc), "utf-8", True
        except UnicodeDecodeError:
            pass
    for enc in ("cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc, False
        except UnicodeDecodeError:
            continue
    # last resort: never throw
    return raw.decode("utf-8", errors="replace"), "utf-8(replaced)", False


def first_non_utf8_offset(raw: bytes) -> int:
    try:
        raw.decode("utf-8")
        return -1
    except UnicodeDecodeError as e:
        return e.start


# --------------------------------------------------------------------------- #
# EPUB model
# --------------------------------------------------------------------------- #

@dataclass
class StyleSheet:
    path: str
    text: str
    encoding: str
    is_utf8: bool
    bad_byte_offset: int


@dataclass
class EpubInfo:
    filenames: list = field(default_factory=list)
    stylesheets: list = field(default_factory=list)      # list[StyleSheet]
    used_classes: set = field(default_factory=set)
    opf_path: str = ""
    title: str = ""
    identifier: str = ""


CLASS_ATTR_RE = re.compile(r'class\s*=\s*"(.*?)"', re.IGNORECASE | re.DOTALL)
CLASS_ATTR_RE_SQ = re.compile(r"class\s*=\s*'(.*?)'", re.IGNORECASE | re.DOTALL)


def load_epub(data: bytes) -> EpubInfo:
    info = EpubInfo()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        info.filenames = [n for n in zf.namelist() if not n.endswith("/")]

        for name in info.filenames:
            lower = name.lower()
            if lower.endswith(".css"):
                raw = zf.read(name)
                text, enc, is_utf8 = decode_bytes(raw)
                info.stylesheets.append(
                    StyleSheet(
                        path=name,
                        text=text,
                        encoding=enc,
                        is_utf8=is_utf8,
                        bad_byte_offset=first_non_utf8_offset(raw),
                    )
                )
            elif lower.endswith(".opf"):
                info.opf_path = name
                opf_text, _, _ = decode_bytes(zf.read(name))
                info.title = _first_group(
                    re.search(r"<dc:title[^>]*>(.*?)</dc:title>", opf_text, re.S)
                )
                info.identifier = _first_group(
                    re.search(r"<dc:identifier[^>]*>(.*?)</dc:identifier>", opf_text, re.S)
                )
            elif lower.endswith((".xhtml", ".html", ".htm")):
                content, _, _ = decode_bytes(zf.read(name))
                for m in CLASS_ATTR_RE.finditer(content):
                    info.used_classes.update(m.group(1).split())
                for m in CLASS_ATTR_RE_SQ.finditer(content):
                    info.used_classes.update(m.group(1).split())

    return info


def _first_group(match) -> str:
    return re.sub(r"\s+", " ", match.group(1)).strip() if match else ""


# --------------------------------------------------------------------------- #
# Package-level (sidecar) checks - internal find #1
# --------------------------------------------------------------------------- #

DEFAULT_SIDECARS = ["frontlist.csv"]


@dataclass
class SidecarCheck:
    name: str
    found: bool
    location: str  # "package" | "beside-epub" | "missing"


def check_sidecars(package_filenames, expected=None) -> list:
    """Check for delivery files that ship *alongside* the EPUB, not inside it.

    ``package_filenames`` is whatever the caller knows about the delivery
    folder (e.g. the other files the user selected/typed). frontlist.csv is a
    BoD delivery manifest; it is never inside the .epub, so 'missing' here means
    'not present in the delivery package'.
    """
    expected = expected or DEFAULT_SIDECARS
    have = {posixpath.basename(f).lower() for f in package_filenames}
    out = []
    for name in expected:
        found = name.lower() in have
        out.append(
            SidecarCheck(
                name=name,
                found=found,
                location="beside-epub" if found else "missing",
            )
        )
    return out
