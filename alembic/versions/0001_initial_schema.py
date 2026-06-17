"""Initial schema — consolidated from all previous migrations

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-06-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. roles_master ──────────────────────────────────────────────────────
    op.create_table(
        'roles_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('role_name', sa.String(100), nullable=False),
        sa.Column('team', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('role_name', 'team', name='uq_roles_name_team'),
    )
    op.create_index('ix_roles_master_role_name', 'roles_master', ['role_name'])

    # ── 2. stage_activity_master ─────────────────────────────────────────────
    op.create_table(
        'stage_activity_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('stage_activity_name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stage_activity_name'),
    )
    op.create_index('ix_stage_activity_master_stage_activity_name', 'stage_activity_master', ['stage_activity_name'])

    # ── 3. stage_master ──────────────────────────────────────────────────────
    op.create_table(
        'stage_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('stage_name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('stage_activities', postgresql.ARRAY(sa.BigInteger()), nullable=False, server_default='{}'),
        sa.Column('sla_level1', sa.Integer(), nullable=True),
        sa.Column('sla_level2', sa.Integer(), nullable=True),
        sa.Column('sla_level3', sa.Integer(), nullable=True),
        sa.Column('roles', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stage_name'),
    )
    op.create_index('ix_stage_master_stage_name', 'stage_master', ['stage_name'])

    # ── 4. workflow_master ───────────────────────────────────────────────────
    op.create_table(
        'workflow_master',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('workflow_name', sa.String(255), nullable=False),
        sa.Column('stage_name', sa.String(255), nullable=False),
        sa.Column('previous_stage', sa.String(255), nullable=True),
        sa.Column('next_stage', sa.String(255), nullable=True),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workflow_master_workflow_name', 'workflow_master', ['workflow_name'])

    # ── 5. users ─────────────────────────────────────────────────────────────
    op.create_table(
        'users',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('username', sa.String(150), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=False),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('team', sa.String(50), nullable=False),
        sa.Column('customer_access', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # ── 6. clients ───────────────────────────────────────────────────────────
    op.create_table(
        'clients',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('category_type', sa.String(20), nullable=False),
        sa.Column('contact_type', sa.String(100), nullable=False),
        sa.Column('first_name', sa.String(150), nullable=True),
        sa.Column('surname', sa.String(150), nullable=True),
        sa.Column('name_company', sa.String(255), nullable=True),
        sa.Column('company', sa.String(255), nullable=False),
        sa.Column('division', sa.String(150), nullable=False),
        sa.Column('designation', sa.String(150), nullable=True),
        sa.Column('department', sa.String(150), nullable=True),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('website', sa.String(255), nullable=True),
        sa.Column('vendor_number', sa.String(100), nullable=True),
        sa.Column('address1', sa.Text(), nullable=True),
        sa.Column('address2', sa.Text(), nullable=True),
        sa.Column('city', sa.String(120), nullable=True),
        sa.Column('state', sa.String(120), nullable=True),
        sa.Column('country', sa.String(120), nullable=True),
        sa.Column('zip_code', sa.String(20), nullable=True),
        sa.Column('sub_specialisation', sa.String(255), nullable=True),
        sa.Column('working_hours', sa.String(100), nullable=True),
        sa.Column('contact_hours', sa.String(100), nullable=True),
        sa.Column('phone_main', sa.String(50), nullable=True),
        sa.Column('phone_additional', sa.String(50), nullable=True),
        sa.Column('logo_url', sa.String(500), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── 7. projects ──────────────────────────────────────────────────────────
    op.create_table(
        'projects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('client_id', sa.BigInteger(), nullable=True),
        sa.Column('project_code', sa.String(100), nullable=True),
        sa.Column('client_name', sa.String(), nullable=True),
        sa.Column('xml_standard', sa.String(), nullable=True),
        sa.Column('division_code', sa.String(100), nullable=True),
        sa.Column('customer_contact', sa.String(255), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('composition', sa.String(50), nullable=True),
        sa.Column('workflow_name', sa.String(255), nullable=True),
        sa.Column('status', sa.String(50), nullable=True),
        sa.Column('project_manager', sa.String(150), nullable=True),
        sa.Column('sales_person', sa.String(255), nullable=True),
        sa.Column('priority', sa.String(50), nullable=True),
        sa.Column('project_title', sa.Text(), nullable=True),
        sa.Column('edition', sa.String(50), nullable=True),
        sa.Column('color', sa.String(100), nullable=True),
        sa.Column('trim_size', sa.String(50), nullable=True),
        sa.Column('copyright_year', sa.Integer(), nullable=True),
        sa.Column('manuscript_pages', sa.Integer(), nullable=True),
        sa.Column('estimated_pages', sa.Integer(), nullable=True),
        sa.Column('actual_pages', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('chapter_count', sa.Integer(), nullable=True),
        sa.Column('isbn_no', sa.String(20), nullable=True),
        sa.Column('billing_location', sa.String(255), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('file_details', sa.JSON(), nullable=True),
        sa.Column('team', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], name='fk_projects_client_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_manager'], ['users.username'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_projects_id'), 'projects', ['id'], unique=False)
    op.create_index(op.f('ix_projects_project_code'), 'projects', ['project_code'], unique=True)

    # ── 8. chapter_details ───────────────────────────────────────────────────
    op.create_table(
        'chapter_details',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('client', sa.String(150), nullable=False),
        sa.Column('project', sa.String(200), nullable=False),
        sa.Column('chapters', sa.String(100), nullable=False),
        sa.Column('chapter_title', sa.Text(), nullable=True),
        sa.Column('project_manager_name', sa.String(150), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stage_name', sa.String(100), nullable=True),
        sa.Column('current_stage_activity', sa.String(100), nullable=True),
        sa.Column('current_assignee_name', sa.String(150), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='In-progress'),
        sa.Column('complexity_level', sa.String(20), nullable=True, server_default='Medium'),
        sa.Column('stage_level', sa.Integer(), nullable=True, server_default='1'),
        sa.Column('workflow', sa.Text(), nullable=False, server_default='Workflow1'),
        sa.Column('published_status', sa.String(30), nullable=False, server_default='Draft'),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('manuscript_pages', sa.Integer(), nullable=True),
        sa.Column('priority', sa.String(20), nullable=False, server_default='Normal'),
        sa.Column('delayed_stages', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['project_manager_name'], ['users.username'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['stage_name'], ['stage_master.stage_name'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['current_stage_activity'], ['stage_activity_master.stage_activity_name'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['current_assignee_name'], ['users.username'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── 9. stages_details ────────────────────────────────────────────────────
    op.create_table(
        'stages_details',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('client', sa.String(150), nullable=False),
        sa.Column('project', sa.String(200), nullable=False),
        sa.Column('chapters', sa.String(100), nullable=False),
        sa.Column('project_manager_name', sa.String(150), nullable=True),
        sa.Column('assignee_name', sa.String(150), nullable=True),
        sa.Column('planned_start_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('planned_end_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('actual_start_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('actual_end_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('stage_name', sa.String(100), nullable=False),
        sa.Column('stage_activity', sa.String(100), nullable=True),
        sa.Column('total_time_taken', sa.Float(), nullable=True),
        sa.Column('workflow', sa.Text(), nullable=False, server_default='Workflow1'),
        sa.Column('complexity_level', sa.String(20), nullable=True),
        sa.Column('stage_level', sa.Integer(), nullable=True),
        sa.Column('sla', sa.Integer(), nullable=True),
        sa.Column('stage_status', sa.String(20), nullable=False, server_default='In-progress'),
        sa.Column('stage_activity_status', sa.String(20), nullable=False, server_default='In-progress'),
        sa.Column('delayed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('delay_days', sa.Integer(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['project_manager_name'], ['users.username'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['assignee_name'], ['users.username'], ondelete='SET NULL', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['stage_name'], ['stage_master.stage_name'], ondelete='RESTRICT', onupdate='CASCADE'),
        sa.ForeignKeyConstraint(['stage_activity'], ['stage_activity_master.stage_activity_name'], ondelete='RESTRICT', onupdate='CASCADE'),
        sa.CheckConstraint('planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date', name='ck_stage_detail_planned_end_after_start'),
        sa.CheckConstraint('actual_end_date IS NULL OR actual_start_date IS NULL OR actual_end_date >= actual_start_date', name='ck_stage_detail_actual_end_after_start'),
        sa.CheckConstraint('sla >= 0', name='ck_stage_detail_sla_non_negative'),
        sa.CheckConstraint('stage_level >= 0', name='ck_stage_detail_level_non_negative'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ── 10. files ────────────────────────────────────────────────────────────
    op.create_table(
        'files',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('chapter_id', sa.BigInteger(), nullable=True),
        sa.Column('filename', sa.String(), nullable=True),
        sa.Column('file_type', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('path', sa.String(), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
        sa.Column('version', sa.Integer(), nullable=True),
        sa.Column('is_checked_out', sa.Boolean(), nullable=True),
        sa.Column('checked_out_by_id', sa.Integer(), nullable=True),
        sa.Column('checked_out_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['chapter_id'], ['chapter_details.id'], name='fk_files_chapter_details', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['checked_out_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_files_id'), 'files', ['id'], unique=False)
    op.create_index(op.f('ix_files_filename'), 'files', ['filename'], unique=False)
    op.create_index(op.f('ix_files_project_id'), 'files', ['project_id'], unique=False)
    op.create_index(op.f('ix_files_chapter_id'), 'files', ['chapter_id'], unique=False)
    op.create_index(op.f('ix_files_checked_out_by_id'), 'files', ['checked_out_by_id'], unique=False)

    # ── 11. file_versions ────────────────────────────────────────────────────
    op.create_table(
        'file_versions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('file_id', sa.Integer(), nullable=True),
        sa.Column('version_num', sa.Integer(), nullable=True),
        sa.Column('path', sa.String(), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
        sa.Column('uploaded_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_file_versions_id'), 'file_versions', ['id'], unique=False)
    op.create_index(op.f('ix_file_versions_file_id'), 'file_versions', ['file_id'], unique=False)
    op.create_index(op.f('ix_file_versions_uploaded_by_id'), 'file_versions', ['uploaded_by_id'], unique=False)

    # ── 12. project_stylesheets ──────────────────────────────────────────────
    op.create_table(
        'project_stylesheets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('selected_ia_rows', sa.String(), nullable=False, server_default='[]'),
        sa.Column('analyzed_file_ids', sa.String(), nullable=True, server_default='[]'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_project_stylesheets_id'), 'project_stylesheets', ['id'], unique=False)
    op.create_index(op.f('ix_project_stylesheets_project_id'), 'project_stylesheets', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_stylesheets_created_by_id'), 'project_stylesheets', ['created_by_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_project_stylesheets_created_by_id'), table_name='project_stylesheets')
    op.drop_index(op.f('ix_project_stylesheets_project_id'), table_name='project_stylesheets')
    op.drop_index(op.f('ix_project_stylesheets_id'), table_name='project_stylesheets')
    op.drop_table('project_stylesheets')

    op.drop_index(op.f('ix_file_versions_uploaded_by_id'), table_name='file_versions')
    op.drop_index(op.f('ix_file_versions_file_id'), table_name='file_versions')
    op.drop_index(op.f('ix_file_versions_id'), table_name='file_versions')
    op.drop_table('file_versions')

    op.drop_index(op.f('ix_files_checked_out_by_id'), table_name='files')
    op.drop_index(op.f('ix_files_chapter_id'), table_name='files')
    op.drop_index(op.f('ix_files_project_id'), table_name='files')
    op.drop_index(op.f('ix_files_filename'), table_name='files')
    op.drop_index(op.f('ix_files_id'), table_name='files')
    op.drop_table('files')

    op.drop_table('stages_details')
    op.drop_table('chapter_details')

    op.drop_index(op.f('ix_projects_project_code'), table_name='projects')
    op.drop_index(op.f('ix_projects_id'), table_name='projects')
    op.drop_table('projects')

    op.drop_table('clients')

    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_table('users')

    op.drop_index('ix_workflow_master_workflow_name', table_name='workflow_master')
    op.drop_table('workflow_master')

    op.drop_index('ix_stage_master_stage_name', table_name='stage_master')
    op.drop_table('stage_master')

    op.drop_index('ix_stage_activity_master_stage_activity_name', table_name='stage_activity_master')
    op.drop_table('stage_activity_master')

    op.drop_index('ix_roles_master_role_name', table_name='roles_master')
    op.drop_table('roles_master')