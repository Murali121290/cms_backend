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

import copy
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

    ref_para_indices, body_end_idx = _find_reference_layout(paragraphs)

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


# ---------- shared reference-layout detection ----------

def _find_reference_layout(paragraphs) -> tuple[list[int], int]:
    """Return (ref_para_indices, body_end_idx).

    Preferred: a `referencesheading`-styled paragraph marks the References
    section; every subsequent REF-U paragraph is a reference entry.

    Fallback for reprocessed docs where the heading was flattened: pick the
    longest contiguous run of REF-U paragraphs and treat it as the References
    list (a shorter "Key References" run may co-exist earlier in the doc).
    """
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
        for i in range(ref_heading_idx + 1, len(paragraphs)):
            if _paragraph_style(paragraphs[i]) == "REF-U":
                ref_para_indices.append(i)
    else:
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
    return ref_para_indices, body_end_idx


# ---------- compound-citation splitter ----------

_BIB_NAME_RE = re.compile(r"^bib_(\d+)(?:_\d+)?$")


def _split_run_at_semicolons(run):
    """Split a `<w:r>` at each `;` in its text.

    Each new run keeps a deep copy of the original `<w:rPr>` and contains one
    text segment: either the text between two semicolons, or a lone `;`
    separator. Any non-`<w:t>`/`<w:rPr>` children (tabs, breaks, symbols) stay
    attached to the LAST new run so they aren't duplicated. If the run text
    has no `;`, returns `[run]` unchanged.

    Isolating `;` in its own run lets the caller wrap only the citation
    segments in `bib_N` bookmarks and leave the separators unwrapped.
    """
    ts = run.findall(W + "t")
    text = "".join(t.text or "" for t in ts)
    if ";" not in text:
        return [run]

    # Split so each `;` becomes its own segment, separate from the citations
    # on either side.
    segments = [s for s in re.split(r"(;)", text) if s]
    if len(segments) <= 1:
        return [run]

    rpr = run.find(W + "rPr")
    tail_children = [c for c in run if c.tag not in (W + "rPr", W + "t")]

    parent = run.getparent()
    idx = list(parent).index(run)

    new_runs = []
    for i, seg in enumerate(segments):
        new_r = etree.Element(W + "r")
        # Citation segments keep the original `<w:rPr>` (e.g., `citebib`).
        # Lone `;` separators get NO run-properties so they render as plain
        # text, with no character style or attribute that any downstream
        # renderer could interpret as part of a citation.
        if rpr is not None and seg.strip() != ";":
            new_r.append(copy.deepcopy(rpr))
        t_el = etree.SubElement(new_r, W + "t")
        t_el.text = seg
        # Preserve any leading/trailing whitespace introduced by the split.
        t_el.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        if i == len(segments) - 1:
            for tc in tail_children:
                new_r.append(copy.deepcopy(tc))
        new_runs.append(new_r)

    for i, nr in enumerate(new_runs):
        parent.insert(idx + i, nr)
    parent.remove(run)
    return new_runs


def _group_runs_by_semicolon(elements):
    """Partition `elements` into (kind, runs) tuples separated by `;`-only
    runs. `kind` is ``"citation"`` for a sub-citation group or ``"separator"``
    for a lone `;`. Separator runs are kept out of every citation group so
    the caller can wrap citations without swallowing the `;`. Non-`<w:r>`
    inline neighbours (rare) stay attached to the current citation group.
    """
    groups: list[tuple[str, list]] = []
    current: list = []
    for el in elements:
        if el.tag == W + "r" and _run_text(el).strip() == ";":
            if current:
                groups.append(("citation", current))
                current = []
            groups.append(("separator", [el]))
            continue
        current.append(el)
    if current:
        groups.append(("citation", current))
    return groups


