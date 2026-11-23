"""EOC/EOL assessment question-file validator (Backlist Hub tool)."""

from .parser import parse_docx, ChapterFile, Question, ImageMeta
from .rules import check_file, check_run, check_alt_text_file, check_alt_text_run, shuffle_decision, Issue
from .fixer import fix_docx, Fix
from .report import build_report, to_csv, to_xlsx
from .router import router

__all__ = [
    "parse_docx",
    "ChapterFile",
    "Question",
    "check_file",
    "check_run",
    "shuffle_decision",
    "Issue",
    "build_report",
    "to_csv",
    "to_xlsx",
    "router",
]
