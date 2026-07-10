"""Add is_original flag to files

Revision ID: 0006_add_file_is_original
Revises: 0005_add_file_version_reason
Create Date: 2026-07-10

Distinguishes uploaded source files from ones produced by the convert
endpoint, the processing pipeline, or the edit-save fallback. Drives the
"Original" vs "Converted" badge in the Image Review UI. Existing rows
default to True — we don't retroactively know which historical rows
were derived, so they keep the Original label they already show.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_add_file_is_original"
down_revision: Union[str, Sequence[str], None] = "0005_add_file_version_reason"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("files")}
    if "is_original" in cols:
        return
    op.add_column(
        "files",
        sa.Column(
            "is_original",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("is_original")
