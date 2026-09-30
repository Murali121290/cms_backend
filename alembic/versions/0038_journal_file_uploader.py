"""Record who uploaded each journal file (the article file manager shows it)

Revision ID: 0038_journal_file_uploader
Revises: 0037_merge_pre_editing
Create Date: 2026-10-01 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0038_journal_file_uploader'
down_revision: Union[str, Sequence[str], None] = '0037_merge_pre_editing'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'uploaded_by_id' not in {c['name'] for c in inspector.get_columns('journal_files')}:
        op.add_column('journal_files', sa.Column('uploaded_by_id', sa.Integer(), nullable=True))
        op.create_foreign_key('fk_journal_files_uploaded_by', 'journal_files', 'users', ['uploaded_by_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_journal_files_uploaded_by', 'journal_files', type_='foreignkey')
    op.drop_column('journal_files', 'uploaded_by_id')
