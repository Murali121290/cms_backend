"""Article front matter from the tagged manuscript paragraphs -> JATS <contrib>, <aff>, <author-notes>.

Reads the structured XHTML paragraphs (ArticleAuthor, ArticleAffiliation, CorrespondingAuthor,
ArticleType) instead of the upload's metadata guess, so what the editor shows is what the XML gets.
Handles the common forms:
  "Afaf S Alblooshi¹*, MD, PhD; Falah M Almarzooqi²*, MBchB; ..."   (";" between authors, degrees after ",")
  "A. Smith¹, B. Jones² and C. Lee¹"                                (",", "and" between authors)
Superscript digits link to affiliations ("¹ Department of ..."); "*", "†" link to author notes
("*these authors contributed equally") and set equal-contrib; the corresponding-author block
becomes <corresp> and marks the matching author corresp="yes".
"""
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

SUP_OPEN, SUP_CLOSE = "\x01", "\x02"
_SYMBOLS = "*†‡§¶#"
_DEGREE_WORDS = {"md", "phd", "mbbs", "mbchb", "msc", "mph", "bsc", "ma", "ms", "rn", "do", "dds", "dmd", "pharmd", "mba",
                 "bs", "mbbch", "frcpc", "frcs", "facs", "mrcp", "ccfp", "mschpe", "dphil", "mphil", "med", "edd", "psyd",
                 "bpharm", "mpharm", "fracp", "fracs", "jd", "llm", "dnp", "np", "pa", "otr", "pt", "dpt", "mhpe"}


@dataclass
class Author:
    given: str
    surname: str
    degrees: List[str] = field(default_factory=list)
    aff_labels: List[str] = field(default_factory=list)
    note_symbols: List[str] = field(default_factory=list)


@dataclass
class Affiliation:
    label: Optional[str]
    text: str


@dataclass
class AuthorNote:
    symbol: Optional[str]
    text: str


def marked_text(el) -> str:
    """Text of an XHTML element with superscripts wrapped in SUP_OPEN/SUP_CLOSE; tracked deletions left out."""
    parts: List[str] = []

    def walk(n, in_sup=False):
        tag = n.tag.lower() if isinstance(n.tag, str) else ""
        if tag == "del":
            return
        sup = tag == "sup" and not in_sup
        if sup:
            parts.append(SUP_OPEN)
        if n.text:
            parts.append(n.text)
        for c in n:
            walk(c, in_sup or sup)
            if c.tail:
                parts.append(c.tail)
        if sup:
            parts.append(SUP_CLOSE)

    walk(el)
    return "".join(parts).replace("\xa0", " ")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(SUP_OPEN, "").replace(SUP_CLOSE, "")).strip(" ,;")


def _without_sups(s: str) -> str:
    """s with superscripts (affiliation labels, note symbols) removed, cleaned."""
    return _clean(re.sub(re.escape(SUP_OPEN) + ".*?" + re.escape(SUP_CLOSE), " ", s))


def _sup_labels(s: str) -> Tuple[List[str], List[str]]:
    """Affiliation labels and note symbols from the superscripts in s ("1,3*" -> ["1", "3"], ["*"])."""
    labels, symbols = [], []
    for sup in re.findall(re.escape(SUP_OPEN) + "(.*?)" + re.escape(SUP_CLOSE), s):
        for tok in re.findall(r"\d+|[a-z](?![a-z])|[" + re.escape(_SYMBOLS) + "]", sup):
            (symbols if tok in _SYMBOLS else labels).append(tok)
    return labels, symbols


def _is_degree(tok: str) -> bool:
    t = tok.strip().rstrip(".")
    if not t or " " in t:
        return False
    return t.lower().replace(".", "") in _DEGREE_WORDS or bool(re.fullmatch(r"[A-Z][A-Za-z]{0,5}", t) and sum(c.isupper() for c in t) >= 2 and len(t) <= 6)


def _split_name(name: str) -> Tuple[str, str]:
    words = name.split()
    if len(words) == 1:
        return "", words[0]
    return " ".join(words[:-1]), words[-1]


def parse_authors(marked: str) -> List[Author]:
    """Authors from one ArticleAuthor paragraph (marked_text)."""
    text = re.sub(r"^\s*(?:authors?|by)\s*[:\-]\s*", "", marked, flags=re.I)
    if ";" in text:
        groups = []
        for c in text.split(";"):
            parts = re.split(r",(?![^\x01]*\x02)", c)  # commas outside superscripts
            if not _clean(parts[0]):
                continue
            groups.append((parts[0], [_clean(p) for p in parts[1:] if _clean(p)]))
    else:
        pieces = re.split(r",(?![^\x01]*\x02)\s*(?:and\s+)?|\s+and\s+|\s*&\s*", text)
        groups = []
        for p in pieces:
            if not _clean(p):
                continue
            if groups and _is_degree(_without_sups(p)):
                groups[-1][1].append(_without_sups(p))
            else:
                groups.append((p, []))
    authors = []
    for name_part, degrees in groups:
        labels, symbols = _sup_labels(name_part)
        name = _without_sups(name_part)
        if not name or _is_degree(name):
            continue
        given, surname = _split_name(name)
        authors.append(Author(given, surname, [d for d in degrees if d], labels, symbols))
    return authors


