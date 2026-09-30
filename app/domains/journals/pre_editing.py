"""Pre-Editing (stage 1) as four gated steps: Structuring -> References -> IA rules -> Technical.

A step unlocks only when the step before it is finished. Finishing needs the step's check to
have run with 0 open errors; open warnings must be resolved or accepted in one sign-off.
Structuring starts by itself (on upload, or when the editor opens an article it never ran on).
State lives in the stage-1 row's step_state JSON:

    {"structuring": {"status": "finished", "ran_at": ..., "finished_at": ..., "finished_by": 3}, ...}

Stored statuses are running / failed / in_progress / finished; "locked" and "ready" are derived.
"""
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.domains.journals.checks import run_check
from app.domains.journals.models import JournalArticle, JournalCheckRun, JournalIssue, JournalStageDetail
from app.domains.journals.service import PRE_EDITING

logger = logging.getLogger(__name__)

STEPS: List[Dict[str, str]] = [
    {"key": "structuring", "label": "Structuring", "module": "structuring",
     "description": "Paragraph styles, front matter and headings"},
    {"key": "references", "label": "Reference validation", "module": "references",
     "description": "bib_* and cite_bib styles, citations against the reference list, DOIs"},
    {"key": "ia_rules", "label": "IA rules", "module": "ia_rules",
     "description": "The IA rules selected in Journal settings"},
    {"key": "technical", "label": "Technical checks", "module": "technical",
     "description": "Figure and table callouts, equations, keywords"},
]
STEP_KEYS = [s["key"] for s in STEPS]
RUNNING_STALE_AFTER = timedelta(minutes=10)


class StepError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stage_row(db: Session, article: JournalArticle) -> Optional[JournalStageDetail]:
    return db.query(JournalStageDetail).filter(JournalStageDetail.article_id == article.id,
                                               JournalStageDetail.stage_number == PRE_EDITING).first()


def _state(row: Optional[JournalStageDetail]) -> Dict[str, Dict[str, Any]]:
    return {k: dict(v) for k, v in ((row.step_state if row else None) or {}).items()}


def _save(db: Session, row: JournalStageDetail, state: Dict[str, Dict[str, Any]]) -> None:
    row.step_state = {k: dict(v) for k, v in state.items()}  # a new object, so the JSON change is saved
    db.commit()


def _counts(db: Session, article_id: int, module: str) -> Dict[str, int]:
    out = {"error": 0, "warning": 0, "info": 0}
    for (sev,) in db.query(JournalIssue.severity).filter(JournalIssue.article_id == article_id, JournalIssue.module == module,
                                                         JournalIssue.status == "open").all():
        out[sev] = out.get(sev, 0) + 1
    return out


def _last_run(db: Session, article_id: int, module: str) -> Optional[JournalCheckRun]:
    return db.query(JournalCheckRun).filter(JournalCheckRun.article_id == article_id, JournalCheckRun.module == module) \
        .order_by(JournalCheckRun.id.desc()).first()


def _is_running(st: Dict[str, Any]) -> bool:
    if st.get("status") != "running":
        return False
    try:
        started = datetime.fromisoformat(st.get("started_at"))
    except (TypeError, ValueError):
        return False
    return datetime.now(timezone.utc) - started < RUNNING_STALE_AFTER


def step_status(db: Session, article: JournalArticle) -> Dict[str, Any]:
    """Status of the four steps, the step to work on, and whether the stage can be completed."""
    row = stage_row(db, article)
    state = _state(row)
    steps, previous_finished = [], True
    for i, spec in enumerate(STEPS):
        st = state.get(spec["key"], {})
        run = _last_run(db, article.id, spec["module"])
        ran = bool(st.get("ran_at")) or (run is not None and run.status == "Completed" and st.get("status") != "failed")
        if spec["key"] == "structuring":
            ran = ran and bool(article.xhtml_path)
        counts = _counts(db, article.id, spec["module"])
        finished = st.get("status") == "finished"
        if _is_running(st):
            status = "running"
        elif not previous_finished:
            status = "locked"
        elif finished:
            status = "finished"
        elif st.get("status") == "failed":
            status = "failed"
        elif ran:
            status = "in_progress"
        else:
            status = "ready"
        reason = None
        if status == "in_progress":
            if counts["error"]:
                reason = f"Fix or mark {counts['error']} error{'s' if counts['error'] > 1 else ''} before finishing this step."
            elif counts["warning"]:
                reason = f"{counts['warning']} warning{'s' if counts['warning'] > 1 else ''} still open. Mark them fixed or ignored, or accept them all."
        elif status == "locked":
            reason = f"Finish “{STEPS[i - 1]['label']}” first."
        steps.append({
            **spec, "number": i + 1, "status": status, "was_finished": finished and status == "locked",
            "ran": ran, "ran_at": st.get("ran_at"), "finished_at": st.get("finished_at"), "error": st.get("error"),
            "open": counts, "signed_off": bool(st.get("signed_off")),
            "can_finish": status == "in_progress" and counts["error"] == 0 and counts["warning"] == 0,
            "can_accept_warnings": status == "in_progress" and counts["error"] == 0 and counts["warning"] > 0,
            "blocked_reason": reason,
            "last_run": {"status": run.status, "finished_at": run.finished_at.isoformat() if run and run.finished_at else None,
                         "rules_total": run.rules_total, "rules_passed": run.rules_passed} if run else None,
        })
        previous_finished = previous_finished and finished
    current = next((s["key"] for s in steps if s["status"] != "finished"), None)
    return {"steps": steps, "current_step": current, "all_finished": current is None,
            "applies": article.current_stage.split(".", 1)[0].strip() == str(PRE_EDITING) and article.status != "Completed"}


