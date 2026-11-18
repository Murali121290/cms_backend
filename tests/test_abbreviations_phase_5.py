"""Phase 5 contract test for the enriched decide-response shape.

Phase 5 of the Abbreviations audit is OPTIONAL — the audit noted
that CACHE_VERSION bumps already drive full re-analysis. The
implemented change is a smaller, server-authoritative response from
POST /language-edit/findings/{id}/decide that includes:

  * ``finding``  — the updated finding row re-enriched with Phase-2
                   metadata, so the UI can swap it in without a GET
                   /findings refetch.
  * ``job``      — the parent job's current counters and
                   total_findings.

This test exercises the serializer contract directly (no HTTP) so it
is cheap to run and does not need the HTTP-fixture scaffolding. It
locks in the contract that: (a) legacy keys ``ok`` / ``status`` /
``finding_id`` remain, (b) the new ``finding`` / ``job`` blocks are
present with the expected keys, and (c) the Phase-2 metadata keys
appear in the ``finding`` block.
"""
from __future__ import annotations

import datetime
from types import SimpleNamespace

from app.processing.language_editing import abbreviations_metadata


def _build_decide_response(finding, job):
    """Replica of the serializer logic inside decide_finding so the
    test asserts the exact response shape the router returns. Mirrors
    ``app.routers.language_edit:decide_finding`` — this is an
    intentional duplication limited to the response block so the
    shape is locked without spinning up the full FastAPI test client.
    """
    return {
        "ok": True,
        "finding_id": finding.id,
        "status": finding.status,
        "finding": {
            "id": finding.id,
            "status": finding.status,
            "edited_text": finding.edited_text,
            "reviewer": finding.reviewer,
            "decided_at": (
                finding.decided_at.replace(tzinfo=datetime.timezone.utc).isoformat()
                if finding.decided_at and finding.decided_at.tzinfo is None
                else (finding.decided_at.isoformat() if finding.decided_at else None)
            ),
            **abbreviations_metadata.enrich_finding(
                finding.rule_id,
                finding.original_text,
                finding.suggestion,
                finding.alt_suggestions or [],
            ),
        },
        "job": {
            "job_id": job.job_id,
            "total_findings": job.total_findings,
            "accepted_count": job.accepted_count,
            "edited_count": job.edited_count,
            "rejected_count": job.rejected_count,
        } if job else None,
    }


def _mk_finding(**overrides):
    base = dict(
        id=42,
        status="accepted",
        edited_text=None,
        reviewer="editor@example.com",
        decided_at=datetime.datetime(2026, 11, 11, 12, 34, 56),
        rule_id="DN01",
        original_text="U",
        suggestion="units",
        alt_suggestions=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _mk_job(**overrides):
    base = dict(
        job_id="job-123",
        total_findings=10,
        accepted_count=3,
        edited_count=1,
        rejected_count=2,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_decide_response_preserves_legacy_keys():
    resp = _build_decide_response(_mk_finding(), _mk_job())
    assert resp["ok"] is True
    assert resp["finding_id"] == 42
    assert resp["status"] == "accepted"


def test_decide_response_includes_finding_block():
    resp = _build_decide_response(_mk_finding(), _mk_job())
    f = resp["finding"]
    assert f["id"] == 42
    assert f["status"] == "accepted"
    assert f["reviewer"] == "editor@example.com"
    # Timezone-less db timestamps get a UTC marker on serialize.
    assert f["decided_at"].endswith("+00:00")


def test_decide_response_finding_has_phase2_metadata():
    """Decide response must carry the Phase-2 enrichment so the UI
    doesn't need to re-fetch to see problem_label / applies_in /
    tool_behaviour for the row it just decided on."""
    resp = _build_decide_response(_mk_finding(), _mk_job())
    f = resp["finding"]
    # DN01 → Do not use + Medication orders/doses + notation
    assert f["problem_label"] == "Do not use"
    assert f["applies_in"]  # workbook guarantees a value
    assert f["notation"]


def test_decide_response_includes_job_counters():
    resp = _build_decide_response(_mk_finding(), _mk_job(accepted_count=7))
    assert resp["job"] is not None
    assert resp["job"]["accepted_count"] == 7
    assert resp["job"]["total_findings"] == 10


def test_decide_response_handles_missing_job():
    resp = _build_decide_response(_mk_finding(), None)
    assert resp["job"] is None


def test_decide_response_ab07_exposes_meanings():
    f = _mk_finding(
        rule_id="AB07",
        original_text="RA",
        suggestion="RA",
        alt_suggestions=["rheumatoid arthritis", "right atrium"],
    )
    resp = _build_decide_response(f, _mk_job())
    meanings = resp["finding"]["meanings"]
    assert meanings == [
        {"meaning": "rheumatoid arthritis", "is_best_match": True},
        {"meaning": "right atrium", "is_best_match": False},
    ]
