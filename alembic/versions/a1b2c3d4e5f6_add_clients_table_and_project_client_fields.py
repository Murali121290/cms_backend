"""add_clients_table_and_project_client_fields

Revision ID: a1b2c3d4e5f6
Revises: 81589f971b92
Create Date: 2026-06-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '81589f971b92'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create clients table
    op.create_table(
        'clients',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('category_type', sa.String(length=20), nullable=False),
        sa.Column('contact_type', sa.String(length=100), nullable=False),
        sa.Column('first_name', sa.String(length=150), nullable=True),
        sa.Column('surname', sa.String(length=150), nullable=True),
        sa.Column('name_company', sa.String(length=255), nullable=True),
        sa.Column('company', sa.String(length=255), nullable=False),
        sa.Column('division', sa.String(length=150), nullable=False),
        sa.Column('designation', sa.String(length=150), nullable=True),
        sa.Column('department', sa.String(length=150), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('website', sa.String(length=255), nullable=True),
        sa.Column('vendor_number', sa.String(length=100), nullable=True),
        sa.Column('address1', sa.Text(), nullable=True),
        sa.Column('address2', sa.Text(), nullable=True),
        sa.Column('city', sa.String(length=120), nullable=True),
        sa.Column('state', sa.String(length=120), nullable=True),
        sa.Column('country', sa.String(length=120), nullable=True),
        sa.Column('zip_code', sa.String(length=20), nullable=True),
        sa.Column('sub_specialisation', sa.String(length=255), nullable=True),
        sa.Column('working_hours', sa.String(length=100), nullable=True),
        sa.Column('contact_hours', sa.String(length=100), nullable=True),
        sa.Column('phone_main', sa.String(length=50), nullable=True),
        sa.Column('phone_additional', sa.String(length=50), nullable=True),
        sa.Column('active_status', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Add client_id and client_name to projects
    op.add_column('projects', sa.Column('client_id', sa.Integer(), nullable=True))
    op.add_column('projects', sa.Column('client_name', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_projects_client_id',
        'projects', 'clients',
        ['client_id'], ['id'],
        ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_projects_client_id', 'projects', type_='foreignkey')
    op.drop_column('projects', 'client_name')
    op.drop_column('projects', 'client_id')
    op.drop_table('clients')
