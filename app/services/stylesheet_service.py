import json
from datetime import datetime
from sqlalchemy.orm import Session
from app import models, schemas_v2


def _deserialize_ia_rows(raw: str) -> list[schemas_v2.IARow]:
    try:
        data = json.loads(raw or "[]")
        return [schemas_v2.IARow(**row) for row in data]
    except Exception:
        return []


def _deserialize_file_ids(raw: str | None) -> list[int]:
    try:
        return json.loads(raw or "[]")
    except Exception:
        return []


def _serialize_stylesheet(ss: models.ProjectStylesheet) -> schemas_v2.StylesheetSummary:
    return schemas_v2.StylesheetSummary(
        id=ss.id,
        project_id=ss.project_id,
        name=ss.name,
        description=ss.description,
        is_active=ss.is_active,
        created_at=ss.created_at,
        created_by_id=ss.created_by_id,
        selected_ia_rows=_deserialize_ia_rows(ss.selected_ia_rows),
        analyzed_file_ids=_deserialize_file_ids(ss.analyzed_file_ids),
    )


def get_stylesheets_for_project(
    db: Session, *, project_id: int
) -> dict:
    stylesheets = (
        db.query(models.ProjectStylesheet)
        .filter(models.ProjectStylesheet.project_id == project_id)
        .order_by(models.ProjectStylesheet.created_at.desc())
        .all()
    )
    active = next((s for s in stylesheets if s.is_active), None)
    return {
        "stylesheets": stylesheets,
        "active": active,
    }


def get_active_stylesheet_for_project(
    db: Session, *, project_id: int
) -> models.ProjectStylesheet | None:
    return (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.project_id == project_id,
            models.ProjectStylesheet.is_active.is_(True),
        )
        .first()
    )


def create_stylesheet(
    db: Session,
    *,
    project_id: int,
    name: str,
    description: str | None,
    selected_ia_rows: list[schemas_v2.IARow],
    created_by_id: int | None,
    analyzed_file_ids: list[int] | None = None,
) -> models.ProjectStylesheet:
    ss = models.ProjectStylesheet(
        project_id=project_id,
        name=name,
        description=description,
        selected_ia_rows=json.dumps([r.model_dump() for r in selected_ia_rows]),
        analyzed_file_ids=json.dumps(analyzed_file_ids or []),
        is_active=False,
        created_at=datetime.utcnow(),
        created_by_id=created_by_id,
    )
    db.add(ss)
    db.commit()
    db.refresh(ss)
    return ss


def update_stylesheet(
    db: Session,
    *,
    stylesheet_id: int,
    project_id: int,
    name: str | None,
    description: str | None,
    selected_ia_rows: list[schemas_v2.IARow] | None,
    analyzed_file_ids: list[int] | None = None,
) -> models.ProjectStylesheet | None:
    ss = (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.id == stylesheet_id,
            models.ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not ss:
        return None
    if name is not None:
        ss.name = name
    if description is not None:
        ss.description = description
    if selected_ia_rows is not None:
        ss.selected_ia_rows = json.dumps([r.model_dump() for r in selected_ia_rows])
    if analyzed_file_ids is not None:
        ss.analyzed_file_ids = json.dumps(analyzed_file_ids)
    db.commit()
    db.refresh(ss)
    return ss


def delete_stylesheet(
    db: Session, *, stylesheet_id: int, project_id: int
) -> bool:
    ss = (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.id == stylesheet_id,
            models.ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not ss:
        return False
    db.delete(ss)
    db.commit()
    return True


def activate_stylesheet(
    db: Session, *, stylesheet_id: int, project_id: int
) -> dict | None:
    """Set one stylesheet as active, deactivating all others for the project."""
    target = (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.id == stylesheet_id,
            models.ProjectStylesheet.project_id == project_id,
        )
        .first()
    )
    if not target:
        return None

    # Deactivate all others
    others = (
        db.query(models.ProjectStylesheet)
        .filter(
            models.ProjectStylesheet.project_id == project_id,
            models.ProjectStylesheet.id != stylesheet_id,
            models.ProjectStylesheet.is_active.is_(True),
        )
        .all()
    )
    deactivated_ids = [s.id for s in others]
    for s in others:
        s.is_active = False

    target.is_active = True
    db.commit()
    return {"activated_id": stylesheet_id, "deactivated_ids": deactivated_ids}
