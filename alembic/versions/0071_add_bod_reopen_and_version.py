"""Add bod reopen and version columns

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
    op.add_column('bod_jobs', sa.Column('version', sa.String(length=50), nullable=True))
    op.add_column('bod_jobs', sa.Column('reopen_history', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    op.drop_column('bod_jobs', 'reopen_history')
    op.drop_column('bod_jobs', 'version')

