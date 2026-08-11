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
    
    # Rename post_prod_projects to post_prod_wc_projects if table exists
    if inspector.has_table('post_prod_projects'):
        op.rename_table('post_prod_projects', 'post_prod_wc_projects')

    # Rename post_prod_chapters to post_prod_wc_chapters if table exists
    if inspector.has_table('post_prod_chapters'):
        op.rename_table('post_prod_chapters', 'post_prod_wc_chapters')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Rename back to original names if table exists
    if inspector.has_table('post_prod_wc_chapters'):
        op.rename_table('post_prod_wc_chapters', 'post_prod_chapters')
    if inspector.has_table('post_prod_wc_projects'):
        op.rename_table('post_prod_wc_projects', 'post_prod_projects')
