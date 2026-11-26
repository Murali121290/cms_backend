"""Create art_assessment_rows table.

Revision ID: 0069_art_assessment_rows
Revises: 0068_art_assessments_table
Create Date: 2026-11-25 10:00:01.000000

One row per figure within an :class:`ArtAssessment`. Each canonical column in
``ALIAS_REGISTRY`` becomes its own nullable text column so the review UI can
filter / sort without unpacking JSON. Unmapped client columns survive in
``extras_json``. Image-derived enrichment lives in ``image_meta_json`` and is
populated by Phase 4 — Phase 2 only creates the schema.

Short revision ID (<=32 chars) because ``alembic_version.version_num`` is
VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0069_art_assessment_rows"
down_revision: Union[str, Sequence[str], None] = "0068_art_assessments_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _jsonb() -> sa.types.TypeEngine:
    """JSONB on PostgreSQL, JSON elsewhere. See 0068 for rationale."""
    return sa.JSON().with_variant(
        __import__("sqlalchemy.dialects.postgresql", fromlist=["JSONB"]).JSONB(),
        "postgresql",
    )


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessment_rows" in set(inspector.get_table_names()):
        return

    op.create_table(
        "art_assessment_rows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "assessment_id",
            sa.Integer(),
            sa.ForeignKey("art_assessments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("chapter_label", sa.Text(), nullable=True),
        sa.Column("figure_no", sa.Text(), nullable=True),
        sa.Column("art_name", sa.Text(), nullable=True),
        sa.Column("source_status", sa.Text(), nullable=True),
        sa.Column("output_color", sa.Text(), nullable=True),
        sa.Column("classification", sa.Text(), nullable=True),
        sa.Column("editorial_instructions", sa.Text(), nullable=True),
        sa.Column("suggested_sizing", sa.Text(), nullable=True),
        sa.Column("billing_status", sa.Text(), nullable=True),
        sa.Column("complexity", sa.Text(), nullable=True),
        sa.Column("queries", sa.Text(), nullable=True),
        sa.Column("queries_detail", sa.Text(), nullable=True),
        sa.Column("query_replies", sa.Text(), nullable=True),
        sa.Column("batch_no", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("part_no", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("extras_json", _jsonb(), nullable=False),
        sa.Column("image_meta_json", _jsonb(), nullable=True),
        sa.UniqueConstraint(
            "assessment_id",
            "row_index",
            name="uq_art_assessment_rows_assessment_row_index",
        ),
    )

    op.create_index(
        "ix_art_assessment_rows_assessment_id",
        "art_assessment_rows",
        ["assessment_id"],
    )
    op.create_index(
        "ix_art_assessment_rows_figure_no",
        "art_assessment_rows",
        ["figure_no"],
    )
    op.create_index(
        "ix_art_assessment_rows_assessment_figure",
        "art_assessment_rows",
        ["assessment_id", "figure_no"],
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessment_rows" not in set(inspector.get_table_names()):
        return
    for name in (
        "ix_art_assessment_rows_assessment_figure",
        "ix_art_assessment_rows_figure_no",
        "ix_art_assessment_rows_assessment_id",
    ):
        try:
            op.drop_index(name, table_name="art_assessment_rows")
        except Exception:
            pass
    op.drop_table("art_assessment_rows")
