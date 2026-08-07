"""Add post_prod_ev_projects table; drop legacy epub_validator_books tables.

Revision ID: 0022_add_ev_projects
Revises: 0021_rename_tables_to_wc_prefix
Create Date: 2026-08-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0022_add_ev_projects"
down_revision: str = "0021_rename_tables_to_wc_prefix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop legacy EPUB Validator tables (FK child first)
    op.drop_table("epub_validator_book_events")
    op.drop_table("epub_validator_books")

    # 2. Create the new project-based table
    op.create_table(
        "post_prod_ev_projects",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client", sa.String(length=255), nullable=False),
        sa.Column("client_code", sa.String(length=100), nullable=True),
        sa.Column("project_name", sa.String(length=255), nullable=False),
        sa.Column("folder_name", sa.String(length=255), nullable=False),
        sa.Column("epub_path", sa.Text(), nullable=False),
        sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="uploaded"),
        sa.Column("validation_status", sa.String(length=50), nullable=True),
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
        op.f("ix_post_prod_ev_projects_folder_name"),
        "post_prod_ev_projects",
        ["folder_name"],
        unique=True,
    )
    op.create_index(
        op.f("ix_post_prod_ev_projects_uploaded_by_id"),
        "post_prod_ev_projects",
        ["uploaded_by_id"],
        unique=False,
    )

    # 3. Create history table
    op.create_table(
        "post_prod_ev_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("post_prod_ev_projects.id", ondelete="CASCADE"),
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
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_post_prod_ev_history_project_id"),
        "post_prod_ev_history",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_post_prod_ev_history_changed_by_id"),
        "post_prod_ev_history",
        ["changed_by_id"],
        unique=False,
    )


def downgrade() -> None:
    # Remove the new table
    op.drop_index(
        op.f("ix_post_prod_ev_projects_uploaded_by_id"),
        table_name="post_prod_ev_projects",
    )
    op.drop_index(
        op.f("ix_post_prod_ev_projects_folder_name"),
        table_name="post_prod_ev_projects",
    )
    op.drop_table("post_prod_ev_projects")

    # Re-create the legacy tables (structure only — data is lost)
    op.create_table(
        "epub_validator_books",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("folder_name", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("customer", sa.String(length=255), nullable=True),
        sa.Column("epub_path", sa.Text(), nullable=False),
        sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="uploaded"),
        sa.Column("validation_status", sa.String(length=50), nullable=True),
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
    op.create_table(
        "epub_validator_book_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "book_id",
            sa.Integer(),
            sa.ForeignKey("epub_validator_books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
