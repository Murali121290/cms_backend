"""Add language_edit_jobs and language_edit_findings tables

Revision ID: 0030_add_language_edit_tables
Revises: 0029_add_first_name_last_name
Create Date: 2026-09-21 09:20:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0030_add_language_edit_tables'
down_revision: Union[str, Sequence[str], None] = '0029_add_first_name_last_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if not inspector.has_table('language_edit_jobs'):
        op.create_table(
            'language_edit_jobs',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('job_id', sa.String(), nullable=False, unique=True, index=True),
            sa.Column('file_id', sa.Integer(), sa.ForeignKey('files.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('status', sa.String(), server_default='processing', index=True),
            sa.Column('total_findings', sa.Integer(), server_default='0'),
            sa.Column('accepted_count', sa.Integer(), server_default='0'),
            sa.Column('edited_count', sa.Integer(), server_default='0'),
            sa.Column('rejected_count', sa.Integer(), server_default='0'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
        )

    if not inspector.has_table('language_edit_findings'):
        op.create_table(
            'language_edit_findings',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('job_id', sa.String(), sa.ForeignKey('language_edit_jobs.job_id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('file_id', sa.Integer(), sa.ForeignKey('files.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('para_index', sa.Integer(), nullable=False),
            sa.Column('start_offset', sa.Integer(), nullable=False),
            sa.Column('end_offset', sa.Integer(), nullable=False),
            sa.Column('rule_id', sa.String(), nullable=False),
            sa.Column('category', sa.String(), nullable=False),
            sa.Column('severity', sa.String(), server_default='warning'),
            sa.Column('original_text', sa.Text(), nullable=False),
            sa.Column('suggestion', sa.Text(), nullable=False),
            sa.Column('message', sa.Text(), server_default=''),
            sa.Column('autofixable', sa.Boolean(), server_default='1'),
            sa.Column('status', sa.String(), server_default='pending', index=True),
            sa.Column('edited_text', sa.Text(), nullable=True),
            sa.Column('reviewer', sa.String(), nullable=True),
            sa.Column('decided_at', sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if inspector.has_table('language_edit_findings'):
        op.drop_table('language_edit_findings')
    if inspector.has_table('language_edit_jobs'):
        op.drop_table('language_edit_jobs')
