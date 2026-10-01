"""
Sentence-level checks registered as callable function rules for Ninja Inkflow.
"""
import re
from typing import Callable, Any
from .rules import Finding, Rule

FUNCTIONS: dict[str, Callable[[str, int, Rule, dict[str, Any]], list[Finding]]] = {}


def register(name: str):
    """Decorator to register function rules by name."""
    def deco(fn: Callable[[str, int, Rule, dict[str, Any]], list[Finding]]):
        FUNCTIONS[name] = fn
        return fn
    return deco


@register("max_sentence_length")
def max_sentence_length(sent: str, off: int, rule: Rule, params: dict[str, Any]) -> list[Finding]:
    limit = params.get("limit", 40)
    word_tokens = re.findall(r"\w+", sent)
    n = len(word_tokens)
    if n > limit:
        t = sent.strip()
        return [Finding(
            rule_id=rule.id,
            category="sentence",
            start=off,
            end=off + len(sent),
            original=t,
            suggestion=t,
            message=f"Long sentence ({n} words > {limit}). Consider splitting.",
            severity=rule.severity or "suggestion",
            autofixable=False
        )]
    return []


@register("terminal_punctuation")
def terminal_punctuation(sent: str, off: int, rule: Rule, params: dict[str, Any]) -> list[Finding]:
    t = sent.rstrip()
    if t and t[-1] not in '.!?:;"\')]':
        return [Finding(
            rule_id=rule.id,
            category="sentence",
            start=off + len(t) - 1,
            end=off + len(t),
            original=t[-1],
            suggestion=t[-1] + ".",
            message="Sentence may be missing terminal punctuation.",
            severity=rule.severity or "warning",
            autofixable=False
        )]
    return []


URL_PAT = re.compile(r"https?://|www\.|doi\.org|10\.\d{4,9}/|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.I)
ABBREV_PAT = re.compile(r"^(?:e\.g\.|i\.e\.|vs\.|et al\.|vol\.|no\.|p\.|pp\.|ref\.|fig\.|eq\.|dr\.|prof\.|mr\.|mrs\.|ms\.|v\d|i\d|\d)", re.I)
INITIALS_PAT = re.compile(r"\b[A-Z]\.(?:[A-Z]\.)*|\b[A-Z]\.,")


@register("start_capital")
def start_capital(sent: str, off: int, rule: Rule, params: dict[str, Any]) -> list[Finding]:
    stripped = sent.lstrip()
    if not stripped:
        return []
    # Guard against display quotes, tags, numbers, URLs, initials, abbreviations at sentence start
    if stripped[0] in ('"', "'", '“', '‘', '”', '’', '<') or URL_PAT.search(stripped[:35]) or ABBREV_PAT.search(stripped[:15]):
        return []
    m = re.search(r"[A-Za-z]", sent)
    if m and sent[m.start()].islower():
        ctx = sent[max(0, m.start() - 10):min(len(sent), m.start() + 25)]
        if URL_PAT.search(ctx) or "://" in ctx or "@" in ctx or "doi" in ctx.lower() or INITIALS_PAT.search(ctx):
            return []
        i = off + m.start()
        orig_char = sent[m.start()]
        return [Finding(
            rule_id=rule.id,
            category="sentence",
            start=i,
            end=i + 1,
            original=orig_char,
            suggestion=orig_char.upper(),
            message="Sentence should start with a capital letter.",
            severity=rule.severity or "warning",
            autofixable=True
        )]
    return []


WORDY_PHRASES = {
    r"\bin order to\b": "to",
    r"\bdue to the fact that\b": "because",
    r"\ba large number of\b": "many",
    r"\bin the event that\b": "if",
    r"\bat this point in time\b": "now",
    r"\bin spite of the fact that\b": "although"
}


@register("wordiness")
def wordiness(sent: str, off: int, rule: Rule, params: dict[str, Any]) -> list[Finding]:
    out = []
    phrase_map = params.get("wordy_phrases", WORDY_PHRASES)
    for pat, repl in phrase_map.items():
        for m in re.finditer(pat, sent, re.I):
            out.append(Finding(
                rule_id=rule.id,
                category="sentence",
                start=off + m.start(),
                end=off + m.end(),
                original=m.group(0),
                suggestion=repl,
                message=f"Wordy phrase; prefer '{repl}'.",
                severity=rule.severity or "suggestion",
                autofixable=True
            ))
    return out


@register("passive_voice")
def passive_voice(sent: str, off: int, rule: Rule, params: dict[str, Any]) -> list[Finding]:
    out = []
    pattern = r"\b(is|are|was|were|be|been|being)\s+(\w+ed|written|done|made|shown|given|taken|seen|held|found)\b"
    for m in re.finditer(pattern, sent, re.I):
        out.append(Finding(
            rule_id=rule.id,
            category="sentence",
            start=off + m.start(),
            end=off + m.end(),
            original=m.group(0),
            suggestion=m.group(0),
            message="Possible passive voice; consider an active construction.",
            severity=rule.severity or "suggestion",
            autofixable=False
        ))
    return out
