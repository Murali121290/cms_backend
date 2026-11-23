"""
Content Stream Text Recoloring Utilities for PDF Post-Production.

Surgically injects color operators (<r> <g> <b> rg) directly into PDF page
content streams around URL and email text, preserving glyph IDs, text matrices,
and layout without the font corruption caused by PyMuPDF redaction.
"""
import re
from typing import List, Tuple


def is_standalone_url_or_email(s: str) -> bool:
    """
    Check if a string represents an independent URL or email address.
    Prevents regular body words (e.g. 'culture', 'table') from being recolored.
    """
    if not s:
        return False
    s_clean = s.strip().lower()
    if s_clean.startswith(('http://', 'https://', 'ftp://', 'www.')):
        return True
    if '@' in s_clean and any(
        ext in s_clean for ext in ['.com', '.org', '.edu', '.gov', '.net', '.io', '.co', '.pub', '.info']
    ):
        return True
    if any(s_clean.startswith(d) for d in ['doi.org', 'dx.doi.org', 'springerpub.com', 'connect.springerpub.com']):
        return True
    if re.match(r'^[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-]+\.(?:gov|org|edu|com|net|io)', s_clean):
        return True
    return False


def _find_valid_occurrence(full_str: str, target: str) -> int:
    """
    Finds the start index of target in full_str ensuring word/URL boundary integrity.
    Prevents short segments like 'https://' or 'http://www' from matching as prefixes
    inside longer URLs (e.g. 'https://doi.org/...').
    """
    idx = 0
    while True:
        pos = full_str.find(target, idx)
        if pos == -1:
            return -1
        end_pos = pos + len(target)

        # Left boundary: if target starts with url prefix/protocol, char before shouldn't be alphanumeric
        valid_left = (pos == 0 or not full_str[pos - 1].isalnum())

        # Right boundary: if target is a protocol or 'www' prefix, next char shouldn't be domain/path continuation
        valid_right = True
        if target in ('http://', 'https://', 'http://www', 'https://www'):
            if end_pos < len(full_str) and (full_str[end_pos].isalnum() or full_str[end_pos] in '.-/'):
                valid_right = False

        if valid_left and valid_right:
            return pos
        idx = pos + 1


def _recolor_tj_content(content: str, target: str, color_op: str, default_op: str) -> Tuple[str, bool]:
    """Recolors target inside a single Tj string."""
    idx = _find_valid_occurrence(content, target)
    if idx == -1:
        return f"({content})Tj", False
    before = content[:idx]
    matched = content[idx:idx + len(target)]
    after = content[idx + len(target):]
    res = []
    if before:
        res.append(f"({before})Tj")
    res.append(color_op)
    res.append(f"({matched})Tj")
    res.append(default_op)
    if after:
        res.append(f"({after})Tj")
    return '\n'.join(res), True


def _recolor_tj_array_tokens(
    arr_content: str,
    target: str,
    color_op: str,
    default_op: str,
    must_start_at_zero: bool = False
) -> Tuple[str, bool]:
    """Recolors target inside a single [...]TJ array preserving kerning and glyphs."""
    tokens = []
    pos = 0
    while pos < len(arr_content):
        if arr_content[pos] == '(':
            end = pos + 1
            while end < len(arr_content):
                if arr_content[end] == ')' and arr_content[end - 1] != '\\':
                    break
                end += 1
            tokens.append(('str', arr_content[pos + 1:end]))
            pos = end + 1
        elif arr_content[pos] in ' \t\r\n':
            pos += 1
        else:
            end = pos
            while end < len(arr_content) and arr_content[end] not in ' \t\r\n(':
                end += 1
            tokens.append(('num', arr_content[pos:end]))
            pos = end

    full_str = ''.join(val for typ, val in tokens if typ == 'str')
    idx = _find_valid_occurrence(full_str, target)
    if idx == -1:
        return f"[{arr_content}]TJ", False

    if must_start_at_zero:
        leading = full_str[:idx].strip()
        if leading and leading not in ('-', '/', '—', '–'):
            return f"[{arr_content}]TJ", False

    start_char_idx = idx
    end_char_idx = start_char_idx + len(target)

    before_tokens = []
    matched_tokens = []
    after_tokens = []

    cur_char_idx = 0
    for typ, val in tokens:
        if typ == 'num':
            if cur_char_idx <= start_char_idx:
                before_tokens.append((typ, val))
            elif cur_char_idx >= end_char_idx:
                after_tokens.append((typ, val))
            else:
                matched_tokens.append((typ, val))
        else:
            tok_len = len(val)
            tok_start = cur_char_idx
            tok_end = cur_char_idx + tok_len
            cur_char_idx = tok_end

            if tok_end <= start_char_idx:
                before_tokens.append((typ, val))
            elif tok_start >= end_char_idx:
                after_tokens.append((typ, val))
            else:
                overlap_start = max(0, start_char_idx - tok_start)
                overlap_end = min(tok_len, end_char_idx - tok_start)

                if overlap_start > 0:
                    before_tokens.append(('str', val[:overlap_start]))
                matched_tokens.append(('str', val[overlap_start:overlap_end]))
                if overlap_end < tok_len:
                    after_tokens.append(('str', val[overlap_end:]))

    def format_tokens(tok_list):
        if not tok_list:
            return ""
        parts = []
        for typ, val in tok_list:
            if typ == 'str':
                parts.append(f"({val})")
            else:
                parts.append(str(val))
        return "[" + " ".join(parts) + "]TJ"

    chunks = []
    if before_tokens:
        chunks.append(format_tokens(before_tokens))
    chunks.append(color_op)
    chunks.append(format_tokens(matched_tokens))
    chunks.append(default_op)
    if after_tokens:
        chunks.append(format_tokens(after_tokens))

    return '\n'.join(chunks), True