def _renumber_affected_bibs(root, affected_refs: set[int]) -> None:
    """Walk the document in order and rename `bib_N` / `bib_N_k` bookmarks so
    the k-th occurrence of ref N is `bib_N` when k==1 and `bib_N_k` otherwise.

    Only touches bookmarks whose numeric ref is in `affected_refs` — leaves
    the rest of the doc's bib_* naming untouched.
    """
    counts: dict[int, int] = {}
    for bs in root.iter(W + "bookmarkStart"):
        name = bs.get(W + "name") or ""
        m = _BIB_NAME_RE.match(name)
        if not m:
            continue
        n = int(m.group(1))
        if n not in affected_refs:
            continue
        counts[n] = counts.get(n, 0) + 1
        k = counts[n]
        new_name = f"bib_{n}" if k == 1 else f"bib_{n}_{k}"
        if new_name != name:
            bs.set(W + "name", new_name)


def strip_citation_semicolon_styling(docx_path: str | Path) -> int:
    """Strip hyperlink-style formatting (`<w:u>` underline, `<w:color>`) from
    every `;`-only run that sits between two `citebib` runs in the same
    paragraph.

    Motivation: PPH and Word both tend to inherit the citation's blue-underlined
    hyperlink formatting onto the `; ` separators between sub-citations. In
    the WYSIWYG editor those styled separators sit right next to the per-
    citation `⌈…⌉` bookmark indicators and look, at a glance, like additional
    bookmark brackets around the semicolon. Stripping the styling makes `;`
    render as plain text — a true separator, visually distinct from a
    citation.

    Idempotent: runs whose styling has already been cleaned are skipped.
    Only touches runs whose text (after stripping whitespace) is exactly `;`.
    Returns the number of runs cleaned; if zero, the file is not rewritten.
    """
    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path, "r") as z:
        doc_xml = z.read("word/document.xml")
    root = etree.fromstring(doc_xml)
    body = root.find(W + "body")
    if body is None:
        return 0

    cleaned = 0
    for para in body.iter(W + "p"):
        runs = para.findall(W + "r")
        for i, r in enumerate(runs):
            if _run_text(r).strip() != ";":
                continue
            # Only strip when the `;` really is a citation separator — i.e.
            # has a `citebib` run on at least one side. Otherwise leave the
            # author's styling alone.
            def _is_citebib(other):
                return other is not None and _run_style(other) == "citebib"
            prev_r = runs[i - 1] if i > 0 else None
            next_r = runs[i + 1] if i + 1 < len(runs) else None
            if not (_is_citebib(prev_r) or _is_citebib(next_r)):
                continue

            rpr = r.find(W + "rPr")
            if rpr is None:
                continue
            removed_here = False
            for child in list(rpr):
                if child.tag in (W + "u", W + "color"):
                    rpr.remove(child)
                    removed_here = True
            # If the rPr is now empty, drop it entirely so the run is truly
            # unadorned plain text.
            if removed_here and len(rpr) == 0:
                r.remove(rpr)
            if removed_here:
                cleaned += 1

    if cleaned == 0:
        return 0

    new_xml = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True,
    )
    tmp = docx_path.with_suffix(docx_path.suffix + ".semi-tmp")
    with zipfile.ZipFile(docx_path, "r") as zin, \
         zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename) if item.filename != "word/document.xml" else new_xml
            zout.writestr(item, data)
    tmp.replace(docx_path)

    logger.info(
        "Stripped citation `;` styling from %d run(s) in %s",
        cleaned, docx_path.name,
    )
    return cleaned


