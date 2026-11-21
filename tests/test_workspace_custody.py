"""Stage custody lifecycle (/api/v2/workspace), legacy v1 auth, dashboard pipeline and schedule."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app import models
from app.domains.workflow.models import ChapterInfo, StageDetail, WorkflowMaster


# ── fixtures ──────────────────────────────────────────────────────────────────

def _stage(db, name, roles, owner=None, group_email=None, sla=3):
    db.execute(
        text("INSERT INTO stage_master (stage_name, description, roles, owner_designation, group_email, sla_level1, active_status) "
             "VALUES (:n, :n, :r, :o, :g, :s, 1)"),
        {"n": name, "r": roles, "o": owner, "g": group_email, "s": sla},
    )


def _user(db, username, role, team="Editorial Team", **kw):
    u = models.User(username=username, email=f"{username}@example.com", password_hash="x", role=role, team=team, **kw)
    db.add(u)
    return u


@pytest.fixture()
def world(db_session):
    db = db_session
    _stage(db, "Copyediting", '["Team Lead - Language Editing", "Copyeditor"]', owner="Team Lead - Language Editing",
           group_email="ce-leads@example.com")
    _stage(db, "Typesetting", '["Typesetter", "Team Lead - Production"]', owner="Team Lead - Production",
           group_email="ts-team@example.com")
    _stage(db, "Quality Control", '["QC Analyst"]')
    db.commit()
    for i, (stage, nxt) in enumerate([("Copyediting", "Typesetting"), ("Typesetting", "Quality Control"), ("Quality Control", None)]):
        db.add(WorkflowMaster(workflow_name="WF", stage_name=stage, next_stage=nxt))
    people = {
        "lead": _user(db, "ce_lead", "Team Lead - Language Editing"),
        "emp": _user(db, "ce_priya", "Copyeditor"),
        "emp2": _user(db, "ce_david", "Copyeditor"),
        "ts_lead": _user(db, "ts_lead", "Team Lead - Production", team="Production Team"),
        "pm": _user(db, "pm_marcus", "Project Manager", team="PM Team"),
        "admin": _user(db, "boss", "Admin", access_level="Admin"),
        "inactive": _user(db, "gone", "Copyeditor", active_status=False),
    }
    db.add(ChapterInfo(client="CUP", project="P1", chapters="Ch01", workflow="WF", stage_name="Copyediting",
                       status="In-progress", manuscript_pages=30, project_manager_name="pm_marcus"))
    db.commit()
    now = datetime.now(timezone.utc)
    task = StageDetail(client="CUP", project="P1", chapters="Ch01", stage_name="Copyediting", workflow="WF",
                       project_manager_name="pm_marcus", planned_start_date=now - timedelta(days=4),
                       planned_end_date=now - timedelta(days=2), stage_status="In-progress", custody_status="unassigned")
    ts = StageDetail(client="CUP", project="P1", chapters="Ch01", stage_name="Typesetting", workflow="WF",
                     planned_start_date=now + timedelta(days=1), planned_end_date=now + timedelta(days=4), stage_status="In-progress")
    db.add_all([task, ts])
    db.commit()
    return {"db": db, "task": task, "ts": ts, **people}


@pytest.fixture()
def as_user(auth_cookie_client):
    return lambda u: auth_cookie_client(u)


@pytest.fixture()
def mails(monkeypatch):
    sent = []
    from app.domains.notifications import email_service
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw))
    return sent


# ── custody lifecycle ─────────────────────────────────────────────────────────

def test_full_lifecycle_assign_handback_approve_move(world, as_user, mails):
    t = world["task"].id
    lead, emp = as_user(world["lead"]), as_user(world["emp"])

    r = lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya", "priority": "High",
                                                              "notes": "Follow APA 7", "expected_custody_status": "unassigned"})
    assert r.status_code == 200, r.text
    assert r.json()["custody_status"] == "in_progress"
    assert r.json()["assignee_name"] == "ce_priya" and r.json()["priority"] == "High"
    assert any("assigned to you" in m["subject"] for m in mails)

    r = emp.post(f"/api/v2/workspace/tasks/{t}/handback", json={"notes": "Done, 2 author queries added.",
                                                               "checklist_confirmed": True, "expected_custody_status": "in_progress"})
    assert r.status_code == 200, r.text
    assert r.json()["custody_status"] == "returned_for_review"
    assert r.json()["handback_notes"].startswith("Done")

    r = lead.post(f"/api/v2/workspace/tasks/{t}/review", json={"decision": "approve", "expected_custody_status": "returned_for_review"})
    assert r.status_code == 200 and r.json()["custody_status"] == "qa_approved"

    p = lead.get(f"/api/v2/workspace/tasks/{t}/move-next/preview").json()
    assert p["next_stage"] == "Typesetting"
    assert p["next_owner_username"] == "ts_lead"
    to = {x["email"] for x in p["to"]}
    cc = {x["email"] for x in p["cc"]}
    assert {"ts_lead@example.com", "ts-team@example.com"} <= to
    assert "pm_marcus@example.com" in cc
    assert p["late_days"] >= 2

    mails.clear()
    r = lead.post(f"/api/v2/workspace/tasks/{t}/move-next", json={"expected_custody_status": "qa_approved"})
    assert r.status_code == 200, r.text
    assert r.json()["custody_status"] == "transitioned" and r.json()["stage_status"] == "Completed"
    assert r.json()["completion_delay_days"] >= 2
    assert len(mails) == 1 and "ts_lead@example.com" in mails[0]["to_email"]

    db = world["db"]
    db.expire_all()
    ts = db.get(StageDetail, world["ts"].id)
    assert ts.custody_status == "unassigned"          # arrives in the next owner's Inbound
    assert ts.assignee_name == "ts_lead"              # legacy: owner holds it
    assert ts.planned_end_date.date() >= (datetime.now(timezone.utc) + timedelta(days=5)).date()  # cascade shift (+2)
    assert db.query(ChapterInfo).filter_by(project="P1", chapters="Ch01").one().stage_name == "Typesetting"

    acts = lead.get(f"/api/v2/workspace/tasks/{t}/activity").json()["events"]
    actions = [e["action"] for e in acts]
    for a in ("assign", "handback", "approve", "move_next"):
        assert a in actions


def test_rework_loop_requires_notes_and_counts(world, as_user):
    t = world["task"].id
    lead, emp = as_user(world["lead"]), as_user(world["emp"])
    lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya", "notify": False})
    emp.post(f"/api/v2/workspace/tasks/{t}/handback", json={"notes": "first pass done", "checklist_confirmed": True})

    assert lead.post(f"/api/v2/workspace/tasks/{t}/review", json={"decision": "rework"}).status_code == 422
    r = lead.post(f"/api/v2/workspace/tasks/{t}/review", json={"decision": "rework", "notes": "Fix the reference style"})
    assert r.status_code == 200
    assert r.json()["custody_status"] == "in_progress" and r.json()["rework_count"] == 1
    assert r.json()["rework_notes"] == "Fix the reference style"


def test_illegal_moves_and_stale_state_return_409(world, as_user):
    t = world["task"].id
    lead, emp = as_user(world["lead"]), as_user(world["emp"])
    r = lead.post(f"/api/v2/workspace/tasks/{t}/move-next", json={})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CUSTODY_CONFLICT"

    lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya", "notify": False})
    # The screen still thinks it is unassigned -> conflict, and the current row is returned.
    r = lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_david", "expected_custody_status": "unassigned"})
    assert r.status_code == 409
    assert r.json()["detail"]["current"]["assignee_name"] == "ce_priya"

    assert emp.post(f"/api/v2/workspace/tasks/{t}/handback", json={"notes": "done!", "checklist_confirmed": False}).status_code == 422


def test_permissions(world, as_user):
    t = world["task"].id
    emp, emp2, ts_lead = as_user(world["emp"]), as_user(world["emp2"]), as_user(world["ts_lead"])
    assert emp.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya"}).status_code == 403
    assert ts_lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya"}).status_code == 403
    as_user(world["lead"]).post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya", "notify": False})
    assert emp2.post(f"/api/v2/workspace/tasks/{t}/handback", json={"notes": "not mine", "checklist_confirmed": True}).status_code == 403
    assert emp2.get(f"/api/v2/workspace/tasks/{t}/activity").status_code == 403
    assert as_user(world["admin"]).post(f"/api/v2/workspace/tasks/{t}/review", json={"decision": "approve"}).status_code == 409


def test_assign_due_date_without_timezone_is_app_local_end_of_day(world, as_user):
    from app.domains.workflow import stage_service
    r = as_user(world["lead"]).post(f"/api/v2/workspace/tasks/{world['task'].id}/assign",
                                    json={"assignee": "ce_priya", "planned_end_date": "2026-12-05T23:59:59", "notify": False})
    assert r.status_code == 200, r.text
    world["db"].expire_all()
    sd = world["db"].get(StageDetail, world["task"].id)
    assert stage_service.local_date(sd.planned_end_date).isoformat() == "2026-12-05"


def test_assign_rejects_unknown_or_inactive_user(world, as_user):
    lead = as_user(world["lead"])
    t = world["task"].id
    assert lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "nobody"}).status_code == 422
    assert lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "gone"}).status_code == 422


def test_bulk_reports_per_item(world, as_user):
    db = world["db"]
    extra = StageDetail(client="CUP", project="P1", chapters="Ch02", stage_name="Copyediting", workflow="WF",
                        stage_status="In-progress", custody_status="returned_for_review", assignee_name="ce_david")
    db.add(extra)
    db.commit()
    r = as_user(world["lead"]).post("/api/v2/workspace/tasks/bulk",
                                    json={"action": "approve", "task_ids": [world["task"].id, extra.id, 999999]})
    assert r.status_code == 200
    res = {x["task_id"]: x["status"] for x in r.json()["results"]}
    assert res[extra.id] == "ok" and res[world["task"].id] == "skipped" and res[999999] == "error"


# ── legacy v1 endpoints: auth + custody sync ──────────────────────────────────

def test_v1_mutations_require_login(client, world):
    assert client.post("/api/v1/stage-details/bulk-assign", json={"assignee_name": None, "targets": []}).status_code == 401
    assert client.post("/api/v1/stage-details/project/P1/chapter/Ch01/stage/Copyediting/assign", json={"assignee_name": None}).status_code == 401
    assert client.post("/api/v1/stage-details/project/P1/chapter/Ch01/stage-transition",
                       json={"from_stage": "Copyediting", "to_stage": "Typesetting"}).status_code == 401
    assert client.post("/api/v1/stage-details/project/P1/shift-planned-dates", json={"chapters": "Ch01", "stage_names": [], "days": 1}).status_code == 401
    assert client.delete(f"/api/v1/stage-details/{world['task'].id}").status_code == 401


def test_v1_role_rules(world, as_user):
    emp, lead, admin = as_user(world["emp"]), as_user(world["lead"]), as_user(world["admin"])
    url = "/api/v1/stage-details/project/P1/chapter/Ch01/stage/Copyediting/assign"
    assert emp.post(url, json={"assignee_name": "ce_priya"}).status_code == 403
    r = lead.post(url, json={"assignee_name": "ce_priya"})
    assert r.status_code == 200
    world["db"].expire_all()
    assert world["db"].get(StageDetail, world["task"].id).custody_status == "in_progress"   # legacy assign keeps custody in sync

    assert lead.post(url, json={"assignee_name": "ghost"}).status_code == 422
    assert lead.post(url, json={"assignee_name": "ce_priya", "dt": "not-a-date"}).status_code == 422
    assert lead.delete(f"/api/v1/stage-details/{world['task'].id}").status_code == 403
    big = {"assignee_name": None, "targets": [{"project": "P", "chapters": str(i), "stage_name": "Copyediting"} for i in range(501)]}
    assert admin.post("/api/v1/stage-details/bulk-assign", json=big).status_code == 422
    assert admin.post("/api/v1/stage-details/project/P1/shift-planned-dates",
                      json={"chapters": "Ch01", "stage_names": ["Copyediting"], "days": 400}).status_code == 422


def test_v1_transition_validation_and_self_proceed(world, as_user):
    emp, emp2, lead = as_user(world["emp"]), as_user(world["emp2"]), as_user(world["lead"])
    url = "/api/v1/stage-details/project/P1/chapter/Ch01/stage-transition"
    lead.post("/api/v1/stage-details/project/P1/chapter/Ch01/stage/Copyediting/assign", json={"assignee_name": "ce_priya"})
    # Not downstream in workflow WF
    assert lead.post(url, json={"from_stage": "Typesetting", "to_stage": "Copyediting"}).status_code == 422
    # Someone who neither manages the stage nor holds the chapter
    assert emp2.post(url, json={"from_stage": "Copyediting", "to_stage": "Typesetting"}).status_code == 403
    # The assignee may proceed their own chapter (Chapter detail page flow)
    r = emp.post(url, json={"from_stage": "Copyediting", "to_stage": "Typesetting"})
    assert r.status_code == 200, r.text
    assert r.json()["stage_name"] == "Typesetting"


def test_v1_assign_creates_missing_row_with_real_client(world, as_user):
    r = as_user(world["admin"]).post("/api/v1/stage-details/project/P1/chapter/Ch01/stage/Quality Control/assign",
                                     json={"assignee_name": None})
    assert r.status_code == 200
    assert r.json()["client"] == "CUP"        # was set to the project code before
    assert r.json()["workflow"] == "WF"


# ── dashboard pipeline + schedule ─────────────────────────────────────────────

def test_dashboard_pipeline_for_stage_owner(world, as_user):
    r = as_user(world["lead"]).get("/api/v2/dashboard/workspaces?completed_days=30")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "teamlead"
    pipe = data["pipeline"]
    stage = next(s for s in pipe["stages"] if s["stage_name"] == "Copyediting")
    assert stage["can_manage"] is True and stage["group_email"] == "ce-leads@example.com"
    assert stage["owner_username"] == "ce_lead"
    assert stage["next_stage"] == "Typesetting"
    item = next(i for i in pipe["items"] if i["id"] == world["task"].id)
    assert item["custody_status"] == "unassigned" and item["next_stage"] == "Typesetting"
    assert item["delayed"] is True and item["delay_days"] >= 2
    assert {p["username"] for p in pipe["people"]} >= {"ce_priya", "ce_david"}


def test_dashboard_handles_user_without_role(world, as_user):
    db = world["db"]
    _user(db, "no_role_user", None)
    db.commit()
    mgr = _user(db, "big_boss", "Senior Project Manager", team="Management")
    db.commit()
    r = as_user(mgr).get("/api/v2/dashboard/workspaces")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "manager"
    assert any(m["username"] == "no_role_user" and m["role"] is None for m in r.json()["manager_workspace"]["members"])


def test_schedule_range_and_scope(world, as_user):
    lead, emp = as_user(world["lead"]), as_user(world["emp"])
    today = datetime.now(timezone.utc).date()
    q = f"date_from={(today - timedelta(days=6)).isoformat()}&date_to={(today + timedelta(days=7)).isoformat()}"
    r = lead.get(f"/api/v2/workspace/stages/Copyediting/schedule?{q}")
    assert r.status_code == 200, r.text
    assert [i["id"] for i in r.json()["items"]] == [world["task"].id]

    assert emp.get(f"/api/v2/workspace/stages/Copyediting/schedule?{q}").status_code == 403
    far = f"date_from={today.isoformat()}&date_to={(today + timedelta(days=200)).isoformat()}"
    assert lead.get(f"/api/v2/workspace/stages/Copyediting/schedule?{far}").status_code == 422
    assert lead.get(f"/api/v2/workspace/stages/Nope/schedule?{q}").status_code == 404

    # Completed rows are included or excluded on request
    db = world["db"]
    done = StageDetail(client="CUP", project="P1", chapters="Ch09", stage_name="Copyediting", workflow="WF",
                       planned_start_date=datetime.now(timezone.utc) - timedelta(days=3),
                       planned_end_date=datetime.now(timezone.utc) - timedelta(days=1),
                       actual_end_date=datetime.now(timezone.utc) - timedelta(days=1), stage_status="Completed",
                       custody_status="transitioned")
    db.add(done)
    db.commit()
    ids = [i["id"] for i in lead.get(f"/api/v2/workspace/stages/Copyediting/schedule?{q}").json()["items"]]
    assert done.id in ids
    ids = [i["id"] for i in lead.get(f"/api/v2/workspace/stages/Copyediting/schedule?{q}&include_completed=false").json()["items"]]
    assert done.id not in ids


def test_admin_sees_every_stage_and_process_in_order(world, as_user):
    db = world["db"]
    # Admin by access level, role text is something else (like real accounts: "Admin / COO", "Admin Team")
    admin = _user(db, "coo_admin", "Process Automation Specialist", team="Editorial Team", access_level="Admin")
    db.add(WorkflowMaster(workflow_name="WF2", stage_name="Typesetting", next_stage="Copyediting"))
    db.add(WorkflowMaster(workflow_name="WF2", stage_name="Copyediting", previous_stage="Typesetting"))
    db.commit()
    r = as_user(admin).get("/api/v2/dashboard/workspaces")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "manager"
    pipe = data["pipeline"]
    assert {s["stage_name"] for s in pipe["stages"]} == {"Copyediting", "Typesetting", "Quality Control"}
    assert all(s["can_manage"] for s in pipe["stages"])
    flows = {w["workflow_name"]: w["stages"] for w in pipe["workflows"]}
    assert flows["WF"] == ["Copyediting", "Typesetting", "Quality Control"]
    assert flows["WF2"] == ["Typesetting", "Copyediting"]
    # Editorial-team admin is not narrowed to editorial staff
    assert any(m["username"] == "ts_lead" for m in data["manager_workspace"]["members"])


def test_items_show_client_company_and_pm_first_name(world, as_user):
    from app.domains.clients.models import Client
    from app.domains.projects.models import Project
    db = world["db"]
    world["pm"].first_name = "Marcus"
    cl = Client(category_type="organization", contact_type="Customer", company="Cambridge University Press",
                division="CUP", email="cup@example.com")
    db.add(cl)
    db.commit()
    db.add(Project(project_code="P1", client_id=cl.id, client_name="CUP"))
    db.commit()
    item = next(i for i in as_user(world["lead"]).get("/api/v2/dashboard/workspaces").json()["pipeline"]["items"]
                if i["id"] == world["task"].id)
    assert item["client"] == "CUP"
    assert item["client_name"] == "Cambridge University Press"
    assert item["project_manager_display"] == "Marcus"


def test_chapter_label():
    from app.domains.workflow.stage_service import chapter_label
    assert chapter_label("01") == "Chapter 01"
    assert chapter_label("10") == "Chapter 10"
    assert chapter_label("00") == "Book"
    assert chapter_label("Ch 02 - Art") == "Ch 02 - Art"


def test_bulk_assign_sends_one_email_with_group_cc(world, as_user, mails):
    db = world["db"]
    ids = []
    for ch in ("01", "02", "03", "04"):
        sd = StageDetail(client="CUP", project="P1", chapters=ch, stage_name="Copyediting", workflow="WF",
                         stage_status="In-progress", custody_status="unassigned")
        db.add(sd)
        db.commit()
        ids.append(sd.id)
    r = as_user(world["lead"]).post("/api/v2/workspace/tasks/bulk", json={"action": "assign", "task_ids": ids, "assignee": "ce_priya"})
    assert r.status_code == 200
    assert all(x["status"] == "ok" for x in r.json()["results"])
    assert all(x["item"]["chapter_label"].startswith("Chapter 0") for x in r.json()["results"])
    assert len(mails) == 1                                         # one mail, not four
    m = mails[0]
    assert m["to_email"] == "ce_priya@example.com"
    assert m["cc_emails"] == ["ce-leads@example.com"]             # the stage's team group mail
    assert "4 chapters assigned to you" in m["subject"]
    for ch in ("Chapter 01", "Chapter 02", "Chapter 03", "Chapter 04"):
        assert ch in m["text_body"] and ch in m["html_body"]


def test_single_assign_email_uses_chapter_label_and_group_cc(world, as_user, mails):
    db = world["db"]
    sd = StageDetail(client="CUP", project="P1", chapters="10", stage_name="Copyediting", workflow="WF",
                     stage_status="In-progress", custody_status="unassigned")
    db.add(sd)
    db.commit()
    assert as_user(world["lead"]).post(f"/api/v2/workspace/tasks/{sd.id}/assign", json={"assignee": "ce_priya"}).status_code == 200
    assert len(mails) == 1
    assert mails[0]["subject"] == "[P1] Chapter 10 assigned to you · Copyediting"
    assert mails[0]["cc_emails"] == ["ce-leads@example.com"]


def test_stage_owner_with_unlisted_role_gets_board_for_every_owned_stage(world, as_user):
    """Owner designation in Stage Master (e.g. "Manuscript Analysis Manager") is enough to get the owner board,
    for all the stages they own, with every chapter of those stages, not just the ones assigned to them."""
    db = world["db"]
    _stage(db, "Manuscript Analysis", '["Project Manager", "Manuscript Analysis Operator", "Manuscript Analysis Manager"]',
           owner="Manuscript Analysis Manager")
    _stage(db, "Job Initiation", '["Manuscript Analysis Operator"]', owner="Manuscript Analysis Manager")
    owner = _user(db, "hema", "Manuscript Analysis Manager", team="Project Management Team")
    _user(db, "ma_op", "Manuscript Analysis Operator", team="Ops Team")
    db.commit()
    now = datetime.now(timezone.utc)
    rows = [StageDetail(client="CUP", project="P9", chapters=f"{n:02d}", stage_name="Manuscript Analysis", workflow="WF",
                        planned_end_date=now + timedelta(days=n), stage_status="In-progress",
                        assignee_name="hema" if n == 1 else None,
                        custody_status="in_progress" if n == 1 else "unassigned") for n in range(1, 6)]
    rows.append(StageDetail(client="CUP", project="P9", chapters="01", stage_name="Job Initiation", workflow="WF",
                            planned_end_date=now, stage_status="In-progress", custody_status="unassigned"))
    db.add_all(rows)
    db.commit()

    data = as_user(owner).get("/api/v2/dashboard/workspaces").json()
    assert data["role"] == "teamlead"
    pipe = data["pipeline"]
    assert {s["stage_name"] for s in pipe["stages"]} == {"Manuscript Analysis", "Job Initiation"}
    assert all(s["can_manage"] for s in pipe["stages"])
    ma = [i for i in pipe["items"] if i["stage_name"] == "Manuscript Analysis"]
    assert len(ma) == 5
    assert "ma_op" in {p["username"] for p in pipe["people"]}
    members = {m["username"] for m in data["teamlead_workspace"]["members"]}
    assert "ma_op" in members


def test_assignee_role_must_be_one_of_the_stage_roles(world, as_user):
    t = world["task"].id
    lead = as_user(world["lead"])
    # Project Manager isn't in Copyediting's roles -> refused, row untouched
    r = lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "pm_marcus", "expected_custody_status": "unassigned"})
    assert r.status_code == 422, r.text
    assert "isn't one of the roles for Copyediting" in r.json()["detail"]
    # Bulk reports it per item instead of failing the batch
    r = lead.post("/api/v2/workspace/tasks/bulk", json={"action": "assign", "task_ids": [t], "assignee": "pm_marcus", "notify": False})
    assert r.json()["results"][0]["status"] == "error"
    # Picker list: only people whose Role is in the stage's roles
    pipe = lead.get("/api/v2/dashboard/workspaces").json()["pipeline"]
    eligible = {p["username"] for p in pipe["people"] if "Copyediting" in p["stage_names"]}
    assert "pm_marcus" not in eligible and {"ce_priya", "ce_david"} <= eligible and "gone" not in eligible
    r = lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "ce_priya", "expected_custody_status": "unassigned"})
    assert r.status_code == 200, r.text


def test_admin_role_can_be_assigned_to_any_stage(world, as_user):
    # Copyediting's roles don't list Admin, but the Admin role is eligible for every stage
    t = world["task"].id
    lead = as_user(world["lead"])
    pipe = lead.get("/api/v2/dashboard/workspaces").json()["pipeline"]
    boss = next(p for p in pipe["people"] if p["username"] == "boss")
    assert "Copyediting" in boss["stage_names"]
    r = lead.post(f"/api/v2/workspace/tasks/{t}/assign", json={"assignee": "boss", "expected_custody_status": "unassigned"})
    assert r.status_code == 200, r.text
