"""
UMLS (Unified Medical Language System) / NLM Terminology Service API client.
Provides lookup, validation, and standardisation for medical, pharmaceutical, and bioscience terms.
"""
import functools
import logging
import requests
from typing import Any, Optional
from app.core.config import get_settings

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1024)
def search_umls_term(term: str, api_key: Optional[str] = None) -> list[dict[str, Any]]:
    """
    Queries NLM UMLS UTS Search REST API for a medical/pharmaceutical term.
    Returns list of matching concepts with CUI, preferred name, and source vocabulary.
    """
    settings = get_settings()
    key = api_key or settings.UMLS_API_KEY
    if not key:
        logger.debug("UMLS_API_KEY is not configured; skipping external UMLS API search for '%s'.", term)
        return []

    url = f"{settings.UMLS_BASE_URL.rstrip('/')}/search/current"
    params = {
        "string": term,
        "apiKey": key,
        "inputType": "atom",
        "pageSize": 5,
    }

    try:
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        results = data.get("result", {}).get("results", [])
        return [
            {
                "cui": item.get("ui"),
                "name": item.get("name"),
                "root_source": item.get("rootSource"),
                "uri": item.get("uri"),
            }
            for item in results
            if item.get("name")
        ]
    except Exception as exc:
        logger.warning("UMLS API search failed for term '%s': %s", term, exc)
        return []


def validate_medical_term(term: str, api_key: Optional[str] = None) -> dict[str, Any]:
    """
    Validates a medical or drug name against UMLS.
    Returns validation status, canonical preferred term, and UMLS CUI if found.
    """
    matches = search_umls_term(term, api_key=api_key)
    if not matches:
        return {
            "valid": False,
            "term": term,
            "canonical": None,
            "cui": None,
            "matches": [],
        }

    best_match = matches[0]
    return {
        "valid": True,
        "term": term,
        "canonical": best_match["name"],
        "cui": best_match["cui"],
        "matches": matches,
    }
