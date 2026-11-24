"""Workspace task actions (custody lifecycle) and the stage schedule.

Routers in app/routers/workspace_v2.py call these; they authenticate, this module authorises,
validates the state machine, writes, audits and queues notifications.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Callable, Optional

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.workflow import access, custody, stage_service
from app.domains.workflow.models import ChapterInfo, StageDetail, StageMaster
from app.utils.timezone import get_app_timezone

logger = logging.getLogger(__name__)

MAX_SCHEDULE_ROWS = 1000
MAX_SCHEDULE_DAYS = 120


# ── helpers ───────────────────────────────────────────────────────────────────

def serialize(db: Session, sd: StageDetail) -> dict:
    from app.domains.projects.dashboard_service import WorkspaceContext
    ctx = WorkspaceContext(db)
    ctx.preload([sd])
    return ctx.item(sd)


def _serializer(db: Session) -> Callable[[StageDetail], dict]:
    return lambda sd: serialize(db, sd)


def load_task(db: Session, task_id: int) -> StageDetail:
    sd = db.get(StageDetail, task_id)
    if not sd:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    return sd


def release_chapter_locks(db: Session, sd: StageDetail, *, keep_user_id: Optional[int] = None) -> int:
    """Clear editor check-outs on the chapter's files when custody changes hands (hand back, review, move,
    reassign), so a file is never left locked by someone who no longer holds the chapter. No commit."""
    from app.models import File

    info = stage_service.chapter_info(db, sd.project, sd.chapters)
    if not info:
        return 0
    n = 0
    for f in db.query(File).filter(File.chapter_id == info.id, File.is_checked_out == True).all():  # noqa: E712
        if keep_user_id is not None and f.checked_out_by_id == keep_user_id:
            continue
        f.is_checked_out = False
        f.checked_out_by_id = None
        f.checked_out_at = None
        n += 1
    return n


def _ensure_manage(db: Session, actor: User, sd: StageDetail) -> None:
    if not access.can_manage_row(db, actor, sd.stage_name, sd.project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You don't manage the {sd.stage_name} stage.")


def _user(db: Session, username: Optional[str]) -> Optional[User]:
    if not username:
        return None
    return db.execute(select(User).where(User.username == username)).scalars().first()


def _name(u: Optional[User], fallback: Optional[str] = None) -> str:
    if not u:
        return fallback or "—"
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username


def _send_later(background: Optional[BackgroundTasks], to: list[str], subject: str, body: str, cc: Optional[list[str]] = None,
                html: Optional[str] = None) -> None:
    """Queue an email after the response; delivery problems are logged, never surfaced as errors."""
    to = [e for e in dict.fromkeys(to) if e]
    cc = [e for e in dict.fromkeys(cc or []) if e and e not in to]
    if not to:
        return

    def _job():
        try:
            from app.domains.notifications.email_service import send_email
            send_email(to_email=", ".join(to), subject=subject, text_body=body, html_body=html, cc_emails=cc or None)
        except Exception as exc:  # pragma: no cover - SMTP is environment specific
            logger.warning("Workspace notification not sent (%s): %s", subject, exc)

    if background is not None:
        background.add_task(_job)
    else:
        _job()


# ── assign ────────────────────────────────────────────────────────────────────

def assign_task(db: Session, actor: User, task_id: int, *, assignee: Optional[str], priority: Optional[str] = None,
                planned_end_date: Optional[datetime] = None, notes: Optional[str] = None, notify: bool = True,
                expected: Optional[str] = None, background: Optional[BackgroundTasks] = None) -> StageDetail:
    sd = load_task(db, task_id)
    _ensure_manage(db, actor, sd)
    if assignee:  # no assigning before the chapter reaches the stage; clearing an early assignment is fine
        stage_service.ensure_live(db, sd)
    ser = _serializer(db)
    custody.check_expected(sd, expected, ser)
    before = custody.ensure_allowed(sd, "assign", ser)
    person = stage_service.validate_assignee(db, assignee)
    stage_service.ensure_role_allowed(db, person, sd.stage_name)

    old = sd.assignee_name
    sd.assignee_name = assignee
    if assignee and not sd.actual_start_date:
        sd.actual_start_date = stage_service.utc_now()
    if priority:
        sd.priority = priority
    if planned_end_date:
        if planned_end_date.tzinfo is None:  # the UI sends a local "YYYY-MM-DDT23:59:59" (end of the due day)
            planned_end_date = get_app_timezone().localize(planned_end_date)
        sd.planned_end_date = stage_service.as_utc(planned_end_date)
    if notes is not None:
        sd.assignment_notes = notes.strip() or None
    after = custody.IN_PROGRESS if assignee else custody.UNASSIGNED
    custody.set_status(sd, after)
    sd.assigned_by = actor.username if assignee else sd.assigned_by
    custody.record_event(sd, "assign" if assignee else "unassign", actor.username, from_status=before, to_status=after,
                         notes=notes, extra={"assignee": assignee, "previous_assignee": old, "priority": sd.priority})
    info = stage_service.chapter_info(db, sd.project, sd.chapters)
    if info and info.stage_name == sd.stage_name:
        info.current_assignee_name = assignee
    if assignee != old:
        release_chapter_locks(db, sd, keep_user_id=person.id if person else None)
    db.commit()
    db.refresh(sd)

    if notify and person and assignee != old:
        send_assignment_email(db, actor, person, [sd], background)
    return sd


def send_assignment_email(db: Session, actor: User, person: User, rows: list[StageDetail],
                          background: Optional[BackgroundTasks] = None) -> None:
    """One email per person, listing every chapter just assigned to them (bulk = one mail, not one per chapter).

    TO: the assignee. CC: the team group email of each stage involved (StageMaster.group_email).
    """
    if not person or not person.email or not rows:
        return
    from html import escape
    from app.domains.projects.dashboard_service import WorkspaceContext
    stage_names = sorted({r.stage_name for r in rows})
    projects = sorted({r.project for r in rows})
    groups = [st.group_email for st in db.execute(select(StageMaster).where(StageMaster.stage_name.in_(stage_names))).scalars().all()
              if st.group_email]
    ctx = WorkspaceContext(db)
    ctx.preload(rows)

    def line(r: StageDetail) -> dict:
        due = stage_service.local_date(r.planned_end_date)
        return {"chapter": stage_service.chapter_label(r.chapters), "project": r.project, "client": ctx.client_name(r),
                "stage": r.stage_name, "priority": r.priority or "Normal", "due": due.strftime("%d %b %Y") if due else "Not set",
                "notes": r.assignment_notes or ""}

    lines = [line(r) for r in sorted(rows, key=lambda r: (r.project, r.chapters))]
    n = len(lines)
    what = lines[0]["chapter"] if n == 1 else f"{n} chapters"
    subject = f"[{', '.join(projects)}] {what} assigned to you · {', '.join(stage_names)}"

    text = [f"Hi {_name(person)},", "", f"{_name(actor)} assigned you " + ("this chapter:" if n == 1 else f"these {n} chapters:"), ""]
    for ln in lines:
        text.append(f"- {ln['chapter']} · {ln['project']} ({ln['client']}) · {ln['stage']} · Priority {ln['priority']} · Due {ln['due']}")
        if ln["notes"]:
            text.append(f"    Instructions: {ln['notes']}")
    text += ["", "Open your workspace to start.", "", "Regards,", "S4C Ninja Inkflow", "", "This is an automated message."]

    td = "padding:6px 10px;border-bottom:1px solid #e5e7eb"
    rows_html = "".join(
        f"<tr><td style='{td}'><b>{escape(ln['chapter'])}</b></td>"
        f"<td style='{td}'>{escape(ln['project'])}<br><span style='color:#6b7280'>{escape(ln['client'])}</span></td>"
        f"<td style='{td}'>{escape(ln['stage'])}</td><td style='{td}'>{escape(ln['priority'])}</td>"
        f"<td style='{td};white-space:nowrap'>{escape(ln['due'])}</td><td style='{td};color:#374151'>{escape(ln['notes'])}</td></tr>"
        for ln in lines
    )
    head = "".join(f"<th align='left' style='padding:6px 10px;background:#f3f4f6;font-size:12px'>{h}</th>"
                   for h in ("Chapter", "Project", "Stage", "Priority", "Due", "Instructions"))
    html = (
        "<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111827'>"
        f"<p>Hi {escape(_name(person))},</p>"
        f"<p>{escape(_name(actor))} assigned you " + ("this chapter:" if n == 1 else f"these {n} chapters:") + "</p>"
        f"<table cellspacing='0' style='border-collapse:collapse;border:1px solid #e5e7eb'><tr>{head}</tr>{rows_html}</table>"
        "<p>Open your workspace to start.</p><p>Regards,<br>S4C Ninja Inkflow</p>"
        "<p style='color:#6b7280;font-size:12px'>This is an automated message.</p></div>"
    )
    _send_later(background, [person.email], subject, "\n".join(text), cc=groups, html=html)


# ── hand back / review ────────────────────────────────────────────────────────

def handback_task(db: Session, actor: User, task_id: int, *, notes: str, checklist_confirmed: bool,
                  expected: Optional[str] = None, background: Optional[BackgroundTasks] = None) -> StageDetail:
    sd = load_task(db, task_id)
    if sd.assignee_name != actor.username and not access.can_manage_row(db, actor, sd.stage_name, sd.project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned person or the stage owner can hand this back.")
    stage_service.ensure_live(db, sd)
    if not checklist_confirmed:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Confirm the checklist before handing back.")
    ser = _serializer(db)
    custody.check_expected(sd, expected, ser)
    before = custody.ensure_allowed(sd, "handback", ser)
    now = stage_service.utc_now()
    sd.handback_notes = notes.strip()
    sd.handback_at = now
    custody.set_status(sd, custody.RETURNED)
    custody.record_event(sd, "handback", actor.username, from_status=before, to_status=custody.RETURNED, notes=sd.handback_notes, at=now)
    release_chapter_locks(db, sd)
    db.commit()
    db.refresh(sd)

    owner = stage_service.resolve_stage_owner_by_designation(db, sd.stage_name, project_code=sd.project, client_identifier=sd.client)
    stage = db.execute(select(StageMaster).where(StageMaster.stage_name == sd.stage_name)).scalars().first()
    _send_later(background, [owner.email if owner else None, stage.group_email if stage else None],
                f"[{sd.project}] {sd.chapters} ready for review · {sd.stage_name}",
                f"{_name(actor)} handed back {sd.chapters} ({sd.project}) for QA sign-off in {sd.stage_name}.\n\n"
                f"Notes:\n{sd.handback_notes}\n")
    return sd


def review_task(db: Session, actor: User, task_id: int, *, decision: str, notes: Optional[str],
                expected: Optional[str] = None, background: Optional[BackgroundTasks] = None) -> StageDetail:
    sd = load_task(db, task_id)
    _ensure_manage(db, actor, sd)
    stage_service.ensure_live(db, sd)
    ser = _serializer(db)
    custody.check_expected(sd, expected, ser)
    notes = (notes or "").strip() or None
    now = stage_service.utc_now()
    if decision == "approve":
        before = custody.ensure_allowed(sd, "approve", ser)
        sd.qa_approved_by = actor.username
        sd.qa_approved_at = now
        custody.set_status(sd, custody.APPROVED)
        custody.record_event(sd, "approve", actor.username, from_status=before, to_status=custody.APPROVED, notes=notes, at=now)
    else:
        if not notes:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Say what needs fixing when sending work back.")
        before = custody.ensure_allowed(sd, "rework", ser)
        sd.rework_notes = notes
        sd.rework_count = (sd.rework_count or 0) + 1
        sd.qa_approved_by = None
        sd.qa_approved_at = None
        custody.set_status(sd, custody.IN_PROGRESS)
        custody.record_event(sd, "rework", actor.username, from_status=before, to_status=custody.IN_PROGRESS, notes=notes, at=now)
    release_chapter_locks(db, sd)
    db.commit()
    db.refresh(sd)

    if decision == "rework":
        person = _user(db, sd.assignee_name)
        if person and person.email:
            _send_later(background, [person.email], f"[{sd.project}] {sd.chapters} sent back for rework · {sd.stage_name}",
                        f"{_name(actor)} sent {sd.chapters} back for rework.\n\nWhat needs fixing:\n{notes}\n")
    return sd


# ── move to next stage ────────────────────────────────────────────────────────

@dataclass
class MovePlan:
    sd: StageDetail
    next_stage: Optional[str]
    next_owner: Optional[User]
    to: list[dict]
    cc: list[dict]
    subject: str
    late_days: int


def _recipient(u: Optional[User]) -> Optional[dict]:
    if u and u.email:
        return {"username": u.username, "name": _name(u), "email": u.email}
    return None


def _client_template(db: Session, actor: User, sd: StageDetail, next_stage: str) -> Optional[dict]:
    """Recipients/subject from the client's StageTransitionConfig, if one exists (same as the chapter page)."""
    info = stage_service.chapter_info(db, sd.project, sd.chapters)
    if not info:
        return None
    try:
        from app.routers.api_v2 import api_v2_get_chapter_transition_config
        cfg = api_v2_get_chapter_transition_config(chapter_id=info.id, next_stage=next_stage, db=db, user=actor)
    except Exception as exc:
        logger.info("No client transition template for %s/%s: %s", sd.project, sd.chapters, exc)
        return None
    if not getattr(cfg, "has_config", False):
        return None
    return {"to": list(cfg.to or []), "cc": list(cfg.cc or []), "subject": cfg.subject or ""}


