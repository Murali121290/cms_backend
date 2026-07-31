"""Shared helpers used by ported v2 validators.

During Phase 1 these are re-exported from the legacy validate_service so both
engines share one implementation and cannot drift. When the legacy module is
deleted (Phase 5), move the definitions here and delete this shim.
"""

from ...services.validate_service import (  # noqa: F401
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
