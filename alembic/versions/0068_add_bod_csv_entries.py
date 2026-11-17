"""Add bod_csv_entries table

Revision ID: 0068_add_bod_csv_entries
Revises: 0067_add_bookmap_details_to_projects
Create Date: 2026-11-17 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0068_add_bod_csv_entries'
down_revision: Union[str, Sequence[str], None] = '0067_add_bookmap_details_to_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_csv_entries' not in tables:
        op.create_table(
            'bod_csv_entries',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('isbn', sa.String(length=100), nullable=True),
            sa.Column('raw_filename', sa.String(length=255), nullable=True),
            sa.Column('source_csv_filename', sa.String(length=255), nullable=True),
            sa.Column('pages', sa.Integer(), nullable=True),
            sa.Column('pdf_type', sa.String(length=50), nullable=True),
            sa.Column('language', sa.String(length=50), nullable=True),
            sa.Column('extra_data', sa.JSON(), nullable=True),
            sa.Column('matched_job_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_bod_csv_entries_isbn'), 'bod_csv_entries', ['isbn'], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'bod_csv_entries' in tables:
        op.drop_index(op.f('ix_bod_csv_entries_isbn'), table_name='bod_csv_entries')
        op.drop_table('bod_csv_entries')

