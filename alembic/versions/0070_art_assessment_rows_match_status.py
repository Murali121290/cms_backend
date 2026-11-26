"""Add match_status column to art_assessment_rows.

Revision ID: 0070_art_assessment_match_status
Revises: 0069_art_assessment_rows
Create Date: 2026-11-25 12:00:00.000000

Backs Finalization-Fix F2 (see docs/art-assessment/ART_ASSESSMENT_FINALIZATION.md
§4 G2). ``match_status`` distinguishes rows that originated in the client's
Excel from synthetic "unmatched image" rows appended by the Excel-path
generator so unreferenced images in the Art folder are not silently dropped.

Values are free-text to leave room for future states; today the generator
writes either ``NULL`` (row came from the Excel, or no image lookup was
attempted) or ``"unmatched"`` (row is a synthetic entry for an image file the
parser could not match to any Excel row).

Short revision ID (<=32 chars) because ``alembic_version.version_num`` is
VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0070_art_assessment_match_status"
down_revision: Union[str, Sequence[str], None] = "0069_art_assessment_rows"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessment_rows" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("art_assessment_rows")}
    if "match_status" not in cols:
        op.add_column(
            "art_assessment_rows",
            sa.Column("match_status", sa.String(length=32), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "art_assessment_rows" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("art_assessment_rows")}
    if "match_status" in cols:
        op.drop_column("art_assessment_rows", "match_status")