def plan_move(db: Session, actor: User, sd: StageDetail) -> MovePlan:
    nxt = stage_service.next_stage_name(db, sd.workflow, sd.stage_name)
    late = 0
    due = stage_service.local_date(sd.planned_end_date)
    if due:
        late = max(0, (stage_service.today_local() - due).days)
    if not nxt:
        pm = _user(db, sd.project_manager_name)
        to = [r for r in [_recipient(pm)] if r]
        return MovePlan(sd, None, None, to, [], f"[{sd.project}] {sd.chapters} completed", late)

    owner = stage_service.resolve_stage_owner_by_designation(db, nxt, project_code=sd.project, client_identifier=sd.client)
    next_stage_row = db.execute(select(StageMaster).where(StageMaster.stage_name == nxt)).scalars().first()
    cur_owner = stage_service.resolve_stage_owner_by_designation(db, sd.stage_name, project_code=sd.project, client_identifier=sd.client)
    pm = _user(db, sd.project_manager_name)

    to = [r for r in [_recipient(owner)] if r]
    if next_stage_row and next_stage_row.group_email:
        to.append({"username": None, "name": f"{nxt} team", "email": next_stage_row.group_email})
    cc = [r for r in [_recipient(pm), _recipient(cur_owner), _recipient(actor)] if r]
    subject = f"[{sd.project}] {sd.chapters} ready for {nxt}"

    tpl = _client_template(db, actor, sd, nxt)
    if tpl:
        to = [{"username": None, "name": None, "email": e} for e in tpl["to"]] or to
        cc = [{"username": None, "name": None, "email": e} for e in tpl["cc"]] or cc
        subject = tpl["subject"] or subject

    seen: set[str] = set()
    to = [r for r in to if not (r["email"] in seen or seen.add(r["email"]))]
    cc = [r for r in cc if not (r["email"] in seen or seen.add(r["email"]))]
    return MovePlan(sd, nxt, owner, to, cc, subject, late)


