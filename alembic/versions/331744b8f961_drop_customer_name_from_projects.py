"""drop_customer_name_from_projects

Revision ID: 331744b8f961
Revises: 4468d2095142
Create Date: 2026-06-12 14:16:12.691595

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '331744b8f961'
down_revision: Union[str, Sequence[str], None] = '4468d2095142'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('projects', 'customer_name')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('projects', sa.Column('customer_name', sa.String(length=255), nullable=True))
