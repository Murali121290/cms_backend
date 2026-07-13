"""Drop stage activities feature (table, column, and FK constraints)

Revision ID: 0011_drop_stage_activities
Revises: 0010_add_stylesheet_updated_at
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0011_drop_stage_activities'
down_revision: Union[str, Sequence[str], None] = '0010_add_stylesheet_updated_at'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop FK constraints referencing stage_activity_master; the columns stay
    # as plain free-text fields (data preserved, just no longer FK-enforced).
    op.drop_constraint("stages_details_stage_activity_fkey", "stages_details", type_="foreignkey")
    op.drop_constraint("chapter_details_current_stage_activity_fkey", "chapter_details", type_="foreignkey")

    op.drop_column("stage_master", "stage_activities")

    op.drop_index("ix_stage_activity_master_stage_activity_name", table_name="stage_activity_master")
    op.drop_table("stage_activity_master")


def downgrade() -> None:
    op.create_table(
        'stage_activity_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('stage_activity_name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stage_activity_name'),
    )
    op.create_index('ix_stage_activity_master_stage_activity_name', 'stage_activity_master', ['stage_activity_name'])

    op.add_column(
        'stage_master',
        sa.Column('stage_activities', postgresql.ARRAY(sa.BigInteger()), nullable=False, server_default='{}'),
    )

    op.create_foreign_key(
        "chapter_details_current_stage_activity_fkey", "chapter_details", "stage_activity_master",
        ["current_stage_activity"], ["stage_activity_name"], ondelete="SET NULL", onupdate="CASCADE",
    )
    op.create_foreign_key(
        "stages_details_stage_activity_fkey", "stages_details", "stage_activity_master",
        ["stage_activity"], ["stage_activity_name"], ondelete="RESTRICT", onupdate="CASCADE",
    )
