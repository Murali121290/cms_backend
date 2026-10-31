"""Add rule_overrides JSON column to project_language_rules.

Revision ID: 0053_rule_overrides
Revises: 0052_dash_profile_alt_sug
Create Date: 2026-10-30 00:00:00.000000

Scope-C per-project overrides for workbook rules. Sparse map keyed by
rule ID with values ``{"enabled": bool?, "tool_behaviour": str?}``. A
missing key means "use the workbook default". Nullable so existing rows
stay valid; service layer coerces NULL to {} on read.

Short revision ID (<=32 chars) because ``alembic_version.version_num``
is VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0053_rule_overrides'
down_revision: Union[str, Sequence[str], None] = '0052_dash_profile_alt_sug'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("project_language_rules")}
    if "rule_overrides" not in cols:
        op.add_column(
            "project_language_rules",
            sa.Column("rule_overrides", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("project_language_rules")}
    if "rule_overrides" in cols:
        op.drop_column("project_language_rules", "rule_overrides")
