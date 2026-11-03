"""Add project_type to projects table

Revision ID: 0063_add_project_type_to_projects
Revises: 0062_rule_overrides
Create Date: 2026-11-03 12:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0063_add_project_type_to_projects'
down_revision: Union[str, Sequence[str], None] = '0062_rule_overrides'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'project_type' not in columns:
            op.add_column('projects', sa.Column('project_type', sa.String(length=100), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'project_type' in columns:
            op.drop_column('projects', 'project_type')

