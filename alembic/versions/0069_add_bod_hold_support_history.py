"""Add hold_support_history to bod_jobs

Revision ID: 0069_add_bod_hold_support_history
Revises: 0068_add_bod_csv_entries
Create Date: 2026-11-17 19:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0069_add_bod_hold_support_history'
down_revision: Union[str, Sequence[str], None] = '0068_add_bod_csv_entries'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'hold_support_history' not in columns:
            op.add_column('bod_jobs', sa.Column('hold_support_history', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'hold_support_history' in columns:
            op.drop_column('bod_jobs', 'hold_support_history')

