"""Local fallback for reference/citation bookmark processing.

Used when the external PPH service is unreachable. Produces a DOCX whose
bookmark structure matches what PPH's /validate step emits:

  * `ref_N` bookmarks wrap each entry in the References section, numbered in
    document order (1..N).
  * `bib_N` bookmarks wrap each in-text citation that resolves to reference
    entry N. Repeated citations of the same reference get `bib_N_2`,
    `bib_N_3`, ... suffixes.
  * Citations that do not resolve to any reference entry are left alone.

The citation anchor is the `citebib` character style, which is already applied
by upstream structuring in every DOCX the app processes. We group consecutive
`citebib` runs (tolerating tiny paren/whitespace connectors) into citation
clusters and match each cluster to a reference by surname and year.
"""
from __future__ import annotations

import logging
import re
import shutil
import zipfile
from pathlib import Path

from lxml import etree

logger = logging.getLogger(__name__)

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = "{" + W_NS + "}"

LETTER = r"A-Za-zÀ-ÖØ-öø-ÿŞçĞıİşŐŰ"
STOPWORDS = {
    "of", "the", "for", "and", "on", "in", "to", "a", "&", "an", "with",
    "at", "by", "from", "inc", "ltd", "corp", "co", "llc", "llp", "jr", "sr",
}

# Organisations whose auto-derived acronym does not match the citation form.
MANUAL_ACRONYMS: dict[str, list[str]] = {
    "centers for medicare & medicaid services": ["CMS"],
}


# ---------- text helpers ----------

def _acronym(name: str) -> str:
    letters = []
    for w in re.split(r"[\s,\.]+", name):
        if not w or w.lower() in STOPWORDS:
            continue
        if w[0].isupper() or w[0].isdigit():
            letters.append(w[0].upper())
    return "".join(letters)


def _extract_year(text: str) -> str | None:
    m = re.search(r"\b(?:19|20)\d{2}[a-z]?\b", text)
    if m:
        return m.group(0)
    if re.search(r"\bn\.\s*d\.\b", text, re.IGNORECASE):
        return "n.d."
    return None


def _first_surname(ref_text: str) -> str | None:
    m = re.match(rf"^\s*([{LETTER}][{LETTER}’'\-]+),\s+[{LETTER}]\.", ref_text)
    return m.group(1) if m else None


def _all_surnames(ref_text: str) -> list[str]:
    return re.findall(
        rf"([{LETTER}][{LETTER}’'\-]+)(?=,\s+[{LETTER}]\.)", ref_text
    )


def _org_name(ref_text: str) -> str | None:
    if _first_surname(ref_text):
        return None
    m = re.match(r"^\s*(.+?)\.\s*\((?:\d{4}|n\.\s*d\.)", ref_text)
    return m.group(1).strip() if m else None


# ---------- reference index ----------

def _build_reference_index(paragraphs, ref_para_indices):
    refs = []
    for n, pi in enumerate(ref_para_indices, start=1):
        p = paragraphs[pi]
        text = "".join(t.text or "" for t in p.iter(W + "t"))
        year = _extract_year(text)
        keys: set[str] = set()
        surs = _all_surnames(text)
        if surs:
            for s in surs:
                keys.add(s.lower())
        else:
            org = _org_name(text)
            if org:
                keys.add(org.lower())
                for w in org.split():
                    if w.lower() not in STOPWORDS:
                        keys.add(w.lower().rstrip(",.-"))
                        break
                a = _acronym(org)
                if 2 <= len(a) <= 10:
                    keys.add(a.lower())
                for extra in MANUAL_ACRONYMS.get(org.lower(), []):
                    keys.add(extra.lower())
        refs.append({
            "idx": n, "para": p, "text": text, "keys": keys, "year": year,
        })
    return refs


