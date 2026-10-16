"""Term Lists feature — client-specific and generic term lists with per-project assignment.

Revision ID: 0047_term_lists
Revises: 0046_merge_heads
Create Date: 2026-10-09 00:10:00.000000

Adds:
  - term_lists                 — one row per imported Excel / curated list
  - terms                      — individual terms within a list
  - project_term_lists         — many-to-many: projects ↔ term lists
  - language_edit_findings extended with (source, term_list_id) so term matches
    reuse the same findings table as rule findings but are filterable.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0047_term_lists'
down_revision: Union[str, Sequence[str], None] = '0046_merge_heads'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if 'term_lists' not in tables:
        op.create_table(
            'term_lists',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('scope', sa.String(length=32), nullable=False, server_default='client'),  # 'client' | 'generic'
            sa.Column('client_id', sa.BigInteger(),
                      sa.ForeignKey('clients.id', ondelete='SET NULL'),
                      nullable=True, index=True),
            sa.Column('source_file', sa.String(length=255), nullable=True),
            sa.Column('source_file_path', sa.String(length=1024), nullable=True),
            sa.Column('term_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_by_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True, index=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_term_lists_scope', 'term_lists', ['scope'])
        op.create_index('ix_term_lists_name', 'term_lists', ['name'])

    if 'terms' not in tables:
        op.create_table(
            'terms',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('term_list_id', sa.Integer(),
                      sa.ForeignKey('term_lists.id', ondelete='CASCADE'),
                      nullable=False, index=True),
            sa.Column('term', sa.String(length=512), nullable=False),
            sa.Column('term_norm', sa.String(length=512), nullable=False, index=True),  # lowercased for lookup
            sa.Column('group_id', sa.Integer(), nullable=True, index=True),
            sa.Column('order_in_group', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('is_italic', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('is_bold', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint('term_list_id', 'term', name='uq_terms_list_term'),
        )

    if 'project_term_lists' not in tables:
        op.create_table(
            'project_term_lists',
            sa.Column('project_id', sa.Integer(),
                      sa.ForeignKey('projects.id', ondelete='CASCADE'),
                      primary_key=True),
            sa.Column('term_list_id', sa.Integer(),
                      sa.ForeignKey('term_lists.id', ondelete='CASCADE'),
                      primary_key=True),
            sa.Column('assigned_by_id', sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'),
                      nullable=True),
            sa.Column('assigned_at', sa.DateTime(timezone=True),
                      server_default=sa.func.now(), nullable=False),
        )
        op.create_index('ix_project_term_lists_term_list_id', 'project_term_lists', ['term_list_id'])

    # Extend language_edit_findings — a term match is a Finding whose source='term'.
    if 'language_edit_findings' in tables:
        cols = {c['name'] for c in inspector.get_columns('language_edit_findings')}
        if 'source' not in cols:
            op.add_column('language_edit_findings',
                          sa.Column('source', sa.String(length=16), nullable=False, server_default='rule'))
            op.create_index('ix_language_edit_findings_source', 'language_edit_findings', ['source'])
        if 'term_list_id' not in cols:
            op.add_column('language_edit_findings',
                          sa.Column('term_list_id', sa.Integer(),
                                    sa.ForeignKey('term_lists.id', ondelete='SET NULL'),
                                    nullable=True))
            op.create_index('ix_language_edit_findings_term_list_id', 'language_edit_findings', ['term_list_id'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    if 'language_edit_findings' in tables:
        cols = {c['name'] for c in inspector.get_columns('language_edit_findings')}
        if 'term_list_id' in cols:
            op.drop_index('ix_language_edit_findings_term_list_id', table_name='language_edit_findings')
            op.drop_column('language_edit_findings', 'term_list_id')
        if 'source' in cols:
            op.drop_index('ix_language_edit_findings_source', table_name='language_edit_findings')
            op.drop_column('language_edit_findings', 'source')
    if 'project_term_lists' in tables:
        op.drop_table('project_term_lists')
    if 'terms' in tables:
        op.drop_table('terms')
    if 'term_lists' in tables:
        op.drop_table('term_lists')
