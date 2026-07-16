"""Add QC duration columns

Revision ID: 0017_add_qc_duration
Revises: 0016_split_statuses
Create Date: 2026-07-16 03:36:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017_add_qc_duration'
down_revision: Union[str, Sequence[str], None] = '0016_split_statuses'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('post_prod_chapters', sa.Column('qc_active_seconds', sa.Integer(), nullable=True, server_default='0'))
    op.add_column('post_prod_chapters', sa.Column('qc_last_started_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('post_prod_chapters', 'qc_last_started_at')
    op.drop_column('post_prod_chapters', 'qc_active_seconds')
