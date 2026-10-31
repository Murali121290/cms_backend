"""Add dash_profile to project_language_rules; alt_suggestions to language_edit_findings.

Revision ID: 0052_dash_profile_alt_sug
Revises: 0051_merge_heads
Create Date: 2026-10-29 00:00:00.000000

Short revision ID (≤32 chars) because `alembic_version.version_num` is
VARCHAR(32) in this environment and a longer id can't be stamped.

Phase 1 of the Hyphen & En-Dash workbook integration. Both columns are
nullable so existing rows are untouched; the service layer applies the
default "all" when a project has no dash_profile recorded.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0052_dash_profile_alt_sug'
down_revision: Union[str, Sequence[str], None] = '0051_merge_heads'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # project_language_rules.dash_profile — orthogonal to the existing
    # profile_key / profile_keys (the dash workbook has its own set of
    # style profiles that don't map onto the UK/US/AMA axis).
    cols = {c["name"] for c in inspector.get_columns("project_language_rules")}
    if "dash_profile" not in cols:
        op.add_column(
            "project_language_rules",
            sa.Column("dash_profile", sa.String(length=32), nullable=True),
        )

    # language_edit_findings.alt_suggestions — alternate replacement strings
    # offered by the dash-rules workbook (Suggestion 2 / 3). The primary
    # suggestion stays in the existing `suggestion` column so no existing
    # reader has to change.
    cols = {c["name"] for c in inspector.get_columns("language_edit_findings")}
    if "alt_suggestions" not in cols:
        op.add_column(
            "language_edit_findings",
            sa.Column("alt_suggestions", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    cols = {c["name"] for c in inspector.get_columns("language_edit_findings")}
    if "alt_suggestions" in cols:
        op.drop_column("language_edit_findings", "alt_suggestions")

    cols = {c["name"] for c in inspector.get_columns("project_language_rules")}
    if "dash_profile" in cols:
        op.drop_column("project_language_rules", "dash_profile")
