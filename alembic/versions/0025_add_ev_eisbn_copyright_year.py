"""add_eisbn_and_copyright_year_to_post_prod_ev_projects

Revision ID: 0025_add_ev_eisbn_copyright_year
Revises: 0024_ev_validation_file
Create Date: 2026-08-09 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0025_add_ev_eisbn_copyright_year'
down_revision: Union[str, Sequence[str], None] = '0024_ev_validation_file'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'post_prod_ev_projects',
        sa.Column('eisbn', sa.String(length=100), nullable=True)
    )
    op.add_column(
        'post_prod_ev_projects',
        sa.Column('copyright_year', sa.String(length=50), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('post_prod_ev_projects', 'copyright_year')
    op.drop_column('post_prod_ev_projects', 'eisbn')