def move_preview(db: Session, actor: User, task_id: int) -> dict:
    sd = load_task(db, task_id)
    _ensure_manage(db, actor, sd)
    plan = plan_move(db, actor, sd)
    return {
        "task_id": sd.id,
        "from_stage": sd.stage_name,
        "next_stage": plan.next_stage,
        "next_owner_username": plan.next_owner.username if plan.next_owner else None,
        "next_owner_name": _name(plan.next_owner) if plan.next_owner else None,
        "to": plan.to,
        "cc": plan.cc,
        "subject": plan.subject,
        "late_days": plan.late_days,
    }


def move_next(db: Session, actor: User, task_id: int, *, notify: bool = True, expected: Optional[str] = None,
              background: Optional[BackgroundTasks] = None) -> StageDetail:
    sd = load_task(db, task_id)
    _ensure_manage(db, actor, sd)
    stage_service.ensure_live(db, sd)
    ser = _serializer(db)
    custody.check_expected(sd, expected, ser)
    custody.ensure_allowed(sd, "move_next", ser)
    plan = plan_move(db, actor, sd)

    if plan.next_stage:
        stage_service.transition_stage(db, project=sd.project, chapters=sd.chapters, from_stage=sd.stage_name,
                                       to_stage=plan.next_stage, actor=actor.username, strict=True, commit=False)
        info = stage_service.chapter_info(db, sd.project, sd.chapters)
        if info:
            info.stage_name = plan.next_stage
    else:
        # Final stage of the workflow: complete it here.
        before = custody.effective_custody(sd)
        now = stage_service.utc_now()
        sd.stage_status = "Completed"
        sd.actual_end_date = now
        due = stage_service.local_date(sd.planned_end_date)
        sd.delay_days = max(0, (stage_service.local_date(now) - due).days) if due else 0
        sd.delayed = bool(sd.delay_days)
        custody.set_status(sd, custody.TRANSITIONED)
        custody.record_event(sd, "move_next", actor.username, from_status=before, to_status=custody.TRANSITIONED,
                             extra={"to_stage": None}, at=now)
    release_chapter_locks(db, sd)
    db.commit()
    db.refresh(sd)

    if notify:
        due_next = None
        if plan.next_stage:
            nxt_row = stage_service.get_detail(db, sd.project, sd.chapters, plan.next_stage)
            due_next = stage_service.local_date(nxt_row.planned_end_date) if nxt_row else None
        body = (
            f"Hi,\n\n{sd.chapters} ({sd.project}) has completed {sd.stage_name} and was QA-approved by {_name(actor)}.\n"
            + (f"It is now waiting in {plan.next_stage}" + (f", planned due {due_next.isoformat()}" if due_next else "") + ".\n"
               if plan.next_stage else "This was the final stage of the workflow.\n")
            + (f"\nThe stage finished {plan.late_days} day(s) late; later planned dates were shifted.\n" if plan.late_days else "")
            + "\nRegards,\nS4C Ninja Inkflow\n\nThis is an automated message."
        )
        _send_later(background, [r["email"] for r in plan.to], plan.subject, body, [r["email"] for r in plan.cc])
    return sd


