"""Export the authoritative term-list → client-company mapping from this
environment to JSON.

Intended workflow:

    # 1. Run on the environment whose term_lists ↔ clients wiring is correct
    #    (per the operator's judgment). Produces `term_list_client_map.json`.
    python scripts/export_term_list_client_map.py --out term_list_client_map.json

    # 2. Ship the JSON to the misaligned environment and run
    #    scripts/repair_term_list_client_ids.py there.

Only ``scope='client'`` rows carry a meaningful ``client_id``; generic rows
are exported with ``expected_client_company = null`` and the repair script
leaves them alone.

No client names are hardcoded — everything is read from the live DB.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
# Import the models aggregator so every relationship() string reference
# (e.g. Client.projects ↔ "Project") resolves before we query.
import app.models  # noqa: F401
from app.domains.clients.models import Client
from app.domains.term_lists.models import TermList


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="term_list_client_map.json",
                    help="Output JSON path (default: term_list_client_map.json)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = (
            db.query(TermList, Client.company)
            .outerjoin(Client, Client.id == TermList.client_id)
            .order_by(TermList.id)
            .all()
        )

        entries = []
        for tl, company in rows:
            entries.append({
                "term_list_id": tl.id,
                "term_list_name": tl.name,
                "scope": tl.scope,
                "source_client_id": tl.client_id,
                "expected_client_company": (company.strip() if isinstance(company, str) else None)
                if tl.scope == "client" else None,
            })
    finally:
        db.close()

    Path(args.out).write_text(json.dumps({"entries": entries}, indent=2, ensure_ascii=False))
    client_rows = sum(1 for e in entries if e["scope"] == "client")
    print(f"Wrote {args.out} — {len(entries)} term lists ({client_rows} client-scoped).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
