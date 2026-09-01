"""Add web_pdf_processor tables

Revision ID: 0027_add_web_pdf_projects
Revises: 0026_add_source_file_id_to_files
Create Date: 2026-08-11 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = "0028_add_web_pdf_projects"
down_revision: Union[str, Sequence[str], None] = "0027_add_file_mappings_to_ev"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # 1. Create the new projects table
    if not inspector.has_table("post_prod_web_pdf_projects"):
        op.create_table(
            "post_prod_web_pdf_projects",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("client", sa.String(length=255), nullable=False),
            sa.Column("client_code", sa.String(length=100), nullable=True),
            sa.Column("project_name", sa.String(length=255), nullable=False),
            sa.Column("folder_name", sa.String(length=255), nullable=False),
            sa.Column("pdf_path", sa.Text(), nullable=False),
            sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="Active"),
            sa.Column("validation_status", sa.String(length=50), nullable=True),
            sa.Column("latest_validation_file", sa.String(length=255), nullable=True),
            sa.Column("assignee", sa.String(length=255), nullable=True),
            sa.Column(
                "uploaded_by_id",
                sa.BigInteger(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("uploaded_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_post_prod_web_pdf_projects_folder_name"),
            "post_prod_web_pdf_projects",
            ["folder_name"],
            unique=True,
        )
        op.create_index(
            op.f("ix_post_prod_web_pdf_projects_uploaded_by_id"),
            "post_prod_web_pdf_projects",
            ["uploaded_by_id"],
            unique=False,
        )

    # 2. Create history table
    if not inspector.has_table("post_prod_web_pdf_history"):
        op.create_table(
            "post_prod_web_pdf_history",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column(
                "project_id",
                sa.Integer(),
                sa.ForeignKey("post_prod_web_pdf_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "changed_by_id",
                sa.BigInteger(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("changed_by_username", sa.String(length=255), nullable=True),
            sa.Column("old_assignee", sa.String(length=255), nullable=True),
            sa.Column("new_assignee", sa.String(length=255), nullable=True),
            sa.Column("result_type", sa.String(length=50), nullable=False, server_default="assignee_change"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            op.f("ix_post_prod_web_pdf_history_project_id"),
            "post_prod_web_pdf_history",
            ["project_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_post_prod_web_pdf_history_changed_by_id"),
            "post_prod_web_pdf_history",
            ["changed_by_id"],
            unique=False,
        )

    # 3. Add merge history fields to post_prod_web_pdf_history (idempotent)
    existing_cols = [c["name"] for c in inspector.get_columns("post_prod_web_pdf_history")]
    if "merged_files" not in existing_cols:
        op.add_column("post_prod_web_pdf_history", sa.Column("merged_files", sa.JSON(), nullable=True))
    if "merged_output_path" not in existing_cols:
        op.add_column("post_prod_web_pdf_history", sa.Column("merged_output_path", sa.Text(), nullable=True))
    if "total_pages" not in existing_cols:
        op.add_column("post_prod_web_pdf_history", sa.Column("total_pages", sa.Integer(), nullable=True))
    if "merge_status" not in existing_cols:
        op.add_column("post_prod_web_pdf_history", sa.Column("merge_status", sa.String(length=20), nullable=True))
    if "error_message" not in existing_cols:
        op.add_column("post_prod_web_pdf_history", sa.Column("error_message", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table("post_prod_web_pdf_history"):
        op.drop_table("post_prod_web_pdf_history")

    if inspector.has_table("post_prod_web_pdf_projects"):
        op.drop_table("post_prod_web_pdf_projects")

