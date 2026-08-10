"""add_latest_validation_file_remove_validation_result

Revision ID: 0024_ev_validation_file
Revises: 0023_rename_role_to_designation
Create Date: 2026-08-06 14:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = '0024_ev_validation_file'
down_revision: Union[str, Sequence[str], None] = '0023_rename_role_to_designation'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    # 1. Add latest_validation_file to post_prod_ev_projects if not exists
    proj_cols = {c["name"] for c in inspector.get_columns("post_prod_ev_projects")}
    if "latest_validation_file" not in proj_cols:
        op.add_column(
            'post_prod_ev_projects',
            sa.Column('latest_validation_file', sa.String(length=255), nullable=True)
        )

    # 2. Remove validation_result column from post_prod_ev_history if exists
    hist_cols = {c["name"] for c in inspector.get_columns("post_prod_ev_history")}
    if "validation_result" in hist_cols:
        op.drop_column('post_prod_ev_history', 'validation_result')

    # 3. Add result_type to post_prod_ev_history if not exists
    if "result_type" not in hist_cols:
        op.add_column(
            'post_prod_ev_history',
            sa.Column('result_type', sa.String(length=50), nullable=False, server_default="assignee_change")
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)

    # 1. Add validation_result back to post_prod_ev_history if not exists
    hist_cols = {c["name"] for c in inspector.get_columns("post_prod_ev_history")}
    if "validation_result" not in hist_cols:
        op.add_column(
            'post_prod_ev_history',
            sa.Column('validation_result', sa.Text(), nullable=True)
        )

    # 2. Drop latest_validation_file from post_prod_ev_projects if exists
    proj_cols = {c["name"] for c in inspector.get_columns("post_prod_ev_projects")}
    if "latest_validation_file" in proj_cols:
        op.drop_column('post_prod_ev_projects', 'latest_validation_file')

    # 3. Drop result_type from post_prod_ev_history if exists
    if "result_type" in hist_cols:
        op.drop_column('post_prod_ev_history', 'result_type')