# ── bulk ──────────────────────────────────────────────────────────────────────

def bulk(db: Session, actor: User, *, action: str, task_ids: list[int], assignee: Optional[str], notify: bool,
         background: Optional[BackgroundTasks] = None) -> list[dict]:
    person = stage_service.validate_assignee(db, assignee) if action == "assign" else None
    newly_assigned: list[StageDetail] = []
    results = []
    for task_id in dict.fromkeys(task_ids):
        try:
            sd = load_task(db, task_id)
            if not access.can_manage_row(db, actor, sd.stage_name, sd.project):
                results.append({"task_id": task_id, "status": "forbidden", "message": f"You don't manage {sd.stage_name}."})
                continue
            cur = custody.effective_custody(sd)
            eligible = {"assign": (custody.UNASSIGNED, custody.IN_PROGRESS), "approve": (custody.RETURNED,), "move_next": (custody.APPROVED,)}[action]
            if cur not in eligible:
                results.append({"task_id": task_id, "status": "skipped", "message": f"Task is {cur.replace('_', ' ')}.", "item": serialize(db, sd)})
                continue
            if action == "assign":
                previous = sd.assignee_name
                sd = assign_task(db, actor, task_id, assignee=assignee, notify=False, expected=cur, background=background)
                if assignee and previous != assignee:
                    newly_assigned.append(sd)
            elif action == "approve":
                sd = review_task(db, actor, task_id, decision="approve", notes=None, expected=cur, background=background)
            else:
                sd = move_next(db, actor, task_id, notify=notify, expected=cur, background=background)
            results.append({"task_id": task_id, "status": "ok", "item": serialize(db, sd)})
        except HTTPException as exc:
            db.rollback()
            kind = {404: "error", 403: "forbidden", 409: "conflict"}.get(exc.status_code, "error")
            msg = exc.detail.get("message") if isinstance(exc.detail, dict) else str(exc.detail)
            results.append({"task_id": task_id, "status": kind, "message": msg})
        except Exception as exc:  # keep going; report the failure for this row only
            db.rollback()
            logger.exception("Bulk %s failed for task %s", action, task_id)
            results.append({"task_id": task_id, "status": "error", "message": str(exc)})
    if notify and person and newly_assigned:
        # One email listing every chapter, instead of one email per chapter.
        send_assignment_email(db, actor, person, newly_assigned, background)
    return results


