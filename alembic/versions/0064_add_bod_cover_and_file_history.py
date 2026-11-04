"""Add cover and file history columns to bod_jobs

Revision ID: 0064_add_bod_cover_and_file_history
Revises: 0063_add_project_type_to_projects
Create Date: 2026-11-04 16:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0064_add_bod_cover_and_file_history'
down_revision: Union[str, Sequence[str], None] = '0063_add_project_type_to_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'cover_filename' not in columns:
            op.add_column('bod_jobs', sa.Column('cover_filename', sa.String(length=255), nullable=True))
        if 'cover_filepath' not in columns:
            op.add_column('bod_jobs', sa.Column('cover_filepath', sa.String(length=1024), nullable=True))
        if 'file_history' not in columns:
            op.add_column('bod_jobs', sa.Column('file_history', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'file_history' in columns:
            op.drop_column('bod_jobs', 'file_history')
        if 'cover_filepath' in columns:
            op.drop_column('bod_jobs', 'cover_filepath')
        if 'cover_filename' in columns:
            op.drop_column('bod_jobs', 'cover_filename')

