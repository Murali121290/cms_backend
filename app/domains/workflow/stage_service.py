"""Stage assignment / transition / date-shift logic.

Moved out of app.domains.workflow.api_v1 so the v1 routes, the v2 transition-email + bulk-transition
endpoints and the new /api/v2/workspace endpoints share one implementation. Routers stay thin and do
authentication; this module does validation, the state changes and the custody bookkeeping.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.workflow import custody
from app.domains.workflow.models import ChapterInfo, StageDetail, StageMaster, WorkflowMaster
from app.utils.timezone import get_app_timezone

logger = logging.getLogger(__name__)

MAX_BULK_TARGETS = 500
MAX_SHIFT_DAYS = 365


# ── time helpers ──────────────────────────────────────────────────────────────

def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """DB values come back aware (Postgres) or naive (SQLite / legacy writes); naive means UTC."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def local_date(dt: Optional[datetime]) -> Optional[date]:
    """Calendar day in the app timezone (Asia/Kolkata by default). Due dates are whole days."""
    if dt is None:
        return None
    return as_utc(dt).astimezone(get_app_timezone()).date()


def today_local() -> date:
    return datetime.now(get_app_timezone()).date()


def parse_client_dt(value: Optional[str]) -> Optional[datetime]:
    """ISO timestamp from the client. Invalid input is a 422, not silently 'now' (old behaviour)."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid date/time: {value!r}")
    return as_utc(parsed)


def is_past_due(sd: StageDetail, today: Optional[date] = None) -> bool:
    """Open and its due day has passed. A chapter due today is not late yet."""
    if sd.stage_status == "Completed":
        return False
    due = local_date(sd.planned_end_date)
    return bool(due and due < (today or today_local()))


def completion_delay_days(sd: StageDetail) -> Optional[int]:
    if sd.stage_status != "Completed" or not sd.actual_end_date or not sd.planned_end_date:
        return None
    return max(0, (local_date(sd.actual_end_date) - local_date(sd.planned_end_date)).days)


def chapter_label(chapters: Optional[str]) -> str:
    """Display name for a chapter: "01" -> "Chapter 01", "00"/"0" -> "Book"; anything else unchanged."""
    raw = (chapters or "").strip()
    if raw.isdigit():
        return "Book" if int(raw) == 0 else f"Chapter {raw}"
    return raw


# ── lookups / validation ──────────────────────────────────────────────────────

def get_detail(db: Session, project: str, chapters: str, stage_name: str) -> Optional[StageDetail]:
    return db.execute(
        select(StageDetail).where(
            StageDetail.project == project,
            StageDetail.chapters == chapters,
            StageDetail.stage_name == stage_name,
        ).order_by(StageDetail.id)
    ).scalars().first()


def require_stage(db: Session, stage_name: str) -> StageMaster:
    st = db.execute(select(StageMaster).where(StageMaster.stage_name == stage_name)).scalars().first()
    if not st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown stage: {stage_name}")
    return st


def validate_assignee(db: Session, username: Optional[str]) -> Optional[User]:
    if not username:
        return None
    user = db.execute(select(User).where(User.username == username)).scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"User {username!r} does not exist.")
    if user.active_status is False:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"User {username!r} is inactive.")
    return user


def ensure_role_allowed(db: Session, person: Optional[User], stage_name: str) -> None:
    """The assignee's Role (User Management) must be one of the stage's Roles (Stage Management).
    The Admin role may be assigned to any stage. A stage with no roles configured has no restriction."""
    if person is None:
        return
    from app.domains.workflow.access import parse_stage_roles

    st = db.execute(select(StageMaster).where(StageMaster.stage_name == stage_name)).scalars().first()
    norm = lambda v: "".join((v or "").lower().split())  # noqa: E731 — same normalisation as the project page
    allowed = {norm(r) for r in parse_stage_roles(st.roles)} if st else set()
    if allowed and norm(person.role) not in allowed and norm(person.role) != "admin":  # Admin role: every stage
        name = " ".join(p for p in (person.first_name, person.last_name) if p) or person.username
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{name}'s role ({person.role or 'none'}) isn't one of the roles for {stage_name} in Stage Management.",
        )


# ── live rows: a stage row is workable only while the chapter is in that stage ─────────────────────
# stages_details holds one row per chapter x stage, pre-created at planning time for every stage, so a row
# existing doesn't mean the chapter is there. chapter_details.stage_name is the "where is it now" pointer.

NOT_AT_STAGE = "NOT_AT_STAGE"


def current_stages(db: Session, keys: Iterable[tuple[str, str]]) -> dict[tuple[str, str], Optional[str]]:
    """(project, chapters) -> chapter's current stage, in one query."""
    keys = set(keys)
    if not keys:
        return {}
    rows = db.execute(
        select(ChapterInfo.project, ChapterInfo.chapters, ChapterInfo.stage_name).where(
            ChapterInfo.project.in_({k[0] for k in keys}), ChapterInfo.chapters.in_({k[1] for k in keys}))
    ).all()
    return {(p, c): s for p, c, s in rows if (p, c) in keys}


