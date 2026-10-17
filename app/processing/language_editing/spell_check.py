"""
Typo detection for Language Editing.

The existing `spelling` category covers house-style enforcement (variant→canonical
dictionary + UK/US pair substitution). This module is a complementary check for
genuine typographical errors — e.g. `teh → the`, `recieve → receive` — using
pyspellchecker.

Findings produced here are tagged `category="typo"` so they stay separate from
the existing `spelling` findings in the UI and in the DB.

The checker respects:
  * The project's variant_to_canonical dict (both keys and values)
  * The hard-coded UK/US pair list (so a British spelling isn't flagged as a typo)
  * The project's active term lists (so technical terms aren't flagged)
  * All-caps tokens (acronyms)
  * Tokens containing digits (identifiers, versions)
  * URLs / DOIs / emails
  * Mid-sentence capitalized tokens that aren't in the dictionary (proper nouns)
  * Exclude-spans passed in from the caller (so a word already flagged as a
    `spelling` rule finding doesn't also get flagged here as a typo)

The checker NEVER mutates the source text — it just emits Finding rows.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from .rules import Finding

try:
    from spellchecker import SpellChecker  # type: ignore
except ImportError:  # pragma: no cover - handled at caller level
    SpellChecker = None  # type: ignore


# Word-shaped tokens, allowing internal apostrophe or hyphen (don't, co-op).
_TOKEN_RE = re.compile(r"[A-Za-z]+(?:['\-’][A-Za-z]+)*")

# URLs, DOIs, emails — any token overlapping these is skipped.
_URL_RE = re.compile(
    r"https?://\S+|www\.\S+|[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}|"
    r"doi\.org/\S+|10\.\d{4,9}/\S+",
    re.IGNORECASE,
)

# Below this length words are too short / too likely to be initials to be
# useful typo candidates. "I", "an", "AI", "ok" fall out.
_SKIP_MIN_LEN = 3

# Max number of suggestions appended to each finding's message.
_DEFAULT_MAX_SUGGESTIONS = 3

# For tokens at or below this length, only distance-1 candidates are
# considered valid corrections. Distance-2 ranking by frequency produces
# wild substitutions on short tokens (e.g. `pre -> are` is 2 edits over 3
# chars and `are` has the highest raw frequency — it dominates ranking).
# Capping to distance 1 keeps genuine short typos like `teh -> the`
# (distance 1) while rejecting unrelated higher-freq distance-2 words.
_SHORT_TOKEN_MAX_LEN = 4

# Valid standalone English words that pyspellchecker's small base dict
# misses. These are legitimate dictionary entries (prefix-adverbs,
# adjectives, short common words) — adding them is not a "blind ignore
# list" per req #4, it's filling a known gap in the base lexicon so
# obvious false positives like `pre -> are` disappear.
# Kept intentionally short and manually vetted; add only well-attested
# standalone forms.
_EXTRA_KNOWN_WORDS: frozenset[str] = frozenset({
    # Prefix-adverbs commonly used standalone in academic/scientific writing
    "pre", "multi", "intra",
    # Common dictionary words sometimes missed by small base dicts
    "ok", "etc",
})

# Common English prefixes used both as bound morphemes and as standalone
# shorthand when paired with a hyphenated companion in the same paragraph
# (e.g. "pre and post-intervention"). Only used to compute paragraph-local
# whitelists — never applied globally.
_PREFIX_WHITELIST_CANDIDATES: frozenset[str] = frozenset({
    "pre", "post", "non", "anti", "pro", "co", "re", "sub", "super", "semi",
    "multi", "inter", "intra", "over", "under", "trans", "extra", "ultra",
    "hyper", "hypo", "micro", "macro", "mega", "mini", "mid", "self", "ex",
    "ante", "well", "ill", "cross", "neo", "para",
})


def _is_all_caps(w: str) -> bool:
    return len(w) > 1 and w.isupper()


def _levenshtein(a: str, b: str) -> int:
    """Damerau-Levenshtein edit distance (adjacent transposition = 1 edit).

    We count transpositions as 1 edit because the common `teh -> the` typo
    is a transposition; without Damerau's extra rule that would score as 2
    and the short-token filter would reject the correct suggestion.
    """
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    la, lb = len(a), len(b)
    # Full DP matrix so we can look back 2 rows/cols for the transposition rule.
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(
                d[i - 1][j] + 1,          # deletion
                d[i][j - 1] + 1,          # insertion
                d[i - 1][j - 1] + cost,   # substitution
            )
            if (i > 1 and j > 1
                    and a[i - 1] == b[j - 2]
                    and a[i - 2] == b[j - 1]):
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)  # transposition
    return d[la][lb]


def _contains_digit(w: str) -> bool:
    return any(c.isdigit() for c in w)


def _spans(regex: re.Pattern[str], text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in regex.finditer(text)]


def _in_any_span(a: int, b: int, spans: Iterable[tuple[int, int]]) -> bool:
    for s, e in spans:
        if a < e and b > s:
            return True
    return False


def _sentence_start_positions(text: str) -> set[int]:
    """Byte offsets at which a new sentence begins.

    Used to treat mid-sentence capitalized tokens as likely proper nouns.
    Sentence-initial capitalized tokens are still checked normally.
    """
    starts: set[int] = {0}
    # Period/question/exclamation followed by whitespace and a letter.
    for m in re.finditer(r"[.!?]\s+(?=[A-Za-z])", text):
        starts.add(m.end())
    return starts


def get_spell_checker(custom_words: Optional[Iterable[str]] = None):
    """Build (and prime) a SpellChecker instance. Returns None if the library
    isn't importable (graceful degradation for callers)."""
    if SpellChecker is None:
        return None
    sc = SpellChecker(language="en", distance=2)
    # Always load the vetted extras — these are valid English words the base
    # dict misses and would otherwise produce obvious false positives.
    sc.word_frequency.load_words(list(_EXTRA_KNOWN_WORDS))
    if custom_words:
        extras = [w.lower() for w in custom_words if w]
        if extras:
            sc.word_frequency.load_words(extras)
    return sc


