"""add_latest_validation_file_remove_validation_result

Revision ID: 0024_ev_validation_file
Revises: 0023_rename_role_to_designation
Create Date: 2026-08-06 14:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0024_ev_validation_file'
down_revision: Union[str, Sequence[str], None] = '0023_rename_role_to_designation'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add latest_validation_file to post_prod_ev_projects
    op.add_column(
        'post_prod_ev_projects',
        sa.Column('latest_validation_file', sa.String(length=255), nullable=True)
    )

    # 2. Remove validation_result column from post_prod_ev_history
    op.drop_column('post_prod_ev_history', 'validation_result')


def downgrade() -> None:
    # 1. Add validation_result back to post_prod_ev_history
    op.add_column(
        'post_prod_ev_history',
        sa.Column('validation_result', sa.Text(), nullable=True)
    )

    # 2. Drop latest_validation_file from post_prod_ev_projects
    op.drop_column('post_prod_ev_projects', 'latest_validation_file')
