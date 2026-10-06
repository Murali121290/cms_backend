"""Add assignment and delay fields to journal_articles table

Revision ID: 0043_journal_assign_delay
Revises: 0042_ensure_missing_columns
Create Date: 2026-10-03 08:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic. (Must be <= 32 chars for alembic_version table)
revision: str = '0043_journal_assign_delay'
down_revision: Union[str, Sequence[str], None] = '0042_ensure_missing_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'journal_articles' in tables:
        columns = {c['name'] for c in inspector.get_columns('journal_articles')}
        if 'assigned_user_name' not in columns:
            op.add_column('journal_articles', sa.Column('assigned_user_name', sa.String(length=255), nullable=True))
        if 'planned_start_date' not in columns:
            op.add_column('journal_articles', sa.Column('planned_start_date', sa.DateTime(timezone=True), nullable=True))
        if 'planned_end_date' not in columns:
            op.add_column('journal_articles', sa.Column('planned_end_date', sa.DateTime(timezone=True), nullable=True))
        if 'sla_hours' not in columns:
            op.add_column('journal_articles', sa.Column('sla_hours', sa.Integer(), server_default='24', nullable=True))
        if 'assignment_remarks' not in columns:
            op.add_column('journal_articles', sa.Column('assignment_remarks', sa.Text(), nullable=True))
        if 'is_delayed' not in columns:
            op.add_column('journal_articles', sa.Column('is_delayed', sa.Boolean(), server_default=sa.text('false'), nullable=False))
        if 'delay_category' not in columns:
            op.add_column('journal_articles', sa.Column('delay_category', sa.String(length=100), nullable=True))
        if 'delay_reason' not in columns:
            op.add_column('journal_articles', sa.Column('delay_reason', sa.Text(), nullable=True))
        if 'revised_due_date' not in columns:
            op.add_column('journal_articles', sa.Column('revised_due_date', sa.DateTime(timezone=True), nullable=True))
        if 'delay_days' not in columns:
            op.add_column('journal_articles', sa.Column('delay_days', sa.Integer(), server_default='0', nullable=True))
        if 'delay_logged_at' not in columns:
            op.add_column('journal_articles', sa.Column('delay_logged_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'journal_articles' in tables:
        columns = {c['name'] for c in inspector.get_columns('journal_articles')}
        for col in [
            'assigned_user_name', 'planned_start_date', 'planned_end_date', 'sla_hours',
            'assignment_remarks', 'is_delayed', 'delay_category', 'delay_reason',
            'revised_due_date', 'delay_days', 'delay_logged_at'
        ]:
            if col in columns:
                op.drop_column('journal_articles', col)
