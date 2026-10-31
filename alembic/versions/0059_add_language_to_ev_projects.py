"""add language to post_prod_ev_projects

Revision ID: 0059_add_language_to_ev_projects
Revises: 0058_add_bod_fastrack_date
Create Date: 2026-10-28 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0059_add_language_to_ev_projects'
down_revision = '0058_add_bod_fastrack_date'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'post_prod_ev_projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('post_prod_ev_projects')]
        if 'language' not in columns:
            op.add_column(
                'post_prod_ev_projects',
                sa.Column('language', sa.String(length=50), nullable=True)
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'post_prod_ev_projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('post_prod_ev_projects')]
        if 'language' in columns:
            op.drop_column('post_prod_ev_projects', 'language')
