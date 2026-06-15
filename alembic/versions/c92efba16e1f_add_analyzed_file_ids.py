"""add analyzed_file_ids to project_stylesheets

Revision ID: c92efba16e1f
Revises: a1b2c3d4e5f6
Create Date: 2026-06-11 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c92efba16e1f'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('project_stylesheets', sa.Column('analyzed_file_ids', sa.String(), nullable=True, server_default='[]'))


def downgrade() -> None:
    op.drop_column('project_stylesheets', 'analyzed_file_ids')
