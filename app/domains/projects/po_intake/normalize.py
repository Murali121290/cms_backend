"""Shared value-cleanup helpers for PO/RFQ field extraction.

Every parser produces raw strings straight off a customer form. These forms are full of
placeholder tokens ("N/A", "0", "Select", blank cells) instead of real data, and dates/ISBNs/
editions show up in a handful of inconsistent shapes. Centralizing the cleanup here keeps the
per-template parsers focused on *where* a value lives, not how to sanitize it.
"""
from __future__ import annotations

import re
from datetime import date, datetime

_PLACEHOLDER_TOKENS = {"", "0", "n/a", "na", "select", "none", "-", "--", "tbd", "to come"}


def decode(value) -> str | None:
    """Coerce a pdfplumber annotation value (bytes / PSLiteral / str) to plain text."""
    if value is None:
        return None
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("latin-1", errors="replace")
    text = str(value)
    if text.startswith("/"):
        text = text[1:]
    return text


def clean(value) -> str | None:
    """Decode + strip a raw cell/field value; collapse known placeholder tokens to None."""
    text = decode(value)
    if text is None:
        return None
    text = re.sub(r"\s+", " ", text).strip()
    if not text or text.casefold() in _PLACEHOLDER_TOKENS:
        return None
    # Unfilled name/address fields on these forms default to repeated "0" tokens
    # (e.g. a blank "First Last" pair renders as "0 0") — treat that as blank too.
    if re.fullmatch(r"0(\s+0)*", text):
        return None
    return text


def normalize_isbn(raw) -> tuple[str | None, str | None]:
    """Returns (isbn, warning). Only returns a value that passes the 10/13-char CMS regex."""
    text = clean(raw)
    if text is None:
        return None, None
    candidate = re.sub(r"[\s-]", "", text)
    if re.fullmatch(r"[0-9]{9}[0-9Xx]", candidate) or re.fullmatch(r"[0-9]{13}", candidate):
        return candidate.upper(), None
    return None, f"Found ISBN-like value '{text}' but it isn't a valid 10/13-character ISBN — please enter it manually."


_ORDINAL_SUFFIX = {1: "st", 2: "nd", 3: "rd"}


def normalize_edition(raw) -> str | None:
    text = clean(raw)
    if text is None:
        return None
    if re.fullmatch(r"\d+", text):
        n = int(text)
        suffix = _ORDINAL_SUFFIX.get(n if n < 20 else n % 10, "th")
        if 11 <= n % 100 <= 13:
            suffix = "th"
        return f"{n}{suffix} Edition"
    return text


def to_int(raw) -> int | None:
    text = clean(raw)
    if text is None:
        return None
    match = re.search(r"-?\d+", text.replace(",", ""))
    return int(match.group()) if match else None


_DATE_FORMATS = ("%m/%d/%Y", "%m/%d/%y")


def parse_date_loose(raw) -> tuple[str | None, str | None]:
    """Returns (iso_date, warning). Refuses to guess a year that isn't in the source text."""
    if isinstance(raw, datetime):
        return raw.date().isoformat(), None
    if isinstance(raw, date):
        return raw.isoformat(), None

    text = clean(raw)
    if text is None:
        return None, None

    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        # Excel serial date (1900 date system)
        try:
            from datetime import timedelta
            d = date(1899, 12, 30) + timedelta(days=float(raw))
            return d.isoformat(), None
        except (ValueError, OverflowError):
            return None, f"Could not parse Excel date serial '{raw}'."

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat(), None
        except ValueError:
            continue

    if re.fullmatch(r"\d{1,2}/\d{4}", text):
        month, year = text.split("/")
        return date(int(year), int(month), 1).isoformat(), None

    if re.fullmatch(r"\d{4}", text):
        return date(int(text), 1, 1).isoformat(), None

    if re.fullmatch(r"\d{1,2}/\d{1,2}", text):
        return None, f"Date '{text}' has no year on the source form — set it manually."

    return None, f"Could not parse date value '{text}' — set it manually."
