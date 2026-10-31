"""
Data-driven rule and finding data model for Ninja Inkflow Language Editing.
"""
from dataclasses import dataclass, field, asdict
import re
from typing import Any, Optional


@dataclass
class Finding:
    rule_id: str
    category: str            # grammar | spelling | sentence | hyphenation | typo | term | compounds | bias
    start: int
    end: int
    original: str
    suggestion: str
    message: str
    severity: str = "warning"     # error | warning | suggestion
    autofixable: bool = True
    confidence: float = 1.0
    # Workbook rules (Dash_Rules / Detect_List) can ship 2–3 replacements; the
    # primary one lives in ``suggestion`` and the rest go here. Downstream
    # readers (DB persistence, API, UI dropdown) treat an empty list as
    # "no alternates" — identical to the pre-workbook behaviour.
    alt_suggestions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Valid ``tool_behaviour`` values. ``flag`` is the backward-compatible
# default — a missing / null value is treated as ``flag`` everywhere so
# existing profile rules without the field keep today's behaviour.
#
# IMPORTANT INVARIANT (Scope C decision): neither value lets the engine
# silently mutate the manuscript. BOTH values produce a reviewable
# finding; the DOCX export only writes changes for findings the user
# has explicitly accepted in the Language Editor. ``auto_replace`` is
# a *preference* that the UI can surface (e.g. one-click accept, no
# "Edit before accepting" prompt) — NOT permission for background text
# replacement.
TOOL_BEHAVIOUR_FLAG = "flag"
TOOL_BEHAVIOUR_AUTO_REPLACE = "auto_replace"
VALID_TOOL_BEHAVIOURS = (TOOL_BEHAVIOUR_FLAG, TOOL_BEHAVIOUR_AUTO_REPLACE)


@dataclass
class Rule:
    id: str
    category: str
    type: str                # regex | dictionary | function | builtin | phrase_lookup
    pattern: Optional[str] = None
    replacement: Optional[str] = None
    message: str = ""
    severity: str = "warning"
    flags: int = 0
    function: Optional[str] = None
    params: dict = field(default_factory=dict)
    enabled: bool = True
    # Per-rule action preference. See TOOL_BEHAVIOUR_* constants above
    # for the invariant: this is advisory metadata only. The engine
    # treats ``None`` identically to ``flag`` so legacy profile rules
    # (uk.json, us.json, …) without the field keep today's behaviour.
    tool_behaviour: Optional[str] = None
    rx: Optional[re.Pattern] = None

    def compile(self) -> "Rule":
        if self.type == "regex" and self.pattern:
            self.rx = re.compile(self.pattern, self.flags)
        return self

    def effective_tool_behaviour(self) -> str:
        """Return the resolved behaviour, applying the FLAG default."""
        if self.tool_behaviour in VALID_TOOL_BEHAVIOURS:
            return self.tool_behaviour
        return TOOL_BEHAVIOUR_FLAG

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
            "tool_behaviour": self.tool_behaviour,
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

        tool_behaviour = d.get("tool_behaviour")
        if tool_behaviour is not None and tool_behaviour not in VALID_TOOL_BEHAVIOURS:
            # Garbage value — reject to None so the loader fails loudly in
            # tests rather than silently emitting something unexpected.
            tool_behaviour = None

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
            tool_behaviour=tool_behaviour,
        )
        rules.append(rule.compile())
    return rules


def load_house_style_from_dict(variant_to_canonical: dict[str, str]) -> dict[str, str]:
    """Lowercases keys for fast dictionary matching."""
    return {k.lower(): v for k, v in variant_to_canonical.items()}
