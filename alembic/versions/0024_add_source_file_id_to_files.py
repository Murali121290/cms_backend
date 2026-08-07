"""Add source_file_id to files for derived-artefact nesting

Revision ID: 0024_add_source_file_id_to_files
Revises: 0023_rename_role_to_designation
Create Date: 2026-08-07 11:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine.reflection import Inspector


revision: str = "0024_add_source_file_id_to_files"
down_revision: Union[str, Sequence[str], None] = "0023_rename_role_to_designation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    cols = {c["name"] for c in inspector.get_columns("files")}
    if "source_file_id" not in cols:
        op.add_column(
            "files",
            sa.Column("source_file_id", sa.Integer(), nullable=True),
        )
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("files")}
    if "ix_files_source_file_id" not in existing_indexes:
        op.create_index("ix_files_source_file_id", "files", ["source_file_id"])
    existing_fks = {fk.get("name") for fk in inspector.get_foreign_keys("files")}
    if "fk_files_source_file_id_files" not in existing_fks:
        op.create_foreign_key(
            "fk_files_source_file_id_files",
            source_table="files",
            referent_table="files",
            local_cols=["source_file_id"],
            remote_cols=["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing_fks = {fk.get("name") for fk in inspector.get_foreign_keys("files")}
    if "fk_files_source_file_id_files" in existing_fks:
        op.drop_constraint("fk_files_source_file_id_files", "files", type_="foreignkey")
    existing_indexes = {ix["name"] for ix in inspector.get_indexes("files")}
    if "ix_files_source_file_id" in existing_indexes:
        op.drop_index("ix_files_source_file_id", table_name="files")
    cols = {c["name"] for c in inspector.get_columns("files")}
    if "source_file_id" in cols:
        op.drop_column("files", "source_file_id")
