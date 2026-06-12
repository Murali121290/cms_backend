"""Align database to SQLAlchemy model columns

Revision ID: e06e61806843
Revises: 4c83115bb7f2
Create Date: 2026-06-12 06:54:34.075459

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e06e61806843'
down_revision: Union[str, Sequence[str], None] = '4c83115bb7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Rename columns in projects table
    op.alter_column('projects', 'code', new_column_name='project_code')
    op.alter_column('projects', 'title', new_column_name='project_title')
    op.alter_column('projects', 'workflow_name', new_column_name='workflow_name')
    op.alter_column('projects', 'chapter_count_wms', new_column_name='chapter_count')
    
    # Add customer_name column
    op.add_column('projects', sa.Column('customer_name', sa.String(length=255), nullable=True))

    # Recreate the index for project_code
    op.drop_index('ix_projects_code', table_name='projects')
    op.create_index(op.f('ix_projects_project_code'), 'projects', ['project_code'], unique=True)


def downgrade() -> None:
    # Drop customer_name column
    op.drop_column('projects', 'customer_name')

    # Rename columns back
    op.alter_column('projects', 'project_code', new_column_name='code')
    op.alter_column('projects', 'project_title', new_column_name='title')
    op.alter_column('projects', 'workflow_name', new_column_name='workflow_name')
    op.alter_column('projects', 'chapter_count', new_column_name='chapter_count_wms')

    # Recreate the index for code
    op.drop_index('ix_projects_project_code', table_name='projects')
    op.create_index('ix_projects_code', 'projects', ['code'], unique=True)
