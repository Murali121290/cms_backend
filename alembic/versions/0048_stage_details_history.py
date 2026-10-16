"""Add history column to stages_details table.

Revision ID: 0048_stage_details_history
Revises: 0047_project_language_rules
Create Date: 2026-10-14 13:17:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0048_stage_details_history'
down_revision: Union[str, Sequence[str], None] = '0047_project_language_rules'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stages_details')}
    if 'history' not in cols:
        op.add_column(
            'stages_details',
            sa.Column('history', sa.JSON(), nullable=True, server_default='[]')
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stages_details')}
    if 'history' in cols:
        op.drop_column('stages_details', 'history')
