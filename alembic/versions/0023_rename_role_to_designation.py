"""rename_role_to_designation

Revision ID: 0023_rename_role_to_designation
Revises: 0022_add_ev_projects
Create Date: 2026-08-06 09:00:32.613776

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0023_rename_role_to_designation'
down_revision: Union[str, Sequence[str], None] = '0022_add_ev_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('users')}

    # 1. Rename column 'role' to 'designation' in 'users' table if 'role' exists and 'designation' doesn't
    if 'role' in cols and 'designation' not in cols:
        op.alter_column('users', 'role', new_column_name='designation')
        cols.remove('role')
        cols.add('designation')

    # 2. Add new 'role' column as nullable String(50) if not exists
    if 'role' not in cols:
        op.add_column('users', sa.Column('role', sa.String(length=50), nullable=True))

    # 3. Copy existing 'admin' / 'Admin' roles to the new 'role' column
    if 'designation' in cols:
        op.execute("UPDATE users SET role = designation WHERE designation ILIKE 'admin'")


def downgrade() -> None:
    # 1. Drop the new 'role' column
    op.drop_column('users', 'role')

    # 2. Rename column 'designation' back to 'role'
    op.alter_column('users', 'designation', new_column_name='role')

