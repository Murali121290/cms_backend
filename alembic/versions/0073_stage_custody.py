"""Stage custody lifecycle columns on stages_details, group_email on stage_master

custody_status is backfilled from the legacy fields:
  Completed rows -> transitioned, rows with an assignee -> in_progress, otherwise -> unassigned.

Revision ID: 0073_stage_custody
Revises: 0072_stage_details_indexes
Create Date: 2026-11-21 10:05:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0073_stage_custody'
down_revision = '0072_stage_details_indexes'
branch_labels = None
depends_on = None

COLUMNS = [
    sa.Column("custody_status", sa.String(30), nullable=True),
    sa.Column("assigned_by", sa.String(150), nullable=True),
    sa.Column("assignment_notes", sa.Text(), nullable=True),
    sa.Column("handback_notes", sa.Text(), nullable=True),
    sa.Column("handback_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("qa_approved_by", sa.String(150), nullable=True),
    sa.Column("qa_approved_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("rework_notes", sa.Text(), nullable=True),
    sa.Column("rework_count", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("priority", sa.String(10), nullable=False, server_default="Normal"),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    have = {c["name"] for c in insp.get_columns("stages_details")}
    for col in COLUMNS:
        if col.name not in have:  # the app's startup DDL may already have added it
            op.add_column("stages_details", col)
    if "group_email" not in {c["name"] for c in insp.get_columns("stage_master")}:
        op.add_column("stage_master", sa.Column("group_email", sa.String(255), nullable=True))

    op.execute(
        "UPDATE stages_details SET custody_status = CASE "
        "WHEN stage_status = 'Completed' THEN 'transitioned' "
        "WHEN COALESCE(assignee_name, '') <> '' THEN 'in_progress' "
        "ELSE 'unassigned' END "
        "WHERE custody_status IS NULL"
    )
    if "ix_stages_details_stage_custody" not in {ix["name"] for ix in insp.get_indexes("stages_details")}:
        op.create_index("ix_stages_details_stage_custody", "stages_details", ["stage_name", "custody_status"])


def downgrade() -> None:
    op.drop_index("ix_stages_details_stage_custody", table_name="stages_details")
    op.drop_column("stage_master", "group_email")
    for col in reversed(COLUMNS):
        op.drop_column("stages_details", col.name)
