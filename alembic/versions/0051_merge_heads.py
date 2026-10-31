"""Merge the two 0047/0050 heads so new migrations have a single parent.

Revision ID: 0051_merge_heads
Revises: 0047_term_lists, 0050_add_pages_levels_to_stage_master
Create Date: 2026-10-29 00:00:00.000000

After 0046_merge_heads two parallel chains grew on main:
  - 0046_language_rules_history → 0047_project_language_rules → 0048 → 0049 → 0050
  - 0046_merge_heads             → 0047_term_lists

Both ultimately needed by anything new. This is an empty merge revision.
"""
from typing import Sequence, Union


revision: str = '0051_merge_heads'
down_revision: Union[str, Sequence[str], None] = (
    '0047_term_lists',
    '0050_add_pages_levels_to_stage_master',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
