"""Add updated_at column to project_stylesheets

Revision ID: 0010_add_stylesheet_updated_at
Revises: 0009_add_file_uploaded_by
Create Date: 2026-07-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_add_stylesheet_updated_at"
down_revision: Union[str, Sequence[str], None] = "0009_add_file_uploaded_by"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("project_stylesheets")}
    if "updated_at" in cols:
        return
    
    # Add column as nullable first
    op.add_column("project_stylesheets", sa.Column("updated_at", sa.DateTime(), nullable=True))
    
    # Backfill updated_at using created_at
    conn.execute(sa.text("UPDATE project_stylesheets SET updated_at = created_at WHERE updated_at IS NULL"))
    
    # Make column non-nullable
    op.alter_column("project_stylesheets", "updated_at", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("project_stylesheets") as batch:
        batch.drop_column("updated_at")
