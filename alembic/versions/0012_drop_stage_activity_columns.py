"""Drop stage_activity/stage_activity_status/current_stage_activity columns

Revision ID: 0012_drop_stage_activity_columns
Revises: 0011_drop_stage_activities
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0012_drop_stage_activity_columns'
down_revision: Union[str, Sequence[str], None] = '0011_drop_stage_activities'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("stages_details", "stage_activity")
    op.drop_column("stages_details", "stage_activity_status")
    op.drop_column("chapter_details", "current_stage_activity")


def downgrade() -> None:
    op.add_column("stages_details", sa.Column("stage_activity", sa.String(100), nullable=True))
    op.add_column(
        "stages_details",
        sa.Column("stage_activity_status", sa.String(20), nullable=False, server_default="In-progress"),
    )
    op.add_column("chapter_details", sa.Column("current_stage_activity", sa.String(100), nullable=True))
