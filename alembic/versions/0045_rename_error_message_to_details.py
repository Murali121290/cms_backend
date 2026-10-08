"""Rename error_message to details in WebPdfHistory

Revision ID: 0045_rename_error_msg_to_details
Revises: 0044_add_cli_proj_mgr
Create Date: 2026-10-08 09:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0045_rename_error_msg_to_details'
down_revision: Union[str, Sequence[str], None] = '0044_add_cli_proj_mgr'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'post_prod_web_pdf_history' in tables:
        columns = {c['name'] for c in inspector.get_columns('post_prod_web_pdf_history')}

        # Add details column if it doesn't exist
        if 'details' not in columns:
            op.add_column('post_prod_web_pdf_history', sa.Column('details', sa.JSON, nullable=True))

        # If error_message exists, copy its data to details (as a dict) and then drop it
        if 'error_message' in columns:
            # Copy error_message to details as JSON
            op.execute("""
                UPDATE post_prod_web_pdf_history
                SET details = CASE
                    WHEN error_message IS NOT NULL THEN jsonb_build_object('error', error_message)
                    ELSE NULL
                END
                WHERE details IS NULL AND error_message IS NOT NULL
            """)
            # Drop the old column
            op.drop_column('post_prod_web_pdf_history', 'error_message')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'post_prod_web_pdf_history' in tables:
        columns = {c['name'] for c in inspector.get_columns('post_prod_web_pdf_history')}

        # Recreate error_message column
        if 'error_message' not in columns:
            op.add_column('post_prod_web_pdf_history', sa.Column('error_message', sa.Text, nullable=True))

            # Copy details back to error_message if it contains error key
            op.execute("""
                UPDATE post_prod_web_pdf_history
                SET error_message = details->>'error'
                WHERE details IS NOT NULL AND details ? 'error'
            """)

        # Drop details column
        if 'details' in columns:
            op.drop_column('post_prod_web_pdf_history', 'details')
