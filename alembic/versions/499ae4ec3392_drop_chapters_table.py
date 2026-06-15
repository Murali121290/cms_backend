"""drop_chapters_table

Revision ID: 499ae4ec3392
Revises: 331744b8f961
Create Date: 2026-06-12 11:18:20.116023

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '499ae4ec3392'
down_revision: Union[str, Sequence[str], None] = '331744b8f961'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)

    # 1. Update files.chapter_id to point to chapter_details.id based on project and chapter number
    try:
        op.execute("""
            UPDATE files
            SET chapter_id = cd.id
            FROM chapters c
            JOIN projects p ON c.project_id = p.id
            JOIN chapter_details cd ON cd.project = p.project_code AND cd.chapters = c.number
            WHERE files.chapter_id = c.id
        """)
    except Exception as e:
        print(f"Warning: Failed to migrate files chapter_ids: {e}")

    # 2. Set files.chapter_id to NULL for any IDs that don't exist in chapter_details
    try:
        op.execute("""
            UPDATE files
            SET chapter_id = NULL
            WHERE chapter_id IS NOT NULL AND chapter_id NOT IN (SELECT id FROM chapter_details)
        """)
    except Exception as e:
        print(f"Warning: Failed to clean up orphaned files chapter_ids: {e}")

    # Drop foreign keys on files pointing to chapters
    fkeys = inspector.get_foreign_keys('files')
    for fk in fkeys:
        if fk['referred_table'] == 'chapters':
            op.drop_constraint(fk['name'], 'files', type_='foreignkey')

    # Drop chapters table
    if 'chapters' in inspector.get_table_names():
        op.drop_table('chapters')

    # Change files.chapter_id type to BigInteger
    op.alter_column('files', 'chapter_id',
                    type_=sa.BigInteger(),
                    existing_type=sa.Integer())

    # Create new foreign key pointing to chapter_details
    op.create_foreign_key(
        'fk_files_chapter_details',
        'files', 'chapter_details',
        ['chapter_id'], ['id'],
        ondelete='CASCADE'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'chapters',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('number', sa.String(), nullable=True),
        sa.Column('title', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_chapters_id', 'chapters', ['id'], unique=False)
    op.create_index('ix_chapters_number', 'chapters', ['number'], unique=False)

    conn = op.get_bind()
    from sqlalchemy import inspect
    inspector = inspect(conn)

    # Drop new foreign key
    fkeys = inspector.get_foreign_keys('files')
    for fk in fkeys:
        if fk['referred_table'] == 'chapter_details':
            op.drop_constraint(fk['name'], 'files', type_='foreignkey')

    # Change files.chapter_id type back to Integer
    op.alter_column('files', 'chapter_id',
                    type_=sa.Integer(),
                    existing_type=sa.BigInteger())

    # Create old foreign key pointing to chapters
    op.create_foreign_key(
        'files_chapter_id_fkey',
        'files', 'chapters',
        ['chapter_id'], ['id'],
        ondelete='CASCADE'
    )

