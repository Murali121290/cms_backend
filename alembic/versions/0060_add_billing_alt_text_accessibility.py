"""Add billing_type, alt_text, accessibility to projects table

Revision ID: 0060_add_billing_alt_text_accessibility
Revises: 0059_add_language_to_ev_projects
Create Date: 2026-10-31 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0060_add_billing_alt_text_accessibility'
down_revision: Union[str, Sequence[str], None] = '0059_add_language_to_ev_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'billing_type' not in columns:
            op.add_column('projects', sa.Column('billing_type', sa.String(length=50), nullable=True))
        if 'alt_text' not in columns:
            op.add_column('projects', sa.Column('alt_text', sa.String(length=10), nullable=True))
        if 'accessibility' not in columns:
            op.add_column('projects', sa.Column('accessibility', sa.String(length=10), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if 'projects' in tables:
        columns = [c['name'] for c in inspector.get_columns('projects')]
        if 'accessibility' in columns:
            op.drop_column('projects', 'accessibility')
        if 'alt_text' in columns:
            op.drop_column('projects', 'alt_text')
        if 'billing_type' in columns:
            op.drop_column('projects', 'billing_type')

