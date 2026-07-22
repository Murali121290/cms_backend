"""
css_diff.py
-----------
A small, dependency-free CSS parser and comparison engine used to match an
EPUB's embedded stylesheet against a "master" template (e.g. the BoD Standard
CSS). It is deliberately tolerant of the quirks found in production ebook CSS:
grouped selectors, nested @media / @supports blocks, @font-face, vendor-prefixed
properties, and comment markers such as ``/* additional css */``.

The engine reports three things the QA team cares about:

  1. MODIFIED   - a selector that exists in both files but whose declarations
                  differ (a *value* was changed on an existing class, or a
                  property was added/removed). This is "internal find #2".
  2. ADDITIONAL - a selector present only in the EPUB. Selectors that appear
                  after a ``/* additional css */`` marker are tagged
                  ``after_marker=True`` ("internal find #3").
  3. MISSING    - a selector present in the master but absent from the EPUB.

Nothing here mutates the input files; it is pure analysis.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #

# Marker the production team writes above hand-added rules.
ADDITIONAL_MARKER_RE = re.compile(r"/\*\s*additional css\s*\*/", re.IGNORECASE)

# The version banner on line 1 of the master, e.g.
# "/* BoD Standard CSS, Flowable Books, Version 5.1, 2026 */"
VERSION_BANNER_RE = re.compile(
    r"/\*\s*(BoD Standard CSS.*?Version\s*([0-9]+(?:\.[0-9]+)*).*?)\*/",
    re.IGNORECASE | re.DOTALL,
)


@dataclass
class Rule:
    """A single (selector, declarations) pair in a given @-context."""

    media: Optional[str]            # e.g. "@media screen and (max-width: 480px)"; None at top level
    selector: str                 # a single selector (grouped selectors are split out)
    declarations: list            # ordered list of (property, value) tuples
    start_offset: int             # char offset of the rule in the source (for marker logic)

    @property
    def key(self) -> tuple:
        """Identity used when matching a rule across two files."""
        return (_norm_media(self.media), _norm_selector(self.selector))

    def decl_map(self) -> dict:
        """property -> value, last declaration wins (mirrors CSS cascade)."""
        out = {}
        for prop, val in self.declarations:
            out[prop.strip().lower()] = val.strip()
        return out


def _norm_media(media: Optional[str]) -> str:
    if not media:
        return ""
    return re.sub(r"\s+", " ", media.strip()).lower()


def _norm_selector(sel: str) -> str:
    # collapse whitespace and normalise combinator spacing; keep case
    # (class/id names are case-sensitive in HTML).
    s = re.sub(r"\s+", " ", sel.strip())
    s = re.sub(r"\s*([>+~])\s*", r" \1 ", s)
    return s


def _norm_value(val: str) -> str:
    # case-insensitive, whitespace-collapsed comparison so that e.g.
    # "#0000EE" == "#0000ee" and "1em 0 0 0" == "1em  0 0 0".
    return re.sub(r"\s+", " ", val.strip()).lower()


def _strip_comments(text: str) -> str:
    """Remove /* ... */ comments but preserve character offsets."""
    out = []
    i, n = 0, len(text)
    while i < n:
        if text[i] == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append(" " * (j - i))  # keep length so offsets stay valid
            i = j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def parse_css(text: str) -> list:
    """Parse a stylesheet into a flat list of Rule objects.

    Handles nested @media / @supports blocks (one level of nesting, which is
    all the BoD standard uses) and treats @font-face / @keyframes preludes as
    their own "selector".
    """
    clean = _strip_comments(text)
    rules: list = []
    _parse_block(clean, 0, len(clean), media=None, out=rules)
    return rules


def _parse_block(text: str, start: int, end: int, media: Optional[str], out: list) -> None:
    i = start
    while i < end:
        ch = text[i]
        if ch.isspace() or ch == "}":
            i += 1
            continue

        # find the next '{' that opens this rule / at-rule body
        brace = text.find("{", i, end)
        semi = text.find(";", i, end)

        # a bare at-statement like "@import ...;" with no block
        if semi != -1 and (brace == -1 or semi < brace):
            i = semi + 1
            continue
        if brace == -1:
            break

        prelude = text[i:brace].strip()
        body_start = brace + 1
        body_end = _match_brace(text, brace, end)

        if prelude.lower().startswith(("@media", "@supports")):
            # nested rules live inside; recurse with this media context
            _parse_block(text, body_start, body_end, media=prelude, out=out)
        else:
            # ordinary rule (or @font-face / @keyframes prelude)
            decls = _parse_declarations(text[body_start:body_end])
            for sel in _split_selectors(prelude):
                out.append(
                    Rule(media=media, selector=sel, declarations=decls, start_offset=i)
                )

        i = body_end + 1


def _match_brace(text: str, open_idx: int, end: int) -> int:
    """Given the index of a '{', return the index of its matching '}'."""
    depth = 0
    i = open_idx
    while i < end:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return end - 1


def _split_selectors(prelude: str) -> list:
    parts = [p.strip() for p in prelude.split(",")]
    return [p for p in parts if p]


def _parse_declarations(body: str) -> list:
    decls = []
    for chunk in body.split(";"):
        if ":" not in chunk:
            continue
        prop, _, val = chunk.partition(":")
        prop, val = prop.strip(), val.strip()
        if prop and val:
            decls.append((prop, val))
    return decls


# --------------------------------------------------------------------------- #
# Comparison
# --------------------------------------------------------------------------- #

@dataclass
class DeclDiff:
    prop: str
    master_value: Optional[str]
    epub_value: Optional[str]
    kind: str  # "changed" | "added" | "removed"


@dataclass
class RuleDiff:
    media: Optional[str]
    selector: str
    status: str                       # "modified" | "additional" | "missing"
    decl_diffs: list = field(default_factory=list)
    after_marker: bool = False        # only meaningful for "additional"
    epub_declarations: list = field(default_factory=list)
    master_declarations: list = field(default_factory=list)


def _index(rules: list) -> dict:
    """Merge rules that share the same key (later declarations win)."""
    idx: dict = {}
    for r in rules:
        if r.key in idx:
            merged = dict(idx[r.key].declarations)
            merged.update(r.declarations)  # note: dict() of tuples => last wins
            # rebuild ordered list preserving master order then extras
            base = idx[r.key]
            seen = {p.lower() for p, _ in base.declarations}
            combined = list(base.declarations)
            for p, v in r.declarations:
                if p.lower() in seen:
                    combined = [(p, v) if pp.lower() == p.lower() else (pp, vv)
                                for pp, vv in combined]
                else:
                    combined.append((p, v))
                    seen.add(p.lower())
            base.declarations = combined
        else:
            idx[r.key] = r
    return idx


def compare(master_rules: list, epub_rules: list, epub_text: str) -> list:
    """Return a list of RuleDiff describing how the EPUB deviates from master."""
    master_idx = _index(master_rules)
    epub_idx = _index(epub_rules)

    marker = ADDITIONAL_MARKER_RE.search(epub_text)
    marker_offset = marker.start() if marker else None

    diffs: list = []

    # modified + missing (iterate master so ordering follows the template)
    for key, m_rule in master_idx.items():
        media, selector = key
        e_rule = epub_idx.get(key)
        if e_rule is None:
            diffs.append(
                RuleDiff(
                    media=m_rule.media,
                    selector=m_rule.selector,
                    status="missing",
                    master_declarations=m_rule.declarations,
                )
            )
            continue

        m_map, e_map = m_rule.decl_map(), e_rule.decl_map()
        decl_diffs = []
        for prop, m_val in m_map.items():
            if prop not in e_map:
                decl_diffs.append(DeclDiff(prop, m_val, None, "removed"))
            elif _norm_value(e_map[prop]) != _norm_value(m_val):
                decl_diffs.append(DeclDiff(prop, m_val, e_map[prop], "changed"))
        for prop, e_val in e_map.items():
            if prop not in m_map:
                decl_diffs.append(DeclDiff(prop, None, e_val, "added"))

        if decl_diffs:
            diffs.append(
                RuleDiff(
                    media=m_rule.media,
                    selector=m_rule.selector,
                    status="modified",
                    decl_diffs=decl_diffs,
                    epub_declarations=e_rule.declarations,
                    master_declarations=m_rule.declarations,
                )
            )

    # additional (present only in epub)
    for key, e_rule in epub_idx.items():
        if key in master_idx:
            continue
        after = (
            marker_offset is not None and e_rule.start_offset >= marker_offset
        )
        diffs.append(
            RuleDiff(
                media=e_rule.media,
                selector=e_rule.selector,
                status="additional",
                after_marker=after,
                epub_declarations=e_rule.declarations,
            )
        )

    return diffs
