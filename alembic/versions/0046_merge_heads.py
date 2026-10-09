"""Merge two 0044 heads so alembic has a single head going forward.

Revision ID: 0046_merge_heads
Revises: 0044_add_cli_proj_mgr, 0045_project_language_rules
Create Date: 2026-10-09 00:00:00.000000

The repo picked up two parallel 0044 migrations on main:
  - 0044_add_cli_proj_mgr          (adds projects.client_project_manager)
  - 0044_language_rules_history → 0045_project_language_rules  (Rules Picker)

Both branch from 0043_journal_assign_delay. This is an empty merge revision
so new migrations have a single parent.
"""
from typing import Sequence, Union


revision: str = '0046_merge_heads'
down_revision: Union[str, Sequence[str], None] = ('0044_add_cli_proj_mgr', '0045_project_language_rules')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
