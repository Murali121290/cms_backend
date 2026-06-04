"""Add WMS workflow tables for clients and workflow management

Revision ID: wms_integration_001
Revises: b3f1c2a4d5e6
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'wms_integration_001'
down_revision: Union[str, Sequence[str], None] = 'b3f1c2a4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create clients table
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
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create roles_master table
    op.create_table(
        'roles_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('role_name', sa.String(100), nullable=False),
        sa.Column('team', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('role_name', 'team', name='uq_roles_name_team')
    )
    op.create_index('ix_roles_master_role_name', 'roles_master', ['role_name'])

    # Create stage_activity_master table
    op.create_table(
        'stage_activity_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('stage_activity_name', sa.String(150), nullable=False, unique=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_stage_activity_master_stage_activity_name', 'stage_activity_master', ['stage_activity_name'])

    # Create stage_master table
    op.create_table(
        'stage_master',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('stage_name', sa.String(100), nullable=False, unique=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('stage_activities', postgresql.ARRAY(sa.BigInteger()), nullable=False, server_default='{}'),
        sa.Column('sla_level1', sa.Integer(), nullable=True),
        sa.Column('sla_level2', sa.Integer(), nullable=True),
        sa.Column('sla_level3', sa.Integer(), nullable=True),
        sa.Column('roles', postgresql.ARRAY(sa.String()), nullable=False, server_default='{}'),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_stage_master_stage_name', 'stage_master', ['stage_name'])

    # Create stages_details table
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
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('planned_end_date IS NULL OR planned_start_date IS NULL OR planned_end_date >= planned_start_date', name='ck_stage_detail_planned_end_after_start'),
        sa.CheckConstraint('actual_end_date IS NULL OR actual_start_date IS NULL OR actual_end_date >= actual_start_date', name='ck_stage_detail_actual_end_after_start'),
        sa.CheckConstraint('sla >= 0', name='ck_stage_detail_sla_non_negative'),
        sa.CheckConstraint('stage_level >= 0', name='ck_stage_detail_level_non_negative'),
    )

    # Create workflow_master table
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
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_workflow_master_workflow_name', 'workflow_master', ['workflow_name'])

    # Create chapter_details table
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
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('chapter_details')
    op.drop_index('ix_workflow_master_workflow_name', table_name='workflow_master')
    op.drop_table('workflow_master')
    op.drop_table('stages_details')
    op.drop_index('ix_stage_master_stage_name', table_name='stage_master')
    op.drop_table('stage_master')
    op.drop_index('ix_stage_activity_master_stage_activity_name', table_name='stage_activity_master')
    op.drop_table('stage_activity_master')
    op.drop_index('ix_roles_master_role_name', table_name='roles_master')
    op.drop_table('roles_master')
    op.drop_table('clients')
