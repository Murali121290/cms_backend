"""Add client_project_manager to projects table

Revision ID: 0044_add_cli_proj_mgr
Revises: 0043_journal_assign_delay
Create Date: 2026-10-06 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0044_add_cli_proj_mgr'
down_revision: Union[str, Sequence[str], None] = '0043_journal_assign_delay'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'projects' in tables:
        columns = {c['name'] for c in inspector.get_columns('projects')}
        if 'client_project_manager' not in columns:
            op.add_column('projects', sa.Column('client_project_manager', sa.String(length=255), nullable=True))
        if 'copyediting_level' not in columns:
            op.add_column('projects', sa.Column('copyediting_level', sa.String(length=50), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'projects' in tables:
        columns = {c['name'] for c in inspector.get_columns('projects')}
        if 'client_project_manager' in columns:
            op.drop_column('projects', 'client_project_manager')
        if 'copyediting_level' in columns:
            op.drop_column('projects', 'copyediting_level')
