"""Link journal articles to a shadow book file for the book review pages

Revision ID: 0036_add_journal_review_file
Revises: 0035_add_journal_assets
Create Date: 2026-09-30 10:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0036_add_journal_review_file'
down_revision: Union[str, Sequence[str], None] = '0035_add_journal_assets'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'review_file_id' not in {c['name'] for c in inspector.get_columns('journal_articles')}:
        with op.batch_alter_table('journal_articles') as batch:
            batch.add_column(sa.Column('review_file_id', sa.Integer(), nullable=True))
            batch.create_foreign_key('fk_journal_articles_review_file', 'files', ['review_file_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'review_file_id' in {c['name'] for c in inspector.get_columns('journal_articles')}:
        with op.batch_alter_table('journal_articles') as batch:
            batch.drop_constraint('fk_journal_articles_review_file', type_='foreignkey')
            batch.drop_column('review_file_id')
