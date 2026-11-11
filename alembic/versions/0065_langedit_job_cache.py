"""Add cache-key columns + UNIQUE constraint to language_edit_jobs.

Revision ID: 0064_langedit_job_cache
Revises: 0063_add_project_type_to_projects
Create Date: 2026-11-10 00:00:00.000000

Backs the analyze-endpoint cache: looking up an existing completed job
by (file_id, content_hash, rules_hash) short-circuits a redundant
engine pass when the document bytes and the analysis-affecting
configuration haven't changed. The UNIQUE constraint doubles as the
concurrency guard — two parallel analyze calls can't both insert a
singleton row; the second catches IntegrityError and re-queries.

Both columns are nullable so existing rows continue to load without
backfill. Legacy rows (content_hash IS NULL) never satisfy a cache
lookup (NULL-distinct semantics on both SQLite and Postgres), so they
simply trigger a one-time fresh analyze and then populate the cache.

Short revision ID (<=32 chars) because ``alembic_version.version_num``
is VARCHAR(32) in this environment.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0065_langedit_job_cache'
down_revision: Union[str, Sequence[str], None] = '0064_add_bod_cover_and_file_history'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c["name"] for c in inspector.get_columns("language_edit_jobs")}

    if "content_hash" not in cols:
        op.add_column(
            "language_edit_jobs",
            sa.Column("content_hash", sa.String(length=64), nullable=True),
        )
    if "rules_hash" not in cols:
        op.add_column(
            "language_edit_jobs",
            sa.Column("rules_hash", sa.String(length=64), nullable=True),
        )

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("language_edit_jobs")}
    if "ix_language_edit_jobs_cache_lookup" not in existing_indexes:
        op.create_index(
            "ix_language_edit_jobs_cache_lookup",
            "language_edit_jobs",
            ["file_id", "content_hash", "rules_hash"],
        )

    existing_uqs = {uq["name"] for uq in inspector.get_unique_constraints("language_edit_jobs")}
    if "uq_language_edit_jobs_cache_key" not in existing_uqs:
        # Batch mode so SQLite can emit the ALTER TABLE via copy-and-move.
        with op.batch_alter_table("language_edit_jobs") as batch_op:
            batch_op.create_unique_constraint(
                "uq_language_edit_jobs_cache_key",
                ["file_id", "content_hash", "rules_hash"],
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    existing_uqs = {uq["name"] for uq in inspector.get_unique_constraints("language_edit_jobs")}
    if "uq_language_edit_jobs_cache_key" in existing_uqs:
        with op.batch_alter_table("language_edit_jobs") as batch_op:
            batch_op.drop_constraint("uq_language_edit_jobs_cache_key", type_="unique")

    existing_indexes = {ix["name"] for ix in inspector.get_indexes("language_edit_jobs")}
    if "ix_language_edit_jobs_cache_lookup" in existing_indexes:
        op.drop_index("ix_language_edit_jobs_cache_lookup", table_name="language_edit_jobs")

    cols = {c["name"] for c in inspector.get_columns("language_edit_jobs")}
    if "rules_hash" in cols:
        op.drop_column("language_edit_jobs", "rules_hash")
    if "content_hash" in cols:
        op.drop_column("language_edit_jobs", "content_hash")