def _match_citation(text: str, refs) -> int | None:
    year = _extract_year(text)
    if not year:
        return None
    core = text.strip()
    core_l = core.lower()

    year_matches = [r for r in refs if r["year"] == year]
    pool = year_matches if year_matches else refs

    tokens_l = [t.lower() for t in re.findall(
        rf"[{LETTER}][{LETTER}’'\-]+", core
    )]
    for r in pool:
        for k in r["keys"]:
            if k in tokens_l:
                return r["idx"]

    for m in re.findall(r"\b([A-Z]{2,10})\b", core):
        m_l = m.lower()
        for r in pool:
            if m_l in r["keys"]:
                return r["idx"]

    for r in pool:
        for k in r["keys"]:
            if len(k) >= 4 and k in core_l:
                return r["idx"]
    return None


# ---------- bookmark manipulation ----------

class _BookmarkIds:
    def __init__(self, root):
        max_id = 0
        for bs in root.iter(W + "bookmarkStart"):
            v = bs.get(W + "id")
            if v and v.isdigit():
                max_id = max(max_id, int(v))
        self._next = max_id

    def next(self) -> str:
        self._next += 1
        return str(self._next)


def _make_start(name: str, id_: str):
    el = etree.Element(W + "bookmarkStart")
    el.set(W + "id", id_)
    el.set(W + "name", name)
    return el


def _make_end(id_: str):
    el = etree.Element(W + "bookmarkEnd")
    el.set(W + "id", id_)
    return el


def _strip_bib_ref_bookmarks(root):
    remove_ids = set()
    for bs in list(root.iter(W + "bookmarkStart")):
        name = bs.get(W + "name") or ""
        if name.startswith("bib_") or name.startswith("ref_"):
            remove_ids.add(bs.get(W + "id"))
            bs.getparent().remove(bs)
    for be in list(root.iter(W + "bookmarkEnd")):
        if be.get(W + "id") in remove_ids:
            be.getparent().remove(be)


def _wrap_paragraph(p, name: str, ids: _BookmarkIds):
    id_ = ids.next()
    start = _make_start(name, id_)
    end = _make_end(id_)
    insert_idx = 0
    for i, c in enumerate(p):
        if c.tag == W + "pPr":
            insert_idx = i + 1
        else:
            break
    p.insert(insert_idx, start)
    p.append(end)


def _wrap_runs(runs, name: str, ids: _BookmarkIds):
    if not runs:
        return
    parent = runs[0].getparent()
    id_ = ids.next()
    start = _make_start(name, id_)
    end = _make_end(id_)
    first_idx = list(parent).index(runs[0])
    parent.insert(first_idx, start)
    last_idx = list(parent).index(runs[-1])
    parent.insert(last_idx + 1, end)


# ---------- paragraph/run inspection ----------

def _run_text(r) -> str:
    return "".join(t.text or "" for t in r.findall(W + "t"))


def _run_style(r) -> str | None:
    rpr = r.find(W + "rPr")
    if rpr is None:
        return None
    rst = rpr.find(W + "rStyle")
    return rst.get(W + "val") if rst is not None else None


def _paragraph_style(p) -> str | None:
    ppr = p.find(W + "pPr")
    if ppr is None:
        return None
    ps = ppr.find(W + "pStyle")
    return ps.get(W + "val") if ps is not None else None


_CONNECTOR_RE = re.compile(r"^[()\s]{0,3}$")


def _find_citation_clusters(p):
    runs = p.findall(W + "r")
    if not runs:
        return []
    clusters = []
    i = 0
    while i < len(runs):
        r = runs[i]
        if _run_style(r) == "citebib":
            cluster = [r]
            j = i + 1
            while j < len(runs):
                nxt = runs[j]
                nxt_s = _run_style(nxt)
                nxt_t = _run_text(nxt)
                if nxt_s == "citebib":
                    cluster.append(nxt)
                    j += 1
                    continue
                if _CONNECTOR_RE.match(nxt_t) or nxt_t == "":
                    cluster.append(nxt)
                    j += 1
                    continue
                break

            ctx_before = ""
            if i > 0:
                prev = ""
                k = i - 1
                while k >= 0 and _run_style(runs[k]) != "citebib":
                    prev = _run_text(runs[k]) + prev
                    if len(prev) > 120:
                        break
                    k -= 1
                m = re.search(r"[.;(]\s*([^.;(]*)$", prev)
                ctx_before = (m.group(1) if m else prev)[-80:]

            ctx_after = ""
            if j < len(runs):
                nxt_t = _run_text(runs[j])
                m = re.match(r"^([^.;]{0,40})", nxt_t)
                ctx_after = m.group(1) if m else ""

            clusters.append((cluster, ctx_before, ctx_after))
            i = j
        else:
            i += 1
    return clusters


