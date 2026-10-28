"""add fastrack_requested_date to bod_jobs

Revision ID: 0058_add_bod_fastrack_date
Revises: 0057_add_revision_to_chapter_details
Create Date: 2026-10-27 14:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0058_add_bod_fastrack_date'
down_revision = '0057_add_revision_to_chapter_details'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'fastrack_requested_date' not in columns:
            op.add_column(
                'bod_jobs',
                sa.Column('fastrack_requested_date', sa.DateTime(), nullable=True)
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'fastrack_requested_date' in columns:
            op.drop_column('bod_jobs', 'fastrack_requested_date')
