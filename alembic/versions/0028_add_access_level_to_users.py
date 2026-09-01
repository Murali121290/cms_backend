"""Add access_level column to users table

Revision ID: 0028_add_access_level_to_users
Revises: 0027_add_file_mappings_to_ev
Create Date: 2026-09-01 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0028_add_access_level_to_users'
down_revision: Union[str, Sequence[str], None] = '0027_add_file_mappings_to_ev'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('users'):
        cols = {c['name'] for c in inspector.get_columns('users')}
        if 'access_level' not in cols:
            op.add_column('users', sa.Column('access_level', sa.String(length=50), nullable=True, server_default='standard'))


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('users'):
        cols = {c['name'] for c in inspector.get_columns('users')}
        if 'access_level' in cols:
            op.drop_column('users', 'access_level')
