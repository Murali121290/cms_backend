from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.domains.journals.checks.base import CHECK_STAGES, get_check
from app.domains.journals.models import JournalArticle, JournalCheckRun, JournalIssue


class CheckNotImplemented(Exception):
    pass


def stage_number(stage_name: str) -> int:
    try:
        return int(stage_name.split(".", 1)[0])
    except (ValueError, AttributeError):
        return 1


def run_check(db: Session, article: JournalArticle, key: str, user_id: Optional[int] = None) -> JournalCheckRun:
    """Run one check and replace its open issues with the new findings.

    Fixed and ignored issues are kept as history. A new finding whose
    fingerprint matches a previously ignored issue is stored as ignored again.
    """
    check = get_check(key)
    if check is None:
        raise KeyError(key)
    if not check.implemented:
        raise CheckNotImplemented(key)

    run = JournalCheckRun(article_id=article.id, module=key, stage_number=CHECK_STAGES[key], run_by_id=user_id)
    db.add(run)
    db.flush()

    try:
        result = check.run(article, db)
    except Exception as exc:
        run.status = "Failed"
        run.error_message = str(exc)
        run.finished_at = datetime.utcnow()
        db.commit()
        raise

    previous = db.query(JournalIssue).filter(JournalIssue.article_id == article.id, JournalIssue.module == key).all()
    ignored = {i.fingerprint for i in previous if i.status == "ignored"}
    for old in previous:
        if old.status == "open":
            old.status = "superseded"

    by_fingerprint = {}
    for draft in result.issues:
        issue = JournalIssue(
            article_id=article.id, run_id=run.id, module=key,
            rule_id=draft.rule_id, severity=draft.severity, title=draft.title, message=draft.message,
            location=draft.location, context_snippet=draft.context_snippet, suggestion=draft.suggestion,
            fingerprint=draft.fingerprint,
            status="ignored" if draft.fingerprint in ignored and draft.severity != "error" else "open",
            resolution="ignored" if draft.fingerprint in ignored and draft.severity != "error" else None,
        )
        db.add(issue)
        by_fingerprint[draft.fingerprint] = (issue, draft)
    db.flush()

    for issue, draft in by_fingerprint.values():
        if draft.source_issue_id:
            issue.source_issue_id = draft.source_issue_id
        elif draft.source_fingerprint:
            source = db.query(JournalIssue).filter(
                JournalIssue.article_id == article.id,
                JournalIssue.fingerprint == draft.source_fingerprint,
                JournalIssue.status == "open",
            ).first()
            if source:
                issue.source_issue_id = source.id

    run.rules_total = result.rules_total
    run.rules_passed = result.rules_passed
    run.rule_set_version = result.rule_set_version
    run.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


# Output a stage must have produced before the article can leave it.
STAGE_OUTPUTS = {
    1: ("xhtml_path", "Run pre-editing to convert the manuscript to XHTML"),
    3: ("jats_xml_path", "Convert the article to JATS XML"),
    4: ("indesign_path", "Generate the InDesign layout"),
    6: ("proof_pdf_path", "Generate a proof PDF"),
}


def missing_output(article: JournalArticle) -> Optional[str]:
    need = STAGE_OUTPUTS.get(stage_number(article.current_stage))
    if need and not getattr(article, need[0]):
        return need[1]
    return None


def blocking_issues(db: Session, article: JournalArticle) -> List[JournalIssue]:
    """Open errors from checks at or before the article's current stage."""
    current = stage_number(article.current_stage)
    modules = [k for k, s in CHECK_STAGES.items() if s <= current]
    return db.query(JournalIssue).filter(
        JournalIssue.article_id == article.id,
        JournalIssue.module.in_(modules),
        JournalIssue.severity == "error",
        JournalIssue.status == "open",
    ).order_by(JournalIssue.id).all()
