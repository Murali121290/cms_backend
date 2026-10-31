"""add dispatched_at and dispatched_by to bod_jobs

Revision ID: 0053_add_bod_dispatched_columns
Revises: 0052_stage_transition_configs
Create Date: 2026-10-22 14:21:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0053_add_bod_dispatched_columns'
down_revision: Union[str, Sequence[str], None] = '0052_stage_transition_configs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'dispatched_by' not in columns:
            op.add_column('bod_jobs', sa.Column('dispatched_by', sa.String(length=255), nullable=True))
        if 'dispatched_at' not in columns:
            op.add_column('bod_jobs', sa.Column('dispatched_at', sa.DateTime(), nullable=True))
        if 'is_fastrack' not in columns:
            op.add_column('bod_jobs', sa.Column('is_fastrack', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'is_fastrack' in columns:
            op.drop_column('bod_jobs', 'is_fastrack')
        if 'dispatched_at' in columns:
            op.drop_column('bod_jobs', 'dispatched_at')
        if 'dispatched_by' in columns:
            op.drop_column('bod_jobs', 'dispatched_by')
