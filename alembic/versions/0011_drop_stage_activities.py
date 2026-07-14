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
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Robust check for stages_details constraints
    tables = inspector.get_table_names()
    if "stages_details" in tables:
        fks = inspector.get_foreign_keys("stages_details")
        for fk in fks:
            if "stage_activity" in fk["constrained_columns"]:
                fk_name = fk["name"]
                if fk_name:
                    op.drop_constraint(fk_name, "stages_details", type_="foreignkey")

    # Robust check for chapter_details constraints
    if "chapter_details" in tables:
        fks_chapter = inspector.get_foreign_keys("chapter_details")
        for fk in fks_chapter:
            if "current_stage_activity" in fk["constrained_columns"]:
                fk_name = fk["name"]
                if fk_name:
                    op.drop_constraint(fk_name, "chapter_details", type_="foreignkey")

    # Robust check for stage_master column
    if "stage_master" in tables:
        cols_stage_master = {c["name"] for c in inspector.get_columns("stage_master")}
        if "stage_activities" in cols_stage_master:
            op.drop_column("stage_master", "stage_activities")

    # Robust check for stage_activity_master table and index
    if "stage_activity_master" in tables:
        indexes = inspector.get_indexes("stage_activity_master")
        index_names = {idx["name"] for idx in indexes}
        if "ix_stage_activity_master_stage_activity_name" in index_names:
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
