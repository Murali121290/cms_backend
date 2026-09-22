"""
Sentence and token segmentation with precise paragraph-relative character offsets.
Guards against abbreviations (e.g., 'Fig.', 'et al.') and decimal numbers.
"""
import re

_ABBREV = {
    "dr", "mr", "mrs", "ms", "prof", "fig", "eq", "no", "vol", "pp", "al", "eg",
    "ie", "etc", "vs", "st", "jr", "sr", "approx", "dept", "inc", "ltd", "co"
}

_SENT_END = re.compile(r'([.!?]["\')\]]?)(\s+)(?=[A-Z0-9"\'(\[])')


def sentences(text: str) -> list[tuple[int, int, str]]:
    """
    Yield list of (start_char_offset, end_char_offset, sentence_text),
    guarding abbreviations and decimals.
    """
    if not text:
        return []

    spans = []
    start = 0

    for m in _SENT_END.finditer(text):
        end = m.end(1)
        # Extract word right before terminal period/punctuation
        prev_slice = text[max(0, end - 8):end - 1]
        prev_parts = re.split(r'[\s(]', prev_slice)
        prev = prev_parts[-1].lower().strip('."\'') if prev_parts else ""

        if prev in _ABBREV:
            # e.g. "Fig. 7" or "et al. 2020" — not a sentence boundary
            continue

        if end >= 2 and text[end - 2].isdigit() and end < len(text) and text[end].isdigit():
            # decimal number like 3.14
            continue

        spans.append((start, end))
        start = m.end(2)

    if start < len(text):
        spans.append((start, len(text)))

    return [(s, e, text[s:e]) for s, e in spans]


def words(text: str) -> list[tuple[int, int, str]]:
    """Yield list of (start_char_offset, end_char_offset, word) for word-like tokens."""
    return [
        (m.start(), m.end(), m.group(0))
        for m in re.finditer(r"[A-Za-z][A-Za-z\-']*", text)
    ]