def is_live(sd: StageDetail, current: dict[tuple[str, str], Optional[str]]) -> bool:
    """Completed rows always count (history). Open rows only when the chapter is at that stage.
    Chapters without a chapter_details row / stage (legacy data) are treated as live, not hidden."""
    if sd.stage_status == "Completed":
        return True
    key = (sd.project, sd.chapters)
    if key not in current or not current[key]:
        return True
    return current[key] == sd.stage_name


def filter_live(db: Session, rows: list[StageDetail]) -> list[StageDetail]:
    current = current_stages(db, ((r.project, r.chapters) for r in rows))
    return [r for r in rows if is_live(r, current)]


def ensure_live(db: Session, sd: StageDetail) -> None:
    current = current_stages(db, [(sd.project, sd.chapters)])
    if not is_live(sd, current):
        where = current.get((sd.project, sd.chapters))
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": NOT_AT_STAGE,
            "message": f"{chapter_label(sd.chapters)} is still in {where}. It can't be worked in {sd.stage_name} until it is moved there.",
            "current_stage": where,
        })


def ensure_chapter_at_stage(db: Session, project: str, chapters: str, stage_name: str) -> None:
    """Same rule for callers that address a stage by name (project page assign)."""
    where = current_stages(db, [(project, chapters)]).get((project, chapters))
    if where and where != stage_name:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
            "code": NOT_AT_STAGE,
            "message": f"{chapter_label(chapters)} is still in {where}. Assign it in {stage_name} after it is moved there.",
            "current_stage": where,
        })


def chapter_info(db: Session, project: str, chapters: str) -> Optional[ChapterInfo]:
    return db.execute(
        select(ChapterInfo).where(ChapterInfo.project == project, ChapterInfo.chapters == chapters)
    ).scalars().first()


def _new_detail(db: Session, project: str, chapters: str, stage_name: str, *, client: Optional[str] = None,
                workflow: Optional[str] = None) -> StageDetail:
    """Create a missing stage row with the chapter's real client/workflow (was client=project)."""
    require_stage(db, stage_name)
    info = chapter_info(db, project, chapters)
    sd = StageDetail(
        client=client or (info.client if info else None) or project,
        project=project,
        chapters=chapters,
        stage_name=stage_name,
        workflow=workflow or (info.workflow if info else None) or "Workflow1",
        project_manager_name=info.project_manager_name if info else None,
        custody_status=custody.UNASSIGNED,
        history=[],
    )
    db.add(sd)
    return sd


# ── workflow graph ────────────────────────────────────────────────────────────

def workflow_rows(db: Session, workflow: Optional[str]) -> dict[str, WorkflowMaster]:
    if not workflow:
        return {}
    rows = db.execute(select(WorkflowMaster).where(WorkflowMaster.workflow_name == workflow)).scalars().all()
    return {r.stage_name: r for r in rows}