def split_compound_bib_bookmarks(docx_path: str | Path) -> dict:
    """Post-process a DOCX so any ``bib_*`` bookmark whose spanned text contains
    ``;`` is split into one bookmark per ``;``-separated sub-citation, each
    matched against the References list via `_match_citation`.

    Runs in place on `docx_path`. Idempotent: bookmarks with no ``;``, and
    non-``bib_`` bookmarks (``ref_*``, Word-native `Bookmark1`, WYSIWYG-added
    manuals, etc.) are left untouched. If the doc has no References section
    or no compound `bib_*` bookmarks, the file is not rewritten.

    Returns::

        {
          "split_bookmarks":  int,   # compound bookmarks that got split
          "new_bookmarks":    int,   # total sub-bookmarks created
          "unmatched_parts":  int,   # sub-citations skipped (no matching ref)
        }
    """
    docx_path = Path(docx_path)
    stats = {"split_bookmarks": 0, "new_bookmarks": 0, "unmatched_parts": 0}

    with zipfile.ZipFile(docx_path, "r") as z:
        doc_xml = z.read("word/document.xml")
    root = etree.fromstring(doc_xml)

    body = root.find(W + "body")
    if body is None:
        return stats

    paragraphs = body.findall(W + "p")
    ref_para_indices, _ = _find_reference_layout(paragraphs)
    if not ref_para_indices:
        return stats
    refs = _build_reference_index(paragraphs, ref_para_indices)
    if not refs:
        return stats

    ids = _BookmarkIds(root)
    affected_refs: set[int] = set()

    # Snapshot bib_* starts before we start mutating.
    bib_starts = [
        bs for bs in root.iter(W + "bookmarkStart")
        if _BIB_NAME_RE.match(bs.get(W + "name") or "")
    ]

    for bs in bib_starts:
        bid = bs.get(W + "id")
        parent = bs.getparent()
        # Only handle bookmarks that live inside a paragraph (citation
        # bookmarks always do; skip anything oddly nested to stay safe).
        if parent is None or parent.tag != W + "p":
            continue
        be = None
        for candidate in parent.iter(W + "bookmarkEnd"):
            if candidate.get(W + "id") == bid:
                be = candidate
                break
        # bookmarkEnd may live in a different paragraph if the bookmark spans
        # multiple paragraphs — never true for a citation, so skip.
        if be is None:
            continue

        siblings = list(parent)
        try:
            si = siblings.index(bs)
            ei = siblings.index(be)
        except ValueError:
            continue
        if ei <= si + 1:
            continue

        spanned = siblings[si + 1: ei]
        text = "".join(_run_text(el) for el in spanned if el.tag == W + "r")
        if ";" not in text:
            continue

        # Split any run that contains `;` so each `;` ends up at a run boundary.
        expanded: list = []
        for el in spanned:
            if el.tag == W + "r":
                expanded.extend(_split_run_at_semicolons(el))
            else:
                expanded.append(el)

        groups = _group_runs_by_semicolon(expanded)
        citation_groups = [g for kind, g in groups if kind == "citation"]
        if len(citation_groups) < 2:
            # Text contained `;` but grouping produced only one citation
            # (defensive; e.g., `;` sits inside a non-<w:r> element we can't
            # split, or the compound was actually a single citation).
            continue

        old_m = _BIB_NAME_RE.match(bs.get(W + "name") or "")
        if old_m:
            affected_refs.add(int(old_m.group(1)))

        # Drop the compound bookmark; sub-bookmarks will be wrapped below.
        # Separator `;` runs stay in place, unwrapped, so they render as
        # plain text between the per-citation bookmarks.
        parent.remove(bs)
        parent.remove(be)

        for group in citation_groups:
            group_runs = [el for el in group if el.tag == W + "r"]
            if not group_runs:
                continue
            group_text = "".join(_run_text(r) for r in group_runs)
            n = _match_citation(group_text, refs)
            if n is None:
                stats["unmatched_parts"] += 1
                continue
            # Temporary name — renumbering below normalises it to
            # bib_N / bib_N_k based on final document order.
            _wrap_runs(group_runs, f"bib_{n}", ids)
            stats["new_bookmarks"] += 1
            affected_refs.add(n)

        stats["split_bookmarks"] += 1

    if stats["split_bookmarks"] == 0:
        return stats

    _renumber_affected_bibs(root, affected_refs)

    new_xml = etree.tostring(
        root, xml_declaration=True, encoding="UTF-8", standalone=True,
    )

    tmp = docx_path.with_suffix(docx_path.suffix + ".split-tmp")
    with zipfile.ZipFile(docx_path, "r") as zin, \
         zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename) if item.filename != "word/document.xml" else new_xml
            zout.writestr(item, data)
    tmp.replace(docx_path)

    logger.info(
        "Split compound bib bookmarks in %s: split=%d new=%d unmatched=%d",
        docx_path.name,
        stats["split_bookmarks"], stats["new_bookmarks"], stats["unmatched_parts"],
    )
    return stats