# ── activity ──────────────────────────────────────────────────────────────────

def _event_text(ev: dict, names: dict[str, str]) -> str:
    action = ev.get("action")
    who = lambda u: names.get(u, u) if u else "Unassigned"  # noqa: E731
    notes = f" — “{ev['notes']}”" if ev.get("notes") else ""
    if action in ("assign", "legacy_assign"):
        prev = ev.get("previous_assignee")
        txt = f"Reassigned from {who(prev)} to {who(ev.get('assignee'))}" if prev and prev != ev.get("assignee") else f"Assigned to {who(ev.get('assignee'))}"
        return txt + (f" · {ev['priority']}" if ev.get("priority") and ev.get("priority") != "Normal" else "") + notes
    if action == "unassign":
        return f"Unassigned (was {who(ev.get('previous_assignee'))})"
    if action == "handback":
        return "Handed back for review" + notes
    if action == "approve":
        return "QA approved" + notes
    if action == "rework":
        return "Sent back for rework" + notes
    if action in ("move_next", "legacy_transition"):
        return f"Moved to {ev['to_stage']}" if ev.get("to_stage") else "Marked complete"
    if action == "arrived":
        return f"Arrived from {ev['from_stage']}" if ev.get("from_stage") else "Arrived"
    return custody.ACTION_LABELS.get(action or "", action or "Updated")


