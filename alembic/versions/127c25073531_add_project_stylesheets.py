"""Add project stylesheets

Revision ID: 127c25073531
Revises: f7dfc96449be
Create Date: 2026-05-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '127c25073531'
down_revision: Union[str, Sequence[str], None] = 'f7dfc96449be'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = inspect(conn)

    if 'project_stylesheets' not in inspector.get_table_names():
        op.create_table(
            'project_stylesheets',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('selected_ia_rows', sa.String(), nullable=False, server_default='[]'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('created_by_id', sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_project_stylesheets_id'), 'project_stylesheets', ['id'], unique=False)
        op.create_index(op.f('ix_project_stylesheets_project_id'), 'project_stylesheets', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_project_stylesheets_project_id'), table_name='project_stylesheets')
    op.drop_index(op.f('ix_project_stylesheets_id'), table_name='project_stylesheets')
    op.drop_table('project_stylesheets')
