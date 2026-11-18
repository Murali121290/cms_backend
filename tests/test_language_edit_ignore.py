"""Tests for the Ignored Terms workflow.

Covers the Ignore Once / Ignore Always decision model:

  * Ignore Once persists ``status='rejected'`` + ``ignore_scope='once'``
    and does NOT cascade to sibling findings that share
    ``(rule_id, original_text)``.
  * Ignore Always persists ``status='rejected'`` + ``ignore_scope='always'``
    AND cascades to every PENDING sibling in the same job, copying the
    reviewer / decided_at / scope so the Ignored Terms panel lists them
    as one logical decision.
  * Restoring an Ignore Once flips exactly one row back to ``pending``;
    the other rejected rows in the job stay rejected.
  * Restoring an Ignore Always cascade-restores every rejected sibling
    that shares ``(rule_id, original_text)`` and is also scoped ``always``.
    'once' rejections are left alone — a reviewer who meant "just this
    one" should keep their decision.
  * Ignored rows still come back from ``GET /findings`` via the
    serializer and carry ``ignore_scope`` so the UI can render the
    Once vs Always chip without a second fetch.
  * The AB re-analysis suppression grows a second
    ``(rule_id, original_text)``-only bucket for 'always' ignores so a
    subsequent Accept on an unrelated AB finding doesn't resurrect them.

Tests walk the real router functions (``decide_finding`` /
``restore_finding``) against an in-memory SQLite DB so the HTTP stack
is not exercised — the permission guard is monkey-patched the same
way ``test_abbreviations_reanalysis.py`` does it.
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
from app.routers.language_edit import DecisionRequest


# ─── fixtures ──────────────────────────────────────────────────────

@pytest.fixture()
def _ignore_fixture(db_session, tmp_path, project_record, chapter_record):
    """Job + file + three same-term pending findings that an Ignore
    Always cascade must touch, plus one unrelated finding that should
    never move."""
    docx_path = tmp_path / "chapter.docx"
    doc = Document()
    doc.add_paragraph("The study examined outcomes.")
    doc.add_paragraph("The study continued after revision.")
    doc.add_paragraph("A separate paragraph without the term.")
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
        job_id="ignore-test-job",
        file_id=file_record.id,
        project_id=project_record.id,
        status="in_review",
        total_findings=4,
        content_hash="a" * 64,
        rules_hash="b" * 64,
    )
    db_session.add(job)
    db_session.commit()

    def _mk(**kw) -> LanguageEditFinding:
        defaults = dict(
            job_id=job.job_id,
            file_id=file_record.id,
            para_index=0,
            start_offset=0,
            end_offset=9,
            rule_id="GR001",
            category="grammar",
            severity="warning",
            original_text="The study",
            suggestion="The research",
            message="Prefer 'research' over 'study'",
            autofixable=True,
            status="pending",
            source="rule",
        )
        defaults.update(kw)
        return LanguageEditFinding(**defaults)

    occ_a = _mk()
    occ_b = _mk(para_index=1)
    occ_c = _mk(para_index=2, start_offset=12, end_offset=21)  # same span rule+term, different para
    unrelated = _mk(
        para_index=0,
        start_offset=20,
        end_offset=28,
        rule_id="GR999",
        original_text="examined",
        suggestion="reviewed",
        message="Unrelated rule — must not cascade",
    )
    db_session.add_all([occ_a, occ_b, occ_c, unrelated])
    db_session.commit()
    job.rejected_count = 0
    db_session.commit()

    return {
        "file": file_record,
        "job": job,
        "occ_a": occ_a,
        "occ_b": occ_b,
        "occ_c": occ_c,
        "unrelated": unrelated,
    }


@pytest.fixture()
def _bypass_permissions(monkeypatch):
    """Skip the role check so the handler reaches the decide/restore
    body without role-master seeding."""
    import app.domains.processing.service as svc
    monkeypatch.setattr(svc, "check_permission", lambda *a, **kw: None)


# ─── Ignore Once ───────────────────────────────────────────────────

def test_ignore_once_appears_in_ignored_list(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]

    resp = le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="once", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    assert resp["status"] == "rejected"
    assert resp["finding"]["ignore_scope"] == "once"
    assert resp.get("cascaded_ids") in (None, [])

    db_session.refresh(target)
    assert target.status == "rejected"
    assert target.ignore_scope == "once"
    assert target.decided_at is not None
    assert target.reviewer is not None


def test_ignore_once_does_not_cascade(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    sibling = _ignore_fixture["occ_b"]
    sibling_c = _ignore_fixture["occ_c"]

    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="once", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    db_session.refresh(sibling)
    db_session.refresh(sibling_c)
    assert sibling.status == "pending", "Ignore Once must not touch siblings"
    assert sibling.ignore_scope is None
    assert sibling_c.status == "pending"
    assert sibling_c.ignore_scope is None


# ─── Ignore Always ─────────────────────────────────────────────────

def test_ignore_always_cascades_to_all_matching_siblings(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    sib_b = _ignore_fixture["occ_b"]
    sib_c = _ignore_fixture["occ_c"]
    unrelated = _ignore_fixture["unrelated"]

    resp = le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    assert resp["status"] == "rejected"
    assert resp["finding"]["ignore_scope"] == "always"
    assert set(resp["cascaded_ids"]) == {sib_b.id, sib_c.id}

    db_session.refresh(sib_b)
    db_session.refresh(sib_c)
    assert sib_b.status == "rejected" and sib_b.ignore_scope == "always"
    assert sib_c.status == "rejected" and sib_c.ignore_scope == "always"

    db_session.refresh(unrelated)
    assert unrelated.status == "pending", (
        "Unrelated rule+term must stay pending — cascade is keyed by "
        "(rule_id, original_text)"
    )


def test_ignore_always_response_carries_refreshed_findings(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]

    resp = le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    # Atomic-replace payload so the frontend can skip an extra GET.
    assert isinstance(resp.get("findings"), list)
    serialized = {f["id"]: f for f in resp["findings"]}
    for cid in resp["cascaded_ids"] + [target.id]:
        assert serialized[cid]["status"] == "rejected"
        assert serialized[cid]["ignore_scope"] == "always"


def test_ignore_always_updates_job_rejected_counter(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    job = _ignore_fixture["job"]
    before = job.rejected_count or 0

    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )
    db_session.refresh(job)
    # Target + both cascaded siblings — three rejected rows total.
    assert job.rejected_count == before + 3


# ─── Restore ───────────────────────────────────────────────────────

def test_restore_ignore_once_returns_single_finding(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    other = _ignore_fixture["occ_b"]

    # Ignore both independently with 'once' so the restore doesn't
    # cascade.
    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="once", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )
    le_router.decide_finding(
        finding_id=other.id,
        body=DecisionRequest(status="rejected", ignore_scope="once", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    resp = le_router.restore_finding(
        finding_id=target.id, db=db_session, current_user=admin_user,
    )

    assert resp["cascade_scope"] == "once"
    assert resp["restored_ids"] == [target.id]
    assert resp["finding"]["status"] == "pending"
    assert resp["finding"]["ignore_scope"] is None

    db_session.refresh(target)
    db_session.refresh(other)
    assert target.status == "pending"
    assert target.ignore_scope is None
    assert other.status == "rejected", (
        "Restoring one 'once' ignore must not touch a separately-ignored "
        "sibling"
    )
    assert other.ignore_scope == "once"


def test_restore_ignore_always_cascades(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    sib_b = _ignore_fixture["occ_b"]
    sib_c = _ignore_fixture["occ_c"]
    unrelated = _ignore_fixture["unrelated"]

    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    resp = le_router.restore_finding(
        finding_id=target.id, db=db_session, current_user=admin_user,
    )

    assert resp["cascade_scope"] == "always"
    assert set(resp["restored_ids"]) == {target.id, sib_b.id, sib_c.id}

    for row in (target, sib_b, sib_c):
        db_session.refresh(row)
        assert row.status == "pending"
        assert row.ignore_scope is None
        assert row.reviewer is None
        assert row.decided_at is None

    db_session.refresh(unrelated)
    assert unrelated.status == "pending", "Restore cascade must not touch unrelated findings"


def test_restore_refuses_non_rejected(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    pending = _ignore_fixture["occ_a"]
    with pytest.raises(Exception) as ei:
        le_router.restore_finding(
            finding_id=pending.id, db=db_session, current_user=admin_user,
        )
    # FastAPI raises HTTPException; just checking it fires is enough.
    assert "ignored" in str(ei.value).lower()


# ─── Persistence shape (GET serializer) ───────────────────────────

def test_serializer_exposes_ignore_scope(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    target = _ignore_fixture["occ_a"]
    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )
    db_session.refresh(target)
    row = le_router._serialize_finding_row(target, {})
    assert row["ignore_scope"] == "always"
    assert row["status"] == "rejected"
    assert row["decided_at"] is not None


# ─── Re-analysis suppression for 'always' ignores ─────────────────

def test_ab_reanalysis_suppresses_always_ignored_siblings(
    db_session, _ignore_fixture, admin_user, _bypass_permissions,
):
    """A finding rejected as ``always`` must stay suppressed even when
    the AB re-analysis helper runs. Using an AB rule id here since
    the re-analysis path only re-emits AB rules; the suppression
    code lives inside ``_reanalyze_abbreviations_for_job`` and is
    what this test guards. The GR rule fixture is swapped for an AB
    rule row so the helper actually considers it."""
    job = _ignore_fixture["job"]
    file = _ignore_fixture["file"]

    # Reshape the fixture rows so they look like AB rule findings.
    for row in (
        _ignore_fixture["occ_a"],
        _ignore_fixture["occ_b"],
        _ignore_fixture["occ_c"],
    ):
        row.rule_id = "AB02"
        row.category = "abbreviations"
    db_session.commit()

    target = _ignore_fixture["occ_a"]
    le_router.decide_finding(
        finding_id=target.id,
        body=DecisionRequest(status="rejected", ignore_scope="always", reviewer="tester"),
        db=db_session, current_user=admin_user,
    )

    # Re-run the AB helper. It reads the DB directly, builds the
    # suppression sets (per-tuple + always-only), and rewrites pending
    # AB rows from the virtual document. A re-emitted AB02 on "The
    # study" would re-appear if the 'always' bucket wasn't consulted.
    le_router._reanalyze_abbreviations_for_job(job, db_session)

    resurrected = (
        db_session.query(LanguageEditFinding)
        .filter(
            LanguageEditFinding.job_id == job.job_id,
            LanguageEditFinding.status == "pending",
            LanguageEditFinding.rule_id == "AB02",
            LanguageEditFinding.original_text == "The study",
        )
        .count()
    )
    assert resurrected == 0, (
        "AB re-analysis must respect the (rule_id, original_text) 'always' "
        "suppression bucket — no pending AB02 'The study' rows may resurface."
    )
