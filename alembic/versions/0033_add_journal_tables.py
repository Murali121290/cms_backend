"""Add journal production tables

Revision ID: 0033_add_journal_tables
Revises: 0032_add_bod_models
Create Date: 2026-09-29 10:00:00.000000

Creates the 8 journal_* tables that were previously only created by
Base.metadata.create_all, plus journal_check_runs and journal_issues for the
validation check engine. Each table is skipped if it already exists.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '0033_add_journal_tables'
down_revision: Union[str, Sequence[str], None] = '0032_add_bod_models'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps():
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    if not inspector.has_table('journal_clients'):
        op.create_table(
            'journal_clients',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('client_code', sa.String(100), nullable=False, unique=True, index=True),
            sa.Column('publisher_name', sa.String(255), nullable=False),
            sa.Column('jats_version', sa.String(50), nullable=False, server_default='1.3'),
            sa.Column('contact_email', sa.String(255), nullable=True),
            sa.Column('website', sa.String(255), nullable=True),
            sa.Column('active_status', sa.Boolean(), nullable=False, server_default=sa.true()),
            *_timestamps(),
        )

    if not inspector.has_table('journals'):
        op.create_table(
            'journals',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('client_id', sa.BigInteger(), sa.ForeignKey('journal_clients.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('journal_code', sa.String(100), nullable=False, unique=True, index=True),
            sa.Column('journal_title', sa.Text(), nullable=False),
            sa.Column('issn_print', sa.String(50), nullable=True),
            sa.Column('issn_online', sa.String(50), nullable=True),
            sa.Column('volume', sa.String(50), nullable=True),
            sa.Column('issue', sa.String(50), nullable=True),
            sa.Column('journal_manager', sa.String(150), sa.ForeignKey('users.username', ondelete='SET NULL', onupdate='CASCADE'), nullable=True),
            sa.Column('status', sa.String(50), nullable=False, server_default='Active'),
            *_timestamps(),
        )

    if not inspector.has_table('journal_articles'):
        op.create_table(
            'journal_articles',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('journal_id', sa.BigInteger(), sa.ForeignKey('journals.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('article_doi', sa.String(255), nullable=True, unique=True, index=True),
            sa.Column('vendor_article_id', sa.String(100), nullable=True, index=True),
            sa.Column('article_title', sa.Text(), nullable=False),
            sa.Column('article_type', sa.String(100), nullable=False, server_default='Research Article'),
            sa.Column('lead_author', sa.String(255), nullable=True),
            sa.Column('corresponding_email', sa.String(255), nullable=True),
            sa.Column('abstract', sa.Text(), nullable=True),
            sa.Column('keywords', sa.JSON(), nullable=True),
            sa.Column('extracted_metadata', sa.JSON(), nullable=True),
            sa.Column('manuscript_pages', sa.Integer(), nullable=True),
            sa.Column('word_count', sa.Integer(), nullable=True),
            sa.Column('current_stage', sa.String(100), nullable=False, server_default='1. Pre-Editing (XHTML)'),
            sa.Column('current_assignee_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('status', sa.String(30), nullable=False, server_default='In-progress'),
            sa.Column('priority', sa.String(30), nullable=False, server_default='Normal'),
            sa.Column('complexity_level', sa.String(30), nullable=False, server_default='Medium'),
            sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
            sa.Column('original_docx_path', sa.String(500), nullable=True),
            sa.Column('xhtml_path', sa.String(500), nullable=True),
            sa.Column('edited_docx_path', sa.String(500), nullable=True),
            sa.Column('jats_xml_path', sa.String(500), nullable=True),
            sa.Column('indesign_path', sa.String(500), nullable=True),
            sa.Column('proof_pdf_path', sa.String(500), nullable=True),
            sa.Column('final_delivery_path', sa.String(500), nullable=True),
            *_timestamps(),
        )

    if not inspector.has_table('journal_stage_details'):
        op.create_table(
            'journal_stage_details',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('article_id', sa.BigInteger(), sa.ForeignKey('journal_articles.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('stage_number', sa.Integer(), nullable=False),
            sa.Column('stage_name', sa.String(100), nullable=False),
            sa.Column('assignee_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('planned_start_date', sa.DateTime(timezone=True), nullable=True),
            sa.Column('planned_end_date', sa.DateTime(timezone=True), nullable=True),
            sa.Column('actual_start_date', sa.DateTime(timezone=True), nullable=True),
            sa.Column('actual_end_date', sa.DateTime(timezone=True), nullable=True),
            sa.Column('sla_hours', sa.Integer(), nullable=True, server_default='24'),
            sa.Column('stage_status', sa.String(30), nullable=False, server_default='Pending'),
            sa.Column('delayed', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('remarks', sa.Text(), nullable=True),
            *_timestamps(),
        )

    if not inspector.has_table('journal_stylesheets'):
        op.create_table(
            'journal_stylesheets',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('journal_id', sa.BigInteger(), sa.ForeignKey('journals.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('style_rules', sa.JSON(), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            *_timestamps(),
        )

    if not inspector.has_table('journal_grammarsheets'):
        op.create_table(
            'journal_grammarsheets',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('journal_id', sa.BigInteger(), sa.ForeignKey('journals.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('language_variant', sa.String(50), nullable=False, server_default='US_English'),
            sa.Column('grammar_rules', sa.JSON(), nullable=False),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
            *_timestamps(),
        )

    if not inspector.has_table('journal_files'):
        op.create_table(
            'journal_files',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('article_id', sa.BigInteger(), sa.ForeignKey('journal_articles.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('filename', sa.String(255), nullable=False),
            sa.Column('file_type', sa.String(50), nullable=False),
            sa.Column('category', sa.String(100), nullable=False),
            sa.Column('path', sa.String(500), nullable=False),
            sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('is_original', sa.Boolean(), nullable=False, server_default=sa.true()),
        )

    if not inspector.has_table('journal_deliveries'):
        op.create_table(
            'journal_deliveries',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('article_id', sa.BigInteger(), sa.ForeignKey('journal_articles.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('package_name', sa.String(255), nullable=False),
            sa.Column('jats_xml_file', sa.String(500), nullable=True),
            sa.Column('pdf_file', sa.String(500), nullable=True),
            sa.Column('indd_file', sa.String(500), nullable=True),
            sa.Column('delivery_channel', sa.String(100), nullable=False, server_default='FTP_UPLOAD'),
            sa.Column('delivery_status', sa.String(50), nullable=False, server_default='Delivered'),
            sa.Column('delivered_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('exported_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    if not inspector.has_table('journal_check_runs'):
        op.create_table(
            'journal_check_runs',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('article_id', sa.BigInteger(), sa.ForeignKey('journal_articles.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('module', sa.String(50), nullable=False, index=True),
            sa.Column('stage_number', sa.Integer(), nullable=False),
            sa.Column('rule_set_version', sa.String(100), nullable=True),
            sa.Column('status', sa.String(30), nullable=False, server_default='Completed'),
            sa.Column('rules_total', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('rules_passed', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('run_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('started_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        )

    if not inspector.has_table('journal_issues'):
        op.create_table(
            'journal_issues',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('article_id', sa.BigInteger(), sa.ForeignKey('journal_articles.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('run_id', sa.BigInteger(), sa.ForeignKey('journal_check_runs.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('module', sa.String(50), nullable=False, index=True),
            sa.Column('rule_id', sa.String(100), nullable=False),
            sa.Column('severity', sa.String(20), nullable=False),
            sa.Column('title', sa.String(255), nullable=False),
            sa.Column('message', sa.Text(), nullable=True),
            sa.Column('location', sa.JSON(), nullable=True),
            sa.Column('context_snippet', sa.Text(), nullable=True),
            sa.Column('suggestion', sa.JSON(), nullable=True),
            sa.Column('fingerprint', sa.String(255), nullable=False, index=True),
            sa.Column('source_issue_id', sa.BigInteger(), sa.ForeignKey('journal_issues.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='open', index=True),
            sa.Column('resolution', sa.String(50), nullable=True),
            sa.Column('resolved_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    for table in (
        'journal_issues', 'journal_check_runs', 'journal_deliveries', 'journal_files',
        'journal_grammarsheets', 'journal_stylesheets', 'journal_stage_details',
        'journal_articles', 'journals', 'journal_clients',
    ):
        if inspector.has_table(table):
            op.drop_table(table)
