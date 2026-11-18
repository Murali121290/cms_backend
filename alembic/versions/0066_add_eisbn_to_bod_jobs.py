"""Add eisbn column to bod_jobs table

Revision ID: 0066_add_eisbn_to_bod_jobs
Revises: 0065_langedit_job_cache
Create Date: 2026-11-14 12:50:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0066_add_eisbn_to_bod_jobs'
down_revision: Union[str, Sequence[str], None] = '0065_langedit_job_cache'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'eisbn' not in columns:
            op.add_column('bod_jobs', sa.Column('eisbn', sa.String(length=100), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_jobs' in tables:
        columns = [c['name'] for c in inspector.get_columns('bod_jobs')]
        if 'eisbn' in columns:
            op.drop_column('bod_jobs', 'eisbn')

