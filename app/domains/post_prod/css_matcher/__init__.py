"""CSS Matcher module for EPUB validation and CSS diffing."""

from .epub_utils import decode_bytes, load_epub, EpubInfo, check_sidecars
from .epub_validate import validate_epub, summarize_validation
from .css_diff import compare, parse_css
from .report import build_report, to_html, to_csv
from .router import router

__all__ = [
    "decode_bytes",
    "load_epub",
    "EpubInfo",
    "check_sidecars",
    "validate_epub",
    "summarize_validation",
    "compare",
    "parse_css",
    "build_report",
    "to_html",
    "to_csv",
    "router",
]
