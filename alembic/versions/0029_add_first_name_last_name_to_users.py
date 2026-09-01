"""Add first_name and last_name to users table

Revision ID: 0029_add_first_name_last_name
Revises: 0028_add_access_level_to_users
Create Date: 2026-09-01 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0029_add_first_name_last_name'
down_revision: Union[str, Sequence[str], None] = '0028_add_access_level_to_users'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('users'):
        cols = {c['name'] for c in inspector.get_columns('users')}
        if 'first_name' not in cols:
            op.add_column('users', sa.Column('first_name', sa.String(length=100), nullable=True))
        if 'last_name' not in cols:
            op.add_column('users', sa.Column('last_name', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if inspector.has_table('users'):
        cols = {c['name'] for c in inspector.get_columns('users')}
        if 'first_name' in cols:
            op.drop_column('users', 'first_name')
        if 'last_name' in cols:
            op.drop_column('users', 'last_name')