def activity(db: Session, actor: User, task_id: int) -> dict:
    sd = load_task(db, task_id)
    if sd.assignee_name != actor.username and not access.can_manage_row(db, actor, sd.stage_name, sd.project) and not access.is_manager_level(actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can't view this task's history.")
    history = list(sd.history or [])
    usernames = {u for ev in history for u in (ev.get("by"), ev.get("assignee"), ev.get("previous_assignee")) if u}
    names = {u.username: _name(u) for u in db.execute(select(User).where(User.username.in_(usernames or {""}))).scalars().all()}
    events = []
    for ev in history:
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "custody":
            events.append({"at": ev.get("at"), "actor": ev.get("by"), "kind": "custody",
                           "action": ev.get("action"), "text": _event_text(ev, names)})
        elif "before" in ev and "after" in ev:  # planning change written by /stage-details/plan
            b, a = ev.get("before") or {}, ev.get("after") or {}
            due_b, due_a = (b.get("planned_end_date") or "")[:10], (a.get("planned_end_date") or "")[:10]
            events.append({"at": ev.get("changed_at"), "actor": ev.get("changed_by"), "kind": "planning", "action": "replan",
                           "text": f"Planned dates changed{f' ({due_b} → {due_a})' if due_b != due_a else ''}: {ev.get('reason') or 'planning adjustment'}"})
        else:
            events.append({"at": ev.get("at") or ev.get("changed_at"), "actor": ev.get("by") or ev.get("changed_by"),
                           "kind": "other", "action": None, "text": str(ev.get("reason") or ev.get("text") or "Updated")})
    events.sort(key=lambda e: e["at"] or "", reverse=True)
    return {"task": serialize(db, sd), "events": events}


# ── schedule ──────────────────────────────────────────────────────────────────

def schedule(db: Session, actor: User, stage_name: str, date_from: date, date_to: date, include_completed: bool) -> dict:
    if date_to < date_from:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="date_to is before date_from.")
    if (date_to - date_from).days > MAX_SCHEDULE_DAYS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Pick a range of at most {MAX_SCHEDULE_DAYS} days.")
    stage_service.require_stage(db, stage_name)
    if not access.can_manage_stage(db, actor, stage_name) and not access.is_manager_level(actor):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You don't manage the {stage_name} stage.")

    tz = get_app_timezone()
    # Whole local days, compared in UTC (what the DB stores).
    start = stage_service.as_utc(tz.localize(datetime.combine(date_from, time.min)))
    end = stage_service.as_utc(tz.localize(datetime.combine(date_to + timedelta(days=1), time.min)))
    # A row overlaps the window when it starts (planned or actual) before the window ends and has not
    # finished (planned or actual) before the window starts. Open rows always reach "today".
    starts_before_end = or_(StageDetail.planned_start_date < end, StageDetail.actual_start_date < end,
                            and_(StageDetail.planned_start_date.is_(None), StageDetail.actual_start_date.is_(None)))
    ends_after_start = or_(StageDetail.stage_status != "Completed", StageDetail.actual_end_date >= start,
                           and_(StageDetail.actual_end_date.is_(None), StageDetail.planned_end_date >= start))
    conds = [StageDetail.stage_name == stage_name, starts_before_end, ends_after_start]
    if not include_completed:
        conds.append(StageDetail.stage_status != "Completed")
    rows = db.query(StageDetail).filter(*conds).order_by(StageDetail.planned_start_date, StageDetail.id).limit(MAX_SCHEDULE_ROWS + 1).all()
    truncated = len(rows) > MAX_SCHEDULE_ROWS
    rows = rows[:MAX_SCHEDULE_ROWS]

    from app.domains.projects.dashboard_service import WorkspaceContext
    ctx = WorkspaceContext(db)
    ctx.set_viewer(actor, access.active_stages(db))
    ctx.preload(rows)
    return {"stage_name": stage_name, "date_from": start, "date_to": end, "items": [ctx.item(r) for r in rows], "truncated": truncated}


