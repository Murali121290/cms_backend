"""Add uploaded_by_id column to files

Revision ID: 0009_add_file_uploaded_by
Revises: 0007_add_file_processing_error
Create Date: 2026-07-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009_add_file_uploaded_by"
down_revision: Union[str, Sequence[str], None] = "0007_add_file_processing_error"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("files")}
    if "uploaded_by_id" in cols:
        return
    op.add_column("files", sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch:
        batch.drop_column("uploaded_by_id")