def _paragraph_prefix_companions(text: str) -> set[str]:
    """Return prefixes that appear as the first half of a hyphenated token
    in this paragraph, limited to the vetted prefix set.

    "pre and post-intervention" -> {"post"} from `post-intervention`.
    If the standalone token ("pre") is ALSO in the vetted prefix set, we
    allow it: the writer is clearly using it as shorthand paired with its
    hyphenated companion. Scoped per-paragraph so this never leaks to
    unrelated contexts (req #4)."""
    found: set[str] = set()
    for m in re.finditer(r"\b([A-Za-z]{2,})-[A-Za-z]+", text):
        pfx = m.group(1).lower()
        if pfx in _PREFIX_WHITELIST_CANDIDATES:
            found.add(pfx)
    return found


def build_whitelist(
    variant_to_canonical: Optional[dict] = None,
    uk_us_pairs: Optional[Iterable[tuple[str, str]]] = None,
    term_vocabulary: Optional[Iterable[str]] = None,
    extras: Optional[Iterable[str]] = None,
) -> set[str]:
    """Build a lowercased set of words that should never be flagged as typos."""
    out: set[str] = set()

    def _add(x):
        if x:
            out.add(x.lower())

    if variant_to_canonical:
        for k, v in variant_to_canonical.items():
            _add(k)
            _add(v)
    if uk_us_pairs:
        for uk, us in uk_us_pairs:
            _add(uk)
            _add(us)
    if term_vocabulary:
        for phrase in term_vocabulary:
            if not phrase:
                continue
            for t in _TOKEN_RE.findall(phrase):
                _add(t)
    if extras:
        for x in extras:
            _add(x)
    return out


