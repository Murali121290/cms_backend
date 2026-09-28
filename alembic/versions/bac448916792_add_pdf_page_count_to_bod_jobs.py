"""add pdf_page_count to bod_jobs

Revision ID: bac448916792
Revises: 0030_add_bod_models
Create Date: 2026-09-25 11:52:49.404713

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'bac448916792'
down_revision: Union[str, Sequence[str], None] = '0030_add_bod_models'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bod_jobs', sa.Column('pdf_page_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('bod_jobs', 'pdf_page_count')
