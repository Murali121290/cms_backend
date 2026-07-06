"""Merge parallel 0005 heads

Revision ID: 0006_merge_heads
Revises: 0005_add_file_version_reason, 0005_merge_heads
Create Date: 2026-07-06 11:45:13.524956

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('0005_add_file_version_reason', '0005_merge_heads')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