def _get_step(key: str) -> Dict[str, str]:
    for s in STEPS:
        if s["key"] == key:
            return s
    raise StepError(404, f"Unknown Pre-Editing step “{key}”")


# --- running a step ---------------------------------------------------------------------------------
def _write_xhtml(db: Session, article: JournalArticle) -> int:
    from app.domains.journals.files import save_version
    from app.domains.journals.manuscript import resolve_manuscript_path
    from app.processing.docx_to_xhtml_runs import DocxToXhtmlRunsEngine

    docx_path = resolve_manuscript_path(db, article)
    xhtml = DocxToXhtmlRunsEngine().convert(docx_path)
    row = save_version(db, article, "XHTML", f"{os.path.splitext(os.path.basename(docx_path))[0]}.xhtml", xhtml.encode("utf-8"), "xhtml")
    article.xhtml_path = row.path
    db.commit()
    return row.version


def _structure(db: Session, article: JournalArticle, restructure: bool) -> Dict[str, Any]:
    """Structure the upload into the working copy (first run, or restructure), then write XHTML."""
    from app.domains.journals.checks.structuring import active_stylesheet
    from app.domains.journals.files import article_dir
    from app.domains.journals.manuscript import original_manuscript_path
    from app.domains.journals.structuring import structure_manuscript

    original = original_manuscript_path(db, article)
    if not original:
        raise StepError(400, "No manuscript DOCX is attached to this article. Upload one first.")
    result = None
    if restructure or not article.edited_docx_path or not os.path.exists(article.edited_docx_path):
        sheet = active_stylesheet(db, article)
        tag_set = ((sheet.style_rules if sheet else None) or {}).get("tag_set")
        base = os.path.splitext(os.path.basename(original))[0]
        working = os.path.join(article_dir(article, "edited"), f"{base}_structured.docx")
        try:
            result = structure_manuscript(original, working, tag_set=tag_set)
        except Exception as e:  # noqa: BLE001
            raise StepError(422, f"Could not structure the manuscript: {e}")
        article.edited_docx_path = working
        title = (result.get("front_matter") or {}).get("title")
        if title and (not article.article_title or re.search(r"\bvol\.?\b|\bdoi\b|;\s*\d", article.article_title, re.I)):
            article.article_title = title  # the upload's metadata picked a running head / citation line
        db.commit()
    return {"structuring": result}


def _style_references(db: Session, article: JournalArticle) -> Dict[str, Any]:
    """Local reference structuring on the working copy (bib_* on the list, cite_bib on citations)."""
    from app.domains.journals.checks.structuring import active_stylesheet
    from app.domains.journals.production import apply_local_reference_styles, reference_options

    opts = reference_options(db, article)
    if not (opts["engine"] == "local" and opts["run_structuring"] and article.edited_docx_path
            and os.path.exists(article.edited_docx_path)):
        return {"reference_styling": None}
    sheet = active_stylesheet(db, article)
    rules = ((sheet.style_rules if sheet else None) or {}).get("references") or {}
    return {"reference_styling": apply_local_reference_styles(article.edited_docx_path, rules.get("citation_form", "auto"))}


def run_step(db: Session, article: JournalArticle, key: str, user_id: Optional[int] = None,
             restructure: bool = False, force: bool = False) -> Dict[str, Any]:
    """Run one step. Raises StepError(409) when it is locked or already running (unless force)."""
    spec = _get_step(key)
    current = {s["key"]: s for s in step_status(db, article)["steps"]}[key]
    if current["status"] == "locked" and not force:
        raise StepError(409, current["blocked_reason"])
    if current["status"] == "running" and not force:
        raise StepError(409, f"{spec['label']} is already running")

    row = stage_row(db, article)
    if row is None:
        raise StepError(409, "This article's workflow has no Pre-Editing stage")
    state = _state(row)
    was_finished = state.get(key, {}).get("status") == "finished"
    state[key] = {**state.get(key, {}), "status": "running", "started_at": _now(), "error": None}
    _save(db, row, state)

    out: Dict[str, Any] = {}
    try:
        if key == "structuring":
            out.update(_structure(db, article, restructure))
            out["xhtml_version"] = _write_xhtml(db, article)
        elif key == "references":
            out.update(_style_references(db, article))
            out["xhtml_version"] = _write_xhtml(db, article)
        out["check_run"] = run_check(db, article, spec["module"], user_id)
    except StepError as e:
        _fail(db, article, key, e.message)
        raise
    except Exception as e:  # noqa: BLE001 - report any failure on the step
        logger.exception("Pre-Editing step %s failed for article %s", key, article.id)
        _fail(db, article, key, str(e))
        raise StepError(422, f"{spec['label']} failed: {e}")

    db.refresh(row)
    state = _state(row)
    errors = _counts(db, article.id, spec["module"])["error"]
    # Re-running a finished step keeps it finished while it stays clean.
    status = "finished" if was_finished and errors == 0 else "in_progress"
    state[key] = {**state.get(key, {}), "status": status, "ran_at": _now(), "error": None}
    _save(db, row, state)
    return out


