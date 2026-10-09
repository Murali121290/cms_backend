"""Add project_language_rules_history for Rules Picker audit trail

Revision ID: 0046_language_rules_history
Revises: 0043_journal_assign_delay
Create Date: 2026-10-06 06:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0046_language_rules_history'
down_revision: Union[str, Sequence[str], None] = '0045_rename_error_msg_to_details'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'project_language_rules_history' not in tables:
        op.create_table(
            'project_language_rules_history',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('changed_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True, index=True),
            sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.func.now(),
                      nullable=False, index=True),
            sa.Column('profile_key', sa.String(length=64), nullable=True),
            sa.Column('enabled_rule_ids', sa.JSON(), nullable=True),
            sa.Column('disabled_rule_ids', sa.JSON(), nullable=True),
            sa.Column('previous_rules', sa.JSON(), nullable=True),
            sa.Column('new_rules', sa.JSON(), nullable=False),
            sa.Column('note', sa.Text(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    if 'project_language_rules_history' in tables:
        op.drop_table('project_language_rules_history')
