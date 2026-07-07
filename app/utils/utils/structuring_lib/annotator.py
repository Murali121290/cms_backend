# annotator.py
"""
Document annotation module.
Identifies and tags document elements (headings, sections, lists, etc).
"""

import re
import logging
import unicodedata
from typing import List, Dict, Any, Optional
from docx.document import Document
from docx.text.paragraph import Paragraph
from .rules_loader import get_rules_loader
from .logger_config import get_logger

logger = get_logger(__name__)
rules_loader = get_rules_loader()
EXPLICIT_STYLE_RE = re.compile(
    # Token allows internal spaces (lazily captured, trailing space left to
    # \s*) so multi-word box markers like "<CASE STUDY>"/"<RED FLAG>" parse
    # as a single explicit token instead of falling through unrecognized.
    # Underscore is included so "BX<number>_<value>" box markers parse too.
    r"^(?:<\s*(/?[A-Za-z0-9.\-_ ]+?)\s*>|\[STYLE:([A-Za-z0-9.\-]+)\])",
    re.IGNORECASE,
)

# Two-pass BX box markers: "BX<number>-<value>", "BX<number>_<value>", or
# "NBX<number>-<value>" (e.g. "BX1-Header", "BX4_Section", "NBX2-Important").
# The suffix only disambiguates which opening marker a given closing marker
# pairs with - it carries no semantic meaning and is never included in the
# generated prefix - see box_prefixer.py for the two-pass matching/prefixing
# logic itself.
_BOX_MARKER_RE = re.compile(r"^/?(?:(BX\d+)[-_]|(NBX\d+)-)(.+)$")

# Fixed-keyword box markers - no number, no suffix, no separator: the bare
# token itself ("COUT") is both the marker and the generated prefix. Kept in
# its own set (mirrored in box_prefixer.py) rather than folded into
# _BOX_MARKER_RE, since these have an entirely different shape.
_BARE_BOX_MARKERS = {"COUT"}


def _is_reserved_box_suffix(suffix: str) -> bool:
    """True if *suffix* is itself a recognized base structural tag (e.g.
    "H1"/"TXT", via the structural_tags registry) or one of the box
    title/body suffixes derived from rules.yaml's box config (e.g. "TTL") -
    i.e. it looks like an already-resolved content tag rather than a fresh,
    author-chosen box-marker label. Without this, something like "BX1-TTL"
    (a real, standalone explicit title tag - see
    test_explicit_list_and_box_tags_are_preserved_verbatim) would be
    mistaken for a fresh, never-closed box marker and downgraded to PMI."""
    if _is_recognized_structural_tag(suffix):
        return True
    box_cfg = rules_loader.get_box_config()
    values = [box_cfg.get(k, "") for k in ("title_style", "body_style", "first_body_style")]
    for pair in box_cfg.get("subtype_styles", {}).values():
        values.extend(pair.values())
    return any(v and "-" in v and v.split("-", 1)[1].upper() == suffix.upper() for v in values)


def _match_box_marker(token: Optional[str]):
    """Match a box marker in any of the supported formats - returning
    (base_id, is_close) - or None if *token* isn't shaped like one, or its
    suffix is itself a reserved/already-resolved content-tag suffix (see
    _is_reserved_box_suffix) rather than a fresh marker label."""
    if not token:
        return None
    token = token.strip()
    is_close = token.startswith("/")
    if (token[1:] if is_close else token) in _BARE_BOX_MARKERS:
        return (token[1:] if is_close else token), is_close
    match = _BOX_MARKER_RE.match(token)
    if not match:
        return None
    base_id = match.group(1) or match.group(2)
    suffix = match.group(3)
    if _is_reserved_box_suffix(suffix):
        return None
    return base_id, is_close


# Springer's human-word box marker convention - "Box<N>-open"/"Box<N>-close"
# (mixed case, distinguished by the word "close" rather than a leading "/").
# Recognized only when the caller opts in (annotate_document's
# recognize_springer_box_markers=True, set by styler.process_docx when a
# tag_set is active) - kept separate from _match_box_marker's native
# "BX<N>-<suffix>" convention rather than folded in, since both sides here
# must pair under the *same* canonical suffix ("open") regardless of which
# word was written, whereas the native convention's suffix is an arbitrary
# author-chosen label that must match exactly between open and close.
_SPRINGER_BOX_OPEN_CLOSE_RE = re.compile(r"^box(\d+)-(open|close)$", re.IGNORECASE)


def _match_springer_box_marker(token: Optional[str]):
    """Match Springer's "Box<N>-open"/"Box<N>-close" convention - returning
    (base_id, is_close, pairing_marker, display_prefix), or None if *token*
    doesn't match.

    *pairing_marker* is always "BX<N>-open" for both sides of a pair (never
    "BX<N>-close"), since box_prefixer.py's two-pass matching requires an
    open/close pair's full marker string to be identical - mirroring how
    the now-retired _canonical_box_open_close_token in styler.py collapsed
    both words onto the same canonical suffix. Computed here purely for
    in-memory pairing/tagging; the paragraph's actual text is never
    rewritten.

    *display_prefix* ("Box<N>") is separate from *base_id* ("BX<N>") so the
    applied Word *style* can keep Springer's own "Box"-spelled wording
    (e.g. "Box1-close") instead of switching to the canonical "BX"
    spelling - matching the marker text the author actually typed, so
    Draft view doesn't show a confusing mismatch between the marker and
    its own style label."""
    if not token:
        return None
    match = _SPRINGER_BOX_OPEN_CLOSE_RE.match(token.strip())
    if not match:
        return None
    num, kind = match.groups()
    base_id = f"BX{num}"
    is_close = kind.lower() == "close"
    return base_id, is_close, f"{base_id}-open", f"Box{num}"


