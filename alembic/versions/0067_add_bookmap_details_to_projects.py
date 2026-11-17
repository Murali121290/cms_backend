"""Add bookmap_details to projects table

Revision ID: 0067_add_bookmap_details_to_projects
Revises: 0066_add_eisbn_to_bod_jobs
Create Date: 2026-11-16 15:55:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0067_add_bookmap_details_to_projects'
down_revision: Union[str, Sequence[str], None] = '0066_add_eisbn_to_bod_jobs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'bookmap_details' not in columns:
            op.add_column('projects', sa.Column('bookmap_details', sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'bookmap_details' in columns:
            op.drop_column('projects', 'bookmap_details')

