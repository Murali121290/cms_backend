"""Add epub_validator_books and epub_validator_book_events

Revision ID: 0020_add_epub_validator_books
Revises: 0019_add_is_deleted_to_projects
Create Date: 2026-07-29 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "0020_add_epub_validator_books"
down_revision: Union[str, Sequence[str], None] = "0019_add_is_deleted_to_projects"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type(bind) -> sa.types.TypeEngine:
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import JSONB
        return JSONB()
    return sa.JSON()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing = set(inspector.get_table_names())

    if "epub_validator_books" not in existing:
        op.create_table(
            "epub_validator_books",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
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
            sa.Column("uploaded_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index(
            "ix_epub_validator_books_folder_name",
            "epub_validator_books",
            ["folder_name"],
            unique=True,
        )
        op.create_index(
            "ix_epub_validator_books_uploaded_by_id",
            "epub_validator_books",
            ["uploaded_by_id"],
        )

    if "epub_validator_book_events" not in existing:
        op.create_table(
            "epub_validator_book_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
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
            sa.Column("changes", _json_type(bind), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index(
            "ix_epub_validator_book_events_book_id",
            "epub_validator_book_events",
            ["book_id"],
        )
        op.create_index(
            "ix_epub_validator_book_events_user_id",
            "epub_validator_book_events",
            ["user_id"],
        )
        op.create_index(
            "ix_epub_validator_book_events_action",
            "epub_validator_book_events",
            ["action"],
        )
        op.create_index(
            "ix_epub_validator_book_events_created_at",
            "epub_validator_book_events",
            ["created_at"],
        )


def downgrade() -> None:
    op.drop_table("epub_validator_book_events")
    op.drop_table("epub_validator_books")