# A closing box marker may now trail real paragraph content on the same
# line (e.g. "Some paragraph text.</BX1-Header>"), unlike opening markers,
# which must still appear only at the start of a block. This only looks for
# a tag-shaped construct anchored at the very end of the text.
_TRAILING_CLOSE_TAG_RE = re.compile(r"<\s*/\s*([A-Za-z0-9.\-_ ]+?)\s*>\s*$")


def _strip_trailing_box_close(text: str):
    """If *text* ends with a closing box marker, strip it and return
    (clean_text, full_marker); otherwise return (text, None) unchanged.

    Reuses _match_box_marker's recognition/exclusion rules, so a trailing
    already-resolved structural tag (e.g. "...text.</BX1-TXT>") is never
    mistaken for a closing marker, exactly like the leading-marker case.
    Only fires when real content remains after stripping - a line that is
    *entirely* the closing marker (e.g. "</BX1-Header>" alone) is left
    untouched here and continues to go through the existing leading-marker
    path, which already handles whole-marker-only lines."""
    if not text:
        return text, None
    match = _TRAILING_CLOSE_TAG_RE.search(text)
    if not match:
        return text, None
    clean_text = text[: match.start()].rstrip()
    if not clean_text:
        return text, None
    token = "/" + match.group(1).strip()
    box_marker_match = _match_box_marker(token)
    if not box_marker_match:
        return text, None
    return clean_text, token.lstrip("/")


# =========================
# Helpers
# =========================

def is_list_paragraph(paragraph: Paragraph) -> bool:
    """
    Detect if paragraph is a list item (has numbering or bullets).
    
    Args:
        paragraph: python-docx Paragraph object
    
    Returns:
        True if paragraph has list formatting
    """
    try:
        p = paragraph._p
        if p.pPr is not None and p.pPr.numPr is not None:
            return True
        # Check if list formatting is inherited from the style
        if paragraph.style is not None and hasattr(paragraph.style, '_element'):
            from docx.oxml.ns import qn
            style_pPr = paragraph.style._element.find(qn('w:pPr'))
            if style_pPr is not None and style_pPr.find(qn('w:numPr')) is not None:
                return True
        return False
    except Exception as e:
        logger.debug(f"Error checking list formatting: {e}")
        return False


def get_word_list_type(para: Paragraph, doc: Document) -> Optional[tuple[str, Optional[str]]]:
    """
    Determine if a Word-formatted list paragraph is bulleted, numbered,
    lettered, or roman by querying the document's numbering.xml part.

    Returns (list_kind, case) where case is "upper"/"lower" for
    lettered/roman kinds (derived directly from the numFmt value) and
    None otherwise, or None if no list formatting is found.
    """
    try:
        p = para._p
        if p.pPr is None or p.pPr.numPr is None:
            return None
            
        num_id = p.pPr.numPr.numId.val
        ilvl = p.pPr.numPr.ilvl.val if p.pPr.numPr.ilvl is not None else 0
        
        numbering_part = doc.part.numbering_part
        if not numbering_part:
            return None
            
        # 1. Map numId to abstractNumId
        num_element = numbering_part.element.find(f'.//w:num[@w:numId="{num_id}"]', numbering_part.element.nsmap)
        if num_element is None:
            return None
            
        abstract_num_id_element = num_element.find('.//w:abstractNumId', numbering_part.element.nsmap)
        if abstract_num_id_element is None:
            return None
        abstract_num_id = abstract_num_id_element.get(f'{{{numbering_part.element.nsmap["w"]}}}val')
        
        # 2. Find abstractNum definition and the specific level
        abstract_num = numbering_part.element.find(f'.//w:abstractNum[@w:abstractNumId="{abstract_num_id}"]', numbering_part.element.nsmap)
        if abstract_num is None:
            return None
            
        lvl = abstract_num.find(f'.//w:lvl[@w:ilvl="{ilvl}"]', numbering_part.element.nsmap)
        if lvl is None:
            return None
            
        # 3. Read numFmt (bullet, decimal, lowerRoman, etc.)
        num_fmt = lvl.find('.//w:numFmt', numbering_part.element.nsmap)
        if num_fmt is not None:
            fmt_val = num_fmt.get(f'{{{numbering_part.element.nsmap["w"]}}}val')
            if fmt_val == 'bullet':
                return ('bullet', None)
            elif fmt_val == 'decimal':
                return ('number', None)
            elif fmt_val == 'lowerLetter':
                return ('lettered', 'lower')
            elif fmt_val == 'upperLetter':
                return ('lettered', 'upper')
            elif fmt_val == 'lowerRoman':
                return ('roman', 'lower')
            elif fmt_val == 'upperRoman':
                return ('roman', 'upper')
    except Exception as e:
        logger.debug(f"Error determining list type from XML: {e}")

    return None


