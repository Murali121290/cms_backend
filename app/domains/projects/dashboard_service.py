from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.auth.models import User
from app.domains.workflow.models import StageDetail, StageMaster
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


def get_workspace_dashboard_data(db: Session, user: User):
    role_lower = user.role.lower() if user.role else ""
    
    # 1. Determine user classification
    is_manager = role_lower in ["admin", "editorial manager", "project manager", "senior project manager", "asst general manager"]
    is_teamlead = role_lower in ["team lead - editorial", "team lead - prediting", "team lead - language editing"]
    
    if is_manager:
        role_type = "manager"
    elif is_teamlead:
        role_type = "teamlead"
    else:
        role_type = "user"
        
    now_utc = datetime.now(timezone.utc)
    today = now_utc.date()
    yesterday = today - timedelta(days=1)

    # Cache lookup map for chapter details: (project, chapter) -> {manuscript_pages, ce_pages, project_manager_name}
    from app.domains.workflow.models import ChapterInfo
    all_chapters = db.query(ChapterInfo).all()
    chapter_info_map = {}
    for ch in all_chapters:
        wc = ch.word_count or 0
        ce_pages = (wc // 250) + 1 if wc > 0 else 0
        chapter_info_map[(ch.project, ch.chapters)] = {
            "manuscript_pages": ch.manuscript_pages or 0,
            "ce_pages": ce_pages,
            "project_manager_name": ch.project_manager_name or "-"
        }
    
    def get_date(dt):
        if not dt:
            return None
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).date()
        return dt.date()
        
    def get_tz_aware(dt):
        if not dt:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
        
    def build_workspace_item(sd: StageDetail):
        is_comp = sd.stage_status == "Completed"
        planned_tz = get_tz_aware(sd.planned_end_date)
        is_delayed = bool(sd.delayed or (not is_comp and planned_tz and planned_tz < now_utc))
        
        delay_days = 0
        if is_delayed:
            if sd.delay_days:
                delay_days = sd.delay_days
            elif planned_tz:
                delay_days = (now_utc - planned_tz).days
                if delay_days < 0:
                    delay_days = 0
                
        ch_meta = chapter_info_map.get((sd.project, sd.chapters), {
            "manuscript_pages": 0,
            "ce_pages": 0,
            "project_manager_name": "-"
        })

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
            "delayed": is_delayed,
            "delay_days": delay_days,
            "remarks": sd.remarks,
            "manuscript_pages": ch_meta["manuscript_pages"],
            "ce_pages": ch_meta["ce_pages"],
            "project_manager_name": ch_meta["project_manager_name"]
        }
        
    def calculate_stats(details: list[StageDetail]):
        today_cnt = 0
        yesterday_cnt = 0
        delayed_cnt = 0
        completed_cnt = 0
        kra_met_cnt = 0
        total_valid = 0
        
        for sd in details:
            start_date = get_date(sd.actual_start_date)
            if start_date == today:
                today_cnt += 1
            elif start_date == yesterday:
                yesterday_cnt += 1
                
            is_comp = sd.stage_status == "Completed"
            if is_comp:
                completed_cnt += 1
                
            planned_tz = get_tz_aware(sd.planned_end_date)
            is_delayed = bool(sd.delayed or (not is_comp and planned_tz and planned_tz < now_utc))
            if is_delayed:
                delayed_cnt += 1
                
            if planned_tz:
                total_valid += 1
                if is_comp:
                    end_tz = get_tz_aware(sd.actual_end_date) or get_tz_aware(sd.updated_at)
                    if end_tz and end_tz <= planned_tz:
                        kra_met_cnt += 1
                else:
                    if planned_tz >= now_utc:
                        kra_met_cnt += 1
                        
        kra_rate = (kra_met_cnt / total_valid) * 100.0 if total_valid > 0 else 100.0
        return {
            "today_assigned": today_cnt,
            "yesterday_assigned": yesterday_cnt,
            "delayed_count": delayed_cnt,
            "completed_count": completed_cnt,
            "kra_meet_rate": round(kra_rate, 1)
        }

    # Initialize responses
    response = {
        "role": role_type,
        "viewer": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "roles": [r.name for r in user.roles],
            "is_active": user.is_active,
        },
        "user_workspace": None,
        "teamlead_workspace": None,
        "manager_workspace": None
    }
    
    if role_type == "user":
        # Personal workspace
        q = db.query(StageDetail).filter(StageDetail.assignee_name == user.username)
        sds = q.all()
        response["user_workspace"] = {
            "stats": calculate_stats(sds),
            "assignments": [build_workspace_item(sd) for sd in sds]
        }
        
    elif role_type == "teamlead":
        # Team Lead workspace
        # 1. Determine stages dynamically associated with this Team Lead's role
        user_role_lower = (user.role or "").lower().strip()
        team_stages = set()
        allowed_member_roles = set()
        
        stages_in_db = db.query(StageMaster).filter(StageMaster.active_status == True).all()
        for stage in stages_in_db:
            stage_roles = stage.roles or []
            if isinstance(stage_roles, list) and len(stage_roles) >= 2 and stage_roles[0] == '[' and stage_roles[-1] == ']':
                import json
                try:
                    stage_roles = json.loads("".join(stage_roles))
                except Exception:
                    pass
            elif isinstance(stage_roles, str):
                import json
                try:
                    stage_roles = json.loads(stage_roles)
                except Exception:
                    stage_roles = [stage_roles]
                    
            stage_roles_lower = [r.lower().strip() for r in stage_roles if r]
            if user_role_lower in stage_roles_lower:
                team_stages.add(stage.stage_name)
                for r in stage_roles:
                    if r:
                        allowed_member_roles.add(r.lower().strip())
                        
        # Exclude the team lead's own role from member mapping
        allowed_member_roles.discard(user_role_lower)
        
        # 2. Query and filter team members
        if team_stages:
            all_members_in_team = db.query(User).filter(User.team == user.team).all()
            team_members = [
                m for m in all_members_in_team 
                if m.role and m.role.lower().strip() in allowed_member_roles
            ]
        else:
            # Fallback to default if role is not configured in any stage
            team_members = db.query(User).filter(User.team == user.team).all()
            member_roles = {m.role for m in team_members if m.role}
            for stage in stages_in_db:
                stage_roles = stage.roles or []
                if isinstance(stage_roles, list) and len(stage_roles) >= 2 and stage_roles[0] == '[' and stage_roles[-1] == ']':
                    import json
                    try:
                        stage_roles = json.loads("".join(stage_roles))
                    except Exception:
                        pass
                elif isinstance(stage_roles, str):
                    import json
                    try:
                        stage_roles = json.loads(stage_roles)
                    except Exception:
                        stage_roles = [stage_roles]
                if any(r in member_roles for r in stage_roles):
                    team_stages.add(stage.stage_name)

        # 3. Retrieve members' details and filter their assignments strictly to team_stages
        member_datas = []
        all_team_details = []
        
        for member in team_members:
            m_sds_q = db.query(StageDetail).filter(StageDetail.assignee_name == member.username)
            if team_stages:
                m_sds_q = m_sds_q.filter(StageDetail.stage_name.in_(list(team_stages)))
            m_sds = m_sds_q.all()
            all_team_details.extend(m_sds)
            
            member_datas.append({
                "username": member.username,
                "role": member.role,
                "email": member.email,
                "stats": calculate_stats(m_sds),
                "assignments": [build_workspace_item(sd) for sd in m_sds]
            })
                
        unassigned_sds = []
        if team_stages:
            unassigned_sds = db.query(StageDetail).filter(
                (StageDetail.assignee_name == None) | (StageDetail.assignee_name == ""),
                StageDetail.stage_name.in_(list(team_stages))
            ).all()
            
        if unassigned_sds:
            all_team_details.extend(unassigned_sds)
            member_datas.append({
                "username": "Unassigned",
                "role": "None",
                "email": None,
                "stats": calculate_stats(unassigned_sds),
                "assignments": [build_workspace_item(sd) for sd in unassigned_sds]
            })
            
        response["teamlead_workspace"] = {
            "stats": calculate_stats(all_team_details),
            "members": member_datas
        }
        
    elif role_type == "manager":
        # Manager Workspace
        # Determine jurisdiction scope
        is_editorial_mgr = "editorial manager" in role_lower or user.team == "Editorial Team"
        
        if is_editorial_mgr:
            # Query Editorial team members and matching stages
            users_in_scope = db.query(User).filter(User.team == "Editorial Team").all()
        else:
            # Query all users
            users_in_scope = db.query(User).all()
            
        usernames = [u.username for u in users_in_scope]
        
        # Get active/historical stage assignments for those users
        sds = db.query(StageDetail).filter(StageDetail.assignee_name.in_(usernames)).all()
        
        # Get unassigned chapters matching the users' roles
        scope_roles = {u.role for u in users_in_scope if u.role}
        manager_stages = set()
        for stage in db.query(StageMaster).filter(StageMaster.active_status == True).all():
            stage_roles = stage.roles or []
            if isinstance(stage_roles, list) and len(stage_roles) >= 2 and stage_roles[0] == '[' and stage_roles[-1] == ']':
                import json
                try:
                    stage_roles = json.loads("".join(stage_roles))
                except Exception:
                    pass
            elif isinstance(stage_roles, str):
                import json
                try:
                    stage_roles = json.loads(stage_roles)
                except Exception:
                    stage_roles = [stage_roles]
            if any(r in scope_roles for r in stage_roles):
                manager_stages.add(stage.stage_name)
                
        unassigned_sds = []
        if manager_stages:
            unassigned_sds = db.query(StageDetail).filter(
                (StageDetail.assignee_name == None) | (StageDetail.assignee_name == ""),
                StageDetail.stage_name.in_(list(manager_stages))
            ).all()
            
        # Calculate stats for stage metrics (dynamic aggregation)
        stages_in_db = db.query(StageMaster).filter(StageMaster.active_status == True).all()
        stage_metrics = []
        all_sds_for_stats = list(sds) + list(unassigned_sds)
        
        for stage in stages_in_db:
            stage_sds = [sd for sd in all_sds_for_stats if sd.stage_name == stage.stage_name]
            if stage_sds:
                stage_metrics.append({
                    "stage_name": stage.stage_name,
                    "active_count": sum(1 for sd in stage_sds if sd.stage_status != "Completed"),
                    "delayed_count": sum(1 for sd in stage_sds if bool(sd.delayed or (sd.stage_status != "Completed" and get_tz_aware(sd.planned_end_date) and get_tz_aware(sd.planned_end_date) < now_utc))),
                    "today_assigned": sum(1 for sd in stage_sds if get_date(sd.actual_start_date) == today),
                    "yesterday_assigned": sum(1 for sd in stage_sds if get_date(sd.actual_start_date) == yesterday),
                    "kra_meet_rate": calculate_stats(stage_sds)["kra_meet_rate"]
                })
        
        # Calculate individual member stats
        member_datas = []
        for member in users_in_scope:
            m_sds = [sd for sd in sds if sd.assignee_name == member.username]
            member_datas.append({
                "username": member.username,
                "role": member.role,
                "email": member.email,
                "stats": calculate_stats(m_sds),
                "assignments": [build_workspace_item(sd) for sd in m_sds]
            })
            
        if unassigned_sds:
            member_datas.append({
                "username": "Unassigned",
                "role": "None",
                "email": None,
                "stats": calculate_stats(unassigned_sds),
                "assignments": [build_workspace_item(sd) for sd in unassigned_sds]
            })
            
        response["manager_workspace"] = {
            "stats": calculate_stats(all_sds_for_stats),
            "stages": stage_metrics,
            "members": member_datas
        }
        
    return response