def downstream_stages(rows: dict[str, WorkflowMaster], stage_name: str) -> list[str]:
    out, seen = [], set()
    cur = rows.get(stage_name)
    while cur and cur.next_stage and cur.next_stage not in seen:
        seen.add(cur.next_stage)
        out.append(cur.next_stage)
        cur = rows.get(cur.next_stage)
    return out


def next_stage_name(db: Session, workflow: Optional[str], stage_name: str) -> Optional[str]:
    row = workflow_rows(db, workflow).get(stage_name)
    return row.next_stage if row else None


# ── stage owner ───────────────────────────────────────────────────────────────

def resolve_stage_owner_by_designation(db: Session, stage_name: str, project_code: Optional[str] = None,
                                       client_identifier: Optional[str] = None) -> Optional[User]:
    """Active user configured as owner of a stage via StageMaster.owner_designation.

    Preference when several match: customer_access contains the client/project, then the project's
    team, then the first match. (Unchanged behaviour, moved from api_v1.)
    """
    if not stage_name:
        return None
    stage_rec = db.execute(select(StageMaster).where(StageMaster.stage_name == stage_name)).scalars().first()
    if not stage_rec or not (stage_rec.owner_designation or "").strip():
        return None
    target = stage_rec.owner_designation.strip()

    users = list(db.execute(
        select(User).where(
            User.active_status == True,  # noqa: E712
            or_(func.lower(func.trim(User.designation)) == target.lower(), func.lower(func.trim(User.role)) == target.lower()),
        )
    ).scalars().all())

    if not users:
        norm = lambda s: (s or "").lower().replace("-", " ").replace("_", " ").strip()  # noqa: E731
        want = norm(target)
        for u in db.execute(select(User).where(User.active_status == True)).scalars().all():  # noqa: E712
            if norm(u.designation) == want or norm(u.role) == want:
                users.append(u)
            elif isinstance(u.additional_roles, list) and any(norm(str(r)) == want for r in u.additional_roles):
                users.append(u)
    if not users:
        return None
    if len(users) == 1:
        return users[0]

    if client_identifier or project_code:
        for u in users:
            acc = u.customer_access or []
            if isinstance(acc, str):
                try:
                    acc = json.loads(acc)
                except Exception:
                    acc = [acc]
            if isinstance(acc, list) and ((client_identifier and client_identifier in acc) or (project_code and project_code in acc)):
                return u

    if project_code:
        from app.domains.projects.models import Project
        proj = db.execute(select(Project).where(Project.project_code == project_code)).scalars().first()
        if proj and proj.team:
            for u in users:
                if u.team and u.team.lower() == proj.team.lower():
                    return u
    return users[0]


# ── assignment ────────────────────────────────────────────────────────────────

def _sync_custody_on_assign(sd: StageDetail, old_assignee: Optional[str], new_assignee: Optional[str], actor: Optional[str],
                            action: str = "legacy_assign", notes: Optional[str] = None) -> None:
    before = custody.effective_custody(sd)
    if before == custody.TRANSITIONED:
        return  # assignee edits on completed rows don't reopen them
    if not new_assignee:
        after = custody.UNASSIGNED
    elif before == custody.UNASSIGNED or new_assignee != old_assignee:
        after = custody.IN_PROGRESS
    else:
        after = before
    custody.set_status(sd, after)
    if after != before or new_assignee != old_assignee:
        sd.assigned_by = actor if new_assignee else sd.assigned_by
        custody.record_event(sd, "unassign" if not new_assignee else action, actor, from_status=before, to_status=after,
                             notes=notes, extra={"assignee": new_assignee, "previous_assignee": old_assignee})


def assign_stage(db: Session, *, project: str, chapters: str, stage_name: str, assignee: Optional[str],
                 dt: Optional[str] = None, actor: Optional[str] = None) -> StageDetail:
    ensure_role_allowed(db, validate_assignee(db, assignee), stage_name)
    if assignee:  # unassigning a not-yet-reached stage stays allowed (cleanup)
        ensure_chapter_at_stage(db, project, chapters, stage_name)
    when = parse_client_dt(dt) or utc_now()
    sd = get_detail(db, project, chapters, stage_name) or _new_detail(db, project, chapters, stage_name)
    old = sd.assignee_name
    sd.assignee_name = assignee
    if not sd.actual_start_date and not sd.actual_end_date:
        sd.actual_start_date = when
    _sync_custody_on_assign(sd, old, assignee, actor)
    db.commit()
    db.refresh(sd)
    return sd


