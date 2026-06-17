"""
Citation matching and candidate finding for bidirectional linking.
Leverages existing match_citation() from validation_core.py for scoring.
"""

from typing import Dict, List, Optional
from difflib import SequenceMatcher
import logging

logger = logging.getLogger(__name__)

# Import existing validation utilities
try:
    from app.processing.legacy.validation_core import (
        match_citation,
        FUZZY_THRESHOLD,
        _norm,
        _first_surname,
        _surname_set,
    )
except ImportError:
    FUZZY_THRESHOLD = 0.80

    def _norm(s: str) -> str:
        """Normalize string for comparison."""
        if not s:
            return ""
        return s.lower().strip().replace("et al.", "et al").replace("  ", " ")

    def _first_surname(a: str) -> str:
        """Extract first surname from author string."""
        if not a:
            return ""
        parts = _norm(a).split(",")
        return parts[0].strip() if parts else ""

    def _surname_set(a: str) -> set:
        """Extract all surname words from author string."""
        if not a:
            return set()
        # Split on comma or '&' or 'and'
        normalized = _norm(a)
        parts = normalized.replace(" & ", ",").replace(" and ", ",").split(",")
        return {p.split()[0] for p in parts if p.strip()}


def find_citation_candidates(
    citation_author: str,
    citation_year: Optional[str],
    bibliography: Dict[str, dict],
    max_candidates: int = 3,
) -> List[Dict]:
    """
    Find reference candidates for a given citation.
    Uses hierarchical matching: exact > smart > spelling > year_mismatch.

    Args:
        citation_author: Author string from citation (e.g., "Smith et al." or "Smith")
        citation_year: Year from citation (e.g., "2020")
        bibliography: Dict mapping ref_idx -> {full_author, year, raw_text, ...}
        max_candidates: Max candidates to return

    Returns:
        List of dicts with keys: ref_idx, ref_text, match_type, confidence, reason
    """
    if not citation_author or not bibliography:
        return []

    candidates = []

    # Try to use existing match_citation if available
    try:
        ref_key, match_type = match_citation(citation_author, citation_year or "", bibliography)

        if match_type != "not_found":
            ref_entry = bibliography.get(ref_key, {})

            # Map match_type to confidence
            confidence_map = {
                "exact": 1.0,
                "smart": 0.95,
                "org_abbrev": 0.90,
                "suffix_mismatch": 0.85,
                "suffix_ambiguous": 0.80,
                "spelling_mismatch": 0.85,
                "year_mismatch": 0.75,
            }

            confidence = confidence_map.get(match_type, 0.70)
            candidates.append({
                "ref_key": ref_key,
                "ref_text": ref_entry.get("raw_text") or ref_entry.get("text", ""),
                "match_type": match_type,
                "confidence": confidence,
                "reason": _get_match_reason(match_type, citation_author, citation_year),
            })
    except Exception as e:
        logger.debug(f"match_citation failed: {e}, falling back to fuzzy matching")

    # If no exact match found, add fuzzy matches
    if not candidates or len(candidates) < max_candidates:
        fuzzy_matches = _fuzzy_match_references(
            citation_author, citation_year, bibliography, FUZZY_THRESHOLD - 0.1
        )
        for match in fuzzy_matches:
            if not any(c["ref_key"] == match["ref_key"] for c in candidates):
                candidates.append(match)
                if len(candidates) >= max_candidates:
                    break

    return candidates[:max_candidates]


def find_reference_candidates(
    ref_text: str,
    citations_in_doc: List[Dict],
    max_candidates: int = 3,
) -> List[Dict]:
    """
    Find citation candidates for a given reference (reverse direction).
    Scores each citation in document against the reference.

    Args:
        ref_text: Reference bibliography entry text
        citations_in_doc: List of dicts with keys: text, author, year, para_idx
        max_candidates: Max candidates to return

    Returns:
        List of dicts with keys: citation_text, para_idx, match_type, confidence, reason
    """
    if not ref_text or not citations_in_doc:
        return []

    ref_norm = _norm(ref_text)
    ref_parts = ref_text.split("(")
    ref_author = ref_parts[0].strip() if ref_parts else ref_text

    scored = []

    for cite in citations_in_doc:
        cite_text = cite.get("text", "")
        cite_author = cite.get("author", "")
        cite_year = cite.get("year", "")

        if not cite_text:
            continue

        # Score on full text similarity
        cite_norm = _norm(cite_text)
        matcher = SequenceMatcher(None, cite_norm, ref_norm)
        text_ratio = matcher.ratio()

        # Also check author/year overlap
        author_ratio = 0.0
        if cite_author and ref_author:
            matcher = SequenceMatcher(None, _norm(cite_author), _norm(ref_author))
            author_ratio = matcher.ratio()

        # Weighted average: prefer author match over full text
        overall_ratio = (text_ratio * 0.4) + (author_ratio * 0.6)

        # Only include if meets minimum threshold
        if overall_ratio >= (FUZZY_THRESHOLD - 0.1):
            scored.append({
                "citation_text": cite_text,
                "para_idx": cite.get("para_idx"),
                "match_type": "candidate",
                "confidence": overall_ratio,
                "reason": f"Text similarity ({overall_ratio:.0%})",
            })

    # Sort by confidence descending
    scored.sort(key=lambda x: x["confidence"], reverse=True)
    return scored[:max_candidates]


def _fuzzy_match_references(
    citation_author: str,
    citation_year: Optional[str],
    bibliography: Dict[str, dict],
    threshold: float = 0.70,
) -> List[Dict]:
    """
    Fallback fuzzy matching on bibliography using string similarity.
    """
    matches = []
    cite_norm = _norm(citation_author)

    for ref_key, ref_entry in bibliography.items():
        ref_author = ref_entry.get("full_author", "")
        ref_year = ref_entry.get("year", "")

        # Match on author
        author_norm = _norm(ref_author)
        matcher = SequenceMatcher(None, cite_norm, author_norm)
        author_ratio = matcher.ratio()

        # Boost score if year matches
        year_boost = 0.1 if (citation_year and ref_year and str(citation_year) == str(ref_year)) else 0
        overall_score = author_ratio + year_boost

        if overall_score >= threshold:
            matches.append({
                "ref_key": ref_key,
                "ref_text": ref_entry.get("raw_text") or ref_entry.get("text", ""),
                "match_type": "fuzzy",
                "confidence": min(overall_score, 1.0),
                "reason": f"Author fuzzy match ({author_ratio:.0%})" +
                         (f", year matches" if year_boost > 0 else ""),
            })

    # Sort by confidence descending
    matches.sort(key=lambda x: x["confidence"], reverse=True)
    return matches


def _get_match_reason(match_type: str, author: str, year: Optional[str]) -> str:
    """Generate human-readable reason for match type."""
    reasons = {
        "exact": f"Exact match for {author} ({year})",
        "smart": f"Author surname and year match",
        "org_abbrev": f"Organization abbreviation matched",
        "suffix_mismatch": f"Found but citation missing a/b/c suffix",
        "suffix_ambiguous": f"Multiple entries with same author/year",
        "spelling_mismatch": f"Author name variation, year matches",
        "year_mismatch": f"Author matches, but year differs ({year})",
    }
    return reasons.get(match_type, "Candidate match found")
