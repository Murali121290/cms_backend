"""Add BOD models

Revision ID: 0030_add_bod_models
Revises: 0029_add_first_name_last_name
Create Date: 2026-09-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0030_add_bod_models'
down_revision: Union[str, Sequence[str], None] = '0029_add_first_name_last_name'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('bod_client_configs',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('client_name', sa.String(length=255), nullable=False),
    sa.Column('ftp_host', sa.String(length=255), nullable=False),
    sa.Column('ftp_username', sa.String(length=255), nullable=False),
    sa.Column('ftp_password', sa.String(length=255), nullable=False),
    sa.Column('ftp_base_path', sa.String(length=255), nullable=True, server_default='BOD'),
    sa.Column('manager_email', sa.String(length=255), nullable=False),
    sa.Column('custom_stages', sa.JSON(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('client_name')
    )
    
    op.create_table('bod_jobs',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('pdf_filename', sa.String(length=255), nullable=False),
    sa.Column('pdf_filepath', sa.String(length=1024), nullable=True),
    sa.Column('epub_filename', sa.String(length=255), nullable=True),
    sa.Column('epub_filepath', sa.String(length=1024), nullable=True),
    sa.Column('current_stage_index', sa.Integer(), nullable=False),
    sa.Column('current_stage_name', sa.String(length=255), nullable=False),
    sa.Column('assigned_users', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=50), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('stage_history', sa.JSON(), server_default='{}', nullable=False),
    sa.Column('project_name', sa.String(length=255), nullable=True),
    sa.Column('current_assignee', sa.String(length=255), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['bod_client_configs.id'], ),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('bod_jobs')
    op.drop_table('bod_client_configs')
