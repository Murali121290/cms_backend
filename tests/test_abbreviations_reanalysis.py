"""Regression tests for the AB-finding re-analysis helper.

Covers the behaviour promised when an AB finding is accepted or
edited in the review panel (per the revised grouping requirement):

  * Pending AB rows are REPLACED by a fresh re-run against the
    virtual (post-patch) document.
  * Decided rows (accepted / edited / rejected / highlighted) are
    PRESERVED untouched.
  * Prior Reject / Highlight decisions on a (para, rule, surface)
    key SUPPRESS re-emission on the next re-analysis — ignored
    findings do not silently come back.
  * Non-AB rows (DN01-32, grammar, spelling, hyphenation, …) are
    NEVER deleted or duplicated by the AB re-analysis.
  * No stale or duplicate pending AB rows remain in the DB after
    the rewrite.

The test exercises the helper directly against an in-memory SQLite
DB so the DOCX → virtual-text → analyze → DB roundtrip is covered
without spinning up the HTTP stack. Where the requirement maps
one-to-one to an HTTP contract, an API-level integration test
sits next to the unit tests below.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from docx import Document

from app import models
from app.domains.processing.language_edit_models import (
    LanguageEditFinding,
    LanguageEditJob,
)
from app.routers import language_edit as le_router


# ─── _apply_patches_to_text helper ─────────────────────────────────

def test_apply_patches_to_text_single_patch_at_end():
    out = le_router._apply_patches_to_text(
        "intensive care unit admitted a patient",
        [(0, 19, "intensive care unit (ICU)")],
    )
    assert out == "intensive care unit (ICU) admitted a patient"


def test_apply_patches_to_text_multiple_patches_right_to_left():
    """Multiple patches on the same paragraph must apply right-to-left
    so each patch's offsets stay valid against the pre-application
    text (left-to-right would shift offsets and corrupt later patches)."""
    text = "The ICU admitted a patient; the ICU staff did rounds."
    patches = [
        (4, 7, "intensive care unit (ICU)"),   # first ICU
        (32, 35, "ICU"),                         # second ICU (unchanged)
    ]
    out = le_router._apply_patches_to_text(text, patches)
    assert out == "The intensive care unit (ICU) admitted a patient; the ICU staff did rounds."


def test_apply_patches_to_text_rejects_out_of_range_patch():
    """A patch whose range falls outside the text (e.g. stale offsets
    after an unrelated edit) is silently skipped — the helper never
    raises so a single bad row won't poison a re-analysis."""
    out = le_router._apply_patches_to_text(
        "short text",
        [(100, 200, "never applied"), (0, 5, "SHORT")],
    )
    assert out == "SHORT text"


# ─── _reanalyze_abbreviations_for_job — integration ────────────────

@pytest.fixture()
def _ab_fixture(db_session, tmp_path, project_record, chapter_record):
    """Build a DOCX with multiple ``intensive care unit`` / ``ICU``
    occurrences, persist a File row, a LanguageEditJob row, and a
    starting set of PENDING AB findings. Return everything the
    helper test needs."""
    docx_path = tmp_path / "chapter.docx"
    doc = Document()
    doc.add_paragraph("The patient was admitted to the intensive care unit after surgery.")
    doc.add_paragraph("The intensive care unit staff reviewed the chart.")
    doc.add_paragraph("Later the patient left the intensive care unit.")
    doc.save(docx_path)

    file_record = models.File(
        project_id=project_record.id,
        chapter_id=chapter_record.id,
        filename="chapter.docx",
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        category="Manuscript",
        path=str(docx_path),
        version=1,
    )
    db_session.add(file_record)
    db_session.commit()
    db_session.refresh(file_record)

    job = LanguageEditJob(
        job_id="reanalyze-test-job",
        file_id=file_record.id,
        project_id=project_record.id,
        status="in_review",
        total_findings=0,
        content_hash="x" * 64,
        rules_hash="y" * 64,
    )
    db_session.add(job)
    db_session.commit()

    return {
        "file": file_record,
        "job": job,
        "docx_path": docx_path,
    }


def _ab_finding(job_id, file_id, *, para_index, start, end, rule_id, original,
                suggestion, status="pending"):
    return LanguageEditFinding(
        job_id=job_id,
        file_id=file_id,
        para_index=para_index,
        start_offset=start,
        end_offset=end,
        rule_id=rule_id,
        category="abbreviations",
        severity="warning",
        original_text=original,
        suggestion=suggestion,
        message=f"{rule_id}: test",
        autofixable=True,
        status=status,
        source="rule",
    )


def _dn_finding(job_id, file_id, *, para_index, start, end):
    return LanguageEditFinding(
        job_id=job_id,
        file_id=file_id,
        para_index=para_index,
        start_offset=start,
        end_offset=end,
        rule_id="DN01",
        category="abbreviations",
        severity="warning",
        original_text="U",
        suggestion="units",
        message="DN01 test",
        autofixable=True,
        status="pending",
        source="rule",
    )


