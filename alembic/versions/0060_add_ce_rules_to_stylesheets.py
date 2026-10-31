"""add CE checklist settings to project stylesheets

Revision ID: 0060_add_ce_rules_to_stylesheets
Revises: 0059_add_language_to_ev_projects
Create Date: 2026-10-30 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0060_add_ce_rules_to_stylesheets'
down_revision = '0059_add_language_to_ev_projects'
branch_labels = None
depends_on = None

NEW_COLUMNS = ('ce_rules', 'style_profile')


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'project_stylesheets' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('project_stylesheets')]
        for name in NEW_COLUMNS:
            if name not in columns:
                op.add_column(
                    'project_stylesheets',
                    sa.Column(name, sa.String(), nullable=True, server_default='{}')
                )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'project_stylesheets' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('project_stylesheets')]
        for name in NEW_COLUMNS:
            if name in columns:
                op.drop_column('project_stylesheets', name)
