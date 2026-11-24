"""Repair term_lists.client_id FKs against this environment's clients table.

Given a mapping file produced by ``scripts/export_term_list_client_map.py``
(which carries ``term_list_name`` → ``expected_client_company`` from an
authoritative source), this script:

  * Looks up each target term list by *id first, then by name* (fallback for
    environments where ids have drifted).
  * Resolves the expected client by ``clients.company`` on THIS DB — so
    the FK gets this environment's own ``clients.id``, never a foreign one.
  * Updates ``term_lists.client_id`` only when it currently differs from
    the resolved id.

Safety:

  * Default is ``--dry-run``: prints a diff, writes nothing.
  * Skips ``scope='generic'`` term lists (per the restriction).
  * Never modifies or deletes any ``clients`` row.
  * Never creates clients. If the expected company is missing on this DB,
    the term list is reported as *unresolved* and left untouched.
  * Idempotent — rows already correct are reported as ``ok`` and skipped.

Run (on the target environment, e.g. the server)::

    python scripts/repair_term_list_client_ids.py term_list_client_map.json           # dry-run
    python scripts/repair_term_list_client_ids.py term_list_client_map.json --apply   # commit
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func

from app.database import SessionLocal
import app.models  # noqa: F401  — register all relationship string refs
from app.domains.clients.models import Client
from app.domains.term_lists.models import TermList


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mapping", help="Path to term_list_client_map.json")
    ap.add_argument("--apply", action="store_true",
                    help="Commit the updates. Without this flag the script runs dry.")
    args = ap.parse_args()

    payload = json.loads(Path(args.mapping).read_text())
    entries = payload.get("entries") or []
    if not entries:
        print("Mapping file has no entries — nothing to do.")
        return 0

    db = SessionLocal()
    try:
        # Build a case-insensitive lookup of clients by company name on
        # THIS DB. Comparing on a normalised form avoids whitespace /
        # casing drift between environments.
        clients_by_company = {
            (c.company or "").strip().lower(): c
            for c in db.query(Client).all()
        }

        ok = fixed = unresolved = skipped_generic = missing_term_list = 0
        plan: list[str] = []

        for entry in entries:
            tl_id = entry.get("term_list_id")
            tl_name = (entry.get("term_list_name") or "").strip()
            scope = entry.get("scope")
            expected = entry.get("expected_client_company")

            if scope != "client":
                skipped_generic += 1
                continue

            # Prefer id-based lookup, fall back to name-based (cross-env drift).
            tl = db.query(TermList).filter(TermList.id == tl_id).first() if tl_id else None
            if tl is None and tl_name:
                tl = (
                    db.query(TermList)
                    .filter(func.lower(TermList.name) == tl_name.lower(),
                            TermList.scope == "client")
                    .first()
                )
            if tl is None:
                missing_term_list += 1
                plan.append(f"  SKIP   term list not found on target: id={tl_id!r} name={tl_name!r}")
                continue

            if not expected:
                unresolved += 1
                plan.append(f"  SKIP   no expected client in mapping for {tl.name!r} (id={tl.id})")
                continue

            resolved = clients_by_company.get(expected.strip().lower())
            if resolved is None:
                unresolved += 1
                plan.append(
                    f"  MISS   {tl.name!r} (id={tl.id}) expects {expected!r} "
                    f"— no matching client on this DB; left unchanged"
                )
                continue

            if tl.client_id == resolved.id:
                ok += 1
                continue

            plan.append(
                f"  FIX    {tl.name!r} (id={tl.id}): client_id "
                f"{tl.client_id} → {resolved.id}  ({expected!r})"
            )
            fixed += 1
            if args.apply:
                tl.client_id = resolved.id

        if args.apply and fixed:
            db.commit()

        for line in plan:
            print(line)

        action = "applied" if args.apply else "dry-run"
        print(
            f"\nSummary ({action}): fixed={fixed}  ok={ok}  "
            f"unresolved={unresolved}  missing_term_list={missing_term_list}  "
            f"skipped_generic={skipped_generic}"
        )
        if not args.apply and fixed:
            print("Re-run with --apply to commit these updates.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
