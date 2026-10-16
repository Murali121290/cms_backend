"""Add processing_actions column to stage_master table and seed default mappings.

Revision ID: 0049_stage_processing_actions
Revises: 0048_stage_details_history
Create Date: 2026-10-14 17:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY


revision: str = '0049_stage_processing_actions'
down_revision: Union[str, Sequence[str], None] = '0048_stage_details_history'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default initial mappings to seed
DEFAULT_STAGE_ACTIONS = {
    'Pre-editing': [
        'structuring', 'structuringQa', 'referenceValidation', 'referenceReview',
        'styleValidation', 'artValidation', 'languageEdit', 'unifiedReview'
    ],
    'Copyediting': [
        'languageEdit', 'technicalEdit', 'unifiedReview'
    ],
    'Technical Editing': [
        'languageEdit', 'technicalEdit', 'unifiedReview'
    ],
    'Manuscript Analysis': [
        'manuscriptAnalysis', 'styleValidation', 'artValidation'
    ],
    'Digital Processing': [
        'permissionsCheck', 'aiCreditExtraction', 'biasScan'
    ],
    'XML Conversion': [
        'styleValidation', 'artValidation', 'wordToXml', 'wordToIndesign',
        'xmlToIndesign', 'indesignToXml', 'viewProof'
    ],
    'Non-XML Processing': [
        'styleValidation', 'artValidation', 'wordToXml', 'wordToIndesign',
        'xmlToIndesign', 'indesignToXml', 'viewProof'
    ],
    'Typesetting': [
        'wordToXml', 'wordToIndesign', 'xmlToIndesign', 'indesignToXml', 'viewProof'
    ],
    'Proofreading': [
        'wordToXml', 'wordToIndesign', 'xmlToIndesign', 'indesignToXml', 'viewProof'
    ],
}


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stage_master')}
    if 'processing_actions' not in cols:
        op.add_column(
            'stage_master',
            sa.Column('processing_actions', ARRAY(sa.String()), nullable=False, server_default='{}')
        )

    # Seed initial mappings for existing stages
    for stage_name, actions in DEFAULT_STAGE_ACTIONS.items():
        actions_literal = "{" + ",".join(f'"{a}"' for a in actions) + "}"
        conn.execute(
            sa.text(
                "UPDATE stage_master SET processing_actions = :actions "
                "WHERE LOWER(stage_name) = LOWER(:stage_name) AND (processing_actions IS NULL OR processing_actions = '{}')"
            ),
            {"actions": actions_literal, "stage_name": stage_name}
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = {c['name'] for c in inspector.get_columns('stage_master')}
    if 'processing_actions' in cols:
        op.drop_column('stage_master', 'processing_actions')
