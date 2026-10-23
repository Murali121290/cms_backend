"""Add due_date_history to projects table

Revision ID: 0054_add_project_due_date_history
Revises: 0053_add_bod_dispatched_columns
Create Date: 2026-10-23 10:35:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


revision: str = '0054_add_project_due_date_history'
down_revision: Union[str, Sequence[str], None] = '0053_add_bod_dispatched_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'due_date_history' not in columns:
            op.add_column('projects', sa.Column('due_date_history', sa.JSON(), server_default='[]', nullable=False))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'due_date_history' in columns:
            op.drop_column('projects', 'due_date_history')
