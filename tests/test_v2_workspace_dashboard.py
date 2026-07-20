import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from app import models
from app.domains.workflow.models import StageDetail, StageMaster

def test_v2_workspaces_unauthenticated(client):
    response = client.get("/api/v2/dashboard/workspaces")
    assert response.status_code == 401

def test_v2_workspaces_editor_role(auth_cookie_client, db_session, roles):
    # Setup StageMaster using raw text SQL to bypass SQLAlchemy ARRAY type coercion
    db_session.execute(
        text("INSERT INTO stage_master (stage_name, description, roles, active_status) "
             "VALUES (:stage_name, :description, :roles, :active_status)"),
        {
            "stage_name": "Copyediting",
            "description": "Copyediting Stage",
            "roles": '["Copyeditor"]',
            "active_status": True
        }
    )
    db_session.commit()

    # Create Editor User
    editor_user = models.User(
        username="editor_murali",
        email="murali_editor@s4carlisle.com",
        password_hash="dummy",
        role="Copyeditor",
        team="Editorial Team"
    )
    db_session.add(editor_user)
    db_session.commit()
    
    # Create a couple of StageDetails assigned to Murali
    now = datetime.now(timezone.utc)
    
    sd_today = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch01",
        stage_name="Copyediting",
        assignee_name="editor_murali",
        actual_start_date=now,
        planned_end_date=now + timedelta(days=1),
        stage_status="In-progress"
    )
    
    sd_yest = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch02",
        stage_name="Copyediting",
        assignee_name="editor_murali",
        actual_start_date=now - timedelta(days=1),
        planned_end_date=now - timedelta(hours=1),
        stage_status="In-progress" # Overdue!
    )
    
    db_session.add_all([sd_today, sd_yest])
    db_session.commit()
    
    # Make authenticated request
    client = auth_cookie_client(editor_user)
    response = client.get("/api/v2/dashboard/workspaces")
    
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "user"
    assert data["viewer"]["username"] == "editor_murali"
    
    uw = data["user_workspace"]
    assert uw is not None
    assert uw["stats"]["today_assigned"] == 1
    assert uw["stats"]["yesterday_assigned"] == 1
    assert uw["stats"]["delayed_count"] == 1
    assert len(uw["assignments"]) == 2

def test_v2_workspaces_unassigned_and_bulk_assign(auth_cookie_client, db_session, roles):
    # Setup stage master using raw text SQL
    db_session.execute(
        text("INSERT INTO stage_master (stage_name, description, roles, active_status) "
             "VALUES (:stage_name, :description, :roles, :active_status)"),
        {
            "stage_name": "Pre-editing",
            "description": "Pre-editing stage",
            "roles": '["Pre Editor"]',
            "active_status": True
        }
    )
    db_session.commit()

    # Create Team Lead User
    tl_user = models.User(
        username="tl_murali",
        email="murali_tl@s4carlisle.com",
        password_hash="dummy",
        role="Team Lead - Editorial",
        team="Editorial Team"
    )
    # Create Editor User to assign tasks to
    operator_user = models.User(
        username="editor_ananya",
        email="ananya_ed@s4carlisle.com",
        password_hash="dummy",
        role="Pre Editor",
        team="Editorial Team"
    )
    db_session.add_all([tl_user, operator_user])
    db_session.commit()

    # Create unassigned Stage Details
    sd1 = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch01",
        stage_name="Pre-editing",
        assignee_name=None,
        stage_status="In-progress"
    )
    sd2 = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch02",
        stage_name="Pre-editing",
        assignee_name=None,
        stage_status="In-progress"
    )
    db_session.add_all([sd1, sd2])
    db_session.commit()

    # Log in as Team Lead and check that unassigned details show under virtual username "Unassigned"
    client = auth_cookie_client(tl_user)
    response = client.get("/api/v2/dashboard/workspaces")
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "teamlead"
    
    tl_w = data["teamlead_workspace"]
    assert tl_w is not None
    # Verify that a virtual member named "Unassigned" is present
    unassigned_member = next((m for m in tl_w["members"] if m["username"] == "Unassigned"), None)
    assert unassigned_member is not None
    assert len(unassigned_member["assignments"]) == 2

    # Now verify bulk-assignment route
    payload = {
        "assignee_name": "editor_ananya",
        "targets": [
            {"project": "PRJ001", "chapters": "Ch01", "stage_name": "Pre-editing"},
            {"project": "PRJ001", "chapters": "Ch02", "stage_name": "Pre-editing"}
        ]
    }
    assign_response = client.post("/api/v1/stage-details/bulk-assign", json=payload)
    assert assign_response.status_code == 200
    res_list = assign_response.json()
    assert len(res_list) == 2
    assert res_list[0]["assignee_name"] == "editor_ananya"
    assert res_list[1]["assignee_name"] == "editor_ananya"

    # Query again and check that they are now assigned to editor_ananya
    response = client.get("/api/v2/dashboard/workspaces")
    data = response.json()
    tl_w = data["teamlead_workspace"]
    
    # "Unassigned" should no longer have these assignments, and editor_ananya should have them!
    unassigned_member = next((m for m in tl_w["members"] if m["username"] == "Unassigned"), None)
    assert unassigned_member is None
    
    ananya_member = next((m for m in tl_w["members"] if m["username"] == "editor_ananya"), None)
    assert ananya_member is not None
    assert len(ananya_member["assignments"]) == 2

