"""Add comments table

Revision ID: 0004_add_comments
Revises: 0003_add_word_count
Create Date: 2026-06-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004_add_comments'
down_revision: Union[str, Sequence[str], None] = '0003_add_word_count'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'comments' in inspector.get_table_names():
        return
    op.create_table(
        'comments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('file_id', sa.Integer(), sa.ForeignKey('files.id', ondelete='CASCADE'), nullable=False),
        sa.Column('comment_uuid', sa.String(length=64), nullable=False),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('author_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('author_name', sa.String(length=150), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('resolved', sa.Boolean(), nullable=False, server_default=sa.false()),
        # Declare the unique constraint inline so SQLite (which can't ALTER
        # TABLE ADD CONSTRAINT) accepts the migration without batch mode.
        sa.UniqueConstraint('file_id', 'comment_uuid', name='uq_comments_file_uuid'),
    )
    op.create_index('ix_comments_file_id', 'comments', ['file_id'])
    op.create_index('ix_comments_comment_uuid', 'comments', ['comment_uuid'])


def downgrade() -> None:
    op.drop_index('ix_comments_comment_uuid', table_name='comments')
    op.drop_index('ix_comments_file_id', table_name='comments')
    op.drop_table('comments')
