"""One-off workflow data maintenance.

Early assignments: stages_details rows assigned to someone although the chapter hasn't reached that stage yet
(rows are pre-created for every stage at planning time). The workspace no longer allows this, so existing ones
are cleared: assignee removed, custody back to "unassigned", an audit event added to the row's history.

    # list only (default)
    python -m app.domains.workflow.maintenance
    # clear them
    python -m app.domains.workflow.maintenance --apply --actor admin
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app.domains.workflow import custody, stage_service
from app.domains.workflow.models import StageDetail


@dataclass
class EarlyAssignment:
    id: int
    project: str
    chapters: str
    stage_name: str
    assignee: str
    chapter_is_in: Optional[str]


def find_early_assignments(db: Session) -> list[EarlyAssignment]:
    rows = (db.query(StageDetail)
            .filter(StageDetail.stage_status != "Completed", StageDetail.assignee_name.isnot(None), StageDetail.assignee_name != "")
            .order_by(StageDetail.project, StageDetail.chapters, StageDetail.id).all())
    current = stage_service.current_stages(db, ((r.project, r.chapters) for r in rows))
    return [EarlyAssignment(r.id, r.project, r.chapters, r.stage_name, r.assignee_name, current.get((r.project, r.chapters)))
            for r in rows if not stage_service.is_live(r, current)]


def clear_early_assignments(db: Session, actor: str) -> list[EarlyAssignment]:
    found = find_early_assignments(db)
    for e in found:
        sd = db.get(StageDetail, e.id)
        before = custody.effective_custody(sd)
        sd.assignee_name = None
        custody.set_status(sd, custody.UNASSIGNED)
        custody.record_event(sd, "unassign", actor, from_status=before, to_status=custody.UNASSIGNED,
                             notes=f"Cleared: chapter not yet at this stage (it is in {e.chapter_is_in}).",
                             extra={"previous_assignee": e.assignee, "reason": "early_assignment"})
    db.commit()
    return found


def _main() -> None:  # pragma: no cover - CLI
    import app.models  # noqa: F401  (registers all mappers)
    from app.database import SessionLocal

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="clear them (default: list only)")
    ap.add_argument("--actor", default="system", help="username recorded in the history event")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        rows = clear_early_assignments(db, args.actor) if args.apply else find_early_assignments(db)
        for e in rows:
            print(f"{e.id:>7}  {e.project:<22} {stage_service.chapter_label(e.chapters):<14} {e.stage_name:<28} "
                  f"{e.assignee:<16} chapter is in: {e.chapter_is_in}")
        print(f"\n{len(rows)} early assignment(s) {'cleared' if args.apply else 'found (dry run; use --apply to clear)'}.")
    finally:
        db.close()


if __name__ == "__main__":  # pragma: no cover
    _main()
