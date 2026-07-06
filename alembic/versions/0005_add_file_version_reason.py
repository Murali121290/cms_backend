"""Add reason column to file_versions

Revision ID: 0005_add_file_version_reason
Revises: 0004_add_comments
Create Date: 2026-07-03

Adds a nullable `reason` column so the Image Review & Editor's Replace
action can persist the audit reason a user typed when swapping a file.
The column is nullable so the auto-versioning path used by uploads and
edit-save remains compatible without change.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_add_file_version_reason"
down_revision: Union[str, Sequence[str], None] = "0004_add_comments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("file_versions")}
    if "reason" in cols:
        return
    op.add_column("file_versions", sa.Column("reason", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("file_versions") as batch:
        batch.drop_column("reason")
