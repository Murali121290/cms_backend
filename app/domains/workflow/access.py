"""Who may act on which workflow stage.

Single source of truth for workspace scoping, used by the dashboard (what you see) and by the stage
mutations (what you may change). Before this module existed the scoping logic was copy-pasted three
times inside dashboard_service and the mutations in api_v1 had no checks at all.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable, Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.auth.rbac_config import get_user_access_level
from app.domains.auth.security import get_current_user_from_cookie
from app.domains.workflow.models import StageMaster

# Roles the dashboard treats as managers / team leads (kept from the original dashboard_service).
MANAGER_ROLES = {"admin", "editorial manager", "project manager", "senior project manager", "asst general manager"}
TEAMLEAD_ROLES = {"team lead - editorial", "team lead - prediting", "team lead - language editing"}


def parse_stage_roles(raw) -> list[str]:
    """StageMaster.roles is an ARRAY on Postgres but arrives as JSON text / char lists on SQLite."""
    roles = raw or []
    if isinstance(roles, list) and len(roles) >= 2 and roles[0] == "[" and roles[-1] == "]":
        try:
            roles = json.loads("".join(roles))
        except Exception:
            pass
    elif isinstance(roles, str):
        try:
            roles = json.loads(roles)
        except Exception:
            roles = [roles]
    if not isinstance(roles, list):
        roles = [roles]
    return [str(r).strip() for r in roles if r and str(r).strip()]


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def primary_role(user: User) -> str:
    return _norm(user.role or user.designation)


def user_role_names(user: User) -> set[str]:
    names = {_norm(user.role), _norm(user.designation)}
    extra = getattr(user, "additional_roles", None)
    if isinstance(extra, list):
        names.update(_norm(r) for r in extra if isinstance(r, str))
    names.discard("")
    return names


def dashboard_role_type(user: User) -> str:
    role = primary_role(user)
    # Admins always get the all-stages overview, whatever their role/designation text says.
    if role in MANAGER_ROLES or get_user_access_level(user) == "Admin":
        return "manager"
    if role in TEAMLEAD_ROLES:
        return "teamlead"
    return "user"


def is_admin(user: Optional[User]) -> bool:
    return bool(user) and get_user_access_level(user) == "Admin"


def is_manager_level(user: Optional[User]) -> bool:
    return bool(user) and get_user_access_level(user) in ("Admin", "Manager")


@dataclass
class StageScope:
    """Stages a viewer oversees and the people working in them."""
    stage_names: set[str] = field(default_factory=set)
    member_role_names: set[str] = field(default_factory=set)
    all_stages: bool = False

    def covers(self, stage_name: str) -> bool:
        return self.all_stages or stage_name in self.stage_names


def active_stages(db: Session) -> list[StageMaster]:
    return db.query(StageMaster).filter(StageMaster.active_status == True).all()  # noqa: E712


def stage_owner_matches(stage: StageMaster, user: User) -> bool:
    """Stage Master "Owner stage" (owner_designation) vs the user's Role field only (not the HR designation)."""
    owner = _norm(stage.owner_designation).replace("-", " ").replace("_", " ")
    role = _norm(user.role).replace("-", " ").replace("_", " ")
    return bool(owner) and owner == role


def owned_scope(db: Session, user: User, stages: Optional[list[StageMaster]] = None) -> StageScope:
    """Every stage whose Stage Master owner designation is one of the user's roles (an owner may hold several)."""
    stages = stages if stages is not None else active_stages(db)
    scope = StageScope()
    for st in stages:
        if stage_owner_matches(st, user):
            scope.stage_names.add(st.stage_name)
            scope.member_role_names.update(r.lower() for r in parse_stage_roles(st.roles))
    scope.member_role_names.discard(_norm(user.role))
    return scope


def teamlead_scope(db: Session, user: User, stages: Optional[list[StageMaster]] = None) -> StageScope:
    """Same rules the team-lead dashboard has always used:
    1. stages whose StageMaster.roles list the lead's role (+ stages where they are the owner designation);
    2. otherwise, stages whose roles match the roles of people on the lead's team.
    """
    stages = stages if stages is not None else active_stages(db)
    role = primary_role(user)
    scope = StageScope()
    for st in stages:
        roles = parse_stage_roles(st.roles)
        roles_lower = {r.lower() for r in roles}
        if role in roles_lower or stage_owner_matches(st, user):
            scope.stage_names.add(st.stage_name)
            scope.member_role_names.update(roles_lower)
    scope.member_role_names.discard(role)
    if scope.stage_names:
        return scope

    team_roles = {
        _norm(m.role or m.designation)
        for m in db.query(User).filter(User.team == user.team).all()
        if (m.role or m.designation)
    }
    for st in stages:
        roles_lower = {r.lower() for r in parse_stage_roles(st.roles)}
        if roles_lower & team_roles:
            scope.stage_names.add(st.stage_name)
            scope.member_role_names.update(roles_lower)
    scope.member_role_names.discard(role)
    return scope


def manager_scope(db: Session, user: User, stages: Optional[list[StageMaster]] = None) -> StageScope:
    stages = stages if stages is not None else active_stages(db)
    is_editorial = "editorial manager" in primary_role(user) or user.team == "Editorial Team"
    if not is_editorial or is_admin(user):
        return StageScope(stage_names={s.stage_name for s in stages}, all_stages=True)
    team_roles = {
        _norm(m.role or m.designation)
        for m in db.query(User).filter(User.team == "Editorial Team").all()
        if (m.role or m.designation)
    }
    scope = StageScope()
    for st in stages:
        roles_lower = {r.lower() for r in parse_stage_roles(st.roles)}
        if roles_lower & team_roles:
            scope.stage_names.add(st.stage_name)
            scope.member_role_names.update(roles_lower)
    return scope