# ---------- public entry point ----------

def apply_local_bookmarks(input_path: str | Path, output_path: str | Path) -> dict:
    """Read `input_path` DOCX, add bib_/ref_ bookmarks, write to `output_path`.

    Returns a stats dict::

        {
          "ref_count":     int,   # number of ref_N bookmarks added
          "bib_matched":   int,   # citations bookmarked
          "bib_unmatched": int,   # citations skipped (no matching ref)
        }
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    with zipfile.ZipFile(input_path, "r") as z:
        doc_xml = z.read("word/document.xml")
    root = etree.fromstring(doc_xml)

    body = root.find(W + "body")
    paragraphs = body.findall(W + "p")

    ref_heading_idx = None
    key_ref_idx = None
    for i, p in enumerate(paragraphs):
        style = _paragraph_style(p) or ""
        if "referencesheading" not in style.lower():
            continue
        text = "".join(t.text or "" for t in p.iter(W + "t")).strip().lower()
        if "key" in text and key_ref_idx is None:
            key_ref_idx = i
        elif ref_heading_idx is None:
            ref_heading_idx = i

    ref_para_indices: list[int] = []
    if ref_heading_idx is not None:
        # Preferred: heading present → take all REF-U after it.
        for i in range(ref_heading_idx + 1, len(paragraphs)):
            if _paragraph_style(paragraphs[i]) == "REF-U":
                ref_para_indices.append(i)
    else:
        # Fallback for already-reprocessed docs where the heading was flattened:
        # find contiguous runs of REF-U paragraphs and pick the longest one as
        # the full References list (a shorter "Key References" run may co-exist).
        runs: list[list[int]] = []
        current: list[int] = []
        for i, p in enumerate(paragraphs):
            if _paragraph_style(p) == "REF-U":
                current.append(i)
            elif current:
                runs.append(current)
                current = []
        if current:
            runs.append(current)
        if runs:
            ref_para_indices = max(runs, key=len)

    body_end_idx = key_ref_idx if key_ref_idx is not None else (
        ref_heading_idx if ref_heading_idx is not None
        else (ref_para_indices[0] if ref_para_indices else len(paragraphs))
    )

    refs = _build_reference_index(paragraphs, ref_para_indices)

    ids = _BookmarkIds(root)
    _strip_bib_ref_bookmarks(root)

    for r in refs:
        _wrap_paragraph(r["para"], f"ref_{r['idx']}", ids)

    occurrence: dict[int, int] = {}
    matched = 0
    unmatched = 0
    for pi in range(body_end_idx):
        for cluster, before, after in _find_citation_clusters(paragraphs[pi]):
            cluster_text = "".join(_run_text(r) for r in cluster)
            match_text = f"{before} {cluster_text} {after}".strip()
            n = _match_citation(match_text, refs)
            if n is None:
                unmatched += 1
                continue
            occurrence[n] = occurrence.get(n, 0) + 1
            k = occurrence[n]
            name = f"bib_{n}" if k == 1 else f"bib_{n}_{k}"
            _wrap_runs(cluster, name, ids)
            matched += 1

    new_xml = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(input_path, "r") as zin, \
         zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename) if item.filename != "word/document.xml" else new_xml
            zout.writestr(item, data)

    stats = {
        "ref_count": len(refs),
        "bib_matched": matched,
        "bib_unmatched": unmatched,
    }
    logger.info(
        "Local reference fallback: %s → %s | refs=%d bib_matched=%d bib_unmatched=%d",
        input_path.name, output_path.name,
        stats["ref_count"], stats["bib_matched"], stats["bib_unmatched"],
    )
    return stats
