"""Indexes for workspace queries + unique (project, chapters, stage_name) on stages_details

The unique index is only created when no duplicates exist. If duplicates are found the migration
stops and lists them; nothing is deleted automatically. Resolve them, then run the upgrade again.

Revision ID: 0072_stage_details_indexes
Revises: 0071_add_bod_reopen_and_version
Create Date: 2026-11-21 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0072_stage_details_indexes'
down_revision = '0071_add_bod_reopen_and_version'
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_stages_details_assignee", ["assignee_name"]),
    ("ix_stages_details_stage_status", ["stage_name", "stage_status"]),
    ("ix_stages_details_project_chapter", ["project", "chapters"]),
    ("ix_stages_details_stage_end", ["stage_name", "actual_end_date"]),
]


def _existing_indexes(bind) -> set[str]:
    return {ix["name"] for ix in sa.inspect(bind).get_indexes("stages_details")}


def upgrade() -> None:
    bind = op.get_bind()
    existing = _existing_indexes(bind)
    for name, cols in INDEXES:
        if name not in existing:
            op.create_index(name, "stages_details", cols)

    dupes = bind.execute(sa.text(
        "SELECT project, chapters, stage_name, COUNT(*) AS n FROM stages_details "
        "GROUP BY project, chapters, stage_name HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50"
    )).fetchall()
    if dupes:
        listing = "\n".join(f"  {d.project} / {d.chapters} / {d.stage_name}: {d.n} rows" for d in dupes)
        raise RuntimeError(
            "stages_details has duplicate (project, chapters, stage_name) rows, so the unique index "
            "uq_stages_details_project_chapter_stage cannot be created. Merge or delete the extra rows "
            "(keep the one with the latest activity), then re-run `alembic upgrade head`. First 50:\n" + listing
        )
    if "uq_stages_details_project_chapter_stage" not in existing:
        op.create_index("uq_stages_details_project_chapter_stage", "stages_details",
                        ["project", "chapters", "stage_name"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    existing = _existing_indexes(bind)
    for name in ["uq_stages_details_project_chapter_stage"] + [n for n, _ in INDEXES]:
        if name in existing:
            op.drop_index(name, table_name="stages_details")
