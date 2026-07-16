"""Add is_deleted to post_prod_projects

Revision ID: 0014_add_is_deleted
Revises: 0013_merge_heads
Create Date: 2026-07-15 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014_add_is_deleted'
down_revision: Union[str, Sequence[str], None] = '0013_merge_heads'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from sqlalchemy.engine.reflection import Inspector

def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [col['name'] for col in inspector.get_columns('post_prod_projects')]
    if 'is_deleted' not in columns:
        op.add_column('post_prod_projects', sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('post_prod_projects', 'is_deleted')
