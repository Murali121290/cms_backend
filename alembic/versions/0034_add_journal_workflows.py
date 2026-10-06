"""Add journal workflows

Revision ID: 0034_add_journal_workflows
Revises: 0033_add_journal_tables
Create Date: 2026-09-29 16:00:00.000000

A journal workflow is a named selection of the 8 journal production stages.
Each journal picks one; its articles get stage rows for those stages only.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0034_add_journal_workflows'
down_revision: Union[str, Sequence[str], None] = '0033_add_journal_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULTS = [
    {"name": "Full production", "stage_numbers": [1, 2, 3, 4, 5, 6, 7, 8], "is_default": True, "is_active": True,
     "description": "Pre-editing, technical and language editing, JATS XML, InDesign typesetting, QC, proof and delivery."},
    {"name": "XML only (no typesetting)", "stage_numbers": [1, 2, 3, 4, 8], "is_default": False, "is_active": True,
     "description": "Edited and delivered as JATS XML; the publisher typesets."},
    {"name": "Fast track (no language edit)", "stage_numbers": [1, 2, 4, 5, 6, 7, 8], "is_default": False, "is_active": True,
     "description": "Skips language editing for articles that arrive copy-edited."},
]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if not inspector.has_table('journal_workflows'):
        table = op.create_table(
            'journal_workflows',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('name', sa.String(150), nullable=False, unique=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('stage_numbers', sa.JSON(), nullable=False),
            sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.bulk_insert(table, DEFAULTS)

    columns = {c['name'] for c in inspector.get_columns('journals')}
    if 'workflow_id' not in columns:
        with op.batch_alter_table('journals') as batch:
            batch.add_column(sa.Column('workflow_id', sa.BigInteger(), nullable=True))
            batch.create_index('ix_journals_workflow_id', ['workflow_id'])
            batch.create_foreign_key('fk_journals_workflow_id', 'journal_workflows', ['workflow_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = {c['name'] for c in inspector.get_columns('journals')}
    if 'workflow_id' in columns:
        with op.batch_alter_table('journals') as batch:
            batch.drop_constraint('fk_journals_workflow_id', type_='foreignkey')
            batch.drop_index('ix_journals_workflow_id')
            batch.drop_column('workflow_id')
    if inspector.has_table('journal_workflows'):
        op.drop_table('journal_workflows')
