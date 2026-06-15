"""remove user_roles table

Revision ID: eaa27de9a9cb
Revises: c92efba16e1f
Create Date: 2026-06-11 14:02:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eaa27de9a9cb'
down_revision: Union[str, Sequence[str], None] = 'c92efba16e1f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop user_roles table
    op.drop_table('user_roles')
    # Drop roles table
    op.drop_table('roles')
    
    # Add role and team columns to users table
    op.add_column('users', sa.Column('role', sa.String(), nullable=True))
    op.add_column('users', sa.Column('team', sa.String(), nullable=True))
    
    # Drop team_id column from users table
    op.drop_column('users', 'team_id')


def downgrade() -> None:
    # Re-add team_id column to users table
    op.add_column('users', sa.Column('team_id', sa.Integer(), nullable=True))
    
    # Drop role and team columns from users table
    op.drop_column('users', 'team')
    op.drop_column('users', 'role')
    
    # Re-create roles table
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_roles_id', 'roles', ['id'], unique=False)
    op.create_index('ix_roles_name', 'roles', ['name'], unique=True)
    
    # Re-create user_roles table
    op.create_table(
        'user_roles',
        sa.Column('user_id', sa.Integer(), primary_key=True),
        sa.Column('role_id', sa.Integer(), primary_key=True)
    )
