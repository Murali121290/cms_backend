"""Add project_language_rules table — DB-first storage for the per-project Rules Picker selection.

Revision ID: 0047_project_language_rules
Revises: 0044_language_rules_history
Create Date: 2026-10-06 07:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0047_project_language_rules'
down_revision: Union[str, Sequence[str], None] = '0046_language_rules_history'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'project_language_rules' not in tables:
        op.create_table(
            'project_language_rules',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('project_id', sa.Integer(),
                      sa.ForeignKey('projects.id', ondelete='CASCADE'),
                      nullable=False, unique=True, index=True),
            sa.Column('profile_key', sa.String(length=64), nullable=False, server_default='uk'),
            sa.Column('rules', sa.JSON(), nullable=False),
            sa.Column('variant_to_canonical', sa.JSON(), nullable=True),
            sa.Column('name', sa.String(length=255), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('updated_by_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True, index=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    if 'project_language_rules' in tables:
        op.drop_table('project_language_rules')
