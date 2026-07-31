import glob
import os
import re
from pathlib import Path

import yaml
from bs4 import BeautifulSoup

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "customers.yaml"

_config_cache: dict | None = None


def _load_config() -> dict:
    global _config_cache
    if _config_cache is None:
        if not _CONFIG_PATH.is_file():
            _config_cache = {"customers": {}, "default_customer": None}
        else:
            with _CONFIG_PATH.open("r", encoding="utf-8") as f:
                _config_cache = yaml.safe_load(f) or {}
    return _config_cache


def _find_opf(epub_root: str) -> str | None:
    matches = glob.glob(os.path.join(epub_root, "**", "*.opf"), recursive=True)
    return matches[0] if matches else None


def _read_opf_metadata(opf_path: str) -> tuple[str | None, str | None]:
    """Return (publisher, identifier) as strings, or (None, None) on parse error."""
    try:
        with open(opf_path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "xml")
    except Exception:
        return None, None
    pub = soup.find("dc:publisher")
    ident = soup.find("dc:identifier")
    publisher = pub.get_text(strip=True) if pub else None
    identifier = ident.get_text(strip=True) if ident else None
    return publisher, identifier


_ISBN_DIGITS_RE = re.compile(r"\d+")


def _isbn_matches_prefix(identifier: str | None, prefixes: list[str]) -> bool:
    if not identifier or not prefixes:
        return False
    digits = "".join(_ISBN_DIGITS_RE.findall(identifier))
    return any(digits.startswith(p) for p in prefixes)


def detect(epub_root: str) -> str | None:
    """Return the customer key (e.g. "aspen") or None if no rule matches."""
    cfg = _load_config()
    customers = cfg.get("customers", {}) or {}
    if not customers:
        return cfg.get("default_customer")

    opf = _find_opf(epub_root)
    if not opf:
        return cfg.get("default_customer")

    publisher, identifier = _read_opf_metadata(opf)

    for key, entry in customers.items():
        if not entry.get("enabled", False):
            continue
        detection = entry.get("detection", {}) or {}
        pubs = detection.get("publisher") or []
        isbns = detection.get("isbn_prefix") or []
        if publisher and any(p.strip().lower() == publisher.strip().lower() for p in pubs):
            return key
        if _isbn_matches_prefix(identifier, isbns):
            return key

    return cfg.get("default_customer")
