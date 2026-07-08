"""Add processing_error column to files

Revision ID: 0007_add_file_processing_error
Revises: 0006_merge_heads
Create Date: 2026-07-07

Background processing jobs (structuring, PPD, bias scan, etc.) release the
file lock the same way on success and failure, so the status endpoint had
no way to tell a caller a job actually failed — it just looked "completed".
This column stores the last failure message so status endpoints can report
"failed" instead, and is cleared on the next successful run.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_add_file_processing_error"
down_revision: Union[str, Sequence[str], None] = "0006_merge_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("files")}
    if "processing_error" in cols:
        return
    op.add_column("files", sa.Column("processing_error", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("processing_error")