def recolor_url_in_stream(
    stream: str,
    segments: List[str],
    color_rgb=(0.06, 0.45, 0.75),
    default_rgb=(0.1373, 0.1216, 0.1255)
) -> str:
    """
    Recolors a URL or email (single-line or multi-line segments) in a PDF content stream.
    Strictly prevents recoloring non-URL text:
    - Segments starting with http://, https://, www. or emails are matched.
    - Continuation segments are ONLY matched in the immediate subsequent text object
      directly following the prefix, anchored at the line start.
    """
    if not segments:
        return stream

    prefix_target = segments[0].strip()
    if not prefix_target or not is_standalone_url_or_email(prefix_target):
        return stream

    color_op = f"{color_rgb[0]:.4f} {color_rgb[1]:.4f} {color_rgb[2]:.4f} rg"
    default_op = f"{default_rgb[0]:.4f} {default_rgb[1]:.4f} {default_rgb[2]:.4f} rg"

    # Precise non-greedy patterns that cannot cross operator boundaries
    text_obj_pattern = re.compile(
        r'(?:\[(?P<arr>[^\[\]]*)\]TJ|\((?P<str>(?:[^()\\]|\\.)*)\)Tj)'
    )

    matches = list(text_obj_pattern.finditer(stream))
    target_match_idx = -1
    replacement_str = None

    for idx, m in enumerate(matches):
        surrounding_start = max(0, m.start() - len(color_op) - 5)
        surrounding_end = min(len(stream), m.end() + len(default_op) + 5)
        if color_op in stream[surrounding_start:surrounding_end]:
            continue

        if m.group('arr') is not None:
            new_text, matched = _recolor_tj_array_tokens(
                m.group('arr'), prefix_target, color_op, default_op
            )
        else:
            content = m.group('str')
            if prefix_target in content:
                new_text, matched = _recolor_tj_content(content, prefix_target, color_op, default_op)
            else:
                matched = False
                new_text = m.group(0)

        if matched:
            target_match_idx = idx
            replacement_str = new_text
            break

    if target_match_idx == -1:
        return stream

    m_prefix = matches[target_match_idx]
    stream = stream[:m_prefix.start()] + replacement_str + stream[m_prefix.end():]

    # If there are continuation segments (multi-line URL)
    if len(segments) > 1:
        cont_target = segments[1].strip()
        if cont_target:
            prefix_end_pos = m_prefix.start() + len(replacement_str)
            next_m = text_obj_pattern.search(stream, prefix_end_pos)
            if next_m and (next_m.start() - prefix_end_pos) < 500:
                if next_m.group('arr') is not None:
                    new_cont_text, cont_matched = _recolor_tj_array_tokens(
                        next_m.group('arr'), cont_target, color_op, default_op, must_start_at_zero=True
                    )
                else:
                    content = next_m.group('str')
                    if content.strip().startswith(cont_target):
                        new_cont_text, cont_matched = _recolor_tj_content(content, cont_target, color_op, default_op)
                    else:
                        cont_matched = False
                        new_cont_text = next_m.group(0)

                if cont_matched:
                    stream = stream[:next_m.start()] + new_cont_text + stream[next_m.end():]

    return stream


def recolor_text_in_stream(
    stream: str,
    target: str,
    color_rgb=(0.06, 0.45, 0.75),
    default_rgb=(0.1373, 0.1216, 0.1255)
) -> str:
    """Backward compatibility wrapper that delegates safely to recolor_url_in_stream."""
    return recolor_url_in_stream(stream, [target], color_rgb=color_rgb, default_rgb=default_rgb)
