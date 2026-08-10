"""Load and apply customer-specific export configurations."""
import json
import os
from pathlib import Path


RULES_DIR = Path(__file__).parent.parent / "rules" / "customers"


def _get_customer_config(customer_code: str) -> dict:
    """Load customer-specific configuration from customer.json."""
    config_path = RULES_DIR / customer_code / "customer.json"
    if not config_path.exists():
        return {}
    try:
        with open(config_path) as f:
            data = json.load(f)
            return data.get("export", {})
    except Exception:
        return {}


def get_export_filename(
    eisbn: str | None,
    project_name: str | None,
    folder_name: str,
    customer_code: str | None,
) -> str:
    """Generate export filename based on customer configuration and available identifiers.

    Args:
        eisbn: eISBN from database
        project_name: Project name from database
        folder_name: Folder name (disk key)
        customer_code: Customer code to load configuration

    Returns:
        Filename for the exported EPUB
    """
    export_config = _get_customer_config(customer_code) if customer_code else {}

    # Default format if not configured
    filename_format = export_config.get("filename_format", "{eisbn}_EPUB.epub")

    # Use eISBN if available
    if eisbn:
        return filename_format.replace("{eisbn}", eisbn)

    # Fallback to project_name
    if project_name:
        return filename_format.replace("{eisbn}", project_name)

    # Final fallback to folder_name
    return filename_format.replace("{eisbn}", folder_name)