def get_list_indent_level(para: Paragraph) -> int:
    """Return a Word list paragraph's 0-based indent level (w:numPr/w:ilvl),
    or 0 if the paragraph has no list numbering. Used to distinguish a
    top-level list item from a nested sub-item."""
    try:
        p = para._p
        if p.pPr is None or p.pPr.numPr is None or p.pPr.numPr.ilvl is None:
            return 0
        return p.pPr.numPr.ilvl.val
    except Exception as e:
        logger.debug(f"Error determining list indent level: {e}")
        return 0


def is_references_end(text: str) -> bool:
    """
    Detect end of references section.
    
    Args:
        text: Paragraph text to check
    
    Returns:
        True if text indicates end of references
    """
    if not text:
        return False
    
    text = text.strip()
    patterns = [
        r"^(?:FIGURE|Figure)\s+\d+",
        r"^(?:TABLE|Table)\s+\d+",
        r"^(?:BOX|Box)\s+\d+",
        r"^[A-Z][A-Z\s]{3,}$",
    ]
    
    return any(re.match(pattern, text) for pattern in patterns)


def detect_list_kind(text: str, style_name: str = "", is_word_list: bool = False, para: Optional[Paragraph] = None, doc: Optional[Document] = None) -> Optional[tuple[str, Optional[str]]]:
    """
    Detect the list type for a paragraph.

    Returns (list_kind, case), where list_kind is one of "bullet", "number",
    "roman", "lettered", or None if no list is detected. case is
    "upper"/"lower" for "lettered"/"roman" kinds (indicating the marker's
    letter case), and None for "bullet"/"number" or when case can't be
    determined.
    """
    list_config = rules_loader.get_list_patterns()
    bullet_pattern = list_config.get("bullet_pattern", r"^[•·\-\–]\s+")
    number_pattern = list_config.get("number_pattern", r"^\d+\.\s+")
    roman_pattern = list_config.get("roman_pattern", r"^(?i:[ivxlcdm]+)[\.)]\s+")

    mnemonic_pattern = list_config.get("mnemonic_pattern", r"^[A-Z](?:\t|[ ]{2,4}|[—–]\s*)\S")

    text = (text or "").strip()
    style_name = style_name or ""
    lowered_style = style_name.lower()

    if re.match(bullet_pattern, text) or "bullet" in lowered_style:
        return ("bullet", None)
    # Symbol bullets: any Unicode Symbol character (So/Sm/Sc/Sk) or Private-Use
    # character (Wingdings etc.) at the start of the paragraph.
    if text:
        cat = unicodedata.category(text[0])
        if cat.startswith('S') or cat == 'Co':
            return ("bullet", None)
    if re.match(number_pattern, text) or re.match(r"^\s*\d+[\.\)]\s+", text) or "number" in lowered_style:
        return ("number", None)
    # Roman is checked before lettered: valid roman-numeral letters
    # (ivxlcdm) are a strict subset of "any single letter", so a marker
    # like "i." or "v." must be resolved as roman here, before the more
    # general lettered patterns below get a chance to claim it.
    if re.match(roman_pattern, text):
        return ("roman", "upper" if text[:1].isupper() else "lower")
    if "roman" in lowered_style:
        return ("roman", None)
    uc_letter_pattern = list_config.get("uc_letter_pattern", r"^[A-Z][.)]\s+")
    if re.match(uc_letter_pattern, text):
        return ("lettered", "upper")
    lc_letter_pattern = list_config.get("lc_letter_pattern", r"^[a-z][.)]\s+")
    if re.match(lc_letter_pattern, text):
        return ("lettered", "lower")
    if re.match(mnemonic_pattern, text):
        return ("lettered", "upper")

    if is_word_list and para is not None and doc is not None:
        xml_type = get_word_list_type(para, doc)
        if xml_type:
            return xml_type
        # Fallback to number if xml parsing fails but it is a word list
        return ("number", None)

    return None


def parse_leading_style_hint(text: str) -> tuple[Optional[str], Optional[str], str]:
    """
    Parse a leading explicit tag or [STYLE:] hint.

    Returns:
        Tuple of (full_match, token, stripped_text)
    """
    text = text or ""
    match = EXPLICIT_STYLE_RE.match(text.strip())
    if not match:
        return None, None, text.strip()

    token = match.group(1) or match.group(2)
    stripped = text.strip()[len(match.group(0)):].strip()
    return match.group(0), token, stripped


def _resolve_box_keyword(token: Optional[str]) -> Optional[str]:
    """Case-insensitive lookup of a box-open keyword (e.g. 'NOTE', 'CASE STUDY')
    against rules.yaml's boxes.type_keywords map. Returns the resolved subtype
    prefix (e.g. 'NBX', 'BX1') or None if token isn't a recognized keyword."""
    if not token:
        return None
    box_cfg = rules_loader.get_box_config()
    type_keywords = box_cfg.get("type_keywords", {})
    if not type_keywords:
        return None
    lookup = {k.strip().upper(): v for k, v in type_keywords.items()}
    return lookup.get(token.strip().upper())


_BARE_NUMBERED_BOX_RE = re.compile(r"^BX(\d+)$", re.IGNORECASE)


