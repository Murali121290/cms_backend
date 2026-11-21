"""/api/v2/workspace — custody lifecycle actions and the stage schedule for the React workspace.

Thin router: authentication via cookie, everything else in app.domains.workflow.workspace_tasks.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app import database, schemas_v2
from app.domains.auth.models import User
from app.domains.workflow import stage_service, workspace_tasks
from app.domains.workflow.access import require_workflow_actor

router = APIRouter(prefix="/api/v2/workspace", tags=["workspace-v2"])


@router.post("/tasks/{task_id}/assign", response_model=schemas_v2.WorkspaceItem)
def assign_task(task_id: int, payload: schemas_v2.WorkspaceAssignRequest, background: BackgroundTasks,
                db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    sd = workspace_tasks.assign_task(
        db, actor, task_id, assignee=payload.assignee, priority=payload.priority, planned_end_date=payload.planned_end_date,
        notes=payload.notes, notify=payload.notify, expected=payload.expected_custody_status, background=background,
    )
    return workspace_tasks.serialize(db, sd)


@router.post("/tasks/{task_id}/handback", response_model=schemas_v2.WorkspaceItem)
def handback_task(task_id: int, payload: schemas_v2.WorkspaceHandbackRequest, background: BackgroundTasks,
                  db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    sd = workspace_tasks.handback_task(db, actor, task_id, notes=payload.notes, checklist_confirmed=payload.checklist_confirmed,
                                       expected=payload.expected_custody_status, background=background)
    return workspace_tasks.serialize(db, sd)


@router.post("/tasks/{task_id}/review", response_model=schemas_v2.WorkspaceItem)
def review_task(task_id: int, payload: schemas_v2.WorkspaceReviewRequest, background: BackgroundTasks,
                db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    sd = workspace_tasks.review_task(db, actor, task_id, decision=payload.decision, notes=payload.notes,
                                     expected=payload.expected_custody_status, background=background)
    return workspace_tasks.serialize(db, sd)


@router.get("/tasks/{task_id}/move-next/preview", response_model=schemas_v2.WorkspaceMoveNextPreview)
def move_next_preview(task_id: int, db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    return workspace_tasks.move_preview(db, actor, task_id)


@router.post("/tasks/{task_id}/move-next", response_model=schemas_v2.WorkspaceItem)
def move_next(task_id: int, payload: schemas_v2.WorkspaceMoveNextRequest, background: BackgroundTasks,
              db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    sd = workspace_tasks.move_next(db, actor, task_id, notify=payload.notify, expected=payload.expected_custody_status,
                                   background=background)
    return workspace_tasks.serialize(db, sd)


@router.get("/tasks/{task_id}/activity", response_model=schemas_v2.WorkspaceActivityResponse)
def task_activity(task_id: int, db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    return workspace_tasks.activity(db, actor, task_id)


@router.post("/tasks/bulk", response_model=schemas_v2.WorkspaceBulkResponse)
def bulk_action(payload: schemas_v2.WorkspaceBulkRequest, background: BackgroundTasks,
                db: Session = Depends(database.get_db), actor: User = Depends(require_workflow_actor)):
    results = workspace_tasks.bulk(db, actor, action=payload.action, task_ids=payload.task_ids, assignee=payload.assignee,
                                   notify=payload.notify, background=background)
    return {"results": results}


@router.get("/stages/{stage_name}/schedule", response_model=schemas_v2.WorkspaceScheduleResponse)
def stage_schedule(
    stage_name: str,
    date_from: date | None = Query(None, description="First day (inclusive), app timezone. Default: 6 days ago."),
    date_to: date | None = Query(None, description="Last day (inclusive). Default: 7 days from today."),
    include_completed: bool = Query(True),
    db: Session = Depends(database.get_db),
    actor: User = Depends(require_workflow_actor),
):
    today = stage_service.today_local()
    return workspace_tasks.schedule(db, actor, stage_name, date_from or today - timedelta(days=6),
                                    date_to or today + timedelta(days=7), include_completed)
