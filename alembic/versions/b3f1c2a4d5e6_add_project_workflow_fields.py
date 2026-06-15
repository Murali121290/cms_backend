"""Add project workflow fields

Revision ID: b3f1c2a4d5e6
Revises: 127c25073531
Create Date: 2026-05-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'b3f1c2a4d5e6'
down_revision: Union[str, Sequence[str], None] = '127c25073531'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = inspect(conn)
    projects_columns = {col['name'] for col in inspector.get_columns('projects')}

    if 'workflow_name' not in projects_columns:
        op.add_column('projects', sa.Column('workflow_name', sa.String(), nullable=True))
    if 'workflow_stage_no' not in projects_columns:
        op.add_column('projects', sa.Column('workflow_stage_no', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('projects', 'workflow_stage_no')
    op.drop_column('projects', 'workflow_name')
