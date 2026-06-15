"""align user schema

Revision ID: d58129df83c9
Revises: 1103ad94e2cc
Create Date: 2026-06-11 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd58129df83c9'
down_revision: Union[str, Sequence[str], None] = '1103ad94e2cc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename is_active to active_status
    op.alter_column('users', 'is_active', new_column_name='active_status')
    
    # Convert customer_access column type from VARCHAR[] to JSONB in PostgreSQL
    # If SQLite (during tests), it will be handled as JSON/TEXT
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        op.execute("ALTER TABLE users ALTER COLUMN customer_access TYPE JSONB USING array_to_json(customer_access)::jsonb")
        op.execute("ALTER TABLE users ALTER COLUMN customer_access SET NOT NULL")
        op.execute("ALTER TABLE users ALTER COLUMN customer_access SET DEFAULT '[]'::jsonb")
    else:
        # SQLite fallback
        op.alter_column('users', 'customer_access', type_=sa.JSON(), nullable=False, server_default='[]')

    # Add created_at and updated_at timestamp columns
    op.add_column('users', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.add_column('users', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade() -> None:
    # Remove columns created_at and updated_at
    op.drop_column('users', 'updated_at')
    op.drop_column('users', 'created_at')
    
    # Revert customer_access back to VARCHAR[]
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        op.execute("ALTER TABLE users ALTER COLUMN customer_access TYPE VARCHAR[] USING ARRAY(SELECT jsonb_array_elements_text(customer_access))")
        op.execute("ALTER TABLE users ALTER COLUMN customer_access DROP NOT NULL")
        op.execute("ALTER TABLE users ALTER COLUMN customer_access DROP DEFAULT")
    else:
        op.alter_column('users', 'customer_access', type_=sa.JSON(), nullable=True)
        
    # Rename active_status back to is_active
    op.alter_column('users', 'active_status', new_column_name='is_active')
