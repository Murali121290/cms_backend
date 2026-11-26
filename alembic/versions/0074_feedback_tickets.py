"""Create feedback_tickets table for CRM Support Ticket Management

Revision ID: 0074_feedback_tickets
Revises: 0073_stage_custody
Create Date: 2026-11-25 14:42:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0074_feedback_tickets"
down_revision = "0073_stage_custody"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("feedback_tickets"):
        return

    op.create_table(
        "feedback_tickets",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("ticket_id", sa.String(length=30), nullable=False),
        sa.Column("message_id", sa.Text(), nullable=True),
        sa.Column("references_header", sa.Text(), nullable=True),
        sa.Column("sender_name", sa.String(length=255), nullable=True),
        sa.Column("sender_email", sa.String(length=255), nullable=False),
        sa.Column("employee_id", sa.BigInteger(), nullable=True),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("department", sa.String(length=100), nullable=True),
        sa.Column("priority", sa.String(length=20), server_default="medium", nullable=False),
        sa.Column("status", sa.String(length=30), server_default="new", nullable=False),
        sa.Column("mailbox", sa.String(length=50), server_default="inkflow", nullable=False),
        sa.Column("assigned_to_id", sa.BigInteger(), nullable=True),
        sa.Column("assigned_to_name", sa.String(length=255), nullable=True),
        sa.Column("assigned_by_id", sa.BigInteger(), nullable=True),
        sa.Column("assigned_by_name", sa.String(length=255), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignment_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("messages", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=True),
        sa.Column("attachments", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=True),
        sa.Column("comments", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=True),
        sa.Column("assignments", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=True),
        sa.Column("status_history", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=True),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("ix_feedback_tickets_id", "feedback_tickets", ["id"], unique=False)
    op.create_index("ix_feedback_tickets_ticket_id", "feedback_tickets", ["ticket_id"], unique=True)
    op.create_index("ix_feedback_tickets_message_id", "feedback_tickets", ["message_id"], unique=True)
    op.create_index("ix_feedback_tickets_sender_email", "feedback_tickets", ["sender_email"], unique=False)
    op.create_index("ix_feedback_tickets_status", "feedback_tickets", ["status"], unique=False)
    op.create_index("ix_feedback_tickets_mailbox", "feedback_tickets", ["mailbox"], unique=False)
    op.create_index("ix_feedback_tickets_assigned_to_id", "feedback_tickets", ["assigned_to_id"], unique=False)
    op.create_index("ix_feedback_tickets_created_at", "feedback_tickets", ["created_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("feedback_tickets"):
        op.drop_table("feedback_tickets")
