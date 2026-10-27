"""add revision to chapter_details

Revision ID: 0057_add_revision_to_chapter_details
Revises: 0056_add_additional_roles_to_users
Create Date: 2026-10-26 15:03:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0057_add_revision_to_chapter_details'
down_revision = '0056_add_additional_roles_to_users'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('chapter_details')]
    if 'revision' not in columns:
        op.add_column(
            'chapter_details',
            sa.Column('revision', sa.Integer(), nullable=False, server_default='1')
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('chapter_details')]
    if 'revision' in columns:
        op.drop_column('chapter_details', 'revision')