def resolve_box_prefix(token: Optional[str]) -> str:
    """Resolve a box-open token to its style-prefix subtype, defaulting to
    'NBX'.

    A bare numbered token ("BX1", "BX2", ...) resolves to its own matching
    subtype prefix ("BX1", "BX2", ...) directly - it isn't a
    boxes.type_keywords alias (those are word-shaped, e.g. "NOTE"/"CASE
    STUDY"), so without this it silently fell back to the generic "NBX"
    default, losing the box's own number entirely."""
    keyword_prefix = _resolve_box_keyword(token)
    if keyword_prefix is not None:
        return keyword_prefix
    if token:
        numbered = _BARE_NUMBERED_BOX_RE.match(token.strip())
        if numbered:
            return f"BX{numbered.group(1)}"
    return "NBX"


def _is_recognized_structural_tag(token: str) -> bool:
    """Look up *token* against rules.yaml's `structural_tags` registry - the
    single centralized place listing every WK Book Template 1.1 structural
    tag (H1-H6, TXT, BL-FIRST, BX1-TTL, ...) that is treated as an
    author-provided, authoritative tag. Add new template tags there, not
    as ad-hoc checks scattered through this module."""
    if not token:
        return False
    cfg = rules_loader.get_structural_tags()
    token_upper = token.strip().upper()
    if token_upper in {t.upper() for t in cfg.get("exact", [])}:
        return True
    return any(token_upper.startswith(p.upper()) for p in cfg.get("prefixes", []))


def normalize_structural_tag_case(style_name: Optional[str]) -> Optional[str]:
    """Case-insensitively match *style_name* against the structural_tags
    registry (rules.yaml) and return its canonical uppercase form if
    recognized (e.g. "h1" -> "H1", "bl-first" -> "BL-FIRST"); otherwise
    return it unchanged. Built-in Word styles ("Normal", "Table Grid", ...)
    and unrelated custom publisher styles are never in the registry, so
    they pass through untouched. Intended for the docx/xhtml round-trip
    save paths, where a style name read back from an existing document or
    HTML attribute may have drifted in case from however it was originally
    authored."""
    if not style_name:
        return style_name
    if _is_recognized_structural_tag(style_name):
        return style_name.strip().upper()
    return style_name


def _is_known_token(token: str, context_kind: Optional[str] = None) -> bool:
    """True if normalize_style_token() resolves *token* via an actual rule
    (even one that happens to map a token to itself, e.g. H1 -> H1) rather
    than falling through unchanged. Used to detect genuinely unrecognized
    marker tokens (gap #1) without false-positiving on self-mapped ones."""
    cfg = rules_loader.get_normalization_config()
    if token in cfg.get("explicit_tag_map", {}) or token in cfg.get("source_style_map", {}):
        return True
    if re.match(r"^FIG\d+(?:\.\d+)?$", token, re.IGNORECASE):
        return True
    box_cfg = rules_loader.get_box_config()
    if any(re.match(pattern, token, re.IGNORECASE) for pattern in box_cfg.get("open_patterns", [])):
        return True
    if any(re.match(pattern, token, re.IGNORECASE) for pattern in box_cfg.get("close_patterns", [])):
        return True
    if _resolve_box_keyword(token) is not None:
        return True
    if token.startswith("/") and _resolve_box_keyword(token[1:]) is not None:
        return True
    if context_kind == "box" and token == "TITLE":
        return True
    if _is_recognized_structural_tag(token):
        return True
    return False


def normalize_style_token(
    token: Optional[str],
    context_kind: Optional[str] = None,
    box_prefix: Optional[str] = None,
) -> Optional[str]:
    """
    Normalize incoming source styles and explicit tags to canonical styles.
    """
    if not token:
        return None

    token = token.strip()
    cfg = rules_loader.get_normalization_config()
    explicit_map = cfg.get("explicit_tag_map", {})
    source_map = cfg.get("source_style_map", {})

    if token in explicit_map:
        return explicit_map[token]
    if token in source_map:
        return source_map[token]

    if re.match(r"^FIG\d+(?:\.\d+)?$", token, re.IGNORECASE):
        return "PMI"

    box_cfg = rules_loader.get_box_config()
    open_patterns = box_cfg.get("open_patterns", [])
    close_patterns = box_cfg.get("close_patterns", [])
    if any(re.match(pattern, token, re.IGNORECASE) for pattern in open_patterns):
        return box_cfg.get("open_style", "PMI")
    if any(re.match(pattern, token, re.IGNORECASE) for pattern in close_patterns):
        return box_cfg.get("close_style", "PMI")

    if _resolve_box_keyword(token) is not None:
        return box_cfg.get("open_style", "PMI")
    if token.startswith("/") and _resolve_box_keyword(token[1:]) is not None:
        return box_cfg.get("close_style", "PMI")

    if context_kind == "box" and token == "TITLE":
        subtype_styles = box_cfg.get("subtype_styles", {})
        pair = subtype_styles.get(box_prefix or "NBX") or {}
        return pair.get("title", box_cfg.get("title_style", "NBX1-TTL"))

    return token


