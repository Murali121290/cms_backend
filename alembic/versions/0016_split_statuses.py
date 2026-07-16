"""Add conversion and QC statuses to chapters

Revision ID: 0016_split_statuses
Revises: 0015_add_chapter_size
Create Date: 2026-07-15 12:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0016_split_statuses'
down_revision: Union[str, Sequence[str], None] = '0015_add_chapter_size'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('post_prod_chapters', sa.Column('conversion_status', sa.String(length=50), nullable=True, server_default='YTS'))
    op.add_column('post_prod_chapters', sa.Column('conversion_completed_at', sa.DateTime(), nullable=True))
    op.add_column('post_prod_chapters', sa.Column('qc_status', sa.String(length=50), nullable=True, server_default='YTS'))
    op.add_column('post_prod_chapters', sa.Column('qc_completed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('post_prod_chapters', 'qc_completed_at')
    op.drop_column('post_prod_chapters', 'qc_status')
    op.drop_column('post_prod_chapters', 'conversion_completed_at')
    op.drop_column('post_prod_chapters', 'conversion_status')
