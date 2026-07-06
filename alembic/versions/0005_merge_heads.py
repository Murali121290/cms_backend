"""Merge parallel 0004 heads

Revision ID: 0005_merge_heads
Revises: 0004_add_comments, 0004_remove_project_team
Create Date: 2026-06-25
"""
from typing import Sequence, Union

revision: str = '0005_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('0004_add_comments', '0004_remove_project_team')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