@dataclass
class AssignTarget:
    project: str
    chapters: str
    stage_name: str


def bulk_assign(db: Session, *, targets: list[AssignTarget], assignee: Optional[str], dt: Optional[str] = None,
                actor: Optional[str] = None) -> list[StageDetail]:
    if len(targets) > MAX_BULK_TARGETS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"At most {MAX_BULK_TARGETS} chapters per request.")
    person = validate_assignee(db, assignee)
    for stage_name in sorted({t.stage_name for t in targets}):
        ensure_role_allowed(db, person, stage_name)
    if assignee:
        current = current_stages(db, ((t.project, t.chapters) for t in targets))
        away = [t for t in targets if current.get((t.project, t.chapters)) not in (None, t.stage_name)]
        if away:
            t = away[0]
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
                "code": NOT_AT_STAGE,
                "message": f"{len(away)} chapter(s) aren't in that stage yet, e.g. {chapter_label(t.chapters)} is still in "
                           f"{current[(t.project, t.chapters)]}. Assign them after they are moved there.",
            })
    when = parse_client_dt(dt) or utc_now()
    keys ={(t.project, t.chapters, t.stage_name) for t in targets}
    existing: dict[tuple[str, str, str], StageDetail] = {}
    if keys:
        rows = db.execute(
            select(StageDetail).where(
                StageDetail.project.in_({k[0] for k in keys}),
                StageDetail.chapters.in_({k[1] for k in keys}),
                StageDetail.stage_name.in_({k[2] for k in keys}),
            ).order_by(StageDetail.id)
        ).scalars().all()
        for r in rows:
            existing.setdefault((r.project, r.chapters, r.stage_name), r)

    out = []
    for t in targets:
        key = (t.project, t.chapters, t.stage_name)
        sd = existing.get(key)
        if sd is None:
            sd = _new_detail(db, t.project, t.chapters, t.stage_name)
            existing[key] = sd
        old = sd.assignee_name
        sd.assignee_name = assignee
        if not sd.actual_start_date and not sd.actual_end_date:
            sd.actual_start_date = when
        _sync_custody_on_assign(sd, old, assignee, actor)
        out.append(sd)
    db.commit()
    for sd in out:
        db.refresh(sd)
    return out


# ── transition ────────────────────────────────────────────────────────────────

