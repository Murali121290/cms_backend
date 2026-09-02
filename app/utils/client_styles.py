import json
import os
import logging
from typing import Optional, List

logger = logging.getLogger("app.utils.client_styles")

_SPRINGER_STYLES_CACHE: Optional[List[str]] = None


def get_springer_styles() -> List[str]:
    """Load and cache Springer paragraph styles from springerstyles.json."""
    global _SPRINGER_STYLES_CACHE
    if _SPRINGER_STYLES_CACHE is not None:
        return _SPRINGER_STYLES_CACHE

    json_path = os.path.abspath("app/services/scripts/springerstyles.json")
    if not os.path.exists(json_path):
        json_path = os.path.abspath("services/scripts/springerstyles.json")

    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                styles = data.get("allowed_styles", [])
                if isinstance(styles, list):
                    _SPRINGER_STYLES_CACHE = sorted(list(set(styles)))
                    return _SPRINGER_STYLES_CACHE
        except Exception as e:
            logger.error(f"Error reading springerstyles.json: {e}")

    # Fallback if json not found or invalid
    return []


def get_paragraph_styles_for_client(client_name: Optional[str] = None) -> List[str]:
    """
    Return paragraph styles based on client_name.
    - If client_name contains 'springer' (case-insensitive), return springerstyles.json styles.
    - For all other clients / default, return PUBLISHER_STYLES from inject_styles.py.
    """
    from app.utils.inject_styles import PUBLISHER_STYLES

    if client_name:
        c_lower = str(client_name).lower()
        if "springer" in c_lower or "spr" in c_lower:
            springer_styles = get_springer_styles()
            if springer_styles:
                return springer_styles

    return sorted(list(set(PUBLISHER_STYLES)))
