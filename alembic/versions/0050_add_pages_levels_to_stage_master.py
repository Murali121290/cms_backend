"""Add pages_level1, pages_level2, pages_level3 columns to stage_master and seed Pre-editing norms.

Revision ID: 0050_stage_pages_levels
Revises: 0049_stage_processing_actions
Create Date: 2026-10-15 10:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0050_stage_pages_levels'
down_revision: Union[str, Sequence[str], None] = '0049_stage_processing_actions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stage_master')}

    if 'pages_level1' not in cols:
        op.add_column('stage_master', sa.Column('pages_level1', sa.Integer(), nullable=True))
    if 'pages_level2' not in cols:
        op.add_column('stage_master', sa.Column('pages_level2', sa.Integer(), nullable=True))
    if 'pages_level3' not in cols:
        op.add_column('stage_master', sa.Column('pages_level3', sa.Integer(), nullable=True))

    # Seed Pre-editing with 120 L1, 100 L2, 80 L3
    conn.execute(
        sa.text(
            "UPDATE stage_master "
            "SET pages_level1 = 120, pages_level2 = 100, pages_level3 = 80 "
            "WHERE LOWER(stage_name) = 'pre-editing'"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stage_master')}

    if 'pages_level3' in cols:
        op.drop_column('stage_master', 'pages_level3')
    if 'pages_level2' in cols:
        op.drop_column('stage_master', 'pages_level2')
    if 'pages_level1' in cols:
        op.drop_column('stage_master', 'pages_level1')