def spell_check_paragraph(
    text: str,
    sc,
    whitelist: Optional[set[str]] = None,
    exclude_spans: Optional[list[tuple[int, int]]] = None,
    max_suggestions: int = _DEFAULT_MAX_SUGGESTIONS,
) -> list[Finding]:
    """Return 'typo' findings for `text` using the provided SpellChecker.

    `exclude_spans` is used for **exact-span deduplication** against findings
    produced by other categories (typically word-level spelling/grammar rules).
    A typo is dropped only when its (start, end) exactly matches one of the
    excluded spans — so a sentence-level finding covering `[100, 500]` will
    NOT suppress a typo on `[200, 206]`, because they represent different
    issues (sentence rewrite vs. word spelling) per the dedup spec.

    URL/email spans are detected internally and skipped using overlap
    semantics (we don't want to flag words inside https://… links).

    Each returned Finding uses offsets relative to `text`."""
    if sc is None or not text:
        return []
    whitelist = whitelist or set()
    # Exact-span dedup set from upstream rule findings.
    dedupe = set(exclude_spans or [])
    # Overlap-based skip for URL/email/DOI runs.
    url_spans = _spans(_URL_RE, text)
    starts = _sentence_start_positions(text)
    # Paragraph-local prefix whitelist from hyphenated companions.
    # "pre and post-intervention" → `post` extracted → allows BOTH `pre` and
    # `post` as standalone shorthand in THIS paragraph only. Union with the
    # caller whitelist (immutable copy to avoid mutating the caller's set).
    paragraph_companions = _paragraph_prefix_companions(text)
    if paragraph_companions:
        # The hyphenated prefix itself (`post`) + every other prefix in the
        # vetted candidate set is considered valid shorthand when any
        # hyphenated companion is present. This handles "pre and
        # post-intervention" where `pre` has no `pre-X` companion of its
        # own but is clearly paired semantically with `post-X`.
        whitelist = whitelist | _PREFIX_WHITELIST_CANDIDATES

    # Pre-collect candidate tokens so we can run `.unknown()` as a batch
    # (minor speedup; pyspellchecker iterates internally regardless).
    tokens: list[tuple[int, int, str, bool]] = []
    for m in _TOKEN_RE.finditer(text):
        w = m.group(0)
        s, e = m.start(), m.end()
        # Dedup: exact span match wins — the word is already flagged by a
        # word-level rule (house-style, UK/US, etc.), prefer that one.
        if (s, e) in dedupe:
            continue
        # URL/email runs: overlap skip — any token inside a URL is ignored.
        if _in_any_span(s, e, url_spans):
            continue
        if len(w) < _SKIP_MIN_LEN or _contains_digit(w) or _is_all_caps(w):
            continue
        # Hyphenated compounds (by-product, co-op): skip — pyspellchecker's
        # dict only has unigrams, so compounds generate too many false positives.
        if "-" in w:
            continue
        sentence_initial = s in starts
        wl = w.lower()
        # Strip possessive suffix (nurse's, nurse’s) before dictionary lookup
        # — pyspellchecker's base dict is lemma-only and would flag every
        # possessive as a typo otherwise.
        wl_stem = re.sub(r"['’]s$", "", wl)
        if wl in whitelist or wl_stem in whitelist:
            continue
        # Mid-sentence capitalized tokens — if they're in the dictionary we
        # won't flag them anyway; if they're NOT in the dictionary we treat
        # them as proper nouns and skip (false-negative on genuine typos
        # mid-sentence that start with a capital — accepted tradeoff).
        tokens.append((s, e, w, sentence_initial))

    if not tokens:
        return []

    # Batch-ask which lowercased words are unknown. Besides the raw token we
    # also check:
    #   * possessive stem  (nurse's -> nurse)
    #   * common-prefix stem  (coregulation -> regulation, nonjudgment -> judgment)
    #   * common-suffix stem  (ethnicities -> ethnicity, dysregulation -> dysregulate)
    # pyspellchecker's base dictionary is lemma-oriented and misses many
    # legitimate morphological variants. If any derived form IS in the dict,
    # accept the token as correct.
    PREFIXES = ("non", "co", "re", "un", "dis", "mis", "pre", "over", "under",
                "anti", "sub", "super", "inter", "intra", "post", "semi", "multi")
    SUFFIX_RULES = [
        (re.compile(r"(.+)ies$"), r"\1y"),      # ethnicities -> ethnicity
        (re.compile(r"(.+)ied$"), r"\1y"),      # qualified -> qualify
        (re.compile(r"(.+)ying$"), r"\1y"),     # trying -> try
        (re.compile(r"(.+)s$"), r"\1"),         # apps -> app
        (re.compile(r"(.+)ed$"), r"\1"),        # walked -> walk
        (re.compile(r"(.+)ing$"), r"\1"),       # running -> run
        (re.compile(r"(.+)ly$"), r"\1"),        # quickly -> quick
        (re.compile(r"(.+)ness$"), r"\1"),      # happiness -> happy
        (re.compile(r"(.+)tion$"), r"\1te"),    # traumatization -> traumatize
        (re.compile(r"(.+)ization$"), r"\1ize"),# traumatization -> traumatize
    ]

    def _morph_variants(w: str) -> list[str]:
        """Return candidate stems/derivations to also check in the dict."""
        out: list[str] = []
        # Normalize curly apostrophe to ASCII — pyspellchecker's dict only has
        # ASCII contractions (don't, not don’t).
        out.append(w.replace("’", "'"))
        out.append(re.sub(r"['’]s$", "", w))  # possessive
        for p in PREFIXES:
            if w.startswith(p) and len(w) > len(p) + 3:
                out.append(w[len(p):])  # strip prefix
        for rx, repl in SUFFIX_RULES:
            m = rx.match(w)
            if m:
                out.append(rx.sub(repl, w))
        return out

    lc_words: set[str] = set()
    variants: set[str] = set()
    for _, _, w, _ in tokens:
        lw = w.lower()
        lc_words.add(lw)
        for v in _morph_variants(lw):
            variants.add(v)
    known_set = sc.known(lc_words) | sc.known(variants)
    unknown = {w for w in lc_words
               if w not in known_set
               and not any(v in known_set for v in _morph_variants(w))}
    if not unknown:
        return []

    # Cache suggestions per lowercase word (candidates() is Levenshtein-heavy).
    sugg_cache: dict[str, list[str]] = {}

    out: list[Finding] = []
    for s, e, w, sentence_initial in tokens:
        wl = w.lower()
        if wl not in unknown:
            continue
        # Any unknown Title-case token is treated as a proper noun and
        # skipped — including sentence-initial. Published manuscripts have
        # dense proper nouns (author surnames, drug names, place names) that
        # pyspellchecker's base English dict doesn't carry; flagging them is
        # overwhelming noise. The tradeoff: a sentence-initial lowercase-
        # pretending-to-be-uppercase typo ("Teh cat") won't be caught. The
        # common typo cases (lowercase misspellings mid-sentence) still fire.
        if len(w) > 1 and w[0].isupper():
            continue
        if wl not in sugg_cache:
            cands = sc.candidates(wl)
            if not cands:
                sugg_cache[wl] = []
            else:
                # For short tokens, pyspellchecker's distance=2 search returns
                # candidates that differ by 2 edits across ≤4 chars — those
                # are usually unrelated high-frequency words (`pre→are`,
                # `pre→pie`). Restrict short-token suggestions to edit
                # distance 1; if there are none, emit no suggestion so the
                # finding is dropped entirely (per req #5: never suggest an
                # invalid correction).
                if len(wl) <= _SHORT_TOKEN_MAX_LEN:
                    cands = {c for c in cands
                             if _levenshtein(wl, c.lower()) <= 1}
                if not cands:
                    sugg_cache[wl] = []
                else:
                    # pyspellchecker returns a set; rank by raw corpus
                    # frequency (higher is more probable). WordFrequency is
                    # dict-like with __getitem__; use __contains__ to avoid
                    # KeyError.
                    def _freq(c: str) -> int:
                        try:
                            return sc.word_frequency[c] if c in sc.word_frequency else 0
                        except Exception:
                            return 0
                    scored = sorted(cands, key=lambda c: -_freq(c))
                    sugg_cache[wl] = scored[:max_suggestions]
        suggestions = sugg_cache[wl]
        if not suggestions:
            continue
        best = suggestions[0]
        # Preserve input case.
        if w.isupper():
            best = best.upper()
        elif w[:1].isupper():
            best = best[:1].upper() + best[1:]
        alts = suggestions[1:]
        msg = f"Possible typo: '{w}' -> '{best}'"
        if alts:
            # Case-preserve alts for display.
            disp_alts = []
            for a in alts:
                if w.isupper():
                    disp_alts.append(a.upper())
                elif w[:1].isupper():
                    disp_alts.append(a[:1].upper() + a[1:])
                else:
                    disp_alts.append(a)
            msg += f" (alt: {', '.join(disp_alts)})"
        out.append(Finding(
            rule_id=f"typo:{wl}",
            category="typo",
            start=s,
            end=e,
            original=w,
            suggestion=best,
            message=msg,
            severity="warning",
            autofixable=False,
        ))
    return out
