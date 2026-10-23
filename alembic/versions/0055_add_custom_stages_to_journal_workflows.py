"""add custom_stages to journal_workflows

Revision ID: 0055_add_custom_stages_to_journal_workflows
Revises: 0054_add_project_due_date_history
Create Date: 2026-10-23 12:52:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0055_add_custom_stages_to_journal_workflows'
down_revision = '0054_add_project_due_date_history'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('journal_workflows')]
    if 'custom_stages' not in columns:
        op.add_column('journal_workflows', sa.Column('custom_stages', sa.JSON(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('journal_workflows')]
    if 'custom_stages' in columns:
        op.drop_column('journal_workflows', 'custom_stages')
