"""Add stage_transition_configs table for persistent database storage.

Revision ID: 0052_add_stage_transition_configs
Revises: 0051_term_lists
Create Date: 2026-10-15 17:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0052_add_stage_transition_configs'
down_revision: Union[str, Sequence[str], None] = '0051_term_lists'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'stage_transition_configs' not in tables:
        op.create_table(
            'stage_transition_configs',
            sa.Column('id', sa.Integer(), nullable=False, autoincrement=True),
            sa.Column('client_code', sa.String(length=100), nullable=False),
            sa.Column('stages_config', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('client_code')
        )
        op.create_index(
            op.f('ix_stage_transition_configs_client_code'),
            'stage_transition_configs',
            ['client_code'],
            unique=True
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'stage_transition_configs' in tables:
        op.drop_index(op.f('ix_stage_transition_configs_client_code'), table_name='stage_transition_configs')
        op.drop_table('stage_transition_configs')
