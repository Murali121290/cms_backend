"""remove team table

Revision ID: 1103ad94e2cc
Revises: eaa27de9a9cb
Create Date: 2026-06-11 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1103ad94e2cc'
down_revision: Union[str, Sequence[str], None] = 'eaa27de9a9cb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop team_id column from projects table (this will automatically drop foreign key constraints referencing teams)
    op.drop_column('projects', 'team_id')
    
    # Drop teams table
    op.drop_table('teams')
    
    # Add team string column to projects table
    op.add_column('projects', sa.Column('team', sa.String(), nullable=True))


def downgrade() -> None:
    # Re-add team_id column to projects table
    op.add_column('projects', sa.Column('team_id', sa.Integer(), nullable=True))
    
    # Drop team string column from projects table
    op.drop_column('projects', 'team')
    
    # Re-create teams table
    op.create_table(
        'teams',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_teams_id', 'teams', ['id'], unique=False)
    op.create_index('ix_teams_name', 'teams', ['name'], unique=True)
