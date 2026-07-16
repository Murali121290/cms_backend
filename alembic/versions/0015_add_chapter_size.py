"""Add chapter size_bytes to post_prod_chapters

Revision ID: 0015_add_chapter_size
Revises: 0014_add_is_deleted
Create Date: 2026-07-15 11:45:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015_add_chapter_size'
down_revision: Union[str, Sequence[str], None] = '0014_add_is_deleted'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from sqlalchemy.engine.reflection import Inspector

def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [col['name'] for col in inspector.get_columns('post_prod_chapters')]
    if 'size_bytes' not in columns:
        op.add_column('post_prod_chapters', sa.Column('size_bytes', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('post_prod_chapters', 'size_bytes')