def test_v2_workspaces_dynamic_role_scoping(auth_cookie_client, db_session, roles):
    # Create the stage masters with role mappings in active db
    db_session.execute(
        text("INSERT INTO stage_master (stage_name, description, roles, active_status) "
             "VALUES ('Pre-editing', 'Pre-editing Stage', '[\"Team Lead - Prediting\", \"Pre Editor\"]', 1)")
    )
    db_session.execute(
        text("INSERT INTO stage_master (stage_name, description, roles, active_status) "
             "VALUES ('Copyediting', 'Copyediting Stage', '[\"Team Lead - Language Editing\", \"Language Editor\"]', 1)")
    )
    db_session.commit()

    # Create Team Lead - Prediting
    tl_pre = models.User(
        username="tl_pre_user",
        email="pre_tl@s4carlisle.com",
        password_hash="dummy",
        role="Team Lead - Prediting",
        team="Editorial Team"
    )
    # Create members of different roles on the same team
    pre_editor = models.User(
        username="member_pre_ed",
        email="pre_ed@s4carlisle.com",
        password_hash="dummy",
        role="Pre Editor",
        team="Editorial Team"
    )
    lang_editor = models.User(
        username="member_lang_ed",
        email="lang_ed@s4carlisle.com",
        password_hash="dummy",
        role="Language Editor",
        team="Editorial Team"
    )
    db_session.add_all([tl_pre, pre_editor, lang_editor])
    db_session.commit()

    # Create stage details for Pre-editing (assigned to Pre Editor) and Copyediting (assigned to Language Editor)
    sd_pre = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch01",
        stage_name="Pre-editing",
        assignee_name="member_pre_ed",
        stage_status="In-progress"
    )
    sd_copy = StageDetail(
        client="Artech",
        project="PRJ001",
        chapters="Ch02",
        stage_name="Copyediting",
        assignee_name="member_lang_ed",
        stage_status="In-progress"
    )
    db_session.add_all([sd_pre, sd_copy])
    db_session.commit()

    # Authenticate as Pre-editing lead
    client = auth_cookie_client(tl_pre)
    response = client.get("/api/v2/dashboard/workspaces")
    assert response.status_code == 200
    data = response.json()
    
    tl_w = data["teamlead_workspace"]
    assert tl_w is not None
    
    # 1. Team members list should ONLY contain 'member_pre_ed' (Pre Editor), and NOT 'member_lang_ed' (Language Editor)
    member_names = [m["username"] for m in tl_w["members"]]
    assert "member_pre_ed" in member_names
    assert "member_lang_ed" not in member_names
    
    # 2. Total active/delayed count should only reflect Pre-editing stage items (so total active count = 1, not 2)
    assert tl_w["stats"]["today_assigned"] == 0 # because actual_start_date is None

