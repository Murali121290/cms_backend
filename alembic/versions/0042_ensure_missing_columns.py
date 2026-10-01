"""Ensure missing columns in bod_jobs and xml_conversion tables

Revision ID: 0042_ensure_missing_columns
Revises: 0041_add_web_pdf_projects
Create Date: 2026-10-01 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0042_ensure_missing_columns'
down_revision: Union[str, Sequence[str], None] = '0041_add_web_pdf_projects'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    # 1. bod_jobs missing columns
    if 'bod_jobs' in tables:
        columns = {c['name'] for c in inspector.get_columns('bod_jobs')}
        if 'client_id' in columns:
            try:
                op.drop_constraint('bod_jobs_client_id_fkey', 'bod_jobs', type_='foreignkey')
            except Exception:
                pass
            op.drop_column('bod_jobs', 'client_id')
        if 'ace_report_filepath' not in columns:
            op.add_column('bod_jobs', sa.Column('ace_report_filepath', sa.String(length=1024), nullable=True))
        if 'epubcheck_report_filepath' not in columns:
            op.add_column('bod_jobs', sa.Column('epubcheck_report_filepath', sa.String(length=1024), nullable=True))
        if 'pdf_page_count' not in columns:
            op.add_column('bod_jobs', sa.Column('pdf_page_count', sa.Integer(), nullable=True))
        if 'pdf_type' not in columns:
            op.add_column('bod_jobs', sa.Column('pdf_type', sa.String(length=50), nullable=True))
        if 'pdf_language' not in columns:
            op.add_column('bod_jobs', sa.Column('pdf_language', sa.String(length=50), nullable=True))
        if 'due_date_history' not in columns:
            op.add_column('bod_jobs', sa.Column('due_date_history', sa.JSON(), server_default='[]', nullable=False))

    # 2. post_prod_xmlConversion_projects missing columns
    xml_projects = 'post_prod_xmlConversion_projects'
    if xml_projects in tables:
        columns = {c['name'] for c in inspector.get_columns(xml_projects)}
        if 's4c_xml_status' in columns and 'raw_xml_status' not in columns:
            op.alter_column(xml_projects, 's4c_xml_status', new_column_name='raw_xml_status')
            columns.add('raw_xml_status')
        for name in ('raw_xml_status', 'final_xml_status', 'qc_status'):
            if name not in columns:
                op.add_column(xml_projects, sa.Column(name, sa.String(), nullable=True, server_default='YTS'))
        if 'completed_at' not in columns:
            op.add_column(xml_projects, sa.Column('completed_at', sa.DateTime(), nullable=True))
        if 'due_at' not in columns:
            op.add_column(xml_projects, sa.Column('due_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    pass
