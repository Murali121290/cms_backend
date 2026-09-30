"""Merge the journal production branch (0033-0038) with the post-production XML conversion models

Both branches start from 0032_add_bod_models and touch different tables, so this only joins
the two heads; there is nothing to change in the schema.

Revision ID: 0039_merge_journal_xmlconv
Revises: 0038_journal_file_uploader, 0033_add_xml_conversion_models
Create Date: 2026-10-01 15:00:00.000000
"""
from typing import Sequence, Union

revision: str = '0039_merge_journal_xmlconv'
down_revision: Union[str, Sequence[str], None] = ('0038_journal_file_uploader', '0033_add_xml_conversion_models')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
