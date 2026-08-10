"""Footnote and endnote two-way link verification.

A footnote reference marker (a[href='#fn-N']) must have a matching back-link
from the note body (a[href='#fnref-N']), and vice-versa. Same for endnotes.
"""

import glob
import os
import re

from bs4 import BeautifulSoup

from ..engine.registry import rule


_FN_HREF_RE = re.compile(r"#(fn[a-z]*[-_]?[\w-]+)$", re.IGNORECASE)


def _collect_note_links(epub: str):
    """Return two dicts:
        forwards: reference-marker id -> (file, target_id)  (body → note)
        backs:    back-link id        -> (file, target_id)  (note → body)
    Also returns sets of note-target ids and reference-target ids that were
    found on elements (via id="...").
    """
    forwards: dict[str, tuple[str, str]] = {}
    backs: dict[str, tuple[str, str]] = {}
    element_ids: set[str] = set()

    for xhtml in glob.glob(os.path.join(epub, "**", "*.xhtml"), recursive=True):
        try:
            with open(xhtml, "r", encoding="utf-8") as f:
                soup = BeautifulSoup(f.read(), "html.parser")
        except Exception:  # noqa: BLE001
            continue

        rel = os.path.relpath(xhtml, epub)

        for el in soup.find_all(True):
            eid = (el.get("id") or "").strip()
            if eid and (eid.lower().startswith("fn") or eid.lower().startswith("en") or "note" in eid.lower()):
                element_ids.add(eid)

        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            m = _FN_HREF_RE.search(href)
            if not m:
                continue
            target = m.group(1)
            role = (a.get("epub:type") or "").lower()
            classes = " ".join(a.get("class") or []).lower()
            # Heuristic classification:
            # - links whose id or context marks them as body-side reference
            #   markers point INTO the note (forwards)
            # - links whose id/context marks them as note-side back-link
            #   point back to the reference marker (backs)
            src_id = (a.get("id") or "").strip()
            is_backlink = (
                "backlink" in role
                or "backlink" in classes
                or src_id.lower().startswith(("fn-", "fnref-", "en-", "enref-")) and "ref" in src_id.lower()
                or target.lower().startswith(("fnref", "enref"))
            )
            if is_backlink:
                backs[src_id or f"{rel}#{href}"] = (rel, target)
            else:
                forwards[src_id or f"{rel}#{href}"] = (rel, target)

    return forwards, backs, element_ids


@rule("LINK004")
def validate_footnote_endnote_two_way(book_details):
    """Every footnote/endnote link should have its counterpart."""
    epub = book_details["epub_path"]
    forwards, backs, element_ids = _collect_note_links(epub)
    if not forwards and not backs:
        return {"issues_count": 0, "issues": []}

    issues: list[dict] = []

    # A body → note link at #fn-1 should be complemented by an element with
    # id="fnref-1" (or similar) that points back to it. Missing means
    # one-way link.
    forward_targets = {t.lower() for _f, t in forwards.values()}
    back_targets = {t.lower() for _f, t in backs.values()}

    missing_backs = []
    for src_id, (rel, tgt) in forwards.items():
        # Look for a corresponding back element whose id matches the
        # note-side target OR a back-link that points to `src_id`.
        candidate_back_ids = {tgt.replace("fn", "fnref"), tgt.replace("en", "enref"), f"{tgt}ref"}
        if any(cid.lower() in element_ids or cid.lower() in {e.lower() for e in element_ids}
               for cid in candidate_back_ids):
            continue
        if src_id.lower() in back_targets:
            continue
        missing_backs.append((rel, tgt))

    for rel, tgt in missing_backs[:25]:
        issues.append({
            "type": "footnote_no_back_link",
            "message": (
                f"Reference marker to '#{tgt}' in {rel} has no matching back-link "
                f"element (expected id like 'fnref-…' pointing back)."
            ),
            "category": "Warning",
            "file_path": rel,
        })
    if len(missing_backs) > 25:
        issues.append({
            "type": "footnote_no_back_link_more",
            "message": f"...and {len(missing_backs) - 25} more references without back-links.",
            "category": "Warning",
        })

    # Note → body back-links whose target id doesn't exist in any file
    missing_forwards = []
    for src_id, (rel, tgt) in backs.items():
        if tgt in element_ids or tgt.lower() in {e.lower() for e in element_ids}:
            continue
        # Also OK if any forward link's own id equals tgt.
        if tgt in {sid for sid in forwards} or tgt.lower() in {sid.lower() for sid in forwards}:
            continue
        missing_forwards.append((rel, tgt))

    for rel, tgt in missing_forwards[:25]:
        issues.append({
            "type": "endnote_broken_back_link",
            "message": f"Back-link in {rel} points to '#{tgt}' but no such reference marker exists.",
            "category": "Error",
            "file_path": rel,
        })
    if len(missing_forwards) > 25:
        issues.append({
            "type": "endnote_broken_back_link_more",
            "message": f"...and {len(missing_forwards) - 25} more broken back-links.",
            "category": "Error",
        })

    return {"issues_count": len(issues), "issues": issues}
