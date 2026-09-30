"""Add XML Conversion models

Formerly 0033_add_xml_conversion_models (branched from 0032); renumbered to follow the
journal production migrations so the history is one line again. Safe on databases that ran
the old 0033: existing tables are kept and only the missing status columns are added.

Revision ID: 0040_add_xml_conversion_models
Revises: 0038_journal_file_uploader
Create Date: 2026-09-29 13:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0040_add_xml_conversion_models'
down_revision: Union[str, Sequence[str], None] = '0038_journal_file_uploader'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROJECTS = 'post_prod_xmlConversion_projects'
HISTORY = 'post_prod_xmlConversion_history'
STATUS_COLUMNS = ('s4c_xml_status', 'final_xml_status', 'qc_status')


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if PROJECTS not in tables:
        op.create_table(PROJECTS,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_code', sa.String(), nullable=False),
        sa.Column('project_name', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('assignee', sa.String(), nullable=True),
        sa.Column('target_format', sa.String(), nullable=True),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('filepath', sa.String(), nullable=False),
        sa.Column('conversion_status', sa.String(), nullable=True),
        sa.Column('s4c_xml_status', sa.String(), nullable=True, server_default='YTS'),
        sa.Column('final_xml_status', sa.String(), nullable=True, server_default='YTS'),
        sa.Column('qc_status', sa.String(), nullable=True, server_default='YTS'),
        sa.Column('result_filepath', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_post_prod_xmlConversion_projects_client_code'), PROJECTS, ['client_code'], unique=False)
        op.create_index(op.f('ix_post_prod_xmlConversion_projects_id'), PROJECTS, ['id'], unique=False)
        op.create_index(op.f('ix_post_prod_xmlConversion_projects_project_name'), PROJECTS, ['project_name'], unique=False)
    else:
        # Created by the old 0033, which left out the status columns.
        existing = {c['name'] for c in sa.inspect(op.get_bind()).get_columns(PROJECTS)}
        for name in STATUS_COLUMNS:
            if name not in existing:
                op.add_column(PROJECTS, sa.Column(name, sa.String(), nullable=True, server_default='YTS'))

    if HISTORY not in tables:
        op.create_table(HISTORY,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['post_prod_xmlConversion_projects.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_post_prod_xmlConversion_history_id'), HISTORY, ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_post_prod_xmlConversion_history_id'), table_name=HISTORY)
    op.drop_table(HISTORY)
    op.drop_index(op.f('ix_post_prod_xmlConversion_projects_project_name'), table_name=PROJECTS)
    op.drop_index(op.f('ix_post_prod_xmlConversion_projects_id'), table_name=PROJECTS)
    op.drop_index(op.f('ix_post_prod_xmlConversion_projects_client_code'), table_name=PROJECTS)
    op.drop_table(PROJECTS)
