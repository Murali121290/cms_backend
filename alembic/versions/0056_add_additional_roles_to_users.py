"""add additional_roles and additional_teams to users

Revision ID: 0056_add_additional_roles_to_users
Revises: 0055_add_custom_stages_to_journal_workflows
Create Date: 2026-10-23 18:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '0056_add_additional_roles_to_users'
down_revision = '0055_add_custom_stages_to_journal_workflows'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'additional_roles' not in columns:
        op.add_column('users', sa.Column('additional_roles', postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), 'sqlite'), nullable=False, server_default='[]'))
    if 'additional_teams' not in columns:
        op.add_column('users', sa.Column('additional_teams', postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), 'sqlite'), nullable=False, server_default='[]'))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('users')]
    if 'additional_teams' in columns:
        op.drop_column('users', 'additional_teams')
    if 'additional_roles' in columns:
        op.drop_column('users', 'additional_roles')
