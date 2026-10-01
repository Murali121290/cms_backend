"""Add journal design assets and art-to-figure links

Revision ID: 0035_add_journal_assets
Revises: 0034_add_journal_workflows
Create Date: 2026-09-29 18:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0035_add_journal_assets'
down_revision: Union[str, Sequence[str], None] = '0034_add_journal_workflows'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if not inspector.has_table('journal_assets'):
        op.create_table(
            'journal_assets',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('journal_id', sa.BigInteger(), sa.ForeignKey('journals.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('kind', sa.String(30), nullable=False, index=True),
            sa.Column('filename', sa.String(255), nullable=False),
            sa.Column('path', sa.String(500), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column('size_bytes', sa.BigInteger(), nullable=True),
            sa.Column('uploaded_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    columns = {c['name'] for c in inspector.get_columns('journal_files')}
    if 'figure_number' not in columns:
        with op.batch_alter_table('journal_files') as batch:
            batch.add_column(sa.Column('figure_number', sa.Integer(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('journal_files')}
    if 'figure_number' in columns:
        with op.batch_alter_table('journal_files') as batch:
            batch.drop_column('figure_number')
    if inspector.has_table('journal_assets'):
        op.drop_table('journal_assets')
