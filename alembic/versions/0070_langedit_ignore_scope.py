"""Add ignore_scope column to language_edit_findings.

Revision ID: 0067_langedit_ignore_scope
Revises: 0066_add_eisbn_to_bod_jobs
Create Date: 2026-11-17 00:00:00.000000

Backs the Ignored Terms feature's Ignore Once vs Ignore Always distinction.
NULL on every non-rejected row and on legacy rejections written before this
column existed — those keep the pre-column "once" semantics implicitly. The
decide endpoint writes 'once' or 'always' explicitly when the reviewer picks
Ignore; the restore endpoint clears the column back to NULL.

Short revision ID (<=32 chars) because ``alembic_version.version_num`` is
VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0070_langedit_ignore_scope"
down_revision: Union[str, Sequence[str], None] = "0069_add_bod_hold_support_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("language_edit_findings")}
    if "ignore_scope" not in cols:
        op.add_column(
            "language_edit_findings",
            sa.Column("ignore_scope", sa.String(length=16), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("language_edit_findings")}
    if "ignore_scope" in cols:
        op.drop_column("language_edit_findings", "ignore_scope")
