"""Update post production schema to rename client columns and map relationships by name

Revision ID: 0008_update_post_prod_schema
Revises: 0007_add_file_processing_error
Create Date: 2026-07-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_update_post_prod_schema"
down_revision: Union[str, Sequence[str], None] = "0007_add_file_processing_error"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # 1. Update post_prod_projects
    if inspector.has_table("post_prod_projects"):
        project_cols = {c["name"] for c in inspector.get_columns("post_prod_projects")}
        
        if "customer_name" in project_cols and "client" not in project_cols:
            op.rename_column("post_prod_projects", "customer_name", "client")
        elif "client" not in project_cols:
            op.add_column("post_prod_projects", sa.Column("client", sa.String(255), nullable=False, server_default=""))
            
        if "client_code" not in project_cols:
            op.add_column("post_prod_projects", sa.Column("client_code", sa.String(100), nullable=True))

    # 2. Update post_prod_chapters
    if inspector.has_table("post_prod_chapters"):
        chapter_cols = {c["name"] for c in inspector.get_columns("post_prod_chapters")}
        
        if "project_id" in chapter_cols:
            # Drop foreign key constraint
            try:
                op.drop_constraint("post_prod_chapters_project_id_fkey", "post_prod_chapters", type_="foreignkey")
            except Exception:
                pass
            op.drop_column("post_prod_chapters", "project_id")
            
        if "client_code" not in chapter_cols:
            op.add_column("post_prod_chapters", sa.Column("client_code", sa.String(100), nullable=True))
            
        if "project_name" not in chapter_cols:
            op.add_column("post_prod_chapters", sa.Column("project_name", sa.String(255), nullable=True))


def downgrade() -> None:
    pass
