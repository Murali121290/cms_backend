"""Merge the Technical Editing stage into Pre-Editing (8 -> 7 stages) and add Pre-Editing step state

Stage 2 "Technical Editing" becomes the Technical step of "1. Pre-Editing"; stages 3-8 move
down one number. Articles sitting in Technical Editing return to Pre-Editing with its first
three steps finished and the Technical step in progress.

Revision ID: 0037_merge_pre_editing
Revises: 0036_add_journal_review_file
Create Date: 2026-10-01 09:00:00.000000
"""
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0037_merge_pre_editing'
down_revision: Union[str, Sequence[str], None] = '0036_add_journal_review_file'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = ["1. Pre-Editing (XHTML)", "2. Technical Editing", "3. Language Editing", "4. XML Conversion",
       "5. Generate InDesign", "6. InDesign Final QC", "7. View Proof", "8. Final Delivery"]
NEW = ["1. Pre-Editing", "2. Language Editing", "3. XML Conversion", "4. Generate InDesign",
       "5. InDesign Final QC", "6. View Proof", "7. Final Delivery"]
STEPS = ("structuring", "references", "ia_rules", "technical")

workflows = sa.table("journal_workflows", sa.column("id", sa.Integer), sa.column("stage_numbers", sa.JSON))
articles = sa.table("journal_articles", sa.column("id", sa.BigInteger), sa.column("current_stage", sa.String))
stages = sa.table("journal_stage_details", sa.column("id", sa.BigInteger), sa.column("article_id", sa.BigInteger),
                  sa.column("stage_number", sa.Integer), sa.column("stage_name", sa.String),
                  sa.column("stage_status", sa.String), sa.column("actual_start_date", sa.DateTime),
                  sa.column("actual_end_date", sa.DateTime), sa.column("step_state", sa.JSON))
runs = sa.table("journal_check_runs", sa.column("id", sa.BigInteger), sa.column("module", sa.String),
                sa.column("stage_number", sa.Integer))


def old_to_new(n: int) -> int:
    return 1 if n <= 2 else n - 1


def new_to_old(n: int) -> int:
    return 1 if n == 1 else n + 1


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'step_state' not in {c['name'] for c in inspector.get_columns('journal_stage_details')}:
        op.add_column('journal_stage_details', sa.Column('step_state', sa.JSON(), nullable=True))

    for wf_id, numbers in bind.execute(sa.select(workflows.c.id, workflows.c.stage_numbers)).fetchall():
        remapped = sorted({old_to_new(int(n)) for n in (numbers or [])})
        bind.execute(workflows.update().where(workflows.c.id == wf_id).values(stage_numbers=remapped))

    now = datetime.now(timezone.utc).isoformat()
    in_technical = {a for a, cs in bind.execute(sa.select(articles.c.id, articles.c.current_stage)).fetchall() if cs == OLD[1]}
    # Articles in Technical Editing: back to Pre-Editing at its Technical step.
    for article_id in in_technical:
        bind.execute(stages.update().where(stages.c.article_id == article_id, stages.c.stage_number == 1).values(
            stage_status="In-progress", actual_end_date=None,
            step_state={**{s: {"status": "finished", "finished_at": now, "migrated": True} for s in STEPS[:3]},
                        "technical": {"status": "in_progress", "migrated": True}}))
    bind.execute(stages.delete().where(stages.c.stage_number == 2))
    for old_n in range(3, 9):
        bind.execute(stages.update().where(stages.c.stage_number == old_n).values(stage_number=old_n - 1, stage_name=NEW[old_n - 2]))
    bind.execute(stages.update().where(stages.c.stage_number == 1).values(stage_name=NEW[0]))

    for i, name in enumerate(OLD):
        bind.execute(articles.update().where(articles.c.current_stage == name).values(current_stage=NEW[old_to_new(i + 1) - 1]))

    bind.execute(runs.update().where(runs.c.module == "technical").values(stage_number=1))
    for old_n in range(3, 9):
        bind.execute(runs.update().where(runs.c.stage_number == old_n, runs.c.module != "technical").values(stage_number=old_n - 1))


def downgrade() -> None:
    bind = op.get_bind()
    for wf_id, numbers in bind.execute(sa.select(workflows.c.id, workflows.c.stage_numbers)).fetchall():
        remapped = sorted({new_to_old(int(n)) for n in (numbers or [])} | {2})
        bind.execute(workflows.update().where(workflows.c.id == wf_id).values(stage_numbers=remapped))

    for new_n in range(7, 1, -1):
        bind.execute(stages.update().where(stages.c.stage_number == new_n).values(stage_number=new_n + 1, stage_name=OLD[new_n]))
    bind.execute(stages.update().where(stages.c.stage_number == 1).values(stage_name=OLD[0]))
    for (article_id,) in bind.execute(sa.select(sa.distinct(stages.c.article_id))).fetchall():
        bind.execute(stages.insert().values(article_id=article_id, stage_number=2, stage_name=OLD[1], stage_status="Completed"))
    for i, name in enumerate(NEW):
        bind.execute(articles.update().where(articles.c.current_stage == name).values(current_stage=OLD[new_to_old(i + 1) - 1]))

    for new_n in range(7, 1, -1):
        bind.execute(runs.update().where(runs.c.stage_number == new_n).values(stage_number=new_n + 1))
    bind.execute(runs.update().where(runs.c.module == "technical").values(stage_number=2))

    op.drop_column('journal_stage_details', 'step_state')
