"""Shared helpers for Aspen validators."""

import glob
import os


def find_opf(epub_folder: str) -> str | None:
    matches = glob.glob(os.path.join(epub_folder, "**", "*.opf"), recursive=True)
    return matches[0] if matches else None


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


from ..services.validate_service import (  # noqa: F401
    _URL_HEADERS,
    _call_w3c_css_validator,
    _check_single_url,
    _cli_issue_to_web,
    _drop_pass_issues,
    _make_session,
    _pagebreak_collect_segments,
    _pagebreak_normalize,
    get_nav_level,
)

