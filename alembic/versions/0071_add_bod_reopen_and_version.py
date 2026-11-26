"""Add bod reopen and revision columns

Revision ID: 0071_add_bod_reopen_and_version
Revises: 0070_langedit_ignore_scope
Create Date: 2026-11-18 12:22:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0071_add_bod_reopen_and_version'
down_revision = '0070_langedit_ignore_scope'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'revision' not in columns:
            op.add_column('bod_jobs', sa.Column('revision', sa.String(length=50), nullable=True))
        if 'reopen_history' not in columns:
            op.add_column('bod_jobs', sa.Column('reopen_history', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'reopen_history' in columns:
            op.drop_column('bod_jobs', 'reopen_history')
        if 'revision' in columns:
            op.drop_column('bod_jobs', 'revision')