def managed_scope(db: Session, user: User, stages: Optional[list[StageMaster]] = None) -> StageScope:
    """Stages this user may manage (assign, review, move on). Empty for plain employees."""
    if is_admin(user):
        stages = stages if stages is not None else active_stages(db)
        return StageScope(stage_names={s.stage_name for s in stages}, all_stages=True)
    kind = dashboard_role_type(user)
    level = get_user_access_level(user)
    if kind == "manager" or level == "Manager":
        return manager_scope(db, user, stages)
    if kind == "teamlead" or level == "TeamLead":
        return teamlead_scope(db, user, stages)
    # Employees who are the configured owner of a stage can still manage that stage.
    stages = stages if stages is not None else active_stages(db)
    return StageScope(stage_names={s.stage_name for s in stages if stage_owner_matches(s, user)})


def can_manage_stage(db: Session, user: Optional[User], stage_name: str, scope: Optional[StageScope] = None) -> bool:
    if not user:
        return False
    scope = scope or managed_scope(db, user)
    return scope.covers(stage_name)


# ── chapter visibility ────────────────────────────────────────────────────────
# Who can see a chapter (project page, chapter folder):
#   * view_all_chapters permission (Admin / Manager / TeamLead access level, PM roles) -> every chapter
#   * the stage owner / lead of the stage the chapter is in now                         -> those chapters
#   * everyone else (employees)                                                         -> only chapters assigned to them

def sees_all_chapters(user: Optional[User]) -> bool:
    from app.domains.auth.rbac_config import has_permission
    return bool(user) and has_permission(user, "view_all_chapters")


def can_view_chapter(db: Session, user: Optional[User], chapter) -> bool:
    if not user or chapter is None:
        return False
    if sees_all_chapters(user) or chapter.current_assignee_name == user.username:
        return True
    return bool(chapter.stage_name) and can_manage_stage(db, user, chapter.stage_name)


def _is_admin_role(user: User) -> bool:
    return "".join((user.role or "").lower().split()) == "admin" or is_admin(user)


def can_write_chapter(db: Session, user: Optional[User], chapter) -> bool:
    """Who may change a chapter's files while it sits in a stage: the assignee, the owner/lead of that stage,
    or Admin. Everyone else (PMs included) is read-only. Chapters outside the stage workflow (no stage and no
    assignee: legacy/virtual folders) keep today's behaviour."""
    if not user:
        return False
    if chapter is None:
        return True
    if not chapter.stage_name and not chapter.current_assignee_name:
        return True
    if chapter.current_assignee_name == user.username or _is_admin_role(user):
        return True
    return bool(chapter.stage_name) and leads_stage(db, user, chapter.stage_name)


def leads_stage(db: Session, user: User, stage_name: str) -> bool:
    """Owner (Stage Master owner designation = user's role) or team lead of the stage. Unlike can_manage_stage this
    does NOT include managers/PMs who oversee every stage: they keep workflow rights but files stay read-only."""
    if owned_scope(db, user).covers(stage_name):
        return True
    if dashboard_role_type(user) == "teamlead" or get_user_access_level(user) == "TeamLead":
        return teamlead_scope(db, user).covers(stage_name)
    return False


def write_denied_message(db: Session, chapter) -> str:
    from app.domains.workflow.stage_service import chapter_label
    who = chapter.current_assignee_name
    if who:
        u = db.query(User).filter(User.username == who).first()
        name = (" ".join(p for p in ((u.first_name if u else None), (u.last_name if u else None)) if p)) or who
        held = f"is assigned to {name}" + (f" in {chapter.stage_name}" if chapter.stage_name else "")
    else:
        held = f"isn't assigned to anyone yet in {chapter.stage_name}"
    return (f"{chapter_label(chapter.chapters)} {held}. Only the assignee, the stage owner or Admin can change "
            f"its files; you can still view and download them.")


def ensure_can_write_chapter(db: Session, user: Optional[User], chapter) -> None:
    if not can_write_chapter(db, user, chapter):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "CHAPTER_READ_ONLY", "message": write_denied_message(db, chapter)})


def ensure_can_write_file(db: Session, user: Optional[User], file_record) -> None:
    """For endpoints that change a file: resolve its chapter and apply can_write_chapter."""
    if file_record is None or not getattr(file_record, "chapter_id", None):
        return
    from app.domains.workflow.models import ChapterInfo
    ensure_can_write_chapter(db, user, db.get(ChapterInfo, file_record.chapter_id))


def ensure_can_write_file_id(db: Session, user: Optional[User], file_id: int) -> None:
    from app.models import File
    ensure_can_write_file(db, user, db.get(File, file_id))


def visible_stage_names(db: Session, user: User) -> Optional[set[str]]:
    """Stages whose chapters this user sees as a stage owner/lead; None = all stages."""
    scope = managed_scope(db, user)
    return None if scope.all_stages else set(scope.stage_names)


# ── FastAPI dependencies / guards ─────────────────────────────────────────────

def require_workflow_actor(user: Optional[User] = Depends(get_current_user_from_cookie)) -> User:
    """Any signed-in, active user. Finer checks happen per stage in the service layer."""
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to change workflow data.")
    if getattr(user, "active_status", True) is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is inactive.")
    return user


def require_admin_actor(user: User = Depends(require_workflow_actor)) -> User:
    if not is_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can do this.")
    return user


def ensure_can_manage(db: Session, user: User, stage_names: Iterable[str]) -> None:
    scope = managed_scope(db, user)
    denied = sorted({s for s in stage_names if not scope.covers(s)})
    if denied:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You don't manage the stage{'s' if len(denied) > 1 else ''}: {', '.join(denied)}.",
        )
