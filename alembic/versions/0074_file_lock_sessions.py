"""File lock sessions (download-with-lock / editor locks + time tracking)

Adds files.lock_kind / files.active_lock_session_id and the file_lock_sessions table.

Revision ID: 0074_file_lock_sessions
Revises: 0073_stage_custody
Create Date: 2026-11-24 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0074_file_lock_sessions'
down_revision = '0073_stage_custody'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    have = {c["name"] for c in insp.get_columns("files")}
    if "lock_kind" not in have:
        op.add_column("files", sa.Column("lock_kind", sa.String(30), nullable=True))
    if "active_lock_session_id" not in have:
        op.add_column("files", sa.Column("active_lock_session_id", sa.Integer(), nullable=True))

    if "file_lock_sessions" not in insp.get_table_names():  # the app's create_all may already have made it
        op.create_table(
            "file_lock_sessions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("file_id", sa.Integer(), sa.ForeignKey("files.id", ondelete="SET NULL"), nullable=True),
            sa.Column("filename", sa.String(500), nullable=True),
            sa.Column("category", sa.String(100), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("chapter_id", sa.BigInteger(), nullable=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("lock_kind", sa.String(30), nullable=False),
            sa.Column("stage_detail_id", sa.BigInteger(), nullable=True),
            sa.Column("stage_name", sa.String(100), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("duration_seconds", sa.Integer(), nullable=True),
            sa.Column("from_version", sa.Integer(), nullable=True),
            sa.Column("to_version", sa.Integer(), nullable=True),
            sa.Column("end_reason", sa.String(30), nullable=True),
            sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("release_note", sa.Text(), nullable=True),
            sa.Column("editor_ref", sa.String(200), nullable=True),
            sa.Column("clients", sa.JSON(), nullable=True),
        )
        for col in ("id", "file_id", "project_id", "chapter_id", "user_id", "stage_detail_id", "ended_at", "editor_ref"):
            op.create_index(f"ix_file_lock_sessions_{col}", "file_lock_sessions", [col])


def downgrade() -> None:
    op.drop_table("file_lock_sessions")
    op.drop_column("files", "active_lock_session_id")
    op.drop_column("files", "lock_kind")
