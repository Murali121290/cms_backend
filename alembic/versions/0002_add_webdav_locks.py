"""Add WebDAV locks table

Revision ID: 0002_add_webdav_locks
Revises: 0001_initial_schema
Create Date: 2026-06-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0002_add_webdav_locks'
down_revision: Union[str, Sequence[str], None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'webdav_locks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.Integer(), nullable=False),
        sa.Column('lock_token', sa.String(200), nullable=False),
        sa.Column('owner_user_id', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_refresh_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('user_agent', sa.String(512), nullable=True),
        sa.Column('remote_addr', sa.String(128), nullable=True),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], name='fk_webdav_locks_file_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], name='fk_webdav_locks_owner_user_id', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_webdav_locks_id'), 'webdav_locks', ['id'], unique=False)
    op.create_index(op.f('ix_webdav_locks_file_id'), 'webdav_locks', ['file_id'], unique=False)
    op.create_index(op.f('ix_webdav_locks_lock_token'), 'webdav_locks', ['lock_token'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_webdav_locks_lock_token'), table_name='webdav_locks')
    op.drop_index(op.f('ix_webdav_locks_file_id'), table_name='webdav_locks')
    op.drop_index(op.f('ix_webdav_locks_id'), table_name='webdav_locks')
    op.drop_table('webdav_locks')
