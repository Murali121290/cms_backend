"""Add is_deleted to projects

Revision ID: 0019_add_is_deleted_to_projects
Revises: 0018_add_conversion_started_at
Create Date: 2026-07-16 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0019_add_is_deleted_to_projects'
down_revision: Union[str, Sequence[str], None] = '0018_add_conversion_started_at'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


from sqlalchemy.engine.reflection import Inspector

def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [col['name'] for col in inspector.get_columns('projects')]
    if 'is_deleted' not in columns:
        op.add_column('projects', sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('projects', 'is_deleted')