def classify_explicit_context(token: Optional[str]) -> Optional[str]:
    """
    Map explicit tag tokens to bounded inheritance contexts.
    """
    if not token:
        return None

    box_cfg = rules_loader.get_box_config()
    if any(re.match(pattern, token, re.IGNORECASE) for pattern in box_cfg.get("open_patterns", [])):
        return "objective" if token.upper() == "BXOBJ" else "box"
    if _resolve_box_keyword(token) is not None:
        return "box"

    keyterm_cfg = rules_loader.get_keyterm_config()
    if token.upper() in {style.upper() for style in keyterm_cfg.get("explicit_styles", [])}:
        return "keyterm"

    return None


def is_explicit_context_closer(token: Optional[str], context_kind: Optional[str]) -> bool:
    """Check whether a token closes the current explicit context."""
    if not token or not context_kind:
        return False

    if context_kind == "box":
        if any(
            re.match(pattern, token, re.IGNORECASE)
            for pattern in rules_loader.get_box_config().get("close_patterns", [])
        ):
            return True
        return token.startswith("/") and _resolve_box_keyword(token[1:]) is not None
    if context_kind == "objective":
        return token.upper() in {"/BXOBJ", "/BX"}
    if context_kind == "keyterm":
        return token.upper() in {"/KT"}
    return False


def get_general_list_tag_style(list_kind: str) -> tuple[str, str]:
    """Resolve general list tag/style from rules.yaml."""
    list_config = rules_loader.get_list_patterns()
    key_map = {
        "bullet": ("general_bulleted", ("BL-MID", "BL-MID")),
        "number": ("general_numbered", ("NL-MID", "NL-MID")),
        "roman": ("general_roman", ("OL-MID", "OL-MID")),
        "lettered": ("general_lettered", ("LL-MID", "LL-MID")),
    }
    config_key, default = key_map.get(list_kind, ("general", ("BL-MID", "BL-MID")))
    config = list_config.get(config_key, {})
    return config.get("tag", default[0]), config.get("style", default[1])


def get_reference_entry_tag_style(text: str, list_kind: Optional[str] = None, para: Optional[Paragraph] = None) -> tuple[str, str]:
    """
    Classify a reference entry as numbered or unnumbered/author-year.

    Args:
        text: Paragraph text inside the references block
        list_kind: The type of list formatting applied (if any)
        para: The Paragraph object

    Returns:
        Tuple of (tag, style)
    """
    text = (text or "").strip()
    
    # 1. Use the explicit numbered list detection logic
    is_numbered = bool(re.match(r'^\[?\d+\]?[\.\)\t\s]', text))
    if not is_numbered and para is not None:
        try:
            from docx.oxml.ns import qn
            pPr = para._element.find(qn('w:pPr'))
            if pPr is not None and pPr.find(qn('w:numPr')) is not None:
                is_numbered = True
        except Exception:
            pass
            
    if is_numbered or list_kind == "number":
        return "REF-N", "REF-N"

    author_year_patterns = [
        r"^[A-Z][A-Za-z'`\-]+(?:,\s*(?:[A-Z]\.\s*)+).*\(\d{4}[a-z]?\)",
        r"^[A-Z][A-Za-z'`\-]+(?:\s+et\s+al\.)?.*\(\d{4}[a-z]?\)",
        r"^[A-Z][A-Za-z'`\-]+(?:,\s*[A-Z][A-Za-z'`\-]+)*(?:\s*&\s*[A-Z][A-Za-z'`\-]+)?.*\b\d{4}[a-z]?\b",
    ]
    if any(re.match(pattern, text) for pattern in author_year_patterns):
        return "REF-U", "REF-U"

    return "REF-U", "REF-U"


# =========================
# Core annotator
# =========================

