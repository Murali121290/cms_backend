"""Rename tables to add wc (word conversion) prefix.

Revision ID: 0021_rename_tables_to_wc_prefix
Revises: 0020_add_epub_validator_books
Create Date: 2026-08-04 15:37:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0021_rename_tables_to_wc_prefix"
down_revision: str = "0020_add_epub_validator_books"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # Rename post_prod_projects to post_prod_wc_projects if old table exists, or create post_prod_wc_projects if needed
    if inspector.has_table('post_prod_projects'):
        op.rename_table('post_prod_projects', 'post_prod_wc_projects')
    elif not inspector.has_table('post_prod_wc_projects'):
        op.create_table(
            'post_prod_wc_projects',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('client', sa.String(255), nullable=False, server_default=''),
            sa.Column('client_code', sa.String(100), nullable=True),
            sa.Column('project_name', sa.String(255), nullable=False),
            sa.Column('status', sa.String(50), nullable=True, server_default='Active'),
            sa.Column('assignee', sa.String(255), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True, server_default=sa.func.now()),
            sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )

    # Rename post_prod_chapters to post_prod_wc_chapters if old table exists, or create post_prod_wc_chapters if needed
    if inspector.has_table('post_prod_chapters'):
        op.rename_table('post_prod_chapters', 'post_prod_wc_chapters')
    elif not inspector.has_table('post_prod_wc_chapters'):
        op.create_table(
            'post_prod_wc_chapters',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('client_code', sa.String(100), nullable=True),
            sa.Column('project_name', sa.String(255), nullable=True),
            sa.Column('chapter_no', sa.String(50), nullable=False),
            sa.Column('status', sa.String(50), nullable=True, server_default='YTS'),
            sa.Column('conversion_status', sa.String(50), nullable=True, server_default='YTS'),
            sa.Column('conversion_started_at', sa.DateTime(), nullable=True),
            sa.Column('conversion_completed_at', sa.DateTime(), nullable=True),
            sa.Column('qc_status', sa.String(50), nullable=True, server_default='YTS'),
            sa.Column('qc_completed_at', sa.DateTime(), nullable=True),
            sa.Column('qc_active_seconds', sa.Integer(), nullable=True, server_default='0'),
            sa.Column('qc_last_started_at', sa.DateTime(), nullable=True),
            sa.Column('source_filename', sa.String(), nullable=True),
            sa.Column('source_file_path', sa.String(), nullable=True),
            sa.Column('converted_file_path', sa.String(), nullable=True),
            sa.Column('error_message', sa.String(), nullable=True),
            sa.Column('size_bytes', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True, server_default=sa.func.now()),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.Column('attempts', sa.Integer(), nullable=True, server_default='0'),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('post_prod_wc_chapters'):
        op.rename_table('post_prod_wc_chapters', 'post_prod_chapters')
    if inspector.has_table('post_prod_wc_projects'):
        op.rename_table('post_prod_wc_projects', 'post_prod_projects')
