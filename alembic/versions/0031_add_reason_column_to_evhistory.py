"""Add reason column to EvHistory

Revision ID: a2086ff0cafd
Revises: 0030_add_language_edit_tables
Create Date: 2026-09-23 05:29:26.016884

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0031_add_reason_column_to_evhistory'
down_revision: Union[str, Sequence[str], None] = '0030_add_language_edit_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('post_prod_ev_history', sa.Column('reason', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('post_prod_ev_history', 'reason')