def test_reanalyze_preserves_decided_findings(db_session, _ab_fixture):
    """Accepting a first-use AB01 must not touch the row itself (or
    any other decided row) — only pending rows are rewritten."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    accepted = _ab_finding(
        job.job_id, file.id,
        para_index=0, start=32, end=51,
        rule_id="AB01", original="intensive care unit",
        suggestion="intensive care unit (ICU)", status="accepted",
    )
    pending_elsewhere = _ab_finding(
        job.job_id, file.id,
        para_index=1, start=4, end=23,
        rule_id="AB02", original="intensive care unit",
        suggestion="ICU",
    )
    db_session.add_all([accepted, pending_elsewhere])
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    survivors = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .all()
    )
    accepted_rows = [f for f in survivors if f.status == "accepted"]
    assert len(accepted_rows) == 1, "accepted AB row must survive re-analysis"
    assert accepted_rows[0].id == accepted.id
    assert accepted_rows[0].rule_id == "AB01"


def test_reanalyze_replaces_pending_ab_rows(db_session, _ab_fixture):
    """Pending AB rows get wiped and refilled from the fresh analyzer
    run against the virtual (post-patch) text. The pre-run pending
    row IDs must NOT appear in the post-run set."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    stale = _ab_finding(
        job.job_id, file.id,
        para_index=0, start=999, end=1000,
        rule_id="AB01", original="bogus", suggestion="bogus-fix",
    )
    db_session.add(stale)
    db_session.commit()
    stale_id = stale.id

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    survivors = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .all()
    )
    pending_ids = {f.id for f in survivors if f.status == "pending"}
    assert stale_id not in pending_ids, (
        "stale pending AB row must be deleted, not carried forward"
    )


def test_reanalyze_leaves_non_ab_rows_untouched(db_session, _ab_fixture):
    """DN01-32 and every other category must NOT be deleted,
    rewritten, or duplicated by the AB-only re-analysis."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    dn = _dn_finding(job.job_id, file.id, para_index=0, start=0, end=1)
    db_session.add(dn)
    db_session.commit()
    dn_id = dn.id

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    dn_survivors = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.rule_id == "DN01",
        )
        .all()
    )
    assert [f.id for f in dn_survivors] == [dn_id], (
        "DN finding must pass through re-analysis untouched"
    )


def test_reanalyze_suppresses_resurrection_of_rejected_finding(db_session, _ab_fixture):
    """A reviewer who clicks Ignore on an AB finding expects it to
    stay gone. If re-analysis would re-emit the same (para, rule,
    surface), we must suppress it — otherwise an Accept on an
    unrelated finding would silently un-reject the ignored one."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Reviewer previously rejected the AB02 on para 1's "intensive
    # care unit" surface. The DOCX still contains that text so a
    # naive re-analysis would emit AB02 again at the same (para,
    # rule_id, original_text).
    rejected = _ab_finding(
        job.job_id, file.id,
        para_index=1, start=4, end=23,
        rule_id="AB02", original="intensive care unit",
        suggestion="ICU", status="rejected",
    )
    db_session.add(rejected)
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    reemitted = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.rule_id == "AB02",
            LanguageEditFinding.para_index == 1,
            LanguageEditFinding.original_text == "intensive care unit",
            LanguageEditFinding.status == "pending",
        )
        .count()
    )
    assert reemitted == 0, (
        "AB02 was previously rejected on this span — re-analysis must "
        "not resurrect it as a new pending finding"
    )


def test_reanalyze_produces_no_duplicate_pending_rows(db_session, _ab_fixture):
    """The new pending AB set must be deduped: no two rows with the
    same (para_index, start_offset, end_offset, rule_id, original_text)."""
    job = _ab_fixture["job"]

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    pending = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id.like("AB%"),
        )
        .all()
    )
    keys = [
        (f.para_index, f.start_offset, f.end_offset, f.rule_id, f.original_text)
        for f in pending
    ]
    assert len(keys) == len(set(keys)), (
        f"duplicate pending AB rows detected: {keys}"
    )


def test_reanalyze_updates_job_total_findings(db_session, _ab_fixture):
    """``job.total_findings`` must track the row count AFTER the
    rewrite so the dashboard's total reflects reality."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]

    # Seed one accepted + one stale pending so the pre-count differs
    # from the post-count.
    db_session.add_all([
        _ab_finding(job.job_id, file.id, para_index=0, start=32, end=51,
                    rule_id="AB01", original="intensive care unit",
                    suggestion="intensive care unit (ICU)", status="accepted"),
        _ab_finding(job.job_id, file.id, para_index=2, start=0, end=5,
                    rule_id="AB01", original="stale", suggestion="stale-fix"),
    ])
    db_session.commit()

    le_router._reanalyze_abbreviations_for_job(job, db_session)

    db_session.refresh(job)
    actual_count = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    assert job.total_findings == actual_count


def test_reanalyze_missing_file_is_a_safe_noop(db_session, _ab_fixture):
    """Delete the DOCX from disk before calling the helper — the
    function must return None (helper's documented failure mode)
    without raising or mutating the DB."""
    job = _ab_fixture["job"]
    file = _ab_fixture["file"]
    Path(file.path).unlink()

    pending_before = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    result = le_router._reanalyze_abbreviations_for_job(job, db_session)
    assert result is None
    pending_after = (
        db_session.query(LanguageEditFinding)
        .filter(LanguageEditFinding.job_id == job.job_id)
        .count()
    )
    assert pending_after == pending_before, "DB must not change on I/O failure"
