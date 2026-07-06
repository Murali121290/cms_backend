"""Remove team column from projects

Revision ID: 0004_remove_project_team
Revises: 0003_add_word_count
Create Date: 2026-06-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004_remove_project_team'
down_revision: Union[str, Sequence[str], None] = '0003_add_word_count'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    for col in inspector.get_columns('projects'):
        if col['name'] == 'team':
            op.drop_column('projects', 'team')
            break


def downgrade() -> None:
    op.add_column('projects', sa.Column('team', sa.String(), nullable=True))
