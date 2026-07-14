"""Merge parallel heads 0006_add_file_is_original and 0012_drop_stage_activity_columns

Revision ID: 0013_merge_heads
Revises: 0006_add_file_is_original, 0012_drop_stage_activity_columns
Create Date: 2026-07-14 16:30:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('0006_add_file_is_original', '0012_drop_stage_activity_columns')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
