"""remove_workflow_stage_no

Revision ID: 4468d2095142
Revises: e06e61806843
Create Date: 2026-06-12 13:38:27.667557

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4468d2095142'
down_revision: Union[str, Sequence[str], None] = 'e06e61806843'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('projects', 'workflow_stage_no')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('projects', sa.Column('workflow_stage_no', sa.String(), nullable=True))