def annotate_document(
    doc: Document, recognize_springer_box_markers: bool = False
) -> List[Dict[str, Any]]:
    """
    Annotate all paragraphs in a document with tags and styles.

    Args:
        doc: python-docx Document object
        recognize_springer_box_markers: when True, also recognize Springer's
            "Box<N>-open"/"Box<N>-close" human-word box marker convention
            (see _match_springer_box_marker) alongside the native
            "BX<N>-<suffix>" one. Off by default so existing canonical/LWW
            processing (and every test that doesn't pass this) is
            unaffected; styler.process_docx opts in only when a tag_set is
            active, matching this convention's Springer-specific origin.

    Returns:
        List of annotation dictionaries with keys:
        - para: Paragraph object
        - tag: String tag (e.g., "CHAPTER_TITLE", "BODY_TEXT")
        - style: Word style name (e.g., "Heading 1", "Normal")

    Raises:
        ValueError: If document is invalid
    """
    if not doc or not hasattr(doc, 'paragraphs'):
        raise ValueError("Invalid Document object")
    
    annotations: List[Dict[str, Any]] = []
    current_block: Optional[str] = None
    block_item_count: int = 0
    explicit_context_kind: Optional[str] = None
    current_box_prefix: Optional[str] = None
    in_chapter_preamble: bool = False
    previous_tag: Optional[str] = None
    
    logger.info(f"Annotating document with {len(doc.paragraphs)} paragraphs")
    
    for para_idx, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        tag = "TXT"
        style = "TXT"
        bx_open_marker: Optional[str] = None
        bx_close_marker: Optional[str] = None
        list_case: Optional[str] = None

        try:
            # A closing box marker trailing real content on the same line
            # (e.g. "Some text.</BX1-Header>") is stripped up front so every
            # rule below classifies the clean content text exactly as if the
            # marker weren't there; the marker itself is recorded separately
            # and merged into "bx_close" below. A line that's *only* the
            # marker is left untouched here (see _strip_trailing_box_close)
            # and still flows through the existing leading-marker path.
            text, trailing_bx_close = _strip_trailing_box_close(text)

            if not text:
                empty_style = rules_loader.rules.get("defaults", {}).get("empty_paragraph", {}).get("style", "TXT")
                annotations.append({"para": para, "tag": "EMPTY", "style": empty_style, "block": current_block})
                continue

            # ===== PRIORITY 0: EXPLICIT TAGS <TAG> =====
            full_hint, explicit_token, stripped_text = parse_leading_style_hint(text)
            explicit_tag_found = False

            if explicit_token:
                token_stripped = explicit_token.strip()
                box_marker_match = _match_box_marker(token_stripped)
                springer_box_marker_match = (
                    _match_springer_box_marker(token_stripped)
                    if recognize_springer_box_markers and not box_marker_match
                    else None
                )

                if box_marker_match or springer_box_marker_match:
                    # Two-pass BX box marker - preserved verbatim and handled
                    # entirely by the separate box_prefixer.apply_box_tag_prefixes()
                    # post-process, which needs the full marker (number + suffix)
                    # recorded here to pair opens/closes exactly. Bypass the
                    # keyword/title/body box machinery below for this token.
                    if box_marker_match:
                        _base_id, is_close = box_marker_match
                        full_marker = token_stripped.lstrip("/")
                        display_prefix = _base_id
                    else:
                        # Springer's "Box<N>-open"/"Box<N>-close" convention -
                        # full_marker is the normalized pairing key (always
                        # "BX<N>-open"), not the literal token text, so the
                        # differently-worded open/close still pair up. The
                        # paragraph's actual text is left untouched either
                        # way. display_prefix ("Box<N>") keeps the applied
                        # style in Springer's own spelling instead of
                        # switching to canonical "BX<N>".
                        _base_id, is_close, full_marker, display_prefix = springer_box_marker_match
                    tag = full_marker
                    text = stripped_text
                    explicit_tag_found = True
                    if is_close:
                        bx_close_marker = full_marker
                        # tag stays the full open-matching marker (needed
                        # verbatim so box_prefixer.py's pairing/
                        # _is_pure_marker_row check still recognizes this
                        # row); only the applied Word *style* is given its
                        # own "-close" name so Draft view shows a close
                        # marker as visibly distinct from its opener
                        # instead of both reading identically (e.g.
                        # "BX1-open"). The author's marker text itself is
                        # untouched either way.
                        style = f"{display_prefix}-close"
                        logger.debug(f"Para {para_idx}: BX box close marker '{full_marker}'")
                    else:
                        bx_open_marker = full_marker
                        style = full_marker if box_marker_match else f"{display_prefix}-open"
                        logger.debug(f"Para {para_idx}: BX box open marker '{full_marker}'")
                else:
                    normalized_explicit_style = normalize_style_token(explicit_token, explicit_context_kind, current_box_prefix)
                    if not _is_known_token(explicit_token, explicit_context_kind) and not stripped_text:
                        # Unrecognized marker (e.g. <WIDGET> with no matching rule)
                        # and nothing but the marker on this line -> neutral skip style,
                        # not a bogus Word style auto-created from the raw token text.
                        normalized_explicit_style = "PMI"
                    if normalized_explicit_style:
                        tag = normalized_explicit_style
                        style = normalized_explicit_style
                    text = stripped_text
                    explicit_tag_found = True
                    logger.debug(f"Para {para_idx}: Found explicit tag/style '{explicit_token}' -> '{style}'")

                    if is_explicit_context_closer(explicit_token, explicit_context_kind):
                        explicit_context_kind = None
                        current_box_prefix = None
                    else:
                        new_context = classify_explicit_context(explicit_token)
                        if new_context:
                            explicit_context_kind = new_context
                            if new_context == "box":
                                current_box_prefix = resolve_box_prefix(explicit_token)

                    if text in rules_loader.get_block_start_markers():
                        current_block = rules_loader.get_block_start_markers()[text]

                # Override: if text is "OBJECTIVES", set to OBJ1 regardless of explicit tag
                objectives_synonyms = ["objectives", "learning objectives", "learningobjectives", "lesson objectives"]
                if text.lower() in objectives_synonyms:
                    tag = "OBJ1"
                    style = "OBJ1"
                    logger.debug(f"Para {para_idx}: Overriding to OBJ1 because text is '{text}'")

            # ===== BLOCK START (Based on text match) =====
            block_markers = rules_loader.get_block_start_markers()
            # This logic below is for exact text matches from 'blocks: start_markers'
            if not explicit_tag_found and text in block_markers:
                current_block = block_markers[text]
                block_item_count = 0
                # Default behavior for block marker headings, can be overridden by regex rules below
                tag = current_block + "_HEADING"
                style = "H2" 
                logger.debug(f"Para {para_idx}: Detected block start: {current_block}")
            
            # ===== BLOCK END =====
            elif current_block == "REFERENCES_BLOCK" and is_references_end(text):
                current_block = None
                logger.debug(f"Para {para_idx}: References block ended")
            
            # ===== WORD / MANUAL LISTS =====
            style_name = para.style.name if para.style else ""
            list_kind_result = detect_list_kind(text, style_name, is_list_paragraph(para), para, doc)
            list_kind, list_case = list_kind_result if list_kind_result is not None else (None, None)
            if not explicit_tag_found and list_kind is not None:
                if current_block:
                    block_item_count += 1
                if current_block == "LEARNING_OBJECTIVES_BLOCK" or explicit_context_kind == "objective":
                    if list_kind == "bullet":
                        tag = "OBJ-BL-MID"
                        style = "OBJ-BL-MID"
                    else:
                        tag = "OBJ-NL-MID"
                        style = "OBJ-NL-MID"
                elif current_block == "REFERENCES_BLOCK":
                    tag, style = get_reference_entry_tag_style(text, list_kind, para)
                elif list_kind in ("bullet", "number", "lettered", "roman") and get_list_indent_level(para) > 0:
                    # Nested sub-list item (indented under a parent list
                    # item, any list kind) - always the "level 2" family,
                    # always MID: no FIRST/LAST variant exists for it,
                    # mirroring the existing table-nested convention
                    # (TBL2-MID/TNL2-MID). list_case (for lettered/roman)
                    # is carried through unchanged via the annotation's
                    # own "list_case" field, same as the level-1 tags.
                    tag = {
                        "bullet": "BL2-MID",
                        "number": "NL2-MID",
                        "lettered": "LL2-MID",
                        "roman": "OL2-MID",
                    }[list_kind]
                    style = tag
                else:
                    tag, style = get_general_list_tag_style(list_kind)
            
            # ===== PARAGRAPH RULES =====
            else:
                # Any explicit/carried-forward tag - including TXT/TXT-FLUSH - is
                # the author's authoritative classification and must win
                # outright, never re-matched against the generic paragraph
                # regex rules below (which could pick a different tag entirely,
                # e.g. a Title-Case rule turning an explicit <TXT> into H2).
                rule_matched = explicit_tag_found

                # Priority 0.5: Detect "OBJECTIVES" heading (case-insensitive)
                objectives_synonyms = ["objectives", "learning objectives", "learningobjectives", "lesson objectives"]
                if text.lower() in objectives_synonyms:
                    tag = "OBJ1"
                    style = "OBJ1"
                    rule_matched = True
                    logger.debug(f"Para {para_idx}: Detected learning objectives heading '{text}'")

                # Priority 1: Force CT after CN
                # Only if not explicit (Explicit tags override strict sequencing if present)
                if not explicit_tag_found and previous_tag == "CN":
                    tag = "CT"
                    style = "CT"
                    rule_matched = True
                    logger.debug(f"Para {para_idx}: Forced CT due to previous CN")

                # Priority 2: Regex Rules
                if not rule_matched:
                    paragraph_rules = rules_loader.get_paragraphs()
                    for rule in paragraph_rules:
                        try:
                            rule_match = re.match(rule["pattern"], text)
                            if rule_match:
                                tag = rule["tag"]
                                style = rule["style"]
                                rule_matched = True

                                # Numbered-heading depth: when the rule's pattern carries
                                # a 'num' group (e.g. "1.2.3"), derive H-depth from the
                                # number of dot-separated segments instead of the rule's
                                # flat tag/style, so "1.2 Background" -> H2, not H1.
                                num_group = rule_match.groupdict().get("num")
                                if num_group:
                                    depth = min(num_group.count(".") + 1, 4)
                                    tag = f"H{depth}"
                                    style = tag

                                # Box title rule ("Box N. ...") should still respect
                                # the open box's resolved keyword subtype prefix.
                                if tag == "NBX1-TTL" and explicit_context_kind == "box":
                                    box_cfg = rules_loader.get_box_config()
                                    subtype_styles = box_cfg.get("subtype_styles", {})
                                    style_pair = subtype_styles.get(current_box_prefix or "NBX") or {}
                                    tag = style_pair.get("title", box_cfg.get("title_style", "NBX1-TTL"))
                                    style = tag

                                # Special Logic: Check if this matched rule is actually starting a block
                                if text in block_markers:
                                     current_block = block_markers[text]
                                     logger.debug(f"Para {para_idx}: Matched block start rule '{tag}', set block to {current_block}")

                                logger.debug(f"Para {para_idx}: Matched rule '{tag}'")
                                break
                        except re.error as e:
                            logger.error(f"Invalid regex in rule '{rule.get('tag', 'unknown')}': {e}")
                
                # ===== BLOCK RESET LOGIC (Moved out to run for ALL tags) =====
                # If we hit a new section heading, exit the current block
                # This now applies to Explicit Tags, Regex matches, or Forced tags
                if tag in ("H1", "H2", "H3", "H4", "CT", "CN", "OBJ1", "REFH1"):
                    if tag == "OBJ1":
                        current_block = "LEARNING_OBJECTIVES_BLOCK"
                        block_item_count = 0
                    elif tag == "REFH1":
                        current_block = "REFERENCES_BLOCK"
                        block_item_count = 0
                    else:
                        is_current_block_starter = False
                        if current_block:
                            if text in block_markers and block_markers[text] == current_block:
                                is_current_block_starter = True
                        
                        if not is_current_block_starter:
                            current_block = None
                            logger.debug(f"Para {para_idx}: Block reset due to heading '{tag}'")

                # Priority 3: Block Context Text
                if not rule_matched and current_block:
                    block_item_count += 1
                    # Map block names to shorter text tags if needed
                    if current_block == "LEARNING_OBJECTIVES_BLOCK":
                        if block_item_count == 1:
                            tag = "OBJ-TXT-FIRST"
                            style = "OBJ-TXT-FIRST"
                        else:
                            tag = "OBJ-TXT"
                            style = "OBJ-TXT"
                    elif current_block == "REFERENCES_BLOCK":
                        tag, style = get_reference_entry_tag_style(text, list_kind, para)
                    else:
                        tag = current_block + "_TXT"
                        style = tag
                elif not rule_matched and explicit_context_kind == "objective":
                    tag = "OBJ-TXT"
                    style = "OBJ-TXT"
                elif (
                    not rule_matched
                    and explicit_context_kind == "box"
                    and text
                    and style == "TXT"
                ):
                    box_cfg = rules_loader.get_box_config()
                    subtype_styles = box_cfg.get("subtype_styles", {})
                    style_pair = subtype_styles.get(current_box_prefix or "NBX") or {}
                    if style_name == "TITLE" or re.match(r"^Box\s+\d+", text):
                        tag = style_pair.get("title", box_cfg.get("title_style", "NBX1-TTL"))
                        style = tag
                    else:
                        tag = style_pair.get("body", box_cfg.get("body_style", "NBX-TXT"))
                        style = tag
                elif not rule_matched and explicit_context_kind == "keyterm":
                    tag = "KT"
                    style = "KT"
                elif (
                    not rule_matched
                    and not current_block
                    and explicit_context_kind is None
                    and text
                    and len(text.split()) < 15
                    and text[-1] not in ".!?:;,>"
                ):
                    # Priority 3.6: Short standalone-phrase heading fallback.
                    # Catches headings the stricter regex rules above miss
                    # (e.g. a bare single word like "Healthcare" - priority
                    # 22's Title-Case rule requires at least two words).
                    # Recall-oriented on purpose: some non-heading fragments
                    # without trailing punctuation will be mis-tagged too;
                    # the hierarchy review step downstream is the backstop.
                    tag = "H2"
                    style = "H2"
                    logger.debug(f"Para {para_idx}: Short standalone-phrase fallback -> H2 (`{text}`)")

            # Priority 3.5: Epigraph Context Logic
            if tag in ("CN", "CT", "CAU"):
                in_chapter_preamble = True
            elif tag in ("H1", "H2", "H3", "OBJ1", "ABS"):
                in_chapter_preamble = False
            
            if in_chapter_preamble and tag in ("TXT", "EPI-ATT"): 
                # If we matched EPI-ATT via regex, keep it. 
                # If TXT, check heuristics.
                if tag == "TXT":
                    if text.startswith("“") or text.startswith('"'):
                        tag = "EPI"
                        style = "EPI"
                    elif re.match(r"^[—–-]", text):
                         tag = "EPI-ATT"
                         style = "EPI-ATT"
                    else:
                         # Default text in preamble (after Title/Author, before H1) is likely Epigraph
                         tag = "EPI"
                         style = "EPI"
            
            # Priority 4: TXT-FLUSH Logic
            if tag == "TXT" and previous_tag in ("H1", "H2", "H3"):
                tag = "TXT-FLUSH"
                style = "TXT-FLUSH"
                logger.debug(f"Para {para_idx}: Changed TXT to TXT-FLUSH (previous: {previous_tag})")

            # Update history
            if tag != "EMPTY":
                previous_tag = tag

            annotations.append({
                "para": para,
                "tag": tag,
                "style": style,
                "block": current_block,
                # Author-provided tags (explicit <TAG> or carried over from a
                # standalone tag line) are authoritative - hierarchy_manager
                # must never reclassify them.
                "locked": explicit_tag_found,
                # Two-pass BX box markers ("BX1-AA", "BX2-KQ", ...) - consumed
                # by box_prefixer.apply_box_tag_prefixes() to pair them up
                # (exact number+suffix match) and prefix everything between.
                # bx_close may come from a leading whole-marker line (tag is
                # the marker itself) or a trailing marker sharing this row
                # with real content (tag is that content's own tag) -
                # box_prefixer distinguishes the two by that tag comparison.
                "bx_open": bx_open_marker,
                "bx_close": bx_close_marker or trailing_bx_close,
                # Marker case ("upper"/"lower") for lettered/roman list
                # items - None for every other tag. Carried separately from
                # tag/style so hierarchy/validation logic (which only sees
                # LL-*/OL-* tags) is unaffected; consumed only by the
                # client tag-set overlay to pick Lc-/Uc- style variants.
                "list_case": list_case,
            })

        except Exception as e:
            logger.error(f"Error annotating paragraph {para_idx}: {e}", exc_info=True)
            annotations.append({"para": para, "tag": "TXT", "style": "TXT", "block": current_block})
    
    logger.info(f"Document annotation complete: {len(annotations)} paragraphs annotated")
    return annotations

