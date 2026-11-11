import json
import pytest
from app.domains.workflow.models import StageMaster, StageDetail, WorkflowMaster, ChapterInfo
from app.domains.projects.models import Project

def test_stage_revert_requires_admin(client, user_factory, db_session):
    user_factory("regular_user", password="Secret123!", role_names=("Viewer",))
    client.post("/api/v2/session/login", json={"username": "regular_user", "password": "Secret123!"})

    st1 = StageMaster(stage_name="Typesetting", active_status=True)
    st2 = StageMaster(stage_name="Proof", active_status=True)
    db_session.add_all([st1, st2])

    proj = Project(code="PRJ001", project_code="PRJ001", title="Test Project", client_name="Test Client", workflow_name="WF1")
    db_session.add(proj)
    db_session.commit()

    ch = ChapterInfo(client="Test Client", project="PRJ001", chapters="01", stage_name="Proof", workflow="WF1")
    db_session.add(ch)
    db_session.commit()

    resp = client.post(f"/api/v2/chapters/{ch.id}/revert-stage", json={"target_stage": "Typesetting"})
    assert resp.status_code == 403
    assert "Only administrators" in resp.json()["detail"]


def test_stage_revert_as_admin_success(client, user_factory, db_session):
    user_factory("admin_user", password="Secret123!", role_names=("Admin",))
    client.post("/api/v2/session/login", json={"username": "admin_user", "password": "Secret123!"})

    st1 = StageMaster(stage_name="Manuscript", active_status=True)
    st2 = StageMaster(stage_name="XML", active_status=True)
    st3 = StageMaster(stage_name="Typesetting", active_status=True)
    st4 = StageMaster(stage_name="Proof", active_status=True)
    db_session.add_all([st1, st2, st3, st4])

    proj = Project(code="PRJ002", project_code="PRJ002", title="Test Project 2", client_name="Test Client", workflow_name="WF_BOOK")
    db_session.add(proj)
    db_session.commit()

    # Create workflow: Manuscript -> XML -> Typesetting -> Proof
    wf1 = WorkflowMaster(workflow_name="WF_BOOK", stage_name="Manuscript", previous_stage=None, next_stage="XML")
    wf2 = WorkflowMaster(workflow_name="WF_BOOK", stage_name="XML", previous_stage="Manuscript", next_stage="Typesetting")
    wf3 = WorkflowMaster(workflow_name="WF_BOOK", stage_name="Typesetting", previous_stage="XML", next_stage="Proof")
    wf4 = WorkflowMaster(workflow_name="WF_BOOK", stage_name="Proof", previous_stage="Typesetting", next_stage=None)
    db_session.add_all([wf1, wf2, wf3, wf4])

    sd_ms = StageDetail(client="Test Client", project="PRJ002", chapters="01", stage_name="Manuscript", workflow="WF_BOOK", stage_status="Completed")
    sd_xml = StageDetail(client="Test Client", project="PRJ002", chapters="01", stage_name="XML", workflow="WF_BOOK", stage_status="Completed")
    sd_type = StageDetail(client="Test Client", project="PRJ002", chapters="01", stage_name="Typesetting", workflow="WF_BOOK", stage_status="In-progress")
    db_session.add_all([sd_ms, sd_xml, sd_type])

    ch = ChapterInfo(client="Test Client", project="PRJ002", chapters="01", stage_name="Typesetting", workflow="WF_BOOK", status="In-progress")
    db_session.add(ch)
    db_session.commit()

    # First revert: from Typesetting to XML
    resp = client.post(f"/api/v2/chapters/{ch.id}/revert-stage", json={"target_stage": "XML", "remarks": "Fix formatting"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["chapter"]["stage_name"] == "XML"

    # Refresh DB
    db_session.refresh(ch)
    db_session.refresh(sd_xml)
    db_session.refresh(sd_type)

    assert ch.stage_name == "XML"
    assert sd_xml.stage_status == "In-progress"
    assert sd_type.stage_status == "Pending"

    # Verify JSON remarks history in ChapterInfo
    parsed_remarks = json.loads(ch.remarks)
    assert isinstance(parsed_remarks, list)
    assert len(parsed_remarks) == 1
    assert parsed_remarks[0]["from_stage"] == "Typesetting"
    assert parsed_remarks[0]["to_stage"] == "XML"
    assert parsed_remarks[0]["reverted_by"] == "admin_user"
    assert parsed_remarks[0]["reason"] == "Fix formatting"
    assert "timestamp" in parsed_remarks[0]

    # Verify StageDetail history
    assert sd_xml.history is not None
    assert len(sd_xml.history) >= 1
    assert sd_xml.history[-1]["from_stage"] == "Typesetting"

    # Second revert: from XML to Manuscript (testing appending to history)
    resp2 = client.post(f"/api/v2/chapters/{ch.id}/revert-stage", json={"target_stage": "Manuscript", "remarks": "Author re-uploaded file"})
    assert resp2.status_code == 200

    db_session.refresh(ch)
    db_session.refresh(sd_ms)
    db_session.refresh(sd_xml)

    assert ch.stage_name == "Manuscript"
    assert sd_ms.stage_status == "In-progress"
    assert sd_xml.stage_status == "Pending"

    # Verify that the JSON remarks list has appended the second event
    parsed_remarks2 = json.loads(ch.remarks)
    assert len(parsed_remarks2) == 2
    assert parsed_remarks2[1]["from_stage"] == "XML"
    assert parsed_remarks2[1]["to_stage"] == "Manuscript"
    assert parsed_remarks2[1]["reverted_by"] == "admin_user"
    assert parsed_remarks2[1]["reason"] == "Author re-uploaded file"
