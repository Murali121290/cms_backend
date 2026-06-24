import pytest
from datetime import datetime, timedelta
from app.domains.workflow.models import StageMaster, StageDetail, WorkflowMaster, ChapterInfo

def test_workflow_delay_calculation_on_transition(db_session, client):
    # Setup workflow stage masters
    stage1 = StageMaster(stage_name="Stage 1", active_status=True)
    stage2 = StageMaster(stage_name="Stage 2", active_status=True)
    db_session.add_all([stage1, stage2])
    db_session.commit()

    # Create ChapterInfo
    chapter = ChapterInfo(
        client="ClientA",
        project="Proj1",
        chapters="01",
        workflow="Workflow1",
        status="In-progress"
    )
    db_session.add(chapter)

    # Create planning rows
    planned_start = datetime.utcnow() - timedelta(days=5)
    planned_end = datetime.utcnow() - timedelta(days=2) # Planned end was 2 days ago
    
    sd1 = StageDetail(
        client="ClientA",
        project="Proj1",
        chapters="01",
        stage_name="Stage 1",
        workflow="Workflow1",
        planned_start_date=planned_start,
        planned_end_date=planned_end,
        actual_start_date=planned_start,
        stage_status="In-progress"
    )
    
    sd2 = StageDetail(
        client="ClientA",
        project="Proj1",
        chapters="01",
        stage_name="Stage 2",
        workflow="Workflow1",
        planned_start_date=planned_end,
        planned_end_date=planned_end + timedelta(days=3),
        stage_status="In-progress"
    )
    
    db_session.add_all([sd1, sd2])
    db_session.commit()

    # Call transition API: stage 1 -> stage 2
    # Since planned_end was 2 days ago, marking it completed now should result in a 2-day delay
    payload = {
        "from_stage": "Stage 1",
        "to_stage": "Stage 2",
        "dt": datetime.utcnow().isoformat()
    }
    
    response = client.post(
        "/api/v1/stage-details/project/Proj1/chapter/01/stage-transition",
        json=payload
    )
    
    assert response.status_code == 200
    
    # Reload and check stage 1 details
    db_session.expire_all()
    updated_sd1 = db_session.query(StageDetail).filter_by(project="Proj1", chapters="01", stage_name="Stage 1").first()
    assert updated_sd1.stage_status == "Completed"
    
    # Check delay logics
    assert updated_sd1.delayed is True
    assert updated_sd1.delay_days >= 2

    # Verify ChapterInfo delayed_stages is synced
    updated_chapter = db_session.query(ChapterInfo).filter_by(project="Proj1", chapters="01").first()
    import json
    delays = json.loads(updated_chapter.delayed_stages)
    assert delays.get("Stage 1") >= 2


def test_cascade_shift_endpoint(db_session, client):
    # Setup workflow stage masters
    stage1 = StageMaster(stage_name="Stage 1", active_status=True)
    stage2 = StageMaster(stage_name="Stage 2", active_status=True)
    db_session.add_all([stage1, stage2])
    db_session.commit()

    # Setup planning rows
    planned_start = datetime.utcnow()
    planned_end = datetime.utcnow() + timedelta(days=2)

    sd1 = StageDetail(
        client="ClientA",
        project="Proj1",
        chapters="01",
        stage_name="Stage 1",
        workflow="Workflow1",
        planned_start_date=planned_start,
        planned_end_date=planned_end,
    )
    sd2 = StageDetail(
        client="ClientA",
        project="Proj1",
        chapters="01",
        stage_name="Stage 2",
        workflow="Workflow1",
        planned_start_date=planned_end,
        planned_end_date=planned_end + timedelta(days=3),
    )
    db_session.add_all([sd1, sd2])
    db_session.commit()

    # Shift planned dates by 3 days
    payload = {
        "chapters": "01",
        "stage_names": ["Stage 1", "Stage 2"],
        "days": 3
    }
    response = client.post(
        "/api/v1/stage-details/project/Proj1/shift-planned-dates",
        json=payload
    )
    assert response.status_code == 200
    
    # Reload and check shifts
    db_session.expire_all()
    updated_sd1 = db_session.query(StageDetail).filter_by(project="Proj1", chapters="01", stage_name="Stage 1").first()
    updated_sd2 = db_session.query(StageDetail).filter_by(project="Proj1", chapters="01", stage_name="Stage 2").first()
    
    assert updated_sd1.planned_start_date.date() == (planned_start + timedelta(days=3)).date()
    assert updated_sd1.planned_end_date.date() == (planned_end + timedelta(days=3)).date()
    assert updated_sd2.planned_start_date.date() == (planned_end + timedelta(days=3)).date()
    assert updated_sd2.planned_end_date.date() == (planned_end + timedelta(days=6)).date()
