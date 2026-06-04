"""Add project workflow fields

Revision ID: b3f1c2a4d5e6
Revises: 127c25073531
Create Date: 2026-05-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3f1c2a4d5e6'
down_revision: Union[str, Sequence[str], None] = '127c25073531'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('projects', sa.Column('workflow_type', sa.String(), nullable=True))
    op.add_column('projects', sa.Column('workflow_stage_no', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('projects', 'workflow_stage_no')
    op.drop_column('projects', 'workflow_type')
