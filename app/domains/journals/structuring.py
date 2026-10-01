"""Stage 1 auto-structuring of a journal manuscript.

Runs the shared structuring library (app/utils/utils/structuring_lib, the same
rules the book workflow uses) to give every paragraph a publisher style, then a
journal front-matter pass, because the library has no rules for article title,
authors, affiliations, abstract or keywords.
"""
import re
from typing import Any, Dict, Optional

import docx

# Journal front-matter tags applied after the library.
TITLE, AUTHORS, AFFIL, ABSTRACT, ABSTRACT_HEAD, KEYWORDS, META, ARTICLE_TYPE = "ArticleTitle", "ArticleAuthor", "ArticleAffiliation", "Abstract", "AbstractHeading", "Keywords", "PMI", "ArticleType"

_ARTICLE_TYPES = {"review", "review article", "original article", "research article", "original research", "editorial",
                  "case report", "short communication", "letter", "commentary", "perspective", "brief report", "mini review", "Original Paper"}
_META_LINE = re.compile(r"\b(vol\.?|volume|doi\s*:?|issn|received|accepted|published|©|copyright)\b|\b(19|20)\d{2};", re.I)
_AFFIL_WORDS = re.compile(r"\b(universit|department|dept\.|institute|faculty|school of|college|hospital|centre|center|laborator|ministry|academy|clinic)", re.I)
_ABSTRACT = re.compile(r"^\s*abstract\b[.:]?\s*", re.I)
_KEYWORDS = re.compile(r"^\s*key\s*-?words?\b", re.I)


def _set_style(document, para, name: str) -> None:
    from app.utils.utils.structuring_lib.styler import _ensure_style_exists
    _ensure_style_exists(document, name)
    para.style = document.styles[name]


def _looks_like_authors(p) -> bool:
    text = p.text.strip()
    has_sup = any(r.font.superscript for r in p.runs if r.text.strip())
    names = [n for n in re.split(r",|\band\b|&", text) if n.strip()]
    return (has_sup or len(names) >= 2) and not _AFFIL_WORDS.search(text) and len(text.split()) <= 80 and not text.endswith(".")


_ARTICLE_INFO = re.compile(r"^\s*(received|accepted|revised|published|available online|correspond\w*|orcid|e-?mail|tel\.?|phone|fax|address|how to cite|citation)\b", re.I)
_BODY_START = re.compile(r"^\s*(\d+\.?\s*)?(introduction|background|materials and methods|methods)\b\s*$", re.I)


def _looks_like_address(text: str) -> bool:
    """'Kastamonu, 37100 Turkey', 'Department of …, University of …'"""
    return bool(_AFFIL_WORDS.search(text)) or (len(text.split()) <= 12 and "," in text and bool(re.search(r"\d", text)))


def apply_front_matter(path: str) -> Dict[str, Any]:
    """Tag the paragraphs before the first body heading as journal front matter. Returns what it found."""
    document = docx.Document(path)
    paras = [p for p in document.paragraphs if p.text.strip()]
    found: Dict[str, Any] = {"title": None, "authors": 0, "affiliations": 0, "abstract": False, "keywords": False}

    # Front matter runs to the first body heading ("Introduction"…). Article information such as
    # Received/Accepted dates, correspondence and ORCID often sits after the keywords, so it is included.
    end = next((i for i, p in enumerate(paras) if i > 0 and _BODY_START.match(p.text)), None)
    if end is None:
        kw = next((i for i, p in enumerate(paras) if _KEYWORDS.match(p.text)), None)
        end = kw + 1 if kw is not None else len(paras)

    title_done = author_done = False
    abstract_next = False
    for i, p in enumerate(paras[:end]):
        text = p.text.strip()
        if abstract_next:
            _set_style(document, p, ABSTRACT)
            found["abstract"], abstract_next = True, False
        elif _KEYWORDS.match(text):
            _set_style(document, p, KEYWORDS)
            found["keywords"] = True
        elif _ABSTRACT.match(text) and not found["abstract"]:
            if _ABSTRACT.sub("", text):
                _set_style(document, p, ABSTRACT)
                found["abstract"] = True
            else:  # "Abstract" on its own line: the next paragraph is the abstract
                _set_style(document, p, ABSTRACT_HEAD)
                abstract_next = True
        elif _ARTICLE_INFO.match(text) or "@" in text:
            _set_style(document, p, META)
        elif (found["abstract"] or found["keywords"]) and _looks_like_address(text):
            _set_style(document, p, AFFIL)  # correspondence address after the abstract
            found["affiliations"] += 1
        elif found["keywords"]:
            continue  # after the keywords: leave anything else (e.g. Abbreviations) to structuring_lib
        elif found["abstract"]:
            # Continuation paragraphs of a structured abstract (Background/Methods/Results...)
            _set_style(document, p, ABSTRACT)
        elif not title_done and text.lower().rstrip(".") in _ARTICLE_TYPES:
            _set_style(document, p, ARTICLE_TYPE)
        elif not title_done and _META_LINE.search(text):
            _set_style(document, p, META)
        elif not title_done and len(text.split()) >= 3:
            _set_style(document, p, TITLE)
            found["title"], title_done = text, True
        elif title_done and not author_done and _looks_like_authors(p):
            _set_style(document, p, AUTHORS)
            found["authors"] += 1
            author_done = True
        elif title_done and (_AFFIL_WORDS.search(text) or (p.runs and p.runs[0].font.superscript)):
            _set_style(document, p, AFFIL)
            found["affiliations"] += 1
        elif title_done and ("@" in text or re.match(r"^\s*(correspond|e-?mail)", text, re.I)):
            _set_style(document, p, META)
    document.save(path)
    return found


def structure_manuscript(src: str, out: str, tag_set: Optional[str] = None) -> Dict[str, Any]:
    """Structure src into out with the shared library, then tag journal front matter."""
    from app.utils.utils.structuring_lib.styler import process_docx

    result = process_docx(src, out, mode="style", tag_set=tag_set)
    if not result.get("success", True):
        errors = result.get("errors") or []
        raise RuntimeError("; ".join(map(str, errors)) if isinstance(errors, list) else str(errors) or "Structuring failed")
    front = apply_front_matter(out)
    warnings = result.get("zone_warnings") or 0
    return {
        "paragraphs": result.get("paragraphs_processed"),
        "tables": result.get("tables_processed"),
        "zone_warnings": len(warnings) if isinstance(warnings, (list, tuple)) else int(warnings),
        "tag_set": tag_set,
        "front_matter": front,
    }
