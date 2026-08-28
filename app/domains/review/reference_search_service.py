"""Thin service layer that exposes the legacy PubMed / CrossRef helpers to the
Reference Review UI.

The heavy lifting (HTTP retries, caching, XML parsing, similarity scoring) lives
in `app.processing.legacy.ReferencesStructing`. This module just returns
UI-shaped results (title / authors / year / journal / DOI / formatted citation).
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.processing.legacy import ReferencesStructing as rs

logger = logging.getLogger(__name__)


# ---------- helpers ----------

def _first(seq):
    if not seq: return ""
    return seq[0] if isinstance(seq, list) else seq


def _year_from_item(item: dict) -> str:
    for key in ("issued", "published-print", "published-online", "created"):
        dp = (item.get(key) or {}).get("date-parts") or []
        if dp and dp[0] and dp[0][0]:
            return str(dp[0][0])
    return ""


def _authors_short(item: dict, max_n: int = 6) -> str:
    authors = item.get("author") or []
    parts: list[str] = []
    for a in authors[:max_n]:
        family = (a.get("family") or "").strip()
        given = (a.get("given") or "").strip()
        if not family: continue
        initials = "".join(re.findall(r"[A-Z]", given)) or given[:1].upper()
        parts.append(f"{family} {initials}" if initials else family)
    if len(authors) > max_n:
        parts.append("et al")
    return ", ".join(parts)


def _format_ama(item: dict) -> str:
    authors = _authors_short(item)
    title = (_first(item.get("title") or "") or "").rstrip(".")
    journal = _first(item.get("container-title") or "") or item.get("iso_abbrev") or ""
    year = _year_from_item(item)
    volume = item.get("volume") or ""
    issue = item.get("issue") or ""
    page = item.get("page") or ""
    doi = item.get("DOI") or ""

    parts = []
    if authors: parts.append(f"{authors}.")
    if title:   parts.append(f"{title}.")
    if journal: parts.append(f"{journal}.")
    tail = ""
    if year:
        tail = year
        if volume:
            tail += f";{volume}"
            if issue: tail += f"({issue})"
        if page: tail += f":{page}"
        tail += "."
        parts.append(tail)
    citation = " ".join(parts).strip()
    if doi:
        citation = f"{citation} doi:{doi}"
    return citation


def _to_ui(item: dict, source: str) -> dict:
    """Common UI shape for PubMed / CrossRef results."""
    return {
        "source": source,
        "title": _first(item.get("title") or "") or "",
        "authors": _authors_short(item),
        "year": _year_from_item(item),
        "journal": _first(item.get("container-title") or "") or item.get("iso_abbrev") or "",
        "volume": item.get("volume") or "",
        "issue": item.get("issue") or "",
        "page": item.get("page") or "",
        "doi": item.get("DOI") or "",
        "url": (f"https://doi.org/{item.get('DOI')}" if item.get("DOI") else ""),
        "formatted": _format_ama(item),
    }


# ---------- public search ----------

def search_pubmed(query: str, *, year: str | None = None, max_results: int = 5) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return []
    try:
        ids = rs.pubmed_search_ids(query, year=year, max_results=max_results)
    except Exception as exc:
        logger.warning("PubMed search failed for %r: %s", query, exc)
        return []
    hits: list[dict] = []
    for pid in ids[:max_results]:
        try:
            root = rs.pubmed_fetch_xml(pid)
            if root is None: continue
            parsed = rs.pubmed_parse_article_from_xml(root)
            if not parsed: continue
            hit = _to_ui(parsed, source="pubmed")
            hit["pubmed_id"] = pid
            if not hit["url"]:
                hit["url"] = f"https://pubmed.ncbi.nlm.nih.gov/{pid}/"
            hits.append(hit)
        except Exception as exc:
            logger.debug("PubMed parse failed for id %s: %s", pid, exc)
    return hits


def search_crossref(query: str, *, year: str | None = None, max_results: int = 5) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return []
    try:
        items = rs.crossref_search(query, year=year, rows=max_results)
    except Exception as exc:
        logger.warning("CrossRef search failed for %r: %s", query, exc)
        return []
    return [_to_ui(it, source="crossref") for it in items[:max_results]]


def search(db: str, query: str, *, year: str | None = None, max_results: int = 5) -> list[dict]:
    db = (db or "").lower()
    if db == "pubmed":   return search_pubmed(query, year=year, max_results=max_results)
    if db == "crossref": return search_crossref(query, year=year, max_results=max_results)
    return []
