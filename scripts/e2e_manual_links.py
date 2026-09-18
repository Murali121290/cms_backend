"""End-to-end test for manual bookmark→reference links.

Runs against a real file in the DB. No auth, direct service calls.
Usage: docker exec cms_backend python /app/scripts/e2e_manual_links.py [FILE_ID]
"""
import os, sys, json

sys.path.insert(0, "/app")

from app.core.database import SessionLocal
from app.services import structuring_review_service as srs
from app.domains.review import service as _svc  # for underscore-prefixed helpers


class _Log:
    def info(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def error(self, *a, **k): print("ERR:", a)
    def exception(self, *a, **k): print("EXC:", a)


def main():
    file_id = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    log = _Log()
    db = SessionLocal()
    try:
        resolved = srs.resolve_processed_target(db, file_id=file_id)
    except Exception as e:
        print("resolve failed:", e)
        return

    processed = resolved["processed_path"]
    sidecar = _svc._manual_links_path(processed)
    print("=" * 70)
    print("file_id:", file_id)
    print("processed:", processed)
    print("sidecar  :", sidecar)
    print("sidecar exists at start:", os.path.exists(sidecar))
    print("initial manual_links doc:", srs.read_manual_links(processed))

    print("\n-- build initial state --")
    state = srs.build_reference_review_page_state(db, file_id=file_id, logger=log)
    logs = state["validation_logs"]
    print("detected_style:", logs.get("detected_style"))
    pairs = logs.get("citation_pairs") or []
    entries = logs.get("reference_entries") or []
    print(f"pairs={len(pairs)}  entries={len(entries)}")
    statuses = {}
    for p in pairs:
        statuses[p.get("status")] = statuses.get(p.get("status"), 0) + 1
    print("pair statuses:", statuses)

    # Pick a target — prefer a missing/unused pair we can visibly flip; accept
    # ref_number OR ref_text as the linkable key (merge supports both).
    target = None
    for p in pairs:
        if p.get("status") in ("missing", "unused") and (p.get("ref_number") is not None or p.get("ref_text")):
            target = p
            break
    if target is None:
        for p in pairs:
            if p.get("ref_number") is not None or p.get("ref_text"):
                target = p
                break
    if target is None:
        for e in entries:
            if e.get("number") is not None or e.get("text"):
                target = {"ref_number": e.get("number"), "ref_text": e.get("text"), "status": "n/a"}
                break
    if target is None:
        print("!! No target ref found — nothing to link. Aborting.")
        return
    print("chosen target: ref_number=", target.get("ref_number"),
          " status=", target.get("status"),
          " ref_text=", (target.get("ref_text") or "")[:60], "...")

    BM = "TestClaudeE2E_1"
    print(f"\n-- upsert manual link for '{BM}' -> ref {target.get('ref_number')} --")
    entry = srs.upsert_manual_link(
        processed,
        bookmark_name=BM,
        ref_number=target.get("ref_number"),
        ref_text=target.get("ref_text") or "TEST TEXT",
        citation_text=str(target.get("ref_number") or ""),
        linked_by="e2e-test",
        logger=log,
    )
    print("upserted:", entry)
    print("sidecar exists after write:", os.path.exists(sidecar))
    print("sidecar body:", open(sidecar).read())

    print("\n-- invalidate cache, rebuild, verify merge --")
    srs.invalidate_ref_review_cache(processed, logger=log)
    state2 = srs.build_reference_review_page_state(db, file_id=file_id, logger=log)
    logs2 = state2["validation_logs"]
    print("manual_links in merged response:", logs2.get("manual_links"))
    def _matches(item, num_key, text_key):
        if target.get("ref_number") is not None:
            return item.get(num_key) == target.get("ref_number")
        return (item.get(text_key) or "").strip().lower() == (target.get("ref_text") or "").strip().lower()
    flipped = next((p for p in (logs2.get("citation_pairs") or []) if _matches(p, "ref_number", "ref_text")), None)
    print("target pair AFTER merge:", flipped)
    entry_after = next((e for e in (logs2.get("reference_entries") or []) if _matches(e, "number", "text")), None)
    print("target entry AFTER merge:",
          {k: entry_after.get(k) for k in ("number", "is_cited", "manual_linked")} if entry_after else None)
    new_statuses = {}
    for p in logs2.get("citation_pairs") or []:
        new_statuses[p.get("status")] = new_statuses.get(p.get("status"), 0) + 1
    print("pair statuses NOW:", new_statuses)

    verdict_flip = flipped and flipped.get("status") == "ok" and flipped.get("manual_linked") is True
    print("MERGE OK:", verdict_flip)

    print("\n-- delete manual link --")
    deleted = srs.delete_manual_link(processed, bookmark_name=BM, logger=log)
    print("delete returned:", deleted)
    print("doc after delete:", srs.read_manual_links(processed))

    print("\n-- rebuild, verify revert --")
    srs.invalidate_ref_review_cache(processed, logger=log)
    state3 = srs.build_reference_review_page_state(db, file_id=file_id, logger=log)
    reverted = next((p for p in (state3["validation_logs"].get("citation_pairs") or []) if _matches(p, "ref_number", "ref_text")), None)
    print("target pair AFTER revert:", reverted)
    verdict_revert = reverted and reverted.get("status") == target.get("status")

    print("\n" + "=" * 70)
    print("VERDICT: merge_ok=", verdict_flip, "  revert_ok=", verdict_revert,
          "  delete_ok=", deleted)
    db.close()


if __name__ == "__main__":
    main()
