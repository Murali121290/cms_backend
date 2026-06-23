"""Add word count to chapter_details

Revision ID: 0003_add_word_count
Revises: 0002_add_webdav_locks
Create Date: 2026-06-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003_add_word_count'
down_revision: Union[str, Sequence[str], None] = '0002_add_webdav_locks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    has_column = False
    for col in inspector.get_columns('chapter_details'):
        if col['name'] == 'word_count':
            has_column = True
            break
    if not has_column:
        op.add_column('chapter_details', sa.Column('word_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('chapter_details', 'word_count')
