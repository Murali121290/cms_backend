"""Stage custody lifecycle: who holds a chapter inside a stage and what may happen next.

    unassigned ──assign──▶ in_progress ──handback──▶ returned_for_review ──approve──▶ qa_approved ──move_next──▶ transitioned
         ▲                     │  ▲                          │
         └─────unassign────────┘  └──────────rework──────────┘

Every change is appended to StageDetail.history (the same JSON list planning changes already use),
so the activity drawer and audits read one place.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm.attributes import flag_modified

from app.domains.workflow.models import StageDetail

UNASSIGNED = "unassigned"
IN_PROGRESS = "in_progress"
RETURNED = "returned_for_review"
APPROVED = "qa_approved"
TRANSITIONED = "transitioned"
ALL_STATUSES = (UNASSIGNED, IN_PROGRESS, RETURNED, APPROVED, TRANSITIONED)

# action -> (allowed source statuses, target status). "assign" to an unassigned/in-progress row is a
# (re)assignment; the target is decided by whether an assignee was given (see apply_assign).
TRANSITIONS: dict[str, tuple[frozenset[str], Optional[str]]] = {
    "assign": (frozenset({UNASSIGNED, IN_PROGRESS}), None),
    "handback": (frozenset({IN_PROGRESS}), RETURNED),
    "approve": (frozenset({RETURNED}), APPROVED),
    "rework": (frozenset({RETURNED}), IN_PROGRESS),
    "move_next": (frozenset({APPROVED}), TRANSITIONED),
}

ACTION_LABELS = {
    "assign": "Assigned",
    "unassign": "Unassigned",
    "handback": "Handed back for review",
    "approve": "QA approved",
    "rework": "Sent back for rework",
    "move_next": "Moved to next stage",
    "legacy_assign": "Assigned",
    "legacy_transition": "Stage completed",
    "arrived": "Arrived",
}


def effective_custody(sd: StageDetail) -> str:
    """custody_status, or a value derived from the legacy fields for rows written before migration 0073."""
    if sd.stage_status == "Completed":
        return TRANSITIONED
    cs = sd.custody_status
    if cs in ALL_STATUSES and cs != TRANSITIONED:
        return cs
    return IN_PROGRESS if sd.assignee_name else UNASSIGNED


def conflict(sd: StageDetail, message: str, current: Optional[dict] = None) -> HTTPException:
    from fastapi.encoders import jsonable_encoder
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "CUSTODY_CONFLICT", "message": message, "current_status": effective_custody(sd),
                "current": jsonable_encoder(current) if current else None},
    )


def check_expected(sd: StageDetail, expected: Optional[str], serialize=None) -> None:
    """Optimistic-concurrency guard: the client says what it saw; refuse if the row has moved on."""
    if expected and effective_custody(sd) != expected:
        raise conflict(
            sd,
            "This task was changed by someone else since you loaded it. Refresh to see the latest state.",
            serialize(sd) if serialize else None,
        )


def ensure_allowed(sd: StageDetail, action: str, serialize=None) -> str:
    allowed, _ = TRANSITIONS[action]
    current = effective_custody(sd)
    if current not in allowed:
        raise conflict(
            sd,
            f"Can't {action.replace('_', ' ')} a task that is {current.replace('_', ' ')}.",
            serialize(sd) if serialize else None,
        )
    return current


def record_event(sd: StageDetail, action: str, actor: Optional[str], *, from_status: Optional[str] = None,
                 to_status: Optional[str] = None, notes: Optional[str] = None, extra: Optional[dict] = None,
                 at: Optional[datetime] = None) -> None:
    event = {
        "type": "custody",
        "action": action,
        "from": from_status,
        "to": to_status,
        "by": actor,
        "at": (at or datetime.now(timezone.utc)).isoformat(),
    }
    if notes:
        event["notes"] = notes
    if extra:
        event.update(extra)
    history = list(sd.history or [])
    history.append(event)
    sd.history = history
    try:
        flag_modified(sd, "history")
    except Exception:  # transient objects (not yet attached) don't need the flag
        pass


def set_status(sd: StageDetail, new_status: str) -> None:
    sd.custody_status = new_status