def transition_stage(db: Session, *, project: str, chapters: str, from_stage: str, to_stage: str,
                     dt: Optional[str] = None, actor: Optional[str] = None, strict: bool = True,
                     auto_assign_owner: bool = True, commit: bool = True) -> StageDetail:
    """Complete `from_stage` and open `to_stage` for one chapter.

    strict=True (public v1 endpoint): the from-row must exist and `to_stage` must be downstream of
    `from_stage` in the chapter's workflow (when the workflow is defined in WorkflowMaster).
    strict=False keeps the lenient legacy behaviour for the v2 transition-email / bulk-transition flows.
    """
    if from_stage == to_stage:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="from_stage and to_stage are the same.")
    require_stage(db, to_stage)
    when = parse_client_dt(dt) or utc_now()
    from_detail = get_detail(db, project, chapters, from_stage)

    if strict:
        if not from_detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"{chapters} has no {from_stage} stage row in project {project}.")
        rows = workflow_rows(db, from_detail.workflow)
        if rows and from_stage in rows and to_stage not in downstream_stages(rows, from_stage):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"{to_stage} does not follow {from_stage} in workflow {from_detail.workflow}.")

    if from_detail:
        before = custody.effective_custody(from_detail)
        from_detail.stage_status = "Completed"
        from_detail.actual_end_date = when
        if from_detail.actual_start_date:
            from_detail.total_time_taken = (when - as_utc(from_detail.actual_start_date)).total_seconds() / 3600.0

        end_day, due_day = local_date(when), local_date(from_detail.planned_end_date)
        if due_day and end_day > due_day:
            from_detail.delayed = True
            from_detail.delay_days = (end_day - due_day).days
        else:
            from_detail.delayed = False
            from_detail.delay_days = 0
        custody.set_status(from_detail, custody.TRANSITIONED)
        custody.record_event(from_detail, "move_next" if before == custody.APPROVED else "legacy_transition", actor,
                             from_status=before, to_status=custody.TRANSITIONED, extra={"to_stage": to_stage}, at=when)

        if from_detail.delay_days and from_detail.delay_days > 0:
            rows = workflow_rows(db, from_detail.workflow)
            later = [to_stage] + downstream_stages(rows, to_stage) if to_stage in rows else []
            if later:
                shift = timedelta(days=from_detail.delay_days)
                for sd in db.execute(select(StageDetail).where(
                        StageDetail.project == project, StageDetail.chapters == chapters,
                        StageDetail.stage_name.in_(later))).scalars().all():
                    if sd.planned_start_date:
                        sd.planned_start_date += shift
                    if sd.planned_end_date:
                        sd.planned_end_date += shift

        info = chapter_info(db, project, chapters)
        if info:
            try:
                delays = json.loads(info.delayed_stages) if info.delayed_stages else {}
                if not isinstance(delays, dict):
                    delays = {}
            except Exception:
                delays = {}
            if from_detail.delayed:
                delays[from_detail.stage_name] = from_detail.delay_days
            else:
                delays.pop(from_detail.stage_name, None)
            info.delayed_stages = json.dumps(delays)

    to_detail = get_detail(db, project, chapters, to_stage)
    if not to_detail:
        to_detail = _new_detail(db, project, chapters, to_stage,
                                client=from_detail.client if from_detail else None,
                                workflow=from_detail.workflow if from_detail else None)

    wf_stage = workflow_rows(db, to_detail.workflow).get(to_stage)
    is_final = bool(wf_stage and not wf_stage.next_stage)
    if is_final:
        to_detail.stage_status = "Completed"
        to_detail.actual_end_date = when
        custody.set_status(to_detail, custody.TRANSITIONED)
    else:
        to_detail.stage_status = "In-progress"
        to_detail.actual_end_date = None
        # A chapter arriving in a stage waits in the owner's Inbound until someone is assigned.
        custody.set_status(to_detail, custody.UNASSIGNED)
        to_detail.handback_notes = None
        to_detail.handback_at = None
        to_detail.qa_approved_by = None
        to_detail.qa_approved_at = None
    custody.record_event(to_detail, "arrived", actor, to_status=to_detail.custody_status,
                         extra={"from_stage": from_stage}, at=when)

    if auto_assign_owner:
        owner = resolve_stage_owner_by_designation(db, to_stage, project_code=project,
                                                   client_identifier=from_detail.client if from_detail else None)
        if owner:
            # Legacy behaviour: the owner holds the chapter. Custody stays "unassigned" (Inbound).
            to_detail.assignee_name = owner.username
            info = chapter_info(db, project, chapters)
            if info:
                info.current_assignee_name = owner.username

    to_detail.actual_start_date = when
    if commit:
        db.commit()
        db.refresh(to_detail)
    return to_detail


# ── planned-date shift ────────────────────────────────────────────────────────

def shift_planned_dates(db: Session, *, project: str, chapters: str, stage_names: Iterable[str], days: int) -> int:
    if abs(days) > MAX_SHIFT_DAYS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Shift must be within ±{MAX_SHIFT_DAYS} days.")
    rows = db.execute(select(StageDetail).where(
        StageDetail.project == project, StageDetail.chapters == chapters, StageDetail.stage_name.in_(list(stage_names))
    )).scalars().all()
    delta = timedelta(days=days)
    for sd in rows:
        if sd.planned_start_date:
            sd.planned_start_date += delta
        if sd.planned_end_date:
            sd.planned_end_date += delta
    db.commit()
    return len(rows)
