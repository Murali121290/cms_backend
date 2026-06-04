"""
Citation linking service - manages bidirectional links and comments.
Stores data in .reflinks.json sidecar files alongside processed DOCX files.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from uuid import uuid4
import logging

logger = logging.getLogger(__name__)


def _reflinks_file_path(processed_docx_path: str) -> str:
    """
    Compute .reflinks.json sidecar path from processed DOCX path.
    Example: /path/to/file_Processed.docx → /path/to/file.reflinks.json
    """
    path = Path(processed_docx_path)
    base_name = path.stem.replace("_Processed", "")
    return str(path.parent / f"{base_name}.reflinks.json")


def load_reflinks_data(processed_docx_path: str) -> Dict:
    """
    Load link and comment data from .reflinks.json sidecar.
    Returns empty dict with default structure if file missing.

    Args:
        processed_docx_path: Full path to processed DOCX file

    Returns:
        Dict with keys: version, file_id, timestamp, links, comments
    """
    reflinks_path = _reflinks_file_path(processed_docx_path)

    if not os.path.exists(reflinks_path):
        return _empty_reflinks_structure()

    try:
        with open(reflinks_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data
    except Exception as e:
        logger.warning(f"Failed to load reflinks from {reflinks_path}: {e}")
        return _empty_reflinks_structure()


def save_reflinks_data(processed_docx_path: str, data: Dict) -> None:
    """
    Save link and comment data to .reflinks.json sidecar.

    Args:
        processed_docx_path: Full path to processed DOCX file
        data: Dict with links and comments
    """
    reflinks_path = _reflinks_file_path(processed_docx_path)

    # Ensure data structure
    if "version" not in data:
        data["version"] = "1.0"
    if "timestamp" not in data:
        data["timestamp"] = datetime.now(timezone.utc).isoformat()
    if "links" not in data:
        data["links"] = []
    if "comments" not in data:
        data["comments"] = []

    try:
        # Ensure directory exists
        os.makedirs(os.path.dirname(reflinks_path), exist_ok=True)

        # Write with pretty formatting
        with open(reflinks_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        logger.debug(f"Saved reflinks to {reflinks_path}")
    except Exception as e:
        logger.error(f"Failed to save reflinks to {reflinks_path}: {e}")
        raise


def add_link(
    processed_docx_path: str,
    citation_key: str,
    citation_text: str,
    para_idx: int,
    ref_idx: int,
    ref_text: str,
    match_type: str,
    confidence: float,
    linked_by: Optional[str] = None,
    link_flags: Optional[Dict] = None,
) -> str:
    """
    Create a new bidirectional link between citation and reference.

    Args:
        processed_docx_path: Path to processed DOCX
        citation_key: UUID identifier for citation
        citation_text: Citation text (e.g., "(Smith, 2020)" or "[1]")
        para_idx: Paragraph index of citation in document
        ref_idx: Index of reference in bibliography
        ref_text: Full reference text
        match_type: Type of match (exact, smart, fuzzy, etc.)
        confidence: Confidence score (0.0-1.0)
        linked_by: Username who created link
        link_flags: Dict with flag_type and user_notes

    Returns:
        link_id (UUID string)
    """
    reflinks = load_reflinks_data(processed_docx_path)

    link_id = str(uuid4())
    link_data = {
        "link_id": link_id,
        "citation_key": citation_key,
        "citation_text": citation_text,
        "para_idx": para_idx,
        "ref_idx": ref_idx,
        "ref_text": ref_text,
        "match_type": match_type,
        "confidence": confidence,
        "linked_at": datetime.now(timezone.utc).isoformat(),
        "linked_by": linked_by or "anonymous",
    }

    if link_flags:
        link_data["link_flags"] = link_flags

    reflinks.setdefault("links", []).append(link_data)
    reflinks["timestamp"] = datetime.now(timezone.utc).isoformat()

    save_reflinks_data(processed_docx_path, reflinks)
    logger.info(f"Added link {link_id} (citation={citation_text} → ref={ref_idx})")

    return link_id


def remove_link(processed_docx_path: str, link_id: str) -> bool:
    """
    Remove a link by ID.

    Args:
        processed_docx_path: Path to processed DOCX
        link_id: Link ID to remove

    Returns:
        True if removed, False if not found
    """
    reflinks = load_reflinks_data(processed_docx_path)
    original_count = len(reflinks.get("links", []))

    reflinks["links"] = [link for link in reflinks.get("links", []) if link["link_id"] != link_id]

    if len(reflinks["links"]) < original_count:
        reflinks["timestamp"] = datetime.now(timezone.utc).isoformat()
        save_reflinks_data(processed_docx_path, reflinks)
        logger.info(f"Removed link {link_id}")
        return True

    return False


def add_comment(
    processed_docx_path: str,
    target_type: str,  # "citation" or "reference"
    comment_text: str,
    citation_key: Optional[str] = None,
    para_idx: Optional[int] = None,
    ref_idx: Optional[int] = None,
    created_by: Optional[str] = None,
    flags: Optional[List[str]] = None,
) -> str:
    """
    Add a comment to a citation or reference.

    Args:
        processed_docx_path: Path to processed DOCX
        target_type: "citation" or "reference"
        comment_text: Comment content
        citation_key: UUID of citation (for type="citation")
        para_idx: Paragraph index of citation
        ref_idx: Index of reference (for type="reference")
        created_by: Username who created comment
        flags: List of flag tags (e.g., ["verified", "needs_review"])

    Returns:
        comment_id (UUID string)
    """
    reflinks = load_reflinks_data(processed_docx_path)

    comment_id = str(uuid4())
    comment_data = {
        "comment_id": comment_id,
        "target_type": target_type,
        "comment_text": comment_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by or "anonymous",
    }

    if citation_key:
        comment_data["citation_key"] = citation_key
    if para_idx is not None:
        comment_data["para_idx"] = para_idx
    if ref_idx is not None:
        comment_data["ref_idx"] = ref_idx
    if flags:
        comment_data["flags"] = flags

    reflinks.setdefault("comments", []).append(comment_data)
    reflinks["timestamp"] = datetime.now(timezone.utc).isoformat()

    save_reflinks_data(processed_docx_path, reflinks)
    logger.info(f"Added comment {comment_id} on {target_type}")

    return comment_id


def get_comments(
    processed_docx_path: str,
    target_type: Optional[str] = None,
    citation_key: Optional[str] = None,
    ref_idx: Optional[int] = None,
) -> List[Dict]:
    """
    Retrieve comments, optionally filtered.

    Args:
        processed_docx_path: Path to processed DOCX
        target_type: Filter by "citation" or "reference"
        citation_key: Filter by citation UUID
        ref_idx: Filter by reference index

    Returns:
        List of comment dicts
    """
    reflinks = load_reflinks_data(processed_docx_path)
    comments = reflinks.get("comments", [])

    if target_type:
        comments = [c for c in comments if c.get("target_type") == target_type]
    if citation_key:
        comments = [c for c in comments if c.get("citation_key") == citation_key]
    if ref_idx is not None:
        comments = [c for c in comments if c.get("ref_idx") == ref_idx]

    return comments


def get_links(
    processed_docx_path: str,
    citation_key: Optional[str] = None,
    ref_idx: Optional[int] = None,
) -> List[Dict]:
    """
    Retrieve links, optionally filtered.

    Args:
        processed_docx_path: Path to processed DOCX
        citation_key: Filter by citation UUID
        ref_idx: Filter by reference index

    Returns:
        List of link dicts
    """
    reflinks = load_reflinks_data(processed_docx_path)
    links = reflinks.get("links", [])

    if citation_key:
        links = [l for l in links if l.get("citation_key") == citation_key]
    if ref_idx is not None:
        links = [l for l in links if l.get("ref_idx") == ref_idx]

    return links


def get_all_links_and_comments(processed_docx_path: str) -> Dict:
    """
    Get all links and comments for a file.

    Returns:
        Dict with keys: links, comments
    """
    reflinks = load_reflinks_data(processed_docx_path)
    return {
        "links": reflinks.get("links", []),
        "comments": reflinks.get("comments", []),
    }


def _empty_reflinks_structure() -> Dict:
    """Return empty reflinks data structure."""
    return {
        "version": "1.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "links": [],
        "comments": [],
    }
