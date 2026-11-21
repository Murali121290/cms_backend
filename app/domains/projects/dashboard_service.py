from datetime import datetime, timezone, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.workflow import access, custody, stage_service
from app.domains.workflow.models import ChapterInfo, StageDetail, StageMaster, WorkflowMaster
from app.services import project_service


def get_dashboard_page_data(db: Session, *, skip: int = 0, limit: int = 100):
    projects = project_service.get_projects(db, skip=skip, limit=limit)

    return {
        "projects": projects,
        "dashboard_stats": {
            "total_projects": len(projects),
            "on_time_rate": 94,
            "on_time_trend": "+12%",
            "avg_days": 8.5,
            "avg_days_trend": "-2 days",
            "delayed_count": 0,
            "delayed_trend": "0",
        },
    }


DEFAULT_COMPLETED_DAYS = 30
MAX_COMPLETED_DAYS = 90


class WorkspaceContext:
    """Batched lookups shared by every row the dashboard serialises (replaces per-row/per-member queries)."""

    def __init__(self, db: Session):
        self.db = db
        self.today = stage_service.today_local()
        self.now_utc = datetime.now(timezone.utc)
        self._chapter_meta: dict[tuple[str, str], dict] = {}
        self._next_stage: dict[tuple[str, str], Optional[str]] = {}
        self._loaded_projects: set[str] = set()
        self._loaded_workflows: set[str] = set()
        self._project_client: dict[str, str] = {}      # project code -> client company name
        self._project_pm: dict[str, str] = {}          # project code -> PM username (Project.project_manager)
        self._client_by_code: dict[str, str] = {}      # client division code -> company name
        self._pm_names: dict[str, str] = {}            # username -> first name

    def preload(self, rows: Iterable[StageDetail]) -> None:
        rows = list(rows)
        projects = {r.project for r in rows} - self._loaded_projects
        if projects:
            for ch in self.db.query(ChapterInfo).filter(ChapterInfo.project.in_(projects)).all():
                wc = ch.word_count or 0
                self._chapter_meta[(ch.project, ch.chapters)] = {
                    "manuscript_pages": ch.manuscript_pages or 0,
                    "ce_pages": (wc // 250) + 1 if wc > 0 else 0,
                    "project_manager_name": ch.project_manager_name or "-",
                }
            from app.domains.clients.models import Client
            from app.domains.projects.models import Project
            projs = self.db.query(Project).filter(Project.project_code.in_(projects)).all()
            client_ids = {p.client_id for p in projs if p.client_id}
            companies = {c.id: c.company for c in self.db.query(Client).filter(Client.id.in_(client_ids)).all()} if client_ids else {}
            for p in projs:
                name = companies.get(p.client_id) or p.client_name
                if name:
                    self._project_client[p.project_code] = name
                if p.project_manager:
                    self._project_pm[p.project_code] = p.project_manager
            self._loaded_projects |= projects
        codes = {r.client for r in rows if r.client} - set(self._client_by_code)
        if codes:
            from app.domains.clients.models import Client
            for c in self.db.query(Client).filter(Client.division.in_(codes)).all():
                self._client_by_code[c.division] = c.company
            for code in codes:
                self._client_by_code.setdefault(code, "")
        pms = {self._pm_username(r) for r in rows} - set(self._pm_names) - {None}
        if pms:
            for u in self.db.query(User).filter(User.username.in_(pms)).all():
                self._pm_names[u.username] = (u.first_name or "").strip() or u.username
        workflows = {r.workflow for r in rows if r.workflow} - self._loaded_workflows
        if workflows:
            for wf in self.db.query(WorkflowMaster).filter(WorkflowMaster.workflow_name.in_(workflows)).all():
                self._next_stage[(wf.workflow_name, wf.stage_name)] = wf.next_stage
            self._loaded_workflows |= workflows

    def _pm_username(self, sd: StageDetail) -> Optional[str]:
        meta_pm = self.meta(sd)["project_manager_name"]
        return sd.project_manager_name or (meta_pm if meta_pm and meta_pm != "-" else None) or self._project_pm.get(sd.project)

    def client_name(self, sd: StageDetail) -> str:
        return self._project_client.get(sd.project) or self._client_by_code.get(sd.client or "") or sd.client

    def pm_display(self, sd: StageDetail) -> Optional[str]:
        u = self._pm_username(sd)
        return self._pm_names.get(u, u) if u else None

    def meta(self, sd: StageDetail) -> dict:
        return self._chapter_meta.get((sd.project, sd.chapters), {"manuscript_pages": 0, "ce_pages": 0, "project_manager_name": "-"})

    def item(self, sd: StageDetail) -> dict:
        meta = self.meta(sd)
        delayed = bool(sd.delayed) if sd.stage_status == "Completed" else stage_service.is_past_due(sd, self.today)
        delay_days = 0
        if delayed:
            if sd.stage_status == "Completed":
                delay_days = sd.delay_days or 0
            else:
                delay_days = (self.today - stage_service.local_date(sd.planned_end_date)).days
        return {
            "id": sd.id,
            "client": sd.client,
            "project": sd.project,
            "chapters": sd.chapters,
            "stage_name": sd.stage_name,
            "planned_start_date": sd.planned_start_date,
            "planned_end_date": sd.planned_end_date,
            "actual_start_date": sd.actual_start_date,
            "actual_end_date": sd.actual_end_date,
            "stage_status": sd.stage_status,
            "delayed": delayed,
            "delay_days": delay_days,
            "remarks": sd.remarks,
            "manuscript_pages": meta["manuscript_pages"],
            "ce_pages": meta["ce_pages"],
            "project_manager_name": sd.project_manager_name or meta["project_manager_name"],
            "chapter_label": stage_service.chapter_label(sd.chapters),
            "client_name": self.client_name(sd),
            "project_manager_display": self.pm_display(sd),
            "assignee_name": sd.assignee_name,
            "workflow": sd.workflow,
            "next_stage": self._next_stage.get((sd.workflow, sd.stage_name)),
            "custody_status": custody.effective_custody(sd),
            "priority": sd.priority or "Normal",
            "assigned_by": sd.assigned_by,
            "assignment_notes": sd.assignment_notes,
            "handback_notes": sd.handback_notes,
            "handback_at": sd.handback_at,
            "qa_approved_by": sd.qa_approved_by,
            "qa_approved_at": sd.qa_approved_at,
            "rework_notes": sd.rework_notes,
            "rework_count": sd.rework_count or 0,
            "completion_delay_days": stage_service.completion_delay_days(sd),
        }

    def stats(self, details: list[StageDetail]) -> dict:
        yesterday = self.today - timedelta(days=1)
        today_cnt = yesterday_cnt = delayed_cnt = completed_cnt = kra_met = total_valid = 0
        for sd in details:
            start = stage_service.local_date(sd.actual_start_date)
            if start == self.today:
                today_cnt += 1
            elif start == yesterday:
                yesterday_cnt += 1
            is_comp = sd.stage_status == "Completed"
            if is_comp:
                completed_cnt += 1
            if (sd.delayed and is_comp) or stage_service.is_past_due(sd, self.today):
                delayed_cnt += 1
            # KRA formula is unchanged here on purpose; it is replaced by role-based KRA in Phase 6.
            planned = stage_service.as_utc(sd.planned_end_date)
            if planned:
                total_valid += 1
                if is_comp:
                    end = stage_service.as_utc(sd.actual_end_date) or stage_service.as_utc(sd.updated_at)
                    if end and end <= planned:
                        kra_met += 1
                elif planned >= self.now_utc:
                    kra_met += 1
        return {
            "today_assigned": today_cnt,
            "yesterday_assigned": yesterday_cnt,
            "delayed_count": delayed_cnt,
            "completed_count": completed_cnt,
            "kra_meet_rate": round((kra_met / total_valid) * 100.0 if total_valid else 100.0, 1),
        }


def _display_name(u: Optional[User]) -> str:
    if not u:
        return "Unassigned"
    full = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return full or u.username


def _window_filter(cutoff: datetime):
    """Open rows, plus rows completed inside the window. Keeps payloads bounded as history grows."""
    return or_(
        StageDetail.stage_status != "Completed",
        StageDetail.actual_end_date >= cutoff,
        and_(StageDetail.actual_end_date.is_(None), StageDetail.updated_at >= cutoff),
    )


def _rows(db: Session, cutoff: datetime, *conditions) -> list[StageDetail]:
    return db.query(StageDetail).filter(_window_filter(cutoff), *conditions).order_by(StageDetail.id).all()


def _is_open_work(sd: StageDetail) -> bool:
    return custody.effective_custody(sd) in (custody.IN_PROGRESS, custody.RETURNED)


def _member_payload(ctx: WorkspaceContext, member: User, rows: list[StageDetail]) -> dict:
    open_rows = [r for r in rows if _is_open_work(r)]
    return {
        "username": member.username,
        "role": member.role or member.designation,
        "email": member.email,
        "display_name": _display_name(member),
        "open_count": len(open_rows),
        "open_pages": sum(ctx.meta(r)["manuscript_pages"] for r in open_rows),
        "stats": ctx.stats(rows),
        "assignments": [ctx.item(r) for r in rows],
    }


def _unassigned_payload(ctx: WorkspaceContext, rows: list[StageDetail]) -> dict:
    return {
        "username": "Unassigned",
        "role": "None",
        "email": None,
        "display_name": "Unassigned",
        "stats": ctx.stats(rows),
        "assignments": [ctx.item(r) for r in rows],
    }


def _stage_infos(db: Session, stages: list[StageMaster], stage_names: set[str], manage_scope) -> list[dict]:
    from collections import Counter
    nexts: dict[str, Counter] = {}
    prevs: dict[str, Counter] = {}
    if stage_names:
        for wf in db.query(WorkflowMaster).filter(WorkflowMaster.stage_name.in_(stage_names)).all():
            if wf.next_stage:
                nexts.setdefault(wf.stage_name, Counter())[wf.next_stage] += 1
            if wf.previous_stage:
                prevs.setdefault(wf.stage_name, Counter())[wf.previous_stage] += 1
    out = []
    owner_cache: dict[str, Optional[User]] = {}
    for st in sorted((s for s in stages if s.stage_name in stage_names), key=lambda s: s.id or 0):
        owner = owner_cache.setdefault(st.stage_name, stage_service.resolve_stage_owner_by_designation(db, st.stage_name))
        out.append({
            "stage_name": st.stage_name,
            "owner_username": owner.username if owner else None,
            "owner_name": _display_name(owner) if owner else None,
            "group_email": st.group_email,
            "sla_days": st.sla_level1,
            "can_manage": manage_scope.covers(st.stage_name),
            "next_stage": nexts[st.stage_name].most_common(1)[0][0] if st.stage_name in nexts else None,
            "previous_stage": prevs[st.stage_name].most_common(1)[0][0] if st.stage_name in prevs else None,
        })
    return out


def _workflows(db: Session, stage_names: set[str]) -> list[dict]:
    """Each process (workflow) with its stages in flow order, following previous/next links."""
    rows = (db.query(WorkflowMaster).filter(WorkflowMaster.active_status == True)  # noqa: E712
            .order_by(WorkflowMaster.workflow_name, WorkflowMaster.id).all())
    by_wf: dict[str, list[WorkflowMaster]] = {}
    for r in rows:
        by_wf.setdefault(r.workflow_name, []).append(r)
    out = []
    for name, wf_rows in by_wf.items():
        by_stage = {r.stage_name: r for r in wf_rows}
        starts = [r for r in wf_rows if not r.previous_stage or r.previous_stage not in by_stage] or wf_rows[:1]
        order: list[str] = []
        seen: set[str] = set()
        for start in starts:
            cur = start
            while cur and cur.stage_name not in seen:
                seen.add(cur.stage_name)
                order.append(cur.stage_name)
                cur = by_stage.get(cur.next_stage) if cur.next_stage else None
        order += [r.stage_name for r in wf_rows if r.stage_name not in seen]
        order = [st for st in order if st in stage_names]
        if order:
            out.append({"workflow_name": name, "stages": order})
    return out


def _pipeline(db: Session, ctx: WorkspaceContext, viewer: User, stages: list[StageMaster], scope, cutoff: datetime,
              completed_days: int, extra_people: Iterable[User] = ()) -> dict:
    stage_names = {s.stage_name for s in stages} if scope.all_stages else set(scope.stage_names)
    rows = _rows(db, cutoff, StageDetail.stage_name.in_(stage_names)) if stage_names else []
    ctx.preload(rows)
    manage = access.managed_scope(db, viewer, stages)

    roles_by_stage = {s.stage_name: {r.lower() for r in access.parse_stage_roles(s.roles)} for s in stages if s.stage_name in stage_names}
    wanted_roles = set().union(*roles_by_stage.values()) if roles_by_stage else set()
    holders = {r.assignee_name for r in rows if r.assignee_name}
    candidates = {u.username: u for u in extra_people}
    q = db.query(User).filter(or_(User.username.in_(holders or {""}), User.active_status == True))  # noqa: E712
    for u in q.all():
        role = (u.role or u.designation or "").strip().lower()
        if u.username in holders or (role and role in wanted_roles):
            candidates.setdefault(u.username, u)

    people = []
    for u in candidates.values():
        role = (u.role or u.designation or "").strip().lower()
        mine = [r for r in rows if r.assignee_name == u.username]
        open_rows = [r for r in mine if _is_open_work(r)]
        people.append({
            "username": u.username,
            "display_name": _display_name(u),
            "role": u.role or u.designation,
            "stage_names": sorted(n for n, roles in roles_by_stage.items() if role in roles),
            "open_count": len(open_rows),
            "open_pages": sum(ctx.meta(r)["manuscript_pages"] for r in open_rows),
            "completed_count": sum(1 for r in mine if r.stage_status == "Completed"),
        })
    people.sort(key=lambda p: p["display_name"].lower())
    return {
        "stages": _stage_infos(db, stages, stage_names, manage),
        "items": [ctx.item(r) for r in rows],
        "people": people,
        "completed_window_days": completed_days,
        "workflows": _workflows(db, stage_names),
    }


def get_workspace_dashboard_data(db: Session, user: User, completed_days: int = DEFAULT_COMPLETED_DAYS):
    completed_days = max(1, min(int(completed_days or DEFAULT_COMPLETED_DAYS), MAX_COMPLETED_DAYS))
    ctx = WorkspaceContext(db)
    cutoff = ctx.now_utc - timedelta(days=completed_days)
    role_type = access.dashboard_role_type(user)
    stages = access.active_stages(db)
    # A stage owner (Stage Master "Owner stage" = one of their roles) gets the owner board for every stage
    # they own, even when their role name isn't one of the fixed manager / team-lead roles.
    owned = access.owned_scope(db, user, stages) if role_type == "user" else None
    if owned and owned.stage_names:
        role_type = "teamlead"

    response = {
        "role": role_type,  # "teamlead" also covers stage owners promoted above
        "viewer": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "roles": [r.name for r in user.roles],
            "role": user.role,
            "team": user.team,
            "designation": user.designation,
            "is_active": user.is_active,
        },
        "user_workspace": None,
        "teamlead_workspace": None,
        "manager_workspace": None,
        "pipeline": None,
        "generated_at": ctx.now_utc,
    }

    if role_type == "user":
        sds = _rows(db, cutoff, StageDetail.assignee_name == user.username)
        ctx.preload(sds)
        response["user_workspace"] = {"stats": ctx.stats(sds), "assignments": [ctx.item(sd) for sd in sds]}
        # Employees who are configured stage owners still get the board for the stages they own.
        own_scope = access.managed_scope(db, user, stages)
        if own_scope.stage_names:
            response["pipeline"] = _pipeline(db, ctx, user, stages, own_scope, cutoff, completed_days)
        return response

    if role_type == "teamlead":
        if owned and owned.stage_names:
            scope = owned
            # The people who work an owned stage can sit in any team: pick them by stage role.
            team = [u for u in db.query(User).filter(User.active_status == True).all()  # noqa: E712
                    if u.username != user.username and access._norm(u.role or u.designation) in scope.member_role_names]
        else:
            scope = access.teamlead_scope(db, user, stages)
            team = db.query(User).filter(User.team == user.team).all()
        if scope.stage_names:
            members = [m for m in team if (m.role or m.designation) and (m.role or m.designation).strip().lower() in scope.member_role_names]
        else:
            members = team
        member_names = [m.username for m in members]
        conds = [StageDetail.assignee_name.in_(member_names or [""])]
        if scope.stage_names:
            conds.append(StageDetail.stage_name.in_(scope.stage_names))
        member_rows = _rows(db, cutoff, *conds)
        unassigned = _rows(db, cutoff, or_(StageDetail.assignee_name.is_(None), StageDetail.assignee_name == ""),
                           StageDetail.stage_name.in_(scope.stage_names)) if scope.stage_names else []
        ctx.preload(member_rows + unassigned)
        by_member: dict[str, list[StageDetail]] = {}
        for r in member_rows:
            by_member.setdefault(r.assignee_name, []).append(r)
        member_datas = [_member_payload(ctx, m, by_member.get(m.username, [])) for m in members]
        if unassigned:
            member_datas.append(_unassigned_payload(ctx, unassigned))
        response["teamlead_workspace"] = {"stats": ctx.stats(member_rows + unassigned), "members": member_datas}
        response["pipeline"] = _pipeline(db, ctx, user, stages, scope, cutoff, completed_days, extra_people=members)
        return response

    # manager
    is_editorial = not access.is_admin(user) and ("editorial manager" in access.primary_role(user) or user.team == "Editorial Team")
    users_in_scope = db.query(User).filter(User.team == "Editorial Team").all() if is_editorial else db.query(User).all()
    usernames = [u.username for u in users_in_scope]
    sds = _rows(db, cutoff, StageDetail.assignee_name.in_(usernames or [""]))
    scope_roles = {(u.role or u.designation) for u in users_in_scope if u.role or u.designation}
    manager_stages = {s.stage_name for s in stages if any(r in scope_roles for r in access.parse_stage_roles(s.roles))}
    unassigned = _rows(db, cutoff, or_(StageDetail.assignee_name.is_(None), StageDetail.assignee_name == ""),
                       StageDetail.stage_name.in_(manager_stages)) if manager_stages else []
    ctx.preload(sds + unassigned)

    all_rows = list(sds) + list(unassigned)
    by_stage: dict[str, list[StageDetail]] = {}
    for r in all_rows:
        by_stage.setdefault(r.stage_name, []).append(r)
    stage_metrics = []
    yesterday = ctx.today - timedelta(days=1)
    for st in stages:
        rows = by_stage.get(st.stage_name)
        if not rows:
            continue
        stats = ctx.stats(rows)
        stage_metrics.append({
            "stage_name": st.stage_name,
            "active_count": sum(1 for r in rows if r.stage_status != "Completed"),
            "delayed_count": stats["delayed_count"],
            "today_assigned": sum(1 for r in rows if stage_service.local_date(r.actual_start_date) == ctx.today),
            "yesterday_assigned": sum(1 for r in rows if stage_service.local_date(r.actual_start_date) == yesterday),
            "kra_meet_rate": stats["kra_meet_rate"],
        })

    by_member: dict[str, list[StageDetail]] = {}
    for r in sds:
        by_member.setdefault(r.assignee_name, []).append(r)
    member_datas = [_member_payload(ctx, m, by_member.get(m.username, [])) for m in users_in_scope]
    if unassigned:
        member_datas.append(_unassigned_payload(ctx, unassigned))
    response["manager_workspace"] = {"stats": ctx.stats(all_rows), "stages": stage_metrics, "members": member_datas}
    response["pipeline"] = _pipeline(db, ctx, user, stages, access.managed_scope(db, user, stages), cutoff, completed_days)
    return response
