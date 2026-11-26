"""Create art_assessments table.

Revision ID: 0068_art_assessments_table
Revises: 0067_langedit_ignore_scope
Create Date: 2026-11-25 10:00:00.000000

One row per parsed-or-generated Art Assessment artefact. Backs Phase 2 of the
Art Assessment improvement — see docs/art-assessment/ART_ASSESSMENT_IMPLEMENTATION_PLAN.md
§7.3. The companion ``art_assessment_rows`` table is created in migration 0069.

Short revision ID (<=32 chars) because ``alembic_version.version_num`` is
VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0068_art_assessments_table"
down_revision: Union[str, Sequence[str], None] = "0067_langedit_ignore_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb() -> sa.types.TypeEngine:
    """JSONB on PostgreSQL, JSON elsewhere.

    Re-implemented locally so the migration has no runtime dependency on
    ``app.*`` modules (they may import DB models that reference tables this
    very migration is creating).
    """
    return sa.JSON().with_variant(
        __import__("sqlalchemy.dialects.postgresql", fromlist=["JSONB"]).JSONB(),
        "postgresql",
    )


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessments" in set(inspector.get_table_names()):
        return

    op.create_table(
        "art_assessments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chapter_id",
            sa.Integer(),
            sa.ForeignKey("chapter_details.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_excel_file_id",
            sa.Integer(),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "output_excel_file_id",
            sa.Integer(),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_mode", sa.String(length=16), nullable=False),
        sa.Column("data_sheet_name", sa.Text(), nullable=True),
        sa.Column("header_row_index", sa.Integer(), nullable=True),
        sa.Column("project_info_json", _jsonb(), nullable=False),
        sa.Column("canonical_columns_json", _jsonb(), nullable=False),
        sa.Column("unmapped_columns_json", _jsonb(), nullable=False),
        sa.Column("warnings_json", _jsonb(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_art_assessments_project_id", "art_assessments", ["project_id"]
    )
    op.create_index(
        "ix_art_assessments_chapter_id", "art_assessments", ["chapter_id"]
    )
    op.create_index(
        "ix_art_assessments_source_excel_file_id",
        "art_assessments",
        ["source_excel_file_id"],
    )
    op.create_index(
        "ix_art_assessments_output_excel_file_id",
        "art_assessments",
        ["output_excel_file_id"],
    )
    op.create_index(
        "ix_art_assessments_created_by_id", "art_assessments", ["created_by_id"]
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessments" not in set(inspector.get_table_names()):
        return
    for name in (
        "ix_art_assessments_created_by_id",
        "ix_art_assessments_output_excel_file_id",
        "ix_art_assessments_source_excel_file_id",
        "ix_art_assessments_chapter_id",
        "ix_art_assessments_project_id",
    ):
        try:
            op.drop_index(name, table_name="art_assessments")
        except Exception:
            pass
    op.drop_table("art_assessments")