# ── chapter page: the chapter's task in its current stage ─────────────────────

def chapter_task(db: Session, actor: User, chapter_id: int) -> dict:
    """What the workflow bar on the chapter folder page needs: the live task, the viewer's rights and the
    people who can be assigned in this stage (Stage Management roles + Admin role), lightest load first."""
    chapter = db.get(ChapterInfo, chapter_id)
    if not chapter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chapter not found.")
    if not access.can_view_chapter(db, actor, chapter):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This chapter isn't assigned to you.")

    stage = chapter.stage_name
    out = {"chapter_id": chapter.id, "stage_name": stage, "item": None, "can_manage": False, "is_assignee": False,
           "can_write": access.can_write_chapter(db, actor, chapter), "owner_name": None, "people": []}
    if not stage:
        return out
    sd = (db.query(StageDetail)
          .filter(StageDetail.project == chapter.project, StageDetail.chapters == chapter.chapters, StageDetail.stage_name == stage)
          .order_by((StageDetail.stage_status == "Completed").asc(), StageDetail.id.desc()).first())
    can_manage = access.can_manage_row(db, actor, stage, chapter.project)
    owner = stage_service.resolve_stage_owner_by_designation(db, stage, project_code=chapter.project, client_identifier=chapter.client)
    out.update(can_manage=can_manage, owner_name=_name(owner) if owner else None)
    if not sd:
        return out
    out["item"] = serialize(db, sd)
    out["is_assignee"] = sd.assignee_name == actor.username

    if can_manage:
        st = db.execute(select(StageMaster).where(StageMaster.stage_name == stage)).scalars().first()
        norm = lambda v: "".join((v or "").lower().split())  # noqa: E731 (same rule as ensure_role_allowed)
        roles = {norm(r) for r in access.parse_stage_roles(st.roles)} if st else set()
        users = [u for u in db.query(User).filter(User.active_status == True).all()  # noqa: E712
                 if norm(u.role) == "admin" or not roles or norm(u.role) in roles]
        names = [u.username for u in users]
        open_rows = stage_service.filter_live(db, db.query(StageDetail).filter(
            StageDetail.assignee_name.in_(names or [""]), StageDetail.stage_status != "Completed").all())
        from app.domains.projects.dashboard_service import WorkspaceContext
        ctx = WorkspaceContext(db)
        ctx.preload(open_rows)
        load: dict[str, list[int]] = {}
        for r in open_rows:
            if custody.effective_custody(r) in (custody.IN_PROGRESS, custody.RETURNED):
                acc = load.setdefault(r.assignee_name, [0, 0])
                acc[0] += 1
                acc[1] += ctx.meta(r)["manuscript_pages"]
        people = [{"username": u.username, "display_name": _name(u),
                   "open": load.get(u.username, [0, 0])[0], "pages": load.get(u.username, [0, 0])[1]} for u in users]
        people.sort(key=lambda p: (p["open"], p["pages"], p["display_name"].lower()))
        out["people"] = people
    return out
