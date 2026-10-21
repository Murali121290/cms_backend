"""
Custom spell-check dictionaries for Language Editing.

Loads client-supplied `.dic` / `.txt` word lists (e.g. medical / pharmaceutical
terminology) and exposes a lowercased set of word tokens that the Spell Check
pass should treat as valid words.

File format assumptions:
  * One term per line. Blank lines and comment lines (`#`, `;`, `//`) ignored.
  * If the first non-blank line is a bare integer, it's treated as a Hunspell
    `.dic` count header and skipped — real terms never match that shape.
  * Encoding is auto-detected: UTF-8 (with or without BOM) and UTF-16 (LE/BE
    with BOM) are both accepted. This matches the shapes we've actually
    received from clients and avoids a hard dependency on chardet.
  * Entries may contain:
      - plain words (`cholecalciferol`)
      - hyphenated chemistry (`5-hydroxytryptamine`)
      - dotted abbreviations (`A.B.`)
      - all-caps acronyms (`AAAS`)
      - dual-form terms separated by `/` (`anterior/posterior`, `fa/fa`)
      - diacritics / possessives (`Aëtius`, `Abrahams'`)
  * The loader does NOT interpret Hunspell affix flags. If a `/` is present it's
    treated as a dual-form separator, which is how the uploaded medical lists
    actually use it. Hunspell `.aff` affix expansion is out of scope — if that
    is needed later, add a separate loader rather than overloading this one.

The output is a set of **lowercased word-shaped sub-tokens** extracted using the
same token regex the Spell Check pass uses. This matches how `build_whitelist`
treats `term_vocabulary`: a multi-word entry contributes each of its tokens.

Configurability:
  * Any file matching `*.dic` or `*.txt` placed in
    `app/processing/language_editing/config/dictionaries/` is loaded.
  * The env var `CMS_LANGEDIT_CUSTOM_DICTS` can list additional absolute paths
    (colon-separated on POSIX, semicolon on Windows via `os.pathsep`).
  * The combined word set is cached per-process via `lru_cache`; call
    `load_all_custom_dicts.cache_clear()` to force a reload (used in tests).
"""
from __future__ import annotations

import logging
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)

DICTIONARIES_DIR = Path(__file__).parent / "config" / "dictionaries"

ENV_VAR = "CMS_LANGEDIT_CUSTOM_DICTS"

# Word-shaped sub-token: letters with optional internal apostrophe/hyphen.
# Mirrors spell_check._TOKEN_RE so whitelisted tokens line up with how the
# spell checker tokenizes paragraph text.
_TOKEN_RE = re.compile(r"[A-Za-z]+(?:['\-’][A-Za-z]+)*")

_COMMENT_PREFIXES = ("#", ";", "//")


def _detect_encoding(sample: bytes) -> str:
    """Return a Python codec name for the first few bytes of a file.

    Handles the four cases we see in practice: UTF-8 with BOM, UTF-16 LE/BE
    with BOM, and plain UTF-8. We don't try to detect UTF-16 without a BOM —
    callers can convert such files to UTF-8 (`iconv -f UTF-16LE -t UTF-8`)
    rather than guessing wrong on a borderline sample.
    """
    if sample.startswith(b"\xff\xfe"):
        return "utf-16"
    if sample.startswith(b"\xfe\xff"):
        return "utf-16"
    if sample.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return "utf-8"


def _is_metadata_line(line: str, is_first_entry: bool) -> bool:
    """Lines that must be ignored as metadata rather than treated as terms.

    * Pure comment lines (`#`, `;`, `//` prefix).
    * The leading bare-integer line of a Hunspell `.dic` file — but only the
      first non-blank entry can be the header, so later numeric lines (which
      don't occur in sensible term lists anyway) are still skipped as
      non-word-shaped rather than misread as the header twice.
    """
    stripped = line.lstrip()
    if any(stripped.startswith(p) for p in _COMMENT_PREFIXES):
        return True
    if is_first_entry and stripped.isdigit():
        return True
    return False


def _extract_tokens(entry: str) -> list[str]:
    """Return the lowercased word tokens contained in one dic entry.

    `anterior/posterior` -> ["anterior", "posterior"]
    `1,25-dihydroxycholecalciferol` -> ["dihydroxycholecalciferol"]
    `A.B.` -> ["a", "b"] (filtered later by the spell checker's min-length)
    """
    out: list[str] = []
    for part in entry.split("/"):
        for m in _TOKEN_RE.finditer(part):
            out.append(m.group(0).lower())
    return out


def load_dic_file(path: str | os.PathLike) -> set[str]:
    """Parse one `.dic` / `.txt` word list and return a lowercased token set."""
    p = Path(path)
    if not p.is_file():
        return set()

    try:
        with p.open("rb") as fh:
            head = fh.read(4)
        encoding = _detect_encoding(head)
    except OSError as exc:
        logger.warning("custom_dict: cannot read %s: %s", p, exc)
        return set()

    words: set[str] = set()
    seen_first_entry = False
    try:
        with p.open("r", encoding=encoding, errors="replace", newline="") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                if _is_metadata_line(line, is_first_entry=not seen_first_entry):
                    # The Hunspell count header is "the first non-blank line".
                    # Mark it seen so a later numeric line (unlikely) isn't
                    # misread as another header.
                    seen_first_entry = True
                    continue
                seen_first_entry = True
                for tok in _extract_tokens(line):
                    words.add(tok)
    except OSError as exc:
        logger.warning("custom_dict: read error on %s: %s", p, exc)
        return words

    return words


def _env_paths() -> list[Path]:
    raw = os.environ.get(ENV_VAR, "")
    if not raw:
        return []
    return [Path(p) for p in raw.split(os.pathsep) if p.strip()]


def _discover_bundled() -> list[Path]:
    if not DICTIONARIES_DIR.is_dir():
        return []
    out: list[Path] = []
    for pattern in ("*.dic", "*.txt"):
        out.extend(sorted(DICTIONARIES_DIR.glob(pattern)))
    return out


@lru_cache(maxsize=1)
def load_all_custom_dicts() -> frozenset[str]:
    """Union of every bundled dic plus every env-configured dic path.

    Cached per-process — the dictionaries don't change at runtime and loading
    a 98k-line file on every analyze request would be wasteful. Call
    `.cache_clear()` to force a reload (tests do this).
    """
    words: set[str] = set()
    for path in _discover_bundled():
        words |= load_dic_file(path)
    for path in _env_paths():
        words |= load_dic_file(path)
    return frozenset(words)


def iter_dic_files(extra: Iterable[str | os.PathLike] | None = None) -> list[Path]:
    """Return the ordered list of dic file paths that would be loaded.

    Exposed for diagnostics / admin UI — not used on the hot path.
    """
    out = _discover_bundled() + _env_paths()
    if extra:
        out.extend(Path(p) for p in extra)
    return out
