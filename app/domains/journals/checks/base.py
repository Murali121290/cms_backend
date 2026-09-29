"""Validation check engine interface for journal articles.

Each check (structuring, references, technical, language, xml) subclasses
JournalCheck and registers itself with @register. The runner persists every
execution as a JournalCheckRun and the findings as JournalIssue rows.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Type

from app.domains.journals.models import JournalArticle

SEVERITIES = ("error", "warning", "info")

# Check key -> stage number the check belongs to. Stage gates block on open
# errors from checks at or before the article's current stage.
CHECK_STAGES: Dict[str, int] = {
    "structuring": 1,
    "references": 1,
    "technical": 2,
    "language": 3,
    "xml": 4,
}


@dataclass
class IssueDraft:
    rule_id: str
    severity: str
    title: str
    message: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    context_snippet: Optional[str] = None
    suggestion: Optional[Dict[str, Any]] = None
    # Identifies the same finding across re-runs, so an "ignored" decision sticks.
    fingerprint: Optional[str] = None
    # Fingerprint of an issue in an earlier check that caused this one (e.g. DTD IDREF -> missing reference).
    source_fingerprint: Optional[str] = None

    def __post_init__(self):
        if self.severity not in SEVERITIES:
            raise ValueError(f"Unknown severity {self.severity!r}")
        if not self.fingerprint:
            loc = self.location or {}
            self.fingerprint = ":".join(str(p) for p in (self.rule_id, loc.get("block_id", ""), loc.get("start", ""), loc.get("xml_line", "")))


@dataclass
class CheckResult:
    issues: List[IssueDraft] = field(default_factory=list)
    rules_total: int = 0
    rule_set_version: Optional[str] = None

    @property
    def rules_passed(self) -> int:
        failed = {i.rule_id for i in self.issues}
        return max(self.rules_total - len(failed), 0)


class JournalCheck:
    key: str = ""
    name: str = ""
    implemented: bool = True

    def run(self, article: JournalArticle, db) -> CheckResult:  # pragma: no cover - interface
        raise NotImplementedError


REGISTRY: Dict[str, JournalCheck] = {}


def register(cls: Type[JournalCheck]) -> Type[JournalCheck]:
    if cls.key not in CHECK_STAGES:
        raise ValueError(f"Check key {cls.key!r} has no stage in CHECK_STAGES")
    REGISTRY[cls.key] = cls()
    return cls


def get_check(key: str) -> Optional[JournalCheck]:
    return REGISTRY.get(key)
