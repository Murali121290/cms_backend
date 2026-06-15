"""add updated_at to roles_master

Revision ID: 4c83115bb7f2
Revises: d58129df83c9
Create Date: 2026-06-11 09:59:30.281754

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '4c83115bb7f2'
down_revision: Union[str, Sequence[str], None] = 'd58129df83c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('roles_master', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('roles_master', 'updated_at')