def parse_affiliation(marked: str) -> Tuple[Optional[Affiliation], Optional[AuthorNote]]:
    """One ArticleAffiliation paragraph -> an affiliation, or an author note ("*these authors contributed equally")."""
    s = marked.strip()
    label = None
    m = re.match(re.escape(SUP_OPEN) + r"\s*([^\x02]{1,4}?)\s*" + re.escape(SUP_CLOSE) + r"\s*", s)
    if m:
        label, s = m.group(1).strip(), s[m.end():]
    else:
        m = re.match(r"\s*(\d{1,2}|[a-z]|[" + re.escape(_SYMBOLS) + r"])[.)]?\s+", s) or re.match(r"\s*([" + re.escape(_SYMBOLS) + r"])", s)
        if m:
            label, s = m.group(1), s[m.end():]
    text = _clean(s)
    if not text:
        return None, None
    if (label and label in _SYMBOLS) or re.search(r"contributed equally|equal(?:ly)? contribut|joint first|co-first", text, re.I):
        return None, AuthorNote(label if label and label in _SYMBOLS else None, text)
    return Affiliation(label, text), None


def parse_corresp(lines: List[str]) -> Tuple[Optional[str], List[str], Optional[str]]:
    """Corresponding-author block -> (author name, address/contact lines, email)."""
    body = [re.sub(r"^\s*corresponding\s+authors?\s*:?\s*", "", ln, flags=re.I).strip() for ln in lines]
    body = [ln for ln in body if ln]
    email = None
    rest = []
    for ln in body:
        m = re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", ln)
        if m and email is None:
            email = m.group(0)
            ln = re.sub(r"^\s*e-?mail\s*:?\s*", "", ln, flags=re.I).replace(email, "").strip(" ,;:")
            if not ln:
                continue
        rest.append(ln)
    name = rest[0].split(",")[0].strip() if rest else None
    return name, rest, email


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def build_front(am, authors: List[Author], affs: List[Affiliation], notes: List[AuthorNote],
                corresp: Optional[Tuple[Optional[str], List[str], Optional[str]]], e) -> None:
    """Append <contrib-group>, <aff>s and <author-notes> to article-meta `am` (e = the converter's element helper)."""
    aff_ids = {}
    for i, a in enumerate(affs, start=1):
        aff_ids[a.label or str(i)] = f"aff{i}"
    note_ids = {}
    equal_symbols = set()
    for i, n in enumerate(notes, start=1):
        note_ids[n.symbol or "*"] = f"fn{i}"
        if re.search(r"equal", n.text, re.I):
            equal_symbols.add(n.symbol or "*")
    corresp_name = _norm(corresp[0]) if corresp and corresp[0] else None

    if authors:
        cg = e("contrib-group", parent=am)
        for a in authors:
            is_corresp = bool(corresp_name) and (_norm(f"{a.given}{a.surname}") == corresp_name
                                                or corresp_name.endswith(_norm(a.surname)) and corresp_name.startswith(_norm(a.given)[:3]))
            contrib = e("contrib", parent=cg, contrib_type="author",
                        corresp="yes" if is_corresp else None,
                        equal_contrib="yes" if any(s in equal_symbols for s in a.note_symbols) else None)
            name = e("name", parent=contrib)
            e("surname", a.surname, name)
            if a.given:
                e("given-names", a.given, name)
            if a.degrees:
                e("degrees", ", ".join(a.degrees), contrib)
            for label in a.aff_labels:
                if label in aff_ids:
                    e("xref", label, contrib, ref_type="aff", rid=aff_ids[label])
            for sym in a.note_symbols:
                if sym in note_ids:
                    e("xref", sym, contrib, ref_type="fn", rid=note_ids[sym])
            if is_corresp:
                e("xref", None, contrib, ref_type="corresp", rid="cor1")
    for a in affs:
        aff = e("aff", parent=am, id=aff_ids[a.label or str(affs.index(a) + 1)])
        if a.label:
            lab = e("label", a.label, aff)
            lab.tail = a.text
        else:
            aff.text = a.text
    if notes or corresp:
        an = e("author-notes", parent=am)
        if corresp:
            _, lines, email = corresp
            c = e("corresp", parent=an, id="cor1")
            c.text = "Corresponding Author: " + ", ".join(lines) + ("; Email: " if email else "")
            if email:
                e("email", email, c)
        for n in notes:
            fn = e("fn", parent=an, id=note_ids[n.symbol or "*"], fn_type="equal" if re.search(r"equal", n.text, re.I) else "other")
            if n.symbol:
                e("label", n.symbol, fn)
            e("p", n.text, fn)