def _fail(db: Session, article: JournalArticle, key: str, message: str) -> None:
    db.rollback()
    row = stage_row(db, article)
    if row is None:
        return
    state = _state(row)
    state[key] = {**state.get(key, {}), "status": "failed", "error": message[:500]}
    _save(db, row, state)


def run_structuring_background(article_id: int, user_id: Optional[int] = None) -> None:
    """Upload hook: structure the manuscript right away so the editor opens on a structured copy."""
    from app import database

    db = database.SessionLocal()
    try:
        article = db.query(JournalArticle).filter(JournalArticle.id == article_id).first()
        if article is None or not stage_row(db, article):
            return
        status = {s["key"]: s for s in step_status(db, article)["steps"]}["structuring"]
        if status["status"] in ("ready", "failed"):
            run_step(db, article, "structuring", user_id)
    except StepError as e:
        logger.warning("Automatic structuring of article %s did not run: %s", article_id, e.message)
    except Exception:  # noqa: BLE001
        logger.exception("Automatic structuring of article %s failed", article_id)
    finally:
        db.close()


# --- finishing / reopening --------------------------------------------------------------------------
def finish_step(db: Session, article: JournalArticle, key: str, user_id: Optional[int] = None,
                accept_warnings: bool = False) -> Dict[str, Any]:
    spec = _get_step(key)
    current = {s["key"]: s for s in step_status(db, article)["steps"]}[key]
    if current["status"] == "finished":
        return step_status(db, article)
    if current["status"] != "in_progress":
        raise StepError(409, current["blocked_reason"] or f"Run {spec['label']} before finishing it")
    if current["open"]["error"]:
        raise StepError(409, current["blocked_reason"])
    if current["open"]["warning"] and not accept_warnings:
        raise StepError(409, current["blocked_reason"])

    now = datetime.utcnow()
    if accept_warnings:
        for issue in db.query(JournalIssue).filter(JournalIssue.article_id == article.id, JournalIssue.module == spec["module"],
                                                   JournalIssue.status == "open", JournalIssue.severity == "warning").all():
            issue.status, issue.resolution = "ignored", "accepted_at_step_signoff"
            issue.resolved_by_id, issue.resolved_at = user_id, now
    row = stage_row(db, article)
    state = _state(row)
    state[key] = {**state.get(key, {}), "status": "finished", "finished_at": _now(), "finished_by": user_id,
                  "signed_off": bool(accept_warnings and current["open"]["warning"])}
    _save(db, row, state)
    return step_status(db, article)


def reopen_step(db: Session, article: JournalArticle, key: str) -> Dict[str, Any]:
    _get_step(key)
    row = stage_row(db, article)
    if row is None:
        raise StepError(409, "This article's workflow has no Pre-Editing stage")
    state = _state(row)
    if state.get(key, {}).get("status") == "finished":
        state[key] = {**state[key], "status": "in_progress", "finished_at": None, "signed_off": False}
        _save(db, row, state)
    return step_status(db, article)


def recheck_after_edit(db: Session, article: JournalArticle, user_id: Optional[int] = None) -> Dict[str, Any]:
    """After an editor save: re-run the check of every step that has run. A finished step that now
    has open errors goes back to in progress (so the steps after it lock again)."""
    row = stage_row(db, article)
    if row is None:
        return {}
    state = _state(row)
    runs, reopened = {}, False
    for spec in STEPS:
        st = state.get(spec["key"], {})
        if not (st.get("ran_at") or st.get("status") in ("in_progress", "finished")):
            continue
        try:
            runs[spec["key"]] = run_check(db, article, spec["module"], user_id)
        except Exception as e:  # noqa: BLE001
            runs[spec["key"]] = e
            continue
        if st.get("status") == "finished" and _counts(db, article.id, spec["module"])["error"]:
            state[spec["key"]] = {**st, "status": "in_progress", "finished_at": None, "reopened_at": _now(), "signed_off": False}
            reopened = True
    if reopened:
        _save(db, row, state)
    return runs


def unfinished_step(db: Session, article: JournalArticle) -> Optional[Dict[str, Any]]:
    """The first Pre-Editing step that is not finished, or None (used by advance-stage)."""
    if stage_row(db, article) is None:
        return None
    return next((s for s in step_status(db, article)["steps"] if s["status"] != "finished"), None)
