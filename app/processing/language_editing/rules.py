"""
Data-driven rule and finding data model for Ninja Inkflow Language Editing.
"""
from dataclasses import dataclass, field, asdict
import re
from typing import Any, Optional


@dataclass
class Finding:
    rule_id: str
    category: str            # grammar | spelling | sentence
    start: int
    end: int
    original: str
    suggestion: str
    message: str
    severity: str = "warning"     # error | warning | suggestion
    autofixable: bool = True
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Rule:
    id: str
    category: str
    type: str                # regex | dictionary | function
    pattern: Optional[str] = None
    replacement: Optional[str] = None
    message: str = ""
    severity: str = "warning"
    flags: int = 0
    function: Optional[str] = None
    params: dict = field(default_factory=dict)
    enabled: bool = True
    rx: Optional[re.Pattern] = None

    def compile(self) -> "Rule":
        if self.type == "regex" and self.pattern:
            self.rx = re.compile(self.pattern, self.flags)
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "type": self.type,
            "pattern": self.pattern,
            "replacement": self.replacement,
            "message": self.message,
            "severity": self.severity,
            "flags": self.flags,
            "function": self.function,
            "params": self.params,
            "enabled": self.enabled,
        }


def load_rules_from_dict(rule_dicts: list[dict[str, Any]]) -> list[Rule]:
    """Parse list of rule dicts into compiled Rule objects."""
    rules = []
    for d in rule_dicts:
        flags = 0
        raw_flags = d.get("flags", [])
        if isinstance(raw_flags, list):
            for f in raw_flags:
                if isinstance(f, str) and hasattr(re, f):
                    flags |= getattr(re, f)
                elif isinstance(f, int):
                    flags |= f
        elif isinstance(raw_flags, int):
            flags = raw_flags

        rule = Rule(
            id=d["id"],
            category=d.get("category", "grammar"),
            type=d.get("type", "regex"),
            pattern=d.get("pattern"),
            replacement=d.get("replacement"),
            message=d.get("message", ""),
            severity=d.get("severity", "warning"),
            flags=flags,
            function=d.get("function"),
            params=d.get("params", {}),
            enabled=d.get("enabled", True),
        )
        rules.append(rule.compile())
    return rules


def load_house_style_from_dict(variant_to_canonical: dict[str, str]) -> dict[str, str]:
    """Lowercases keys for fast dictionary matching."""
    return {k.lower(): v for k, v in variant_to_canonical.items()}
